/**
 * Stratum + Hono example
 *
 * Demonstrates:
 *  - Hono's JWT middleware verifies the bearer token
 *  - @stratum-hq/hono reads the tenant from the verified `tenant_id` claim
 *  - Config resolution endpoint
 *  - Tenant creation endpoint
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { jwt } from "hono/jwt";
import { serve } from "@hono/node-server";
import pg from "pg";
import { Stratum, TenantNotFoundError } from "@stratum-hq/lib";
import { stratumMiddleware } from "@stratum-hq/hono";
import type { ResolvedTenantContext } from "@stratum-hq/sdk";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://localhost:5432/stratum_dev",
});

const stratum = new Stratum({ pool, autoMigrate: true });
await stratum.initialize();

// The tenant binding comes from a signed token, so the server refuses to start
// without the key that verifies it. Read it from the environment, never from code.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is required: the example reads the tenant from a verified JWT.");
}

// ---------------------------------------------------------------------------
// Tenant resolution
// ---------------------------------------------------------------------------

// Hono uses a typed Context variable map. stratumMiddleware sets tenantId.
type TenantVars = {
  tenantId: string;
};

/**
 * Builds the full tenant context that stratumMiddleware puts in
 * AsyncLocalStorage. Throws TenantNotFoundError for an unknown tenant.
 */
async function resolveTenantContext(tenantId: string): Promise<ResolvedTenantContext> {
  const [tenant, config, permissions] = await Promise.all([
    stratum.getTenant(tenantId),
    stratum.resolveConfig(tenantId),
    stratum.resolvePermissions(tenantId),
  ]);
  return {
    tenant_id: tenant.id,
    ancestry_path: tenant.ancestry_path,
    depth: tenant.depth,
    resolved_config: config,
    resolved_permissions: permissions,
    isolation_strategy: tenant.isolation_strategy,
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Variables: TenantVars }>();

// A valid token can name a tenant that does not exist. Report that as 404.
app.onError((err, c) => {
  // hono/jwt throws an HTTPException that carries its own 401 response.
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof TenantNotFoundError) {
    return c.json({ error: { code: "TENANT_NOT_FOUND", message: err.message } }, 404);
  }
  console.error(err);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
});

// Health check — no token required
app.get("/health", (c) => c.json({ status: "ok" }));

// All /api/* routes require a bearer token that verifies with JWT_SECRET.
// hono/jwt rejects a missing or invalid token with 401 and stores the claims
// as jwtPayload. stratumMiddleware then reads the tenant from that payload
// only, so a client cannot choose its tenant with a request header.
//
// Use the `header` option instead of `jwtClaim` only when a gateway you
// control sets the tenant header and removes any copy the client sent.
const api = app.basePath("/api");
api.use("/*", jwt({ secret: jwtSecret, alg: "HS256" }));
api.use("/*", stratumMiddleware({ jwtClaim: "tenant_id", resolve: resolveTenantContext }));

/**
 * GET /api/tenant
 * Returns basic info about the current tenant.
 */
api.get("/tenant", async (c) => {
  const tenantId = c.get("tenantId");
  const tenant = await stratum.getTenant(tenantId);
  return c.json({ tenant });
});

/**
 * GET /api/config
 * Returns config resolved for this tenant, including values inherited
 * from ancestor tenants in the hierarchy.
 */
api.get("/config", async (c) => {
  const tenantId = c.get("tenantId");
  const config = await stratum.resolveConfig(tenantId);
  return c.json({ tenant_id: tenantId, config });
});

/**
 * POST /api/tenants
 * Creates a new tenant (e.g. during self-serve sign-up).
 *
 * Body: { name: string, slug: string, parent_id?: string }
 */
api.post("/tenants", async (c) => {
  const body = await c.req.json<{ name: string; slug: string; parent_id?: string }>();

  if (!body.name || !body.slug) {
    return c.json({ error: "name and slug are required" }, 400);
  }

  const tenant = await stratum.createTenant({
    name: body.name,
    slug: body.slug,
    parent_id: body.parent_id ?? null,
  });

  return c.json({ tenant }, 201);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`stratum-hono example listening on http://localhost:${PORT}`);
  console.log();
  console.log("Try it (see README.md to create a token):");
  console.log(`  curl -H "Authorization: Bearer $TOKEN" http://localhost:${PORT}/api/tenant`);
  console.log(`  curl -H "Authorization: Bearer $TOKEN" http://localhost:${PORT}/api/config`);
});
