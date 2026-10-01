import type { LookupAddress } from "node:dns";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import { WebhookUrlValidationError, type TenantEvent } from "@stratum-hq/core";
import { getWebhooksForEvent, decryptSecret } from "./webhook-service.js";
import { signWebhookPayload } from "../webhook-signature.js";
import { redactUrlForAudit } from "../url-redaction.js";

const MAX_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 10_000;
/** Deliveries claimed and sent concurrently per pass. */
const DELIVERY_BATCH_SIZE = 10;
/**
 * How long a claimed delivery stays invisible to other workers. Longer than a
 * delivery can take, so a row is only reclaimed if its worker died mid-flight.
 */
const DELIVERY_LEASE_MS = 60_000;

/**
 * Reserved, private, loopback, link-local, and cloud-metadata ranges, plus the
 * IANA special-purpose ranges, that a webhook must never target (SSRF protection). BlockList compares parsed address bytes,
 * so it matches every textual notation of an address, and it also checks an
 * IPv4-mapped IPv6 literal against the IPv4 rules.
 */
const BLOCKED_IP_RANGES = new net.BlockList();
// IPv4
BLOCKED_IP_RANGES.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network / unspecified
BLOCKED_IP_RANGES.addSubnet("10.0.0.0", 8, "ipv4"); // RFC 1918
BLOCKED_IP_RANGES.addSubnet("100.64.0.0", 10, "ipv4"); // shared address space (CGNAT), incl. some cloud metadata
BLOCKED_IP_RANGES.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
BLOCKED_IP_RANGES.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, incl. cloud metadata
BLOCKED_IP_RANGES.addSubnet("172.16.0.0", 12, "ipv4"); // RFC 1918
BLOCKED_IP_RANGES.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
BLOCKED_IP_RANGES.addSubnet("192.0.2.0", 24, "ipv4"); // documentation (TEST-NET-1)
BLOCKED_IP_RANGES.addSubnet("192.31.196.0", 24, "ipv4"); // AS112-v4
BLOCKED_IP_RANGES.addSubnet("192.52.193.0", 24, "ipv4"); // AMT
BLOCKED_IP_RANGES.addSubnet("192.88.99.0", 24, "ipv4"); // deprecated 6to4 relay anycast
BLOCKED_IP_RANGES.addSubnet("192.168.0.0", 16, "ipv4"); // RFC 1918
BLOCKED_IP_RANGES.addSubnet("192.175.48.0", 24, "ipv4"); // direct delegation AS112
BLOCKED_IP_RANGES.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
BLOCKED_IP_RANGES.addSubnet("198.51.100.0", 24, "ipv4"); // documentation (TEST-NET-2)
BLOCKED_IP_RANGES.addSubnet("203.0.113.0", 24, "ipv4"); // documentation (TEST-NET-3)
BLOCKED_IP_RANGES.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
BLOCKED_IP_RANGES.addSubnet("240.0.0.0", 4, "ipv4"); // reserved, incl. limited broadcast
// IPv6
BLOCKED_IP_RANGES.addSubnet("::", 96, "ipv6"); // unspecified, loopback, deprecated IPv4-compatible
BLOCKED_IP_RANGES.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 well-known prefix (maps to IPv4)
BLOCKED_IP_RANGES.addSubnet("64:ff9b:1::", 48, "ipv6"); // local-use NAT64 (maps to IPv4)
BLOCKED_IP_RANGES.addSubnet("100::", 64, "ipv6"); // discard-only
BLOCKED_IP_RANGES.addSubnet("100:0:0:1::", 64, "ipv6"); // dummy prefix
BLOCKED_IP_RANGES.addSubnet("2001::", 23, "ipv6"); // IETF protocol assignments, incl. Teredo (maps to IPv4)
BLOCKED_IP_RANGES.addSubnet("2001:db8::", 32, "ipv6"); // documentation
BLOCKED_IP_RANGES.addSubnet("2002::", 16, "ipv6"); // 6to4 (maps to IPv4)
BLOCKED_IP_RANGES.addSubnet("2620:4f:8000::", 48, "ipv6"); // direct delegation AS112
BLOCKED_IP_RANGES.addSubnet("3fff::", 20, "ipv6"); // documentation
BLOCKED_IP_RANGES.addSubnet("5f00::", 16, "ipv6"); // SRv6 SIDs
BLOCKED_IP_RANGES.addSubnet("fc00::", 7, "ipv6"); // unique-local (covers fc00::/8 and fd00::/8)
BLOCKED_IP_RANGES.addSubnet("fe80::", 10, "ipv6"); // link-local
BLOCKED_IP_RANGES.addSubnet("fec0::", 10, "ipv6"); // deprecated site-local
BLOCKED_IP_RANGES.addSubnet("ff00::", 8, "ipv6"); // multicast

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal", // GCP metadata
  "metadata.goog", // GCP alternate
  "169.254.169.254", // AWS/Azure metadata
]);

/** Strip the surrounding brackets from an IPv6 URL host literal ("[::1]" -> "::1"). */
function unwrapHostLiteral(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Check if a host that is an IP literal matches any blocked private/reserved range. */
function isBlockedIp(host: string): boolean {
  const ip = unwrapHostLiteral(host);
  const family = net.isIP(ip);
  if (family === 0) {
    return false; // not an IP literal; hostname handling applies instead
  }
  return BLOCKED_IP_RANGES.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Validates that a webhook URL does not target internal/private networks. */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookUrlValidationError(`Invalid webhook URL: ${redactUrlForAudit(url)}`);
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebhookUrlValidationError(`Webhook URL must use http or https: ${redactUrlForAudit(url)}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new WebhookUrlValidationError(`Webhook URL targets a blocked host: ${hostname}`);
  }

  // Block private IP ranges
  if (isBlockedIp(hostname)) {
    throw new WebhookUrlValidationError(`Webhook URL targets a private/reserved IP range: ${hostname}`);
  }
}

/**
 * DNS-rebinding-safe validation: resolve hostname and check all resolved IPs
 * against blocked ranges. Call this at delivery time, not just registration.
 */
export async function validateWebhookUrlWithDns(url: string): Promise<void> {
  // First run the synchronous checks
  validateWebhookUrl(url);

  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  // If hostname is already an IP literal, synchronous check is sufficient
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[")) {
    return;
  }

  // Resolve DNS (both A and AAAA records) and validate all returned IPs
  let addresses: string[];
  try {
    const [v4Result, v6Result] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);
    addresses = [
      ...(v4Result.status === "fulfilled" ? v4Result.value : []),
      ...(v6Result.status === "fulfilled" ? v6Result.value : []),
    ];
    if (addresses.length === 0) {
      throw new Error("No DNS records found");
    }
  } catch {
    // DNS resolution failed: fail closed to prevent SSRF via DNS rebinding
    throw new WebhookUrlValidationError(`DNS resolution failed for webhook host: ${hostname}`);
  }

  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      throw new WebhookUrlValidationError(
        `Webhook URL hostname ${hostname} resolves to blocked IP ${ip}`,
      );
    }
  }
}

/**
 * Resolve a webhook host once and validate every address it resolves to.
 * The caller connects only to the returned addresses.
 */
async function resolveWebhookHost(hostname: string): Promise<LookupAddress[]> {
  const literal = unwrapHostLiteral(hostname);
  const family = net.isIP(literal);
  if (family !== 0) {
    return [{ address: literal, family }]; // IP literal, already checked by validateWebhookUrl
  }

  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) {
    throw new WebhookUrlValidationError(`DNS resolution failed for webhook host: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new WebhookUrlValidationError(
        `Webhook URL hostname ${hostname} resolves to blocked IP ${address}`,
      );
    }
  }
  return addresses;
}

/**
 * POST a webhook payload and return the HTTP status. The host is resolved once,
 * every address is validated, and the socket connects only to those addresses
 * (the client never resolves the name again), so a DNS answer that changes
 * after validation cannot redirect the request. Redirects are not followed.
 */
export async function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<number> {
  validateWebhookUrl(url);
  const target = new URL(url);
  const signal = AbortSignal.timeout(DELIVERY_TIMEOUT_MS);

  const addresses = await Promise.race([
    resolveWebhookHost(target.hostname.toLowerCase()),
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);

  const pinnedLookup: net.LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  };
  const send = target.protocol === "https:" ? https.request : http.request;

  return new Promise<number>((resolve, reject) => {
    const req = send(
      target,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: pinnedLookup,
        signal,
      },
      (res) => {
        // Only the status is used; drain the body. A timeout that fires while
        // the body is still arriving must not surface as an unhandled error.
        res.on("error", () => {});
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
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

  // The emission runs in the background, so a webhook can be registered after
  // the event and before this selection. Only the webhooks that existed at the
  // event's created_at get a delivery.
  const webhooks = await getWebhooksForEvent(pool, type, tenantId, eventRow.id);

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

  // Fire-and-forget delivery; do not await
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

  // Any failure, including URL validation and secret decryption, is reported
  // as a failed attempt so it gets backoff and eventually reaches the DLQ.
  try {
    const rawSecret = decryptSecret(webhook.secret_hash);
    const timestamp = new Date().toISOString();
    const signature = signWebhookPayload(rawSecret, timestamp, payload);

    // SSRF protection: resolves, validates and pins the address it connects to.
    const status = await postWebhook(
      webhook.url,
      {
        "Content-Type": "application/json",
        "X-Stratum-Event": event.type,
        "X-Stratum-Signature": signature,
        "X-Stratum-Delivery-ID": deliveryId,
        "X-Stratum-Timestamp": timestamp,
      },
      payload,
    );

    if (status >= 200 && status < 300) {
      return { success: true, responseCode: status, error: null };
    }

    return {
      success: false,
      responseCode: status,
      error: `HTTP ${status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, responseCode: null, error: message };
  }
}

/** In-flight delivery run per pool, so concurrent triggers share one worker loop. */
const activeRuns = new WeakMap<pg.Pool, Promise<void>>();
const rerunRequested = new WeakSet<pg.Pool>();

/**
 * Deliver every due pending delivery. At most one run is active per pool in
 * this process; a trigger that arrives during a run joins it and makes it
 * check for due deliveries once more before finishing.
 */
export function processDeliveries(pool: pg.Pool): Promise<void> {
  const active = activeRuns.get(pool);
  if (active) {
    rerunRequested.add(pool);
    return active;
  }
  const run = (async () => {
    try {
      do {
        rerunRequested.delete(pool);
        while ((await deliverDueBatch(pool)) > 0) {
          // keep going until nothing is due
        }
      } while (rerunRequested.has(pool));
    } finally {
      activeRuns.delete(pool);
    }
  })();
  activeRuns.set(pool, run);
  return run;
}

interface ClaimedDelivery {
  delivery: WebhookDeliveryRow;
  webhook: WebhookRow | undefined;
  event: WebhookEventRow | undefined;
}

/**
 * Claim, deliver and record one batch. No database connection or transaction
 * is held while a delivery is on the network: the claim and each result are
 * separate short transactions. Returns the number of deliveries claimed.
 */
async function deliverDueBatch(pool: pg.Pool): Promise<number> {
  const claimed = await claimDueDeliveries(pool);
  await Promise.all(
    claimed.map((c) =>
      deliverClaimed(pool, c).catch(() => {
        // Non-fatal: the lease expires and the delivery is picked up again.
      }),
    ),
  );
  return claimed.length;
}

/**
 * Lease a batch of due deliveries: count the attempt and move next_retry_at
 * past the lease so no other worker takes them. Deliveries are taken in turns
 * across tenants (oldest first within a tenant), so one tenant's backlog does
 * not crowd out everyone else's.
 */
async function claimDueDeliveries(pool: pg.Pool): Promise<ClaimedDelivery[]> {
  return withTransaction(pool, async (client) => {
    const res = await client.query<WebhookDeliveryRow>(
      `WITH due AS (
         SELECT d.id, d.created_at,
                row_number() OVER (PARTITION BY e.tenant_id ORDER BY d.created_at) AS turn
         FROM webhook_deliveries d
         JOIN webhook_events e ON e.id = d.event_id
         WHERE d.status = 'pending'
           AND (d.next_retry_at IS NULL OR d.next_retry_at <= now())
       ), picked AS (
         SELECT id FROM due ORDER BY turn, created_at LIMIT $2
       )
       UPDATE webhook_deliveries d
       SET attempts = d.attempts + 1,
           next_retry_at = now() + ($1 || ' milliseconds')::interval
       WHERE d.id IN (
         SELECT id FROM webhook_deliveries
         WHERE id IN (SELECT id FROM picked)
           AND status = 'pending'
           AND (next_retry_at IS NULL OR next_retry_at <= now())
         FOR UPDATE SKIP LOCKED
       )
       RETURNING d.*`,
      [DELIVERY_LEASE_MS, DELIVERY_BATCH_SIZE],
    );
    if (res.rows.length === 0) {
      return [];
    }

    const webhookRes = await client.query<WebhookRow>(
      `SELECT * FROM webhooks WHERE id = ANY($1)`,
      [res.rows.map((d) => d.webhook_id)],
    );
    const eventRes = await client.query<WebhookEventRow>(
      `SELECT * FROM webhook_events WHERE id = ANY($1)`,
      [res.rows.map((d) => d.event_id)],
    );
    const webhooks = new Map(webhookRes.rows.map((w) => [w.id, w]));
    const events = new Map(eventRes.rows.map((e) => [e.id, e]));

    return res.rows.map((delivery) => ({
      delivery,
      webhook: webhooks.get(delivery.webhook_id),
      event: events.get(delivery.event_id),
    }));
  });
}

async function deliverClaimed(pool: pg.Pool, claimed: ClaimedDelivery): Promise<void> {
  const { delivery, webhook, event } = claimed;

  if (!webhook || !event) {
    // Webhook or event was deleted; mark failed
    await withClient(pool, (client) =>
      client.query(
        `UPDATE webhook_deliveries
         SET status = 'failed', last_error = 'Webhook or event not found', completed_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [delivery.id],
      ),
    );
    return;
  }

  // The attempt was already counted when the delivery was claimed.
  const attempts = delivery.attempts;
  const result = await deliverWebhook(webhook, event, delivery.id);

  await withClient(pool, async (client) => {
    if (result.success) {
      await client.query(
        `UPDATE webhook_deliveries
         SET status = 'success', response_code = $1,
             last_error = NULL, completed_at = now()
         WHERE id = $2 AND status = 'pending'`,
        [result.responseCode, delivery.id],
      );
    } else if (attempts >= MAX_ATTEMPTS) {
      await client.query(
        `UPDATE webhook_deliveries
         SET status = 'failed', response_code = $1,
             last_error = $2, completed_at = now()
         WHERE id = $3 AND status = 'pending'`,
        [result.responseCode, result.error, delivery.id],
      );
    } else {
      const nextRetryMs = retryDelayMs(attempts);
      await client.query(
        `UPDATE webhook_deliveries
         SET response_code = $1, last_error = $2,
             next_retry_at = now() + ($3 || ' milliseconds')::interval
         WHERE id = $4 AND status = 'pending'`,
        [result.responseCode, result.error, nextRetryMs, delivery.id],
      );
    }
  });
}

export async function retryFailedDeliveries(pool: pg.Pool, tenantId?: string): Promise<number> {
  const result = await withClient(pool, async (client) => {
    let query: string;
    const params: unknown[] = [];
    if (tenantId) {
      query = `WITH updated AS (
        UPDATE webhook_deliveries
        SET status = 'pending', next_retry_at = NULL, attempts = 0
        WHERE status = 'failed' AND webhook_id IN (SELECT id FROM webhooks WHERE tenant_id = $1)
        RETURNING id
      ) SELECT COUNT(*) as count FROM updated`;
      params.push(tenantId);
    } else {
      query = `WITH updated AS (
        UPDATE webhook_deliveries
        SET status = 'pending', next_retry_at = NULL, attempts = 0
        WHERE status = 'failed'
        RETURNING id
      ) SELECT COUNT(*) as count FROM updated`;
    }
    const res = await client.query<{ count: string }>(query, params);
    return parseInt(res.rows[0].count, 10);
  });

  if (result > 0) {
    processDeliveries(pool).catch(() => {});
  }
  return result;
}

export async function retryDelivery(pool: pg.Pool, deliveryId: string): Promise<boolean> {
  const updated = await withClient(pool, async (client) => {
    const res = await client.query<{ id: string }>(
      `UPDATE webhook_deliveries
       SET status = 'pending', next_retry_at = NULL, attempts = 0
       WHERE id = $1 AND status = 'failed'
       RETURNING id`,
      [deliveryId],
    );
    return res.rows.length > 0;
  });

  if (updated) {
    processDeliveries(pool).catch(() => {});
  }
  return updated;
}

export interface DeliveryStats {
  total: number;
  pending: number;
  success: number;
  failed: number;
}

export async function getDeliveryStats(pool: pg.Pool, tenantId?: string): Promise<DeliveryStats> {
  return withClient(pool, async (client) => {
    let query: string;
    const params: unknown[] = [];
    if (tenantId) {
      query = `SELECT wd.status, COUNT(*) as count FROM webhook_deliveries wd
               JOIN webhooks w ON w.id = wd.webhook_id
               WHERE w.tenant_id = $1 GROUP BY wd.status`;
      params.push(tenantId);
    } else {
      query = `SELECT status, COUNT(*) as count FROM webhook_deliveries GROUP BY status`;
    }
    const res = await client.query<{ status: string; count: string }>(query, params);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of res.rows) {
      counts[row.status] = parseInt(row.count, 10);
      total += counts[row.status];
    }
    return {
      total,
      pending: counts["pending"] ?? 0,
      success: counts["success"] ?? 0,
      failed: counts["failed"] ?? 0,
    };
  });
}

export async function listFailedDeliveries(
  pool: pg.Pool,
  limit = 100,
  tenantId?: string,
): Promise<Record<string, unknown>[]> {
  return withClient(pool, async (client) => {
    let query: string;
    const params: unknown[] = [];
    if (tenantId) {
      query = `SELECT wd.*, we.type as event_type, we.tenant_id as event_tenant_id, w.url as webhook_url
               FROM webhook_deliveries wd
               JOIN webhook_events we ON we.id = wd.event_id
               JOIN webhooks w ON w.id = wd.webhook_id
               WHERE wd.status = 'failed' AND w.tenant_id = $1
               ORDER BY wd.completed_at DESC
               LIMIT $2`;
      params.push(tenantId, limit);
    } else {
      query = `SELECT wd.*, we.type as event_type, we.tenant_id as event_tenant_id, w.url as webhook_url
               FROM webhook_deliveries wd
               JOIN webhook_events we ON we.id = wd.event_id
               JOIN webhooks w ON w.id = wd.webhook_id
               WHERE wd.status = 'failed'
               ORDER BY wd.completed_at DESC
               LIMIT $1`;
      params.push(limit);
    }
    const res = await client.query<Record<string, unknown>>(query, params);
    return res.rows;
  });
}
