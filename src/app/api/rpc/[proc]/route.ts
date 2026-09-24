import { can } from "@/lib/permissions";
import { AppError } from "@/server/core";
import { errorResponse, getAuth } from "@/server/app";
import { procedures, type ProcName } from "@/server/rpc";

/**
 * Punto de entrada único de la API. Cada procedimiento declara el permiso requerido y
 * se valida contra los roles del usuario autenticado (RF-AUT-06).
 */
export async function POST(request: Request, { params }: { params: Promise<{ proc: string }> }) {
  try {
    const { proc } = await params;
    if (!Object.hasOwn(procedures, proc)) throw new AppError("Operación inexistente", 404);
    const p = procedures[proc as ProcName];
    const { ctx, sessionId } = await getAuth();
    if (p.perm && !can(ctx.user.roles, p.perm)) throw new AppError("No tiene permisos para realizar esta acción", 403);
    const body = await request.json().catch(() => ({}));
    const input = p.schema.parse(body ?? {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (p.handler as any)(ctx, input, { sessionId });
    return Response.json({ data: result ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
