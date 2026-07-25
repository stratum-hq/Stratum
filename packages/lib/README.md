# @stratum-hq/lib

Framework-agnostic library for embedding [Stratum](https://github.com/stratum-hq/Stratum) directly in your Node.js app. Talks straight to PostgreSQL with no HTTP server in between — maximum performance for tenant operations.

## Installation

```bash
npm install @stratum-hq/lib @stratum-hq/core pg
```

## Quick Start

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stratum = new Stratum({ pool, autoMigrate: true });
await stratum.initialize();

const msp = await stratum.createTenant({ name: "NorthStar MSP", slug: "northstar" });
const customer = await stratum.createTenant({
  name: "Acme Corp",
  slug: "acme",
  parent_id: msp.id,
  isolation_strategy: "SHARED_RLS",
});

// Config flows root → leaf — children inherit automatically
await stratum.setConfig(msp.id, "max_seats", { value: 500, locked: true });
const config = await stratum.resolveConfig(customer.id);
// → { max_seats: { value: 500, inherited: true, locked: true } }

const permissions = await stratum.resolvePermissions(customer.id);
```

The `pool` is **borrowed, not owned** — Stratum never creates or closes it. With `autoMigrate: true`, `initialize()` runs the schema migrations on first start; leave it off and manage migrations yourself via `migrate`.

## API Summary

The `Stratum` instance covers the full tenant lifecycle:

- **Tenants** — `createTenant`, `getTenant`, `listTenants`, `updateTenant`, `moveTenant`, `getAncestors`, `getDescendants`, `batchCreateTenants`
- **Config** — `resolveConfig`, `setConfig`, `deleteConfig`, `batchSetConfig`, `diffConfig`
- **Permissions & ABAC** — `resolvePermissions`, `createPermission`, `createAbacPolicy`, `evaluateAbac`
- **API keys & roles** — `createApiKey`, `validateApiKey`, `rotateApiKey`, `createRole`, `assignRoleToKey`
- **Webhooks & audit** — `createWebhook`, `testWebhook`, `queryAuditLogs`, `listFailedDeliveries`
- **GDPR & regions** — `exportTenantData`, `purgeTenant`, `grantConsent`, `createRegion`, `migrateRegion`

Low-level pool helpers are also exported:

```typescript
import { withClient, withTransaction } from "@stratum-hq/lib";

await withTransaction(pool, async (client) => {
  await client.query("INSERT INTO ...");
});
```

## Background jobs

`runScopedJob` runs a unit of background work bound to a single tenant. It
establishes the tenant context in two layers for the whole duration of the job
and tears both down when the job settles:

- **AsyncLocalStorage** — the tenant is placed in the SDK's ALS store, so code
  inside the job reads it through `Stratum.currentTenantId()` /
  `Stratum.currentTenantContext()` exactly as a request handler would. Each job
  gets its own store, so concurrent jobs cannot observe each other's tenant.
- **Postgres row-level security** — the job runs through the data-plane
  `withTenantContext` (`@stratum-hq/db-adapters`), which opens a transaction and
  issues `SET LOCAL app.current_tenant_id`. Every query the job makes on the
  provided client is confined to that tenant by RLS, so it cannot read or write
  another tenant's rows even with a missing `WHERE tenant_id` filter. `SET LOCAL`
  resets at COMMIT / ROLLBACK, so the context cannot leak onto the next job that
  reuses the pooled connection.

```typescript
import { runScopedJob } from "@stratum-hq/lib";

// `pool` must connect as a NON-superuser, NON-BYPASSRLS role, or RLS is a no-op.
await runScopedJob(pool, tenantId, async (client) => {
  Stratum.currentTenantId(); // === tenantId
  // Confined to `tenantId` by RLS — no app-layer WHERE filter needed.
  await client.query("SELECT * FROM invoices WHERE status = 'pending'");
});
```

Unlike `withClient` / `withTransaction` above (the control-plane path, which runs
under the audited `app.bypass_rls`), `runScopedJob` keeps the job **subject to**
tenant isolation. Use it for any tenant-scoped background work. Pass
`{ resolve }` to populate the full `ResolvedTenantContext` in the ALS store; by
default a minimal placeholder carrying only the tenant id is used. See
ADR 0001 (`docs/adr/0001-postgres-rls-defense-in-depth.md`).

## Error Handling

All errors come from `@stratum-hq/core` and extend `StratumError`:

```typescript
import { ConfigLockedError } from "@stratum-hq/core";

try {
  await stratum.setConfig(childId, "max_seats", { value: 999 });
} catch (err) {
  if (err instanceof ConfigLockedError) {
    // A parent locked this key — child cannot override
  }
}
```

## Links

- Documentation: https://docs.stratum-hq.org/packages/lib/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
