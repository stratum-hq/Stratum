---
"@stratum-hq/lib": patch
---

fix: return webhook-listing timestamps as strings and order deterministically

`listWebhookEvents` and `listDeliveriesByEvent` now cast their timestamp columns
(`created_at`, `next_retry_at`, `completed_at`) to text in the SELECT, so the
returned rows honor the `string` type declared by `WebhookEvent` /
`WebhookDelivery` instead of handing back `Date` objects. Both listings also add
an `id` tiebreaker (`ORDER BY created_at DESC, id DESC`) so pagination is
deterministic when rows share a timestamp. This matches the convention already
used by `queryAuditLogs` and the usage-metering queries.
