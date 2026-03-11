import crypto from "node:crypto";
import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import type {
  Webhook,
  CreateWebhookInput,
  UpdateWebhookInput,
} from "@stratum/core";
import { WebhookNotFoundError } from "@stratum/core";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 256-bit encryption key from WEBHOOK_ENCRYPTION_KEY env var.
 * Falls back to a deterministic key derived from NODE_ENV for development only.
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (envKey) {
    return crypto.createHash("sha256").update(envKey).digest();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("WEBHOOK_ENCRYPTION_KEY must be set in production");
  }
  // Dev-only fallback — not secure for production
  return crypto.createHash("sha256").update("stratum-dev-key").digest();
}

/** Encrypts a webhook secret for storage. Returns hex-encoded iv:authTag:ciphertext. */
function encryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypts a stored webhook secret. Input is hex-encoded iv:authTag:ciphertext. */
export function decryptSecret(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Invalid encrypted secret format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

export async function createWebhook(
  pool: pg.Pool,
  input: CreateWebhookInput,
): Promise<Webhook> {
  return withClient(pool, async (client) => {
    const encryptedSecret = encryptSecret(input.secret);
    const res = await client.query<Webhook>(
      `INSERT INTO webhooks (tenant_id, url, secret_hash, events, active, description)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING *`,
      [
        input.tenant_id ?? null,
        input.url,
        encryptedSecret,
        input.events,
        input.description ?? null,
      ],
    );
    return res.rows[0];
  });
}

export async function getWebhook(pool: pg.Pool, id: string): Promise<Webhook> {
  return withClient(pool, async (client) => {
    const res = await client.query<Webhook>(
      `SELECT * FROM webhooks WHERE id = $1`,
      [id],
    );
    if (res.rows.length === 0) {
      throw new WebhookNotFoundError(id);
    }
    return res.rows[0];
  });
}

export async function listWebhooks(
  pool: pg.Pool,
  tenantId?: string | null,
): Promise<Webhook[]> {
  return withClient(pool, async (client) => {
    let res: pg.QueryResult<Webhook>;
    if (tenantId !== undefined && tenantId !== null) {
      res = await client.query<Webhook>(
        `SELECT * FROM webhooks WHERE tenant_id = $1 ORDER BY created_at ASC`,
        [tenantId],
      );
    } else {
      res = await client.query<Webhook>(
        `SELECT * FROM webhooks ORDER BY created_at ASC`,
      );
    }
    return res.rows;
  });
}

export async function updateWebhook(
  pool: pg.Pool,
  id: string,
  input: UpdateWebhookInput,
): Promise<Webhook> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<Webhook>(
      `SELECT * FROM webhooks WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      throw new WebhookNotFoundError(id);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.url !== undefined) {
      sets.push(`url = $${idx++}`);
      values.push(input.url);
    }
    if (input.secret !== undefined) {
      sets.push(`secret_hash = $${idx++}`);
      values.push(encryptSecret(input.secret));
    }
    if (input.events !== undefined) {
      sets.push(`events = $${idx++}`);
      values.push(input.events);
    }
    if (input.active !== undefined) {
      sets.push(`active = $${idx++}`);
      values.push(input.active);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${idx++}`);
      values.push(input.description);
    }

    if (sets.length === 0) {
      return existing.rows[0];
    }

    sets.push(`updated_at = now()`);
    values.push(id);

    const res = await client.query<Webhook>(
      `UPDATE webhooks SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return res.rows[0];
  });
}

export async function deleteWebhook(pool: pg.Pool, id: string): Promise<void> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ id: string }>(
      `DELETE FROM webhooks WHERE id = $1 RETURNING id`,
      [id],
    );
    if (res.rows.length === 0) {
      throw new WebhookNotFoundError(id);
    }
  });
}

export async function listWebhookDeliveries(
  pool: pg.Pool,
  webhookId: string,
): Promise<Record<string, unknown>[]> {
  return withClient(pool, async (client) => {
    // Verify webhook exists
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM webhooks WHERE id = $1`,
      [webhookId],
    );
    if (existing.rows.length === 0) {
      throw new WebhookNotFoundError(webhookId);
    }
    const res = await client.query<Record<string, unknown>>(
      `SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [webhookId],
    );
    return res.rows;
  });
}

export async function getWebhooksForEvent(
  pool: pg.Pool,
  eventType: string,
  tenantId: string,
): Promise<Webhook[]> {
  return withClient(pool, async (client) => {
    const res = await client.query<Webhook>(
      `SELECT * FROM webhooks
       WHERE active = true
         AND $1 = ANY(events)
         AND (tenant_id IS NULL OR tenant_id = $2)`,
      [eventType, tenantId],
    );
    return res.rows;
  });
}
