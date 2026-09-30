import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
 * Config audit payloads and archived-ancestor lock handling against real
 * Postgres:
 *   - a sensitive config write never lands in audit_logs in plaintext;
 *   - setConfig, batchSetConfig, resolveConfig and getConfigWithInheritance
 *     agree that a lock held by an archived ancestor no longer applies.
 */
describe("config audit redaction + archived-ancestor locks (integration)", () => {
  let stratum: Stratum;
  const actor: AuditContext = { actor_id: "cfg-actor", actor_type: "api_key" };

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

  it("does not store a sensitive config value in plaintext in audit_logs", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("cfar") });
    const secret = "plaintext-marker-value-7f3a";

    await stratum.setConfig(t.id, "billing.api_key", { value: secret, sensitive: true }, actor);

    const rows = await getPool().query<{ before_state: unknown; after_state: unknown; metadata: unknown }>(
      `SELECT before_state, after_state, metadata FROM audit_logs
       WHERE tenant_id = $1 AND action = 'config.updated'`,
      [t.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows[0])).not.toContain(secret);
    expect(rows.rows[0].after_state).toMatchObject({ sensitive: true });

    // The value itself is still stored and resolvable.
    expect((await stratum.resolveConfig(t.id))["billing.api_key"].value).toBe(secret);
  });

  it("still records a non-sensitive config value in the audit after_state", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("cfan") });

    await stratum.setConfig(t.id, "max_users", { value: 42 }, actor);

    const rows = await getPool().query<{ after_state: Record<string, unknown> }>(
      `SELECT after_state FROM audit_logs WHERE tenant_id = $1 AND action = 'config.updated'`,
      [t.id],
    );
    expect(rows.rows[0].after_state).toMatchObject({ value: 42 });
  });

  it("migration 025 redacts sensitive config values already stored in audit_logs", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("cfmig") });
    const marker = "legacy-plaintext-marker-91c2";
    await getPool().query(
      `INSERT INTO audit_logs (actor_id, actor_type, action, resource_type, resource_id, tenant_id, after_state)
       VALUES ('a', 'system', 'config.updated', 'config', 'k1', $1, $2),
              ('a', 'system', 'config.updated', 'config', 'k2', $1, $3)`,
      [
        t.id,
        JSON.stringify({ value: marker, sensitive: true, locked: false }),
        JSON.stringify({ value: "plain-ok", sensitive: false }),
      ],
    );

    const here = path.dirname(fileURLToPath(import.meta.url));
    const sql = fs.readFileSync(
      path.resolve(here, "../../lib/src/migrations/025_redact_sensitive_config_audit.sql"),
      "utf-8",
    );
    await getPool().query(sql);

    const rows = await getPool().query<{ resource_id: string; after_state: Record<string, unknown> }>(
      `SELECT resource_id, after_state FROM audit_logs WHERE tenant_id = $1 ORDER BY resource_id`,
      [t.id],
    );
    const byKey = Object.fromEntries(rows.rows.map((r) => [r.resource_id, r.after_state]));
    expect(byKey.k1).toEqual({ value: "[REDACTED]", sensitive: true, locked: false });
    expect(byKey.k2).toEqual({ value: "plain-ok", sensitive: false });
  });

  async function treeWithArchivedLocker() {
    const root = await stratum.createTenant({ name: "R", slug: uniqueSlug("cfr") });
    const mid = await stratum.createTenant({ name: "M", slug: uniqueSlug("cfm"), parent_id: root.id });
    const leaf = await stratum.createTenant({ name: "L", slug: uniqueSlug("cfl"), parent_id: mid.id });
    await stratum.setConfig(mid.id, "k", { value: "from-archived", locked: true });
    // The library keeps an active tenant under an active parent and refuses
    // config writes to a tenant that is not active, so an active leaf under an
    // archived parent can only be reached in SQL. The lock handling below is
    // defense in depth for such data.
    await getPool().query(`UPDATE tenants SET status = 'archived' WHERE id = $1`, [mid.id]);
    return { root, mid, leaf };
  }

  it("batchSetConfig ignores a lock held by an archived ancestor, like setConfig does", async () => {
    const { leaf } = await treeWithArchivedLocker();

    const res = await stratum.batchSetConfig(leaf.id, [{ key: "k", value: "own" }]);

    expect(res.failed).toBe(0);
    expect(res.results[0]).toMatchObject({ key: "k", status: "ok" });
    expect((await stratum.resolveConfig(leaf.id)).k.value).toBe("own");
  });

  it("getConfigWithInheritance ignores entries from an archived ancestor, like resolveConfig does", async () => {
    const { leaf } = await treeWithArchivedLocker();
    await stratum.setConfig(leaf.id, "k", { value: "own" });

    const inherited = await stratum.getConfigWithInheritance(leaf.id);
    const resolved = await stratum.resolveConfig(leaf.id);

    expect(inherited.k).toMatchObject({ value: "own", locked: false, inherited: false });
    expect(inherited.k.value).toEqual(resolved.k.value);
  });

  it("still enforces a lock held by an active ancestor in batchSetConfig", async () => {
    const root = await stratum.createTenant({ name: "R", slug: uniqueSlug("cfra") });
    const leaf = await stratum.createTenant({ name: "L", slug: uniqueSlug("cfla"), parent_id: root.id });
    await stratum.setConfig(root.id, "k", { value: "root", locked: true });

    const res = await stratum.batchSetConfig(leaf.id, [{ key: "k", value: "own" }]);
    expect(res.failed).toBe(1);

    const inherited = await stratum.getConfigWithInheritance(leaf.id);
    expect(inherited.k).toMatchObject({ value: "root", locked: true });
  });
});
