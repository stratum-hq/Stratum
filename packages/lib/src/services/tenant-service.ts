import pg from "pg";
import { withTransaction, withClient } from "../pool-helpers.js";
import {
  type TenantNode,
  type CreateTenantInput,
  type UpdateTenantInput,
  type PaginationInput,
  type PaginatedResult,
  TenantNotFoundError,
  TenantAlreadyExistsError,
  TenantHasChildrenError,
  TenantCycleDetectedError,
  TenantArchivedError,
  appendToPath,
  parseAncestryPath,
  getAncestorIds,
  isDescendantOf,
} from "@stratum-hq/core";

export async function createTenant(pool: pg.Pool, input: CreateTenantInput): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    // Advisory lock on parent to serialize sibling inserts
    if (input.parent_id) {
      await client.query(
        `SELECT pg_advisory_xact_lock(('x' || substr(md5($1::text), 1, 16))::bit(64)::bigint)`,
        [input.parent_id],
      );

      // Verify parent exists and is active
      const parentRes = await client.query<TenantNode>(
        `SELECT * FROM tenants WHERE id = $1`,
        [input.parent_id],
      );
      if (parentRes.rows.length === 0) {
        throw new TenantNotFoundError(input.parent_id);
      }
      if (parentRes.rows[0].status === "archived") {
        throw new TenantArchivedError(input.parent_id);
      }

      const parent = parentRes.rows[0];
      const ancestry_path = appendToPath(parent.ancestry_path, parent.id);

      // Inherit region_id from parent if not explicitly provided
      const regionId = (input as Record<string, unknown>).region_id ?? (parent as Record<string, unknown>).region_id ?? null;

      const res = await client.query<TenantNode>(
        `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug, config, metadata, isolation_strategy, status, region_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
         RETURNING *`,
        [
          input.parent_id,
          ancestry_path,
          parseAncestryPath(ancestry_path).length,
          input.name,
          input.slug,
          JSON.stringify(input.config ?? {}),
          JSON.stringify(input.metadata ?? {}),
          input.isolation_strategy ?? "SHARED_RLS",
          regionId,
        ],
      );

      return res.rows[0];
    } else {
      // Root tenant — no parent lock needed
      const rootRegionId = (input as Record<string, unknown>).region_id ?? null;

      const res = await client.query<TenantNode>(
        `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug, config, metadata, isolation_strategy, status, region_id)
         VALUES (NULL, '/', 0, $1, $2, $3, $4, $5, 'active', $6)
         RETURNING *`,
        [
          input.name,
          input.slug,
          JSON.stringify(input.config ?? {}),
          JSON.stringify(input.metadata ?? {}),
          input.isolation_strategy ?? "SHARED_RLS",
          rootRegionId,
        ],
      );

      return res.rows[0];
    }
  }).catch((err: unknown) => {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "23505"
    ) {
      throw new TenantAlreadyExistsError(input.slug);
    }
    throw err;
  });
}

export async function getTenant(
  pool: pg.Pool,
  id: string,
  includeArchived = false,
): Promise<TenantNode> {
  return withClient(pool, async (client) => {
    // Always fetch the row; check archived status in application logic (single query)
    const res = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1`,
      [id],
    );
    if (res.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }
    const tenant = res.rows[0];
    if (!includeArchived && tenant.status === "archived") {
      throw new TenantArchivedError(id);
    }
    return tenant;
  });
}

export async function listTenants(
  pool: pg.Pool,
  pagination: PaginationInput,
): Promise<PaginatedResult<TenantNode>> {
  return withClient(pool, async (client) => {
    const limit = pagination.limit ?? 50;

    let res: pg.QueryResult<TenantNode>;
    if (pagination.cursor) {
      res = await client.query<TenantNode>(
        `SELECT * FROM tenants
         WHERE status = 'active' AND id > $1
         ORDER BY id ASC
         LIMIT $2`,
        [pagination.cursor, limit + 1],
      );
    } else {
      res = await client.query<TenantNode>(
        `SELECT * FROM tenants
         WHERE status = 'active'
         ORDER BY id ASC
         LIMIT $1`,
        [limit + 1],
      );
    }

    const rows = res.rows;
    const has_more = rows.length > limit;
    const data = has_more ? rows.slice(0, limit) : rows;
    const next_cursor = has_more ? data[data.length - 1].id : null;

    return { data, next_cursor, has_more };
  });
}

export async function updateTenant(
  pool: pg.Pool,
  id: string,
  patch: UpdateTenantInput,
): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1 AND status != 'archived'`,
      [id],
    );
    if (existing.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (patch.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(patch.name);
    }
    if (patch.slug !== undefined) {
      sets.push(`slug = $${idx++}`);
      values.push(patch.slug);
    }
    if (patch.config !== undefined) {
      sets.push(`config = $${idx++}`);
      values.push(JSON.stringify(patch.config));
    }
    if (patch.metadata !== undefined) {
      sets.push(`metadata = $${idx++}`);
      values.push(JSON.stringify(patch.metadata));
    }

    if (sets.length === 0) {
      return existing.rows[0];
    }

    sets.push(`updated_at = now()`);
    values.push(id);

    const res = await client.query<TenantNode>(
      `UPDATE tenants SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );

    return res.rows[0];
  }).catch((err: unknown) => {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "23505"
    ) {
      throw new TenantAlreadyExistsError(patch.slug ?? "");
    }
    throw err;
  });
}

export async function deleteTenant(pool: pg.Pool, id: string): Promise<void> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1 AND status != 'archived'`,
      [id],
    );
    if (existing.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }

    // Check for active children
    const childrenRes = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM tenants WHERE parent_id = $1 AND status = 'active'`,
      [id],
    );
    if (parseInt(childrenRes.rows[0].count, 10) > 0) {
      throw new TenantHasChildrenError(id);
    }

    await client.query(
      `UPDATE tenants SET status = 'archived', deleted_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
  });
}

export async function moveTenant(
  pool: pg.Pool,
  id: string,
  newParentId: string,
): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    // Lock both old and new parents to prevent concurrent moves
    await client.query(
      `SELECT pg_advisory_xact_lock(('x' || substr(md5($1::text), 1, 16))::bit(64)::bigint)`,
      [id],
    );
    await client.query(
      `SELECT pg_advisory_xact_lock(('x' || substr(md5($1::text), 1, 16))::bit(64)::bigint)`,
      [newParentId],
    );

    // Load tenant being moved
    const tenantRes = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1 AND status != 'archived'`,
      [id],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }
    const tenant = tenantRes.rows[0];

    // Load new parent
    const newParentRes = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1 AND status != 'archived'`,
      [newParentId],
    );
    if (newParentRes.rows.length === 0) {
      throw new TenantNotFoundError(newParentId);
    }
    const newParent = newParentRes.rows[0];

    // Cycle detection: newParent must not be a descendant of tenant
    if (
      newParent.id === tenant.id ||
      isDescendantOf(newParent.ancestry_path, tenant.ancestry_path) ||
      (newParent.ancestry_path !== "/" &&
        newParent.ancestry_path.includes(tenant.id))
    ) {
      throw new TenantCycleDetectedError(id, newParentId);
    }

    const oldAncestryPath = tenant.ancestry_path;
    const newAncestryPath = appendToPath(newParent.ancestry_path, newParent.id);
    const newDepth = parseAncestryPath(newAncestryPath).length;

    // Update the moved tenant
    const updatedRes = await client.query<TenantNode>(
      `UPDATE tenants
       SET parent_id = $1,
           ancestry_path = $2,
           depth = $3,
           updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [newParentId, newAncestryPath, newDepth, id],
    );

    // Recompute ancestry_path for all descendants.
    // The moved tenant's old ancestry_path is oldAncestryPath.
    // Descendants have ancestry_path starting with oldAncestryPath + "/" + id.
    const oldPrefix = oldAncestryPath === "/"
      ? `/${id}`
      : `${oldAncestryPath}/${id}`;
    const newPrefix = newAncestryPath === "/"
      ? `/${id}`
      : `${newAncestryPath}/${id}`;

    const descendantsRes = await client.query<TenantNode>(
      `SELECT * FROM tenants
       WHERE ancestry_path LIKE $1
       ORDER BY depth ASC`,
      [`${oldPrefix}/%`],
    );

    for (const desc of descendantsRes.rows) {
      const updatedDescPath = newPrefix + desc.ancestry_path.slice(oldPrefix.length);
      const updatedDescDepth = parseAncestryPath(updatedDescPath).length;
      await client.query(
        `UPDATE tenants
         SET ancestry_path = $1,
             depth = $2,
             slug = slug,
             updated_at = now()
         WHERE id = $3`,
        [updatedDescPath, updatedDescDepth, desc.id],
      );
    }

    return updatedRes.rows[0];
  });
}

export interface BatchCreateResult {
  created: TenantNode[];
  errors: Array<{ index: number; slug: string; error: string }>;
}

/**
 * Create multiple tenants in a single transaction.
 * Stops on first error and rolls back all changes.
 */
export async function batchCreateTenants(
  pool: pg.Pool,
  inputs: CreateTenantInput[],
): Promise<BatchCreateResult> {
  const created: TenantNode[] = [];
  const errors: Array<{ index: number; slug: string; error: string }> = [];

  try {
    await withTransaction(pool, async (client) => {
      // Map of slug → created tenant for intra-batch parent references
      const slugMap = new Map<string, TenantNode>();

      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];

        let parentId = input.parent_id ?? null;
        let parentNode: TenantNode | null = null;

        if (parentId) {
          // Check if parent was created earlier in this batch (by ID)
          const batchParent = created.find((t) => t.id === parentId);
          if (batchParent) {
            parentNode = batchParent;
          } else {
            // Look up in DB
            const parentRes = await client.query<TenantNode>(
              `SELECT * FROM tenants WHERE id = $1 AND status != 'archived'`,
              [parentId],
            );
            if (parentRes.rows.length === 0) {
              throw new TenantNotFoundError(parentId);
            }
            parentNode = parentRes.rows[0];
          }

          // Advisory lock on parent
          await client.query(
            `SELECT pg_advisory_xact_lock(('x' || substr(md5($1::text), 1, 16))::bit(64)::bigint)`,
            [parentId],
          );

          const ancestry_path = appendToPath(parentNode.ancestry_path, parentNode.id);
          const regionId = (input as Record<string, unknown>).region_id ?? (parentNode as Record<string, unknown>).region_id ?? null;

          const res = await client.query<TenantNode>(
            `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug, config, metadata, isolation_strategy, status, region_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
             RETURNING *`,
            [
              parentId,
              ancestry_path,
              parseAncestryPath(ancestry_path).length,
              input.name,
              input.slug,
              JSON.stringify(input.config ?? {}),
              JSON.stringify(input.metadata ?? {}),
              input.isolation_strategy ?? "SHARED_RLS",
              regionId,
            ],
          );
          const tenant = res.rows[0];
          created.push(tenant);
          slugMap.set(tenant.slug, tenant);
        } else {
          // Root tenant
          const rootRegionId = (input as Record<string, unknown>).region_id ?? null;
          const res = await client.query<TenantNode>(
            `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug, config, metadata, isolation_strategy, status, region_id)
             VALUES (NULL, '/', 0, $1, $2, $3, $4, $5, 'active', $6)
             RETURNING *`,
            [
              input.name,
              input.slug,
              JSON.stringify(input.config ?? {}),
              JSON.stringify(input.metadata ?? {}),
              input.isolation_strategy ?? "SHARED_RLS",
              rootRegionId,
            ],
          );
          const tenant = res.rows[0];
          created.push(tenant);
          slugMap.set(tenant.slug, tenant);
        }
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ index: created.length, slug: inputs[created.length]?.slug ?? "unknown", error: message });
  }

  return { created, errors };
}

export async function getAncestors(pool: pg.Pool, id: string): Promise<TenantNode[]> {
  return withClient(pool, async (client) => {
    const tenantRes = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1`,
      [id],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }
    const tenant = tenantRes.rows[0];
    const ancestorIds = getAncestorIds(tenant.ancestry_path);

    if (ancestorIds.length === 0) {
      return [];
    }

    const res = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = ANY($1) ORDER BY depth ASC`,
      [ancestorIds],
    );
    return res.rows;
  });
}

export async function getDescendants(pool: pg.Pool, id: string): Promise<TenantNode[]> {
  return withClient(pool, async (client) => {
    const existsRes = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE id = $1`,
      [id],
    );
    if (existsRes.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }

    // Use ltree <@ operator for efficient subtree query
    const res = await client.query<TenantNode>(
      `SELECT * FROM tenants
       WHERE ancestry_ltree <@ (SELECT ancestry_ltree FROM tenants WHERE id = $1)
         AND id != $1
       ORDER BY depth ASC`,
      [id],
    );
    return res.rows;
  });
}

export async function getChildren(pool: pg.Pool, id: string): Promise<TenantNode[]> {
  return withClient(pool, async (client) => {
    const res = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE parent_id = $1 AND status = 'active' ORDER BY created_at ASC`,
      [id],
    );
    return res.rows;
  });
}
