import crypto from "node:crypto";
import dns from "node:dns/promises";
import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import type { TenantEvent } from "@stratum/core";
import { getWebhooksForEvent, decryptSecret } from "./webhook-service.js";

const MAX_ATTEMPTS = 5;

/** Blocked IP ranges for SSRF protection */
const BLOCKED_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
  /^192\.168\./, // RFC 1918
  /^169\.254\./, // link-local
  /^0\./, // current network
  /^::1$/, // IPv6 loopback
  /^fc00:/, // IPv6 unique local
  /^fe80:/, // IPv6 link-local
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal", // GCP metadata
]);

/** Check if an IP matches any blocked private/reserved range. */
function isBlockedIp(ip: string): boolean {
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

/** Validates that a webhook URL does not target internal/private networks. */
function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Webhook URL must use http or https: ${url}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Webhook URL targets a blocked host: ${hostname}`);
  }

  // Block cloud metadata IPs (169.254.169.254, etc.)
  if (hostname === "169.254.169.254") {
    throw new Error(`Webhook URL targets cloud metadata endpoint`);
  }

  // Block private IP ranges
  if (isBlockedIp(hostname)) {
    throw new Error(`Webhook URL targets a private/reserved IP range: ${hostname}`);
  }
}

/**
 * DNS-rebinding-safe validation: resolve hostname and check all resolved IPs
 * against blocked ranges. Call this at delivery time, not just registration.
 */
async function validateWebhookUrlWithDns(url: string): Promise<void> {
  // First run the synchronous checks
  validateWebhookUrl(url);

  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  // If hostname is already an IP literal, synchronous check is sufficient
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[")) {
    return;
  }

  // Resolve DNS and validate all returned IPs
  let addresses: string[];
  try {
    const results = await dns.resolve4(hostname);
    addresses = results;
  } catch {
    // DNS resolution failed — allow delivery attempt (will fail on fetch)
    return;
  }

  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      throw new Error(
        `Webhook URL hostname ${hostname} resolves to blocked IP ${ip}`,
      );
    }
  }
}

function signPayload(secret: string, payload: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex")
  );
}

function retryDelayMs(attempts: number): number {
  // attempts^2 * 5000ms: 5s, 20s, 45s, 80s, 125s
  return Math.pow(attempts, 2) * 5000;
}

interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event_id: string;
  status: string;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  response_code: number | null;
  created_at: string;
  completed_at: string | null;
}

interface WebhookEventRow {
  id: string;
  type: string;
  tenant_id: string;
  data: Record<string, unknown>;
  created_at: string;
}

interface WebhookRow {
  id: string;
  tenant_id: string | null;
  url: string;
  secret_hash: string;
  events: string[];
  active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function emitEvent(
  pool: pg.Pool,
  type: TenantEvent,
  tenantId: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Insert event record
  const eventRow = await withClient(pool, async (client) => {
    const res = await client.query<WebhookEventRow>(
      `INSERT INTO webhook_events (type, tenant_id, data)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [type, tenantId, JSON.stringify(data)],
    );
    return res.rows[0];
  });

  // Find matching webhooks
  const webhooks = await getWebhooksForEvent(pool, type, tenantId);

  if (webhooks.length === 0) {
    return;
  }

  // Create delivery records for each matching webhook
  await withClient(pool, async (client) => {
    for (const webhook of webhooks) {
      await client.query(
        `INSERT INTO webhook_deliveries (webhook_id, event_id, status, attempts)
         VALUES ($1, $2, 'pending', 0)`,
        [webhook.id, eventRow.id],
      );
    }
  });

  // Fire-and-forget delivery — do not await
  processDeliveries(pool).catch(() => {
    // Non-critical: delivery failures are tracked in webhook_deliveries
  });
}

export async function deliverWebhook(
  webhook: WebhookRow,
  event: WebhookEventRow,
  deliveryId: string,
): Promise<{ success: boolean; responseCode: number | null; error: string | null }> {
  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    tenant_id: event.tenant_id,
    data: event.data,
    created_at: event.created_at,
  });

  // SSRF protection: validate URL with DNS rebinding check before making request
  await validateWebhookUrlWithDns(webhook.url);

  const rawSecret = decryptSecret(webhook.secret_hash);
  const signature = signPayload(rawSecret, payload);
  const timestamp = new Date().toISOString();

  try {
    const response = await globalThis.fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stratum-Event": event.type,
        "X-Stratum-Signature": signature,
        "X-Stratum-Delivery-ID": deliveryId,
        "X-Stratum-Timestamp": timestamp,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return { success: true, responseCode: response.status, error: null };
    }

    return {
      success: false,
      responseCode: response.status,
      error: `HTTP ${response.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, responseCode: null, error: message };
  }
}

export async function processDeliveries(pool: pg.Pool): Promise<void> {
  // Find pending deliveries due for delivery
  const deliveries = await withClient(pool, async (client) => {
    const res = await client.query<WebhookDeliveryRow>(
      `SELECT * FROM webhook_deliveries
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= now())
       ORDER BY created_at ASC
       LIMIT 100`,
    );
    return res.rows;
  });

  for (const delivery of deliveries) {
    await withTransaction(pool, async (client) => {
      // Re-fetch delivery with row lock
      const lockRes = await client.query<WebhookDeliveryRow>(
        `SELECT * FROM webhook_deliveries WHERE id = $1 AND status = 'pending' FOR UPDATE SKIP LOCKED`,
        [delivery.id],
      );
      if (lockRes.rows.length === 0) {
        return; // Already processed by another worker
      }

      const locked = lockRes.rows[0];

      // Fetch the webhook and event
      const webhookRes = await client.query<WebhookRow>(
        `SELECT * FROM webhooks WHERE id = $1`,
        [locked.webhook_id],
      );
      const eventRes = await client.query<WebhookEventRow>(
        `SELECT * FROM webhook_events WHERE id = $1`,
        [locked.event_id],
      );

      if (webhookRes.rows.length === 0 || eventRes.rows.length === 0) {
        // Webhook or event was deleted; mark failed
        await client.query(
          `UPDATE webhook_deliveries
           SET status = 'failed', last_error = 'Webhook or event not found', completed_at = now()
           WHERE id = $1`,
          [locked.id],
        );
        return;
      }

      const webhook = webhookRes.rows[0];
      const event = eventRes.rows[0];
      const attempts = locked.attempts + 1;

      const result = await deliverWebhook(webhook, event, locked.id);

      if (result.success) {
        await client.query(
          `UPDATE webhook_deliveries
           SET status = 'success', attempts = $1, response_code = $2,
               last_error = NULL, completed_at = now()
           WHERE id = $3`,
          [attempts, result.responseCode, locked.id],
        );
      } else if (attempts >= MAX_ATTEMPTS) {
        await client.query(
          `UPDATE webhook_deliveries
           SET status = 'failed', attempts = $1, response_code = $2,
               last_error = $3, completed_at = now()
           WHERE id = $4`,
          [attempts, result.responseCode, result.error, locked.id],
        );
      } else {
        const nextRetryMs = retryDelayMs(attempts);
        await client.query(
          `UPDATE webhook_deliveries
           SET attempts = $1, response_code = $2, last_error = $3,
               next_retry_at = now() + ($4 || ' milliseconds')::interval
           WHERE id = $5`,
          [attempts, result.responseCode, result.error, nextRetryMs, locked.id],
        );
      }
    }).catch(() => {
      // Per-delivery failures are non-fatal; continue processing others
    });
  }
}

export async function retryFailedDeliveries(pool: pg.Pool): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(
      `UPDATE webhook_deliveries
       SET status = 'pending', next_retry_at = NULL
       WHERE status = 'failed'
         AND attempts < $1`,
      [MAX_ATTEMPTS],
    );
  });

  await processDeliveries(pool);
}
