# @stratum-hq/lib

Multi-tenancy for Node.js and PostgreSQL: tenant hierarchy, config inheritance, row-level security, ABAC, audit log, and GDPR tooling. This is the framework-agnostic core of [Stratum](https://github.com/stratum-hq/Stratum). Embed it directly in your Node.js app. It talks straight to PostgreSQL with no HTTP server in between.

Read the documentation at [docs.stratum-hq.org/packages/lib](https://docs.stratum-hq.org/packages/lib/).

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

// Config flows root → leaf; children inherit automatically
await stratum.setConfig(msp.id, "max_seats", { value: 500, locked: true });
const config = await stratum.resolveConfig(customer.id);
// → { max_seats: { value: 500, inherited: true, locked: true } }

const permissions = await stratum.resolvePermissions(customer.id);
```

The `pool` is **borrowed, not owned**: Stratum never creates or closes it. With `autoMigrate: true`, `initialize()` runs the schema migrations on first start; leave it off and manage migrations yourself via `migrate`.

## Admin pool and the control role (1.8, opt-in)

Migration 032 adds a NOLOGIN **control role** (`stratum_control` by default). Every Stratum table has a `stratum_control_plane` policy for that role, so a login that is a member of it reaches every row, and a session cannot become a member by setting anything. Give the library its own pool on such a login, and keep `pool` for your application:

```typescript
const adminPool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL }); // member of stratum_control
const pool = new Pool({ connectionString: process.env.DATABASE_URL });            // the application role
const stratum = new Stratum({ adminPool, pool, autoMigrate: true, enforceRls: true });
```

- Every library query and `autoMigrate` run on `adminPool`. The admin login needs neither SUPERUSER nor BYPASSRLS.
- `initialize()` checks both logins: the admin login must be a member of the control role; the application login must not be a superuser, have BYPASSRLS, be a member of the control role, own Stratum tables or functions, write any Stratum table, or read `api_keys`, `webhooks`, `regions` or `stratum_security`. It warns about each problem; with `enforceRls: true` a problem with the application login throws.
- `bootstrapRolesSql({ adminRole, appRole, controlRole })` returns the idempotent SQL a database administrator runs once (and again after a migration that adds a table): it creates the control role, makes the admin login a member, and limits the application login to `SELECT` on the read-list tables (`APP_READ_TABLES`).
- Migration 032 creates the control role itself when the migrating role has CREATEROLE. Otherwise it stops with an error that prints the bootstrap SQL.
- The control role name: `migrate({ controlRole })`, `migrateAllSchemas({ controlRole })` and `new Stratum({ controlRole })` set it, and so does `ALTER DATABASE ... SET stratum.control_role = '...'` for every session of one database. Without either, the migration reuses the role the database already has, else `stratum_control`. Roles are cluster-wide, so give databases that must stay apart their own name.
- The legacy `app.bypass_rls` path stays open while `stratum_security.legacy_guc_bypass` is true, the 1.8 default. Once every client of the database uses `adminPool`, close it as a member of the control role: `UPDATE stratum_security SET legacy_guc_bypass = false`.
- Without `adminPool`, Stratum behaves as before and logs a deprecation warning once. `adminPool` becomes required in 2.0, which also removes the legacy path.

### API key hashes

Once `STRATUM_API_KEY_HMAC_SECRET` is set, `validateApiKey` accepts only HMAC-SHA256 key hashes (version 2). Keys created before the secret was set carry an unkeyed SHA-256 hash (version 1) and are refused. To move them over, set `allowLegacyKeyHashes: true` for a transition window: a version 1 key then still authenticates and is re-hashed with HMAC on that use. Turn the option off afterwards and rotate the keys that were not used in the window (`SELECT id, name FROM api_keys WHERE hash_version = 1 AND revoked_at IS NULL`).

## API Summary

The `Stratum` instance covers the full tenant lifecycle:

- **Tenants**: `createTenant`, `getTenant`, `listTenants`, `updateTenant`, `moveTenant`, `getAncestors`, `getDescendants`, `batchCreateTenants`
- **Config**: `resolveConfig`, `setConfig`, `deleteConfig`, `batchSetConfig`, `diffConfig`
- **Permissions & ABAC**: `resolvePermissions`, `createPermission`, `createAbacPolicy`, `evaluateAbac`
- **API keys & roles**: `createApiKey`, `validateApiKey`, `rotateApiKey`, `createRole`, `assignRoleToKey`
- **Webhooks & audit**: `createWebhook`, `testWebhook`, `queryAuditLogs`, `listFailedDeliveries`
- **GDPR & regions**: `exportTenantData`, `purgeTenant`, `grantConsent`, `createRegion`, `migrateRegion`
- **Usage metering**: `recordUsage`, `aggregateUsage` (see [docs/usage-metering.md](../../docs/usage-metering.md))

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

- **AsyncLocalStorage**: the tenant is placed in the SDK's ALS store, so code
  inside the job reads it through `Stratum.currentTenantId()` /
  `Stratum.currentTenantContext()` exactly as a request handler would. Each job
  gets its own store, so concurrent jobs cannot observe each other's tenant.
- **Postgres row-level security**: the job runs through the data-plane
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
  // Confined to `tenantId` by RLS; no app-layer WHERE filter needed.
  await client.query("SELECT * FROM invoices WHERE status = 'pending'");
});
```

Unlike `withClient` / `withTransaction` above (the control-plane path, which runs
under the audited `app.bypass_rls`), `runScopedJob` keeps the job **subject to**
tenant isolation. Use it for any tenant-scoped background work. Pass
`{ resolve }` to populate the full `ResolvedTenantContext` in the ALS store; by
default a minimal placeholder carrying only the tenant id is used. See
ADR 0001 (`docs/adr/0001-postgres-rls-defense-in-depth.md`).

## Rate Limiting

`RateLimiter` is a standalone, storage-agnostic per-tenant rate-limiting primitive. It is not part of the `Stratum` facade (which is bound to a single `pg.Pool`). The point is that its storage is pluggable. It ships with a process-local in-memory store and a documented `RateLimitStore` contract you can implement over Redis, Postgres, or anything else.

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
  throw new Error(`rate limited, retry in ${res.retryAfter}s`);
}
// res: { allowed, limit, remaining, resetAt, retryAfter }
```

It uses a fixed-window algorithm: at most `limit` hits per `windowMs`, resetting when the window elapses.

### Effective limit resolution

For each tenant the limit is resolved in order:

1. `resolveLimit(tenantId)` if provided and it returns a value,
2. the static `limits[tenantId]` override,
3. `defaultLimit`.

`resolveLimit` is the seam for **config inheritance**: back it with `stratum.resolveConfig` to drive limits from the tenant config tree:

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

- **Redis**: `INCR key`, then on a reply of `1`, `PEXPIRE key windowMs`; derive `resetAt` from `now + PTTL`. A short Lua script keeps it atomic and returns count + TTL in one round trip.
- **Postgres**: `INSERT ... ON CONFLICT (key) DO UPDATE` returning the new count, resetting the row when `reset_at` has passed.
- **In-memory**: `MemoryRateLimitStore`; single-process only, holds one entry per distinct `tenantId:key` pair. For high key cardinality or multi-process deployments, use a store with native TTL eviction.

## Error Handling

All errors come from `@stratum-hq/core` and extend `StratumError`:

```typescript
import { ConfigLockedError } from "@stratum-hq/core";

try {
  await stratum.setConfig(childId, "max_seats", { value: 999 });
} catch (err) {
  if (err instanceof ConfigLockedError) {
    // A parent locked this key, so the child cannot override
  }
}
```

## Links

- Documentation: https://docs.stratum-hq.org/packages/lib/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
