import { AsyncLocalStorage } from "node:async_hooks";
import { actorContext, type CollectionName, type Collections, type DataStore, type SeqName } from "../store";
import type { QueryFn, SqlDriver } from "./driver";
import { isUuid, MAPPERS } from "./mappers";

/** Clave del bloqueo que serializa las transacciones de escritura (equivale a BEGIN IMMEDIATE). */
const WRITE_LOCK = 4_242_001;

/** Columna identity que respalda cada secuencia de la aplicación. */
const SEQUENCES: Record<SeqName, [table: string, column: string]> = {
  order: ["pedido", "numero"],
  sale: ["venta", "numero"],
  purchase: ["orden_compra", "numero"],
  stockMovement: ["movimiento_stock", "id"],
};

/**
 * Almacén sobre PostgreSQL (Supabase) con el esquema relacional de database/schema.sql.
 * Las lecturas fuera de transacción usan una caché por colección que se invalida cuando cambia
 * la versión de datos (metadato.version), así varias pantallas refrescando no releen todo.
 */
export class PgStore implements DataStore {
  readonly kind = "postgres" as const;
  private als = new AsyncLocalStorage<{ q: QueryFn; dirty: boolean }>();
  private cache = new Map<CollectionName, { version: number; docs: unknown[] }>();

  constructor(private readonly driver: SqlDriver) {}

  private get q(): QueryFn {
    return this.als.getStore()?.q ?? this.driver.query;
  }

  async all<K extends CollectionName>(col: K): Promise<Collections[K][]> {
    if (this.als.getStore()) return MAPPERS[col].load(this.q);
    const version = await this.version();
    const hit = this.cache.get(col);
    if (hit && hit.version === version) return structuredClone(hit.docs) as Collections[K][];
    const docs = await MAPPERS[col].load(this.q);
    this.cache.set(col, { version, docs });
    return structuredClone(docs);
  }

  async find<K extends CollectionName>(col: K, pred: (d: Collections[K]) => boolean) {
    return (await this.all(col)).filter(pred);
  }

  async get<K extends CollectionName>(col: K, id: string): Promise<Collections[K] | undefined> {
    if (!this.als.getStore()) {
      const hit = this.cache.get(col);
      if (hit && hit.version === (await this.version())) {
        const doc = (hit.docs as { id: string }[]).find((d) => d.id === id);
        return doc ? (structuredClone(doc) as Collections[K]) : undefined;
      }
    }
    const [doc] = await MAPPERS[col].load(this.q, [id]);
    return doc;
  }

  async put<K extends CollectionName>(col: K, doc: Collections[K]): Promise<Collections[K]> {
    return this.tx(async () => {
      await MAPPERS[col].save(this.q, doc);
      this.als.getStore()!.dirty = true;
      return doc;
    });
  }

  async delete(col: CollectionName, id: string) {
    await this.tx(async () => {
      await MAPPERS[col].remove(this.q, id);
      this.als.getStore()!.dirty = true;
    });
  }

  async count(col: CollectionName) {
    return MAPPERS[col].count(this.q);
  }

  async tx<R>(fn: () => Promise<R> | R): Promise<R> {
    if (this.als.getStore()) return fn();
    const actor = actorContext.getStore()?.userId;
    return this.driver.begin(async (q) => {
      await q(`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`);
      if (isUuid(actor)) await q(`SELECT set_config('app.usuario_id', $1, true)`, [actor]);
      const state = { q, dirty: false };
      const result = await this.als.run(state, fn);
      if (state.dirty) await q(`UPDATE metadato SET valor = (valor::bigint + 1)::text WHERE clave = 'version'`);
      return result;
    });
  }

  async version() {
    const [row] = await this.q(`SELECT valor FROM metadato WHERE clave = 'version'`);
    return Number(row?.valor ?? 0);
  }

  async getMeta(key: string) {
    const [row] = await this.q(`SELECT valor FROM metadato WHERE clave = $1`, [key]);
    return row ? String(row.valor) : undefined;
  }

  async setMeta(key: string, value: string) {
    await this.q(`INSERT INTO metadato (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [key, value]);
  }

  async nextSeq(name: SeqName) {
    const [table, column] = SEQUENCES[name];
    const [row] = await this.q(`SELECT nextval(pg_get_serial_sequence($1, $2)) AS n`, [table, column]);
    return Number(row.n);
  }

  async touchSession(id: string, at: string) {
    await this.q(`UPDATE sesion SET ultima_actividad = $2::timestamptz WHERE id = $1`, [id, at]);
  }

  /** Guarda un documento tal cual dentro de la transacción en curso (importación masiva). */
  async saveRaw<K extends CollectionName>(col: K, doc: Collections[K]) {
    await MAPPERS[col].save(this.q, doc);
  }

  /** Ajusta las secuencias al máximo existente (después de importar datos con números explícitos). */
  async syncSequences() {
    for (const [table, column] of Object.values(SEQUENCES)) {
      await this.q(
        `SELECT setval(pg_get_serial_sequence($1, $2), GREATEST((SELECT COALESCE(max(${column}), 0) FROM ${table}), 1), (SELECT count(*) > 0 FROM ${table}))`,
        [table, column],
      );
    }
  }

  /** ¿Existe el esquema de La Barra en esta base? */
  async hasSchema() {
    const [row] = await this.q(`SELECT to_regclass('public.metadato') IS NOT NULL AND to_regclass('public.usuario') IS NOT NULL AS ok`);
    return row.ok === true;
  }

  async close() {
    await this.driver.close();
  }
}
