import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";

describe("GDPR Purge (integration)", () => {
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

  it("purges a tenant and all its data", async () => {
    const tenant = await stratum.createTenant({
      name: "Purge Me",
      slug: "purge_me",
    });
    await stratum.setConfig(tenant.id, "some_key", { value: "some_value" });

    await stratum.purgeTenant(tenant.id);

    await expect(stratum.getTenant(tenant.id)).rejects.toThrow();
  });

  it("rejects purging tenant with children", async () => {
    const root = await stratum.createTenant({
      name: "Parent",
      slug: "purge_parent",
    });
    await stratum.createTenant({
      name: "Child",
      slug: "purge_child",
      parent_id: root.id,
    });

    await expect(stratum.purgeTenant(root.id)).rejects.toThrow(/child/i);
  });

  it("exports tenant data for portability (Article 20)", async () => {
    const tenant = await stratum.createTenant({
      name: "Export Me",
      slug: "export_me",
    });
    await stratum.setConfig(tenant.id, "key1", { value: "val1" });

    const data = await stratum.exportTenantData(tenant.id);
    expect(data.tenant).toBeDefined();
    expect(data.config_entries).toHaveLength(1);
  });

  it("purge cleans up all related tables", async () => {
    const tenant = await stratum.createTenant({
      name: "Full Purge",
      slug: "full_purge",
    });

    // Create data across multiple tables
    await stratum.setConfig(tenant.id, "cfg1", { value: "v1" });
    await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/hook",
      secret: "secret",
      events: ["tenant.created"],
    });

    await stratum.purgeTenant(tenant.id);

    // Verify nothing remains
    const pool = getPool();
    const configs = await pool.query(
      "SELECT 1 FROM config_entries WHERE tenant_id = $1",
      [tenant.id],
    );
    const webhooks = await pool.query(
      "SELECT 1 FROM webhooks WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(configs.rows.length).toBe(0);
    expect(webhooks.rows.length).toBe(0);
  });
});
