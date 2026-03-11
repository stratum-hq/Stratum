---
sidebar_position: 6
title: Config Inheritance
---

# Config Inheritance

Stratum's config system lets you define key-value settings that flow down the tenant tree with inheritance and lock semantics.

## How It Works

Config values are resolved by walking the ancestor chain from **root to leaf**. Each tenant can:
- **Inherit** a value from its parent (default)
- **Override** a value with its own
- **Lock** a value to prevent descendants from overriding

```
Root: max_users = 1000
  MSP: max_users = 500        ← overrides root's value
    Client: (no override)     ← inherits 500 from MSP
```

## Setting Config

### Via Direct Library

```typescript
// Set a value (unlocked — children can override)
await stratum.setConfig(tenantId, "max_users", {
  value: 1000,
  locked: false,
});

// Set a locked value (children cannot override)
await stratum.setConfig(tenantId, "features.siem", {
  value: true,
  locked: true,
});
```

### Via API

```bash
# Set unlocked
curl -X PUT http://localhost:3001/api/v1/tenants/:id/config/max_users \
  -H "X-API-Key: sk_test_..." \
  -H "Content-Type: application/json" \
  -d '{"value": 1000, "locked": false}'

# Set locked
curl -X PUT http://localhost:3001/api/v1/tenants/:id/config/features.siem \
  -H "X-API-Key: sk_test_..." \
  -H "Content-Type: application/json" \
  -d '{"value": true, "locked": true}'
```

## Resolving Config

Resolution walks the ancestor chain and returns the effective value for each key:

```typescript
const config = await stratum.resolveConfig(childTenantId);
```

Each entry in the result includes:

| Field | Description |
|-------|-------------|
| `value` | The effective value |
| `source_tenant_id` | Which tenant set this value |
| `inherited` | `true` if the value came from an ancestor |
| `locked` | `true` if locked by an ancestor |

### Example

```
AcmeSec (root)
  max_users = 1000 (unlocked)
  features.siem = true (LOCKED)
  features.edr = false (unlocked)

NorthStar MSP (child of AcmeSec)
  max_users = 500 (override)
  features.edr = true (override)

Client Alpha (child of NorthStar)
  max_users = 50 (override)
```

Resolving config for **Client Alpha**:

```json
{
  "max_users": {
    "value": 50,
    "source_tenant_id": "client-alpha-uuid",
    "inherited": false,
    "locked": false
  },
  "features.siem": {
    "value": true,
    "source_tenant_id": "acmesec-uuid",
    "inherited": true,
    "locked": true
  },
  "features.edr": {
    "value": true,
    "source_tenant_id": "northstar-uuid",
    "inherited": true,
    "locked": false
  }
}
```

## Lock Semantics

When a key is locked:
- No descendant can set or update that key
- Attempting to do so throws `ConfigLockedError` (HTTP 409)
- The locked value is visible to all descendants with `locked: true`

```typescript
// Root locks a key
await stratum.setConfig(rootId, "features.siem", {
  value: true,
  locked: true,
});

// Child tries to override — FAILS
try {
  await stratum.setConfig(childId, "features.siem", { value: false });
} catch (err) {
  // ConfigLockedError: "features.siem" is locked by ancestor
}
```

## Deleting Config

Deleting a config override restores inheritance from the parent:

```typescript
// Child has max_users = 50 (override)
await stratum.deleteConfig(childId, "max_users");

// Now child inherits max_users from parent (500)
const config = await stratum.resolveConfig(childId);
// config.max_users.value === 500, inherited === true
```

### Via API

```bash
curl -X DELETE http://localhost:3001/api/v1/tenants/:id/config/max_users \
  -H "X-API-Key: sk_test_..."
```

## Config Inheritance View

Get the full inheritance chain for debugging:

```typescript
const inheritance = await stratum.getConfigWithInheritance(tenantId);
```

### Via API

```bash
curl http://localhost:3001/api/v1/tenants/:id/config/inheritance \
  -H "X-API-Key: sk_test_..."
```

## Best Practices

1. **Lock sparingly** — only lock keys that must be uniform across all descendants (compliance settings, mandatory features)
2. **Use dot notation** for key names (`features.siem`, `limits.max_users`) to organize logically
3. **Set defaults at the root** — children inherit automatically without needing explicit config
4. **Use the inheritance view** to debug unexpected values — it shows which ancestor set each key
