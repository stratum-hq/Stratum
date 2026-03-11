---
sidebar_position: 13
title: API Key Management
---

# API Key Management

Stratum provides full lifecycle management for API keys, including creation with expiration, atomic rotation, and dormant key detection. API keys are the primary authentication mechanism for service-to-service integrations.

## Creating an API Key

Create a key with an optional expiration date:

### Via REST API

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{
    "tenant_id": "TENANT_UUID",
    "name": "Production Integration",
    "expires_at": "2025-12-31T23:59:59Z"
  }'
```

### Via SDK

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_...",
});

const key = await s.createApiKey("TENANT_UUID", "Production Integration", {
  expires_at: "2025-12-31T23:59:59Z",
});

console.log(key.id);      // Key ID for management operations
console.log(key.api_key);  // The secret key — only returned at creation
```

:::warning
The full API key value is only returned once at creation time. Store it securely — it cannot be retrieved later.
:::

---

## Listing Keys

List all API keys for a tenant:

```typescript
const keys = await s.listApiKeys("TENANT_UUID");

for (const key of keys.data) {
  console.log(key.name, key.expires_at, key.last_used_at);
}
```

```bash
curl "http://localhost:3001/api/v1/api-keys?tenant_id=TENANT_UUID" \
  -H "X-API-Key: sk_live_..."
```

The response includes metadata but never the key value itself:

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Production Integration",
      "tenant_id": "TENANT_UUID",
      "scopes": ["read", "write"],
      "expires_at": "2025-12-31T23:59:59Z",
      "last_used_at": "2024-11-15T10:30:00Z",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Rotating a Key

Rotation atomically creates a new key and revokes the old one in a single transaction. This eliminates the window where both old and new keys are valid.

```typescript
const rotated = await s.rotateApiKey("KEY_UUID");

console.log(rotated.api_key);  // New secret key
console.log(rotated.id);       // New key ID (old key is revoked)
```

```bash
curl -X POST http://localhost:3001/api/v1/api-keys/KEY_UUID/rotate \
  -H "X-API-Key: sk_live_..."
```

The old key is immediately invalidated. Any in-flight requests using the old key will fail authentication.

---

## Expiration

Expired keys are automatically rejected during validation. No background job is needed — the check happens at authentication time.

```typescript
// Create a key that expires in 30 days
const key = await s.createApiKey("TENANT_UUID", "Short-Lived Key", {
  expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
});
```

After the `expires_at` timestamp passes, any request using this key receives a `401 Unauthorized` response:

```json
{
  "error": "Unauthorized",
  "message": "API key has expired"
}
```

---

## Dormant Key Detection

Find keys that have not been used within a specified period. Dormant keys are a security risk and should be reviewed or revoked.

```typescript
const dormant = await s.listDormantKeys(90); // Unused for 90+ days

for (const key of dormant.data) {
  console.log(`${key.name} last used: ${key.last_used_at ?? "never"}`);
}
```

```bash
curl "http://localhost:3001/api/v1/api-keys/dormant?days=90" \
  -H "X-API-Key: sk_live_..."
```

---

## Revoking a Key

Delete a key to permanently revoke it:

```typescript
await s.deleteApiKey("KEY_UUID");
```

```bash
curl -X DELETE http://localhost:3001/api/v1/api-keys/KEY_UUID \
  -H "X-API-Key: sk_live_..."
```

---

## Best Practices

- **Set expiration dates** — avoid creating keys that live forever. Use `expires_at` to enforce regular rotation.
- **Rotate regularly** — use the rotation endpoint to cycle keys without downtime.
- **Monitor dormant keys** — run dormant key checks on a schedule and revoke unused keys.
- **Scope to tenants** — always scope keys to the narrowest tenant necessary. See [Authorization & Scopes](./authorization.md).
- **Use descriptive names** — name keys after their integration or purpose (`"GitHub Actions CI"`, `"Billing Service"`) for easy auditing.
- **Log key usage** — all key operations are recorded in the [audit log](./audit-logging.md).
