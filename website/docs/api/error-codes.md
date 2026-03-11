---
sidebar_position: 2
title: Error Codes
---

# Error Codes

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

## Error Reference

| Code | HTTP Status | Description | Common Cause |
|------|-------------|-------------|--------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication | No `X-API-Key` or `Authorization` header, revoked key, expired JWT |
| `TENANT_NOT_FOUND` | 404 | Tenant ID does not exist | Invalid UUID, tenant never created |
| `TENANT_ARCHIVED` | 410 | Tenant has been archived | Tenant was soft-deleted via `DELETE /tenants/:id` |
| `TENANT_ALREADY_EXISTS` | 409 | Slug collision | Another tenant already uses this slug |
| `HAS_CHILDREN` | 409 | Cannot archive tenant with active children | Archive children first, or move them to another parent |
| `CYCLE_DETECTED` | 409 | Move would create a cycle in the tree | Cannot move a tenant under one of its own descendants |
| `CONFIG_LOCKED` | 409 | Config key is locked by an ancestor | An ancestor set this key with `locked: true` |
| `CONFIG_NOT_FOUND` | 404 | Config key does not exist on this tenant | Key was never set, or was already deleted |
| `PERMISSION_LOCKED` | 409 | Permission is locked by an ancestor | An ancestor set this permission with mode `LOCKED` |
| `PERMISSION_NOT_FOUND` | 404 | Permission policy does not exist | Invalid policy ID |
| `PERMISSION_REVOCATION_DENIED` | 403 | Permission has PERMANENT revocation mode | Cannot delete a permission with `revocation_mode: "PERMANENT"` |
| `VALIDATION_ERROR` | 400 | Request body validation failed | Invalid slug format, missing required fields, limit out of range |
| `MISSING_TENANT` | 400 | Tenant ID could not be resolved from request | SDK middleware couldn't find tenant ID in JWT, header, or resolvers |
| `WEBHOOK_NOT_FOUND` | 404 | Webhook registration does not exist | Invalid webhook ID, or webhook was already deleted |
| `WEBHOOK_DELIVERY_FAILED` | 502 | Webhook delivery failed after all retry attempts | Target URL returned non-2xx response on all 5 attempts |
| `FORBIDDEN` | 403 | Insufficient scope permissions | API key lacks the required scope (`read`, `write`, or `admin`) for the requested operation |
| `REGION_NOT_FOUND` | 404 | Region does not exist | Invalid region ID, or region was deleted |
| `CONSENT_NOT_FOUND` | 404 | Consent record not found | No consent record matches the given subject and purpose |

## Error Hierarchy

All Stratum errors extend `StratumError`, which extends the native `Error` class:

```
Error
  └── StratumError
        ├── UnauthorizedError
        ├── ForbiddenError
        ├── TenantNotFoundError
        ├── TenantArchivedError
        ├── TenantAlreadyExistsError
        ├── TenantHasChildrenError
        ├── TenantCycleDetectedError
        ├── ConfigLockedError
        ├── ConfigNotFoundError
        ├── PermissionLockedError
        ├── PermissionNotFoundError
        ├── PermissionRevocationDeniedError
        ├── WebhookNotFoundError
        ├── WebhookDeliveryFailedError
        ├── RegionNotFoundError
        └── ConsentNotFoundError
```

## Handling Errors

### In the SDK

```typescript
import {
  TenantNotFoundError,
  ConfigLockedError,
  UnauthorizedError,
} from "@stratum/core";

try {
  await client.resolveTenant("bad-id");
} catch (err) {
  if (err instanceof TenantNotFoundError) {
    // Tenant doesn't exist — 404
  }
  if (err instanceof UnauthorizedError) {
    // Invalid API key — 401
  }
}
```

### In the Direct Library

```typescript
import { ConfigLockedError, TenantHasChildrenError } from "@stratum/core";

try {
  await stratum.setConfig(tenantId, "features.siem", { value: false });
} catch (err) {
  if (err instanceof ConfigLockedError) {
    console.error("Cannot override — locked by ancestor:", err.message);
  }
}

try {
  await stratum.deleteTenant(parentId);
} catch (err) {
  if (err instanceof TenantHasChildrenError) {
    console.error("Archive children first");
  }
}
```

### HTTP Error Responses

```bash
# 409 — Config locked by ancestor
curl -X PUT http://localhost:3001/api/v1/tenants/:id/config/features.siem \
  -H "X-API-Key: sk_test_..." \
  -H "Content-Type: application/json" \
  -d '{"value": false}'

# Response:
# {
#   "error": {
#     "code": "CONFIG_LOCKED",
#     "message": "Config key 'features.siem' is locked by tenant abc123"
#   }
# }
```
