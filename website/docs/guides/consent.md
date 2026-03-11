---
sidebar_position: 14
title: Consent Management
---

# Consent Management

Stratum tracks user and subject consent for data processing purposes, supporting GDPR compliance requirements. Consent records are scoped to tenants and can be granted, revoked, queried, and checked for active status with expiration support.

## Consent Record

Each consent record contains:

| Field | Type | Description |
|-------|------|-------------|
| `tenant_id` | `uuid` | The tenant this consent belongs to |
| `subject_id` | `string` | The user or data subject identifier |
| `purpose` | `string` | The processing purpose being consented to |
| `granted` | `boolean` | Whether consent is currently active |
| `granted_at` | `timestamptz` | When consent was granted |
| `revoked_at` | `timestamptz` | When consent was revoked (null if active) |
| `expires_at` | `timestamptz` | When consent automatically expires (optional) |
| `metadata` | `jsonb` | Additional context (consent version, source, etc.) |

---

## Predefined Purposes

Stratum includes a set of predefined purposes, though the field is extensible:

| Purpose | Description |
|---------|-------------|
| `data_processing` | General data processing consent |
| `analytics` | Usage analytics and reporting |
| `marketing` | Marketing communications |
| `third_party_sharing` | Sharing data with third parties |

You can use any string as a purpose — the predefined values are conventions, not constraints.

---

## Granting Consent

### Via REST API

```bash
curl -X POST http://localhost:3001/api/v1/tenants/TENANT_UUID/consent \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{
    "subject_id": "user_123",
    "purpose": "analytics",
    "expires_at": "2025-12-31T23:59:59Z",
    "metadata": { "consent_version": "2.1", "source": "signup_form" }
  }'
```

### Via SDK

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_...",
});

await s.grantConsent("TENANT_UUID", {
  subject_id: "user_123",
  purpose: "analytics",
  expires_at: "2025-12-31T23:59:59Z",
  metadata: { consent_version: "2.1", source: "signup_form" },
});
```

A unique constraint on `(tenant_id, subject_id, purpose)` ensures that re-granting consent for the same purpose updates the existing record rather than creating a duplicate.

---

## Revoking Consent

### Via REST API

```bash
curl -X DELETE "http://localhost:3001/api/v1/tenants/TENANT_UUID/consent/analytics?subject_id=user_123" \
  -H "X-API-Key: sk_live_..."
```

### Via SDK

```typescript
await s.revokeConsent("TENANT_UUID", "user_123", "analytics");
```

Revoking sets `granted` to `false` and records the `revoked_at` timestamp. The record is preserved for audit purposes.

---

## Listing Consent Records

Retrieve all consent records for a subject within a tenant:

```typescript
const records = await s.listConsent("TENANT_UUID", "user_123");

for (const record of records.data) {
  console.log(`${record.purpose}: ${record.granted ? "active" : "revoked"}`);
}
```

```bash
curl "http://localhost:3001/api/v1/tenants/TENANT_UUID/consent?subject_id=user_123" \
  -H "X-API-Key: sk_live_..."
```

---

## Checking Active Consent

Check whether a subject has active consent for a specific purpose. This check respects expiration — consent that has passed its `expires_at` is treated as inactive.

```typescript
const consent = await s.getActiveConsent("TENANT_UUID", "user_123", "analytics");

if (consent) {
  console.log("Consent is active, granted at:", consent.granted_at);
} else {
  console.log("No active consent — must request permission");
}
```

This is the recommended way to gate data processing operations:

```typescript
async function processAnalytics(tenantId: string, userId: string) {
  const consent = await s.getActiveConsent(tenantId, userId, "analytics");
  if (!consent) {
    throw new Error("Analytics consent not granted");
  }

  // Proceed with analytics processing
}
```

---

## Consent Lifecycle Example

A complete consent lifecycle from grant through revocation:

```typescript
// 1. User grants consent during onboarding
await s.grantConsent("TENANT_UUID", {
  subject_id: "user_123",
  purpose: "marketing",
  expires_at: "2025-06-01T00:00:00Z",
});

// 2. Check consent before sending marketing emails
const consent = await s.getActiveConsent("TENANT_UUID", "user_123", "marketing");
if (consent) {
  await sendMarketingEmail("user_123");
}

// 3. User revokes consent from preferences page
await s.revokeConsent("TENANT_UUID", "user_123", "marketing");

// 4. Subsequent checks return null
const check = await s.getActiveConsent("TENANT_UUID", "user_123", "marketing");
// check → null
```

---

## Notes

- Consent records are tenant-scoped and follow the same tenant access control rules as other resources.
- Expired consent (past `expires_at`) is treated as inactive even if `granted` is `true`.
- All consent operations are recorded in the [audit log](./audit-logging.md).
