# Usage metering

A minimal, per-tenant usage-metering primitive in `@stratum-hq/lib` (FR-58).
Record countable usage events and aggregate them per metric over a time window
for billing or quota. It is intentionally small: two operations, one table.

## API

```typescript
import { Stratum } from "@stratum-hq/lib";

const stratum = new Stratum({ pool });

// Record a usage event. quantity defaults to 1.
await stratum.recordUsage(tenantId, { metric: "api.calls", quantity: 3 });
await stratum.recordUsage(tenantId, { metric: "seats" });

// Sum + count per metric for a tenant over a window.
const totals = await stratum.aggregateUsage({
  tenant_id: tenantId,
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-08-01T00:00:00.000Z",
});
// -> [{ metric: "api.calls", total: 3, event_count: 1 }, ...]
```

### `recordUsage(tenantId, input)` → `UsageEvent`

`input` (`RecordUsageInput`):

| Field             | Type                       | Notes |
|-------------------|----------------------------|-------|
| `metric`          | `string` (1–128 chars)     | Required. The counter name, e.g. `api.calls`, `seats`. |
| `quantity`        | `number` (int, ≥ 0)        | Defaults to `1`. Metering counts up; credits/adjustments are out of scope. |
| `occurred_at`     | ISO 8601 `string`          | When the usage happened. Defaults to insert time. This is the timestamp aggregation windows filter on, so a back-dated import lands in the right window. |
| `idempotency_key` | `string` (1–255 chars)     | Optional. Makes the write idempotent per `(tenant, metric)`. |
| `metadata`        | `Record<string, unknown>`  | Optional JSON blob. Defaults to `{}`. |

Input is validated (`RecordUsageInputSchema`); an empty metric or a negative /
fractional quantity is rejected.

**Idempotency.** When `idempotency_key` is set, a second call with the same key
for the same `(tenant, metric)` is a no-op that returns the already-stored event
unchanged, so an at-least-once producer (retries, redelivery) cannot double
count. The same key under a different metric is a distinct event. Unkeyed events
are never deduplicated.

### `aggregateUsage(query)` → `UsageAggregate[]`

`query` (`UsageAggregateQuery`): `{ tenant_id, metric?, from?, to? }`. Returns
one row per metric (`{ metric, total, event_count }`), ordered by metric.
Metrics with no matching events are absent.

- Always scoped to a single `tenant_id`, so tenant A's totals never include
  tenant B's events.
- The window is **half-open on `occurred_at`: `from` inclusive, `to`
  exclusive** (`occurred_at >= from AND occurred_at < to`). Adjacent windows
  therefore never double count an event that sits exactly on a boundary.
- `total` and `event_count` are returned as JS numbers. `total` is a `SUM` over
  a `BIGINT` column; a total beyond `Number.MAX_SAFE_INTEGER` would lose
  precision.

## Schema (`usage_events`, migration 020)

```sql
CREATE TABLE usage_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL,
  quantity        BIGINT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  idempotency_key TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- event time (aggregation window)
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()   -- ingest time
);

-- Serves the aggregation path: WHERE tenant_id = ? [AND metric = ?] over an
-- occurred_at window, grouped by metric.
CREATE INDEX idx_usage_tenant_metric_time
  ON usage_events (tenant_id, metric, occurred_at);

-- Idempotency: at most one row per (tenant_id, metric, idempotency_key) when a
-- key is supplied. Partial so unkeyed events do not collide.
CREATE UNIQUE INDEX uq_usage_idempotency
  ON usage_events (tenant_id, metric, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

`ON DELETE CASCADE`: purging a tenant removes its usage events (unlike
`audit_logs`, which are retained for the audit trail).

## Tenant isolation

Two independent layers, matching the rest of the library:

1. **Application.** `aggregateUsage` always filters `WHERE tenant_id = ?`.
2. **Database (defense in depth).** `usage_events` is tenant-scoped, so
   migration 020 gives it the same fail-closed row-level-security policy as
   migration 019 (`ENABLE` + `FORCE` + `tenant_isolation`). Under a data-plane
   tenant context, a query with no `WHERE` clause still sees only that tenant's
   rows, and a write stamped for another tenant is rejected. See
   [ADR-0001](adr/0001-postgres-rls-defense-in-depth.md).
