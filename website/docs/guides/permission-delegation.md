---
sidebar_position: 7
title: Permission Delegation
---

# Permission Delegation

Stratum's permission system supports hierarchical delegation with fine-grained control over how permissions flow through the tenant tree.

## Permission Modes

Each permission has a **mode** that controls how it propagates:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `LOCKED` | Set once, no descendant can override | Compliance, mandatory capabilities |
| `INHERITED` | Flows down, descendants can override | Default settings, optional features |
| `DELEGATED` | Flows down, descendants can override AND re-delegate | MSP-managed features |

### LOCKED

```
Root: manage_billing = true [LOCKED]
  MSP: cannot change manage_billing
    Client: cannot change manage_billing
```

All descendants see `manage_billing = true`. No one can override it.

### INHERITED

```
Root: custom_reports = true [INHERITED]
  MSP: custom_reports = false (overrides)
    Client: inherits false from MSP
```

Descendants can override, but cannot change the mode or re-delegate.

### DELEGATED

```
Root: api_access = true [DELEGATED]
  MSP: api_access = false (overrides, can re-delegate)
    Client: api_access = true (overrides MSP's value)
```

Descendants can override AND change the mode for their own descendants.

## Creating Permissions

### Via Direct Library

```typescript
await stratum.createPermission(tenantId, {
  key: "manage_users",
  value: true,
  mode: "LOCKED",
  revocation_mode: "CASCADE",
});
```

### Via API

```bash
curl -X POST http://localhost:3001/api/v1/tenants/:id/permissions \
  -H "X-API-Key: sk_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "key": "manage_users",
    "value": true,
    "mode": "LOCKED",
    "revocation_mode": "CASCADE"
  }'
```

## Resolving Permissions

```typescript
const permissions = await stratum.resolvePermissions(tenantId);
```

Each entry includes:

| Field | Description |
|-------|-------------|
| `key` | Permission key |
| `value` | Effective value |
| `mode` | LOCKED, INHERITED, or DELEGATED |
| `source_tenant_id` | Which tenant set this permission |
| `locked` | `true` if locked by an ancestor |
| `delegated` | `true` if the tenant can re-delegate |

## Revocation Modes

When a permission is deleted, the **revocation mode** determines what happens to descendants:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `CASCADE` | Recursively deletes from all descendants | Clean removal |
| `SOFT` | Deletes only from the current tenant | Preserve descendant overrides |
| `PERMANENT` | Cannot be deleted (returns 403) | Critical permissions |

### CASCADE Example

```typescript
// Root has manage_users with CASCADE revocation
// MSP inherits manage_users
// Client inherits manage_users

await stratum.deletePermission(rootId, policyId);
// Result: manage_users removed from Root, MSP, AND Client
```

### SOFT Example

```typescript
// Root has api_access with SOFT revocation
// MSP has its own override of api_access
// Client inherits from MSP

await stratum.deletePermission(rootId, policyId);
// Result: api_access removed from Root only
// MSP and Client keep their values
```

### PERMANENT Example

```typescript
// Root has audit_logs with PERMANENT revocation

try {
  await stratum.deletePermission(rootId, policyId);
} catch (err) {
  // PermissionRevocationDeniedError: Cannot delete permanent permission
}
```

## Updating Permissions

```typescript
await stratum.updatePermission(tenantId, policyId, {
  value: false,
  mode: "DELEGATED",
  revocation_mode: "SOFT",
});
```

### Via API

```bash
curl -X PATCH http://localhost:3001/api/v1/tenants/:id/permissions/:policyId \
  -H "X-API-Key: sk_test_..." \
  -H "Content-Type: application/json" \
  -d '{"value": false, "mode": "DELEGATED"}'
```

## Full Example: MSSP Permission Setup

```typescript
const stratum = new Stratum({ pool });

// Create hierarchy
const mssp = await stratum.createTenant({ name: "AcmeSec", slug: "acmesec" });
const msp = await stratum.createTenant({ name: "NorthStar", slug: "northstar", parent_id: mssp.id });
const client = await stratum.createTenant({ name: "Alpha", slug: "alpha", parent_id: msp.id });

// MSSP locks billing management — no one can change it
await stratum.createPermission(mssp.id, {
  key: "manage_billing",
  value: true,
  mode: "LOCKED",
  revocation_mode: "PERMANENT",
});

// MSSP delegates API access — MSPs can control for their clients
await stratum.createPermission(mssp.id, {
  key: "api_access",
  value: true,
  mode: "DELEGATED",
  revocation_mode: "CASCADE",
});

// MSP restricts API access for its clients
await stratum.createPermission(msp.id, {
  key: "api_access",
  value: false,
  mode: "INHERITED",
  revocation_mode: "SOFT",
});

// Check what Client Alpha sees
const perms = await stratum.resolvePermissions(client.id);
// manage_billing: { value: true, locked: true, mode: "LOCKED" }
// api_access: { value: false, locked: false, mode: "INHERITED" }
```

## Best Practices

1. **Use LOCKED for compliance** — features that must be uniform (audit, billing, security baselines)
2. **Use DELEGATED for MSP control** — let MSPs manage features for their clients
3. **Use CASCADE revocation by default** — cleaner than leaving orphan permissions
4. **Use PERMANENT for critical permissions** — prevents accidental removal
5. **Check `locked` before attempting updates** — avoids `PermissionLockedError` exceptions
