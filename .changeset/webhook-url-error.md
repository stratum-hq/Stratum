---
"@stratum-hq/lib": minor
"@stratum-hq/core": minor
---

feat: export a typed `WebhookUrlValidationError` for webhook-URL validation

Webhook-URL validation (`validateWebhookUrl` / `validateWebhookUrlWithDns`,
used by `createWebhook`, `updateWebhook`, and `testWebhook`) now throws a typed
`WebhookUrlValidationError` instead of a plain `Error`. It extends `StratumError`
with code `WEBHOOK_URL_INVALID` and status 400, so a consumer can turn a rejected
URL into a 400 with `instanceof WebhookUrlValidationError` (or `instanceof
StratumError`) instead of matching the human-readable message. The class is
exported from `@stratum-hq/core` and re-exported from `@stratum-hq/lib`. The
validation logic and messages are unchanged.
