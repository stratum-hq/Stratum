import pg from "pg";
import { withClient } from "../pool-helpers.js";
import {
  RecordUsageInputSchema,
  type RecordUsageInput,
  type UsageEvent,
  type UsageAggregate,
  type UsageAggregateQuery,
} from "@stratum-hq/core";

// quantity is BIGINT and occurred_at / recorded_at are TIMESTAMPTZ, both of
// which pg returns as strings. We select them cast to text and map quantity to
// a JS number so callers get a UsageEvent, mirroring how audit-service returns
// created_at::text.
interface UsageEventRow {
  id: string;
  tenant_id: string;
  metric: string;
  quantity: string;
  idempotency_key: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  recorded_at: string;
}

const RETURNING_COLUMNS = `id, tenant_id, metric, quantity::text as quantity, idempotency_key,
  metadata, occurred_at::text as occurred_at, recorded_at::text as recorded_at`;

function toUsageEvent(row: UsageEventRow): UsageEvent {
  return { ...row, quantity: Number(row.quantity) };
}

/**
 * Record a usage event for a tenant. Returns the stored event.
 *
 * When `idempotency_key` is set, a second call with the same key for the same
 * (tenant, metric) is a no-op and returns the already-stored event unchanged,
 * so at-least-once producers cannot double count.
 */
export async function recordUsage(
  pool: pg.Pool,
  tenantId: string,
  input: RecordUsageInput,
): Promise<UsageEvent> {
  const parsed = RecordUsageInputSchema.parse(input);
  return withClient(pool, async (client) => {
    const res = await client.query<UsageEventRow>(
      `INSERT INTO usage_events (tenant_id, metric, quantity, idempotency_key, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
       ON CONFLICT (tenant_id, metric, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING ${RETURNING_COLUMNS}`,
      [
        tenantId,
        parsed.metric,
        parsed.quantity,
        parsed.idempotency_key ?? null,
        JSON.stringify(parsed.metadata),
        parsed.occurred_at ?? null,
      ],
    );
    if (res.rows[0]) {
      return toUsageEvent(res.rows[0]);
    }
    // Conflict on the idempotency key: an event already exists. Return it
    // unchanged so recording is a safe no-op on retry.
    const existing = await client.query<UsageEventRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM usage_events
       WHERE tenant_id = $1 AND metric = $2 AND idempotency_key = $3`,
      [tenantId, parsed.metric, parsed.idempotency_key],
    );
    return toUsageEvent(existing.rows[0]);
  });
}

/**
 * Aggregate a tenant's usage per metric over an optional half-open window
 * [from, to) on occurred_at. Always scoped to one tenant, so tenant A's totals
 * never include tenant B's events. Metrics with no matching events are absent
 * from the result.
 */
export async function aggregateUsage(
  pool: pg.Pool,
  query: UsageAggregateQuery,
): Promise<UsageAggregate[]> {
  return withClient(pool, async (client) => {
    const conditions: string[] = ["tenant_id = $1"];
    const values: unknown[] = [query.tenant_id];
    let idx = 2;

    if (query.metric !== undefined) {
      conditions.push(`metric = $${idx++}`);
      values.push(query.metric);
    }
    if (query.from !== undefined) {
      conditions.push(`occurred_at >= $${idx++}`);
      values.push(query.from);
    }
    if (query.to !== undefined) {
      conditions.push(`occurred_at < $${idx++}`);
      values.push(query.to);
    }

    const res = await client.query<{ metric: string; total: string; event_count: string }>(
      `SELECT metric, COALESCE(SUM(quantity), 0)::text as total, COUNT(*)::text as event_count
       FROM usage_events
       WHERE ${conditions.join(" AND ")}
       GROUP BY metric
       ORDER BY metric`,
      values,
    );
    return res.rows.map((r) => ({
      metric: r.metric,
      total: Number(r.total),
      event_count: Number(r.event_count),
    }));
  });
}
