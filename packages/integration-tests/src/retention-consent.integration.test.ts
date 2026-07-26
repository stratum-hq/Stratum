import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum, withClient } from "@stratum-hq/lib";
import { PermissionMode, RevocationMode } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Data-retention cutoff and consent lifecycle against real Postgres: time-based
 * DELETEs over real created_at values, the consent ON CONFLICT upsert with its
 * expires_at > now() predicate, and the Article 20 export assembling rows from
 * many tables. gdpr-purge.integration.test.ts covers the purge itself; this
 * file covers the parts it does not.
 */
describe("retention + consent (integration)", () => {
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

  /** Insert a root tenant directly (no event emission) for retention fixtures. */
  async function rawTenant(slug: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO tenants (name, slug, ancestry_path, depth) VALUES ($1, $2, '/', 0) RETURNING id`,
      [slug, slug],
    );
    return r.rows[0].id;
  }

  it("purgeExpiredData deletes rows older than the cutoff and keeps recent ones", async () => {
    const tid = await rawTenant(uniqueSlug("ret"));

    await withClient(getPool(), async (c) => {
      // audit logs: one old, one recent
      await c.query(
        `INSERT INTO audit_logs (actor_id, actor_type, action, resource_type, tenant_id, created_at)
         VALUES ('a','system','x','y',$1, now() - interval '100 days'),
                ('a','system','x','y',$1, now())`,
        [tid],
      );
      // webhook + events (old/recent) + deliveries (old/recent)
      const wh = await c.query<{ id: string }>(
        `INSERT INTO webhooks (tenant_id, url, secret_hash) VALUES ($1,'https://example.com/h','h') RETURNING id`,
        [tid],
      );
      const evOld = await c.query<{ id: string }>(
        `INSERT INTO webhook_events (type, tenant_id, created_at) VALUES ('e',$1, now() - interval '100 days') RETURNING id`,
        [tid],
      );
      const evNew = await c.query<{ id: string }>(
        `INSERT INTO webhook_events (type, tenant_id, created_at) VALUES ('e',$1, now()) RETURNING id`,
        [tid],
      );
      await c.query(
        `INSERT INTO webhook_deliveries (webhook_id, event_id, created_at) VALUES ($1,$2, now() - interval '100 days')`,
        [wh.rows[0].id, evOld.rows[0].id],
      );
      await c.query(
        `INSERT INTO webhook_deliveries (webhook_id, event_id, created_at) VALUES ($1,$2, now())`,
        [wh.rows[0].id, evNew.rows[0].id],
      );
    });

    const result = await stratum.purgeExpiredData(30);
    // One old delivery + one old event + one old audit row.
    expect(result.deleted_count).toBe(3);

    const counts = await getPool().query<{ tbl: string; n: string }>(
      `SELECT 'audit' AS tbl, COUNT(*)::text AS n FROM audit_logs WHERE tenant_id = $1
       UNION ALL SELECT 'events', COUNT(*)::text FROM webhook_events WHERE tenant_id = $1
       UNION ALL SELECT 'deliveries', COUNT(*)::text FROM webhook_deliveries
                 WHERE webhook_id IN (SELECT id FROM webhooks WHERE tenant_id = $1)`,
      [tid],
    );
    const byTbl = Object.fromEntries(counts.rows.map((r) => [r.tbl, r.n]));
    expect(byTbl).toEqual({ audit: "1", events: "1", deliveries: "1" });
  });

  it("grants, upserts, and revokes consent; getActiveConsent reflects each state", async () => {
    const t = await stratum.createTenant({
      name: "T",
      slug: uniqueSlug("con"),
    });

    await stratum.grantConsent(t.id, {
      subject_id: "subj-1",
      purpose: "marketing",
    });
    expect(
      await stratum.getActiveConsent(t.id, "subj-1", "marketing"),
    ).not.toBeNull();

    // Re-granting the same (subject, purpose) upserts — one row, not two.
    await stratum.grantConsent(t.id, {
      subject_id: "subj-1",
      purpose: "marketing",
    });
    expect(await stratum.listConsent(t.id, "subj-1")).toHaveLength(1);

    // Revoke flips it inactive.
    expect(await stratum.revokeConsent(t.id, "subj-1", "marketing")).toBe(true);
    expect(
      await stratum.getActiveConsent(t.id, "subj-1", "marketing"),
    ).toBeNull();
    const listed = await stratum.listConsent(t.id, "subj-1");
    expect(listed[0].granted).toBe(false);
    expect(listed[0].revoked_at).not.toBeNull();
  });

  it("treats an expired consent as inactive via the expires_at > now() predicate", async () => {
    const t = await stratum.createTenant({
      name: "T",
      slug: uniqueSlug("cexp"),
    });

    const past = new Date(Date.now() - 86_400_000).toISOString();
    await stratum.grantConsent(t.id, {
      subject_id: "s",
      purpose: "analytics",
      expires_at: past,
    });
    expect(await stratum.getActiveConsent(t.id, "s", "analytics")).toBeNull();

    const future = new Date(Date.now() + 86_400_000).toISOString();
    await stratum.grantConsent(t.id, {
      subject_id: "s",
      purpose: "analytics",
      expires_at: future,
    });
    expect(
      await stratum.getActiveConsent(t.id, "s", "analytics"),
    ).not.toBeNull();
  });

  it("exports config, permissions, and consent for portability (Article 20)", async () => {
    const t = await stratum.createTenant({
      name: "T",
      slug: uniqueSlug("exp"),
    });
    await stratum.setConfig(t.id, "k", {
      value: "v",
      locked: false,
      sensitive: false,
    });
    await stratum.createPermission(t.id, {
      key: "p",
      value: true,
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });
    await stratum.grantConsent(t.id, {
      subject_id: "s",
      purpose: "data_processing",
    });

    const data = await stratum.exportTenantData(t.id);
    expect((data.config_entries as unknown[]).length).toBe(1);
    expect((data.permission_policies as unknown[]).length).toBe(1);
    expect((data.consent_records as unknown[]).length).toBe(1);
  });
});
