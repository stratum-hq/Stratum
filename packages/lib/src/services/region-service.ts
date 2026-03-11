import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import type { Region, CreateRegionInput, UpdateRegionInput } from "@stratum/core";

export async function createRegion(pool: pg.Pool, input: CreateRegionInput): Promise<Region> {
  return withClient(pool, async (client) => {
    const res = await client.query(
      `INSERT INTO regions (display_name, slug, control_plane_url, is_primary, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, display_name, slug, control_plane_url, NULL as database_url, is_primary, status, metadata, created_at::text, updated_at::text`,
      [input.display_name, input.slug, input.control_plane_url ?? null, input.is_primary ?? false, input.status ?? "active", JSON.stringify(input.metadata ?? {})],
    );
    return res.rows[0] as Region;
  });
}

export async function getRegion(pool: pg.Pool, id: string): Promise<Region> {
  return withClient(pool, async (client) => {
    const res = await client.query(
      `SELECT id, display_name, slug, control_plane_url, NULL as database_url, is_primary, status, metadata, created_at::text, updated_at::text
       FROM regions WHERE id = $1`,
      [id],
    );
    if (res.rows.length === 0) {
      throw new Error(`Region not found: ${id}`);
    }
    return res.rows[0] as Region;
  });
}

export async function listRegions(pool: pg.Pool): Promise<Region[]> {
  return withClient(pool, async (client) => {
    const res = await client.query(
      `SELECT id, display_name, slug, control_plane_url, NULL as database_url, is_primary, status, metadata, created_at::text, updated_at::text
       FROM regions ORDER BY created_at ASC`,
    );
    return res.rows as Region[];
  });
}

export async function updateRegion(pool: pg.Pool, id: string, input: UpdateRegionInput): Promise<Region> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query(`SELECT id FROM regions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      throw new Error(`Region not found: ${id}`);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.display_name !== undefined) {
      sets.push(`display_name = $${idx++}`);
      values.push(input.display_name);
    }
    if (input.control_plane_url !== undefined) {
      sets.push(`control_plane_url = $${idx++}`);
      values.push(input.control_plane_url);
    }
    if (input.status !== undefined) {
      sets.push(`status = $${idx++}`);
      values.push(input.status);
    }
    if (input.metadata !== undefined) {
      sets.push(`metadata = $${idx++}`);
      values.push(JSON.stringify(input.metadata));
    }

    if (sets.length === 0) {
      // No changes — return existing
      const current = await client.query(
        `SELECT id, display_name, slug, control_plane_url, NULL as database_url, is_primary, status, metadata, created_at::text, updated_at::text
         FROM regions WHERE id = $1`,
        [id],
      );
      return current.rows[0] as Region;
    }

    sets.push(`updated_at = now()`);
    values.push(id);

    const res = await client.query(
      `UPDATE regions SET ${sets.join(", ")} WHERE id = $${idx}
       RETURNING id, display_name, slug, control_plane_url, NULL as database_url, is_primary, status, metadata, created_at::text, updated_at::text`,
      values,
    );

    return res.rows[0] as Region;
  });
}

export async function deleteRegion(pool: pg.Pool, id: string): Promise<void> {
  return withTransaction(pool, async (client) => {
    // Ensure no tenants are assigned to this region
    const tenantCheck = await client.query(
      `SELECT COUNT(*) as count FROM tenants WHERE region_id = $1 AND status = 'active'`,
      [id],
    );
    if (parseInt(tenantCheck.rows[0].count as string, 10) > 0) {
      throw new Error(`Cannot delete region ${id}: active tenants are still assigned to it`);
    }

    const res = await client.query(`DELETE FROM regions WHERE id = $1`, [id]);
    if (res.rowCount === 0) {
      throw new Error(`Region not found: ${id}`);
    }
  });
}

export async function migrateRegion(pool: pg.Pool, tenantId: string, newRegionId: string): Promise<void> {
  return withTransaction(pool, async (client) => {
    // Verify tenant exists
    const tenantRes = await client.query(`SELECT id FROM tenants WHERE id = $1 AND status != 'archived'`, [tenantId]);
    if (tenantRes.rows.length === 0) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    // Verify target region exists and is active
    const regionRes = await client.query(`SELECT id, status FROM regions WHERE id = $1`, [newRegionId]);
    if (regionRes.rows.length === 0) {
      throw new Error(`Region not found: ${newRegionId}`);
    }
    if ((regionRes.rows[0] as { status: string }).status !== "active") {
      throw new Error(`Cannot migrate to region ${newRegionId}: region is not active`);
    }

    await client.query(
      `UPDATE tenants SET region_id = $2, updated_at = now() WHERE id = $1`,
      [tenantId, newRegionId],
    );
  });
}
