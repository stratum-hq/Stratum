import * as fs from "fs";
import * as path from "path";
import crypto from "node:crypto";
import { select, confirm } from "../utils/prompt.js";
import * as log from "../utils/log.js";

interface ProjectInfo {
  framework: string;
  integrationPath: "lib" | "sdk";
  database: string;
  orm: string;
  hasReact: boolean;
}

function detectFramework(cwd: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["next"]) return "nextjs";
    if (allDeps["fastify"]) return "fastify";
    if (allDeps["express"]) return "express";
    if (allDeps["hono"]) return "hono";
    if (allDeps["koa"]) return "koa";
  } catch {
    // no package.json
  }
  return null;
}

function detectOrm(cwd: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["prisma"] || allDeps["@prisma/client"]) return "prisma";
    if (allDeps["drizzle-orm"]) return "drizzle";
    if (allDeps["knex"]) return "knex";
    if (allDeps["typeorm"]) return "typeorm";
    if (allDeps["pg"]) return "pg";
  } catch {
    // no package.json
  }
  return null;
}

function detectReact(cwd: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    return !!allDeps["react"];
  } catch {
    return false;
  }
}

export async function init(flags: Record<string, string | boolean>): Promise<void> {
  const cwd = process.cwd();

  log.heading("Stratum Init");
  log.info("Setting up Stratum in your existing project.\n");

  // 1. Detect or ask framework
  const detected = detectFramework(cwd);
  let framework: string;
  if (detected) {
    log.success(`Detected framework: ${detected}`);
    const useDetected = await confirm(`Use ${detected}?`);
    if (useDetected) {
      framework = detected;
    } else {
      const idx = await select("Select your framework:", [
        "Express", "Fastify", "Next.js", "Hono", "Koa", "Other / None",
      ]);
      framework = ["express", "fastify", "nextjs", "hono", "koa", "other"][idx];
    }
  } else {
    const idx = await select("Select your framework:", [
      "Express", "Fastify", "Next.js", "Hono", "Koa", "Other / None",
    ]);
    framework = ["express", "fastify", "nextjs", "hono", "koa", "other"][idx];
  }

  // 2. Integration path
  const pathIdx = await select("Integration path:", [
    "Direct library (@stratum-hq/lib) — in-process, max performance",
    "HTTP API + SDK (@stratum-hq/sdk) — service separation, polyglot",
  ]);
  const integrationPath: "lib" | "sdk" = pathIdx === 0 ? "lib" : "sdk";

  // 3. Database / ORM
  const detectedOrm = detectOrm(cwd);
  let orm: string;
  if (detectedOrm) {
    log.success(`Detected ORM/driver: ${detectedOrm}`);
    orm = detectedOrm;
  } else {
    const ormIdx = await select("Database access:", [
      "pg (node-postgres) — raw SQL",
      "Prisma",
      "Drizzle",
      "Other",
    ]);
    orm = ["pg", "prisma", "drizzle", "other"][ormIdx];
  }

  // 4. React detection
  const hasReact = detectReact(cwd);
  if (hasReact) {
    log.success("Detected React — will include frontend scaffolding");
  }

  const info: ProjectInfo = {
    framework,
    integrationPath,
    database: "postgres",
    orm,
    hasReact,
  };

  console.log();
  log.heading("Configuration Summary");
  log.info(`Framework:    ${info.framework}`);
  log.info(`Integration:  ${info.integrationPath === "lib" ? "@stratum-hq/lib (direct)" : "@stratum-hq/sdk (HTTP)"}`);
  log.info(`Database:     ${info.orm}`);
  log.info(`React:        ${info.hasReact ? "yes" : "no"}`);
  console.log();

  const proceed = await confirm("Generate scaffolding files?");
  if (!proceed) {
    log.info("Cancelled.");
    return;
  }

  // 5. Generate files
  const outDir = typeof flags["out"] === "string" ? flags["out"] : cwd;
  const force = !!flags["force"];

  generateEnvFile(outDir, info, force);
  generateConfigFile(outDir, info, force);
  generateMiddleware(outDir, info, force);
  generateDbSetup(outDir, info, force);

  if (info.hasReact) {
    generateReactSetup(outDir, info, force);
  }

  // 6. Print install instructions
  console.log();
  log.heading("Next Steps");

  const packages: string[] = ["@stratum-hq/core"];
  if (info.integrationPath === "lib") {
    packages.push("@stratum-hq/lib", "pg");
  } else {
    packages.push("@stratum-hq/sdk");
  }
  if (info.orm === "prisma") {
    packages.push("@stratum-hq/db-adapters");
  } else if (info.orm === "pg") {
    packages.push("@stratum-hq/db-adapters");
  }
  if (info.hasReact) {
    packages.push("@stratum-hq/react");
  }

  log.info(`1. Install packages:`);
  log.dim(`   npm install ${packages.join(" ")}`);
  console.log();
  log.info(`2. Set up your database:`);
  log.dim(`   stratum health`);
  log.dim(`   stratum migrate --scan`);
  console.log();
  log.info(`3. Check the generated files and integrate into your app.`);
  console.log();
}

function writeFile(filePath: string, content: string, force: boolean): void {
  if (fs.existsSync(filePath) && !force) {
    log.warn(`Skipped ${path.basename(filePath)} (already exists, use --force to overwrite)`);
    return;
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf8");
  log.success(`Created ${path.relative(process.cwd(), filePath)}`);
}

function generateEnvFile(outDir: string, _info: ProjectInfo, force: boolean): void {
  void _info;
  const jwtSecret = crypto.randomBytes(32).toString("base64url");
  const content = `# Stratum Configuration
DATABASE_URL=postgres://stratum:stratum_dev@localhost:5432/stratum
JWT_SECRET=${jwtSecret}
NODE_ENV=development

# Control Plane (if using @stratum-hq/sdk)
STRATUM_URL=http://localhost:3001
STRATUM_API_KEY=sk_test_your_key_here

# Optional
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3300
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute
`;
  writeFile(path.join(outDir, ".env.stratum"), content, force);
}

function generateConfigFile(outDir: string, info: ProjectInfo, force: boolean): void {
  const content = `// stratum.config.ts
// Stratum configuration for your project

export const stratumConfig = {
  // Integration path: "lib" (direct) or "sdk" (HTTP)
  integration: "${info.integrationPath}" as const,

  // Database
  databaseUrl: process.env.DATABASE_URL || "postgres://stratum:stratum_dev@localhost:5432/stratum",

  // Control plane (only needed for SDK integration)
  controlPlaneUrl: process.env.STRATUM_URL || "http://localhost:3001",
  apiKey: process.env.STRATUM_API_KEY || "",

  // Cache settings (SDK only)
  cache: {
    enabled: true,
    ttlMs: 60_000,
    maxSize: 100,
  },

  // Tenant resolution
  tenant: {
    headerName: "X-Tenant-ID",
    jwtClaimPath: "tenant_id",
  },
};
`;
  writeFile(path.join(outDir, "stratum.config.ts"), content, force);
}

function generateMiddleware(outDir: string, info: ProjectInfo, force: boolean): void {
  if (info.framework === "express") {
    if (info.integrationPath === "sdk") {
      const content = `// stratum-middleware.ts
// Express middleware for Stratum tenant resolution

import { StratumClient, expressMiddleware } from "@stratum-hq/sdk";
import { stratumConfig } from "./stratum.config";

export const stratumClient = new StratumClient({
  controlPlaneUrl: stratumConfig.controlPlaneUrl,
  apiKey: stratumConfig.apiKey,
  cache: stratumConfig.cache,
});

export const tenantMiddleware = expressMiddleware(stratumClient, {
  jwtClaimPath: stratumConfig.tenant.jwtClaimPath,
  headerName: stratumConfig.tenant.headerName,
  jwtSecret: process.env.JWT_SECRET,
});

// Usage in your app:
// import { tenantMiddleware } from "./stratum-middleware";
// app.use(tenantMiddleware);
//
// In route handlers:
// app.get("/data", (req, res) => {
//   const { tenant_id, resolved_config, resolved_permissions } = req.tenant;
//   res.json({ tenant_id });
// });
`;
      writeFile(path.join(outDir, "stratum-middleware.ts"), content, force);
    } else {
      const content = `// stratum-middleware.ts
// Express middleware for Stratum tenant resolution (direct library)

import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";
import type { Request, Response, NextFunction } from "express";
import { stratumConfig } from "./stratum.config";

const pool = new Pool({ connectionString: stratumConfig.databaseUrl });
export const stratum = new Stratum({ pool });

// Simple tenant resolution middleware
export function tenantMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Extract tenant ID from header, JWT, or custom logic
  const tenantId = req.headers["x-tenant-id"] as string | undefined;

  if (tenantId) {
    (req as any).tenantId = tenantId;
  }

  next();
}

// Helper to get resolved context in route handlers
export async function getTenantContext(tenantId: string) {
  const [config, permissions] = await Promise.all([
    stratum.resolveConfig(tenantId),
    stratum.resolvePermissions(tenantId),
  ]);
  return { tenant_id: tenantId, resolved_config: config, resolved_permissions: permissions };
}

// Usage:
// import { tenantMiddleware, stratum, getTenantContext } from "./stratum-middleware";
// app.use(tenantMiddleware);
//
// app.get("/data", async (req, res) => {
//   const ctx = await getTenantContext(req.tenantId);
//   res.json(ctx.resolved_config);
// });

// Cleanup on shutdown
process.on("SIGTERM", () => pool.end());
`;
      writeFile(path.join(outDir, "stratum-middleware.ts"), content, force);
    }
  } else if (info.framework === "fastify") {
    if (info.integrationPath === "sdk") {
      const content = `// stratum-plugin.ts
// Fastify plugin for Stratum tenant resolution

import { StratumClient, fastifyPlugin } from "@stratum-hq/sdk";
import { stratumConfig } from "./stratum.config";

export const stratumClient = new StratumClient({
  controlPlaneUrl: stratumConfig.controlPlaneUrl,
  apiKey: stratumConfig.apiKey,
  cache: stratumConfig.cache,
});

// Usage:
// import { fastifyPlugin } from "@stratum-hq/sdk";
// import { stratumClient } from "./stratum-plugin";
//
// app.register(fastifyPlugin, {
//   client: stratumClient,
//   jwtClaimPath: "tenant_id",
//   jwtSecret: process.env.JWT_SECRET,
// });
//
// app.get("/data", (request, reply) => {
//   const { tenant_id, resolved_config } = request.tenant;
//   reply.send({ tenant_id });
// });

export { fastifyPlugin };
`;
      writeFile(path.join(outDir, "stratum-plugin.ts"), content, force);
    } else {
      const content = `// stratum-plugin.ts
// Fastify plugin for Stratum tenant resolution (direct library)

import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { stratumConfig } from "./stratum.config";

const pool = new Pool({ connectionString: stratumConfig.databaseUrl });
export const stratum = new Stratum({ pool });

export async function stratumPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("tenantId", "");

  app.addHook("preHandler", async (request: FastifyRequest, _reply: FastifyReply) => {
    const tenantId = request.headers["x-tenant-id"] as string | undefined;
    if (tenantId) {
      (request as any).tenantId = tenantId;
    }
  });
}

// Helper
export async function getTenantContext(tenantId: string) {
  const [config, permissions] = await Promise.all([
    stratum.resolveConfig(tenantId),
    stratum.resolvePermissions(tenantId),
  ]);
  return { tenant_id: tenantId, resolved_config: config, resolved_permissions: permissions };
}

// Usage:
// import { stratumPlugin, stratum, getTenantContext } from "./stratum-plugin";
// app.register(stratumPlugin);
//
// app.get("/data", async (request, reply) => {
//   const ctx = await getTenantContext(request.tenantId);
//   reply.send(ctx);
// });

process.on("SIGTERM", () => pool.end());
`;
      writeFile(path.join(outDir, "stratum-plugin.ts"), content, force);
    }
  } else if (info.framework === "nextjs") {
    // Next.js middleware for tenant resolution from subdomain/header
    const middlewareContent = `// middleware.ts (place in project root)
// Next.js middleware for Stratum tenant resolution

import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  // Strategy 1: Subdomain-based tenant resolution
  const hostname = request.headers.get("host") || "";
  const subdomain = hostname.split(".")[0];

  // Strategy 2: Header-based
  const headerTenantId = request.headers.get("x-tenant-id");

  // Strategy 3: Path-based (e.g., /tenant/acme/dashboard)
  const pathTenantId = request.nextUrl.pathname.match(/^\\/tenant\\/([^/]+)/)?.[1];

  const tenantId = headerTenantId || pathTenantId || subdomain;

  // Forward tenant ID to API routes and server components
  const requestHeaders = new Headers(request.headers);
  if (tenantId && tenantId !== "localhost" && tenantId !== "www") {
    requestHeaders.set("x-tenant-id", tenantId);
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
`;
    writeFile(path.join(outDir, "middleware.ts"), middlewareContent, force);

    // Next.js API route helper
    const apiHelperContent = `// lib/stratum.ts
// Stratum helpers for Next.js API routes and server components

${info.integrationPath === "lib"
  ? `import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const stratum = new Stratum({ pool });

export async function getTenantFromHeaders(headers: Headers) {
  const tenantId = headers.get("x-tenant-id");
  if (!tenantId) return null;

  const [config, permissions] = await Promise.all([
    stratum.resolveConfig(tenantId),
    stratum.resolvePermissions(tenantId),
  ]);

  return { tenant_id: tenantId, resolved_config: config, resolved_permissions: permissions };
}`
  : `import { StratumClient } from "@stratum-hq/sdk";

export const stratumClient = new StratumClient({
  controlPlaneUrl: process.env.STRATUM_URL || "http://localhost:3001",
  apiKey: process.env.STRATUM_API_KEY || "",
});

export async function getTenantFromHeaders(headers: Headers) {
  const tenantId = headers.get("x-tenant-id");
  if (!tenantId) return null;

  return stratumClient.resolveTenant(tenantId);
}`}

// Usage in API routes:
// import { getTenantFromHeaders } from "@/lib/stratum";
//
// export async function GET(request: Request) {
//   const tenant = await getTenantFromHeaders(request.headers);
//   if (!tenant) return new Response("Missing tenant", { status: 400 });
//   return Response.json({ tenant_id: tenant.tenant_id });
// }

// Usage in Server Components:
// import { headers } from "next/headers";
// import { getTenantFromHeaders } from "@/lib/stratum";
//
// export default async function Page() {
//   const headerList = await headers();
//   const tenant = await getTenantFromHeaders(headerList);
//   return <div>Tenant: {tenant?.tenant_id}</div>;
// }
`;
    writeFile(path.join(outDir, "lib/stratum.ts"), apiHelperContent, force);
  } else {
    // Generic middleware for other frameworks
    const content = `// stratum-setup.ts
// Stratum setup for your application

${info.integrationPath === "lib"
  ? `import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://stratum:stratum_dev@localhost:5432/stratum",
});

export const stratum = new Stratum({ pool });

// Resolve tenant context
export async function getTenantContext(tenantId: string) {
  const [config, permissions] = await Promise.all([
    stratum.resolveConfig(tenantId),
    stratum.resolvePermissions(tenantId),
  ]);
  return { tenant_id: tenantId, resolved_config: config, resolved_permissions: permissions };
}

// Cleanup on shutdown
process.on("SIGTERM", () => pool.end());`
  : `import { StratumClient } from "@stratum-hq/sdk";

export const stratumClient = new StratumClient({
  controlPlaneUrl: process.env.STRATUM_URL || "http://localhost:3001",
  apiKey: process.env.STRATUM_API_KEY || "",
});

// Resolve tenant context
export async function getTenantContext(tenantId: string) {
  return stratumClient.resolveTenant(tenantId);
}`}

// Usage:
// import { getTenantContext } from "./stratum-setup";
// const ctx = await getTenantContext(tenantId);
// console.log(ctx.resolved_config);
`;
    writeFile(path.join(outDir, "stratum-setup.ts"), content, force);
  }
}

function generateDbSetup(outDir: string, info: ProjectInfo, force: boolean): void {
  if (info.orm === "prisma") {
    const content = `// stratum-prisma.ts
// Prisma client with Stratum tenant-scoped queries

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { withTenant } from "@stratum-hq/db-adapters";
${info.integrationPath === "sdk"
  ? `import { getTenantContext } from "@stratum-hq/sdk";`
  : ``}

const prisma = new PrismaClient();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create a tenant-scoped Prisma client
// All queries through this client are automatically filtered by RLS
export function createTenantPrisma(getTenantId: () => string) {
  return withTenant(prisma, getTenantId, pool);
}

${info.integrationPath === "sdk"
  ? `// With SDK middleware (req.tenant is available):
// const tenantPrisma = createTenantPrisma(() => getTenantContext().tenant_id);
// const orders = await tenantPrisma.order.findMany();`
  : `// With direct tenant ID:
// const tenantPrisma = createTenantPrisma(() => currentTenantId);
// const orders = await tenantPrisma.order.findMany();`}

export { prisma, pool };
`;
    writeFile(path.join(outDir, "stratum-prisma.ts"), content, force);
  } else if (info.orm === "pg") {
    const content = `// stratum-db.ts
// PostgreSQL client with Stratum tenant-scoped queries

import { Pool } from "pg";
import { createTenantPool } from "@stratum-hq/db-adapters";
${info.integrationPath === "sdk"
  ? `import { getTenantContext } from "@stratum-hq/sdk";`
  : ``}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://stratum:stratum_dev@localhost:5432/stratum",
});

${info.integrationPath === "sdk"
  ? `// Automatically scoped to current tenant via SDK context
export const tenantPool = createTenantPool(pool, () => getTenantContext().tenant_id);`
  : `// Pass a function that returns the current tenant ID
// You need to provide this based on your app's context mechanism
export function createScopedPool(getTenantId: () => string) {
  return createTenantPool(pool, getTenantId);
}`}

// Usage:
// const result = await tenantPool.query("SELECT * FROM orders");
// RLS automatically filters to the current tenant — no WHERE clause needed

export { pool };
`;
    writeFile(path.join(outDir, "stratum-db.ts"), content, force);
  }
}

function generateReactSetup(outDir: string, _info: ProjectInfo, force: boolean): void {
  const providerContent = `// stratum-provider.tsx
// Stratum React provider for your application

import React from "react";
import { StratumProvider, useStratum } from "@stratum-hq/react";

interface AppProviderProps {
  children: React.ReactNode;
}

export function AppStratumProvider({ children }: AppProviderProps) {
  return (
    <StratumProvider
      controlPlaneUrl={process.env.NEXT_PUBLIC_STRATUM_URL || process.env.REACT_APP_STRATUM_URL || "http://localhost:3001"}
      apiKey={process.env.NEXT_PUBLIC_STRATUM_API_KEY || process.env.REACT_APP_STRATUM_API_KEY || ""}
    >
      {children}
    </StratumProvider>
  );
}

// Usage:
// import { AppStratumProvider } from "./stratum-provider";
//
// function App() {
//   return (
//     <AppStratumProvider>
//       <YourApp />
//     </AppStratumProvider>
//   );
// }

export { useStratum };
`;

  const guardContent = `// tenant-guard.tsx
// Conditional rendering based on tenant permissions and config

import React from "react";
import { useStratum } from "@stratum-hq/react";

interface PermissionGuardProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Renders children only if the current tenant has the specified permission.
 *
 * <PermissionGuard permission="manage_users">
 *   <AdminPanel />
 * </PermissionGuard>
 */
export function PermissionGuard({ permission, children, fallback = null }: PermissionGuardProps) {
  const { tenantContext, loading } = useStratum();

  if (loading) return null;
  if (!tenantContext) return <>{fallback}</>;

  const perm = tenantContext.resolved_permissions[permission];
  if (!perm || perm.value !== true) return <>{fallback}</>;

  return <>{children}</>;
}

interface ConfigGuardProps {
  configKey: string;
  value?: unknown;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Renders children only if the current tenant's config matches.
 *
 * <ConfigGuard configKey="features.siem" value={true}>
 *   <SiemDashboard />
 * </ConfigGuard>
 *
 * <ConfigGuard configKey="features.edr">
 *   <EdrPanel />  // Renders if features.edr is truthy
 * </ConfigGuard>
 */
export function ConfigGuard({ configKey, value, children, fallback = null }: ConfigGuardProps) {
  const { tenantContext, loading } = useStratum();

  if (loading) return null;
  if (!tenantContext) return <>{fallback}</>;

  const configEntry = tenantContext.resolved_config[configKey];
  if (configEntry === undefined) return <>{fallback}</>;

  // If a specific value is provided, check for exact match
  // Otherwise, check for truthiness
  const entryValue = typeof configEntry === "object" && configEntry !== null && "value" in configEntry
    ? (configEntry as any).value
    : configEntry;

  if (value !== undefined) {
    if (entryValue !== value) return <>{fallback}</>;
  } else {
    if (!entryValue) return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface TenantInfoProps {
  field: "name" | "slug" | "id" | "depth" | "isolation_strategy";
}

/**
 * Displays a field from the current tenant.
 *
 * <TenantInfo field="name" />  // Renders: "Acme Corp"
 */
export function TenantInfo({ field }: TenantInfoProps) {
  const { currentTenant } = useStratum();
  if (!currentTenant) return null;
  return <>{String(currentTenant[field] ?? "")}</>;
}
`;

  const hooksContent = `// use-tenant.ts
// Custom hooks for common Stratum patterns

import { useStratum } from "@stratum-hq/react";

/**
 * Returns true if the current tenant has the specified permission.
 * Returns false during loading or if no tenant is selected.
 */
export function usePermission(key: string): boolean {
  const { tenantContext, loading } = useStratum();
  if (loading || !tenantContext) return false;
  const perm = tenantContext.resolved_permissions[key];
  return perm?.value === true;
}

/**
 * Returns the resolved value for a config key.
 * Returns the defaultValue during loading or if the key doesn't exist.
 */
export function useConfig<T = unknown>(key: string, defaultValue?: T): T | undefined {
  const { tenantContext, loading } = useStratum();
  if (loading || !tenantContext) return defaultValue;
  const entry = tenantContext.resolved_config[key];
  if (entry === undefined) return defaultValue;
  const value = typeof entry === "object" && entry !== null && "value" in entry
    ? (entry as any).value
    : entry;
  return value as T;
}

/**
 * Returns the current tenant's depth in the hierarchy.
 * Useful for conditional rendering based on tenant level.
 * (0 = root, 1 = first child, etc.)
 */
export function useTenantDepth(): number | null {
  const { currentTenant } = useStratum();
  return currentTenant?.depth ?? null;
}

/**
 * Returns true if the current tenant is at the root level (depth 0).
 */
export function useIsRootTenant(): boolean {
  const { currentTenant } = useStratum();
  return currentTenant?.depth === 0;
}
`;

  writeFile(path.join(outDir, "stratum-provider.tsx"), providerContent, force);
  writeFile(path.join(outDir, "tenant-guard.tsx"), guardContent, force);
  writeFile(path.join(outDir, "use-tenant.ts"), hooksContent, force);
}
