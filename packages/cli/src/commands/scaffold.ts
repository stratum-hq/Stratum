import * as fs from "fs";
import * as path from "path";
import crypto from "node:crypto";
import * as log from "../utils/log.js";
import { databaseEnvLines, secretEnvLines } from "../utils/env-template.js";
import { expressProxy, nextjsProxyRoute } from "../utils/proxy-templates.js";
import { nextjsAppRoot, nextjsMiddleware } from "../utils/nextjs-middleware-template.js";

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

export async function scaffold(
  args: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const template = args[0];
  const outDir = typeof flags["out"] === "string" ? flags["out"] : process.cwd();
  const force = !!flags["force"];

  if (!template) {
    console.error("Usage: stratum scaffold <template>");
    console.error("");
    console.error("Templates: express, fastify, nextjs, react, prisma, docker, env");
    process.exit(1);
  }

  log.heading(`Scaffold: ${template}`);

  switch (template) {
    case "express":
      scaffoldExpress(outDir, force);
      break;
    case "fastify":
      scaffoldFastify(outDir, force);
      break;
    case "nextjs":
      scaffoldNextjs(outDir, force);
      break;
    case "react":
      scaffoldReact(outDir, force);
      break;
    case "prisma":
      scaffoldPrisma(outDir, force);
      break;
    case "docker":
      scaffoldDocker(outDir, force);
      break;
    case "env":
      scaffoldEnv(outDir, force);
      break;
    default:
      console.error(`Unknown template: ${template}`);
      console.error("Available: express, fastify, nextjs, react, prisma, docker, env");
      process.exit(1);
  }

  console.log();
}

function scaffoldExpress(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "stratum-middleware.ts"), `// Stratum Express middleware
import { StratumClient, expressMiddleware } from "@stratum-hq/sdk";

const client = new StratumClient({
  controlPlaneUrl: process.env.STRATUM_URL || "http://localhost:3001",
  apiKey: process.env.STRATUM_API_KEY || "",
});

// The tenant comes from the verified JWT. Without JWT_SECRET the middleware
// would fall back to the client-supplied tenant header, so refuse to start.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET must be set: the tenant is taken from a verified JWT.");
}

// Drop into your Express app:
//   app.use(tenantMiddleware);
export const tenantMiddleware = expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
  jwtSecret,
});

// In routes, access: req.tenant.tenant_id, req.tenant.resolved_config
export { client as stratumClient };
`, force);

  writeFile(path.join(outDir, "tenant-routes.ts"), `// Example tenant-aware Express routes
import { Router } from "express";

const router = Router();

router.get("/profile", (req, res) => {
  const { tenant_id, resolved_config, resolved_permissions } = req.tenant;

  res.json({
    tenant_id,
    max_users: resolved_config["max_users"]?.value,
    can_manage_users: resolved_permissions["manage_users"]?.value === true,
  });
});

router.get("/features", (req, res) => {
  const config = req.tenant.resolved_config;

  res.json({
    siem: config["features.siem"]?.value ?? false,
    edr: config["features.edr"]?.value ?? false,
  });
});

export default router;
`, force);

  log.info("Install: npm install @stratum-hq/sdk jsonwebtoken");
  log.info("Add to your app:");
  log.dim('  import { tenantMiddleware } from "./stratum-middleware";');
  log.dim('  import tenantRoutes from "./tenant-routes";');
  log.dim("  app.use(tenantMiddleware);");
  log.dim('  app.use("/api", tenantRoutes);');
}

function scaffoldFastify(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "stratum-plugin.ts"), `// Stratum Fastify plugin
import { StratumClient, fastifyPlugin } from "@stratum-hq/sdk";

export const stratumClient = new StratumClient({
  controlPlaneUrl: process.env.STRATUM_URL || "http://localhost:3001",
  apiKey: process.env.STRATUM_API_KEY || "",
});

// The tenant comes from the verified JWT. Without JWT_SECRET the plugin would
// fall back to the client-supplied tenant header, so refuse to start.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET must be set: the tenant is taken from a verified JWT.");
}

export const stratumPluginOptions = {
  client: stratumClient,
  jwtClaimPath: "tenant_id",
  jwtSecret,
};

// Register in your Fastify app:
//   app.register(fastifyPlugin, stratumPluginOptions);
export { fastifyPlugin };
`, force);

  log.info("Install: npm install @stratum-hq/sdk jsonwebtoken");
  log.info("Add to your app:");
  log.dim('  import { stratumPluginOptions, fastifyPlugin } from "./stratum-plugin";');
  log.dim("  app.register(fastifyPlugin, stratumPluginOptions);");
}

function scaffoldNextjs(outDir: string, force: boolean): void {
  // Next.js runs middleware only from the directory that holds the app directory.
  const appRoot = nextjsAppRoot(outDir);
  writeFile(path.join(appRoot, "middleware.ts"), nextjsMiddleware(), force);

  writeFile(path.join(outDir, "lib/stratum.ts"), `// Stratum helpers for Next.js
import { StratumClient } from "@stratum-hq/sdk";

export const stratumClient = new StratumClient({
  controlPlaneUrl: process.env.STRATUM_URL || "http://localhost:3001",
  apiKey: process.env.STRATUM_API_KEY || "",
});

export async function getTenantFromHeaders(headers: Headers) {
  const tenantId = headers.get("x-tenant-id");
  if (!tenantId) return null;
  return stratumClient.resolveTenant(tenantId);
}

// In API routes:
//   const tenant = await getTenantFromHeaders(request.headers);
//
// In Server Components:
//   import { headers } from "next/headers";
//   const tenant = await getTenantFromHeaders(await headers());
`, force);

  writeFile(path.join(outDir, "components/tenant-layout.tsx"), `// Tenant-aware layout component
"use client";

import { StratumProvider, useStratum } from "@stratum-hq/react";
import React from "react";

export function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    // Requests go to the server-side proxy in app/api/stratum, which holds the
    // control-plane API key. Never give StratumProvider a key in the browser.
    <StratumProvider controlPlaneUrl="/api/stratum">
      <TenantBoundary>{children}</TenantBoundary>
    </StratumProvider>
  );
}

function TenantBoundary({ children }: { children: React.ReactNode }) {
  const { currentTenant, loading, error } = useStratum();

  if (loading) return <div>Loading tenant...</div>;
  if (error) return <div>Tenant error: {error.message}</div>;
  if (!currentTenant) return <div>No tenant selected</div>;

  return <>{children}</>;
}
`, force);

  writeFile(path.join(appRoot, "app/api/stratum/[...path]/route.ts"), nextjsProxyRoute(), force);

  log.info("Install: npm install @stratum-hq/sdk @stratum-hq/react jose");
  log.info("middleware.ts must sit next to your app directory (src/middleware.ts for src/app). It needs JWT_SECRET set.");
  log.info("Place lib/stratum.ts in your lib/ directory.");
  log.info("Wrap layouts with <TenantLayout>.");
  log.info("Implement authorize() in app/api/stratum/[...path]/route.ts; it denies every request until you do.");
}

function scaffoldReact(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "stratum-provider.tsx"), `// Stratum React provider
import React from "react";
import { StratumProvider, useStratum } from "@stratum-hq/react";

export function AppStratumProvider({ children }: { children: React.ReactNode }) {
  return (
    // Requests go to a server-side proxy (see stratum-proxy.ts) that holds the
    // control-plane API key. Never give StratumProvider a key in the browser.
    <StratumProvider controlPlaneUrl={process.env.REACT_APP_STRATUM_PROXY_URL || "/api/stratum"}>
      {children}
    </StratumProvider>
  );
}

export { useStratum };
`, force);

  writeFile(path.join(outDir, "tenant-guard.tsx"), `// Conditional rendering by permission/config
"use client";
import React from "react";
import { useStratum } from "@stratum-hq/react";

export function PermissionGuard({
  permission, children, fallback = null,
}: { permission: string; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { tenantContext, loading } = useStratum();
  if (loading || !tenantContext) return <>{fallback}</>;
  const perm = tenantContext.resolved_permissions[permission];
  if (!perm || perm.value !== true) return <>{fallback}</>;
  return <>{children}</>;
}

export function ConfigGuard({
  configKey, value, children, fallback = null,
}: { configKey: string; value?: unknown; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { tenantContext, loading } = useStratum();
  if (loading || !tenantContext) return <>{fallback}</>;
  const entry = tenantContext.resolved_config[configKey] as any;
  if (!entry) return <>{fallback}</>;
  const v = entry?.value ?? entry;
  if (value !== undefined ? v !== value : !v) return <>{fallback}</>;
  return <>{children}</>;
}
`, force);

  writeFile(path.join(outDir, "use-tenant.ts"), `// Custom hooks for tenant context
import { useStratum } from "@stratum-hq/react";

export function usePermission(key: string): boolean {
  const { tenantContext, loading } = useStratum();
  if (loading || !tenantContext) return false;
  return tenantContext.resolved_permissions[key]?.value === true;
}

export function useConfig<T = unknown>(key: string, defaultValue?: T): T | undefined {
  const { tenantContext, loading } = useStratum();
  if (loading || !tenantContext) return defaultValue;
  const entry = tenantContext.resolved_config[key] as any;
  if (entry === undefined) return defaultValue;
  return (entry?.value ?? entry) as T;
}

export function useIsRootTenant(): boolean {
  const { currentTenant } = useStratum();
  return currentTenant?.depth === 0;
}
`, force);

  writeFile(path.join(outDir, "stratum-proxy.ts"), expressProxy(), force);

  log.info("Wrap your app with <AppStratumProvider>.");
  log.info("Mount stratum-proxy.ts on your backend at /api/stratum and implement authorize(); it denies every request until you do.");
  log.info("Use <PermissionGuard> and <ConfigGuard> for conditional rendering.");
  log.info("Use usePermission() and useConfig() hooks in components.");
}

function scaffoldPrisma(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "stratum-prisma.ts"), `// Tenant-scoped Prisma client
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { prismaWithTenant } from "@stratum-hq/db-adapters";
import { getTenantContext } from "@stratum-hq/sdk";

const prisma = new PrismaClient();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// All queries through tenantPrisma are automatically filtered by RLS
export const tenantPrisma = prismaWithTenant(
  prisma,
  () => getTenantContext().tenant_id,
  pool,
);

// Usage:
//   const orders = await tenantPrisma.order.findMany();
//   // Only returns orders for the current tenant

export { prisma, pool };
`, force);

  log.info("Install: npm install @stratum-hq/db-adapters @prisma/client pg");
  log.info("Use tenantPrisma instead of prisma for tenant-scoped queries.");
}

function scaffoldDocker(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "docker-compose.stratum.yml"), `# Stratum + PostgreSQL Docker Compose
#
# Required environment (for example in a .env file next to this one):
#   JWT_SECRET   long random value, e.g. the output of: openssl rand -base64 32
#   STRATUM_REF  Stratum release tag to build the control plane from
#
# Outside development, also set STRATUM_ENCRYPTION_KEY, STRATUM_HKDF_SALT and
# STRATUM_API_KEY_HMAC_SECRET (see .env.stratum from: stratum scaffold env),
# and replace the stratum_dev passwords in stratum-init-db.sql and below.
version: "3.8"

services:
  stratum-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: stratum
      # Bootstrap superuser. Used only by stratum-init-db.sql; it bypasses RLS.
      POSTGRES_USER: stratum
      POSTGRES_PASSWORD: stratum_dev
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - stratum_data:/var/lib/postgresql/data
      - ./stratum-init-db.sql:/docker-entrypoint-initdb.d/stratum-init-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stratum"]
      interval: 5s
      timeout: 5s
      retries: 5

  stratum-control-plane:
    # Stratum does not publish a control-plane image. Build it from the
    # Stratum repository at the release tag in STRATUM_REF.
    build:
      context: https://github.com/stratum-hq/Stratum.git#\${STRATUM_REF:?Set STRATUM_REF to a Stratum release tag}
    depends_on:
      stratum-db:
        condition: service_healthy
    environment:
      # The application login: no BYPASSRLS and no privilege on the Stratum
      # tables (see stratum-init-db.sql), so row-level security applies.
      DATABASE_URL: postgres://stratum_app:stratum_dev@stratum-db:5432/stratum
      # The admin login, a member of stratum_control: the migrations and the
      # library's cross-tenant work run on it.
      DATABASE_ADMIN_URL: postgres://stratum_admin:stratum_dev@stratum-db:5432/stratum
      JWT_SECRET: \${JWT_SECRET:?Set JWT_SECRET to a long random value}
      # Bearer tokens must carry this audience (aud) to be accepted.
      JWT_AUDIENCE: \${JWT_AUDIENCE:-stratum-control-plane}
      NODE_ENV: \${NODE_ENV:-development}
      PORT: "3001"
      # Passed through from your environment when set. Required when NODE_ENV
      # is not development or test.
      STRATUM_ENCRYPTION_KEY:
      STRATUM_HKDF_SALT:
      STRATUM_API_KEY_HMAC_SECRET:
    ports:
      - "127.0.0.1:3001:3001"

volumes:
  stratum_data:
`, force);

  writeFile(path.join(outDir, "stratum-init-db.sql"), `-- Runs once, as the bootstrap superuser (POSTGRES_USER, stratum), when the
-- database volume is created. See the "Hardening: separate admin and app
-- roles" guide for the role model of @stratum-hq/lib migration 032.
-- Replace the stratum_dev passwords outside development.

-- Extensions need the superuser (uuid-ossp and ltree).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- stratum_control: the NOLOGIN control role. Every Stratum table gets a
-- policy for it, and only its members reach rows across tenants. Created
-- here, by the superuser, so that the migrations can apply it although they
-- run as stratum_admin, which cannot create roles.
CREATE ROLE stratum_control NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public TO stratum_control;

-- stratum_admin: the control plane's admin login (DATABASE_ADMIN_URL). Not a
-- superuser and no BYPASSRLS: it reaches the Stratum tables as a member of
-- stratum_control. It runs the migrations, so it owns the Stratum tables, and
-- it creates the schemas and databases of isolated tenants.
CREATE ROLE stratum_admin WITH LOGIN PASSWORD 'stratum_dev' NOSUPERUSER NOBYPASSRLS CREATEDB;
GRANT stratum_control TO stratum_admin WITH INHERIT TRUE, SET TRUE;
GRANT CONNECT, CREATE ON DATABASE stratum TO stratum_admin;
GRANT USAGE, CREATE ON SCHEMA public TO stratum_admin;

-- stratum_app: the application login (DATABASE_URL), without BYPASSRLS. It
-- is not a member of stratum_control, owns nothing of Stratum's, and cannot
-- write the Stratum tables. It cannot create objects in public, where the
-- Stratum tables live: it creates and owns the application's own tables in
-- its own schema, stratum_app, which is first on its default search path
-- ("$user", public), so unqualified CREATE TABLE statements land there and
-- unqualified names still find the Stratum tables in public. To let it read
-- the recommended read list (tenants, config_entries, ...; never api_keys,
-- webhooks or regions), run once the control plane has migrated:
--   stratum db roles --apply --admin-role stratum_admin --app-role stratum_app \\
--     --database-url postgres://stratum:stratum_dev@localhost:5432/stratum
-- Default privileges cannot name tables, so they cannot grant that list.
CREATE ROLE stratum_app WITH LOGIN PASSWORD 'stratum_dev' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE stratum TO stratum_app;
GRANT USAGE ON SCHEMA public TO stratum_app;
CREATE SCHEMA stratum_app AUTHORIZATION stratum_app;

-- Only roles granted CREATE by name create objects in public. PostgreSQL 15
-- and later already start this way; older versions grant it to PUBLIC.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
`, force);

  log.info("Set JWT_SECRET and STRATUM_REF (a Stratum release tag), then:");
  log.info("Start with: docker compose -f docker-compose.stratum.yml up -d");
  log.info("Once the control plane has migrated, give the app login its read access:");
  log.dim("  stratum db roles --apply --admin-role stratum_admin --app-role stratum_app \\");
  log.dim("    --database-url postgres://stratum:stratum_dev@localhost:5432/stratum");
  log.info("Control plane: http://localhost:3001");
  log.info("Swagger docs: http://localhost:3001/api/docs");
}

function scaffoldEnv(outDir: string, force: boolean): void {
  const jwtSecret = crypto.randomBytes(32).toString("base64url");
  writeFile(path.join(outDir, ".env.stratum"), `# Stratum Environment Variables
# Holds secrets: keep this file out of version control.

# Database
${databaseEnvLines()}

# Authentication
JWT_SECRET=${jwtSecret}

${secretEnvLines()}

# Control Plane (if using @stratum-hq/sdk)
STRATUM_URL=http://localhost:3001
STRATUM_API_KEY=sk_test_your_key_here

# React / Next.js: keep STRATUM_API_KEY server-side. Never copy it into a
# NEXT_PUBLIC_, REACT_APP_ or VITE_ variable, which the bundler inlines into
# browser JavaScript. Browser calls go through the server-side proxy that
# \`stratum scaffold nextjs\` or \`stratum scaffold react\` generates.

# Optional tuning
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3300
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute
`, force);

  log.info("Copy variables to your .env file.");
  log.info("Generate new secrets and database passwords for production; never reuse these values.");
}
