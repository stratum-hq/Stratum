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
): Promise<CreatedApiKey> {
  const { plaintextKey, keyHash } = generateKey(keyPrefix);

  return withClient(pool, async (client) => {
    const res = await client.query<ApiKeyRecord>(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, keyHash, keyPrefix, name ?? null],
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
): Promise<{ tenant_id: string | null; key_id: string } | null> {
  const keyHash = hashKey(key);

  return withClient(pool, async (client) => {
    const res = await client.query<ApiKeyRecord>(
      `SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
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

    return { tenant_id: row.tenant_id, key_id: row.id };
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
