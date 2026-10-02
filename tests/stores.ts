import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import type { SqlDriver } from "@/server/db/driver";
import { PgStore } from "@/server/db/pg-store";
import { type DataStore, SqliteStore } from "@/server/store";

const schema = fs.readFileSync(path.join(import.meta.dirname, "..", "database", "schema.sql"), "utf8");

/** PostgreSQL embebido (PGlite) con el esquema real de database/schema.sql. */
export async function makePgStore(): Promise<PgStore> {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(schema);
  const clean = (p: unknown[] = []) => p.map((x) => (x === undefined ? null : x));
  const driver: SqlDriver = {
    query: async (text, params) => (await db.query(text, clean(params))).rows as Record<string, unknown>[],
    begin: (fn) => db.transaction((tx) => fn(async (text, params) => (await tx.query(text, clean(params))).rows as Record<string, unknown>[])),
    close: () => db.close(),
  };
  return new PgStore(driver);
}

/** Motor de las pruebas: SQLite (por defecto) o PostgreSQL con TEST_STORE=pg. */
export const usePg = process.env.TEST_STORE === "pg";

export async function makeStore(): Promise<DataStore> {
  return usePg ? makePgStore() : new SqliteStore(":memory:");
}
