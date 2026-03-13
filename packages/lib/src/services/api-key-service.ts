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
  hash_version: number;
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

// --- Hashing ---

const HASH_V1_SHA256 = 1;
const HASH_V2_HMAC = 2;

function getHmacSecret(): string | undefined {
  return process.env.STRATUM_API_KEY_HMAC_SECRET;
}

/** Legacy SHA-256 hash (v1). */
function sha256Hash(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** HMAC-SHA256 hash (v2). Requires STRATUM_API_KEY_HMAC_SECRET. */
function hmacHash(key: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(key).digest("hex");
}

/**
 * Hash a key using the best available method.
 * Returns HMAC-SHA256 if STRATUM_API_KEY_HMAC_SECRET is set, otherwise SHA-256.
 */
function hashKey(key: string): { keyHash: string; hashVersion: number } {
  const secret = getHmacSecret();
  if (secret) {
    return { keyHash: hmacHash(key, secret), hashVersion: HASH_V2_HMAC };
  }
  return { keyHash: sha256Hash(key), hashVersion: HASH_V1_SHA256 };
}

export function generateKey(keyPrefix: string): { plaintextKey: string; keyHash: string; hashVersion: number } {
  const random = crypto.randomBytes(32).toString("base64url");
  const plaintextKey = `${keyPrefix}${random}`;
  const { keyHash, hashVersion } = hashKey(plaintextKey);
  return { plaintextKey, keyHash, hashVersion };
}

export interface CreateApiKeyOptions {
  name?: string;
  expiresAt?: Date;
  rateLimitMax?: number;
  rateLimitWindow?: string;
}

export async function createApiKey(
  pool: pg.Pool,
  keyPrefix: string,
  tenantId: string,
  nameOrOptions?: string | CreateApiKeyOptions,
  expiresAt?: Date,
): Promise<CreatedApiKey> {
  // Support both old signature (name, expiresAt) and new options object
  const opts: CreateApiKeyOptions = typeof nameOrOptions === "object" && nameOrOptions !== null
    ? nameOrOptions
    : { name: nameOrOptions, expiresAt };
  const { plaintextKey, keyHash, hashVersion } = generateKey(keyPrefix);

  return withClient(pool, async (client) => {
    const res = await client.query<ApiKeyRecord>(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, expires_at, rate_limit_max, rate_limit_window, hash_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenantId, keyHash, keyPrefix, opts.name ?? null, opts.expiresAt ?? null, opts.rateLimitMax ?? null, opts.rateLimitWindow ?? null, hashVersion],
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

export interface ValidatedApiKey {
  tenant_id: string | null;
  key_id: string;
  scopes: string[];
  rate_limit_max: number | null;
  rate_limit_window: string | null;
}

export async function validateApiKey(
  pool: pg.Pool,
  key: string,
): Promise<ValidatedApiKey | null> {
  const hmacSecret = getHmacSecret();

  // Build candidate hashes: try HMAC first (if secret is set), then SHA-256 fallback
  const candidates: Array<{ hash: string; version: number }> = [];
  if (hmacSecret) {
    candidates.push({ hash: hmacHash(key, hmacSecret), version: HASH_V2_HMAC });
  }
  candidates.push({ hash: sha256Hash(key), version: HASH_V1_SHA256 });

  return withClient(pool, async (client) => {
    for (const candidate of candidates) {
      const res = await client.query<ApiKeyRecord & { scopes: string[] | null; rate_limit_max: number | null; rate_limit_window: string | null }>(
        `SELECT id, tenant_id, key_hash, key_prefix, name, created_at, last_used_at, revoked_at, expires_at, scopes, rate_limit_max, rate_limit_window, hash_version
         FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
        [candidate.hash],
      );

      if (res.rows.length === 0) continue;

      const row = res.rows[0];

      // Transparent upgrade: if we matched via legacy SHA-256 but HMAC secret is available,
      // re-hash with HMAC and update the stored hash in-place
      if (row.hash_version === HASH_V1_SHA256 && hmacSecret) {
        const upgradedHash = hmacHash(key, hmacSecret);
        pool
          .query(
            `UPDATE api_keys SET key_hash = $1, hash_version = $2, last_used_at = now() WHERE id = $3`,
            [upgradedHash, HASH_V2_HMAC, row.id],
          )
          .catch(() => {
            // Non-critical: upgrade will happen on next request
          });
      } else {
        // Update last_used_at — fire-and-forget
        pool
          .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id])
          .catch(() => {});
      }

      return {
        tenant_id: row.tenant_id,
        key_id: row.id,
        scopes: row.scopes ?? ["read"],
        rate_limit_max: row.rate_limit_max,
        rate_limit_window: row.rate_limit_window,
      };
    }

    return null;
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
    const { plaintextKey, keyHash, hashVersion } = generateKey(keyPrefix);
    const res = await client.query<{ id: string; tenant_id: string | null; name: string | null; key_prefix: string | null; created_at: Date }>(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, hash_version)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, name, key_prefix, created_at`,
      [old.tenant_id, keyHash, keyPrefix, newName ?? `${old.name ?? "key"} (rotated)`, hashVersion],
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
