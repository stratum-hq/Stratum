---
sidebar_position: 1
title: Architecture Overview
---

# Architecture Overview

## System Design

Stratum is a TypeScript monorepo with seven packages that layer cleanly:

```
@stratum/react          UI components (React)
@stratum/sdk            Client SDK (Node.js)
@stratum/control-plane  REST API (Fastify) ← wraps @stratum/lib
@stratum/lib            Direct library (no HTTP)
@stratum/db-adapters    Database layer (pg / Prisma)
@stratum/core           Shared types & utilities
```

All packages depend on `@stratum/core` for shared types. The control plane is a thin Fastify wrapper around `@stratum/lib`. The SDK communicates with the control plane over HTTP. The db-adapters work directly with PostgreSQL.

## Tenant Hierarchy

Tenants form a tree structure. The canonical example is an MSSP (Managed Security Service Provider) architecture:

```
MSSP (root)
  MSP A
    Client 1
    Client 2
  MSP B
    Client 3
```

### Path Storage

Each tenant stores its position in the tree two ways:

| Field | Format | Purpose |
|-------|--------|---------|
| `ancestry_path` | `/uuid1/uuid2/uuid3` | Authoritative path for ancestor chain resolution |
| `ancestry_ltree` | `root_slug.child_slug.leaf_slug` | PostgreSQL ltree for efficient subtree queries with `<@` operator |

The `ancestry_ltree` is derived automatically via a database trigger whenever `parent_id` or `slug` changes.

### Depth

The `depth` field is precomputed (0 for root, 1 for first-level children, etc.) and capped at `MAX_TREE_DEPTH = 20`.

### Concurrency Safety

Tenant creation and moves use PostgreSQL advisory locks (`pg_advisory_xact_lock`) on the parent UUID to prevent race conditions when multiple requests modify the same subtree simultaneously.

Move operations perform cycle detection — a tenant cannot be moved under one of its own descendants.

## Config Inheritance

Config entries are key-value pairs that flow down the tree. Resolution walks the ancestor chain from root to leaf:

```
Root:  max_users = 1000
  MSP:  max_users = 500       (overrides root)
    Client: max_users = 50    (overrides MSP)
```

### Lock Semantics

A parent can **lock** a config key, preventing any descendant from overriding it:

```
Root:  features.siem = true  [LOCKED]
  MSP:  features.siem = ???  (cannot override — locked by root)
```

Each resolved config entry includes:
- `value` — the effective value
- `source_tenant_id` — which tenant set it
- `inherited` — whether it came from an ancestor
- `locked` — whether it's locked by an ancestor

## Permission Delegation

Permissions use three **modes** that control how they flow through the tree:

| Mode | Behavior |
|------|----------|
| `LOCKED` | Set once, cannot be overridden by any descendant |
| `INHERITED` | Flows down, descendants can override |
| `DELEGATED` | Flows down, descendants can override and re-delegate |

### Revocation

When a permission is deleted, the **revocation mode** determines the blast radius:

| Mode | Behavior |
|------|----------|
| `CASCADE` | Recursively deletes from all descendants |
| `SOFT` | Deletes only from the current tenant; descendants keep their values |
| `PERMANENT` | Cannot be deleted (throws error) |

## Isolation Model

v1 supports `SHARED_RLS` isolation — all tenants share the same database tables, with PostgreSQL Row-Level Security policies enforcing tenant boundaries.

### How RLS Works

1. Application sets `app.current_tenant_id` via `set_config()` at the start of each transaction
2. Every tenant-scoped table has an RLS policy: `tenant_id = current_setting('app.current_tenant_id')::uuid`
3. PostgreSQL automatically filters all queries to the current tenant
4. The setting is reset when the connection is returned to the pool

### Security Guarantees

- **FORCE ROW LEVEL SECURITY** is enabled on all tenant tables, so even table owners cannot bypass policies
- The migration checks that the application database role does not have `BYPASSRLS` privilege
- Table names in DDL operations are validated with a strict regex to prevent SQL injection

### Future Isolation Strategies

| Strategy | Version | Description |
|----------|---------|-------------|
| `SHARED_RLS` | v1.0 | Shared tables + RLS policies |
| `SCHEMA_PER_TENANT` | v1.1 | Separate PostgreSQL schema per tenant |
| `DB_PER_TENANT` | v1.2 | Separate database per tenant |

## Request Flow

### Via SDK (HTTP path)

```
1. Request arrives with JWT or X-Tenant-ID header
2. SDK middleware resolves tenant ID
3. SDK calls control plane: GET /api/v1/tenants/:id/context
4. Control plane resolves config + permissions (walking ancestor chain)
5. TenantContext is attached to request and bound via AsyncLocalStorage
6. Application code accesses context via req.tenant or getTenantContext()
7. DB adapter sets app.current_tenant_id in transaction
8. PostgreSQL RLS policy filters query results
9. Connection context is reset on release
```

### Via Direct Library

```
1. Application calls stratum.resolveConfig(tenantId)
2. Library queries database directly (no HTTP)
3. Returns resolved config/permissions
4. Application uses db-adapters for tenant-scoped queries
```

## Caching

The SDK client includes an in-memory LRU cache for tenant context resolution:

- **Default TTL**: 60 seconds
- **Default max size**: 100 entries
- **Invalidation**: Automatic on mutations (update, move, archive, delete)
- **Manual**: `client.invalidateCache(tenantId)` or `client.clearCache()`
- **Disable**: `cache: { enabled: false }` in client options
