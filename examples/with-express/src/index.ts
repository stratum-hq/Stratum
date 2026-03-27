/**
 * Stratum + Express example
 *
 * Demonstrates:
 *  - Tenant context resolved per-request from X-Tenant-ID header
 *  - Config resolution endpoint
 *  - Tenant creation endpoint
 *  - SDK middleware wired into Express
 */
import express from "express";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import { stratum as stratumSdk } from "@stratum-hq/sdk";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://localhost:5432/stratum_dev",
});

// Stratum lib instance — used for admin operations (create/list tenants, set config)
const stratumLib = new Stratum({ pool, autoMigrate: true });
await stratumLib.initialize();

// Stratum SDK — wires Express middleware that resolves X-Tenant-ID per-request
// and makes the tenant context available as req.tenant
const sdk = stratumSdk({
  controlPlaneUrl: process.env.STRATUM_CONTROL_PLANE_URL ?? "http://localhost:3001",
  apiKey: process.env.STRATUM_API_KEY ?? "sk_live_dev",
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Apply Stratum tenant middleware to all /api routes.
// The middleware reads X-Tenant-ID from the request header,
// resolves the full tenant context, and attaches it as req.tenant.
app.use("/api", sdk.middleware());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/tenant
 * Returns the resolved tenant context for the current request.
 */
app.get("/api/tenant", (req, res) => {
  const tenant = (req as any).tenant;
  res.json({ tenant });
});

/**
 * GET /api/config
 * Returns the resolved config for the current tenant (inherits from ancestors).
 */
app.get("/api/config", async (req, res) => {
  const tenant = (req as any).tenant;
  const config = await stratumLib.resolveConfig(tenant.tenant_id);
  res.json({ tenant_id: tenant.tenant_id, config });
});

/**
 * POST /api/tenants
 * Creates a new tenant. Useful for self-serve sign-up flows.
 *
 * Body: { name: string, slug: string, parent_id?: string }
 */
app.post("/api/tenants", async (req, res) => {
  const { name, slug, parent_id } = req.body as {
    name: string;
    slug: string;
    parent_id?: string;
  };

  if (!name || !slug) {
    res.status(400).json({ error: "name and slug are required" });
    return;
  }

  const tenant = await stratumLib.createTenant({
    name,
    slug,
    parent_id: parent_id ?? null,
  });

  res.status(201).json({ tenant });
});

/**
 * GET /health
 * Simple health check — does not require a tenant header.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`stratum-express example listening on http://localhost:${PORT}`);
  console.log();
  console.log("Try it:");
  console.log(`  curl -H "X-Tenant-ID: <uuid>" http://localhost:${PORT}/api/tenant`);
  console.log(`  curl -H "X-Tenant-ID: <uuid>" http://localhost:${PORT}/api/config`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/tenants \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -H "X-Tenant-ID: <uuid>" \\`);
  console.log(`    -d '{"name":"Initech Solutions","slug":"initech"}'`);
});
