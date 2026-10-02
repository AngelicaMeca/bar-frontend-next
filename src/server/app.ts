import "server-only";
import { cookies } from "next/headers";
import { AppError, type Ctx } from "./core";
import { seed } from "./seed";
import { resolveSession, SESSION_COOKIE } from "./services/auth";
import { runScheduler } from "./services/scheduler";
import { postgresDriver } from "./db/driver";
import { importAll } from "./db/import";
import { PgStore } from "./db/pg-store";
import { type DataStore, DB_FILE, SqliteStore } from "./store";

const g = globalThis as unknown as { __barStore?: Promise<DataStore> };

async function createStore(): Promise<DataStore> {
  const url = process.env.DATABASE_URL;
  if (url) return createPgStore(url);
  const store = new SqliteStore(process.env.BAR_DB_FILE || DB_FILE);
  if ((await store.count("users")) === 0) await seed(store);
  return store;
}

/** PostgreSQL / Supabase. Si la base está vacía se carga con los datos de ejemplo. */
async function createPgStore(url: string): Promise<DataStore> {
  const store = new PgStore(postgresDriver(url));
  if (!(await store.hasSchema())) {
    await store.close();
    throw new Error("La base PostgreSQL no tiene el esquema de La Barra. Ejecutá: npm run db:aplicar");
  }
  if ((await store.count("users")) === 0) {
    console.log("[La Barra] Base vacía: generando datos de ejemplo e importándolos a PostgreSQL…");
    const t = Date.now();
    const demo = new SqliteStore(":memory:");
    await seed(demo);
    await importAll(demo, store, (m) => console.log(m));
    await demo.close();
    console.log(`[La Barra] Datos de ejemplo cargados en ${Math.round((Date.now() - t) / 1000)} s.`);
  }
  return store;
}

/** Instancia única del almacén por proceso. La base se inicializa con datos de ejemplo la primera vez. */
export function getStore(): Promise<DataStore> {
  g.__barStore ??= createStore().catch((e) => {
    g.__barStore = undefined;
    throw e;
  });
  return g.__barStore;
}

export async function getAuth() {
  const store = await getStore();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = await resolveSession(store, token);
  if (!session) throw new AppError("Sesión expirada o inválida. Inicie sesión nuevamente.", 401);
  // Los procesos automáticos (reservas, vencimientos) se disparan con la actividad del sistema.
  try {
    await runScheduler(store);
  } catch (e) {
    console.error("Error en el planificador", e);
  }
  const ctx: Ctx = { store, user: session.user, now: () => new Date() };
  return { ctx, sessionId: session.sessionId, token };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const issues = (e as { issues: { message: string; path: (string | number)[] }[] }).issues;
    return Response.json({ error: issues.map((i) => i.message).join(" · ") || "Datos inválidos" }, { status: 422 });
  }
  console.error(e);
  return Response.json({ error: "Error interno del servidor" }, { status: 500 });
}
