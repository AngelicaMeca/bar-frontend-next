import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirige al login las páginas protegidas cuando no hay cookie de sesión.
 * La validación real del token y de permisos se realiza en cada llamada a la API.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("bar_session");
  if (!hasSession) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
