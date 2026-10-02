// Conexión compartida por los scripts de base de datos (lee DATABASE_URL de .env.local).
import fs from "node:fs";
import postgres from "postgres";

export function conectar() {
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Falta DATABASE_URL. Copiá .env.example como .env.local y completá la cadena de conexión de Supabase.");
    process.exit(1);
  }
  const u = new URL(url);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  const sql = postgres(url, { ssl: local ? false : "require", prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
  return { sql, destino: `${u.hostname}:${u.port || 5432}${u.pathname}` };
}
