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

## Rate Limiting

`RateLimiter` is a standalone, storage-agnostic per-tenant rate-limiting primitive. It is not part of the `Stratum` facade (which is bound to a single `pg.Pool`) — the point is that its storage is pluggable. It ships with a process-local in-memory store and a documented `RateLimitStore` contract you can implement over Redis, Postgres, or anything else.

> This is distinct from the HTTP-layer rate limiting in `@stratum-hq/control-plane`. Use this to embed per-tenant limits directly in an application.

```typescript
import { RateLimiter } from "@stratum-hq/lib";

const limiter = new RateLimiter({
  defaultLimit: { limit: 100, windowMs: 60_000 }, // 100 requests / minute
  limits: {
    "tenant-vip": { limit: 1000, windowMs: 60_000 }, // static per-tenant override
  },
});

// `key` sub-scopes the limit within a tenant (per-endpoint, per-user, ...).
// Omit it for one tenant-wide bucket. Counters are namespaced by tenant, so
// one tenant's usage never affects another's.
const res = await limiter.checkLimit(tenantId, "api");
if (!res.allowed) {
  throw new Error(`rate limited — retry in ${res.retryAfter}s`);
}
// res: { allowed, limit, remaining, resetAt, retryAfter }
```

It uses a fixed-window algorithm: at most `limit` hits per `windowMs`, resetting when the window elapses.

### Effective limit resolution

For each tenant the limit is resolved in order:

1. `resolveLimit(tenantId)` if provided and it returns a value,
2. the static `limits[tenantId]` override,
3. `defaultLimit`.

`resolveLimit` is the seam for **config inheritance** — back it with `stratum.resolveConfig` to drive limits from the tenant config tree:

```typescript
const limiter = new RateLimiter({
  defaultLimit: { limit: 100, windowMs: 60_000 },
  async resolveLimit(tenantId) {
    const cfg = await stratum.resolveConfig(tenantId);
    const limit = cfg.rate_limit?.value as { limit: number; windowMs: number } | undefined;
    return limit; // undefined falls through to defaultLimit
  },
});
```

### Storage backend contract

Pass any `RateLimitStore` as `store` (defaults to `MemoryRateLimitStore`). A store provides one atomic-per-key operation:

```typescript
interface RateLimitStore {
  // Atomically increment `key`'s counter and return the new count and the
  // window's reset time. If no live window exists (never seen, or the previous
  // window has elapsed), begin a fresh window: count = 1, resetAt = now + windowMs.
  // Otherwise increment and return the current window's unchanged resetAt.
  // The read-modify-write MUST be atomic per key.
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  // Clear `key`'s counter so the next increment starts a new window.
  reset(key: string): Promise<void>;
}
```

Implementation notes:

- **Redis** — `INCR key`, then on a reply of `1`, `PEXPIRE key windowMs`; derive `resetAt` from `now + PTTL`. A short Lua script keeps it atomic and returns count + TTL in one round trip.
- **Postgres** — `INSERT ... ON CONFLICT (key) DO UPDATE` returning the new count, resetting the row when `reset_at` has passed.
- **In-memory** — `MemoryRateLimitStore`; single-process only, holds one entry per distinct `tenantId:key` pair. For high key cardinality or multi-process deployments, use a store with native TTL eviction.

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
