import { z } from "zod";

export const IsolationStrategy = {
  SHARED_RLS: "SHARED_RLS",
  SCHEMA_PER_TENANT: "SCHEMA_PER_TENANT",
  DB_PER_TENANT: "DB_PER_TENANT",
} as const;

export type IsolationStrategy =
  (typeof IsolationStrategy)[keyof typeof IsolationStrategy];

export const TenantStatus = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;

export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const TenantNodeSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  ancestry_path: z.string(),
  depth: z.number().int().min(0),
  name: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  config: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
  isolation_strategy: z.nativeEnum(IsolationStrategy).default(IsolationStrategy.SHARED_RLS),
  status: z.nativeEnum(TenantStatus).default(TenantStatus.ACTIVE),
  region_id: z.string().uuid().nullable().optional(),
  deleted_at: z.string().datetime().nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type TenantNode = z.infer<typeof TenantNodeSchema>;

export const CreateTenantInputSchema = z.object({
  parent_id: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, {
    message:
      "Slug must start with a lowercase letter, contain only lowercase letters, numbers, and underscores, and be at most 63 characters",
  }),
  config: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
  isolation_strategy: z
    .nativeEnum(IsolationStrategy)
    .default(IsolationStrategy.SHARED_RLS),
  region_id: z.string().uuid().nullable().optional(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantInputSchema>;

export const UpdateTenantInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .optional(),
  config: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateTenantInput = z.infer<typeof UpdateTenantInputSchema>;

export const MoveTenantInputSchema = z.object({
  new_parent_id: z.string().uuid(),
});

export type MoveTenantInput = z.infer<typeof MoveTenantInputSchema>;

export interface TenantContext {
  tenant_id: string;
  ancestry_path: string;
  depth: number;
  resolved_config: Record<string, unknown>;
  resolved_permissions: Record<string, ResolvedPermission>;
  isolation_strategy: IsolationStrategy;
}

export interface ResolvedPermission {
  key: string;
  value: unknown;
  mode: string;
  source_tenant_id: string;
  locked: boolean;
  delegated: boolean;
}
