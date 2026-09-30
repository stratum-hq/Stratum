import pg from "pg";
import { withTransaction, withClient } from "../pool-helpers.js";
import {
  type PermissionPolicy,
  type CreatePermissionInput,
  type UpdatePermissionInput,
  type ResolvedPermission,
  PermissionMode,
  RevocationMode,
  PermissionLockedError,
  PermissionNotFoundError,
  PermissionRevocationDeniedError,
  ForbiddenError,
  TenantNotFoundError,
  parseAncestryPath,
  appendToPath,
} from "@stratum-hq/core";

/**
 * Resolve effective permissions for a tenant by batch-loading all ancestor
 * permission policies in a single query and walking root→leaf.
 */
export async function resolvePermissions(
  pool: pg.Pool,
  tenantId: string,
): Promise<Record<string, ResolvedPermission>> {
  return withClient(pool, async (client) => {
    // Load the tenant's ancestry path
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(tenantId);
    }

    const ancestryPath = tenantRes.rows[0].ancestry_path;
    const ancestorIds = parseAncestryPath(ancestryPath);
    // Include self
    const allIds = [...ancestorIds, tenantId];

    // Single query: batch-load all policies for the entire ancestor chain
    const policiesRes = await client.query<PermissionPolicy>(
      `SELECT * FROM permission_policies WHERE tenant_id = ANY($1)`,
      [allIds],
    );

    // Group by tenant_id, maintaining insertion order
    const byTenant = new Map<string, PermissionPolicy[]>();
    for (const id of allIds) {
      byTenant.set(id, []);
    }
    for (const policy of policiesRes.rows) {
      const list = byTenant.get(policy.tenant_id);
      if (list) {
        list.push(policy);
      }
    }

    // Walk root→leaf applying mode semantics
    const resolved = new Map<string, ResolvedPermission>();

    for (const currentTenantId of allIds) {
      const policies = byTenant.get(currentTenantId) ?? [];

      for (const policy of policies) {
        const existing = resolved.get(policy.key);

        if (existing?.locked) {
          // Key is LOCKED by an ancestor — descendants cannot override it
          continue;
        }

        switch (policy.mode) {
          case PermissionMode.LOCKED:
            resolved.set(policy.key, {
              policy_id: policy.id,
              key: policy.key,
              value: policy.value,
              mode: policy.mode,
              source_tenant_id: currentTenantId,
              locked: true,
              delegated: false,
            });
            break;

          case PermissionMode.DELEGATED:
            resolved.set(policy.key, {
              policy_id: policy.id,
              key: policy.key,
              value: policy.value,
              mode: policy.mode,
              source_tenant_id: currentTenantId,
              locked: false,
              delegated: true,
            });
            break;

          case PermissionMode.INHERITED:
          default:
            resolved.set(policy.key, {
              policy_id: policy.id,
              key: policy.key,
              value: policy.value,
              mode: policy.mode,
              source_tenant_id: currentTenantId,
              locked: false,
              delegated: false,
            });
            break;
        }
      }
    }

    return Object.fromEntries(resolved);
  });
}

/**
 * Enforce ancestor delegation modes on a descendant write. A LOCKED ancestor
 * blocks the key entirely. An INHERITED ancestor lets descendants override the
 * value only: they may not change the mode or re-delegate the key.
 */
function assertAncestorsAllowMode(
  ancestorPolicies: PermissionPolicy[],
  key: string,
  mode: PermissionMode,
): void {
  const locker = ancestorPolicies.find((p) => p.mode === PermissionMode.LOCKED);
  if (locker) {
    throw new PermissionLockedError(key, locker.source_tenant_id);
  }
  if (ancestorPolicies.length > 0 && mode !== PermissionMode.INHERITED) {
    throw new ForbiddenError(
      `Permission '${key}' is INHERITED from an ancestor; descendants may override its value but not change its mode or re-delegate it`,
    );
  }
}

/**
 * Create a new permission policy for a tenant.
 * Rejects if the key is already LOCKED by an ancestor.
 */
export async function createPermission(
  pool: pg.Pool,
  tenantId: string,
  input: CreatePermissionInput,
): Promise<PermissionPolicy> {
  return withTransaction(pool, async (client) => {
    // Load ancestry to check for locked ancestor permissions
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(tenantId);
    }

    const ancestorIds = parseAncestryPath(tenantRes.rows[0].ancestry_path);
    // Exclude self (ancestry_path does not include self)
    if (ancestorIds.length > 0) {
      const restrictingRes = await client.query<PermissionPolicy>(
        `SELECT * FROM permission_policies
         WHERE tenant_id = ANY($1)
           AND key = $2
           AND mode = ANY($3)`,
        [ancestorIds, input.key, [PermissionMode.LOCKED, PermissionMode.INHERITED]],
      );
      assertAncestorsAllowMode(
        restrictingRes.rows,
        input.key,
        input.mode ?? PermissionMode.INHERITED,
      );
    }

    const res = await client.query<PermissionPolicy>(
      `INSERT INTO permission_policies (tenant_id, key, value, mode, revocation_mode, source_tenant_id)
       VALUES ($1, $2, $3, $4, $5, $1)
       RETURNING *`,
      [
        tenantId,
        input.key,
        JSON.stringify(input.value ?? true),
        input.mode ?? PermissionMode.INHERITED,
        input.revocation_mode ?? RevocationMode.CASCADE,
      ],
    );

    return res.rows[0];
  });
}

/**
 * Update a permission policy, enforcing LOCKED constraints.
 */
export async function updatePermission(
  pool: pg.Pool,
  tenantId: string,
  policyId: string,
  input: UpdatePermissionInput,
): Promise<PermissionPolicy> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<PermissionPolicy>(
      `SELECT * FROM permission_policies WHERE id = $1 AND tenant_id = $2`,
      [policyId, tenantId],
    );
    if (existing.rows.length === 0) {
      throw new PermissionNotFoundError(policyId);
    }
    const current = existing.rows[0];

    // Check if an ancestor has LOCKED this key
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(tenantId);
    }
    const ancestorIds = parseAncestryPath(tenantRes.rows[0].ancestry_path);
    if (ancestorIds.length > 0) {
      const restrictingRes = await client.query<PermissionPolicy>(
        `SELECT * FROM permission_policies
         WHERE tenant_id = ANY($1)
           AND key = $2
           AND mode = ANY($3)`,
        [ancestorIds, current.key, [PermissionMode.LOCKED, PermissionMode.INHERITED]],
      );
      assertAncestorsAllowMode(
        restrictingRes.rows,
        current.key,
        input.mode ?? current.mode,
      );
    }

    // A PERMANENT policy cannot be deleted, so it must not be possible to
    // switch it to a deletable revocation mode either.
    if (
      current.revocation_mode === RevocationMode.PERMANENT &&
      input.revocation_mode !== undefined &&
      input.revocation_mode !== RevocationMode.PERMANENT
    ) {
      throw new PermissionRevocationDeniedError(current.key);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.value !== undefined) {
      sets.push(`value = $${idx++}`);
      values.push(JSON.stringify(input.value));
    }
    if (input.mode !== undefined) {
      sets.push(`mode = $${idx++}`);
      values.push(input.mode);
    }
    if (input.revocation_mode !== undefined) {
      sets.push(`revocation_mode = $${idx++}`);
      values.push(input.revocation_mode);
    }

    if (sets.length === 0) {
      return current;
    }

    sets.push(`updated_at = now()`);
    values.push(policyId);

    const res = await client.query<PermissionPolicy>(
      `UPDATE permission_policies SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );

    return res.rows[0];
  });
}

/**
 * Delete a permission policy, handling CASCADE / SOFT / PERMANENT revocation modes.
 */
export async function deletePermission(
  pool: pg.Pool,
  tenantId: string,
  policyId: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<PermissionPolicy>(
      `SELECT * FROM permission_policies WHERE id = $1 AND tenant_id = $2`,
      [policyId, tenantId],
    );
    if (existing.rows.length === 0) {
      throw new PermissionNotFoundError(policyId);
    }
    const policy = existing.rows[0];

    switch (policy.revocation_mode) {
      case RevocationMode.PERMANENT:
        throw new PermissionRevocationDeniedError(policy.key);

      case RevocationMode.CASCADE: {
        // Recursively delete from all descendants. Match descendants by the
        // stable, ID-based ancestry_path so revocation reaches all current
        // descendants regardless of any slug rename. ancestry_ltree is derived
        // from slugs and must not scope revocation. A prefix match lets
        // idx_tenant_ancestry_path_prefix (028) serve the query.
        const tenantRes = await client.query<{ ancestry_path: string }>(
          `SELECT ancestry_path FROM tenants WHERE id = $1`,
          [tenantId],
        );
        const subtreePath = appendToPath(tenantRes.rows[0].ancestry_path, tenantId);
        const descendantsRes = await client.query<{ id: string }>(
          `SELECT id FROM tenants
           WHERE ancestry_path = $1 OR ancestry_path LIKE $2`,
          [subtreePath, `${subtreePath}/%`],
        );
        const descendantIds = descendantsRes.rows.map((r) => r.id);

        // A descendant's own PERMANENT policy on the same key is not
        // revocable, so the cascade leaves it in place.
        if (descendantIds.length > 0) {
          await client.query(
            `DELETE FROM permission_policies
             WHERE tenant_id = ANY($1) AND key = $2 AND revocation_mode != $3`,
            [descendantIds, policy.key, RevocationMode.PERMANENT],
          );
        }

        await client.query(
          `DELETE FROM permission_policies WHERE id = $1`,
          [policyId],
        );
        break;
      }

      case RevocationMode.SOFT:
      default: {
        // Freeze current values: mark all descendant policies as no longer
        // inheriting from this policy by converting them to LOCKED snapshots
        // but keep their current values intact. Simply delete this policy
        // so descendants inherit the next ancestor up (or nothing).
        await client.query(
          `DELETE FROM permission_policies WHERE id = $1`,
          [policyId],
        );
        break;
      }
    }
  });
}
