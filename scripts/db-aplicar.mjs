// Crea el esquema en la base de Supabase y bloquea la API pública: npm run db:aplicar
// Se niega a ejecutarse si el esquema ya existe, para no pisar datos.
import fs from "node:fs";
import { conectar } from "./db-conexion.mjs";

const { sql, destino } = conectar();
try {
  console.log(`Conectando a ${destino}…`);
  const [{ existe }] = await sql`SELECT to_regclass('public.usuario') IS NOT NULL AS existe`;
  if (existe) {
    console.error("El esquema ya existe en esta base (hay una tabla 'usuario'). No se aplicó nada para no pisar datos.");
    process.exitCode = 1;
  } else {
    await sql.unsafe(fs.readFileSync("database/schema.sql", "utf8"));
    console.log("✓ Esquema creado (database/schema.sql)");
    await sql.unsafe(fs.readFileSync("database/supabase-seguridad.sql", "utf8"));
    console.log("✓ API pública bloqueada (database/supabase-seguridad.sql)");
    const [{ tablas }] = await sql`SELECT count(*)::int AS tablas FROM pg_tables WHERE schemaname = 'public'`;
    console.log(`Listo: ${tablas} tablas en el esquema public.`);
  }
} catch (e) {
  console.error(`✗ Error: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
