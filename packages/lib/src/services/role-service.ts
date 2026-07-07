import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";

export interface Role {
  id: string;
  name: string;
  description: string | null;
  scopes: string[];
  tenant_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  scopes: string[];
  tenant_id?: string | null;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  scopes?: string[];
}

export async function createRole(pool: pg.Pool, input: CreateRoleInput): Promise<Role> {
  return withClient(pool, async (client) => {
    const res = await client.query<Role>(
      `INSERT INTO roles (name, description, scopes, tenant_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.name, input.description ?? null, input.scopes, input.tenant_id ?? null],
    );
    return res.rows[0];
  });
}

export async function getRole(pool: pg.Pool, id: string): Promise<Role | null> {
  return withClient(pool, async (client) => {
    const res = await client.query<Role>(
      `SELECT * FROM roles WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  });
}

export async function listRoles(pool: pg.Pool, tenantId?: string): Promise<Role[]> {
  return withClient(pool, async (client) => {
    if (tenantId) {
      const res = await client.query<Role>(
        `SELECT * FROM roles WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY name ASC`,
        [tenantId],
      );
      return res.rows;
    }
    const res = await client.query<Role>(
      `SELECT * FROM roles ORDER BY name ASC`,
    );
    return res.rows;
  });
}

export async function updateRole(pool: pg.Pool, id: string, input: UpdateRoleInput): Promise<Role | null> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<Role>(
      `SELECT * FROM roles WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) return null;

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${idx++}`);
      values.push(input.description);
    }
    if (input.scopes !== undefined) {
      sets.push(`scopes = $${idx++}`);
      values.push(input.scopes);
    }

    if (sets.length === 0) return existing.rows[0];

    sets.push(`updated_at = now()`);
    values.push(id);

    const res = await client.query<Role>(
      `UPDATE roles SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return res.rows[0];
  });
}

export async function deleteRole(pool: pg.Pool, id: string): Promise<boolean> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ id: string }>(
      `DELETE FROM roles WHERE id = $1 RETURNING id`,
      [id],
    );
    return res.rows.length > 0;
  });
}

export async function assignRoleToKey(pool: pg.Pool, keyId: string, roleId: string): Promise<boolean> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ id: string }>(
      `UPDATE api_keys SET role_id = $1 WHERE id = $2 AND revoked_at IS NULL RETURNING id`,
      [roleId, keyId],
    );
    return res.rows.length > 0;
  });
}

export async function removeRoleFromKey(pool: pg.Pool, keyId: string): Promise<boolean> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ id: string }>(
      `UPDATE api_keys SET role_id = NULL WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
      [keyId],
    );
    return res.rows.length > 0;
  });
}

/**
 * Resolve effective scopes for an API key.
 * If the key has a role, the role's scopes take precedence.
 * Otherwise, falls back to the key's own scopes.
 */
export async function resolveKeyScopes(pool: pg.Pool, keyId: string): Promise<string[]> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ scopes: string[] | null; role_scopes: string[] | null }>(
      `SELECT ak.scopes, r.scopes as role_scopes
       FROM api_keys ak
       LEFT JOIN roles r ON r.id = ak.role_id
       WHERE ak.id = $1 AND ak.revoked_at IS NULL`,
      [keyId],
    );
    if (res.rows.length === 0) return ["read"];
    const row = res.rows[0];
    // Role scopes override key scopes when a role is assigned
    return row.role_scopes ?? row.scopes ?? ["read"];
  });
}

/**
 * Assign a role to any principal (an application user, a service account, an
 * API key, etc.), keyed by an application-defined (type, id) pair. One role per
 * principal: assigning again replaces the previous role. Returns true on write.
 *
 * This is the principal-agnostic counterpart to assignRoleToKey. Applications
 * that manage their own users can store the user's role here and resolve its
 * scopes via resolvePrincipalScopes, rather than reimplementing role storage.
 *
 * Pass `tenantId` to enforce that the role belongs to that tenant (global roles,
 * tenant_id IS NULL, are always allowed): the assignment is REFUSED (returns
 * false) if the role is owned by a different tenant. This prevents a caller from
 * granting a foreign tenant's role to one of its principals. When `tenantId` is
 * omitted the library does not scope the role, and the caller is responsible for
 * authorizing the assignment.
 */
export async function assignRole(
  pool: pg.Pool,
  principalType: string,
  principalId: string,
  roleId: string,
  tenantId?: string,
): Promise<boolean> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ role_id: string }>(
      `INSERT INTO principal_roles (principal_type, principal_id, role_id)
       SELECT $1, $2, $3
       WHERE EXISTS (
         SELECT 1 FROM roles
         WHERE id = $3
           AND ($4::uuid IS NULL OR tenant_id = $4 OR tenant_id IS NULL)
       )
       ON CONFLICT (principal_type, principal_id)
       DO UPDATE SET role_id = EXCLUDED.role_id, assigned_at = now()
       RETURNING role_id`,
      [principalType, principalId, roleId, tenantId ?? null],
    );
    return res.rows.length > 0;
  });
}

/** Remove a principal's role assignment. Returns true if one was removed. */
export async function removeRole(
  pool: pg.Pool,
  principalType: string,
  principalId: string,
): Promise<boolean> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ role_id: string }>(
      `DELETE FROM principal_roles
       WHERE principal_type = $1 AND principal_id = $2
       RETURNING role_id`,
      [principalType, principalId],
    );
    return res.rows.length > 0;
  });
}

/**
 * Resolve the effective scopes for any principal via its assigned role.
 * Returns [] when the principal has no role assignment (fail closed), so a
 * caller can treat "no role" as "no scopes" without special-casing null.
 *
 * Pass `tenantId` to scope resolution to that tenant: scopes are returned only
 * when the assigned role belongs to that tenant or is a global role
 * (tenant_id IS NULL); otherwise [] is returned. This stops a principal from
 * resolving a role owned by a different tenant. When `tenantId` is omitted the
 * role's tenant is not checked.
 */
export async function resolvePrincipalScopes(
  pool: pg.Pool,
  principalType: string,
  principalId: string,
  tenantId?: string,
): Promise<string[]> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ scopes: string[] | null }>(
      `SELECT r.scopes
       FROM principal_roles pr
       JOIN roles r ON r.id = pr.role_id
       WHERE pr.principal_type = $1 AND pr.principal_id = $2
         AND ($3::uuid IS NULL OR r.tenant_id = $3 OR r.tenant_id IS NULL)`,
      [principalType, principalId, tenantId ?? null],
    );
    if (res.rows.length === 0) return [];
    return res.rows[0].scopes ?? [];
  });
}
