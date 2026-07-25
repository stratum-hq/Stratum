import { z } from "zod";

/**
 * Input to record a single usage event for a tenant.
 *
 * `quantity` defaults to 1 (one countable unit) and must be a non-negative
 * integer — metering counts up; credits / adjustments are out of scope.
 * `occurred_at` is when the usage happened (ISO 8601); it defaults to insert
 * time and is the timestamp aggregation windows filter on, so a back-dated
 * import still lands in the right billing window. `idempotency_key`, when
 * supplied, makes the record idempotent per (tenant, metric): re-recording the
 * same key is a no-op that returns the original event, so an at-least-once
 * producer cannot double count.
 */
export const RecordUsageInputSchema = z.object({
  metric: z.string().min(1).max(128),
  quantity: z.number().int().nonnegative().default(1),
  occurred_at: z.string().datetime().optional(),
  idempotency_key: z.string().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).default({}),
});
// The INPUT type (pre-defaults): `quantity` and `metadata` carry Zod defaults,
// so on the caller side they are optional. `z.infer` (the output type) would
// make them required — see the same caveat in the integration fixtures.
export type RecordUsageInput = z.input<typeof RecordUsageInputSchema>;

export const UsageEventSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  metric: z.string(),
  quantity: z.number(),
  idempotency_key: z.string().nullable(),
  metadata: z.record(z.unknown()),
  occurred_at: z.string(),
  recorded_at: z.string(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

/**
 * Aggregate usage for one tenant over an optional time window. The window is
 * half-open on `occurred_at`: `from` inclusive, `to` exclusive, so adjacent
 * windows never double count the same event at a boundary. Omitting `metric`
 * returns one aggregate row per metric.
 */
export const UsageAggregateQuerySchema = z.object({
  tenant_id: z.string().uuid(),
  metric: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type UsageAggregateQuery = z.infer<typeof UsageAggregateQuerySchema>;

export interface UsageAggregate {
  metric: string;
  total: number;
  event_count: number;
}
