import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  TenantCycleDetectedError,
  TenantNotFoundError,
} from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * moveTenant against real Postgres. A mocked pool cannot prove any of this:
 * the dual materialized path (ancestry_path of IDs maintained in app code, and
 * ancestry_ltree of slugs maintained by the migration 001 trigger) must both be
 * rewritten for the moved node AND its whole subtree, depth must be recomputed,
 * and getDescendants — which queries the ltree with `<@` — must reflect the new
 * location. The descendant rewrite fires the ltree trigger only because
 * moveTenant sets `slug = slug`; this test is what proves that actually works.
 */
describe("moveTenant subtree rewrite (integration)", () => {
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

  async function paths(id: string): Promise<{
    ancestry_path: string;
    depth: number;
    ltree: string;
    parent_id: string | null;
  }> {
    const res = await getPool().query<{
      ancestry_path: string;
      depth: number;
      ltree: string;
      parent_id: string | null;
    }>(
      `SELECT ancestry_path, depth, ancestry_ltree::text AS ltree, parent_id
       FROM tenants WHERE id = $1`,
      [id],
    );
    return res.rows[0];
  }

  it("rewrites ancestry_path, depth, and ancestry_ltree for the moved node and every descendant", async () => {
    const aSlug = uniqueSlug("mva");
    const cSlug = uniqueSlug("mvc");
    const gSlug = uniqueSlug("mvg");
    const bSlug = uniqueSlug("mvb");

    const a = await stratum.createTenant({ name: "A", slug: aSlug });
    const c = await stratum.createTenant({
      name: "C",
      slug: cSlug,
      parent_id: a.id,
    });
    const g = await stratum.createTenant({
      name: "G",
      slug: gSlug,
      parent_id: c.id,
    });
    const b = await stratum.createTenant({ name: "B", slug: bSlug });

    // Before: a -> c -> g. ltree is slug-based, path is id-based.
    expect((await paths(c.id)).ltree).toBe(`${aSlug}.${cSlug}`);
    expect((await paths(g.id)).ltree).toBe(`${aSlug}.${cSlug}.${gSlug}`);

    // Move c (and its subtree) under b.
    await stratum.moveTenant(c.id, b.id);

    const cAfter = await paths(c.id);
    expect(cAfter.parent_id).toBe(b.id);
    expect(cAfter.depth).toBe(1);
    expect(cAfter.ancestry_path).toBe(`/${b.id}`);
    expect(cAfter.ltree).toBe(`${bSlug}.${cSlug}`);

    // The grandchild moved with it: the trigger recomputed its slug-ltree and
    // the app rewrote its id-path and depth.
    const gAfter = await paths(g.id);
    expect(gAfter.depth).toBe(2);
    expect(gAfter.ancestry_path).toBe(`/${b.id}/${c.id}`);
    expect(gAfter.ltree).toBe(`${bSlug}.${cSlug}.${gSlug}`);
  });

  it("getDescendants (ltree query) follows the moved subtree to its new parent and leaves the old parent empty", async () => {
    const a = await stratum.createTenant({ name: "A", slug: uniqueSlug("da") });
    const c = await stratum.createTenant({
      name: "C",
      slug: uniqueSlug("dc"),
      parent_id: a.id,
    });
    const g = await stratum.createTenant({
      name: "G",
      slug: uniqueSlug("dg"),
      parent_id: c.id,
    });
    const b = await stratum.createTenant({ name: "B", slug: uniqueSlug("db") });

    await stratum.moveTenant(c.id, b.id);

    const underB = (await stratum.getDescendants(b.id)).map((t) => t.id).sort();
    expect(underB).toEqual([c.id, g.id].sort());

    // Old root no longer sees the moved subtree.
    expect(await stratum.getDescendants(a.id)).toHaveLength(0);

    // Subtree internals are intact: c still owns g.
    expect((await stratum.getDescendants(c.id)).map((t) => t.id)).toEqual([
      g.id,
    ]);
  });

  it("rejects a move that would create a cycle (under a descendant)", async () => {
    const a = await stratum.createTenant({
      name: "A",
      slug: uniqueSlug("cya"),
    });
    const c = await stratum.createTenant({
      name: "C",
      slug: uniqueSlug("cyc"),
      parent_id: a.id,
    });
    const g = await stratum.createTenant({
      name: "G",
      slug: uniqueSlug("cyg"),
      parent_id: c.id,
    });

    await expect(stratum.moveTenant(a.id, g.id)).rejects.toThrow(
      TenantCycleDetectedError,
    );
    // The tree is unchanged after the rejected move.
    expect((await paths(a.id)).parent_id).toBeNull();
    expect((await paths(g.id)).ancestry_path).toBe(`/${a.id}/${c.id}`);
  });

  it("rejects moving a tenant under itself", async () => {
    const a = await stratum.createTenant({
      name: "A",
      slug: uniqueSlug("sfa"),
    });
    await expect(stratum.moveTenant(a.id, a.id)).rejects.toThrow(
      TenantCycleDetectedError,
    );
  });

  it("rejects a move to a non-existent parent", async () => {
    const a = await stratum.createTenant({
      name: "A",
      slug: uniqueSlug("npa"),
    });
    await expect(
      stratum.moveTenant(a.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(TenantNotFoundError);
  });

  it("serializes concurrent sibling inserts under one parent (advisory lock) without corrupting the tree", async () => {
    const root = await stratum.createTenant({
      name: "Root",
      slug: uniqueSlug("cclock"),
    });

    const slugs = Array.from({ length: 6 }, () => uniqueSlug("ccl"));
    const children = await Promise.all(
      slugs.map((slug, i) =>
        stratum.createTenant({ name: `Child ${i}`, slug, parent_id: root.id }),
      ),
    );

    // Every concurrent insert committed as a valid depth-1 child.
    expect(children).toHaveLength(6);
    for (const child of children) {
      const p = await paths(child.id);
      expect(p.depth).toBe(1);
      expect(p.parent_id).toBe(root.id);
      expect(p.ancestry_path).toBe(`/${root.id}`);
    }
    // The registry agrees: exactly six live children, no lost or duplicated rows.
    expect(await stratum.getChildren(root.id)).toHaveLength(6);
  });
});
