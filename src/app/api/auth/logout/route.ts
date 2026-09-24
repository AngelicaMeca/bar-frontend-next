import { cookies } from "next/headers";
import { errorResponse, getStore } from "@/server/app";
import { logout, SESSION_COOKIE } from "@/server/services/auth";

export async function POST() {
  try {
    const jar = await cookies();
    logout(getStore(), jar.get(SESSION_COOKIE)?.value);
    jar.delete(SESSION_COOKIE);
    return Response.json({ data: null });
  } catch (e) {
    return errorResponse(e);
  }
}
