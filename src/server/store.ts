import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type {
  AuditEntry,
  BarTable,
  CashMovement,
  CashShift,
  Category,
  Config,
  Customer,
  Lot,
  Notification,
  Order,
  OutboxMessage,
  PasswordResetRequest,
  Product,
  PurchaseOrder,
  Reservation,
  Sale,
  Sector,
  Session,
  StockMovement,
  Supplier,
  Supply,
  TableGroup,
  User,
  WaiterAssignment,
  WaitlistEntry,
} from "@/lib/types";

export interface Collections {
  users: User;
  sessions: Session;
  resetRequests: PasswordResetRequest;
  sectors: Sector;
  tables: BarTable;
  groups: TableGroup;
  assignments: WaiterAssignment;
  categories: Category;
  products: Product;
  orders: Order;
  supplies: Supply;
  lots: Lot;
  stockMovements: StockMovement;
  suppliers: Supplier;
  purchases: PurchaseOrder;
  shifts: CashShift;
  cashMovements: CashMovement;
  sales: Sale;
  customers: Customer;
  reservations: Reservation;
  waitlist: WaitlistEntry;
  outbox: OutboxMessage;
  notifications: Notification;
  audit: AuditEntry;
  config: Config;
}

export type CollectionName = keyof Collections;

/**
 * Usuario que realiza la operación en curso. PostgreSQL lo usa en los triggers de trazabilidad
 * (p. ej. historial de precios, RNF-09).
 */
export const actorContext = new AsyncLocalStorage<{ userId: string }>();
export const withActor = <R>(userId: string, fn: () => Promise<R>) => actorContext.run({ userId }, fn);

/** Secuencias numéricas visibles (n.° de pedido, comprobante, OC) y orden del kardex. */
export type SeqName = "order" | "sale" | "purchase" | "stockMovement";

/**
 * Acceso a datos usado por todos los servicios. Hay dos implementaciones:
 *  - SqliteStore: prototipo local sin configuración (archivo data/bar.db).
 *  - PgStore:     PostgreSQL / Supabase con el esquema relacional de database/schema.sql.
 * Toda escritura ocurre dentro de `tx`, que serializa las operaciones concurrentes
 * sobre mesas, pedidos y stock (RF-STK-04, RNF-03).
 */
export interface DataStore {
  readonly kind: "sqlite" | "postgres";
  all<K extends CollectionName>(col: K): Promise<Collections[K][]>;
  find<K extends CollectionName>(col: K, pred: (d: Collections[K]) => boolean): Promise<Collections[K][]>;
  get<K extends CollectionName>(col: K, id: string): Promise<Collections[K] | undefined>;
  put<K extends CollectionName>(col: K, doc: Collections[K]): Promise<Collections[K]>;
  delete(col: CollectionName, id: string): Promise<void>;
  count(col: CollectionName): Promise<number>;
  tx<R>(fn: () => Promise<R> | R): Promise<R>;
  version(): Promise<number>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
  nextSeq(name: SeqName): Promise<number>;
  /** Actualiza la última actividad de una sesión sin disparar el refresco en tiempo real. */
  touchSession(id: string, at: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Almacén documental sobre SQLite (módulo nativo node:sqlite, sin dependencias).
 * Las transacciones se encolan: una a la vez, como BEGIN IMMEDIATE en un único proceso.
 */
export class SqliteStore implements DataStore {
  readonly kind = "sqlite" as const;
  readonly db: DatabaseSyncType;
  private als = new AsyncLocalStorage<{ dirty: boolean }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS docs (
        col TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (col, id)
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta (key, value) VALUES ('version', '0');
    `);
  }

  // ---- lecturas (sincrónicas por dentro) ----
  allSync<K extends CollectionName>(col: K): Collections[K][] {
    const rows = this.db.prepare("SELECT data FROM docs WHERE col = ?").all(col) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  async all<K extends CollectionName>(col: K) {
    return this.allSync(col);
  }

  async find<K extends CollectionName>(col: K, pred: (d: Collections[K]) => boolean) {
    return this.allSync(col).filter(pred);
  }

  async get<K extends CollectionName>(col: K, id: string): Promise<Collections[K] | undefined> {
    const row = this.db.prepare("SELECT data FROM docs WHERE col = ? AND id = ?").get(col, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  async count(col: CollectionName) {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM docs WHERE col = ?").get(col) as { n: number };
    return Number(row.n);
  }

  // ---- escrituras (siempre dentro de una transacción) ----
  async put<K extends CollectionName>(col: K, doc: Collections[K]) {
    return this.tx(() => {
      this.db
        .prepare("INSERT INTO docs (col, id, data) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data")
        .run(col, (doc as { id: string }).id, JSON.stringify(doc));
      this.als.getStore()!.dirty = true;
      return doc;
    });
  }

  async delete(col: CollectionName, id: string) {
    await this.tx(() => {
      this.db.prepare("DELETE FROM docs WHERE col = ? AND id = ?").run(col, id);
      this.als.getStore()!.dirty = true;
    });
  }

  /** Ejecuta `fn` en una transacción. Las anidadas se integran a la externa. */
  async tx<R>(fn: () => Promise<R> | R): Promise<R> {
    if (this.als.getStore()) return fn();
    const run = async () => {
      const state = { dirty: false };
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await this.als.run(state, fn);
        if (state.dirty) this.db.exec("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'version'");
        this.db.exec("COMMIT");
        return result;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async version() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string };
    return Number(row.value);
  }

  async getMeta(key: string) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  async setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  async nextSeq(name: SeqName) {
    return this.tx(() => {
      const n = Number((this.db.prepare("SELECT value FROM meta WHERE key = ?").get(`seq:${name}`) as { value: string } | undefined)?.value ?? "0") + 1;
      this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`seq:${name}`, String(n));
      return n;
    });
  }

  async touchSession(id: string, at: string) {
    this.db.prepare("UPDATE docs SET data = json_set(data, '$.lastSeenAt', ?) WHERE col = 'sessions' AND id = ?").run(at, id);
  }

  /** Copia consistente de la base (RNF-10). */
  backup(target: string) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    this.db.prepare("VACUUM INTO ?").run(target);
  }

  async close() {
    this.db.close();
  }
}

export const DB_FILE = path.join(process.cwd(), "data", "bar.db");
