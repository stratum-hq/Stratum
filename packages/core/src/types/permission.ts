import { z } from "zod";

export const PermissionMode = {
  LOCKED: "LOCKED",
  INHERITED: "INHERITED",
  DELEGATED: "DELEGATED",
} as const;

export type PermissionMode =
  (typeof PermissionMode)[keyof typeof PermissionMode];

export const RevocationMode = {
  CASCADE: "CASCADE",
  SOFT: "SOFT",
  PERMANENT: "PERMANENT",
} as const;

export type RevocationMode =
  (typeof RevocationMode)[keyof typeof RevocationMode];

export const PermissionPolicySchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  key: z.string().min(1).max(255),
  value: z.unknown().default(true),
  mode: z.nativeEnum(PermissionMode).default(PermissionMode.INHERITED),
  revocation_mode: z
    .nativeEnum(RevocationMode)
    .default(RevocationMode.CASCADE),
  source_tenant_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

export const CreatePermissionInputSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.unknown().default(true),
  mode: z.nativeEnum(PermissionMode).default(PermissionMode.INHERITED),
  revocation_mode: z
    .nativeEnum(RevocationMode)
    .default(RevocationMode.CASCADE),
});

export type CreatePermissionInput = z.infer<typeof CreatePermissionInputSchema>;

export const UpdatePermissionInputSchema = z.object({
  value: z.unknown().optional(),
  mode: z.nativeEnum(PermissionMode).optional(),
  revocation_mode: z.nativeEnum(RevocationMode).optional(),
});

export type UpdatePermissionInput = z.infer<typeof UpdatePermissionInputSchema>;
