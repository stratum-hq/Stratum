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
  getAdminPool,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Webhook audit payloads against real Postgres: a rotated webhook secret never
 * lands in audit_logs in plaintext, and migration 026 scrubs rows written
 * before that.
 */
describe("webhook audit secret redaction (integration)", () => {
  let stratum: Stratum;
  const actor: AuditContext = { actor_id: "wh-actor", actor_type: "api_key" };

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
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

  it("does not store a rotated webhook secret in plaintext in audit_logs", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("whar") });
    const original = "original-webhook-secret-5d1e";
    const rotated = "rotated-webhook-secret-a93b";
    const webhook = await stratum.createWebhook(
      { tenant_id: t.id, url: "https://hooks.example.test/in", secret: original, events: ["tenant.created"] },
      actor,
    );

    await stratum.updateWebhook(webhook.id, { secret: rotated, description: "rotated" }, actor);

    const rows = await getPool().query<{ action: string; before_state: unknown; after_state: unknown; metadata: unknown }>(
      `SELECT action, before_state, after_state, metadata FROM audit_logs
       WHERE resource_type = 'webhook' AND resource_id = $1`,
      [webhook.id],
    );
    expect(rows.rows.map((r) => r.action).sort()).toEqual(["webhook.created", "webhook.updated"]);
    const serialized = JSON.stringify(rows.rows);
    expect(serialized).not.toContain(original);
    expect(serialized).not.toContain(rotated);

    // The rest of the change is still recorded.
    const updated = rows.rows.find((r) => r.action === "webhook.updated");
    expect(updated?.after_state).toEqual({ secret: "[REDACTED]", description: "rotated" });
  });

  it("migration 026 redacts webhook secrets already stored in audit_logs", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("whmig") });
    const marker = "legacy-webhook-secret-marker-44f0";
    await getPool().query(
      `INSERT INTO audit_logs (actor_id, actor_type, action, resource_type, resource_id, tenant_id, before_state, after_state)
       VALUES ('a', 'system', 'webhook.updated', 'webhook', 'w1', $1, NULL, $2),
              ('a', 'system', 'webhook.created', 'webhook', 'w2', $1, NULL, $3),
              ('a', 'system', 'webhook.updated', 'webhook', 'w3', $1, NULL, $4),
              ('a', 'system', 'config.updated', 'config', 'w4', $1, NULL, $5)`,
      [
        t.id,
        JSON.stringify({ secret: marker, active: false }),
        JSON.stringify({ url: "https://hooks.example.test/in", secret: marker }),
        JSON.stringify({ description: "no secret here" }),
        JSON.stringify({ value: "unrelated", secret: "not-a-webhook-row" }),
      ],
    );

    const here = path.dirname(fileURLToPath(import.meta.url));
    const sql = fs.readFileSync(
      path.resolve(here, "../../lib/src/migrations/026_redact_webhook_secret_audit.sql"),
      "utf-8",
    );
    await getPool().query(sql);

    const rows = await getPool().query<{ resource_id: string; after_state: Record<string, unknown> }>(
      `SELECT resource_id, after_state FROM audit_logs WHERE tenant_id = $1 ORDER BY resource_id`,
      [t.id],
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.resource_id, r.after_state]));
    expect(byId.w1).toEqual({ secret: "[REDACTED]", active: false });
    expect(byId.w2).toEqual({ url: "https://hooks.example.test/in", secret: "[REDACTED]" });
    expect(byId.w3).toEqual({ description: "no secret here" });
    expect(byId.w4).toEqual({ value: "unrelated", secret: "not-a-webhook-row" });
  });
});
