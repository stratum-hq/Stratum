---
"@stratum-hq/lib": minor
"@stratum-hq/core": minor
---

feat: per-tenant usage metering primitive (FR-58)

Add `recordUsage` and `aggregateUsage` to `Stratum` for countable per-tenant
usage events with per-metric aggregation over a half-open time window. Events
persist to a new `usage_events` table (migration 020) with optional
idempotency keys and the same fail-closed RLS tenant isolation as migration
019. New core types: `RecordUsageInput`, `UsageEvent`, `UsageAggregate`,
`UsageAggregateQuery`.
