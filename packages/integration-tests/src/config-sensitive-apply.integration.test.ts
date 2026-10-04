import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Storing a key as sensitive on a tenant applies the flag to the overrides of
 * that key below it, and applySensitiveConfigFlags() applies it to overrides
 * stored earlier. Both go through real Postgres.
 */
describe("sensitive flag applied to descendant overrides (integration)", () => {
  let stratum: Stratum;
  const KEY = "test-encryption-key-32chars-long!";

  beforeAll(async () => {
    process.env.STRATUM_ENCRYPTION_KEY = KEY;
    await runMigrations();
    stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
  });

  afterEach(async () => {
    process.env.STRATUM_ENCRYPTION_KEY = KEY;
    await cleanTestData();
  });

  afterAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await closePool();
  });

  async function tree() {
    const root = await stratum.createTenant({ name: "Root", slug: uniqueSlug("sar") });
    const child = await stratum.createTenant({ name: "Child", slug: uniqueSlug("sac"), parent_id: root.id });
    const grandchild = await stratum.createTenant({
      name: "Grandchild",
      slug: uniqueSlug("sag"),
      parent_id: child.id,
    });
    return { root, child, grandchild };
  }

  async function storedRow(tenantId: string, key: string) {
    const res = await getPool().query<{ value: unknown; sensitive: boolean }>(
      "SELECT value, sensitive FROM config_entries WHERE tenant_id = $1 AND key = $2",
      [tenantId, key],
    );
    return res.rows[0];
  }

  it("setConfig with sensitive: true on an ancestor encrypts the existing overrides below it", async () => {
    const { root, child, grandchild } = await tree();
    await stratum.setConfig(child.id, "api_secret", { value: "child-value" });

    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });

    const row = await storedRow(child.id, "api_secret");
    expect(row.sensitive).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain("child-value");
    expect((await stratum.resolveConfig(child.id)).api_secret).toMatchObject({ value: "child-value" });
    expect((await stratum.resolveConfig(grandchild.id)).api_secret).toMatchObject({ value: null, masked: true });
  });

  it("batchSetConfig with sensitive: true on an ancestor encrypts the existing overrides below it", async () => {
    const { root, grandchild } = await tree();
    await stratum.setConfig(grandchild.id, "api_secret", { value: "gc-value" });

    await stratum.batchSetConfig(root.id, [{ key: "api_secret", value: "root-value", sensitive: true }]);

    const row = await storedRow(grandchild.id, "api_secret");
    expect(row.sensitive).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain("gc-value");
  });

  it("an archived ancestor's sensitive flag still makes a write sensitive", async () => {
    const { child, grandchild } = await tree();
    await stratum.setConfig(child.id, "api_secret", { value: "child-value", sensitive: true });
    // The library does not archive a tenant with active children, so this state is set in SQL.
    await getPool().query("UPDATE tenants SET status = 'archived' WHERE id = $1", [child.id]);

    await stratum.setConfig(grandchild.id, "api_secret", { value: "gc-value", sensitive: false });

    expect((await storedRow(grandchild.id, "api_secret")).sensitive).toBe(true);
  });

  it("applySensitiveConfigFlags stores existing overrides sensitive and encrypted, and a second run changes nothing", async () => {
    const { root, child, grandchild } = await tree();
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });
    await getPool().query(
      `INSERT INTO config_entries (tenant_id, key, value, locked, sensitive, source_tenant_id, inherited)
       VALUES ($1, 'api_secret', $2, false, false, $1, false)`,
      [child.id, JSON.stringify("child-value")],
    );

    expect(await stratum.applySensitiveConfigFlags()).toBe(1);

    const row = await storedRow(child.id, "api_secret");
    expect(row.sensitive).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain("child-value");
    expect((await stratum.resolveConfig(child.id)).api_secret).toMatchObject({ value: "child-value" });
    expect((await stratum.resolveConfig(grandchild.id)).api_secret).toMatchObject({ value: null, masked: true });

    expect(await stratum.applySensitiveConfigFlags()).toBe(0);
  });

  it("rotateEncryptionKey re-encrypts an override that was stored sensitive", async () => {
    const { root, child } = await tree();
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });
    await stratum.setConfig(child.id, "api_secret", { value: "child-value" });
    const before = (await storedRow(child.id, "api_secret")).value;

    const newKey = "rotated-key-material-for-tests-789";
    const result = await stratum.rotateEncryptionKey(KEY, newKey);
    expect(result.config_entries_rotated).toBe(2);

    process.env.STRATUM_ENCRYPTION_KEY = newKey;
    expect((await storedRow(child.id, "api_secret")).value).not.toEqual(before);
    expect((await stratum.resolveConfig(child.id)).api_secret).toMatchObject({ value: "child-value" });
  });
});
