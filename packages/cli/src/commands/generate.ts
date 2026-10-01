import crypto from "crypto";
import { connectDb, connectAdminDb, checkStratumTables, controlRoleFlag, crossTenantRunner } from "../utils/db.js";
import * as log from "../utils/log.js";

const MIN_HMAC_SECRET_BYTES = 32;

/**
 * The stored hash of an API key, the way @stratum-hq/lib hashes it: HMAC-SHA256
 * (hash version 2) when STRATUM_API_KEY_HMAC_SECRET is set, else unkeyed
 * SHA-256 (version 1). With the secret set, the library accepts only HMAC
 * hashes once allowLegacyKeyHashes is off, so a SHA-256 hash would never
 * authenticate.
 */
export function hashApiKey(plaintextKey: string): { keyHash: string; hashVersion: number } {
  const secret = process.env.STRATUM_API_KEY_HMAC_SECRET;
  // The same minimum @stratum-hq/lib enforces outside development and test
  // (an unset NODE_ENV counts as development).
  const nodeEnv = process.env.NODE_ENV || "development";
  if (
    secret &&
    nodeEnv !== "development" &&
    nodeEnv !== "test" &&
    Buffer.byteLength(secret, "utf8") < MIN_HMAC_SECRET_BYTES
  ) {
    throw new Error(`STRATUM_API_KEY_HMAC_SECRET must be at least ${MIN_HMAC_SECRET_BYTES} bytes in ${nodeEnv}`);
  }
  if (secret) {
    return { keyHash: crypto.createHmac("sha256", secret).update(plaintextKey).digest("hex"), hashVersion: 2 };
  }
  return { keyHash: crypto.createHash("sha256").update(plaintextKey).digest("hex"), hashVersion: 1 };
}

export async function generateApiKey(flags: Record<string, string | boolean>): Promise<void> {
  log.heading("Generate API Key");

  const controlRole = controlRoleFlag(flags);
  const pool = await connectDb(flags);
  const adminPool = await connectAdminDb(flags).catch(async (err) => {
    await pool.end();
    throw err;
  });

  try {
    const hasSchema = await checkStratumTables(pool);
    if (!hasSchema) {
      log.fail("Stratum schema not found. Run the control plane first to create tables.");
      process.exit(1);
    }

    const name = typeof flags["name"] === "string" ? flags["name"] : null;
    const tenantId = typeof flags["tenant"] === "string" ? flags["tenant"] : null;

    // Determine prefix based on NODE_ENV
    const prefix = process.env.NODE_ENV === "production" ? "sk_live_" : "sk_test_";

    // Generate key
    const rawBytes = crypto.randomBytes(32);
    const plaintextKey = prefix + rawBytes.toString("base64url");
    const { keyHash, hashVersion } = hashApiKey(plaintextKey);
    const keyPrefix = plaintextKey.slice(0, 12);

    // api_keys has FORCE RLS, so the insert runs as the control role on the
    // admin login, or under the legacy administrative bypass.
    const run = await crossTenantRunner(pool, adminPool, controlRole);
    const result = await run((client) =>
      client.query(
        `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, hash_version)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [tenantId, keyHash, keyPrefix, name, hashVersion],
      ),
    );

    const { id, created_at } = result.rows[0];

    log.success("API key generated successfully");
    console.log();
    log.info(`ID:      ${id}`);
    log.info(`Name:    ${name || "(unnamed)"}`);
    log.info(`Tenant:  ${tenantId || "(global)"}`);
    log.info(`Created: ${created_at}`);
    log.info(`Hash:    ${hashVersion === 2 ? "HMAC-SHA256" : "SHA-256 (set STRATUM_API_KEY_HMAC_SECRET for HMAC)"}`);
    console.log();
    console.log(`  ${log.ansi("\x1b[1m\x1b[33m")}Key: ${plaintextKey}${log.ansi("\x1b[0m")}`);
    console.log();
    log.warn("Save this key now. It will never be shown again.");
    console.log();
  } finally {
    await pool.end();
    await adminPool?.end();
  }
}
