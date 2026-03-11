import pg from "pg";
import { withTransaction, withClient } from "../pool-helpers.js";
import {
  type ConfigEntry,
  type SetConfigInput,
  type ResolvedConfigEntry,
  type ResolvedConfig,
  ConfigLockedError,
  ConfigNotFoundError,
  TenantNotFoundError,
  parseAncestryPath,
} from "@stratum/core";

/**
 * Resolve the effective config for a tenant by batch-loading ancestor configs
 * in a single query and walking root→leaf.
 */
export async function resolveConfig(pool: pg.Pool, tenantId: string): Promise<ResolvedConfig> {
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

    // Single query: batch-load all config entries for the ancestor chain
    const entriesRes = await client.query<ConfigEntry>(
      `SELECT * FROM config_entries WHERE tenant_id = ANY($1)`,
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
          // Key is locked by an ancestor — skip child overrides
          continue;
        }

        const isCurrentTenant = currentTenantId === tenantId;
        resolved.set(entry.key, {
          key: entry.key,
          value: entry.value,
          source_tenant_id: entry.source_tenant_id,
          inherited: !isCurrentTenant,
          locked: entry.locked,
        });
      }
    }

    return Object.fromEntries(resolved);
  });
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
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(tenantId);
    }

    const ancestorIds = parseAncestryPath(tenantRes.rows[0].ancestry_path);
    // Check ancestor locks (ancestry_path excludes self)
    if (ancestorIds.length > 0) {
      const lockedRes = await client.query<ConfigEntry>(
        `SELECT * FROM config_entries
         WHERE tenant_id = ANY($1)
           AND key = $2
           AND locked = true`,
        [ancestorIds, key],
      );
      if (lockedRes.rows.length > 0) {
        const locker = lockedRes.rows[0];
        throw new ConfigLockedError(key, locker.source_tenant_id);
      }
    }

    const res = await client.query<ConfigEntry>(
      `INSERT INTO config_entries (tenant_id, key, value, locked, source_tenant_id, inherited)
       VALUES ($1, $2, $3, $4, $1, false)
       ON CONFLICT (tenant_id, key)
       DO UPDATE SET
         value = EXCLUDED.value,
         locked = EXCLUDED.locked,
         updated_at = now()
       RETURNING *`,
      [tenantId, key, JSON.stringify(input.value), input.locked ?? false],
    );

    return res.rows[0];
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
 */
export async function getConfigWithInheritance(
  pool: pg.Pool,
  tenantId: string,
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

    const entriesRes = await client.query<ConfigEntry>(
      `SELECT * FROM config_entries WHERE tenant_id = ANY($1)`,
      [allIds],
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
        // Key is locked — show ancestor's locked value regardless of tenant override
        result[key] = {
          key,
          value: lockedEntry.value,
          source_tenant_id: lockedEntry.source_tenant_id,
          inherited: true,
          locked: true,
        };
      } else if (tenantEntry) {
        // Tenant has its own value (override or own entry)
        result[key] = {
          key,
          value: tenantEntry.value,
          source_tenant_id: tenantEntry.source_tenant_id,
          inherited: false,
          locked: tenantEntry.locked,
        };
      } else if (ancestorEntry) {
        // Inherited from ancestor
        result[key] = {
          key,
          value: ancestorEntry.value,
          source_tenant_id: ancestorEntry.source_tenant_id,
          inherited: true,
          locked: ancestorEntry.locked,
        };
      }
    }

    return result;
  });
}
