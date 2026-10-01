import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
  getAdminPool,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * ancestry_ltree is derived from the slug chain. Renaming a tenant's slug must
 * rewrite the ltree of every descendant, not just the renamed row, so that
 * `<@` subtree queries on the documented column keep matching parent_id.
 */
describe("ancestry_ltree after slug rename (integration)", () => {
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

  async function ltreeOf(id: string): Promise<string> {
    const res = await getPool().query<{ l: string }>(
      `SELECT ancestry_ltree::text AS l FROM tenants WHERE id = $1`,
      [id],
    );
    return res.rows[0].l;
  }

  it("rewrites every descendant's ancestry_ltree when a tenant's slug is renamed", async () => {
    const rootSlug = uniqueSlug("lr");
    const root = await stratum.createTenant({ name: "R", slug: rootSlug });
    const mid = await stratum.createTenant({ name: "M", slug: uniqueSlug("lm"), parent_id: root.id });
    const child = await stratum.createTenant({ name: "C", slug: uniqueSlug("lc"), parent_id: mid.id });
    const grand = await stratum.createTenant({ name: "G", slug: uniqueSlug("lg"), parent_id: child.id });

    const newMidSlug = uniqueSlug("lmren");
    await stratum.updateTenant(mid.id, { slug: newMidSlug });

    expect(await ltreeOf(mid.id)).toBe(`${rootSlug}.${newMidSlug}`);
    expect(await ltreeOf(child.id)).toBe(`${rootSlug}.${newMidSlug}.${child.slug}`);
    expect(await ltreeOf(grand.id)).toBe(`${rootSlug}.${newMidSlug}.${child.slug}.${grand.slug}`);

    const subtree = await getPool().query<{ id: string }>(
      `SELECT id FROM tenants WHERE ancestry_ltree <@ $1::ltree AND id != $2`,
      [`${rootSlug}.${newMidSlug}`, mid.id],
    );
    expect(subtree.rows.map((r) => r.id).sort()).toEqual([child.id, grand.id].sort());
  });

  it("keeps descendant ltrees consistent after a move followed by a rename", async () => {
    const a = await stratum.createTenant({ name: "A", slug: uniqueSlug("la") });
    const b = await stratum.createTenant({ name: "B", slug: uniqueSlug("lb") });
    const mid = await stratum.createTenant({ name: "M", slug: uniqueSlug("lm2"), parent_id: a.id });
    const leaf = await stratum.createTenant({ name: "L", slug: uniqueSlug("ll2"), parent_id: mid.id });

    await stratum.moveTenant(mid.id, b.id);
    const renamed = uniqueSlug("lm2ren");
    await stratum.updateTenant(mid.id, { slug: renamed });

    expect(await ltreeOf(leaf.id)).toBe(`${b.slug}.${renamed}.${leaf.slug}`);
  });

  it("migration 024 repairs descendant ltrees left stale by an earlier rename", async () => {
    const root = await stratum.createTenant({ name: "R", slug: uniqueSlug("lrr") });
    const child = await stratum.createTenant({ name: "C", slug: uniqueSlug("lrc"), parent_id: root.id });
    const grand = await stratum.createTenant({ name: "G", slug: uniqueSlug("lrg"), parent_id: child.id });

    // Simulate a row left behind by a pre-024 rename. Tree columns change
    // only under the bypass (migration 031).
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL app.bypass_rls = 'on'");
      await c.query(`UPDATE tenants SET ancestry_ltree = $1::ltree WHERE id = $2`, [
        `stale_prefix.${child.slug}.${grand.slug}`,
        grand.id,
      ]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }

    const here = path.dirname(fileURLToPath(import.meta.url));
    const sql = fs.readFileSync(
      path.resolve(here, "../../lib/src/migrations/024_propagate_ancestry_ltree.sql"),
      "utf-8",
    );
    await getPool().query(sql);

    expect(await ltreeOf(grand.id)).toBe(`${root.slug}.${child.slug}.${grand.slug}`);
  });
});
