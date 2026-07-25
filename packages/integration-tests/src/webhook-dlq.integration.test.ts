import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Webhook persistence and dead-letter behaviors against real Postgres: the
 * secret encrypted at rest, the delivery-fanout selection predicate (TEXT[]
 * membership + global null-tenant hooks + active filter), the GROUP BY status
 * stats, the failed-delivery join, and the retry state transition. Delivery
 * rows are seeded directly so the assertions never depend on the fire-and-forget
 * HTTP delivery loop; the one retry test points at a blocked host so its
 * background pass makes no committed change.
 */
describe("webhook persistence + DLQ (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    process.env.STRATUM_ENCRYPTION_KEY = "test-encryption-key-32chars-long!";
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await closePool();
  });

  async function rawTenant(slug: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO tenants (name, slug, ancestry_path, depth) VALUES ($1,$2,'/',0) RETURNING id`,
      [slug, slug],
    );
    return r.rows[0].id;
  }
  async function rawWebhook(tenantId: string | null, events: string[], active = true, url = "https://example.com/h"): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhooks (tenant_id, url, secret_hash, events, active) VALUES ($1,$2,'h',$3,$4) RETURNING id`,
      [tenantId, url, events, active],
    );
    return r.rows[0].id;
  }
  async function rawEvent(tenantId: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhook_events (type, tenant_id) VALUES ('tenant.created',$1) RETURNING id`,
      [tenantId],
    );
    return r.rows[0].id;
  }
  async function rawDelivery(webhookId: string, eventId: string, status: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhook_deliveries (webhook_id, event_id, status, completed_at)
       VALUES ($1,$2,$3, CASE WHEN $3 = 'pending' THEN NULL ELSE now() END) RETURNING id`,
      [webhookId, eventId, status],
    );
    return r.rows[0].id;
  }

  it("stores the webhook secret encrypted at rest and never exposes it on read", async () => {
    const tid = await rawTenant(uniqueSlug("whs"));
    const webhook = await stratum.createWebhook({
      tenant_id: tid,
      url: "https://example.com/hook",
      secret: "raw-shared-secret",
      events: ["tenant.created"],
    });
    // The returned object carries no secret.
    expect(webhook).not.toHaveProperty("secret_hash");

    const raw = await getPool().query<{ secret_hash: string }>(
      `SELECT secret_hash FROM webhooks WHERE id = $1`,
      [webhook.id],
    );
    expect(raw.rows[0].secret_hash).not.toContain("raw-shared-secret");
    expect(raw.rows[0].secret_hash).toContain("v1:");
  });

  it("fanout selects active webhooks by event membership, including global null-tenant hooks", async () => {
    const tid = await rawTenant(uniqueSlug("whf"));
    const other = await rawTenant(uniqueSlug("who"));

    const forTenant = await rawWebhook(tid, ["tenant.created"]);
    const global = await rawWebhook(null, ["tenant.created"]);
    await rawWebhook(tid, ["tenant.created"], /* active */ false); // inactive: excluded
    await rawWebhook(tid, ["config.updated"]); // wrong event: excluded
    await rawWebhook(other, ["tenant.created"]); // other tenant: excluded

    // The exact predicate event-service uses to fan out a delivery.
    const selected = await getPool().query<{ id: string }>(
      `SELECT id FROM webhooks
       WHERE active = true AND $1 = ANY(events) AND (tenant_id IS NULL OR tenant_id = $2)`,
      ["tenant.created", tid],
    );
    expect(selected.rows.map((r) => r.id).sort()).toEqual([forTenant, global].sort());
  });

  it("getDeliveryStats groups by status, tenant-scoped and global", async () => {
    const t1 = await rawTenant(uniqueSlug("ws1"));
    const t2 = await rawTenant(uniqueSlug("ws2"));
    const w1 = await rawWebhook(t1, ["tenant.created"]);
    const w2 = await rawWebhook(t2, ["tenant.created"]);
    const e1 = await rawEvent(t1);
    const e2 = await rawEvent(t2);

    await rawDelivery(w1, e1, "pending");
    await rawDelivery(w1, e1, "pending");
    await rawDelivery(w1, e1, "success");
    await rawDelivery(w1, e1, "failed");
    await rawDelivery(w2, e2, "failed");

    const t1Stats = await stratum.getDeliveryStats(t1);
    expect(t1Stats).toEqual({ total: 4, pending: 2, success: 1, failed: 1 });

    const global = await stratum.getDeliveryStats();
    expect(global.total).toBe(5);
    expect(global.failed).toBe(2);
  });

  it("listFailedDeliveries joins event type + webhook url and scopes by tenant", async () => {
    const t1 = await rawTenant(uniqueSlug("wf1"));
    const t2 = await rawTenant(uniqueSlug("wf2"));
    const w1 = await rawWebhook(t1, ["tenant.created"], true, "https://example.com/t1");
    const w2 = await rawWebhook(t2, ["tenant.created"]);
    const e1 = await rawEvent(t1);
    const e2 = await rawEvent(t2);
    await rawDelivery(w1, e1, "failed");
    await rawDelivery(w1, e1, "success"); // not failed: excluded
    await rawDelivery(w2, e2, "failed"); // other tenant: excluded

    const failed = await stratum.listFailedDeliveries(100, t1);
    expect(failed).toHaveLength(1);
    expect(failed[0].event_type).toBe("tenant.created");
    expect(failed[0].webhook_url).toBe("https://example.com/t1");
  });

  it("retryDelivery resets a failed delivery to pending and only acts on failed rows", async () => {
    const t1 = await rawTenant(uniqueSlug("wr1"));
    // Blocked host so the fire-and-forget processDeliveries pass fails URL
    // validation and commits nothing — the row stays exactly as retry left it.
    const w1 = await rawWebhook(t1, ["tenant.created"], true, "http://127.0.0.1:9/x");
    const e1 = await rawEvent(t1);
    const failed = await rawDelivery(w1, e1, "failed");
    const pending = await rawDelivery(w1, e1, "pending");

    expect(await stratum.retryDelivery(failed)).toBe(true);
    const after = await getPool().query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM webhook_deliveries WHERE id = $1`,
      [failed],
    );
    expect(after.rows[0].status).toBe("pending");
    expect(after.rows[0].attempts).toBe(0);

    // Already pending → nothing to retry.
    expect(await stratum.retryDelivery(pending)).toBe(false);
    // Already reset (now pending) → nothing to retry a second time.
    expect(await stratum.retryDelivery(failed)).toBe(false);
  });

  it("retryFailedDeliveries requeues every failed delivery for a tenant and returns the count", async () => {
    const t1 = await rawTenant(uniqueSlug("wq1"));
    const w1 = await rawWebhook(t1, ["tenant.created"], true, "http://127.0.0.1:9/x");
    const e1 = await rawEvent(t1);
    await rawDelivery(w1, e1, "failed");
    await rawDelivery(w1, e1, "failed");
    await rawDelivery(w1, e1, "success");

    expect(await stratum.retryFailedDeliveries(t1)).toBe(2);
    const stats = await stratum.getDeliveryStats(t1);
    expect(stats.failed).toBe(0);
    expect(stats.pending).toBe(2);
    expect(stats.success).toBe(1);
  });
});
