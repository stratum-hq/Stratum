/**
 * Next.js proxy: tenant resolution
 *
 * Runs before any page or API route. Resolves the tenant from:
 *   1. Bearer token: the verified `tenant_id` claim of an HS256 JWT
 *   2. Subdomain: e.g. acme.app.example.com → tenant slug "acme"
 *
 * The proxy forwards the result to Server Components as a request
 * header (see src/lib/tenant-headers.ts). It deletes any client-sent copy of
 * those headers first, so a client cannot choose its tenant with a header.
 *
 * A subdomain only selects which tenant's public page to show. It does not
 * prove that the caller belongs to that tenant. Use the token for that.
 */
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from "./lib/tenant-headers";

/**
 * Returns the `tenant_id` claim of a token that verifies with JWT_SECRET, or
 * null when the token is invalid, expired, or has no string tenant_id claim.
 */
async function verifiedTenantId(token: string): Promise<string | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required to verify bearer tokens.");
  }
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    return typeof payload.tenant_id === "string" ? payload.tenant_id : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Skip static assets and Next.js internals.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/health"
  ) {
    return NextResponse.next();
  }

  // Only this proxy may set the tenant headers.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TENANT_ID_HEADER);
  requestHeaders.delete(TENANT_SLUG_HEADER);

  // 1. Bearer token (API clients, signed-in sessions).
  //    A token that does not verify is rejected, never ignored.
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const tenantId = await verifiedTenantId(authorization.slice("Bearer ".length));
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: "INVALID_TOKEN", message: "Bearer token is invalid or has no tenant_id claim" } },
        { status: 401 },
      );
    }
    requestHeaders.set(TENANT_ID_HEADER, tenantId);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // 2. Subdomain, e.g. "acme" from "acme.app.example.com".
  //    Strip port for local dev (localhost:3000 has no meaningful subdomain).
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  const rootDomain = process.env.ROOT_DOMAIN ?? "app.example.com";

  if (hostname.endsWith(`.${rootDomain}`)) {
    const subdomain = hostname.slice(0, hostname.length - rootDomain.length - 1);
    if (subdomain && subdomain !== "www") {
      // The page resolves the slug to a tenant ID from the database.
      requestHeaders.set(TENANT_SLUG_HEADER, subdomain);
    }
  }

  // With no tenant resolved, the request continues. Each route decides
  // whether to require a tenant or serve a landing page.
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Match all routes except static files.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
