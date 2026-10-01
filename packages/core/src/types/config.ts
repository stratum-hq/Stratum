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

// The INPUT type (pre-defaults): `locked` and `sensitive` carry Zod defaults,
// so they are optional on the caller side. `z.infer` (the output type) would
// make them required, so `setConfig(id, key, { value })` would not compile.
export type SetConfigInput = z.input<typeof SetConfigInputSchema>;

/**
 * One entry in a {@link batchSetConfig} call: a {@link SetConfigInput} plus the
 * `key` it targets. Deriving it from `SetConfigInput` keeps the batch and
 * single-key surfaces from drifting apart.
 */
export type BatchSetConfigEntry = SetConfigInput & { key: string };

export interface ResolvedConfigEntry {
  key: string;
  /** The value, or `null` when `masked` is true. */
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
  /** Present and true when the value was set with `sensitive: true`. */
  sensitive?: boolean;
  /**
   * Present and true when a sensitive value inherited from an ancestor was
   * withheld from this read. `value` is then `null`; `source_tenant_id` names
   * the tenant that set it.
   */
  masked?: boolean;
}

/** Options for reading a tenant's resolved config. */
export interface ResolveConfigOptions {
  /**
   * Return sensitive values inherited from ancestors decrypted. By default they
   * come back masked. Only for trusted server-side code that needs the secret
   * itself; do not pass the result back to a client.
   */
  revealSensitive?: boolean;
  /**
   * The tenant the reader acts for. An inherited sensitive value that this
   * tenant set is returned decrypted; any other stays masked.
   */
  viewerTenantId?: string;
}

export type ResolvedConfig = Record<string, ResolvedConfigEntry>;

export interface BatchSetConfigKeyResult {
  key: string;
  status: "ok" | "error";
  entry?: ConfigEntry;
  error?: string;
}

/**
 * The outcome of a batch config write. The batch is atomic: when any entry is
 * locked by an ancestor or invalid, nothing is written, `rolled_back` is true,
 * `succeeded` is 0, and every result has status `"error"`. The entries that
 * caused the rollback carry their own reason; the others say they were not
 * applied because of those keys.
 */
export interface BatchSetConfigResult {
  results: BatchSetConfigKeyResult[];
  succeeded: number;
  failed: number;
  /** True when the batch was rolled back and nothing was written. */
  rolled_back?: boolean;
}

/** Per-key diff entry showing the value and status for one tenant side. */
export interface ConfigDiffEntry {
  value: unknown;
  status: "inherited" | "own" | "locked";
  source: string;
  /** Present and true when an inherited sensitive value was withheld (see {@link ResolvedConfigEntry.masked}). */
  masked?: boolean;
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

export type DriftStatus = "ok" | "override" | "missing" | "conflict";

export interface DriftDetail {
  key: string;
  status: DriftStatus;
  parentValue?: unknown;
  childValue?: unknown;
  locked: boolean;
}

export interface DriftResult {
  tenant_id: string;
  tenant_name: string;
  status: DriftStatus; // worst status across all keys
  overrides: number;
  missing: number;
  conflicts: number;
  details: DriftDetail[];
}

export interface BatchDriftResult {
  parent_id: string;
  parent_name: string;
  results: DriftResult[];
  summary: {
    ok: number;
    override: number;
    missing: number;
    conflict: number;
  };
}
