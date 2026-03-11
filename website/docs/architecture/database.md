---
sidebar_position: 2
title: Database & RLS
---

# Database Schema & Row-Level Security

## Prerequisites

- PostgreSQL 16+
- Extensions: `uuid-ossp`, `ltree`

## Schema

### tenants

The core table storing the tenant hierarchy.

```sql
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id     UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  ancestry_path TEXT NOT NULL,
  ancestry_ltree ltree,
  depth         INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  config        JSONB NOT NULL DEFAULT '{}',
  metadata      JSONB NOT NULL DEFAULT '{}',
  isolation_strategy TEXT DEFAULT 'SHARED_RLS',
  status        TEXT DEFAULT 'active',
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Constraints:**
- `slug` must match `^[a-z][a-z0-9_]{0,62}$`
- `isolation_strategy` must be `'SHARED_RLS'` (v1)
- `status` must be `'active'` or `'archived'`
- `ON DELETE RESTRICT` prevents deleting a tenant that has children

**Indexes:**
- `parent_id` — child lookups
- `ancestry_ltree` (GIST) — subtree queries with `<@` operator
- `depth` — level-based queries
- `slug` — unique lookups
- `status` (partial, active only) — filters archived tenants efficiently

**Triggers:**
- `update_tenants_updated_at` — auto-updates `updated_at` on modification
- `maintain_tenant_ancestry_ltree` — derives `ancestry_ltree` from parent's ltree + slug

### config_entries

Hierarchical configuration with lock semantics.

```sql
CREATE TABLE config_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  value            JSONB NOT NULL,
  inherited        BOOLEAN NOT NULL DEFAULT false,
  source_tenant_id UUID NOT NULL REFERENCES tenants(id),
  locked           BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);
```

### permission_policies

Permission delegation with mode and revocation semantics.

```sql
CREATE TABLE permission_policies (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  key              TEXT NOT NULL,
  value            JSONB NOT NULL DEFAULT 'true',
  mode             TEXT DEFAULT 'INHERITED',
  revocation_mode  TEXT DEFAULT 'CASCADE',
  source_tenant_id UUID NOT NULL REFERENCES tenants(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);
```

**Mode values:** `LOCKED`, `INHERITED`, `DELEGATED`
**Revocation values:** `CASCADE`, `SOFT`, `PERMANENT`

### api_keys

Server-generated API keys with hashed storage.

```sql
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL,
  key_prefix   VARCHAR(16),
  name         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_api_keys_hash ON api_keys(key_hash);
```

Keys are stored as SHA-256 hashes. The plaintext key (`sk_live_*` or `sk_test_*`) is returned only once at creation time.

## Row-Level Security

### How It Works

RLS policies enforce tenant isolation at the database level. Every tenant-scoped table follows this pattern:

```sql
-- 1. Enable RLS
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE your_table FORCE ROW LEVEL SECURITY;

-- 2. Create isolation policy
CREATE POLICY tenant_isolation ON your_table
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### Transaction Pattern

Every tenant-scoped query must follow this pattern:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', $1, true);  -- parameterized
-- Your queries here (automatically filtered by RLS)
COMMIT;
```

The `true` parameter to `set_config` makes the setting transaction-local.

### Connection Cleanup

When returning a connection to the pool, always reset the tenant context:

```sql
RESET app.current_tenant_id;
```

This prevents tenant context leaking between requests.

### Safety Checks

The migration enforces two critical safety checks:

1. **FORCE ROW LEVEL SECURITY** — ensures RLS policies apply even to the table owner role
2. **BYPASSRLS check** — the migration fails immediately if the application role has `BYPASSRLS` privilege

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user AND rolbypassrls = true
  ) THEN
    RAISE EXCEPTION 'FATAL: application role "%" has BYPASSRLS. Revoke it.', current_user;
  END IF;
END $$;
```

### Migrating Existing Tables

Use the db-adapters migration helpers to add RLS to your existing tables:

```typescript
import { migrateTable } from "@stratum/db-adapters";

// Adds tenant_id column, enables RLS + FORCE RLS, creates policy
await migrateTable(client, "your_table");
```

Or step by step:

```typescript
import { addTenantColumn, enableRLS, createIsolationPolicy } from "@stratum/db-adapters";

await addTenantColumn(client, "your_table");
await enableRLS(client, "your_table");
await createIsolationPolicy(client, "your_table");
```

## Advisory Locks

Tenant mutations (create, move) use PostgreSQL advisory locks to prevent race conditions:

```sql
SELECT pg_advisory_xact_lock(
  ('x' || left(md5($1::text), 16))::bit(64)::bigint
);
```

The lock ID is derived from the parent tenant's UUID via MD5, ensuring that concurrent operations on the same parent are serialized. The lock is automatically released at transaction end.
