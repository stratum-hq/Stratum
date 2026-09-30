---
"@stratum-hq/core": minor
"@stratum-hq/control-plane": minor
---

Input schemas are now stricter, and the control plane rejects some requests that it accepted before. This is a deliberate tightening. Some of the values that the schemas now reject were valid in PostgreSQL and succeeded before this release.

The control plane returns `400 VALIDATION_ERROR` for these values:

- `CreateAbacPolicyInputSchema.priority` must be in the `INTEGER` range, -2147483648 to 2147483647. Before this release, a value outside that range caused a `500`.
- `GrantConsentInputSchema.expires_at` must be an ISO 8601 datetime with a time zone (`Z` or an offset such as `+02:00`). `POST /api/v1/tenants/:tenantId/consent` returned `201` for these forms before, and now returns `400`:
  - a date without a time, such as `2027-12-31`
  - a datetime without a time zone, such as `2027-12-31T00:00:00`
  - the PostgreSQL special values `infinity` and `epoch`

  Send a full datetime with a time zone, such as `2027-12-31T00:00:00Z`.
- `RecordUsageInputSchema.quantity` must be at most `Number.MAX_SAFE_INTEGER` (2^53 - 1). Before this release, a quantity from 2^53 up to the `BIGINT` limit (about 9.2e18) succeeded, and a larger quantity caused a `500`.
- The datetime fields of `GrantConsentInputSchema`, `RecordUsageInputSchema`, `UsageAggregateQuerySchema`, `AuditLogQuerySchema`, and `RecordAuditEventInputSchema` reject year 0000, which PostgreSQL has no value for.
