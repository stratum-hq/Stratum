import * as fs from "fs";
import * as path from "path";
import * as log from "./log.js";

/** The file that runs the tenant check: proxy.ts on Next.js 16 and later, middleware.ts before. */
export type NextjsTenantFile = "proxy.ts" | "middleware.ts";

/**
 * The directory that holds a Next.js project's app (or pages) directory. Next.js
 * reads the proxy (or middleware) and the app directory only from there: the
 * project root when it has app/ or pages/, else src/ when it has src/app or
 * src/pages.
 */
export function nextjsAppRoot(dir: string): string {
  const has = (...parts: string[]) => fs.existsSync(path.join(dir, ...parts));
  if (has("app") || has("pages")) return dir;
  if (has("src", "app") || has("src", "pages")) return path.join(dir, "src");
  return dir;
}

/**
 * The major version of Next.js in a project, or null when it cannot be read.
 * The installed package wins over the range in package.json, because the
 * installed version is the one that runs.
 *
 * @param projectDir - The directory that holds the project's package.json.
 */
export function nextjsMajorVersion(projectDir: string): number | null {
  const readJson = (...parts: string[]): Record<string, unknown> | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(projectDir, ...parts), "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const installed = readJson("node_modules", "next", "package.json")?.version;
  if (typeof installed === "string") {
    const match = /^(\d+)\./.exec(installed);
    if (match) return Number(match[1]);
  }
  const pkg = readJson("package.json");
  const deps = { ...(pkg?.devDependencies as object), ...(pkg?.dependencies as object) } as Record<string, unknown>;
  const declared = deps["next"];
  if (typeof declared !== "string") return null;
  // "^16.3.8", "~15.5", "16.x", ">=15": the first number is the lowest major.
  // Tags such as "latest" and "canary" name no version.
  const match = /^\s*(?:\^|~|>=|=)?\s*v?(\d+)(?:[.\s]|$)/.exec(declared);
  return match ? Number(match[1]) : null;
}

/**
 * The Next.js file that `stratum init` and `stratum scaffold nextjs`
 * generate. It follows examples/with-nextjs: the tenant ID comes only from
 * the tenant_id claim of a bearer token that verifies with JWT_SECRET. The
 * subdomain is forwarded as a slug for display, never as the tenant ID.
 *
 * @param file - proxy.ts exports `proxy`, which Next.js 16 and later run.
 *   middleware.ts exports `middleware`, which Next.js 15 and 16 both run.
 */
export function nextjsMiddleware(file: NextjsTenantFile = "middleware.ts"): string {
  const kind = file === "proxy.ts" ? "proxy" : "middleware";
  return `// ${kind}.ts: place it next to your app directory (src/${kind}.ts for src/app)
// Next.js ${kind} for Stratum tenant resolution
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

export async function ${kind}(request: NextRequest): Promise<NextResponse> {
  // Only this ${kind} may set the tenant headers.
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

/**
 * Writes the tenant file for the project's Next.js version next to the app
 * directory. Returns the path written, or null when the file was skipped.
 *
 * Next.js 16 refuses to build a project that has both proxy.ts and
 * middleware.ts, and Next.js 15 ignores proxy.ts. So the file is never
 * written next to the other one, even with --force.
 *
 * @param versionDir - The directory whose node_modules and package.json give the Next.js version.
 * @param outDir - The project directory to write into.
 * @param force - Passed to `write`: overwrite the file when it exists.
 * @param write - The command's file writer.
 */
export function writeNextjsTenantFile(
  versionDir: string,
  outDir: string,
  force: boolean,
  write: (filePath: string, content: string, force: boolean) => void,
): string | null {
  const major = nextjsMajorVersion(versionDir);
  const file: NextjsTenantFile = major !== null && major >= 16 ? "proxy.ts" : "middleware.ts";
  const other: NextjsTenantFile = file === "proxy.ts" ? "middleware.ts" : "proxy.ts";
  const appRoot = nextjsAppRoot(outDir);
  const otherPath = path.join(appRoot, other);
  if (fs.existsSync(otherPath)) {
    log.warn(
      `Skipped ${file}: ${path.relative(process.cwd(), otherPath)} already exists. ` +
        "Next.js 16 refuses a project that has both files, and Next.js 15 ignores proxy.ts. " +
        `Add the Stratum tenant check to ${other} yourself.`,
    );
    return null;
  }
  if (major === null) {
    log.info(
      "The Next.js version is unknown, so Stratum wrote middleware.ts, which Next.js 15 and 16 both run. " +
        "On Next.js 16, rename it to proxy.ts with: npx @next/codemod@canary middleware-to-proxy .",
    );
  }
  const filePath = path.join(appRoot, file);
  write(filePath, nextjsMiddleware(file), force);
  return filePath;
}
