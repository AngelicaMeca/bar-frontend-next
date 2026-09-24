import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  AuditEntry,
  BarTable,
  Batch,
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
export type { Batch };

/**
 * Almacén documental sobre SQLite (módulo nativo node:sqlite, sin dependencias).
 * Cada escritura se hace dentro de una transacción `BEGIN IMMEDIATE`, lo que serializa
 * las operaciones concurrentes sobre mesas, pedidos y stock (RF-STK-04, RNF-03).
 */
export class Store {
  readonly db: DatabaseSyncType;
  private depth = 0;
  private dirty = false;

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

  all<K extends CollectionName>(col: K): Collections[K][] {
    const rows = this.db.prepare("SELECT data FROM docs WHERE col = ?").all(col) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  find<K extends CollectionName>(col: K, pred: (d: Collections[K]) => boolean): Collections[K][] {
    return this.all(col).filter(pred);
  }

  get<K extends CollectionName>(col: K, id: string): Collections[K] | undefined {
    const row = this.db.prepare("SELECT data FROM docs WHERE col = ? AND id = ?").get(col, id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  put<K extends CollectionName>(col: K, doc: Collections[K]): Collections[K] {
    this.db
      .prepare("INSERT INTO docs (col, id, data) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data")
      .run(col, (doc as { id: string }).id, JSON.stringify(doc));
    this.markDirty();
    return doc;
  }

  delete(col: CollectionName, id: string) {
    this.db.prepare("DELETE FROM docs WHERE col = ? AND id = ?").run(col, id);
    this.markDirty();
  }

  count(col: CollectionName): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM docs WHERE col = ?").get(col) as { n: number };
    return Number(row.n);
  }

  /** Ejecuta `fn` en una transacción. Las transacciones anidadas se integran a la externa. */
  tx<R>(fn: () => R): R {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    this.dirty = false;
    try {
      const result = fn();
      if (this.dirty) this.db.exec("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'version'");
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth = 0;
      this.dirty = false;
    }
  }

  private markDirty() {
    if (this.depth > 0) this.dirty = true;
    else this.db.exec("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'version'");
  }

  version(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string };
    return Number(row.value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** Secuencia numérica persistente (números de pedido, comprobante, etc.). */
  nextSeq(name: string): number {
    const n = Number(this.getMeta(`seq:${name}`) ?? "0") + 1;
    this.setMeta(`seq:${name}`, String(n));
    return n;
  }

  /** Copia consistente de la base (RNF-10). */
  backup(target: string) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    this.db.prepare("VACUUM INTO ?").run(target);
  }
}

export const DB_FILE = path.join(process.cwd(), "data", "bar.db");
