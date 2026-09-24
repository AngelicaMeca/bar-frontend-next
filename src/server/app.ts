import "server-only";
import { cookies } from "next/headers";
import { AppError, type Ctx } from "./core";
import { seed } from "./seed";
import { resolveSession, SESSION_COOKIE } from "./services/auth";
import { runScheduler } from "./services/scheduler";
import { DB_FILE, Store } from "./store";

const g = globalThis as unknown as { __barStore?: Store };

/** Instancia única del almacén por proceso. La base se inicializa con datos de ejemplo la primera vez. */
export function getStore(): Store {
  if (!g.__barStore) {
    const store = new Store(process.env.BAR_DB_FILE || DB_FILE);
    if (store.count("users") === 0) seed(store);
    g.__barStore = store;
  }
  return g.__barStore;
}

export async function getAuth() {
  const store = getStore();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = resolveSession(store, token);
  if (!session) throw new AppError("Sesión expirada o inválida. Inicie sesión nuevamente.", 401);
  // Los procesos automáticos (reservas, vencimientos) se disparan con la actividad del sistema.
  try {
    runScheduler(store);
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
