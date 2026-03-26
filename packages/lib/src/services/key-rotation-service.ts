import pg from "pg";
import { withTransaction } from "../pool-helpers.js";
import { reEncrypt } from "../crypto.js";

export interface KeyRotationResult {
  config_entries_rotated: number;
  webhooks_rotated: number;
}

/**
 * Re-encrypts all sensitive data (config entries and webhook secrets)
 * from oldKey to newKey in batches, using SKIP LOCKED to avoid blocking
 * concurrent writes. Each batch is its own transaction so locks are held briefly.
 *
 * After rotation, update the STRATUM_ENCRYPTION_KEY environment variable to
 * the new key.
 */
export async function rotateEncryptionKey(
  pool: pg.Pool,
  oldKeyMaterial: string,
  newKeyMaterial: string,
  batchSize: number = 100,
): Promise<KeyRotationResult> {
  let configCount = 0;
  let webhookCount = 0;

  // Process config entries in batches
  while (true) {
    const count = await withTransaction(pool, async (client) => {
      const batch = await client.query<{ id: string; value: string }>(
        `SELECT id, value FROM config_entries WHERE sensitive = true
         AND value NOT LIKE 'rotated:%' LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (batch.rows.length === 0) return 0;
      for (const row of batch.rows) {
        const encryptedBlob = JSON.parse(row.value) as string;
        const reEncrypted = reEncrypt(encryptedBlob, oldKeyMaterial, newKeyMaterial);
        await client.query(
          `UPDATE config_entries SET value = $1, updated_at = now() WHERE id = $2`,
          [JSON.stringify(reEncrypted), row.id],
        );
      }
      return batch.rows.length;
    });
    configCount += count;
    if (count < batchSize) break;
  }

  // Process webhooks in batches
  while (true) {
    const count = await withTransaction(pool, async (client) => {
      const batch = await client.query<{ id: string; secret_hash: string }>(
        `SELECT id, secret_hash FROM webhooks WHERE secret_hash IS NOT NULL LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (batch.rows.length === 0) return 0;
      for (const row of batch.rows) {
        const reEncrypted = reEncrypt(row.secret_hash, oldKeyMaterial, newKeyMaterial);
        await client.query(
          `UPDATE webhooks SET secret_hash = $1 WHERE id = $2`,
          [reEncrypted, row.id],
        );
      }
      return batch.rows.length;
    });
    webhookCount += count;
    if (count < batchSize) break;
  }

  return { config_entries_rotated: configCount, webhooks_rotated: webhookCount };
}
