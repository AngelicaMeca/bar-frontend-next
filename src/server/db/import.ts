import type { CollectionName, DataStore } from "../store";
import type { PgStore } from "./pg-store";

/**
 * Orden de importación respetando claves foráneas. Las mesas se guardan dos veces: primero sin
 * pedido ni reserva (todavía no existen) y al final, para vincularlas.
 */
const ORDER: CollectionName[] = [
  "config",
  "users",
  "resetRequests",
  "sectors",
  "groups",
  "tables",
  "categories",
  "supplies",
  "products",
  "lots",
  "suppliers",
  "customers",
  "reservations",
  "orders",
  "tables",
  "assignments",
  "purchases",
  "stockMovements",
  "shifts",
  "cashMovements",
  "sales",
  "waitlist",
  "outbox",
  "notifications",
  "audit",
  "sessions",
];

/** Guarda en paralelo (las consultas se encolan en la misma conexión y viajan juntas). */
async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Copia todos los datos de `src` (p. ej. los datos de ejemplo generados en memoria) a PostgreSQL. */
export async function importAll(src: DataStore, dst: PgStore, log: (msg: string) => void = () => undefined) {
  await dst.tx(async () => {
    for (const col of ORDER) {
      const docs = await src.all(col);
      if (!docs.length) continue;
      // Historiales en orden cronológico (la app igualmente ordena por fecha).
      if (col === "audit" || col === "assignments" || col === "cashMovements") (docs as { at: string }[]).sort((a, b) => a.at.localeCompare(b.at));
      await inBatches(docs, 25, (d) => dst.saveRaw(col, d as never));
      log(`  ${col}: ${docs.length}`);
    }
    await dst.syncSequences();
    await dst.setMeta("version", "1");
  });
}
