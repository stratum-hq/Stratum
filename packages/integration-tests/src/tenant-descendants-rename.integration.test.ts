import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";

/**
 * getDescendants is the subtree-scoping primitive (GDPR purge, billing,
 * lifecycle passes all scope through it). Its match must key off stable tenant
 * identity, not a slug-derived subtree key: renaming a tenant's slug must not
 * change which rows are in its subtree.
 *
 * Builds root -> mid -> child -> grand, renames the slug of the tenant the
 * subtree query runs on (mid), and asserts getDescendants(mid) still returns
 * every deeper descendant. Run against a real database so the match is proven
 * against actual rows rather than the SQL text.
 */
describe("getDescendants after slug rename (integration)", () => {
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

  async function buildTree(prefix: string) {
    const root = await stratum.createTenant({
      name: "Root",
      slug: `${prefix}_root`,
    });
    const mid = await stratum.createTenant({
      name: "Mid",
      slug: `${prefix}_mid`,
      parent_id: root.id,
    });
    const child = await stratum.createTenant({
      name: "Child",
      slug: `${prefix}_child`,
      parent_id: mid.id,
    });
    const grand = await stratum.createTenant({
      name: "Grand",
      slug: `${prefix}_grand`,
      parent_id: child.id,
    });
    return { root, mid, child, grand };
  }

  it("returns the full subtree of mid (control, no rename)", async () => {
    const { mid, child, grand } = await buildTree("ctrl");

    const ids = (await stratum.getDescendants(mid.id)).map((d) => d.id).sort();

    expect(ids).toEqual([child.id, grand.id].sort());
  });

  it("still returns deep descendants after the queried tenant's slug is renamed", async () => {
    const { mid, child, grand } = await buildTree("ren");

    // Rename the slug of the tenant whose subtree we then query. The slug-derived
    // subtree key for mid changes, but the descendants keep the old label, so a
    // slug-keyed match drops them. Identity-keyed matching must not.
    await stratum.updateTenant(mid.id, { slug: "ren_mid_renamed" });

    const descendants = await stratum.getDescendants(mid.id);
    const ids = descendants.map((d) => d.id).sort();

    // Both the direct child and the two-level-deep grandchild must be present.
    expect(ids).toEqual([child.id, grand.id].sort());
    expect(ids).toContain(grand.id);
  });
});
