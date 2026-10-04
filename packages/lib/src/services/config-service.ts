import pg from "pg";
import { withTransaction, withClient } from "../pool-helpers.js";
import {
  type ConfigEntry,
  type SetConfigInput,
  type BatchSetConfigEntry,
  type ResolvedConfigEntry,
  type ResolvedConfig,
  type ResolveConfigOptions,
  type BatchSetConfigResult,
  type BatchSetConfigKeyResult,
  ConfigLockedError,
  ConfigNotFoundError,
  TenantNotFoundError,
  TenantArchivedError,
  parseAncestryPath,
} from "@stratum-hq/core";
import { encrypt, decrypt } from "../crypto.js";
import { loadActiveTenant } from "./tenant-service.js";

/**
 * Build the resolved entry for a stored `entry` read at `tenantId`.
 *
 * A sensitive value set on another tenant (an ancestor) is masked: `value` is
 * null and `masked` is true, and it is never decrypted. `options` reveals it
 * to trusted server code (`revealSensitive`) or to the tenant that set it
 * (`viewerTenantId`). A tenant's own sensitive values are always decrypted.
 */
function toResolvedEntry(
  entry: ConfigEntry,
  tenantId: string,
  inherited: boolean,
  locked: boolean,
  options: ResolveConfigOptions,
): ResolvedConfigEntry {
  const resolved: ResolvedConfigEntry = {
    key: entry.key,
    value: entry.value,
    source_tenant_id: entry.source_tenant_id,
    inherited,
    locked,
  };
  if (!entry.sensitive) return resolved;
  resolved.sensitive = true;
  const reveal =
    entry.tenant_id === tenantId ||
    options.revealSensitive === true ||
    (options.viewerTenantId !== undefined && options.viewerTenantId === entry.source_tenant_id);
  if (reveal) {
    resolved.value = JSON.parse(decrypt(entry.value as string));
  } else {
    resolved.value = null;
    resolved.masked = true;
  }
  return resolved;
}

/**
 * Resolve the effective config for a tenant by batch-loading ancestor configs
 * in a single query and walking root→leaf.
 *
 * Sensitive values inherited from an ancestor come back masked unless
 * `options` reveals them (see {@link ResolveConfigOptions}).
 */
export async function resolveConfig(
  pool: pg.Pool,
  tenantId: string,
  options: ResolveConfigOptions = {},
): Promise<ResolvedConfig> {
  return withClient(pool, async (client) => {
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1 AND status != 'archived'`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      // Distinguish archived vs truly missing
      const archivedRes = await client.query<{ id: string }>(
        `SELECT id FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if (archivedRes.rows.length > 0) {
        throw new TenantArchivedError(tenantId);
      }
      throw new TenantNotFoundError(tenantId);
    }

    const ancestryPath = tenantRes.rows[0].ancestry_path;
    const ancestorIds = parseAncestryPath(ancestryPath);
    const allIds = [...ancestorIds, tenantId];

    // Single query: batch-load all config entries for the ancestor chain
    // Only include non-archived tenants to prevent archived ancestors from participating in inheritance
    const entriesRes = await client.query<ConfigEntry>(
      `SELECT ce.* FROM config_entries ce
       JOIN tenants t ON t.id = ce.tenant_id
       WHERE ce.tenant_id = ANY($1) AND t.status != 'archived'`,
      [allIds],
    );

    // Group by tenant_id preserving order
    const byTenant = new Map<string, ConfigEntry[]>();
    for (const id of allIds) {
      byTenant.set(id, []);
    }
    for (const entry of entriesRes.rows) {
      const list = byTenant.get(entry.tenant_id);
      if (list) {
        list.push(entry);
      }
    }

    // Walk root→leaf: locked parent values propagate and block overrides
    const resolved = new Map<string, ResolvedConfigEntry>();

    for (const currentTenantId of allIds) {
      const entries = byTenant.get(currentTenantId) ?? [];

      for (const entry of entries) {
        const existing = resolved.get(entry.key);

        if (existing?.locked) {
          // Key is locked by an ancestor; skip child overrides
          continue;
        }

        const isCurrentTenant = currentTenantId === tenantId;
        resolved.set(
          entry.key,
          toResolvedEntry(entry, tenantId, !isCurrentTenant, entry.locked, options),
        );
      }
    }

    return Object.fromEntries(resolved);
  });
}

/**
 * Load which of `keys` are marked sensitive, inside the write's transaction:
 * by an ancestor of the tenant (archived ancestors included), or by the
 * tenant's own stored entry.
 */
async function loadSensitiveKeys(
  client: pg.PoolClient,
  tenantId: string,
  ancestorIds: string[],
  keys: string[],
): Promise<{ byAncestor: Set<string>; own: Set<string> }> {
  const byAncestor = new Set<string>();
  const own = new Set<string>();
  if (keys.length === 0) return { byAncestor, own };
  const res = await client.query<{ tenant_id: string; key: string }>(
    `SELECT ce.tenant_id, ce.key FROM config_entries ce
     WHERE ce.tenant_id = ANY($1)
       AND ce.key = ANY($2)
       AND ce.sensitive = true`,
    [[...ancestorIds, tenantId], keys],
  );
  for (const row of res.rows) {
    (row.tenant_id === tenantId ? own : byAncestor).add(row.key);
  }
  return { byAncestor, own };
}

/**
 * The sensitive flag a write stores. A key that an ancestor marked sensitive
 * stays sensitive whatever the write asks. A key the tenant itself marked
 * sensitive stays sensitive unless the write passes `sensitive: false`.
 */
function effectiveSensitive(
  key: string,
  requested: boolean | undefined,
  sensitiveKeys: { byAncestor: Set<string>; own: Set<string> },
): boolean {
  if (sensitiveKeys.byAncestor.has(key)) return true;
  return requested ?? sensitiveKeys.own.has(key);
}

/**
 * Set (upsert) a config key for a tenant.
 * Rejects if the key is locked by an ancestor.
 */
export async function setConfig(
  pool: pg.Pool,
  tenantId: string,
  key: string,
  input: SetConfigInput,
): Promise<ConfigEntry> {
  return withTransaction(pool, async (client) => {
    const tenant = await loadActiveTenant(client, tenantId);

    const ancestorIds = parseAncestryPath(tenant.ancestry_path);
    // Check ancestor locks (ancestry_path excludes self).
    // Only enforce locks from non-archived ancestors, consistent with resolveConfig.
    if (ancestorIds.length > 0) {
      const lockedRes = await client.query<ConfigEntry>(
        `SELECT ce.* FROM config_entries ce
         JOIN tenants t ON t.id = ce.tenant_id
         WHERE ce.tenant_id = ANY($1)
           AND ce.key = $2
           AND ce.locked = true
           AND t.status != 'archived'`,
        [ancestorIds, key],
      );
      if (lockedRes.rows.length > 0) {
        const locker = lockedRes.rows[0];
        throw new ConfigLockedError(key, locker.source_tenant_id);
      }
    }

    const sensitiveKeys = await loadSensitiveKeys(client, tenantId, ancestorIds, [key]);
    const sensitive = effectiveSensitive(key, input.sensitive, sensitiveKeys);
    const storedValue = sensitive
      ? JSON.stringify(encrypt(JSON.stringify(input.value)))
      : JSON.stringify(input.value);

    const res = await client.query<ConfigEntry>(
      `INSERT INTO config_entries (tenant_id, key, value, locked, sensitive, source_tenant_id, inherited)
       VALUES ($1, $2, $3, $4, $5, $1, false)
       ON CONFLICT (tenant_id, key)
       DO UPDATE SET
         value = EXCLUDED.value,
         locked = EXCLUDED.locked,
         sensitive = EXCLUDED.sensitive,
         updated_at = now()
       RETURNING *`,
      [tenantId, key, storedValue, input.locked ?? false, sensitive],
    );

    return res.rows[0];
  });
}

/**
 * Return why a batch entry cannot be written, or null when it can.
 * The value must serialize to JSON because config_entries.value is JSONB NOT NULL.
 */
function invalidBatchEntryReason(entry: BatchSetConfigEntry): string | null {
  if (typeof entry.key !== "string" || entry.key.length === 0) {
    return "Config key must be a non-empty string";
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(entry.value);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    return `Config '${entry.key}' has a value that cannot be stored as JSON`;
  }
  return null;
}

/**
 * Set multiple config keys for a tenant in a single, atomic transaction.
 *
 * Every entry is checked before anything is written. If any key is locked by
 * an active ancestor or is invalid, the whole batch is rolled back: nothing is
 * written, `rolled_back` is true, and each result has status "error". The
 * offending keys carry their own reason; the rest name the keys that caused
 * the rollback.
 */
export async function batchSetConfig(
  pool: pg.Pool,
  tenantId: string,
  entries: BatchSetConfigEntry[],
): Promise<BatchSetConfigResult> {
  return withTransaction(pool, async (client) => {
    const tenant = await loadActiveTenant(client, tenantId);

    const ancestorIds = parseAncestryPath(tenant.ancestry_path);
    const keys = entries.map((e) => e.key);

    // Batch-load all ancestor locks in a single query.
    // Only enforce locks from non-archived ancestors, consistent with setConfig.
    const lockedKeys = new Map<string, string>();
    if (ancestorIds.length > 0 && keys.length > 0) {
      const lockedRes = await client.query<ConfigEntry>(
        `SELECT ce.* FROM config_entries ce
         JOIN tenants t ON t.id = ce.tenant_id
         WHERE ce.tenant_id = ANY($1)
           AND ce.key = ANY($2)
           AND ce.locked = true
           AND t.status != 'archived'`,
        [ancestorIds, keys],
      );
      for (const row of lockedRes.rows) {
        lockedKeys.set(row.key, row.source_tenant_id);
      }
    }

    // Check every entry before writing anything.
    const failures = new Map<number, string>();
    entries.forEach((entry, i) => {
      const invalid = invalidBatchEntryReason(entry);
      if (invalid) {
        failures.set(i, invalid);
        return;
      }
      const lockerTenantId = lockedKeys.get(entry.key);
      if (lockerTenantId) {
        failures.set(
          i,
          `Config '${entry.key}' is locked by tenant ${lockerTenantId} and cannot be overridden`,
        );
      }
    });

    if (failures.size > 0) {
      const failedKeys = [...failures.keys()].map((i) => `'${entries[i].key}'`).join(", ");
      const rolledBack = `Not applied: the batch was rolled back because ${failedKeys} failed`;
      return {
        results: entries.map((entry, i) => ({
          key: entry.key,
          status: "error" as const,
          error: failures.get(i) ?? rolledBack,
        })),
        succeeded: 0,
        failed: entries.length,
        rolled_back: true,
      };
    }

    const sensitiveKeys = await loadSensitiveKeys(client, tenantId, ancestorIds, keys);
    const results: BatchSetConfigKeyResult[] = [];
    let succeeded = 0;

    for (const entry of entries) {
      const sensitive = effectiveSensitive(entry.key, entry.sensitive, sensitiveKeys);
      const storedValue = sensitive
        ? JSON.stringify(encrypt(JSON.stringify(entry.value)))
        : JSON.stringify(entry.value);

      const res = await client.query<ConfigEntry>(
        `INSERT INTO config_entries (tenant_id, key, value, locked, sensitive, source_tenant_id, inherited)
         VALUES ($1, $2, $3, $4, $5, $1, false)
         ON CONFLICT (tenant_id, key)
         DO UPDATE SET
           value = EXCLUDED.value,
           locked = EXCLUDED.locked,
           sensitive = EXCLUDED.sensitive,
           updated_at = now()
         RETURNING *`,
        [tenantId, entry.key, storedValue, entry.locked ?? false, sensitive],
      );
      results.push({
        key: entry.key,
        status: "ok",
        entry: res.rows[0],
      });
      succeeded++;
    }

    return { results, succeeded, failed: 0, rolled_back: false };
  });
}

/**
 * Delete a config override for a tenant, revealing the inherited parent value.
 */
export async function deleteConfig(
  pool: pg.Pool,
  tenantId: string,
  key: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const res = await client.query(
      `DELETE FROM config_entries WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key],
    );
    if (res.rowCount === 0) {
      throw new ConfigNotFoundError(tenantId, key);
    }
  });
}

/**
 * Return all config entries for a tenant showing inheritance status:
 * inherited (from ancestor), overridden (tenant has own value), or locked.
 *
 * Inherited sensitive values are masked as in {@link resolveConfig}.
 */
export async function getConfigWithInheritance(
  pool: pg.Pool,
  tenantId: string,
  options: ResolveConfigOptions = {},
): Promise<ResolvedConfig> {
  return withClient(pool, async (client) => {
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(tenantId);
    }

    const ancestryPath = tenantRes.rows[0].ancestry_path;
    const ancestorIds = parseAncestryPath(ancestryPath);
    const allIds = [...ancestorIds, tenantId];

    // Archived ancestors do not participate in inheritance or locking,
    // consistent with resolveConfig and setConfig.
    const entriesRes = await client.query<ConfigEntry>(
      `SELECT ce.* FROM config_entries ce
       JOIN tenants t ON t.id = ce.tenant_id
       WHERE ce.tenant_id = ANY($1)
         AND (ce.tenant_id = $2 OR t.status != 'archived')`,
      [allIds, tenantId],
    );

    // Group entries by tenant_id for ordered traversal
    const entriesByTenantId = new Map<string, ConfigEntry[]>();
    for (const entry of entriesRes.rows) {
      const list = entriesByTenantId.get(entry.tenant_id) ?? [];
      list.push(entry);
      entriesByTenantId.set(entry.tenant_id, list);
    }

    // Walk allIds root→leaf to ensure correct ordering
    const byKey = new Map<
      string,
      {
        ancestorEntry: ConfigEntry | null;
        tenantEntry: ConfigEntry | null;
        lockedBy: ConfigEntry | null;
      }
    >();

    for (const id of allIds) {
      const entries = entriesByTenantId.get(id) ?? [];
      for (const entry of entries) {
        if (!byKey.has(entry.key)) {
          byKey.set(entry.key, {
            ancestorEntry: null,
            tenantEntry: null,
            lockedBy: null,
          });
        }
        const rec = byKey.get(entry.key)!;

        if (id === tenantId) {
          rec.tenantEntry = entry;
        } else {
          // Walking root→leaf, so later entries are deeper ancestors (closer to tenant)
          rec.ancestorEntry = entry;
          if (entry.locked && !rec.lockedBy) {
            // First lock encountered (shallowest ancestor) takes precedence
            rec.lockedBy = entry;
          }
        }
      }
    }

    const result: ResolvedConfig = {};

    for (const [key, rec] of byKey) {
      const lockedEntry = rec.lockedBy;
      const tenantEntry = rec.tenantEntry;
      const ancestorEntry = rec.ancestorEntry;

      if (lockedEntry) {
        // Key is locked: show ancestor's locked value regardless of tenant override
        result[key] = toResolvedEntry(lockedEntry, tenantId, true, true, options);
      } else if (tenantEntry) {
        // Tenant has its own value (override or own entry)
        result[key] = toResolvedEntry(tenantEntry, tenantId, false, tenantEntry.locked, options);
      } else if (ancestorEntry) {
        // Inherited from ancestor
        result[key] = toResolvedEntry(ancestorEntry, tenantId, true, ancestorEntry.locked, options);
      }
    }

    return result;
  });
}
