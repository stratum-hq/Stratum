# @stratum/lib

Framework-agnostic library for direct tenant management — no HTTP server required.

## Installation

```bash
npm install @stratum/lib @stratum/core pg
```

## Quick Start

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stratum = new Stratum({ pool });

// Create a tenant
const tenant = await stratum.createTenant({
  name: "Acme Corp",
  slug: "acme_corp",
  isolation_strategy: "SHARED_RLS",
});

// Create a child tenant
const child = await stratum.createTenant({
  name: "Acme West",
  slug: "acme_west",
  parent_id: tenant.id,
});

// Resolve config with inheritance
const config = await stratum.resolveConfig(tenant.id);

// Resolve permissions
const permissions = await stratum.resolvePermissions(tenant.id);
```

## When to Use @stratum/lib vs @stratum/control-plane

| Use case | Package |
|----------|---------|
| Node.js app, want maximum performance | `@stratum/lib` (direct, no HTTP) |
| Polyglot stack or want service separation | `@stratum/control-plane` + `@stratum/sdk` |
| React admin UI | `@stratum/control-plane` + `@stratum/react` |
| Serverless functions | `@stratum/lib` (embed directly) |
| Testing / scripting | `@stratum/lib` |

## Constructor

```typescript
import { Stratum } from "@stratum/lib";

const stratum = new Stratum({
  pool: pgPool,              // Required: pg.Pool instance
  keyPrefix: "sk_live_",     // Optional: API key prefix (default: "sk_live_")
});
```

The pool is **borrowed, not owned** — Stratum never creates or closes the pool. You manage the pool lifecycle.

## API

### Tenants

```typescript
stratum.createTenant(input: CreateTenantInput): Promise<TenantNode>
stratum.getTenant(id: string, includeArchived?: boolean): Promise<TenantNode>
stratum.listTenants(pagination: PaginationInput): Promise<PaginatedResult<TenantNode>>
stratum.updateTenant(id: string, patch: UpdateTenantInput): Promise<TenantNode>
stratum.deleteTenant(id: string): Promise<void>           // soft delete (archive)
stratum.moveTenant(id: string, newParentId: string): Promise<TenantNode>
stratum.getAncestors(id: string): Promise<TenantNode[]>
stratum.getDescendants(id: string): Promise<TenantNode[]>
stratum.getChildren(id: string): Promise<TenantNode[]>
```

### Config

```typescript
stratum.resolveConfig(tenantId: string): Promise<ResolvedConfig>
stratum.setConfig(tenantId: string, key: string, input: SetConfigInput): Promise<ConfigEntry>
stratum.deleteConfig(tenantId: string, key: string): Promise<void>
stratum.getConfigWithInheritance(tenantId: string): Promise<ResolvedConfig>
```

### Permissions

```typescript
stratum.resolvePermissions(tenantId: string): Promise<Record<string, ResolvedPermission>>
stratum.createPermission(tenantId: string, input: CreatePermissionInput): Promise<PermissionPolicy>
stratum.updatePermission(tenantId: string, policyId: string, input: UpdatePermissionInput): Promise<PermissionPolicy>
stratum.deletePermission(tenantId: string, policyId: string): Promise<void>
```

### API Keys

```typescript
stratum.createApiKey(tenantId: string, name?: string, expiresAt?: Date): Promise<CreatedApiKey>
stratum.validateApiKey(key: string): Promise<{ tenant_id: string | null; key_id: string; scopes: string[] } | null>
stratum.revokeApiKey(keyId: string): Promise<boolean>
stratum.rotateApiKey(keyId: string, newName?: string): Promise<CreatedApiKey>
stratum.listApiKeys(tenantId?: string): Promise<ApiKeyRecord[]>
stratum.listDormantKeys(dormantDays?: number): Promise<ApiKeyRecord[]>
```

### Webhooks

```typescript
stratum.createWebhook(input: CreateWebhookInput, audit?: AuditContext): Promise<Webhook>
stratum.getWebhook(id: string): Promise<Webhook>
stratum.listWebhooks(tenantId?: string): Promise<Webhook[]>
stratum.updateWebhook(id: string, input: UpdateWebhookInput, audit?: AuditContext): Promise<Webhook>
stratum.deleteWebhook(id: string, audit?: AuditContext): Promise<void>
stratum.testWebhook(id: string): Promise<{ success: boolean; response_code: number | null; error?: string }>
```

### Audit Logs

```typescript
stratum.queryAuditLogs(query: AuditLogQuery): Promise<AuditEntry[]>
stratum.getAuditEntry(id: string): Promise<AuditEntry | null>
```

### Consent

```typescript
stratum.grantConsent(tenantId: string, input: GrantConsentInput, audit?: AuditContext): Promise<ConsentRecord>
stratum.revokeConsent(tenantId: string, subjectId: string, purpose: string, audit?: AuditContext): Promise<boolean>
stratum.listConsent(tenantId: string, subjectId?: string): Promise<ConsentRecord[]>
stratum.getActiveConsent(tenantId: string, subjectId: string, purpose: string): Promise<ConsentRecord | null>
```

### Data Retention & GDPR

```typescript
stratum.purgeExpiredData(retentionDays?: number): Promise<{ deleted_count: number }>
stratum.purgeTenant(tenantId: string, audit?: AuditContext): Promise<void>
stratum.exportTenantData(tenantId: string): Promise<Record<string, unknown>>
```

### Regions

```typescript
stratum.createRegion(input: CreateRegionInput, audit?: AuditContext): Promise<Region>
stratum.getRegion(id: string): Promise<Region>
stratum.listRegions(): Promise<Region[]>
stratum.updateRegion(id: string, input: UpdateRegionInput, audit?: AuditContext): Promise<Region>
stratum.deleteRegion(id: string, audit?: AuditContext): Promise<void>
stratum.migrateRegion(tenantId: string, newRegionId: string, audit?: AuditContext): Promise<void>
```

### Encryption

```typescript
import { encrypt, decrypt, reEncrypt } from "@stratum/lib";

encrypt(plaintext: string): string           // Returns "v1:iv:tag:ciphertext"
decrypt(ciphertext: string): string          // Decrypts v1 or legacy format
reEncrypt(ciphertext: string, oldKey: string, newKey: string): string
```

## Pool Helpers

For advanced use, the low-level pool helpers are also exported:

```typescript
import { withClient, withTransaction } from "@stratum/lib";

// Execute with a connection from the pool
const result = await withClient(pool, async (client) => {
  return client.query("SELECT * FROM tenants WHERE id = $1", [id]);
});

// Execute within a transaction
await withTransaction(pool, async (client) => {
  await client.query("INSERT INTO ...");
  await client.query("UPDATE ...");
});
```

## Type Re-exports

`@stratum/lib` re-exports all core types for convenience:

```typescript
import type {
  TenantNode,
  TenantContext,
  CreateTenantInput,
  UpdateTenantInput,
  MoveTenantInput,
  PaginationInput,
  PaginatedResult,
  ConfigEntry,
  SetConfigInput,
  ResolvedConfigEntry,
  ResolvedConfig,
  PermissionPolicy,
  CreatePermissionInput,
  UpdatePermissionInput,
  ResolvedPermission,
  ApiKeyRecord,
  CreatedApiKey,
} from "@stratum/lib";
```

## Prerequisites

`@stratum/lib` assumes the Stratum database schema exists. Run the control-plane migrations first, or apply `packages/control-plane/src/db/migrations/001_init.sql` to your database manually.

## Error Handling

All errors come from `@stratum/core`:

```typescript
import {
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
  ForbiddenError,
} from "@stratum/core";
```
