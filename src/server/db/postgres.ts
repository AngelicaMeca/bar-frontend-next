import "server-only";
import postgres from "postgres";

/**
 * Conexión a PostgreSQL (Supabase) desde el servidor. La cadena de conexión se lee de
 * DATABASE_URL (.env.local) y nunca se envía al navegador.
 */
const g = globalThis as unknown as { __barSql?: postgres.Sql };

export function isPostgresConfigured() {
  return !!process.env.DATABASE_URL;
}

export function getSql(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL en .env.local (ver .env.example).");
  if (!g.__barSql) {
    const host = new URL(url).hostname;
    const local = host === "localhost" || host === "127.0.0.1";
    g.__barSql = postgres(url, {
      ssl: local ? false : "require", // Supabase acepta conexiones cifradas
      prepare: false, // compatible con el pooler de Supabase en modo transacción
      max: 2, // sólo para el diagnóstico; la app usa su propio pool (db/driver.ts)
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return g.__barSql;
}

/** Estado de la conexión para diagnóstico (sin exponer credenciales). */
export async function postgresStatus() {
  if (!isPostgresConfigured()) return { configured: false as const };
  const url = new URL(process.env.DATABASE_URL!);
  const target = `${url.hostname}:${url.port || 5432}${url.pathname}`;
  try {
    const sql = getSql();
    const [info] = await sql<{ version: string; tables: number; schema_ok: boolean; api_blocked: boolean | null }[]>`
      SELECT current_setting('server_version') AS version,
             (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables,
             to_regclass('public.usuario') IS NOT NULL AS schema_ok,
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
                  THEN NOT has_table_privilege('anon', to_regclass('public.usuario'), 'SELECT')
                  ELSE NULL END AS api_blocked
    `;
    return { configured: true as const, connected: true as const, target, ...info, supabase: url.hostname.includes("supabase") };
  } catch (e) {
    return { configured: true as const, connected: false as const, target, error: (e as Error).message };
  }
}
