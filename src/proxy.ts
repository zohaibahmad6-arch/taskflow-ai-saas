import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyCsrf } from "@/lib/auth";
import { env } from "@/lib/env";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Proxy (formerly middleware) always runs on the Node.js runtime, which is
// what lets this use better-sqlite3-backed session lookups directly — a
// single, real point of auth enforcement in front of both pages and API
// routes.

const PUBLIC_PATHS = new Set(["/login", "/manifest.webmanifest"]);
const PUBLIC_API_PREFIXES = ["/api/auth/login"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (pathname.startsWith("/_next") || pathname.startsWith("/icons") || pathname.startsWith("/sw.js")) {
    return true;
  }
  if (pathname === "/favicon.ico") return true;
  return false;
}

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // 'unsafe-eval' is only added outside production: React's dev mode uses
  // eval() for debugging features (better stack traces), but never in a
  // production build, so the stricter policy is safe to keep there.
  const scriptSrc = env.isProduction ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";
  res.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  );
  if (env.isProduction) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const session = await getSession();

  if (!session) {
    if (pathname.startsWith("/api")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Not authenticated." }, { status: 401 })
      );
    }
    const loginUrl = new URL("/login", req.url);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (pathname.startsWith("/api") && MUTATING_METHODS.has(req.method)) {
    const headerToken = req.headers.get("x-csrf-token");
    if (!verifyCsrf(headerToken, session.csrfSecret)) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Invalid or missing CSRF token." }, { status: 403 })
      );
    }
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
