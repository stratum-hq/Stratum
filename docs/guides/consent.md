# Consent Management

Track per-tenant, per-subject consent records with purpose, expiration, and metadata for GDPR compliance.

## Overview

Consent records track whether a specific subject (user, device, etc.) has granted permission for a specific purpose within a tenant's scope. Each record includes:

- **Subject** — who gave consent (user ID, email, etc.)
- **Purpose** — what the consent is for
- **Status** — granted or revoked, with timestamps
- **Expiration** — optional automatic expiry
- **Metadata** — custom data (IP address, preferences, etc.)

## Predefined Purposes

Stratum provides standard consent purposes as constants:

| Constant | Value |
|----------|-------|
| `DATA_PROCESSING` | `data_processing` |
| `ANALYTICS` | `analytics` |
| `MARKETING` | `marketing` |
| `THIRD_PARTY_SHARING` | `third_party_sharing` |

You can also use any custom string as a purpose.

## API Usage

### Grant Consent

```bash
curl -X POST http://localhost:3001/api/v1/tenants/TENANT_UUID/consent \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_id": "user-456",
    "purpose": "marketing",
    "expires_at": "2025-12-31T23:59:59Z",
    "metadata": { "ip": "10.0.0.1", "source": "signup_form" }
  }'
```

Response:

```json
{
  "id": "uuid",
  "tenant_id": "tenant-uuid",
  "subject_id": "user-456",
  "purpose": "marketing",
  "granted": true,
  "granted_at": "2024-06-15T10:30:00.000Z",
  "revoked_at": null,
  "expires_at": "2025-12-31T23:59:59.000Z",
  "metadata": { "ip": "10.0.0.1", "source": "signup_form" },
  "created_at": "2024-06-15T10:30:00.000Z",
  "updated_at": "2024-06-15T10:30:00.000Z"
}
```

Granting consent for an existing (tenant, subject, purpose) combination updates the existing record — it clears `revoked_at` and refreshes `granted_at`.

### List Consent Records

```bash
# All records for a tenant
curl http://localhost:3001/api/v1/tenants/TENANT_UUID/consent \
  -H "X-API-Key: YOUR_KEY"

# Filter by subject
curl "http://localhost:3001/api/v1/tenants/TENANT_UUID/consent?subject_id=user-456" \
  -H "X-API-Key: YOUR_KEY"
```

### Revoke Consent

```bash
curl -X DELETE "http://localhost:3001/api/v1/tenants/TENANT_UUID/consent/marketing?subject_id=user-456" \
  -H "X-API-Key: YOUR_KEY"
```

Returns `200 OK` with `{ "success": true }` on success, `404` if no matching record exists.

## Library Usage

```typescript
import { Stratum } from "@stratum/lib";

// Grant consent
const record = await stratum.grantConsent("tenant-uuid", {
  subject_id: "user-456",
  purpose: "analytics",
  expires_at: "2025-12-31T23:59:59Z",
  metadata: { source: "settings_page" },
});

// List all consent for a subject
const records = await stratum.listConsent("tenant-uuid", "user-456");

// Check if active consent exists
const active = await stratum.getActiveConsent(
  "tenant-uuid",
  "user-456",
  "analytics",
);
// Returns null if revoked or expired

// Revoke consent
await stratum.revokeConsent("tenant-uuid", "user-456", "analytics");
```

## Active Consent Check

`getActiveConsent()` returns the record only if:
- `granted = true`
- `expires_at` is null OR in the future

This makes it easy to gate features on valid consent:

```typescript
const consent = await stratum.getActiveConsent(tenantId, userId, "analytics");
if (consent) {
  // User has active analytics consent — track the event
  trackEvent(userId, event);
}
```

## Data Export

Consent records are included in GDPR data exports (`GET /api/v1/tenants/:id/export`) and are purged when a tenant is hard-deleted via `POST /api/v1/tenants/:id/purge`.
