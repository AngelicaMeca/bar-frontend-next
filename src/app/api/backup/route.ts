import fs from "node:fs";
import path from "node:path";
import { can } from "@/lib/permissions";
import { AppError, audit } from "@/server/core";
import { errorResponse, getAuth } from "@/server/app";

export const dynamic = "force-dynamic";

/** Respaldo manual de la base de datos (RNF-10). Sólo administradores. */
export async function GET() {
  try {
    const { ctx } = await getAuth();
    if (!can(ctx.user.roles, "config.gestionar")) throw new AppError("No tiene permisos para descargar respaldos", 403);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(process.cwd(), "data", "backups", `bar-${stamp}.db`);
    ctx.store.backup(file);
    ctx.store.tx(() => audit(ctx, "Respaldo de base de datos", "sistema", path.basename(file)));
    const data = new Uint8Array(fs.readFileSync(file));
    return new Response(data, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
