import crypto from "node:crypto";
import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import { resolveEffectiveScopesOnClient } from "./role-service.js";

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

/**
 * A validation stamps last_used_at only when the stored value is older than
 * this. Concurrent requests with one key then do not all wait on its row lock.
 * The cost: last_used_at can lag the latest use by up to this interval.
 */
const STAMP_INTERVAL_SECONDS = 60;

/**
 * The longest time a validation waits for its last_used_at stamp. A stamp
 * that waits on a row lock then cannot delay authentication for longer.
 */
const STAMP_TIMEOUT_MS = 1000;

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

  // Everything below runs on one pooled connection: nothing here may acquire a
  // second connection while this one is held.
  const found = await withClient(pool, async (client) => {
    for (const candidate of candidates) {
      // A tenant-bound key authenticates only while its tenant and every
      // ancestor are active. Global keys (tenant_id NULL) have no tenant.
      const res = await client.query<ApiKeyRecord & { scopes: string[] | null; rate_limit_max: number | null; rate_limit_window: string | null; stamp_due: boolean }>(
        `SELECT ak.id, ak.tenant_id, ak.key_hash, ak.key_prefix, ak.name, ak.created_at, ak.last_used_at, ak.revoked_at, ak.expires_at, ak.scopes, ak.rate_limit_max, ak.rate_limit_window, ak.hash_version,
                (ak.last_used_at IS NULL OR ak.last_used_at < now() - make_interval(secs => $2)) AS stamp_due
         FROM api_keys ak
         LEFT JOIN tenants t ON t.id = ak.tenant_id
         WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL AND (ak.expires_at IS NULL OR ak.expires_at > now())
           AND (ak.tenant_id IS NULL OR (
             t.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM tenants anc
               WHERE anc.id = ANY (string_to_array(trim(both '/' from t.ancestry_path), '/')::uuid[])
                 AND anc.status <> 'active'
             )
           ))`,
        [candidate.hash, STAMP_INTERVAL_SECONDS],
      );

      if (res.rows.length === 0) continue;

      const row = res.rows[0];

      return {
        row,
        validated: {
          tenant_id: row.tenant_id,
          key_id: row.id,
          // Resolve through the single source so an assigned role governs the
          // key's scopes at the auth boundary, exactly as resolveKeyScopes does.
          scopes: await resolveEffectiveScopesOnClient(client, row.id),
          rate_limit_max: row.rate_limit_max,
          rate_limit_window: row.rate_limit_window,
        },
      };
    }

    return null;
  });

  if (!found) return null;

  // The bookkeeping starts only after the validation connection is released,
  // so a single-connection pool cannot deadlock. withClient gives it the RLS bypass.
  // When a stamp is due, we await it so that a read made after validateApiKey
  // resolves sees the new last_used_at. Without the await, listDormantKeys can
  // report a just-used key.
  // Transparent upgrade: if we matched via legacy SHA-256 but HMAC secret is
  // available, re-hash with HMAC and update the stored hash in-place.
  const { row } = found;
  const upgrade = row.hash_version === HASH_V1_SHA256 && hmacSecret;
  if (!upgrade && !row.stamp_due) return found.validated;
  await withClient(pool, async (client) => {
    // SET LOCAL ends with this transaction, so the pooled connection keeps its own timeout.
    await client.query(`SET LOCAL statement_timeout = ${STAMP_TIMEOUT_MS}`);
    return upgrade
      ? client.query(
          `UPDATE api_keys SET key_hash = $1, hash_version = $2, last_used_at = now() WHERE id = $3`,
          [hmacHash(key, hmacSecret), HASH_V2_HMAC, row.id],
        )
      : // The condition repeats the check, so a concurrent request that stamped first wins.
        client.query(
          `UPDATE api_keys SET last_used_at = now()
           WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - make_interval(secs => $2))`,
          [row.id, STAMP_INTERVAL_SECONDS],
        );
  }).catch(() => {
    // A failed or timed-out stamp must not fail authentication. A later request retries it.
  });

  return found.validated;
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
    // Verify old key exists, is not revoked and has not expired
    const oldRes = await client.query<{
      id: string;
      tenant_id: string | null;
      name: string | null;
      key_prefix: string | null;
      scopes: string[] | null;
      role_id: string | null;
      expires_at: Date | null;
      rate_limit_max: number | null;
      rate_limit_window: string | null;
    }>(
      `SELECT id, tenant_id, name, key_prefix, scopes, role_id, expires_at, rate_limit_max, rate_limit_window
       FROM api_keys
       WHERE id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
       FOR UPDATE`,
      [oldKeyId],
    );
    if (oldRes.rows.length === 0) {
      throw new Error(`API key not found, expired or already revoked: ${oldKeyId}`);
    }
    const old = oldRes.rows[0];

    // Create the new key for the same tenant with the same restrictions: scopes,
    // role, expiry and rate limit carry over, so rotation never widens access.
    const { plaintextKey, keyHash, hashVersion } = generateKey(keyPrefix);
    const res = await client.query<{ id: string; tenant_id: string | null; name: string | null; key_prefix: string | null; created_at: Date }>(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, hash_version, scopes, role_id, expires_at, rate_limit_max, rate_limit_window)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, tenant_id, name, key_prefix, created_at`,
      [
        old.tenant_id, keyHash, keyPrefix, newName ?? `${old.name ?? "key"} (rotated)`, hashVersion,
        old.scopes, old.role_id, old.expires_at, old.rate_limit_max, old.rate_limit_window,
      ],
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

/**
 * Look up a single API key by id, including its owning tenant. Returns null when
 * no key has that id. Used to authorize operations that target a key by id (for
 * example role assignment), whose owning tenant is not otherwise in the request.
 */
export async function getApiKey(
  pool: pg.Pool,
  id: string,
): Promise<{ id: string; tenant_id: string | null; name: string | null; created_at: Date; last_used_at: Date | null; revoked_at: Date | null; expires_at: Date | null } | null> {
  return withClient(pool, async (client) => {
    const res = await client.query(
      `SELECT id, tenant_id, name, created_at, last_used_at, revoked_at, expires_at
       FROM api_keys WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  });
}

/**
 * List the unrevoked keys not used for `dormantDays` days.
 * validateApiKey refreshes last_used_at at most once a minute, so a key can
 * look up to one minute older than its latest use. That does not change a
 * result measured in days.
 */
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
