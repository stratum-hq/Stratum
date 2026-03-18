import * as fs from "fs";
import * as path from "path";
import * as log from "../utils/log.js";

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

// Drop into your Express app:
//   app.use(tenantMiddleware);
export const tenantMiddleware = expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
  jwtSecret: process.env.JWT_SECRET,
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

// Register in your Fastify app:
//   app.register(fastifyPlugin, { client: stratumClient, jwtClaimPath: "tenant_id" });
export { fastifyPlugin };
`, force);

  log.info("Add to your app:");
  log.dim('  import { stratumClient, fastifyPlugin } from "./stratum-plugin";');
  log.dim("  app.register(fastifyPlugin, { client: stratumClient, jwtClaimPath: \"tenant_id\" });");
}

function scaffoldNextjs(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "middleware.ts"), `// Next.js edge middleware for tenant resolution
import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const subdomain = hostname.split(".")[0];
  const headerTenantId = request.headers.get("x-tenant-id");
  const pathTenantId = request.nextUrl.pathname.match(/^\\/tenant\\/([^/]+)/)?.[1];

  const tenantId = headerTenantId || pathTenantId || subdomain;

  const requestHeaders = new Headers(request.headers);
  if (tenantId && tenantId !== "localhost" && tenantId !== "www") {
    requestHeaders.set("x-tenant-id", tenantId);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
`, force);

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
    <StratumProvider
      controlPlaneUrl={process.env.NEXT_PUBLIC_STRATUM_URL || "http://localhost:3001"}
      apiKey={process.env.NEXT_PUBLIC_STRATUM_API_KEY || ""}
    >
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

  log.info("Place middleware.ts in your Next.js project root.");
  log.info("Place lib/stratum.ts in your lib/ directory.");
  log.info("Wrap layouts with <TenantLayout>.");
}

function scaffoldReact(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "stratum-provider.tsx"), `// Stratum React provider
import React from "react";
import { StratumProvider, useStratum } from "@stratum-hq/react";

export function AppStratumProvider({ children }: { children: React.ReactNode }) {
  return (
    <StratumProvider
      controlPlaneUrl={process.env.REACT_APP_STRATUM_URL || "http://localhost:3001"}
      apiKey={process.env.REACT_APP_STRATUM_API_KEY || ""}
    >
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

  log.info("Wrap your app with <AppStratumProvider>.");
  log.info("Use <PermissionGuard> and <ConfigGuard> for conditional rendering.");
  log.info("Use usePermission() and useConfig() hooks in components.");
}

function scaffoldPrisma(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, "stratum-prisma.ts"), `// Tenant-scoped Prisma client
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { withTenant } from "@stratum-hq/db-adapters";
import { getTenantContext } from "@stratum-hq/sdk";

const prisma = new PrismaClient();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// All queries through tenantPrisma are automatically filtered by RLS
export const tenantPrisma = withTenant(
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
version: "3.8"

services:
  stratum-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: stratum
      POSTGRES_USER: stratum
      POSTGRES_PASSWORD: stratum_dev
    ports:
      - "5432:5432"
    volumes:
      - stratum_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stratum"]
      interval: 5s
      timeout: 5s
      retries: 5

  stratum-control-plane:
    image: stratum/control-plane:latest
    # Or build from source:
    # build:
    #   context: ./node_modules/@stratum-hq/control-plane
    #   dockerfile: Dockerfile
    depends_on:
      stratum-db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://stratum:stratum_dev@stratum-db:5432/stratum
      JWT_SECRET: \${JWT_SECRET:-change-me-in-production}
      NODE_ENV: \${NODE_ENV:-development}
      PORT: "3001"
    ports:
      - "3001:3001"

volumes:
  stratum_data:
`, force);

  log.info("Start with: docker compose -f docker-compose.stratum.yml up -d");
  log.info("Control plane: http://localhost:3001");
  log.info("Swagger docs: http://localhost:3001/api/docs");
}

function scaffoldEnv(outDir: string, force: boolean): void {
  writeFile(path.join(outDir, ".env.stratum"), `# Stratum Environment Variables

# Database
DATABASE_URL=postgres://stratum:stratum_dev@localhost:5432/stratum

# Authentication
JWT_SECRET=change-me-in-production

# Control Plane (if using @stratum-hq/sdk)
STRATUM_URL=http://localhost:3001
STRATUM_API_KEY=sk_test_your_key_here

# React/Next.js public vars (if applicable)
# NEXT_PUBLIC_STRATUM_URL=http://localhost:3001
# NEXT_PUBLIC_STRATUM_API_KEY=sk_test_your_key_here
# REACT_APP_STRATUM_URL=http://localhost:3001
# REACT_APP_STRATUM_API_KEY=sk_test_your_key_here

# Optional tuning
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3300
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute
`, force);

  log.info("Copy variables to your .env file.");
  log.info("Update DATABASE_URL and JWT_SECRET for production.");
}
