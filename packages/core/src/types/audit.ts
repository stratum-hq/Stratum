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
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
