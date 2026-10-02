import postgres from "postgres";

export type Row = Record<string, unknown>;
export type QueryFn = (text: string, params?: unknown[]) => Promise<Row[]>;

/** Conexión mínima a PostgreSQL que usa PgStore (postgres.js en producción, PGlite en pruebas). */
export interface SqlDriver {
  query: QueryFn;
  /** Ejecuta `fn` en una transacción; si `fn` falla, se revierte. */
  begin<R>(fn: (q: QueryFn) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

/** Los parámetros `undefined` se envían como NULL. */
const clean = (params: unknown[] = []) => params.map((p) => (p === undefined ? null : p));

/** Driver sobre postgres.js para Supabase o cualquier PostgreSQL. */
export function postgresDriver(url: string): SqlDriver {
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const sql = postgres(url, {
    ssl: local ? false : "require",
    prepare: false, // compatible con el pooler de Supabase
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => undefined,
  });
  const run = (s: postgres.Sql | postgres.TransactionSql): QueryFn => async (text, params) =>
    (await s.unsafe(text, clean(params) as postgres.ParameterOrJSON<never>[])) as unknown as Row[];
  return {
    query: run(sql),
    begin: (fn) => sql.begin((tx) => fn(run(tx))) as Promise<Awaited<ReturnType<typeof fn>>>,
    close: () => sql.end(),
  };
}
