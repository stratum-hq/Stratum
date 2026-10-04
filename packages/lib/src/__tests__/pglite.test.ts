import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createPglitePool, createRestrictedPool, type PglitePool } from "@stratum-hq/db-adapters/pglite";
import { withTenantContext } from "@stratum-hq/db-adapters";
import { ConfigLockedError, PermissionLockedError, PermissionMode } from "@stratum-hq/core";
import { Stratum } from "../stratum.js";
import { bootstrapRolesSql } from "../role-model.js";
import type { StratumLogger } from "../logger.js";

// This suite runs the library against a real PostgreSQL engine in process
// (PGlite), unlike the other lib unit tests, which stub the database.
// Concurrency, pooling and server roles are out of scope here; the
// integration-tests package covers them against a PostgreSQL server.

describe("Stratum on PGlite", () => {
  let pool: PglitePool;
  let stratum: Stratum;

  beforeAll(async () => {
    pool = await createPglitePool();
    stratum = new Stratum({ pool, autoMigrate: true });
    await stratum.initialize();
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it("applies every lib migration", async () => {
    const files = fs
      .readdirSync(path.resolve(__dirname, "../migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM _migrations ORDER BY name");
    expect(rows.map((r) => r.name)).toEqual(files);
  });

  it("builds a tenant hierarchy with depth, ancestors and descendants", async () => {
    const root = await stratum.createTenant({ name: "Root MSSP", slug: "h_root" });
    const msp = await stratum.createTenant({ name: "MSP", slug: "h_msp", parent_id: root.id });
    const client = await stratum.createTenant({ name: "Client", slug: "h_client", parent_id: msp.id });

    expect(client.depth).toBe(2);
    const ancestors = await stratum.getAncestors(client.id);
    expect(ancestors.map((t) => t.id)).toEqual([root.id, msp.id]);
    const descendants = await stratum.getDescendants(root.id);
    expect(descendants.map((t) => t.id).sort()).toEqual([msp.id, client.id].sort());
  });

  it("creates a global API key, with tenant_id null, when tenantId is null", async () => {
    const created = await stratum.createApiKey(null, { name: "global-service" });
    expect(created.tenant_id).toBeNull();

    const validated = await stratum.validateApiKey(created.plaintext_key);
    expect(validated).toMatchObject({ key_id: created.id, tenant_id: null });
  });

  it("inherits config down the tree and rejects an override of a locked key", async () => {
    const root = await stratum.createTenant({ name: "Config root", slug: "c_root" });
    const leaf = await stratum.createTenant({ name: "Config leaf", slug: "c_leaf", parent_id: root.id });
    await stratum.setConfig(root.id, "data_region", { value: "us-east-1", locked: true });
    await stratum.setConfig(root.id, "retention_days", { value: 365 });
    await stratum.setConfig(leaf.id, "retention_days", { value: 90 });

    await expect(stratum.setConfig(leaf.id, "data_region", { value: "eu-west-1" })).rejects.toBeInstanceOf(
      ConfigLockedError,
    );
    const resolved = await stratum.resolveConfig(leaf.id);
    expect(resolved.data_region).toMatchObject({ value: "us-east-1", inherited: true, locked: true });
    expect(resolved.retention_days).toMatchObject({ value: 90, inherited: false });
  });

  it("stores an override of a key an ancestor marked sensitive as sensitive and encrypted", async () => {
    const root = await stratum.createTenant({ name: "Sensitive root", slug: "s_root" });
    const child = await stratum.createTenant({ name: "Sensitive child", slug: "s_child", parent_id: root.id });
    const grandchild = await stratum.createTenant({
      name: "Sensitive grandchild",
      slug: "s_grandchild",
      parent_id: child.id,
    });
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });
    await stratum.setConfig(root.id, "batch_secret", { value: "root-batch-value", sensitive: true });

    const audit = { actor_id: "pglite-test", actor_type: "system" as const };
    await stratum.setConfig(child.id, "api_secret", { value: "child-value" }, audit);
    await stratum.batchSetConfig(child.id, [{ key: "batch_secret", value: "child-batch-value", sensitive: false }]);

    const stored = await pool.query<{ key: string; value: unknown; sensitive: boolean }>(
      "SELECT key, value, sensitive FROM config_entries WHERE tenant_id = $1 ORDER BY key",
      [child.id],
    );
    expect(stored.rows.map((r) => [r.key, r.sensitive])).toEqual([
      ["api_secret", true],
      ["batch_secret", true],
    ]);
    for (const row of stored.rows) {
      expect(JSON.stringify(row.value)).not.toContain("child");
    }

    const forChild = await stratum.resolveConfig(child.id);
    expect(forChild.api_secret).toMatchObject({ value: "child-value", sensitive: true, inherited: false });
    expect(forChild.batch_secret).toMatchObject({ value: "child-batch-value", sensitive: true });

    const forGrandchild = await stratum.resolveConfig(grandchild.id);
    expect(forGrandchild.api_secret).toMatchObject({ value: null, masked: true, source_tenant_id: child.id });
    expect(forGrandchild.batch_secret).toMatchObject({ value: null, masked: true, source_tenant_id: child.id });

    // An explicit sensitive: false from the child does not clear the flag.
    await stratum.setConfig(child.id, "api_secret", { value: "child-value-2", sensitive: false });
    expect((await stratum.resolveConfig(grandchild.id)).api_secret).toMatchObject({ value: null, masked: true });

    const auditRows = await pool.query<{ after_state: Record<string, unknown> }>(
      "SELECT after_state FROM audit_logs WHERE tenant_id = $1 AND action = 'config.updated' AND resource_id = 'api_secret'",
      [child.id],
    );
    expect(auditRows.rows.map((r) => r.after_state.value)).toEqual(["[REDACTED]"]);
  });

  it("keeps a tenant's own sensitive flag when a write omits it, and clears it on explicit false", async () => {
    const t = await stratum.createTenant({ name: "Own sensitive", slug: "s_own" });
    await stratum.setConfig(t.id, "own_secret", { value: "first", sensitive: true });

    await stratum.setConfig(t.id, "own_secret", { value: "second" });
    let row = await pool.query<{ value: unknown; sensitive: boolean }>(
      "SELECT value, sensitive FROM config_entries WHERE tenant_id = $1 AND key = 'own_secret'",
      [t.id],
    );
    expect(row.rows[0].sensitive).toBe(true);
    expect(row.rows[0].value).not.toBe("second");

    await stratum.setConfig(t.id, "own_secret", { value: "third", sensitive: false });
    row = await pool.query("SELECT value, sensitive FROM config_entries WHERE tenant_id = $1 AND key = 'own_secret'", [
      t.id,
    ]);
    expect(row.rows[0]).toEqual({ value: "third", sensitive: false });
  });

  it("redacts the audit entry when a write that passes sensitive: false is stored sensitive", async () => {
    const root = await stratum.createTenant({ name: "Audit root", slug: "sa_root" });
    const child = await stratum.createTenant({ name: "Audit child", slug: "sa_child", parent_id: root.id });
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });

    const audit = { actor_id: "pglite-test", actor_type: "system" as const };
    await stratum.setConfig(child.id, "api_secret", { value: "child-value", sensitive: false }, audit);

    const auditRows = await pool.query<{ after_state: Record<string, unknown> }>(
      "SELECT after_state FROM audit_logs WHERE tenant_id = $1 AND action = 'config.updated'",
      [child.id],
    );
    expect(auditRows.rows.map((r) => r.after_state)).toEqual([
      { value: "[REDACTED]", sensitive: true },
    ]);
  });

  it("stores a write sensitive when an archived ancestor marks the key sensitive", async () => {
    const root = await stratum.createTenant({ name: "Archived root", slug: "sx_root" });
    const mid = await stratum.createTenant({ name: "Archived mid", slug: "sx_mid", parent_id: root.id });
    const leaf = await stratum.createTenant({ name: "Archived leaf", slug: "sx_leaf", parent_id: mid.id });
    await stratum.setConfig(mid.id, "api_secret", { value: "mid-value", sensitive: true });
    // The library does not archive a tenant with active children, so this state is set in SQL.
    await pool.query("UPDATE tenants SET status = 'archived' WHERE id = $1", [mid.id]);

    await stratum.setConfig(leaf.id, "api_secret", { value: "leaf-value", sensitive: false });

    const row = await pool.query<{ value: unknown; sensitive: boolean }>(
      "SELECT value, sensitive FROM config_entries WHERE tenant_id = $1 AND key = 'api_secret'",
      [leaf.id],
    );
    expect(row.rows[0].sensitive).toBe(true);
    expect(JSON.stringify(row.rows[0].value)).not.toContain("leaf-value");
  });

  it("applies the sensitive flag to existing descendant overrides when an ancestor stores the key as sensitive", async () => {
    const root = await stratum.createTenant({ name: "Apply root", slug: "sp_root" });
    const child = await stratum.createTenant({ name: "Apply child", slug: "sp_child", parent_id: root.id });
    const grandchild = await stratum.createTenant({ name: "Apply grandchild", slug: "sp_gc", parent_id: child.id });
    const other = await stratum.createTenant({ name: "Apply other", slug: "sp_other" });
    await stratum.setConfig(child.id, "api_secret", { value: "child-value" });
    await stratum.setConfig(grandchild.id, "batch_secret", { value: "gc-value" });
    await stratum.setConfig(other.id, "api_secret", { value: "other-value" });

    const audit = { actor_id: "pglite-test", actor_type: "system" as const };
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true }, audit);
    await stratum.batchSetConfig(root.id, [{ key: "batch_secret", value: "root-batch", sensitive: true }], audit);

    const rows = await pool.query<{ tenant_id: string; key: string; value: unknown; sensitive: boolean }>(
      "SELECT tenant_id, key, value, sensitive FROM config_entries WHERE tenant_id = ANY($1)",
      [[child.id, grandchild.id, other.id]],
    );
    const byTenant = Object.fromEntries(rows.rows.map((r) => [r.tenant_id, r]));
    expect(byTenant[child.id].sensitive).toBe(true);
    expect(JSON.stringify(byTenant[child.id].value)).not.toContain("child-value");
    expect(byTenant[grandchild.id].sensitive).toBe(true);
    expect(JSON.stringify(byTenant[grandchild.id].value)).not.toContain("gc-value");
    expect(byTenant[other.id]).toMatchObject({ value: "other-value", sensitive: false });

    expect((await stratum.resolveConfig(child.id)).api_secret).toMatchObject({ value: "child-value", sensitive: true });
    expect((await stratum.resolveConfig(grandchild.id)).api_secret).toMatchObject({ value: null, masked: true });

    const auditRows = await pool.query<{ after_state: unknown; resource_id: string }>(
      "SELECT after_state, resource_id FROM audit_logs WHERE tenant_id = $1 AND action = 'config.sensitive_applied'",
      [root.id],
    );
    expect(auditRows.rows.length).toBe(2);
    expect(auditRows.rows.map((r) => r.resource_id)).toEqual([root.id, root.id]);
    const auditText = JSON.stringify(auditRows.rows);
    expect(auditText).toContain(child.id);
    expect(auditText).not.toContain("child-value");
    expect(auditText).not.toContain("gc-value");
  });

  it("applySensitiveConfigFlags stores existing overrides of ancestor-sensitive keys as sensitive, once", async () => {
    const root = await stratum.createTenant({ name: "Helper root", slug: "sh_root" });
    const child = await stratum.createTenant({ name: "Helper child", slug: "sh_child", parent_id: root.id });
    const grandchild = await stratum.createTenant({ name: "Helper grandchild", slug: "sh_gc", parent_id: child.id });
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });
    // An override stored before the flag was applied to overrides.
    await pool.query(
      `INSERT INTO config_entries (tenant_id, key, value, locked, sensitive, source_tenant_id, inherited)
       VALUES ($1, 'api_secret', $2, false, false, $1, false), ($3, 'api_secret', $4, false, false, $3, false)`,
      [child.id, JSON.stringify("child-value"), grandchild.id, JSON.stringify("gc-value")],
    );

    expect(await stratum.applySensitiveConfigFlags()).toBe(2);

    const rows = await pool.query<{ value: unknown; sensitive: boolean }>(
      "SELECT value, sensitive FROM config_entries WHERE tenant_id = ANY($1) AND key = 'api_secret'",
      [[child.id, grandchild.id]],
    );
    for (const row of rows.rows) {
      expect(row.sensitive).toBe(true);
      expect(JSON.stringify(row.value)).not.toMatch(/child-value|gc-value/);
    }
    expect((await stratum.resolveConfig(child.id)).api_secret).toMatchObject({ value: "child-value" });
    expect((await stratum.resolveConfig(grandchild.id)).api_secret).toMatchObject({ value: "gc-value" });

    expect(await stratum.applySensitiveConfigFlags()).toBe(0);
  });

  it("applySensitiveConfigFlags pages through more than one batch", async () => {
    const root = await stratum.createTenant({ name: "Paging root", slug: "sg_root" });
    const child = await stratum.createTenant({ name: "Paging child", slug: "sg_child", parent_id: root.id });
    const keys = Array.from({ length: 105 }, (_, i) => `paged_${String(i).padStart(3, "0")}`);
    await stratum.batchSetConfig(
      root.id,
      keys.map((key) => ({ key, value: `root-${key}`, sensitive: true })),
    );
    // Overrides stored before the flag was applied to overrides.
    await pool.query(
      `INSERT INTO config_entries (tenant_id, key, value, locked, sensitive, source_tenant_id, inherited)
       SELECT $1, k, to_jsonb('child-' || k), false, false, $1, false FROM unnest($2::text[]) AS k`,
      [child.id, keys],
    );

    expect(await stratum.applySensitiveConfigFlags()).toBe(105);

    const rows = await pool.query<{ key: string; value: unknown; sensitive: boolean }>(
      "SELECT key, value, sensitive FROM config_entries WHERE tenant_id = $1",
      [child.id],
    );
    expect(rows.rows).toHaveLength(105);
    for (const row of rows.rows) {
      expect(row.sensitive).toBe(true);
      expect(JSON.stringify(row.value)).not.toContain(`child-${row.key}`);
    }
    const resolved = await stratum.resolveConfig(child.id);
    for (const key of keys) {
      expect(resolved[key]).toMatchObject({ value: `child-${key}`, sensitive: true });
    }
    expect(await stratum.applySensitiveConfigFlags()).toBe(0);
  });

  it("rejects a batch that names the same key twice and writes nothing", async () => {
    const t = await stratum.createTenant({ name: "Dup batch", slug: "sd_dup" });
    const result = await stratum.batchSetConfig(t.id, [
      { key: "api_secret", value: "a", sensitive: true },
      { key: "api_secret", value: "b" },
    ]);
    expect(result.rolled_back).toBe(true);
    expect(result.results[1].error).toContain("'api_secret'");
    const rows = await pool.query("SELECT 1 FROM config_entries WHERE tenant_id = $1", [t.id]);
    expect(rows.rows).toHaveLength(0);
  });

  it("resolves inherited permissions and rejects an override of a locked permission", async () => {
    const root = await stratum.createTenant({ name: "Perm root", slug: "p_root" });
    const leaf = await stratum.createTenant({ name: "Perm leaf", slug: "p_leaf", parent_id: root.id });
    await stratum.createPermission(root.id, { key: "edr.isolate_host", value: true, mode: PermissionMode.LOCKED });
    await stratum.createPermission(root.id, { key: "tickets.manage", value: true, mode: PermissionMode.INHERITED });

    const resolved = await stratum.resolvePermissions(leaf.id);
    expect(resolved["edr.isolate_host"]).toMatchObject({ mode: "LOCKED", value: true });
    expect(resolved["tickets.manage"]).toMatchObject({ mode: "INHERITED", value: true });
    await expect(
      stratum.createPermission(leaf.id, { key: "edr.isolate_host", value: false }),
    ).rejects.toBeInstanceOf(PermissionLockedError);
  });

  describe("row-level security as a role that is not a superuser", () => {
    let restricted: PglitePool;
    let tenantA: string;
    let tenantB: string;

    beforeAll(async () => {
      tenantA = (await stratum.createTenant({ name: "RLS A", slug: "rls_a" })).id;
      tenantB = (await stratum.createTenant({ name: "RLS B", slug: "rls_b" })).id;
      await stratum.setConfig(tenantA, "a_only", { value: 1 });
      await stratum.setConfig(tenantB, "b_only", { value: 2 });
      restricted = await createRestrictedPool(pool);
    });

    it("returns 0 rows of another tenant's config", async () => {
      const res = await withTenantContext(restricted, tenantA, (c) =>
        c.query("SELECT key FROM config_entries WHERE tenant_id = $1", [tenantB]),
      );
      expect(res.rows).toHaveLength(0);
    });

    it("returns the config of the tenant in context", async () => {
      const res = await withTenantContext(restricted, tenantA, (c) => c.query("SELECT key FROM config_entries"));
      expect(res.rows.map((r) => r.key)).toEqual(["a_only"]);
    });

    it("rejects an insert of config for another tenant", async () => {
      await expect(
        withTenantContext(restricted, tenantA, (c) =>
          c.query(
            "INSERT INTO config_entries (tenant_id, source_tenant_id, key, value) VALUES ($1, $1, 'cross', '1'::jsonb)",
            [tenantB],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("Stratum on PGlite with adminPool and a restricted application pool", () => {
  let adminPool: PglitePool;
  let appPool: PglitePool;
  const warnings: string[] = [];
  const logger: StratumLogger = { info() {}, error() {}, warn: (msg) => warnings.push(msg) };

  beforeAll(async () => {
    adminPool = await createPglitePool();
    appPool = await createRestrictedPool(adminPool);
    await new Stratum({ adminPool, pool: appPool, autoMigrate: true, logger }).initialize();
  }, 60_000);

  afterAll(async () => {
    await adminPool.end();
  });

  it("warns at initialize() while the application role can write the Stratum tables", () => {
    expect(warnings.join("\n")).toMatch(/app role "stratum_app" can write Stratum tables/);
  });

  it("passes the strict check once the bootstrap SQL limits the application role and the legacy switch is off", async () => {
    await adminPool.query(bootstrapRolesSql({ appRole: "stratum_app" }));
    await adminPool.query("UPDATE stratum_security SET legacy_guc_bypass = false");
    const strict: string[] = [];
    await new Stratum({
      adminPool,
      pool: appPool,
      enforceRls: true,
      logger: { info() {}, error() {}, warn: (msg) => strict.push(msg) },
    }).initialize();
    expect(strict).toEqual([]);
  });

  it("runs the library on adminPool while the application role sees only its tenant", async () => {
    const stratum = new Stratum({ adminPool, pool: appPool, logger });
    const root = await stratum.createTenant({ name: "Two pools root", slug: "tp_root" });
    const a = await stratum.createTenant({ name: "Two pools A", slug: "tp_a", parent_id: root.id });
    const b = await stratum.createTenant({ name: "Two pools B", slug: "tp_b", parent_id: root.id });
    await stratum.setConfig(a.id, "only_a", { value: 1 });
    await stratum.setConfig(b.id, "only_b", { value: 2 });
    await stratum.moveTenant(b.id, a.id);
    expect((await stratum.getAncestors(b.id)).map((t) => t.id)).toEqual([root.id, a.id]);

    const seen = await withTenantContext(appPool, a.id, async (c) => {
      await c.query("SET LOCAL app.bypass_rls = 'on'");
      return c.query("SELECT key FROM config_entries ORDER BY key");
    });
    expect(seen.rows.map((r) => r.key)).toEqual(["only_a"]);
    await expect(withTenantContext(appPool, a.id, (c) => c.query("SELECT id FROM api_keys"))).rejects.toMatchObject({
      code: "42501",
    });
  });
});

