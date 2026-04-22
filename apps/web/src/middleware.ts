import { NextResponse, type NextRequest } from "next/server";

/**
 * Attaches the current pathname (+ search) as a request header so server
 * components (e.g. the (app) layout's auth guard) can preserve the user's
 * intent across a sign-in redirect.
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname, search } = request.nextUrl;
  requestHeaders.set("x-pathname", `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Skip static assets, images, favicon, and next internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
