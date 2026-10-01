import * as fs from "fs";
import * as path from "path";

/**
 * The directory that holds a Next.js project's app (or pages) directory. Next.js
 * reads middleware and the app directory only from there: the project root
 * when it has app/ or pages/, else src/ when it has src/app or src/pages.
 */
export function nextjsAppRoot(dir: string): string {
  const has = (...parts: string[]) => fs.existsSync(path.join(dir, ...parts));
  if (has("app") || has("pages")) return dir;
  if (has("src", "app") || has("src", "pages")) return path.join(dir, "src");
  return dir;
}

/**
 * The Next.js middleware that `stratum init` and `stratum scaffold nextjs`
 * generate. It follows examples/with-nextjs: the tenant ID comes only from
 * the tenant_id claim of a bearer token that verifies with JWT_SECRET. The
 * subdomain is forwarded as a slug for display, never as the tenant ID.
 */
export function nextjsMiddleware(): string {
  return `// middleware.ts: place it next to your app directory (src/middleware.ts for src/app)
// Next.js middleware for Stratum tenant resolution
//
// The tenant ID comes only from the tenant_id claim of a bearer token that
// verifies with JWT_SECRET, and is forwarded as x-tenant-id. Any copy of the
// tenant headers the client sent is removed first, so lib/stratum.ts only
// ever reads the values set here.
//
// The subdomain (acme.app.example.com) is forwarded as x-tenant-slug. It only
// says which tenant's public pages to show. It does not prove the caller
// belongs to that tenant, so never use it to read or write tenant data.

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const TENANT_ID_HEADER = "x-tenant-id";
const TENANT_SLUG_HEADER = "x-tenant-slug";

/**
 * The tenant_id claim of a token that verifies with JWT_SECRET, or null when
 * the token is invalid, expired, or has no string tenant_id claim.
 */
async function verifiedTenantId(token: string): Promise<string | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be set: the tenant is taken from a verified JWT.");
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

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Only this middleware may set the tenant headers.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-tenant-id");
  requestHeaders.delete(TENANT_SLUG_HEADER);

  // A bearer token that does not verify is rejected, never ignored.
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
  }

  // Subdomain, e.g. "acme" from "acme.app.example.com": a slug, not an identity.
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const rootDomain = process.env.ROOT_DOMAIN ?? "app.example.com";
  if (hostname.endsWith(\`.\${rootDomain}\`)) {
    const subdomain = hostname.slice(0, hostname.length - rootDomain.length - 1);
    if (subdomain && subdomain !== "www") {
      requestHeaders.set(TENANT_SLUG_HEADER, subdomain);
    }
  }

  // With no verified tenant the request continues without x-tenant-id. Each
  // route decides whether to require a tenant or serve a public page.
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
`;
}
