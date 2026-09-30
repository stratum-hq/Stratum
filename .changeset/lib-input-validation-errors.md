---
"@stratum-hq/lib": minor
"@stratum-hq/core": patch
"@stratum-hq/control-plane": patch
---

Report invalid input as a validation error, not as a server or database error.

- `@stratum-hq/lib`: `grantConsent` and `createAbacPolicy` now validate their input with `GrantConsentInputSchema` and `CreateAbacPolicyInputSchema`. Input that PostgreSQL cannot store, such as an out-of-range `priority` or an `expires_at` of `infinity`, now throws a `ValidationError` and writes no row. Before, the call failed with a PostgreSQL error.
- `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for invalid input, with the zod issues in `details.issues`. Before, it threw a `ZodError`.
- `@stratum-hq/core`: `RecordAuditEventInputSchema.sourceIp` now accepts only an IPv4 or IPv6 address, to match the `INET` column.
- `@stratum-hq/control-plane`: the error handler identifies a `ZodError` by its shape, so a `ZodError` from another copy of zod now gets a `400 VALIDATION_ERROR` response instead of a `500`.
