import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * A config key that an ancestor marked sensitive stays sensitive in every
 * override below it: the override is stored encrypted and resolves masked for
 * the overriding tenant's descendants, whatever flag the write passes. A
 * tenant's own sensitive flag survives a write that omits it.
 */
describe("config overrides keep the sensitive flag of the key (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  async function tree() {
    const root = await stratum.createTenant({ name: "Root", slug: uniqueSlug("sor") });
    const child = await stratum.createTenant({ name: "Child", slug: uniqueSlug("soc"), parent_id: root.id });
    const grandchild = await stratum.createTenant({
      name: "Grandchild",
      slug: uniqueSlug("sog"),
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

  it("stores a setConfig override of an ancestor's sensitive key encrypted and masks it for descendants", async () => {
    const { root, child, grandchild } = await tree();
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });

    await stratum.setConfig(child.id, "api_secret", { value: "child-value" });

    const row = await storedRow(child.id, "api_secret");
    expect(row.sensitive).toBe(true);
    expect(row.value).not.toEqual("child-value");
    expect(JSON.stringify(row.value)).not.toContain("child-value");

    expect((await stratum.resolveConfig(child.id)).api_secret).toMatchObject({
      value: "child-value",
      sensitive: true,
    });
    expect((await stratum.resolveConfig(grandchild.id)).api_secret).toMatchObject({
      value: null,
      masked: true,
      source_tenant_id: child.id,
    });
  });

  it("keeps the flag when the override passes sensitive: false", async () => {
    const { root, child, grandchild } = await tree();
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });

    await stratum.setConfig(child.id, "api_secret", { value: "child-value", sensitive: false });

    const row = await storedRow(child.id, "api_secret");
    expect(row.sensitive).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain("child-value");
    expect((await stratum.resolveConfig(grandchild.id)).api_secret).toMatchObject({ value: null, masked: true });
  });

  it("stores a batchSetConfig override of an ancestor's sensitive key encrypted", async () => {
    const { root, child, grandchild } = await tree();
    await stratum.setConfig(root.id, "api_secret", { value: "root-value", sensitive: true });

    const result = await stratum.batchSetConfig(child.id, [
      { key: "api_secret", value: "child-batch-value", sensitive: false },
      { key: "plain", value: "visible" },
    ]);
    expect(result.succeeded).toBe(2);

    const secret = await storedRow(child.id, "api_secret");
    expect(secret.sensitive).toBe(true);
    expect(JSON.stringify(secret.value)).not.toContain("child-batch-value");
    expect(await storedRow(child.id, "plain")).toEqual({ value: "visible", sensitive: false });

    const resolved = await stratum.resolveConfig(grandchild.id);
    expect(resolved.api_secret).toMatchObject({ value: null, masked: true });
    expect(resolved.plain).toMatchObject({ value: "visible" });
  });

  it("keeps a tenant's own sensitive flag when a write omits it, and clears it on explicit false", async () => {
    const { child } = await tree();
    await stratum.setConfig(child.id, "own_secret", { value: "first", sensitive: true });

    await stratum.setConfig(child.id, "own_secret", { value: "second" });
    const kept = await storedRow(child.id, "own_secret");
    expect(kept.sensitive).toBe(true);
    expect(JSON.stringify(kept.value)).not.toContain("second");

    await stratum.setConfig(child.id, "own_secret", { value: "third", sensitive: false });
    expect(await storedRow(child.id, "own_secret")).toEqual({ value: "third", sensitive: false });
  });
});
