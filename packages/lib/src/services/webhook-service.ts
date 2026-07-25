import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import type {
  Webhook,
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookEvent,
  WebhookDelivery,
  ListWebhookEventsQuery,
} from "@stratum-hq/core";
import { WebhookNotFoundError } from "@stratum-hq/core";
import { encrypt, decrypt } from "../crypto.js";

/** Columns safe to return in API responses (excludes secret_hash). */
const WEBHOOK_PUBLIC_COLS = "id, tenant_id, url, events, active, description, created_at, updated_at";

/** Encrypts a webhook secret for storage. */
function encryptSecret(secret: string): string {
  return encrypt(secret);
}

/** Decrypts a stored webhook secret. */
export function decryptSecret(encrypted: string): string {
  return decrypt(encrypted);
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
       RETURNING ${WEBHOOK_PUBLIC_COLS}`,
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
      `SELECT ${WEBHOOK_PUBLIC_COLS} FROM webhooks WHERE id = $1`,
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
        `SELECT ${WEBHOOK_PUBLIC_COLS} FROM webhooks WHERE tenant_id = $1 ORDER BY created_at ASC`,
        [tenantId],
      );
    } else {
      res = await client.query<Webhook>(
        `SELECT ${WEBHOOK_PUBLIC_COLS} FROM webhooks ORDER BY created_at ASC`,
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
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM webhooks WHERE id = $1`,
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
      const current = await client.query<Webhook>(
        `SELECT ${WEBHOOK_PUBLIC_COLS} FROM webhooks WHERE id = $1`,
        [id],
      );
      return current.rows[0];
    }

    sets.push(`updated_at = now()`);
    values.push(id);

    const res = await client.query<Webhook>(
      `UPDATE webhooks SET ${sets.join(", ")} WHERE id = $${idx} RETURNING ${WEBHOOK_PUBLIC_COLS}`,
      values,
    );
    return res.rows[0];
  });
}

export async function deleteWebhook(pool: pg.Pool, id: string): Promise<void> {
  return withTransaction(pool, async (client) => {
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
      `SELECT id, webhook_id, event_id, status, attempts, next_retry_at, last_error, response_code, created_at, completed_at
       FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [webhookId],
    );
    return res.rows;
  });
}

// Timestamps are cast ::text so the returned rows honor the string contract of
// WebhookEvent / WebhookDelivery (pg otherwise hands back Date objects), the
// same convention queryAuditLogs and usage-service use for their typed rows.
/** Columns of a webhook_events row, in WebhookEvent shape. */
const WEBHOOK_EVENT_COLS =
  "id, type, tenant_id, data, created_at::text as created_at";

/** Columns of a webhook_deliveries row, in WebhookDelivery shape. */
const WEBHOOK_DELIVERY_COLS =
  "id, webhook_id, event_id, status, attempts, next_retry_at::text as next_retry_at, last_error, response_code, created_at::text as created_at, completed_at::text as completed_at";

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 100;

/**
 * List a tenant's webhook events, newest first. Always scoped to
 * query.tenantId so a caller can never page another tenant's events;
 * optionally narrowed by type and a created_at window, and paginated.
 */
export async function listWebhookEvents(
  pool: pg.Pool,
  query: ListWebhookEventsQuery,
): Promise<WebhookEvent[]> {
  const limit = Math.min(
    Math.max(query.limit ?? DEFAULT_EVENT_LIMIT, 1),
    MAX_EVENT_LIMIT,
  );
  const offset = Math.max(query.offset ?? 0, 0);

  const conditions = ["tenant_id = $1"];
  const params: unknown[] = [query.tenantId];
  let idx = 2;

  if (query.type !== undefined) {
    conditions.push(`type = $${idx++}`);
    params.push(query.type);
  }
  if (query.from !== undefined) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(query.from);
  }
  if (query.to !== undefined) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(query.to);
  }

  params.push(limit, offset);

  return withClient(pool, async (client) => {
    const res = await client.query<WebhookEvent>(
      `SELECT ${WEBHOOK_EVENT_COLS} FROM webhook_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return res.rows;
  });
}

/** List every delivery for a single event, newest first. */
export async function listDeliveriesByEvent(
  pool: pg.Pool,
  eventId: string,
): Promise<WebhookDelivery[]> {
  return withClient(pool, async (client) => {
    const res = await client.query<WebhookDelivery>(
      `SELECT ${WEBHOOK_DELIVERY_COLS} FROM webhook_deliveries
       WHERE event_id = $1 ORDER BY created_at DESC, id DESC`,
      [eventId],
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
      `SELECT ${WEBHOOK_PUBLIC_COLS}, secret_hash FROM webhooks
       WHERE active = true
         AND $1 = ANY(events)
         AND (tenant_id IS NULL OR tenant_id = $2)`,
      [eventType, tenantId],
    );
    return res.rows;
  });
}
