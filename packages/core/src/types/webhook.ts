import { z } from "zod";

export const TenantEvent = {
  TENANT_CREATED: "tenant.created",
  TENANT_UPDATED: "tenant.updated",
  TENANT_DELETED: "tenant.deleted",
  TENANT_MOVED: "tenant.moved",
  TENANT_SUSPENDED: "tenant.suspended",
  TENANT_RESUMED: "tenant.resumed",
  TENANT_ARCHIVED: "tenant.archived",
  TENANT_PURGED: "tenant.purged",
  CONFIG_UPDATED: "config.updated",
  CONFIG_DELETED: "config.deleted",
  PERMISSION_CREATED: "permission.created",
  PERMISSION_UPDATED: "permission.updated",
  PERMISSION_DELETED: "permission.deleted",
} as const;
export type TenantEvent = (typeof TenantEvent)[keyof typeof TenantEvent];

export const WebhookSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  url: z.string().url(),
  secret_hash: z.string(),
  events: z.array(z.string()),
  active: z.boolean().default(true),
  description: z.string().max(255).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

export const CreateWebhookInputSchema = z.object({
  tenant_id: z.string().uuid().nullable().default(null),
  url: z.string().url(),
  secret: z.string().min(16).max(255),
  events: z.array(z.nativeEnum(TenantEvent)).min(1),
  description: z.string().max(255).optional(),
});
// The INPUT type (pre-defaults): `tenant_id` carries a Zod default, so it is
// optional on the caller side. `z.infer` (the output type) would make it
// required.
export type CreateWebhookInput = z.input<typeof CreateWebhookInputSchema>;

export const UpdateWebhookInputSchema = z.object({
  url: z.string().url().optional(),
  secret: z.string().min(16).max(255).optional(),
  events: z.array(z.nativeEnum(TenantEvent)).min(1).optional(),
  active: z.boolean().optional(),
  description: z.string().max(255).optional(),
});
export type UpdateWebhookInput = z.input<typeof UpdateWebhookInputSchema>;

export const WebhookEventSchema = z.object({
  id: z.string().uuid(),
  type: z.nativeEnum(TenantEvent),
  tenant_id: z.string().uuid(),
  data: z.record(z.unknown()),
  created_at: z.string().datetime(),
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/** Filter for listing a tenant's webhook events (newest first, paginated). */
export interface ListWebhookEventsQuery {
  /** Tenant whose events to page. Required: a caller never pages another tenant. */
  tenantId: string;
  /** Restrict to a single event type. */
  type?: TenantEvent;
  /** Only events created at or after this ISO-8601 timestamp. */
  from?: string;
  /** Only events created at or before this ISO-8601 timestamp. */
  to?: string;
  /** Page size, 1-100. Defaults to 50. */
  limit?: number;
  /** Rows to skip for pagination. Defaults to 0. */
  offset?: number;
}

export const WebhookDeliveryStatus = {
  PENDING: "pending",
  SUCCESS: "success",
  FAILED: "failed",
} as const;
export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

export const WebhookDeliverySchema = z.object({
  id: z.string().uuid(),
  webhook_id: z.string().uuid(),
  event_id: z.string().uuid(),
  status: z.nativeEnum(WebhookDeliveryStatus),
  attempts: z.number().int().min(0),
  next_retry_at: z.string().datetime().nullable(),
  last_error: z.string().nullable(),
  response_code: z.number().int().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
