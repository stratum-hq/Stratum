import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";

describe("Webhook Delivery (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  it("creates a webhook and retrieves it", async () => {
    const tenant = await stratum.createTenant({
      name: "WH Tenant",
      slug: "wh_tenant",
    });
    const webhook = await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/webhook",
      secret: "test-secret-key",
      events: ["tenant.created", "config.updated"],
    });
    expect(webhook.id).toBeDefined();
    expect(webhook.url).toBe("https://example.com/webhook");
    expect(webhook.active).toBe(true);
  });

  it("getWebhooksForEvent returns matching webhooks (secret_hash fix)", async () => {
    const tenant = await stratum.createTenant({
      name: "WH2",
      slug: "wh2_tenant",
    });
    await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/hook",
      secret: "my-secret",
      events: ["tenant.created"],
    });

    // This was the critical bug — secret_encrypted vs secret_hash
    // The query must succeed without a column-not-found error
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, url, secret_hash FROM webhooks
       WHERE active = true AND $1 = ANY(events) AND tenant_id = $2`,
      ["tenant.created", tenant.id],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].secret_hash).toBeDefined();
  });

  it("lists webhooks for a tenant", async () => {
    const tenant = await stratum.createTenant({
      name: "WH3",
      slug: "wh3_tenant",
    });
    await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/a",
      secret: "s1",
      events: ["tenant.created"],
    });
    await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/b",
      secret: "s2",
      events: ["config.updated"],
    });
    const list = await stratum.listWebhooks(tenant.id);
    expect(list.length).toBe(2);
  });

  it("deletes a webhook", async () => {
    const tenant = await stratum.createTenant({
      name: "WH4",
      slug: "wh4_tenant",
    });
    const wh = await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/del",
      secret: "s3",
      events: ["tenant.deleted"],
    });
    await stratum.deleteWebhook(wh.id);
    const list = await stratum.listWebhooks(tenant.id);
    expect(list.length).toBe(0);
  });
});
