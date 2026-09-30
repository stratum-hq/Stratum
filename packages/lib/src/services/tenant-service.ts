import pg from "pg";
import { withTransaction, withClient } from "../pool-helpers.js";
import {
  type TenantNode,
  type CreateTenantInput,
  type UpdateTenantInput,
  type PaginationInput,
  type PaginatedResult,
  type TenantStatus,
  TenantNotFoundError,
  TenantAlreadyExistsError,
  TenantHasChildrenError,
  TenantCycleDetectedError,
  TenantArchivedError,
  TenantSuspendedError,
  TenantPendingError,
  InvalidTenantStateError,
  ValidationError,
  appendToPath,
  parseAncestryPath,
  getAncestorIds,
} from "@stratum-hq/core";

/**
 * Serialize changes to the tree's shape on one advisory key. A move takes it
 * exclusively: it checks for cycles against the destination's ancestry and
 * rewrites the paths of a whole subtree, so nothing else may read or write
 * ancestry while it runs. Creates and lifecycle transitions take it shared, so
 * they still run alongside each other (row locks order those) but never read a
 * parent path that an in-flight move is about to rewrite. Take it before
 * reading any row the change depends on.
 */
async function lockTree(client: pg.PoolClient, mode: "shared" | "exclusive"): Promise<void> {
  const fn = mode === "exclusive" ? "pg_advisory_xact_lock" : "pg_advisory_xact_lock_shared";
  await client.query(`SELECT ${fn}(('x' || substr(md5('stratum.tenant_tree'), 1, 16))::bit(64)::bigint)`);
}

/**
 * Load the parent for a tenant being created or moved, and require it to be
 * active: a suspended or archived subtree must not grow, so an active tenant
 * always has an active parent. FOR SHARE holds the parent row until commit, so
 * a concurrent suspend or archive of the parent (which locks it FOR UPDATE)
 * waits for this transaction and then sees the new child.
 */
async function loadActiveParent(client: pg.PoolClient, parentId: string): Promise<TenantNode> {
  const res = await client.query<TenantNode>(
    `SELECT * FROM tenants WHERE id = $1 FOR SHARE`,
    [parentId],
  );
  if (res.rows.length === 0) {
    throw new TenantNotFoundError(parentId);
  }
  const parent = res.rows[0];
  if (parent.status === "archived") {
    throw new TenantArchivedError(parentId);
  }
  if (parent.status === "suspended") {
    throw new TenantSuspendedError(parentId);
  }
  if (parent.status === "pending") {
    throw new TenantPendingError(parentId);
  }
  return parent;
}

/**
 * A tenant with its own schema or database starts `pending` and is activated
 * (activateTenant) once that storage has been provisioned, so it is never
 * usable without it. SHARED_RLS tenants need no storage and start `active`.
 */
function initialStatus(input: CreateTenantInput): TenantStatus {
  const strategy = input.isolation_strategy ?? "SHARED_RLS";
  return strategy === "SCHEMA_PER_TENANT" || strategy === "DB_PER_TENANT" ? "pending" : "active";
}

export async function createTenant(pool: pg.Pool, input: CreateTenantInput): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    if (input.parent_id) {
      await lockTree(client, "shared");
      const parent = await loadActiveParent(client, input.parent_id);
      const ancestry_path = appendToPath(parent.ancestry_path, parent.id);

      // Inherit region_id from parent if not explicitly provided
      const regionId = (input as Record<string, unknown>).region_id ?? (parent as Record<string, unknown>).region_id ?? null;

      const res = await client.query<TenantNode>(
        `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug, config, metadata, isolation_strategy, status, region_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
          initialStatus(input),
          regionId,
        ],
      );

      return res.rows[0];
    } else {
      // Root tenant — no parent lock needed
      const rootRegionId = (input as Record<string, unknown>).region_id ?? null;

      const res = await client.query<TenantNode>(
        `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug, config, metadata, isolation_strategy, status, region_id)
         VALUES (NULL, '/', 0, $1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.name,
          input.slug,
          JSON.stringify(input.config ?? {}),
          JSON.stringify(input.metadata ?? {}),
          input.isolation_strategy ?? "SHARED_RLS",
          initialStatus(input),
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
    // Suspended and pending tenants are blocked from normal access too.
    // `includeArchived` is the "give me the row whatever its state" escape
    // hatch and bypasses every non-active state.
    if (!includeArchived && tenant.status === "suspended") {
      throw new TenantSuspendedError(id);
    }
    if (!includeArchived && tenant.status === "pending") {
      throw new TenantPendingError(id);
    }
    return tenant;
  });
}

/**
 * Resolve a tenant by its globally-unique slug in a single indexed lookup
 * (idx_tenant_slug), the slug-keyed counterpart to {@link getTenant}. Consumers
 * that hold a slug can skip scanning the unindexed listTenants/listOrganizations
 * pages. Slug is globally unique, so this returns exactly the one matching row.
 *
 * Mirrors getTenant's not-found and state contract: throws TenantNotFoundError
 * when no row matches, and — unless `includeArchived` is set — TenantArchivedError
 * / TenantSuspendedError / TenantPendingError for a non-active row. `includeArchived` is the "give me
 * the row whatever its state" escape hatch and bypasses both non-active states.
 */
export async function getTenantBySlug(
  pool: pg.Pool,
  slug: string,
  includeArchived = false,
): Promise<TenantNode> {
  return withClient(pool, async (client) => {
    // Single indexed lookup on the unique slug column; check state in app logic.
    const res = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE slug = $1`,
      [slug],
    );
    if (res.rows.length === 0) {
      throw new TenantNotFoundError(slug);
    }
    const tenant = res.rows[0];
    if (!includeArchived && tenant.status === "archived") {
      throw new TenantArchivedError(tenant.id);
    }
    if (!includeArchived && tenant.status === "suspended") {
      throw new TenantSuspendedError(tenant.id);
    }
    if (!includeArchived && tenant.status === "pending") {
      throw new TenantPendingError(tenant.id);
    }
    return tenant;
  });
}

/**
 * List tenants in one status, `active` by default. Pending, suspended and
 * archived tenants appear only when that status is asked for.
 */
export async function listTenants(
  pool: pg.Pool,
  pagination: PaginationInput,
  status: TenantStatus = "active",
): Promise<PaginatedResult<TenantNode>> {
  return withClient(pool, async (client) => {
    const limit = pagination.limit ?? 50;

    let res: pg.QueryResult<TenantNode>;
    if (pagination.cursor) {
      res = await client.query<TenantNode>(
        `SELECT * FROM tenants
         WHERE status = $3 AND id > $1
         ORDER BY id ASC
         LIMIT $2`,
        [pagination.cursor, limit + 1, status],
      );
    } else {
      res = await client.query<TenantNode>(
        `SELECT * FROM tenants
         WHERE status = $2
         ORDER BY id ASC
         LIMIT $1`,
        [limit + 1, status],
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
      // Schema- and database-per-tenant storage is named from the slug, so
      // changing it would detach the tenant from its storage and free the old
      // name for another tenant.
      const strategy = existing.rows[0].isolation_strategy;
      if (
        patch.slug !== existing.rows[0].slug &&
        (strategy === "SCHEMA_PER_TENANT" || strategy === "DB_PER_TENANT")
      ) {
        throw new ValidationError(
          `Slug cannot be changed for a ${strategy} tenant`,
          { tenant_id: id, isolation_strategy: strategy },
        );
      }
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

// ---------------------------------------------------------------------------
// Tenant lifecycle
//
// States: [pending ->] active -> {suspended, archived} -> (purged). Transitions:
//   createTenant   (none)               -> active, or pending for a tenant with
//                                          its own schema or database
//   activateTenant pending              -> active      (storage provisioned)
//   suspendTenant  active               -> suspended  (reversible, blocks access)
//   resumeTenant   suspended | archived -> active      (reverses suspend/archive)
//   archiveTenant  active | suspended   -> archived    (soft delete, reversible)
//   purgeTenant    any                  -> (row gone)  (GDPR, irreversible;
//                                                       retention-service.ts)
//
// The state machine is strict: a transition from an unexpected state throws
// InvalidTenantStateError rather than silently no-op'ing.
//
// Descendant rules, tested against real Postgres in packages/integration-tests:
//   * suspend / archive block when the tenant has an ACTIVE child
//     (TenantHasChildrenError). They act leaf-first and never cascade.
//   * resume / activate / create / move require the parent to be ACTIVE, so
//     the invariant "an active tenant's parent is active" always holds.
//   * purge requires an empty subtree (no children of ANY status).
// ---------------------------------------------------------------------------

/**
 * Load a tenant row of any status for a lifecycle transition, or throw
 * TenantNotFoundError. Unlike updateTenant this does not filter out archived /
 * suspended rows, because lifecycle operations act on exactly those states.
 */
async function loadForTransition(client: pg.PoolClient, id: string): Promise<TenantNode> {
  // Transitions read the tree (children, parent) to keep "an active tenant's
  // parent is active", so they must not interleave with a move. FOR UPDATE
  // then orders them against creates and other transitions on this tenant.
  await lockTree(client, "shared");
  const res = await client.query<TenantNode>(
    `SELECT * FROM tenants WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (res.rows.length === 0) {
    throw new TenantNotFoundError(id);
  }
  return res.rows[0];
}

/**
 * Guard for downward transitions (suspend, archive): reject if the tenant has
 * any ACTIVE direct child. Matches the existing TenantHasChildrenError contract
 * and forces a leaf-first walk so no active tenant is ever left under a
 * non-active parent.
 */
async function assertNoActiveChildren(client: pg.PoolClient, id: string): Promise<void> {
  const childrenRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM tenants WHERE parent_id = $1 AND status = 'active'`,
    [id],
  );
  if (parseInt(childrenRes.rows[0].count, 10) > 0) {
    throw new TenantHasChildrenError(id);
  }
}

/**
 * Suspend an active tenant: reversible block on access. Rejects if the tenant
 * is not active, or if it has active children (suspend leaf-first).
 */
export async function suspendTenant(pool: pg.Pool, id: string): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    const tenant = await loadForTransition(client, id);
    if (tenant.status !== "active") {
      throw new InvalidTenantStateError(id, tenant.status, "suspend", ["active"]);
    }
    await assertNoActiveChildren(client, id);
    const res = await client.query<TenantNode>(
      `UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return res.rows[0];
  });
}

/**
 * Archive a tenant: reversible soft delete. Accepts an active or suspended
 * tenant. Rejects if already archived, or if it has active children.
 */
export async function archiveTenant(pool: pg.Pool, id: string): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    const tenant = await loadForTransition(client, id);
    if (tenant.status !== "active" && tenant.status !== "suspended") {
      throw new InvalidTenantStateError(id, tenant.status, "archive", ["active", "suspended"]);
    }
    await assertNoActiveChildren(client, id);
    const res = await client.query<TenantNode>(
      `UPDATE tenants SET status = 'archived', deleted_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return res.rows[0];
  });
}

/**
 * Resume a suspended or archived tenant back to active, reversing suspend and
 * archive (clearing deleted_at). Rejects if the tenant is already active, or if
 * its parent is not active. Resuming is top-down.
 */
export async function resumeTenant(pool: pg.Pool, id: string): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    const tenant = await loadForTransition(client, id);
    if (tenant.status !== "suspended" && tenant.status !== "archived") {
      throw new InvalidTenantStateError(id, tenant.status, "resume", ["suspended", "archived"]);
    }
    if (tenant.parent_id) {
      // FOR SHARE: a concurrent suspend or archive of the parent waits for
      // this resume and then sees an active child.
      const parentRes = await client.query<{ status: string }>(
        `SELECT status FROM tenants WHERE id = $1 FOR SHARE`,
        [tenant.parent_id],
      );
      const parentStatus = parentRes.rows[0]?.status;
      if (parentStatus === "archived") {
        throw new TenantArchivedError(tenant.parent_id);
      }
      if (parentStatus === "suspended") {
        throw new TenantSuspendedError(tenant.parent_id);
      }
    }
    const res = await client.query<TenantNode>(
      `UPDATE tenants SET status = 'active', deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return res.rows[0];
  });
}

/**
 * Activate a pending tenant once its schema or database has been provisioned.
 * Rejects if the tenant is not pending, or if its parent is not active.
 */
export async function activateTenant(pool: pg.Pool, id: string): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    const tenant = await loadForTransition(client, id);
    if (tenant.status !== "pending") {
      throw new InvalidTenantStateError(id, tenant.status, "activate", ["pending"]);
    }
    if (tenant.parent_id) {
      await loadActiveParent(client, tenant.parent_id);
    }
    const res = await client.query<TenantNode>(
      `UPDATE tenants SET status = 'active', updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return res.rows[0];
  });
}

/**
 * Soft-delete a tenant.
 *
 * @deprecated Prefer {@link archiveTenant}; soft-deleting a tenant is archiving
 * it. Retained as an alias so existing callers keep working.
 */
export async function deleteTenant(pool: pg.Pool, id: string): Promise<void> {
  await archiveTenant(pool, id);
}

export async function moveTenant(
  pool: pg.Pool,
  id: string,
  newParentId: string,
): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    await lockTree(client, "exclusive");

    // Load tenant being moved
    const tenantRes = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1 AND status != 'archived'`,
      [id],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }
    const tenant = tenantRes.rows[0];

    const newParent = await loadActiveParent(client, newParentId);

    // Cycle detection: newParent must not be a descendant of tenant.
    // Check if the moving tenant's ID appears in the new parent's ancestry_path
    // (which would mean the new parent is a descendant of the moving tenant).
    if (
      newParent.id === tenant.id ||
      parseAncestryPath(newParent.ancestry_path).includes(tenant.id)
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

    // Match every descendant: the direct children have ancestry_path exactly
    // equal to oldPrefix (their ancestor chain ends at the moved tenant), while
    // deeper descendants have it as a "oldPrefix/..." prefix. The LIKE alone
    // misses the direct children.
    const descendantsRes = await client.query<TenantNode>(
      `SELECT * FROM tenants
       WHERE ancestry_path = $1 OR ancestry_path LIKE $2
       ORDER BY depth ASC`,
      [oldPrefix, `${oldPrefix}/%`],
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
      await lockTree(client, "shared");
      // Map of slug → created tenant for intra-batch parent references
      const slugMap = new Map<string, TenantNode>();

      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];

        const parentId = input.parent_id ?? null;
        let parentNode: TenantNode | null = null;

        if (parentId) {
          // Check if parent was created earlier in this batch (by ID)
          const batchParent = created.find((t) => t.id === parentId);
          if (batchParent) {
            parentNode = batchParent;
          } else {
            parentNode = await loadActiveParent(client, parentId);
          }

          const ancestry_path = appendToPath(parentNode.ancestry_path, parentNode.id);
          const regionId = (input as Record<string, unknown>).region_id ?? (parentNode as Record<string, unknown>).region_id ?? null;

          const res = await client.query<TenantNode>(
            `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug, config, metadata, isolation_strategy, status, region_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
              initialStatus(input),
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
             VALUES (NULL, '/', 0, $1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              input.name,
              input.slug,
              JSON.stringify(input.config ?? {}),
              JSON.stringify(input.metadata ?? {}),
              input.isolation_strategy ?? "SHARED_RLS",
              initialStatus(input),
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
    // The batch runs in one transaction, so a mid-batch failure rolls the whole
    // thing back (see withTransaction). `created` was pushed to in-memory before
    // the throw, so it still lists rolled-back tenants. Clear it so the return
    // reflects what actually persisted -- nothing -- and callers do not emit
    // TENANT_CREATED events or audit entries for rows that never committed (#213).
    created.length = 0;
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

/**
 * Get the root tenant for any tenant in the tree: the top-most ancestor, or the
 * tenant itself when it is already a root. Resolves in one row lookup for the
 * tenant plus one for its root (never fetches the whole ancestor chain), so it
 * is the efficient primitive for "which top-level org owns this tenant" — a
 * common need in hierarchical multi-tenancy (billing scope, ownership checks,
 * root-level policy).
 */
export async function getRoot(pool: pg.Pool, id: string): Promise<TenantNode> {
  return withClient(pool, async (client) => {
    const tenantRes = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1`,
      [id],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }
    const tenant = tenantRes.rows[0];
    // ancestry_path is ordered root-first and excludes self, so element 0 is
    // the root. An empty path means this tenant is already a root.
    const ancestorIds = getAncestorIds(tenant.ancestry_path);
    if (ancestorIds.length === 0) {
      return tenant;
    }
    const rootRes = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1`,
      [ancestorIds[0]],
    );
    if (rootRes.rows.length === 0) {
      throw new TenantNotFoundError(ancestorIds[0]);
    }
    return rootRes.rows[0];
  });
}

/**
 * Get every descendant of a tenant: its whole subtree, excluding the tenant
 * itself, ordered by depth (shallowest first).
 *
 * By default this returns only LIVE descendants (`status = 'active'`), matching
 * `getChildren`, `listTenants`, and the default of `getTenant`. Archived and
 * soft-deleted tenants are excluded. `deleteTenant` sets `status = 'archived'`
 * (alongside `deleted_at`), so a single `status = 'active'` predicate excludes
 * both archived and soft-deleted rows.
 *
 * This is the primitive callers use to scope work to a subtree, so the default
 * is the conservative one: a tenant that is no longer active does not appear in
 * a live subtree listing. Callers that genuinely need the full historical
 * subtree (for example lifecycle or data-retention passes that must also reach
 * removed tenants) pass `includeArchived = true`, mirroring `getTenant`.
 *
 * @param pool - pg Pool
 * @param id - Tenant whose descendants to fetch
 * @param includeArchived - when true, return descendants of any status
 */
export async function getDescendants(
  pool: pg.Pool,
  id: string,
  includeArchived = false,
): Promise<TenantNode[]> {
  return withClient(pool, async (client) => {
    const existsRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [id],
    );
    if (existsRes.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }

    // Match descendants by the stable, ID-based ancestry_path so the subtree
    // query reaches all current descendants regardless of any slug rename.
    // ancestry_ltree is derived from slugs and must not scope this isolation
    // boundary. A prefix match lets idx_tenant_ancestry_path_prefix (028) serve
    // the query. Filter to active rows unless the caller opts into the full subtree.
    const subtreePath = appendToPath(existsRes.rows[0].ancestry_path, id);
    const res = await client.query<TenantNode>(
      `SELECT * FROM tenants
       WHERE (ancestry_path = $1 OR ancestry_path LIKE $2)${includeArchived ? "" : "\n         AND status = 'active'"}
       ORDER BY depth ASC`,
      [subtreePath, `${subtreePath}/%`],
    );
    return res.rows;
  });
}

export async function getChildren(pool: pg.Pool, id: string): Promise<TenantNode[]> {
  return withClient(pool, async (client) => {
    const res = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE parent_id = $1 AND status = 'active' ORDER BY sort_order ASC, created_at ASC`,
      [id],
    );
    return res.rows;
  });
}

/**
 * Reorder a tenant among its siblings.
 *
 * Sets the sort_order of the target tenant and re-numbers siblings
 * to maintain a clean sequence. Position is 0-indexed.
 *
 * @param pool - pg Pool
 * @param id - Tenant ID to reorder
 * @param position - New 0-based position among siblings
 */
export async function reorderTenant(pool: pg.Pool, id: string, position: number): Promise<TenantNode> {
  return withTransaction(pool, async (client) => {
    // Get the tenant
    const tenantRes = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1`,
      [id],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(id);
    }
    const tenant = tenantRes.rows[0];

    // Get all siblings (same parent, active)
    const siblingsRes = await client.query<TenantNode>(
      tenant.parent_id
        ? `SELECT * FROM tenants WHERE parent_id = $1 AND status = 'active' ORDER BY sort_order ASC, created_at ASC`
        : `SELECT * FROM tenants WHERE parent_id IS NULL AND status = 'active' ORDER BY sort_order ASC, created_at ASC`,
      tenant.parent_id ? [tenant.parent_id] : [],
    );

    const siblings = siblingsRes.rows;

    // Remove the tenant from the list, then insert at new position
    const without = siblings.filter((s) => s.id !== id);
    const clamped = Math.max(0, Math.min(position, without.length));
    without.splice(clamped, 0, tenant);

    // Re-number all siblings with clean sort_order values
    for (let i = 0; i < without.length; i++) {
      await client.query(
        `UPDATE tenants SET sort_order = $1, updated_at = now() WHERE id = $2`,
        [i, without[i].id],
      );
    }

    // Return the updated tenant
    const result = await client.query<TenantNode>(
      `SELECT * FROM tenants WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  });
}
