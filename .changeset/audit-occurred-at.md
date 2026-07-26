---
"@stratum-hq/core": minor
"@stratum-hq/lib": minor
---

feat: allow recordAuditEvent to set an explicit occurredAt timestamp

`RecordAuditEventInput` gains an optional `occurredAt` (ISO 8601 datetime string
or `Date`). When provided it sets the row's `created_at`, so a consumer seeding
historical or backdated audit events can control the timestamp; when omitted the
row is stamped `now()` exactly as before, so existing callers are unaffected. The
value is validated by Zod and an invalid timestamp is rejected before the write.
