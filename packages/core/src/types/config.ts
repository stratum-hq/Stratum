import { z } from "zod";

export const ConfigEntrySchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  key: z.string().min(1).max(255),
  value: z.unknown(),
  inherited: z.boolean().default(false),
  source_tenant_id: z.string().uuid(),
  locked: z.boolean().default(false),
  sensitive: z.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ConfigEntry = z.infer<typeof ConfigEntrySchema>;

export const SetConfigInputSchema = z.object({
  value: z.unknown(),
  locked: z.boolean().default(false),
  sensitive: z.boolean().default(false),
});

export type SetConfigInput = z.infer<typeof SetConfigInputSchema>;

export interface ResolvedConfigEntry {
  key: string;
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
}

export type ResolvedConfig = Record<string, ResolvedConfigEntry>;
