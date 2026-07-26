import { z } from "zod";

export interface AuditContext {
  actor_id: string;
  actor_type: "api_key" | "jwt" | "system";
  source_ip?: string;
  request_id?: string;
}

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string(),
  actor_type: z.string(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  tenant_id: z.string().uuid().nullable(),
  source_ip: z.string().nullable(),
  request_id: z.string().nullable(),
  before_state: z.record(z.unknown()).nullable(),
  after_state: z.record(z.unknown()).nullable(),
  metadata: z.record(z.unknown()),
  created_at: z.string().datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditLogQuerySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  action: z.string().optional(),
  resource_type: z.string().optional(),
  actor_id: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});
// The INPUT type (pre-defaults): `limit` carries a Zod default (and coerces),
// so it is optional on the caller side. `z.infer` (the output type) would make
// it required.
export type AuditLogQuery = z.input<typeof AuditLogQuerySchema>;

/**
 * Input to append a custom audit event through the public facade. Stratum owns
 * `audit_logs`, so a consumer records its own events here instead of writing the
 * table directly. `tenantId` is required and the row is always stamped for that
 * tenant and no other. `actorType` matches the actor_type CHECK
 * ('api_key' | 'jwt' | 'system') and defaults to 'system'. `sourceIp` lands in
 * the INET column, so it must be a valid IP; Postgres normalizes it (a bare IPv4
 * round-trips as `x/32`). `occurredAt` sets the row's `created_at`, so a consumer
 * can seed historical / backdated events; omit it and the row is stamped now().
 * It accepts an ISO 8601 datetime string or a `Date`. The recorded row is
 * queryable via queryAuditLogs.
 */
export const RecordAuditEventInputSchema = z.object({
  tenantId: z.string().uuid(),
  actorId: z.string().min(1),
  actorType: z.enum(["api_key", "jwt", "system"]).default("system"),
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().nullable(),
  before: z.record(z.unknown()).nullable().optional(),
  after: z.record(z.unknown()).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  sourceIp: z.string().nullable().optional(),
  occurredAt: z
    .union([z.string().datetime({ offset: true }), z.date()])
    .optional(),
});
// The INPUT type (pre-defaults): `actorType` and `metadata` carry Zod defaults,
// so they are optional on the caller side. `z.infer` (the output type) would
// make them required.
export type RecordAuditEventInput = z.input<typeof RecordAuditEventInputSchema>;
