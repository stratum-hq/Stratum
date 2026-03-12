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
