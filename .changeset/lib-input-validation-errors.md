---
"@stratum-hq/lib": minor
"@stratum-hq/core": minor
"@stratum-hq/control-plane": patch
---

Report invalid input as a validation error, not as a server or database error.

Breaking for some callers: `@stratum-hq/lib` now rejects input that it stored before, and `recordAuditEvent` throws a different error class.

- `@stratum-hq/lib`: `grantConsent` validates its input with `GrantConsentInputSchema`. It now throws a `ValidationError` and writes no row for:
  - an empty `subject_id` or `purpose`.
  - an `expires_at` that is only a date (`2026-12-31`), or a date and time without a time zone offset (`2026-12-31T00:00:00`). Before, PostgreSQL stored these values, and it read a time without an offset in the time zone of the database session.
  - an `expires_at` that PostgreSQL cannot store, such as `infinity`. Before, the call failed with a PostgreSQL error.
- `@stratum-hq/lib`: `createAbacPolicy` validates its input with `CreateAbacPolicyInputSchema`. It now throws a `ValidationError` and writes no row for:
  - an empty `name`, `resource_type` or `action`, or a condition with an empty `attribute` or an unknown `operator`. Before, the policy was stored.
  - a `priority` that is not an integer from -2147483648 to 2147483647. Before, the call failed with a PostgreSQL error.
- `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for invalid input, with the zod issues in `details.issues`. Before, it threw a `ZodError`. A check such as `err instanceof ZodError` no longer matches. Check `err instanceof ValidationError` instead.
- `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for a `sourceIp` that is not an IP address. Before, the call failed with a PostgreSQL error.
- `@stratum-hq/core`: `RecordAuditEventInputSchema.sourceIp` now accepts only an IPv4 or IPv6 address, with an optional `/prefix` (`203.0.113.7`, `10.0.0.0/8`, `2001:db8::1/128`). This matches the `INET` column. The `source_ip` value that `queryAuditLogs` returns, such as `203.0.113.7/32`, is accepted. The schema rejects an IPv6 zone index (`fe80::1%eth0`) and an IPv4 address with leading zeros (`010.0.0.1`). Before, the schema accepted any string.
- `@stratum-hq/control-plane`: the error handler identifies a `ZodError` by its shape, so a `ZodError` from another copy of zod now gets a `400 VALIDATION_ERROR` response instead of a `500`.
