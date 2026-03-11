---
sidebar_position: 2
title: "Direct Library (@stratum/lib)"
---

# Direct Library Integration

Use `@stratum/lib` to embed Stratum directly in your Node.js application with zero HTTP overhead.

## When to Use

- Maximum performance (no HTTP serialization/deserialization)
- Node.js applications and serverless functions
- Testing and scripting
- Single-service architectures

## Installation

```bash
npm install @stratum/lib @stratum/core pg
```

## Setup

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

// You manage the pool lifecycle
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

const stratum = new Stratum({ pool });
```

:::info
The pool is **borrowed, not owned**. Stratum never creates, configures, or closes the pool. You're in full control of connection settings and lifecycle.
:::

## Building a Tenant Hierarchy

```typescript
// 1. Create root tenant
const root = await stratum.createTenant({
  name: "AcmeSec",
  slug: "acmesec",
  isolation_strategy: "SHARED_RLS",
});

// 2. Create MSP under root
const msp = await stratum.createTenant({
  name: "NorthStar MSP",
  slug: "northstar_msp",
  parent_id: root.id,
});

// 3. Create client under MSP
const client = await stratum.createTenant({
  name: "Client Alpha",
  slug: "client_alpha",
  parent_id: msp.id,
});

// Result: AcmeSec → NorthStar MSP → Client Alpha
```

## Config with Inheritance

```typescript
// Set config on root
await stratum.setConfig(root.id, "max_users", {
  value: 1000,
  locked: false,
});

// Lock a feature flag at the root level
await stratum.setConfig(root.id, "features.siem", {
  value: true,
  locked: true, // Children cannot override
});

// Override max_users at MSP level
await stratum.setConfig(msp.id, "max_users", {
  value: 500,
  locked: false,
});

// Resolve config for Client Alpha
const config = await stratum.resolveConfig(client.id);
// {
//   max_users: { value: 500, inherited: true, source_tenant_id: msp.id, locked: false },
//   "features.siem": { value: true, inherited: true, source_tenant_id: root.id, locked: true },
// }

// Try to override a locked key — throws ConfigLockedError
try {
  await stratum.setConfig(client.id, "features.siem", { value: false });
} catch (err) {
  // ConfigLockedError: "features.siem" is locked by ancestor
}
```

## Permissions with Delegation

```typescript
// Root locks a permission — no descendant can override
await stratum.createPermission(root.id, {
  key: "manage_users",
  value: true,
  mode: "LOCKED",
  revocation_mode: "CASCADE",
});

// MSP delegates a permission — children can override and re-delegate
await stratum.createPermission(msp.id, {
  key: "custom_reports",
  value: true,
  mode: "DELEGATED",
  revocation_mode: "SOFT",
});

// Resolve permissions for Client Alpha
const permissions = await stratum.resolvePermissions(client.id);
// {
//   manage_users: { value: true, mode: "LOCKED", locked: true, delegated: false },
//   custom_reports: { value: true, mode: "DELEGATED", locked: false, delegated: true },
// }
```

## Tree Navigation

```typescript
// Get ancestors (root → parent chain)
const ancestors = await stratum.getAncestors(client.id);
// [root, msp]

// Get all descendants of root
const descendants = await stratum.getDescendants(root.id);
// [msp, client]

// Get direct children of MSP
const children = await stratum.getChildren(msp.id);
// [client]
```

## Moving Tenants

```typescript
// Create a new MSP
const msp2 = await stratum.createTenant({
  name: "SouthShield MSP",
  slug: "southshield_msp",
  parent_id: root.id,
});

// Move Client Alpha from NorthStar to SouthShield
await stratum.moveTenant(client.id, msp2.id);

// Ancestry paths are automatically updated for the moved tenant and all descendants
```

## API Keys

```typescript
// Create an API key for a tenant
const { plaintext_key, id } = await stratum.createApiKey(root.id, "admin-key");
// plaintext_key: "sk_live_abc123..."  — save this, shown only once!

// Validate an API key
const result = await stratum.validateApiKey(plaintext_key);
// { tenant_id: root.id, key_id: id }

// Revoke an API key
await stratum.revokeApiKey(id);
```

## With Express

```typescript
import express from "express";
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stratum = new Stratum({ pool });

const app = express();
app.use(express.json());

app.post("/tenants", async (req, res) => {
  const tenant = await stratum.createTenant(req.body);
  res.status(201).json(tenant);
});

app.get("/tenants/:id/config", async (req, res) => {
  const config = await stratum.resolveConfig(req.params.id);
  res.json(config);
});

app.listen(3000);
```

## With Serverless (AWS Lambda)

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

// Pool is reused across warm invocations
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // Serverless: keep connections minimal
});
const stratum = new Stratum({ pool });

export const handler = async (event: any) => {
  const tenantId = event.pathParameters.tenantId;
  const config = await stratum.resolveConfig(tenantId);

  return {
    statusCode: 200,
    body: JSON.stringify(config),
  };
};
```

## Error Handling

```typescript
import {
  TenantNotFoundError,
  TenantArchivedError,
  ConfigLockedError,
  TenantHasChildrenError,
  TenantCycleDetectedError,
} from "@stratum/core";

try {
  await stratum.deleteTenant(tenantId);
} catch (err) {
  if (err instanceof TenantHasChildrenError) {
    // Archive children first
  }
  if (err instanceof TenantNotFoundError) {
    // Tenant doesn't exist
  }
}
```

## Pool Cleanup

```typescript
// On application shutdown
process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
```
