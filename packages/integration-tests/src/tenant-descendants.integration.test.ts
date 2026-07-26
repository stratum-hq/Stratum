import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";

/**
 * getDescendants scoping across the three tenant states — active, archived
 * (status='archived', deleted_at NULL) and soft-deleted (status='archived',
 * deleted_at set). Unlike the unit tests, these run against a real database, so
 * they prove the WHERE predicate actually filters rows rather than merely
 * asserting the SQL text.
 */
describe("getDescendants states (integration)", () => {
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

  /**
   * Build a root with four descendants spanning every state:
   *   root
   *   ├─ active        (status='active')
   *   │  └─ grandchild (status='active') — proves multi-level depth
   *   ├─ archived      (status='archived', deleted_at NULL)
   *   └─ soft_deleted  (status='archived', deleted_at set, via deleteTenant)
   */
  async function seedTree() {
    const root = await stratum.createTenant({ name: "Root", slug: "root_d" });
    const active = await stratum.createTenant({
      name: "Active",
      slug: "active_d",
      parent_id: root.id,
    });
    const grandchild = await stratum.createTenant({
      name: "Grandchild",
      slug: "grand_d",
      parent_id: active.id,
    });
    const archived = await stratum.createTenant({
      name: "Archived",
      slug: "archived_d",
      parent_id: root.id,
    });
    const softDeleted = await stratum.createTenant({
      name: "Soft",
      slug: "soft_d",
      parent_id: root.id,
    });

    // Archived-but-not-deleted: no app method sets this, so drive it directly.
    await getPool().query(
      `UPDATE tenants SET status = 'archived' WHERE id = $1`,
      [archived.id],
    );
    // Soft-deleted: deleteTenant sets status='archived' AND deleted_at=now().
    await stratum.deleteTenant(softDeleted.id);

    return { root, active, grandchild, archived, softDeleted };
  }

  it("excludes archived and soft-deleted descendants by default", async () => {
    const { root, active, grandchild } = await seedTree();

    const descendants = await stratum.getDescendants(root.id);
    const ids = descendants.map((d) => d.id).sort();

    expect(ids).toEqual([active.id, grandchild.id].sort());
    expect(descendants.every((d) => d.status === "active")).toBe(true);
  });

  it("includes every state when includeArchived is true", async () => {
    const { active, grandchild, archived, softDeleted, root } =
      await seedTree();

    const all = await stratum.getDescendants(root.id, true);
    const ids = all.map((d) => d.id).sort();

    expect(ids).toEqual(
      [active.id, grandchild.id, archived.id, softDeleted.id].sort(),
    );

    // Both non-active states are present, and they are distinguishable:
    // archived has no deleted_at, soft-deleted does.
    const archivedRow = all.find((d) => d.id === archived.id);
    const softRow = all.find((d) => d.id === softDeleted.id);
    expect(archivedRow?.status).toBe("archived");
    expect(archivedRow?.deleted_at).toBeNull();
    expect(softRow?.status).toBe("archived");
    expect(softRow?.deleted_at).not.toBeNull();
  });
});
