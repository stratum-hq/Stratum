-- Migration 020: per-tenant usage metering (FR-58).
--
-- Countable usage events (a metric plus a quantity) per tenant, aggregated per
-- metric over a time window for billing / quota. Adjacent to audit_logs (005)
-- but append-heavy and numeric. `occurred_at` is the event time that
-- aggregation windows filter on (caller-supplied, so a back-dated import lands
-- in the right window); `recorded_at` is ingest time.
--
-- `idempotency_key` makes a record idempotent per (tenant_id, metric): a
-- retried write with the same key is a no-op, so an at-least-once producer
-- cannot double count. Enforced by a partial unique index; NULL keys are
-- unconstrained and can repeat freely.
--
-- The table is tenant-scoped, so it gets the same row-level-security
-- defense-in-depth as migration 019: ENABLE + FORCE + a fail-closed
-- tenant_isolation policy. See docs/adr/0001-postgres-rls-defense-in-depth.md.

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aggregation is always WHERE tenant_id = ? [AND metric = ?] over an
-- occurred_at window, grouped by metric. This composite index serves that path.
CREATE INDEX IF NOT EXISTS idx_usage_tenant_metric_time
  ON usage_events (tenant_id, metric, occurred_at);

-- Idempotency: at most one row per (tenant_id, metric, idempotency_key) when a
-- key is supplied. Partial so unkeyed events (idempotency_key IS NULL) do not
-- collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_idempotency
  ON usage_events (tenant_id, metric, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- RLS: same fail-closed tenant_isolation shape as migration 019. With no
-- context set the predicate is NULL and zero rows are visible; a write with no
-- context is rejected.
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usage_events;
CREATE POLICY tenant_isolation ON usage_events FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
