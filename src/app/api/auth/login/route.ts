import { cookies } from "next/headers";
import { z } from "zod";
import { errorResponse, getStore } from "@/server/app";
import { login, SESSION_COOKIE } from "@/server/services/auth";

const schema = z.object({
  identifier: z.string().trim().min(1, "Ingrese su usuario o email"),
  password: z.string().min(1, "Ingrese su contraseña"),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const result = login(getStore(), { ...input, userAgent: request.headers.get("user-agent") ?? "" });
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
    return Response.json({ data: { user: result.user } });
  } catch (e) {
    return errorResponse(e);
  }
}
