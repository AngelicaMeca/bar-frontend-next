// Verifica la conexión a la base de Supabase y su estado: npm run db:probar
import { conectar } from "./db-conexion.mjs";

const { sql, destino } = conectar();
try {
  const [info] = await sql`
    SELECT current_setting('server_version') AS version,
           (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tablas,
           (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity) AS sin_rls,
           to_regclass('public.usuario') IS NOT NULL AS esquema,
           CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
                THEN has_table_privilege('anon', to_regclass('public.usuario'), 'SELECT') END AS anon_lee_usuarios`;
  console.log(`✓ Conectado a ${destino} (PostgreSQL ${info.version})`);
  console.log(info.esquema ? `✓ Esquema de La Barra presente: ${info.tablas} tablas` : "• Todavía no se creó el esquema: ejecutá npm run db:aplicar");
  if (info.esquema) {
    console.log(info.sin_rls === 0 ? "✓ RLS activado en todas las tablas" : `⚠ ${info.sin_rls} tabla(s) sin RLS: ejecutá database/supabase-seguridad.sql`);
    if (info.anon_lee_usuarios === true) console.log("⚠ La clave anon puede leer la tabla usuario: ejecutá database/supabase-seguridad.sql");
    else if (info.anon_lee_usuarios === false) console.log("✓ La API pública (clave anon) no tiene acceso a los datos");
  }
} catch (e) {
  console.error(`✗ No se pudo conectar a ${destino}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
