import { z } from "zod";
import { errorResponse, getStore } from "@/server/app";
import { requestPasswordReset } from "@/server/services/auth";

const schema = z.object({ identifier: z.string().trim().min(3, "Ingrese su usuario o email") });

/** Solicitud de recuperación: siempre responde lo mismo para no revelar si el usuario existe. */
export async function POST(request: Request) {
  try {
    const { identifier } = schema.parse(await request.json());
    requestPasswordReset(getStore(), identifier);
    return Response.json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e);
  }
}
