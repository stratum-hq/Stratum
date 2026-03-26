import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";

describe("Config Inheritance (integration)", () => {
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

  it("child inherits config from parent", async () => {
    const root = await stratum.createTenant({
      name: "Root",
      slug: "cfg_root",
    });
    const child = await stratum.createTenant({
      name: "Child",
      slug: "cfg_child",
      parent_id: root.id,
    });

    await stratum.setConfig(root.id, "max_users", { value: 100 });
    const resolved = await stratum.resolveConfig(child.id);

    expect(resolved.max_users).toBeDefined();
    expect(resolved.max_users.value).toBe(100);
    expect(resolved.max_users.inherited).toBe(true);
    expect(resolved.max_users.source_tenant_id).toBe(root.id);
  });

  it("child can override parent config", async () => {
    const root = await stratum.createTenant({
      name: "Root",
      slug: "ovr_root",
    });
    const child = await stratum.createTenant({
      name: "Child",
      slug: "ovr_child",
      parent_id: root.id,
    });

    await stratum.setConfig(root.id, "max_users", { value: 100 });
    await stratum.setConfig(child.id, "max_users", { value: 50 });

    const resolved = await stratum.resolveConfig(child.id);
    expect(resolved.max_users.value).toBe(50);
    expect(resolved.max_users.inherited).toBe(false);
  });

  it("locked config cannot be overridden by child", async () => {
    const root = await stratum.createTenant({
      name: "Root",
      slug: "lock_root",
    });
    const child = await stratum.createTenant({
      name: "Child",
      slug: "lock_child",
      parent_id: root.id,
    });

    await stratum.setConfig(root.id, "max_users", {
      value: 100,
      locked: true,
    });

    await expect(
      stratum.setConfig(child.id, "max_users", { value: 50 }),
    ).rejects.toThrow();
  });

  it("handles falsy config values correctly", async () => {
    const root = await stratum.createTenant({
      name: "Root",
      slug: "falsy_root",
    });

    await stratum.setConfig(root.id, "feature_enabled", { value: false });
    await stratum.setConfig(root.id, "limit", { value: 0 });

    const resolved = await stratum.resolveConfig(root.id);
    expect(resolved.feature_enabled.value).toBe(false);
    expect(resolved.limit.value).toBe(0);
  });
});
