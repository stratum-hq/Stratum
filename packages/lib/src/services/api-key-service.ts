import crypto from "node:crypto";
import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";

export interface ApiKeyRecord {
  id: string;
  tenant_id: string | null;
  key_hash: string;
  key_prefix: string | null;
  name: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date | null;
}

export interface CreatedApiKey {
  id: string;
  tenant_id: string | null;
  key_prefix: string | null;
  name: string | null;
  created_at: Date;
  /** Plaintext key — only returned on creation, never stored */
  plaintext_key: string;
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateKey(keyPrefix: string): { plaintextKey: string; keyHash: string } {
  const random = crypto.randomBytes(32).toString("base64url");
  const plaintextKey = `${keyPrefix}${random}`;
  const keyHash = hashKey(plaintextKey);
  return { plaintextKey, keyHash };
}

export async function createApiKey(
  pool: pg.Pool,
  keyPrefix: string,
  tenantId: string,
  name?: string,
  expiresAt?: Date,
): Promise<CreatedApiKey> {
  const { plaintextKey, keyHash } = generateKey(keyPrefix);

  return withClient(pool, async (client) => {
    const res = await client.query<ApiKeyRecord>(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, keyHash, keyPrefix, name ?? null, expiresAt ?? null],
    );

    const row = res.rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      key_prefix: row.key_prefix,
      name: row.name,
      created_at: row.created_at,
      plaintext_key: plaintextKey,
    };
  });
}

export async function validateApiKey(
  pool: pg.Pool,
  key: string,
): Promise<{ tenant_id: string | null; key_id: string; scopes: string[] } | null> {
  const keyHash = hashKey(key);

  return withClient(pool, async (client) => {
    const res = await client.query<ApiKeyRecord & { scopes: string[] | null }>(
      `SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [keyHash],
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];

    // Update last_used_at — fire-and-forget on the pool to avoid
    // racing with client.release() in the withClient wrapper
    pool
      .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id])
      .catch(() => {
        // Non-critical: ignore update failures
      });

    return { tenant_id: row.tenant_id, key_id: row.id, scopes: row.scopes ?? ["read", "write"] };
  });
}

export async function revokeApiKey(pool: pg.Pool, keyId: string): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const res = await client.query<{ id: string }>(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
      [keyId],
    );
    return res.rows.length > 0;
  });
}

export async function rotateApiKey(
  pool: pg.Pool,
  keyPrefix: string,
  oldKeyId: string,
  newName?: string,
): Promise<CreatedApiKey> {
  return withTransaction(pool, async (client) => {
    // Verify old key exists and is not revoked
    const oldRes = await client.query<{ id: string; tenant_id: string | null; name: string | null; key_prefix: string | null }>(
      `SELECT id, tenant_id, name, key_prefix FROM api_keys WHERE id = $1 AND revoked_at IS NULL`,
      [oldKeyId],
    );
    if (oldRes.rows.length === 0) {
      throw new Error(`API key not found or already revoked: ${oldKeyId}`);
    }
    const old = oldRes.rows[0];

    // Create new key for same tenant
    const { plaintextKey, keyHash } = generateKey(keyPrefix);
    const res = await client.query<{ id: string; tenant_id: string | null; name: string | null; key_prefix: string | null; created_at: Date }>(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id, name, key_prefix, created_at`,
      [old.tenant_id, keyHash, keyPrefix, newName ?? `${old.name ?? "key"} (rotated)`],
    );

    // Revoke old key
    await client.query(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1`,
      [oldKeyId],
    );

    const row = res.rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      key_prefix: row.key_prefix,
      name: row.name,
      created_at: row.created_at,
      plaintext_key: plaintextKey,
    };
  });
}

export async function listApiKeys(
  pool: pg.Pool,
  tenantId?: string,
): Promise<Array<{ id: string; tenant_id: string | null; name: string | null; created_at: Date; last_used_at: Date | null; revoked_at: Date | null; expires_at: Date | null }>> {
  return withClient(pool, async (client) => {
    if (tenantId) {
      const res = await client.query(
        `SELECT id, tenant_id, name, created_at, last_used_at, revoked_at, expires_at
         FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return res.rows;
    }
    const res = await client.query(
      `SELECT id, tenant_id, name, created_at, last_used_at, revoked_at, expires_at
       FROM api_keys ORDER BY created_at DESC`,
    );
    return res.rows;
  });
}

export async function listDormantKeys(
  pool: pg.Pool,
  dormantDays: number = 90,
): Promise<Array<{ id: string; tenant_id: string | null; name: string | null; last_used_at: Date | null; created_at: Date }>> {
  return withClient(pool, async (client) => {
    const res = await client.query(
      `SELECT id, tenant_id, name, last_used_at, created_at
       FROM api_keys
       WHERE revoked_at IS NULL
         AND (last_used_at IS NULL OR last_used_at < now() - ($1 || ' days')::interval)
       ORDER BY last_used_at ASC NULLS FIRST`,
      [dormantDays],
    );
    return res.rows;
  });
}
