import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { Stratum } from "@stratum-hq/lib";
import type { AuditContext } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Webhook URLs and region control-plane URLs in audit payloads, against real
 * Postgres: audit rows keep scheme, host and path, and drop credentials, query
 * string and fragment. Migration 030 scrubs rows written before that.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../lib/src/migrations");

/** Applies migration 030 (every file numbered 030) directly, like a deploy would. */
async function applyMigration030(): Promise<void> {
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.startsWith("030_")).sort()) {
    await getPool().query(fs.readFileSync(path.join(migrationsDir, file), "utf-8"));
  }
}

const SECRETS = [
  "hook-user-3c7d",
  "hook-pass-81c2",
  "hook-query-secret-5e9a",
  "hook-frag-secret-11b0",
  "cp-user-6a2e",
  "cp-pass-7f1a",
  "cp-query-secret-0d93",
];

describe("URL credential redaction in audit_logs (integration)", () => {
  let stratum: Stratum;
  const actor: AuditContext = { actor_id: "url-actor", actor_type: "api_key" };

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  beforeEach(() => {
    // Webhook URL validation resolves the host; keep it off the network.
    vi.spyOn(dns, "resolve4").mockResolvedValue(["93.184.216.34"]);
    vi.spyOn(dns, "resolve6").mockRejectedValue(new Error("ENODATA"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  async function auditRows(resourceType: string, resourceId: string) {
    const res = await getPool().query<{ action: string; before_state: unknown; after_state: Record<string, unknown> }>(
      `SELECT action, before_state, after_state FROM audit_logs
       WHERE resource_type = $1 AND resource_id = $2 ORDER BY created_at`,
      [resourceType, resourceId],
    );
    return res.rows;
  }

  it("records webhook URLs in audit_logs without credentials, query string or fragment", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("urlwh") });
    const webhook = await stratum.createWebhook(
      {
        tenant_id: t.id,
        url: "https://hook-user-3c7d:hook-pass-81c2@hooks.example.test/in/abc?token=hook-query-secret-5e9a#hook-frag-secret-11b0",
        secret: "webhook-signing-secret-000",
        events: ["tenant.created"],
      },
      actor,
    );
    await stratum.updateWebhook(
      webhook.id,
      { url: "https://hooks.example.test/in/def?token=hook-query-secret-5e9a" },
      actor,
    );

    const rows = await auditRows("webhook", webhook.id);
    expect(rows.map((r) => r.action)).toEqual(["webhook.created", "webhook.updated"]);
    const serialized = JSON.stringify(rows);
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
    expect(rows[0].after_state.url).toBe("https://hooks.example.test/in/abc");
    expect(rows[0].after_state.events).toEqual(["tenant.created"]);
    expect(rows[1].after_state.url).toBe("https://hooks.example.test/in/def");
  });

  it("records region control_plane_url in audit_logs without credentials", async () => {
    const region = await stratum.createRegion(
      {
        display_name: "EU",
        slug: uniqueSlug("urlrg"),
        control_plane_url: "https://cp-user-6a2e:cp-pass-7f1a@cp.example.test:8443/api?key=cp-query-secret-0d93",
      },
      actor,
    );
    await stratum.updateRegion(
      region.id,
      { control_plane_url: "https://cp-user-6a2e:cp-pass-7f1a@cp2.example.test/api" },
      actor,
    );

    const rows = await auditRows("region", region.id);
    expect(rows.map((r) => r.action)).toEqual(["region.created", "region.updated"]);
    const serialized = JSON.stringify(rows);
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
    expect(rows[0].after_state.control_plane_url).toBe("https://cp.example.test:8443/api");
    expect(rows[1].after_state.control_plane_url).toBe("https://cp2.example.test/api");
  });

  it("migration 030 scrubs credentials from webhook and region URLs already stored in audit_logs, and is idempotent", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("urlmig") });
    const insert = (
      action: string,
      resourceType: string,
      resourceId: string,
      tenantId: string | null,
      before: unknown,
      after: unknown,
    ) =>
      getPool().query(
        `INSERT INTO audit_logs (actor_id, actor_type, action, resource_type, resource_id, tenant_id, before_state, after_state)
         VALUES ('a', 'system', $1, $2, $3, $4, $5, $6)`,
        [action, resourceType, resourceId, tenantId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)],
      );

    const hookUrl =
      "https://hook-user-3c7d:hook-pass-81c2@hooks.example.test/in/abc?token=hook-query-secret-5e9a#hook-frag-secret-11b0";
    await insert("webhook.created", "webhook", "mig-w1", t.id, null, { url: hookUrl, events: ["tenant.created"] });
    await insert("webhook.updated", "webhook", "mig-w2", t.id, { url: hookUrl }, { url: "https://hooks.example.test/x?token=hook-query-secret-5e9a", active: false });
    await insert("webhook.updated", "webhook", "mig-w3", t.id, null, { description: "no url here" });
    await insert("webhook.created", "webhook", "mig-w4", t.id, null, { url: "https://hooks.example.test/clean", events: [] });
    await insert("config.updated", "config", "mig-w5", t.id, null, { url: "https://u:p@not-a-webhook.test/?q=1" });
    await insert("region.created", "region", "mig-r1", null, null, {
      slug: "eu",
      control_plane_url: "https://cp-user-6a2e:cp-pass-7f1a@cp.example.test:8443/api?key=cp-query-secret-0d93",
    });
    await insert("region.updated", "region", "mig-r2", null, null, { control_plane_url: null });
    await insert("region.updated", "region", "mig-r3", null, null, { display_name: "renamed" });

    await applyMigration030();
    const read = async () => {
      const res = await getPool().query<{ resource_id: string; before_state: unknown; after_state: unknown }>(
        `SELECT resource_id, before_state, after_state FROM audit_logs
         WHERE resource_id LIKE 'mig-%' ORDER BY resource_id`,
      );
      return Object.fromEntries(res.rows.map((r) => [r.resource_id, { before: r.before_state, after: r.after_state }]));
    };
    const byId = await read();

    const serialized = JSON.stringify(Object.entries(byId).filter(([id]) => id !== "mig-w5"));
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);

    expect(byId["mig-w1"].after).toEqual({ url: "https://hooks.example.test/in/abc", events: ["tenant.created"] });
    expect(byId["mig-w2"].before).toEqual({ url: "https://hooks.example.test/in/abc" });
    expect(byId["mig-w2"].after).toEqual({ url: "https://hooks.example.test/x", active: false });
    expect(byId["mig-w3"].after).toEqual({ description: "no url here" });
    expect(byId["mig-w4"].after).toEqual({ url: "https://hooks.example.test/clean", events: [] });
    expect(byId["mig-w5"].after).toEqual({ url: "https://u:p@not-a-webhook.test/?q=1" });
    expect(byId["mig-r1"].after).toEqual({ slug: "eu", control_plane_url: "https://cp.example.test:8443/api" });
    expect(byId["mig-r2"].after).toEqual({ control_plane_url: null });
    expect(byId["mig-r3"].after).toEqual({ display_name: "renamed" });

    await applyMigration030();
    expect(await read()).toEqual(byId);
  });
});
