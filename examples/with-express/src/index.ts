/**
 * Stratum + Express example
 *
 * Demonstrates:
 *  - Tenant context resolved per request from a verified JWT claim
 *  - Config resolution endpoint
 *  - Tenant creation endpoint
 *  - SDK middleware wired into Express
 */
import express from "express";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import { stratum as stratumSdk } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/sdk";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://localhost:5432/stratum_dev",
});

// Stratum lib instance — used for admin operations (create/list tenants, set config)
const stratumLib = new Stratum({ pool, autoMigrate: true });
await stratumLib.initialize();

// The tenant binding comes from a signed token, so the server refuses to start
// without the key that verifies it. Read it from the environment, never from code.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is required: the example reads the tenant from a verified JWT.");
}

// The SDK authenticates to the control plane with this key. Read it from the
// environment, never from code.
const apiKey = process.env.STRATUM_API_KEY;
if (!apiKey) {
  throw new Error("STRATUM_API_KEY is required: the SDK authenticates to the control plane with it.");
}

// Stratum SDK — wires Express middleware that resolves the tenant per request
// and makes the tenant context available as req.tenant
const sdk = stratumSdk({
  controlPlaneUrl: process.env.STRATUM_CONTROL_PLANE_URL ?? "http://localhost:3001",
  apiKey,
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Apply Stratum tenant middleware to all /api routes.
// The middleware verifies the HS256 bearer token with jsonwebtoken and reads
// the tenant from its `tenant_id` claim. It then resolves the full tenant
// context and attaches it as req.tenant.
//
// With jwtSecret set, the SDK ignores a client-sent tenant header, and it
// rejects a bearer token that fails verification with 401. Set
// trustTenantHeader: true only when a gateway you control sets the tenant
// header and removes any copy the client sent.
app.use("/api", sdk.middleware({ jwtSecret }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/tenant
 * Returns the resolved tenant context for the current request.
 */
app.get("/api/tenant", (req, res) => {
  const tenant = (req as unknown as { tenant: ResolvedTenantContext }).tenant;
  res.json({ tenant });
});

/**
 * GET /api/config
 * Returns the resolved config for the current tenant (inherits from ancestors).
 */
app.get("/api/config", async (req, res) => {
  const tenant = (req as unknown as { tenant: ResolvedTenantContext }).tenant;
  const config = await stratumLib.resolveConfig(tenant.tenant_id);
  res.json({ tenant_id: tenant.tenant_id, config });
});

/**
 * POST /api/tenants
 * Creates a child tenant under the tenant of the verified caller.
 *
 * Body: { name: string, slug: string }
 *
 * The parent always comes from the verified token, never from the body, so a
 * caller can only add tenants below its own tenant.
 */
app.post("/api/tenants", async (req, res) => {
  const caller = (req as unknown as { tenant: ResolvedTenantContext }).tenant;
  const { name, slug } = req.body as {
    name: string;
    slug: string;
  };

  if (!name || !slug) {
    res.status(400).json({ error: "name and slug are required" });
    return;
  }

  const tenant = await stratumLib.createTenant({
    name,
    slug,
    parent_id: caller.tenant_id,
  });

  res.status(201).json({ tenant });
});

/**
 * GET /health
 * Simple health check — does not require a token.
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
  console.log("Try it (see README.md to create a token):");
  console.log(`  curl -H "Authorization: Bearer $TOKEN" http://localhost:${PORT}/api/tenant`);
  console.log(`  curl -H "Authorization: Bearer $TOKEN" http://localhost:${PORT}/api/config`);
  console.log("  # Creates a child of the tenant in $TOKEN:");
  console.log(`  curl -X POST http://localhost:${PORT}/api/tenants \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -H "Authorization: Bearer $TOKEN" \\`);
  console.log(`    -d '{"name":"Initech Solutions","slug":"initech"}'`);
});
