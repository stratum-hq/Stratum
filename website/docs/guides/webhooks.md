---
sidebar_position: 8
title: Webhooks
---

# Webhooks

Stratum emits HTTP callbacks when tenant lifecycle events occur. Register a webhook URL to receive real-time notifications for tenant creation, config changes, permission updates, and more.

## Event Types

| Event | Trigger |
|-------|---------|
| `tenant.created` | A new tenant was created |
| `tenant.updated` | A tenant's name, slug, or metadata was updated |
| `tenant.deleted` | A tenant was archived (soft-deleted) |
| `tenant.moved` | A tenant was moved to a new parent |
| `config.updated` | A config key was set or overridden |
| `config.deleted` | A config key was removed |
| `permission.created` | A permission policy was created |
| `permission.updated` | A permission policy was updated |
| `permission.deleted` | A permission policy was deleted |

---

## Registering a Webhook

### Via REST API

```bash
curl -X POST http://localhost:3001/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{
    "url": "https://your-app.example.com/webhooks/stratum",
    "secret": "your-signing-secret",
    "events": ["tenant.created", "tenant.updated", "tenant.deleted"]
  }'
```

Subscribe to all events with `"events": ["*"]`.

To scope a webhook to a specific tenant subtree, add `tenant_id`:

```bash
curl -X POST http://localhost:3001/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{
    "url": "https://your-app.example.com/webhooks/stratum",
    "secret": "your-signing-secret",
    "events": ["*"],
    "tenant_id": "TENANT_UUID"
  }'
```

### Via SDK

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_...",
});

const webhook = await s.webhooks.create({
  url: "https://your-app.example.com/webhooks/stratum",
  secret: "your-signing-secret",
  events: ["tenant.created", "tenant.updated"],
});

console.log(webhook.id);
```

---

## Webhook Payload

Every delivery is an HTTP POST with a JSON body:

```json
{
  "id": "evt_uuid",
  "type": "tenant.created",
  "created_at": "2024-01-01T00:00:00.000Z",
  "data": {
    "tenant": {
      "id": "uuid",
      "name": "Acme Corp",
      "slug": "acme_corp",
      "parent_id": null,
      "isolation_strategy": "SHARED_RLS",
      "status": "active",
      "depth": 0,
      "ancestry_path": "/uuid",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### Headers

| Header | Value | Description |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Always JSON |
| `X-Stratum-Event` | `tenant.created` | Event type |
| `X-Stratum-Delivery-ID` | `uuid` | Unique delivery ID |
| `X-Stratum-Signature` | `sha256=abc123...` | HMAC-SHA256 signature |
| `X-Stratum-Timestamp` | `2024-01-01T00:00:00.000Z` | Delivery timestamp |

---

## Verifying Signatures

Every delivery includes an `X-Stratum-Signature` header containing the HMAC-SHA256 signature of the raw request body, computed using your webhook's registered secret. Secrets are stored encrypted (AES-256-GCM) and decrypted only at delivery time.

### Node.js Verification

```typescript
import crypto from "crypto";

function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const received = signature.replace("sha256=", "");

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
}
```

### Express Endpoint Example

```typescript
import express from "express";
import crypto from "crypto";

const app = express();

// Use raw body parser to preserve the exact bytes for signature verification
app.post(
  "/webhooks/stratum",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-stratum-signature"] as string;
    const secret = process.env.WEBHOOK_SECRET!;

    if (!verifyWebhookSignature(req.body, signature, secret)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(req.body.toString());

    switch (event.type) {
      case "tenant.created":
        console.log("New tenant:", event.data.tenant.name);
        break;
      case "tenant.deleted":
        console.log("Archived tenant:", event.data.tenant.id);
        break;
      default:
        console.log("Unhandled event:", event.type);
    }

    res.status(200).json({ received: true });
  },
);
```

:::warning
Always use `express.raw()` (not `express.json()`) to preserve the exact request body bytes. Parsing and re-serializing JSON changes whitespace and key ordering, which will cause signature verification to fail.
:::

---

## Retry Behavior

If your endpoint returns a non-2xx response or times out, Stratum retries with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts, the delivery is marked `failed` and no further retries occur. The delivery record remains visible in the deliveries list for debugging.

Your endpoint must respond within **10 seconds**. For long-running processing, respond immediately with `200 OK` and handle the event asynchronously.

---

## Managing Webhooks

### List All Webhooks

```typescript
const webhooks = await s.webhooks.list();
```

```bash
curl http://localhost:3001/api/v1/webhooks \
  -H "X-API-Key: sk_live_..."
```

### Update a Webhook

```typescript
await s.webhooks.update(webhookId, {
  events: ["tenant.created", "config.updated"],
  active: true,
});
```

### Disable a Webhook

```typescript
await s.webhooks.update(webhookId, { active: false });
```

### Delete a Webhook

```typescript
await s.webhooks.delete(webhookId);
```

```bash
curl -X DELETE http://localhost:3001/api/v1/webhooks/WEBHOOK_ID \
  -H "X-API-Key: sk_live_..."
```

---

## Viewing Delivery History

```typescript
const deliveries = await s.webhooks.listDeliveries(webhookId);
```

```bash
curl http://localhost:3001/api/v1/webhooks/WEBHOOK_ID/deliveries \
  -H "X-API-Key: sk_live_..."
```

Response:

```json
{
  "data": [
    {
      "id": "uuid",
      "webhook_id": "uuid",
      "event_type": "tenant.created",
      "status": "delivered",
      "response_status": 200,
      "attempt_count": 1,
      "next_retry_at": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "delivered_at": "2024-01-01T00:00:00.500Z"
    }
  ]
}
```

---

## Testing Your Endpoint

Send a synthetic test event to your webhook URL without triggering a real tenant mutation:

```typescript
const result = await s.webhooks.test(webhookId);
console.log(result.status); // "delivered"
```

```bash
curl -X POST http://localhost:3001/api/v1/webhooks/WEBHOOK_ID/test \
  -H "X-API-Key: sk_live_..."
```

This sends a `webhook.test` event with a sample payload to the registered URL using the same delivery pipeline as real events, including signature headers and retry logic.

---

## Security

### Secret Encryption

Webhook secrets are encrypted at rest using AES-256-GCM. Set the `WEBHOOK_ENCRYPTION_KEY` environment variable in production:

```bash
export WEBHOOK_ENCRYPTION_KEY="your-random-32-char-key-here"
```

In development, a deterministic fallback key is used automatically (not suitable for production).

### SSRF Protection

Stratum validates all webhook URLs before delivery to prevent Server-Side Request Forgery (SSRF) attacks. The following targets are blocked:

- Private IP ranges (10.x, 172.16-31.x, 192.168.x)
- Loopback addresses (127.x, ::1)
- Link-local addresses (169.254.x, fe80:)
- Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
- Non-HTTP protocols

### Tenant-Scoped Authorization

Webhook routes enforce tenant-scoped access control. API keys scoped to a specific tenant can only manage webhooks belonging to that tenant. Global (unscoped) API keys have full access to all webhooks.

---

## Database Schema

Webhook data is stored in three tables (created by migration `004_webhooks`):

| Table | Purpose |
|-------|---------|
| `webhooks` | Webhook registrations (URL, encrypted secret, event filters) |
| `webhook_events` | Pending and processed event records |
| `webhook_deliveries` | Per-delivery tracking with status and retry state |
