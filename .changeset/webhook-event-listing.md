---
"@stratum-hq/lib": minor
"@stratum-hq/core": minor
---

feat: expose typed webhook event-stream listing

Adds two read methods on the `Stratum` facade so callers can page the webhook
event stream that previously had no typed listing:

- `listWebhookEvents({ tenantId, type?, from?, to?, limit?, offset? })` returns
  `WebhookEvent[]` for a single tenant, newest first. The listing is always
  scoped to `tenantId` (a caller can never page another tenant's events),
  optionally narrowed by event type and a `created_at` window, and paginated
  with `limit` (1-100, default 50) and `offset`.
- `listDeliveriesByEvent(eventId)` returns `WebhookDelivery[]` for a single
  event, newest first.

`core` gains the `ListWebhookEventsQuery` input type. The existing
`listWebhookDeliveries` / delivery methods are unchanged.
