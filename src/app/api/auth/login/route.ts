import { cookies } from "next/headers";
import { z } from "zod";
import { errorResponse, getStore } from "@/server/app";
import { FailoverActivatedError } from "@/server/failover-store";
import { login, SESSION_COOKIE } from "@/server/services/auth";

const schema = z.object({
  identifier: z.string().trim().min(1, "Ingrese su usuario o email"),
  password: z.string().min(1, "Ingrese su contraseña"),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const store = await getStore();
    let result;
    try {
      result = await login(store, { ...input, userAgent: request.headers.get("user-agent") ?? "" });
    } catch (e) {
      if (!(e instanceof FailoverActivatedError) || !store.isFallback) throw e;
      result = await login(store, { ...input, userAgent: request.headers.get("user-agent") ?? "" });
    }
    if ("error" in result && result.error) throw result.error;
    if (!("token" in result)) throw new Error("login");
    const jar = await cookies();
    jar.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      // Cookie "secure" cuando se accede por HTTPS (en la red local del bar puede usarse HTTP).
      secure: (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) === "https",
      path: "/",
      maxAge: result.maxAge,
    });
    return Response.json(
      { data: { user: result.user } },
      { headers: { "x-bar-storage-mode": store.isFallback ? "sqlite" : "postgres" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
