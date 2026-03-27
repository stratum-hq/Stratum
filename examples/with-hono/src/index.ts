/**
 * Stratum + Hono example
 *
 * Demonstrates:
 *  - Tenant context resolved per-request from X-Tenant-ID header
 *  - Hono middleware that attaches tenant context to the request Context
 *  - Config resolution endpoint
 *  - Tenant creation endpoint
 */
import { Hono, type MiddlewareHandler } from "hono";
import { serve } from "@hono/node-server";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://localhost:5432/stratum_dev",
});

const stratum = new Stratum({ pool, autoMigrate: true });
await stratum.initialize();

// ---------------------------------------------------------------------------
// Tenant middleware
// ---------------------------------------------------------------------------

// Hono uses a typed Context variable map — declare the shape here.
type TenantVars = {
  tenantId: string;
};

/**
 * Reads X-Tenant-ID from the request header, validates it exists,
 * and stores it in the Hono Context variable bag for downstream handlers.
 *
 * Extend this to resolve tenant from a JWT claim, subdomain, etc.
 */
const tenantMiddleware: MiddlewareHandler<{ Variables: TenantVars }> = async (c, next) => {
  const tenantId = c.req.header("X-Tenant-ID");

  if (!tenantId) {
    return c.json({ error: { code: "MISSING_TENANT", message: "X-Tenant-ID header is required" } }, 400);
  }

  // Verify the tenant actually exists before proceeding.
  try {
    await stratum.getTenant(tenantId);
  } catch {
    return c.json({ error: { code: "TENANT_NOT_FOUND", message: `Unknown tenant: ${tenantId}` } }, 404);
  }

  c.set("tenantId", tenantId);
  await next();
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Variables: TenantVars }>();

// Health check — no tenant required
app.get("/health", (c) => c.json({ status: "ok" }));

// All /api/* routes require a valid X-Tenant-ID header
const api = app.basePath("/api");
api.use("/*", tenantMiddleware);

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
  console.log("Try it:");
  console.log(`  curl -H "X-Tenant-ID: <uuid>" http://localhost:${PORT}/api/tenant`);
  console.log(`  curl -H "X-Tenant-ID: <uuid>" http://localhost:${PORT}/api/config`);
});
