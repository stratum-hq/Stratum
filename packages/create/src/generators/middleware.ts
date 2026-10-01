import type { StackPreset } from "../matrix.js";

export interface MiddlewareFile {
  filename: string;
  content: string;
}

/**
 * Verifies the bearer token and returns its tenant_id claim. Inserted into
 * every generated server so the project needs nothing but jose. The tenant
 * never comes from the hostname or a header such as x-tenant-id: any caller
 * can choose those.
 */
const VERIFIED_TENANT = `import { jwtVerify } from "jose";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET must be set: the tenant is taken from a verified JWT.");
}
const jwtKey = new TextEncoder().encode(jwtSecret);

/**
 * The tenant for a request, from the tenant_id claim of a bearer token that
 * verifies with JWT_SECRET. tenantId is null when there is no bearer token.
 * invalid is true when a token was sent but does not verify or has no
 * tenant_id claim. Never take the tenant from the hostname or from a header
 * such as x-tenant-id: any caller can choose those.
 */
async function verifiedTenant(
  authorization: string | undefined,
): Promise<{ tenantId: string | null; invalid: boolean }> {
  if (!authorization?.startsWith("Bearer ")) return { tenantId: null, invalid: false };
  try {
    const { payload } = await jwtVerify(authorization.slice("Bearer ".length), jwtKey, {
      algorithms: ["HS256"],
    });
    if (typeof payload.tenant_id === "string") return { tenantId: payload.tenant_id, invalid: false };
  } catch {
    // Fall through: a token that does not verify is rejected, never ignored.
  }
  return { tenantId: null, invalid: true };
}`;

const INVALID_TOKEN = `{ error: "Bearer token is invalid or has no tenant_id claim" }`;
const TENANT_REQUIRED = `{ error: "A bearer token with a tenant_id claim is required" }`;

/**
 * The Next.js 16 proxy (src/proxy.ts), following examples/with-nextjs: the
 * tenant ID comes only from the tenant_id claim of a verified bearer token and
 * is forwarded as x-tenant-id. The subdomain is forwarded as x-tenant-slug,
 * never as the ID.
 */
export function nextjsTenantProxy(): string {
  return `// src/proxy.ts: Next.js proxy for Stratum tenant resolution
//
// Next.js runs the proxy only from the directory that holds the app
// directory: src/proxy.ts for src/app, proxy.ts for app. Next.js 16 runs it
// on the Node.js runtime.
//
// The tenant ID comes only from the tenant_id claim of a bearer token that
// verifies with JWT_SECRET, and is forwarded as x-tenant-id. Any copy of the
// tenant headers the client sent is removed first, so server code only ever
// reads the values set here.
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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Only this proxy may set the tenant headers.
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
`;
}

/**
 * The root layout of a generated Next.js app, src/app/layout.tsx. \`next build\`
 * refuses an app directory without one.
 */
export function nextjsRootLayout(projectName: string): string {
  return `// app/layout.tsx: ${projectName} root layout
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
}

export function generateMiddleware(projectName: string, preset: StackPreset): MiddlewareFile[] {
  switch (preset.framework) {
    case "express":
      return generateExpressMiddleware(projectName);
    case "fastify":
      return generateFastifyMiddleware(projectName);
    case "nextjs":
      return generateNextjsMiddleware(projectName);
    case "hono":
      return generateHonoMiddleware(projectName);
    case "nestjs":
      return generateNestjsMiddleware(projectName);
    case "none":
      return generateNoFramework(projectName);
  }
}

function generateExpressMiddleware(projectName: string): MiddlewareFile[] {
  return [{ filename: "src/index.ts", content: expressServer(projectName) }];
}

/**
 * src/index.ts of a generated Express server, for the express template and
 * every express preset: tenant middleware that takes the tenant from a
 * verified JWT, and a /tenants route that requires a tenant.
 */
export function expressServer(projectName: string): string {
  return `import express from "express";
${VERIFIED_TENANT}

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

// Tenant resolution. The tenant comes only from a verified bearer token;
// a token that does not verify is rejected with 401.
app.use(async (req, res, next) => {
  const { tenantId, invalid } = await verifiedTenant(req.headers.authorization);
  if (invalid) {
    res.status(401).json(${INVALID_TOKEN});
    return;
  }
  (req as any).tenantId = tenantId;
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", project: "${projectName}" });
});

app.get("/tenants", async (req, res) => {
  const tenantId = (req as any).tenantId;
  if (!tenantId) {
    res.status(401).json(${TENANT_REQUIRED});
    return;
  }
  res.json({ tenantId, message: "Replace with your tenant queries" });
});

app.listen(port, () => {
  console.log(\`${projectName} running on http://localhost:\${port}\`);
});
`;
}

function generateFastifyMiddleware(projectName: string): MiddlewareFile[] {
  return [{ filename: "src/index.ts", content: fastifyServer(projectName) }];
}

/**
 * src/index.ts of a generated Fastify server, for the fastify template and
 * every fastify preset: an onRequest hook that takes the tenant from a
 * verified JWT, and a /tenants route that requires a tenant.
 */
export function fastifyServer(projectName: string): string {
  return `import Fastify from "fastify";
${VERIFIED_TENANT}

const fastify = Fastify({ logger: true });
const port = Number(process.env.PORT) || 3000;

// Tenant resolution. The tenant comes only from a verified bearer token;
// a token that does not verify is rejected with 401.
fastify.decorateRequest("tenantId", null);
fastify.addHook("onRequest", async (request, reply) => {
  const { tenantId, invalid } = await verifiedTenant(request.headers.authorization);
  if (invalid) {
    return reply.status(401).send(${INVALID_TOKEN});
  }
  (request as any).tenantId = tenantId;
});

fastify.get("/health", async () => {
  return { status: "ok", project: "${projectName}" };
});

fastify.get("/tenants", async (request, reply) => {
  const tenantId = (request as any).tenantId;
  if (!tenantId) {
    return reply.status(401).send(${TENANT_REQUIRED});
  }
  return { tenantId, message: "Replace with your tenant queries" };
});

fastify.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
`;
}

function generateNextjsMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/proxy.ts",
      content: nextjsTenantProxy(),
    },
    {
      filename: "src/app/layout.tsx",
      content: nextjsRootLayout(projectName),
    },
    {
      filename: "src/app/page.tsx",
      content: `// app/page.tsx - ${projectName} root page
export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>${projectName}</h1>
      <p>Multi-tenant app powered by Stratum.</p>
      <ul>
        <li>Configure tenants via the Stratum control plane</li>
        <li>The tenant comes from a verified JWT in <code>src/proxy.ts</code></li>
        <li>Use <code>@stratum-hq/lib</code> for tenant resolution</li>
      </ul>
    </main>
  );
}
`,
    },
  ];
}

function generateHonoMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/index.ts",
      content: `import { Hono } from "hono";
import { serve } from "@hono/node-server";
${VERIFIED_TENANT}

const app = new Hono<{ Variables: { tenantId: string | null } }>();

// Tenant resolution. The tenant comes only from a verified bearer token;
// a token that does not verify is rejected with 401.
app.use("*", async (c, next) => {
  const { tenantId, invalid } = await verifiedTenant(c.req.header("authorization"));
  if (invalid) {
    return c.json(${INVALID_TOKEN}, 401);
  }
  c.set("tenantId", tenantId);
  await next();
});

app.get("/health", (c) => {
  return c.json({ status: "ok", project: "${projectName}" });
});

app.get("/tenants", (c) => {
  const tenantId = c.get("tenantId");
  if (!tenantId) {
    return c.json(${TENANT_REQUIRED}, 401);
  }
  return c.json({ tenantId, message: "Replace with your tenant queries" });
});

const port = Number(process.env.PORT) || 3000;
console.log(\`${projectName} running on http://localhost:\${port}\`);
serve({ fetch: app.fetch, port });
`,
    },
  ];
}

function generateNestjsMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/main.ts",
      content: `import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(\`${projectName} running on http://localhost:\${port}\`);
}
bootstrap();
`,
    },
    {
      filename: "src/app.module.ts",
      content: `import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { TenantGuard } from "./tenant.guard.js";
import { APP_GUARD } from "@nestjs/core";

@Module({
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
`,
    },
    {
      filename: "src/app.controller.ts",
      content: `import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";

@Controller()
export class AppController {
  @Get("health")
  health() {
    return { status: "ok", project: "${projectName}" };
  }

  @Get("tenants")
  tenants(@Req() req: any) {
    if (!req.tenantId) {
      throw new UnauthorizedException("A bearer token with a tenant_id claim is required");
    }
    return { tenantId: req.tenantId, message: "Replace with your tenant queries" };
  }
}
`,
    },
    {
      filename: "src/tenant.guard.ts",
      content: `import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
${VERIFIED_TENANT}

/**
 * Sets request.tenantId from a verified bearer token, or null when there is
 * no token. A token that does not verify is rejected with 401.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { tenantId, invalid } = await verifiedTenant(request.headers?.authorization);
    if (invalid) {
      throw new UnauthorizedException("Bearer token is invalid or has no tenant_id claim");
    }
    request.tenantId = tenantId;
    return true;
  }
}
`,
    },
  ];
}

function generateNoFramework(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/index.ts",
      content: `// ${projectName} - Stratum multi-tenant setup (no framework)
// Use this as a starting point and integrate with your framework of choice.

console.log("${projectName} initialized");
console.log("Import your database setup from ./stratum-db or equivalent");
console.log("Add tenant resolution logic for your use case");
`,
    },
  ];
}
