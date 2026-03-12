import pg from "pg";
import { withTransaction } from "../pool-helpers.js";
import { reEncrypt } from "../crypto.js";

export interface KeyRotationResult {
  config_entries_rotated: number;
  webhooks_rotated: number;
}

/**
 * Re-encrypts all sensitive data (config entries and webhook secrets)
 * from oldKey to newKey in a single transaction.
 *
 * This is a zero-downtime operation: the transaction ensures either
 * all values are rotated or none are. After rotation, update the
 * STRATUM_ENCRYPTION_KEY environment variable to the new key.
 */
export async function rotateEncryptionKey(
  pool: pg.Pool,
  oldKeyMaterial: string,
  newKeyMaterial: string,
): Promise<KeyRotationResult> {
  return withTransaction(pool, async (client) => {
    let configCount = 0;
    let webhookCount = 0;

    // 1. Re-encrypt sensitive config entries
    const configRes = await client.query<{ id: string; value: string }>(
      `SELECT id, value FROM config_entries WHERE sensitive = true`,
    );

    for (const row of configRes.rows) {
      // value is stored as JSON string containing the encrypted blob
      const encryptedBlob = JSON.parse(row.value) as string;
      const reEncrypted = reEncrypt(encryptedBlob, oldKeyMaterial, newKeyMaterial);
      await client.query(
        `UPDATE config_entries SET value = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(reEncrypted), row.id],
      );
      configCount++;
    }

    // 2. Re-encrypt webhook secrets
    const webhookRes = await client.query<{ id: string; secret_hash: string }>(
      `SELECT id, secret_hash FROM webhooks WHERE secret_hash IS NOT NULL`,
    );

    for (const row of webhookRes.rows) {
      const reEncrypted = reEncrypt(row.secret_hash, oldKeyMaterial, newKeyMaterial);
      await client.query(
        `UPDATE webhooks SET secret_hash = $1 WHERE id = $2`,
        [reEncrypted, row.id],
      );
      webhookCount++;
    }

    return {
      config_entries_rotated: configCount,
      webhooks_rotated: webhookCount,
    };
  });
}
