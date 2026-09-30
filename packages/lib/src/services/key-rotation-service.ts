import pg from "pg";
import { withTransaction } from "../pool-helpers.js";
import { ValidationError } from "@stratum-hq/core";
import { encryptWithKeyMaterial, decryptWithKeyMaterial } from "../crypto.js";

/** A row that decrypts with neither the old key nor the new key. Rotation leaves it unchanged. */
export interface KeyRotationUnreadableRow {
  table: "config_entries" | "webhooks";
  id: string;
}

export interface KeyRotationResult {
  config_entries_rotated: number;
  webhooks_rotated: number;
  /** Rows that already decrypt with the new key, for example after an interrupted run. */
  already_rotated: number;
  /** Rows that decrypt with neither key. */
  unreadable: KeyRotationUnreadableRow[];
}

/** HKDF salts for a rotation, in the hex format of STRATUM_HKDF_SALT.
 * A salt that is not given is the configured STRATUM_HKDF_SALT. */
export interface KeyRotationSalts {
  /** The salt that the existing values were encrypted under. */
  oldSalt?: string;
  /** The salt that the rotation encrypts under. */
  newSalt?: string;
}

// Lowest possible UUID; a keyset cursor starting here precedes every real row.
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

type RotateOutcome = { kind: "rotated"; value: string } | { kind: "already_rotated" } | { kind: "unreadable" };

// A run that fails partway leaves earlier batches committed under the new key.
// Accepting those values, instead of failing on them, is what lets a re-run
// with the same keys finish the rotation.
function rotateValue(
  encrypted: string,
  oldKeyMaterial: string,
  newKeyMaterial: string,
  salts: KeyRotationSalts,
): RotateOutcome {
  const plaintext = decryptWithKeyMaterial(encrypted, oldKeyMaterial, salts.oldSalt);
  if (plaintext !== null) {
    return { kind: "rotated", value: encryptWithKeyMaterial(plaintext, newKeyMaterial, salts.newSalt) };
  }
  if (decryptWithKeyMaterial(encrypted, newKeyMaterial, salts.newSalt) !== null) return { kind: "already_rotated" };
  return { kind: "unreadable" };
}

/**
 * Re-encrypts all sensitive data (config entries and webhook secrets)
 * from (oldKey, oldSalt) to (newKey, newSalt) in batches, walking the primary key with a keyset
 * cursor (id > lastId, ordered by id) so every row is visited exactly once.
 * Each batch is its own transaction so locks are held briefly.
 *
 * The run is safe to repeat with the same keys. A value that already decrypts
 * with the new key stays as it is and counts in `already_rotated`. A value that
 * decrypts with neither key stays as it is and appears in `unreadable`.
 *
 * Throws a ValidationError when encrypted values exist and none of them
 * decrypts with either key. That result almost always means `oldKeyMaterial`
 * or `salts.oldSalt` is wrong, and the run has changed no row.
 *
 * To move the data to a new HKDF salt, give `salts.oldSalt` and `salts.newSalt`.
 * The old key and the new key can then be the same.
 *
 * After rotation, update the STRATUM_ENCRYPTION_KEY environment variable to
 * the new key, and STRATUM_HKDF_SALT to the new salt.
 */
export async function rotateEncryptionKey(
  pool: pg.Pool,
  oldKeyMaterial: string,
  newKeyMaterial: string,
  batchSize: number = 100,
  salts: KeyRotationSalts = {},
): Promise<KeyRotationResult> {
  let configCount = 0;
  let webhookCount = 0;
  let alreadyRotated = 0;
  const unreadable: KeyRotationUnreadableRow[] = [];

  // Process config entries in batches, advancing a keyset cursor by id.
  let lastConfigId = ZERO_UUID;
  while (true) {
    const count = await withTransaction(pool, async (client) => {
      const batch = await client.query<{ id: string; value: string }>(
        `SELECT id, value FROM config_entries
         WHERE sensitive = true AND id > $1
         ORDER BY id LIMIT $2 FOR UPDATE`,
        [lastConfigId, batchSize],
      );
      if (batch.rows.length === 0) return 0;
      for (const row of batch.rows) {
        const outcome = rotateValue(row.value, oldKeyMaterial, newKeyMaterial, salts);
        if (outcome.kind === "already_rotated") {
          alreadyRotated++;
        } else if (outcome.kind === "unreadable") {
          unreadable.push({ table: "config_entries", id: row.id });
        } else {
          await client.query(
            `UPDATE config_entries SET value = $1, updated_at = now() WHERE id = $2`,
            [JSON.stringify(outcome.value), row.id],
          );
          configCount++;
        }
      }
      lastConfigId = batch.rows[batch.rows.length - 1].id;
      return batch.rows.length;
    });
    if (count < batchSize) break;
  }

  // Process webhooks in batches, advancing a keyset cursor by id.
  let lastWebhookId = ZERO_UUID;
  while (true) {
    const count = await withTransaction(pool, async (client) => {
      const batch = await client.query<{ id: string; secret_hash: string }>(
        `SELECT id, secret_hash FROM webhooks
         WHERE secret_hash IS NOT NULL AND id > $1
         ORDER BY id LIMIT $2 FOR UPDATE`,
        [lastWebhookId, batchSize],
      );
      if (batch.rows.length === 0) return 0;
      for (const row of batch.rows) {
        const outcome = rotateValue(row.secret_hash, oldKeyMaterial, newKeyMaterial, salts);
        if (outcome.kind === "already_rotated") {
          alreadyRotated++;
        } else if (outcome.kind === "unreadable") {
          unreadable.push({ table: "webhooks", id: row.id });
        } else {
          await client.query(
            `UPDATE webhooks SET secret_hash = $1 WHERE id = $2`,
            [outcome.value, row.id],
          );
          webhookCount++;
        }
      }
      lastWebhookId = batch.rows[batch.rows.length - 1].id;
      return batch.rows.length;
    });
    if (count < batchSize) break;
  }

  // A run that changed nothing and matched no value on either key must not look
  // like a success, because the operator would then retire a key that is still in use.
  if (unreadable.length > 0 && configCount + webhookCount + alreadyRotated === 0) {
    throw new ValidationError(
      "Key rotation found no encrypted value that decrypts with the old key or the new key. Check the old key. No row was changed.",
      { unreadable: unreadable.length },
    );
  }

  return {
    config_entries_rotated: configCount,
    webhooks_rotated: webhookCount,
    already_rotated: alreadyRotated,
    unreadable,
  };
}
