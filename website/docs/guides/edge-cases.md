---
sidebar_position: 8
title: Edge Cases & Troubleshooting
---

# Edge Cases & Troubleshooting

## Tenant Hierarchy

### Maximum Tree Depth

The maximum tree depth is **20 levels** (`MAX_TREE_DEPTH`). Attempting to create a tenant that would exceed this limit throws a validation error.

```
Root (0) → L1 (1) → L2 (2) → ... → L19 (19) → L20 (20) ← maximum
```

### Cycle Detection on Move

Moving a tenant under one of its own descendants is prevented:

```typescript
// Given: Root → MSP → Client
await stratum.moveTenant(rootId, clientId);
// TenantCycleDetectedError: Would create cycle
```

The check walks the target parent's ancestry chain. If the source tenant appears anywhere in that chain, the move is rejected.

### Concurrent Modifications

Multiple requests creating children under the same parent are serialized via PostgreSQL advisory locks:

```sql
SELECT pg_advisory_xact_lock(hash_of_parent_uuid);
```

This prevents race conditions where two concurrent inserts could assign the same depth or create inconsistent ancestry paths.

### Slug Uniqueness

Slugs are globally unique across all tenants (enforced by a `UNIQUE` constraint). Attempting to create a tenant with a duplicate slug throws `TenantAlreadyExistsError`.

Valid slug format: `^[a-z][a-z0-9_]{0,62}$`
- Must start with a lowercase letter
- Only lowercase letters, digits, and underscores
- Maximum 63 characters

### Archiving Tenants with Children

You cannot archive a tenant that has active children:

```typescript
// Given: Root → MSP → Client
await stratum.deleteTenant(mspId);
// TenantHasChildrenError: Cannot archive tenant with active children
```

Archive children first (leaf → root order), or move them to a different parent.

### Archived Tenant Behavior

- `getTenant(id)` returns `TenantArchivedError` (HTTP 410) by default
- `getTenant(id, true)` includes archived tenants
- Archived tenants are excluded from `listTenants` by default
- Archived tenants still exist in the database (soft delete)

## Config

### Overriding a Locked Key

Attempting to set or update a config key that's locked by an ancestor throws `ConfigLockedError`:

```typescript
// Root locks features.siem
await stratum.setConfig(rootId, "features.siem", { value: true, locked: true });

// Any descendant attempting to override:
await stratum.setConfig(childId, "features.siem", { value: false });
// ConfigLockedError
```

**Resolution:** The locking tenant (or its ancestor) must unlock the key first.

### Deleting an Inherited Key

Deleting a key that was set on the current tenant removes the override. The inherited value from the nearest ancestor takes effect:

```typescript
// Root: max_users = 1000
// Child: max_users = 50 (override)

await stratum.deleteConfig(childId, "max_users");
// Child now inherits max_users = 1000 from Root
```

Deleting a key that was never set on the current tenant throws `ConfigNotFoundError`.

### JSON Values

Config values are stored as `JSONB` in PostgreSQL. Any valid JSON value works:

```typescript
await stratum.setConfig(tenantId, "settings", {
  value: { theme: "dark", locale: "en-US", features: [1, 2, 3] },
});
```

## Permissions

### Locked Permission Override

Attempting to create or update a permission key that's locked by an ancestor throws `PermissionLockedError`:

```typescript
// Root locks manage_billing
await stratum.createPermission(rootId, {
  key: "manage_billing",
  value: true,
  mode: "LOCKED",
});

// Child cannot override:
await stratum.createPermission(childId, { key: "manage_billing", value: false });
// PermissionLockedError
```

### Permanent Permission Deletion

Permissions with `revocation_mode: "PERMANENT"` cannot be deleted:

```typescript
await stratum.deletePermission(tenantId, policyId);
// PermissionRevocationDeniedError (HTTP 403)
```

### CASCADE vs SOFT Revocation

**CASCADE** — Deleting the permission removes it from ALL descendants recursively:

```
Root: api_access [CASCADE]
  MSP: inherits api_access
    Client: inherits api_access

DELETE api_access from Root
→ Removed from Root, MSP, Client
```

**SOFT** — Only removes from the current tenant; descendants keep their values:

```
Root: api_access [SOFT]
  MSP: has own api_access override
    Client: inherits from MSP

DELETE api_access from Root
→ Removed from Root only
→ MSP and Client keep their values
```

## API Keys

### Display-Once Semantics

The plaintext API key is returned **only in the creation response**. It is never stored and cannot be retrieved:

```typescript
const { plaintext_key } = await stratum.createApiKey(tenantId, "my-key");
// plaintext_key: "sk_live_abc123..."  ← SAVE THIS NOW
```

If lost, the key must be revoked and a new one created.

### Revoked Key Behavior

Revoked keys return `null` from `validateApiKey()` and `401 Unauthorized` from the HTTP API.

### Key Prefixes

- `sk_live_` — production keys (when `NODE_ENV=production`)
- `sk_test_` — development keys (default)

The prefix is configurable via `keyPrefix` in the `Stratum` constructor.

## Database

### BYPASSRLS Error on Startup

```
FATAL: application role "stratum" has BYPASSRLS. Revoke it.
```

Fix:
```sql
ALTER ROLE stratum NOBYPASSRLS;
```

### Connection Pool Exhaustion

If you see connection timeout errors, increase the pool size:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,  // default is 20
  connectionTimeoutMillis: 10000,
});
```

### Tenant Context Leakage

If queries return data from the wrong tenant, check that:
1. `resetTenantContext()` is called before releasing connections
2. You're using the adapter's `query()` method (which handles context automatically)
3. You're not sharing raw `pg.Client` instances across requests

### ltree Extension Missing

```
ERROR: type "ltree" does not exist
```

Install the extension:
```sql
CREATE EXTENSION IF NOT EXISTS ltree;
```

## SDK

### Cache Staleness

The SDK caches tenant context for 60 seconds by default. After updating config or permissions, the cache may serve stale data for up to this duration.

**Solutions:**
- Reduce TTL: `cache: { ttlMs: 10000 }` (10 seconds)
- Manually invalidate: `client.invalidateCache(tenantId)`
- Disable caching: `cache: { enabled: false }`

### Missing Tenant Error in Middleware

```
400 MISSING_TENANT: Tenant ID could not be resolved
```

The middleware couldn't find a tenant ID. Check:
1. JWT contains the claim at `jwtClaimPath`
2. `X-Tenant-ID` header is set (or custom `headerName`)
3. Custom resolvers return a non-null value

### AsyncLocalStorage Context Not Available

```
Error: No tenant context available
```

`getTenantContext()` was called outside the middleware's scope. Ensure:
1. The middleware is registered before your route handlers
2. You're not in a detached async context (e.g., `setTimeout`, `setImmediate`)
3. Use `runWithTenantContext()` for manual context propagation

## General

### Migrations Not Running

If the control plane starts but tables don't exist:
1. Check `DATABASE_URL` is correct
2. Check PostgreSQL is running and accessible
3. Check the database user has `CREATE TABLE` permissions
4. Look for migration errors in the startup logs

### JWT Secret Warning

```
⚠️  WARNING: Using default JWT secret. Set JWT_SECRET in production!
```

Set `JWT_SECRET` environment variable to a strong, unique value. In production (`NODE_ENV=production`), this becomes a loud warning banner.
