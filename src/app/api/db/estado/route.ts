import { can } from "@/lib/permissions";
import { AppError } from "@/server/core";
import { errorResponse, getAuth } from "@/server/app";
import { postgresStatus } from "@/server/db/postgres";

export const dynamic = "force-dynamic";

/** Estado de la conexión a PostgreSQL/Supabase. Sólo administradores. */
export async function GET() {
  try {
    const { ctx } = await getAuth();
    if (!can(ctx.user.roles, "config.gestionar")) throw new AppError("No tiene permisos", 403);
    return Response.json({ data: await postgresStatus() });
  } catch (e) {
    return errorResponse(e);
  }
}
