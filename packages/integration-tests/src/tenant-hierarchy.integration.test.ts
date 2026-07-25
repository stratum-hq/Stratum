import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { TenantHasChildrenError } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * Tenant hierarchy behaviors that only real Postgres proves: the slug CHECK
 * constraint, the parent_id ON DELETE RESTRICT foreign key, sort_order
 * renumbering, and ancestor/root resolution over a real ancestry_path.
 */
describe("tenant hierarchy + constraints (integration)", () => {
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

  it("rejects slugs that violate the CHECK constraint and writes no row", async () => {
    // The service does not re-validate the slug; the tenants.slug CHECK
    // (^[a-z][a-z0-9_]{0,62}$) is the only thing enforcing it. A mock accepts
    // any string.
    for (const bad of ["Uppercase", "has-hyphen", "1leadingdigit", "has space"]) {
      await expect(
        stratum.createTenant(tenantInput({ name: "Bad", slug: bad })),
      ).rejects.toThrow();
    }
    const count = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM tenants`,
    );
    expect(count.rows[0].n).toBe("0");
  });

  it("enforces parent_id ON DELETE RESTRICT on a hard delete", async () => {
    const parent = await stratum.createTenant(
      tenantInput({ name: "Parent", slug: uniqueSlug("frp") }),
    );
    await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("frc"), parent_id: parent.id }),
    );

    // A raw hard-delete of a referenced parent must be refused by the FK, not
    // silently cascade. (The service never hard-deletes; this proves the guard.)
    await expect(
      getPool().query(`DELETE FROM tenants WHERE id = $1`, [parent.id]),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("renumbers sibling sort_order and getChildren returns the new order", async () => {
    const root = await stratum.createTenant(
      tenantInput({ name: "Root", slug: uniqueSlug("ror") }),
    );
    // Create sequentially so created_at (the tie-breaker) is strictly increasing.
    const first = await stratum.createTenant(
      tenantInput({ name: "First", slug: uniqueSlug("ro1"), parent_id: root.id }),
    );
    const second = await stratum.createTenant(
      tenantInput({ name: "Second", slug: uniqueSlug("ro2"), parent_id: root.id }),
    );
    const third = await stratum.createTenant(
      tenantInput({ name: "Third", slug: uniqueSlug("ro3"), parent_id: root.id }),
    );

    // Insertion order before any reorder.
    expect((await stratum.getChildren(root.id)).map((t) => t.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);

    // Move the third child to the front.
    await stratum.reorderTenant(third.id, 0);

    const after = await stratum.getChildren(root.id);
    expect(after.map((t) => t.id)).toEqual([third.id, first.id, second.id]);
    // sort_order was rewritten to a clean 0..n sequence.
    expect(after.map((t) => t.sort_order)).toEqual([0, 1, 2]);
  });

  it("resolves ancestors (depth order) and root for a deep node", async () => {
    const root = await stratum.createTenant(
      tenantInput({ name: "Root", slug: uniqueSlug("anr") }),
    );
    const mid = await stratum.createTenant(
      tenantInput({ name: "Mid", slug: uniqueSlug("anm"), parent_id: root.id }),
    );
    const leaf = await stratum.createTenant(
      tenantInput({ name: "Leaf", slug: uniqueSlug("anl"), parent_id: mid.id }),
    );

    const ancestors = await stratum.getAncestors(leaf.id);
    expect(ancestors.map((t) => t.id)).toEqual([root.id, mid.id]);

    expect((await stratum.getRoot(leaf.id)).id).toBe(root.id);
    expect((await stratum.getRoot(mid.id)).id).toBe(root.id);
    // A root resolves to itself.
    expect((await stratum.getRoot(root.id)).id).toBe(root.id);
  });

  it("blocks deleting a tenant with active children, then allows it once the child is archived", async () => {
    const parent = await stratum.createTenant(
      tenantInput({ name: "Parent", slug: uniqueSlug("dcp") }),
    );
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("dcc"), parent_id: parent.id }),
    );

    await expect(stratum.deleteTenant(parent.id)).rejects.toThrow(
      TenantHasChildrenError,
    );

    // Archive the child (soft delete), then the parent has no active children.
    await stratum.deleteTenant(child.id);
    await expect(stratum.deleteTenant(parent.id)).resolves.toBeUndefined();

    // Both are archived, not hard-deleted.
    const rows = await getPool().query<{ status: string }>(
      `SELECT status FROM tenants WHERE id = ANY($1)`,
      [[parent.id, child.id]],
    );
    expect(rows.rows.every((r) => r.status === "archived")).toBe(true);
  });
});
