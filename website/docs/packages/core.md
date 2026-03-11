---
sidebar_position: 1
title: "@stratum/core"
---

# @stratum/core

Shared types, validation schemas, utilities, and constants used by all Stratum packages.

## Installation

```bash
npm install @stratum/core
```

## Types

### TenantNode

```typescript
interface TenantNode {
  id: string;                          // UUID
  parent_id: string | null;            // UUID of parent tenant
  ancestry_path: string;               // e.g., "/uuid1/uuid2"
  depth: number;                       // 0 = root
  name: string;                        // 1-255 chars
  slug: string;                        // ^[a-z][a-z0-9_]{0,62}$
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  isolation_strategy: IsolationStrategy;
  status: TenantStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
```

### TenantContext

Resolved at runtime — includes effective config and permissions for a tenant.

```typescript
interface TenantContext {
  tenant_id: string;
  ancestry_path: string;
  depth: number;
  resolved_config: Record<string, unknown>;
  resolved_permissions: Record<string, ResolvedPermission>;
  isolation_strategy: IsolationStrategy;
}
```

### ResolvedPermission

```typescript
interface ResolvedPermission {
  key: string;
  value: unknown;
  mode: string;                // LOCKED | INHERITED | DELEGATED
  source_tenant_id: string;
  locked: boolean;
  delegated: boolean;
}
```

### ResolvedConfigEntry

```typescript
interface ResolvedConfigEntry {
  key: string;
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
}
```

### Input Types

```typescript
interface CreateTenantInput {
  parent_id?: string | null;
  name: string;
  slug: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  isolation_strategy?: IsolationStrategy;
}

interface UpdateTenantInput {
  name?: string;
  slug?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface MoveTenantInput {
  new_parent_id: string;
}

interface SetConfigInput {
  value: unknown;
  locked?: boolean;
}

interface CreatePermissionInput {
  key: string;
  value?: unknown;
  mode?: PermissionMode;
  revocation_mode?: RevocationMode;
}
```

## Enums

```typescript
enum IsolationStrategy {
  SHARED_RLS = "SHARED_RLS",
  SCHEMA_PER_TENANT = "SCHEMA_PER_TENANT",  // v1.1
  DB_PER_TENANT = "DB_PER_TENANT",          // v1.2
}

enum PermissionMode {
  LOCKED = "LOCKED",
  INHERITED = "INHERITED",
  DELEGATED = "DELEGATED",
}

enum RevocationMode {
  CASCADE = "CASCADE",
  SOFT = "SOFT",
  PERMANENT = "PERMANENT",
}
```

## Validation Schemas (Zod)

```typescript
import { SlugSchema, UUIDSchema, PaginationSchema } from "@stratum/core";

SlugSchema.parse("valid_slug");     // passes
SlugSchema.parse("INVALID");        // throws

UUIDSchema.parse("550e8400-e29b-41d4-a716-446655440000"); // passes

PaginationSchema.parse({ limit: 50 });   // passes
PaginationSchema.parse({ limit: 200 });   // throws (max 100)
```

## Utilities

### Ancestry

```typescript
import {
  buildAncestryPath,
  parseAncestryPath,
  getDepth,
  isAncestorOf,
} from "@stratum/core";

buildAncestryPath("/parent-uuid", "child-uuid");
// => "/parent-uuid/child-uuid"

parseAncestryPath("/a/b/c");
// => ["a", "b", "c"]

getDepth("/a/b/c");
// => 2

isAncestorOf("/a/b", "/a/b/c");
// => true
```

### Errors

```typescript
import {
  StratumError,
  TenantNotFoundError,
  TenantArchivedError,
  TenantAlreadyExistsError,
  TenantHasChildrenError,
  TenantCycleDetectedError,
  ConfigLockedError,
  ConfigNotFoundError,
  PermissionLockedError,
  PermissionNotFoundError,
  PermissionRevocationDeniedError,
  UnauthorizedError,
} from "@stratum/core";

// All extend StratumError, which extends Error
throw new TenantNotFoundError("tenant-123");
```

## Constants

```typescript
import {
  MAX_TREE_DEPTH,        // 20
  MAX_SLUG_LENGTH,       // 63
  DEFAULT_CACHE_TTL_MS,  // 60_000
  DEFAULT_PAGE_SIZE,     // 50
  MAX_PAGE_SIZE,         // 100
  API_KEY_PREFIX,        // "sk_live_"
  API_KEY_BYTES,         // 32
  TENANT_HEADER,         // "X-Tenant-ID"
} from "@stratum/core";
```
