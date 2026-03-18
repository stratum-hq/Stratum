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

export interface BatchSetConfigKeyResult {
  key: string;
  status: "ok" | "error";
  entry?: ConfigEntry;
  error?: string;
}

export interface BatchSetConfigResult {
  results: BatchSetConfigKeyResult[];
  succeeded: number;
  failed: number;
}

/** Per-key diff entry showing the value and status for one tenant side. */
export interface ConfigDiffEntry {
  value: unknown;
  status: "inherited" | "own" | "locked";
  source: string;
}

/** A single key comparison between two tenants. */
export interface ConfigDiffItem {
  key: string;
  tenant_a: ConfigDiffEntry | null;
  tenant_b: ConfigDiffEntry | null;
}

/** Summary info for a tenant in the diff response. */
export interface ConfigDiffTenantInfo {
  id: string;
  name: string;
}

/** Full config diff response. */
export interface ConfigDiff {
  tenant_a: ConfigDiffTenantInfo;
  tenant_b: ConfigDiffTenantInfo;
  diff: ConfigDiffItem[];
}
