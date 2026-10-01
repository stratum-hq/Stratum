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

