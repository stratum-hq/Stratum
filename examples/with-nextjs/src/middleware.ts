/**
 * Next.js Edge Middleware — tenant resolution
 *
 * Runs at the edge before any page or API route. Resolves the tenant from:
 *   1. Subdomain  — e.g. acme.app.example.com → tenant slug "acme"
 *   2. Header     — X-Tenant-ID (useful for internal/API requests)
 *
 * The resolved tenant ID is forwarded as an x-tenant-id header so that
 * Server Components and API routes can read it without re-parsing the host.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Skip static assets and Next.js internals.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/health"
  ) {
    return NextResponse.next();
  }

  // 1. Try X-Tenant-ID header first (API clients, internal services).
  const headerTenantId = request.headers.get("x-tenant-id");
  if (headerTenantId) {
    const response = NextResponse.next();
    response.headers.set("x-tenant-id", headerTenantId);
    return response;
  }

  // 2. Try subdomain — e.g. "acme" from "acme.app.example.com".
  //    Strip port for local dev (localhost:3000 has no meaningful subdomain).
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  const rootDomain = process.env.ROOT_DOMAIN ?? "app.example.com";

  if (hostname.endsWith(`.${rootDomain}`)) {
    const subdomain = hostname.slice(0, hostname.length - rootDomain.length - 1);
    if (subdomain && subdomain !== "www") {
      // Forward slug as x-tenant-slug; the page/API resolves ID from DB.
      const response = NextResponse.next();
      response.headers.set("x-tenant-slug", subdomain);
      return response;
    }
  }

  // No tenant resolved — allow the request through; individual routes
  // can decide whether to require a tenant or serve a landing page.
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
