---
"@stratum-hq/core": patch
"@stratum-hq/control-plane": patch
---

Input schemas now reject values that the PostgreSQL column types reject, so the control plane returns `400 VALIDATION_ERROR` instead of `500`:

- `CreateAbacPolicyInputSchema.priority` must be in the `INTEGER` range, -2147483648 to 2147483647.
- `GrantConsentInputSchema.expires_at` must be an ISO 8601 datetime with a time zone (`Z` or an offset). Strings such as `infinity` and `epoch` are rejected.
- `RecordUsageInputSchema.quantity` must be at most `Number.MAX_SAFE_INTEGER`.
- The datetime fields of `GrantConsentInputSchema`, `RecordUsageInputSchema`, `UsageAggregateQuerySchema`, `AuditLogQuerySchema`, and `RecordAuditEventInputSchema` reject year 0000, which PostgreSQL has no value for.
