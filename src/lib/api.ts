import type { ProcInput, ProcName, ProcOutput } from "@/server/rpc";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Llamada tipada a un procedimiento del servidor. */
export async function rpc<P extends ProcName>(name: P, input?: ProcInput<P>): Promise<ProcOutput<P>> {
  let res: Response;
  try {
    res = await fetch(`/api/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {}),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Sin conexión con el servidor. Verifique la red.", 0);
  }
  const json = await res.json().catch(() => ({ error: "Respuesta inválida del servidor" }));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      // Fuera de React (sin router): recarga completa hacia el login.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(json.error ?? "Error inesperado", res.status);
  }
  return json.data as ProcOutput<P>;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: "Respuesta inválida del servidor" }));
  if (!res.ok) throw new ApiError(json.error ?? "Error inesperado", res.status);
  return json.data as T;
}
