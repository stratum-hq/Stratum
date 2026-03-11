import crypto from "crypto";
import { connectDb, checkStratumTables } from "../utils/db.js";
import * as log from "../utils/log.js";

export async function generateApiKey(flags: Record<string, string | boolean>): Promise<void> {
  log.heading("Generate API Key");

  const pool = await connectDb(flags);

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
    const keyHash = crypto.createHash("sha256").update(plaintextKey).digest("hex");
    const keyPrefix = plaintextKey.slice(0, 12);

    // Insert into database
    const result = await pool.query(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [tenantId, keyHash, keyPrefix, name],
    );

    const { id, created_at } = result.rows[0];

    log.success("API key generated successfully");
    console.log();
    log.info(`ID:      ${id}`);
    log.info(`Name:    ${name || "(unnamed)"}`);
    log.info(`Tenant:  ${tenantId || "(global)"}`);
    log.info(`Created: ${created_at}`);
    console.log();
    console.log(`  \x1b[1m\x1b[33mKey: ${plaintextKey}\x1b[0m`);
    console.log();
    log.warn("Save this key now — it will never be shown again.");
    console.log();
  } finally {
    await pool.end();
  }
}
