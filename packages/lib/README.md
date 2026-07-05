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
