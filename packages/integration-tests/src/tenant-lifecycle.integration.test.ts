import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";

describe("Tenant Lifecycle (integration)", () => {
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

  it("creates a root tenant with correct ancestry", async () => {
    const tenant = await stratum.createTenant({
      name: "Acme Corp",
      slug: "acme",
    });
    expect(tenant.id).toBeDefined();
    expect(tenant.name).toBe("Acme Corp");
    expect(tenant.slug).toBe("acme");
    expect(tenant.depth).toBe(0);
    expect(tenant.ancestry_path).toContain(tenant.id);
  });

  it("creates a child tenant with parent ancestry", async () => {
    const root = await stratum.createTenant({ name: "Root", slug: "root" });
    const child = await stratum.createTenant({
      name: "Child",
      slug: "child",
      parent_id: root.id,
    });
    expect(child.depth).toBe(1);
    expect(child.ancestry_path).toContain(root.id);
    expect(child.parent_id).toBe(root.id);
  });

  it("creates a 3-level hierarchy", async () => {
    const root = await stratum.createTenant({ name: "Root", slug: "root_a" });
    const mid = await stratum.createTenant({
      name: "Mid",
      slug: "mid_a",
      parent_id: root.id,
    });
    const leaf = await stratum.createTenant({
      name: "Leaf",
      slug: "leaf_a",
      parent_id: mid.id,
    });
    expect(leaf.depth).toBe(2);
    expect(leaf.ancestry_path).toContain(root.id);
    expect(leaf.ancestry_path).toContain(mid.id);
  });

  it("lists tenants", async () => {
    await stratum.createTenant({ name: "T1", slug: "t1" });
    await stratum.createTenant({ name: "T2", slug: "t2" });
    const list = await stratum.listTenants();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("gets a tenant by id", async () => {
    const created = await stratum.createTenant({
      name: "Find Me",
      slug: "findme",
    });
    const found = await stratum.getTenant(created.id);
    expect(found.name).toBe("Find Me");
  });

  it("rejects duplicate slugs", async () => {
    await stratum.createTenant({ name: "First", slug: "unique_slug" });
    await expect(
      stratum.createTenant({ name: "Second", slug: "unique_slug" }),
    ).rejects.toThrow();
  });
});
