import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { PermissionMode, RevocationMode } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";

/**
 * Cross-tenant isolation at the SERVICE layer, against a real database.
 *
 * The control-plane deny matrix proves the HTTP authorization boundary. These
 * cells prove the boundaries the middleware cannot: that the library's own
 * subtree resolution — getDescendants, resolveConfig, resolvePermissions and
 * CASCADE revocation — does not leak across an MSP-to-MSP boundary, and stays
 * correct after a slug rename. The existing cascade/descendants suites assert
 * the POSITIVE direction (an effect reaches the intended subtree); these assert
 * the NEGATIVE direction (the same effect never reaches an unrelated tenant).
 *
 * Two independent MSP roots, each with its own subtree:
 *
 *   A (root)                 B (root)
 *   |- A1                    |- B1
 *   |  |- A11
 *   |- A2
 */
describe("cross-tenant isolation (integration)", () => {
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

  async function twoRoots(prefix: string) {
    const a = await stratum.createTenant({ name: "A", slug: `${prefix}_a` });
    const a1 = await stratum.createTenant({
      name: "A1",
      slug: `${prefix}_a1`,
      parent_id: a.id,
    });
    const a11 = await stratum.createTenant({
      name: "A11",
      slug: `${prefix}_a11`,
      parent_id: a1.id,
    });
    const a2 = await stratum.createTenant({
      name: "A2",
      slug: `${prefix}_a2`,
      parent_id: a.id,
    });
    const b = await stratum.createTenant({ name: "B", slug: `${prefix}_b` });
    const b1 = await stratum.createTenant({
      name: "B1",
      slug: `${prefix}_b1`,
      parent_id: b.id,
    });
    return { a, a1, a11, a2, b, b1 };
  }

  const cascadePerm = (key: string) => ({
    key,
    mode: PermissionMode.INHERITED,
    revocation_mode: RevocationMode.CASCADE,
  });

  // ---- Boundary 2: getDescendants respects the subtree boundary ----------
  it("getDescendants of a root never includes an unrelated root's subtree", async () => {
    const { a, a1, a11, a2, b, b1 } = await twoRoots("desc");

    const aDesc = (await stratum.getDescendants(a.id)).map((d) => d.id).sort();
    expect(aDesc).toEqual([a1.id, a11.id, a2.id].sort());
    expect(aDesc).not.toContain(b.id);
    expect(aDesc).not.toContain(b1.id);

    // A child key's subtree is only its own descendants: not the parent, not a
    // sibling, not an unrelated root.
    const a1Desc = (await stratum.getDescendants(a1.id)).map((d) => d.id);
    expect(a1Desc).toEqual([a11.id]);
    expect(a1Desc).not.toContain(a.id);
    expect(a1Desc).not.toContain(a2.id);
    expect(a1Desc).not.toContain(b.id);
  });

  // ---- Boundary 1/2: resolveConfig does not cross the boundary ------------
  it("resolveConfig inherits within the subtree but never leaks to another root", async () => {
    const { a, a1, a2, b, b1 } = await twoRoots("cfg");

    await stratum.setConfig(a.id, "brand", {
      value: "acme",
      locked: false,
      sensitive: false,
    });

    // Inherited down A's subtree (positive control).
    expect((await stratum.resolveConfig(a1.id)).brand?.value).toBe("acme");
    expect((await stratum.resolveConfig(a2.id)).brand?.value).toBe("acme");

    // Never visible to root B or its subtree (the boundary).
    expect((await stratum.resolveConfig(b.id)).brand).toBeUndefined();
    expect((await stratum.resolveConfig(b1.id)).brand).toBeUndefined();
  });

  // ---- Boundary 4: a delegated permission stays inside its own subtree ----
  it("resolvePermissions of a granted key does not leak the grant to another root", async () => {
    const { a, a1, b } = await twoRoots("perm");

    await stratum.createPermission(a.id, cascadePerm("feature:gamma"));

    // Inherited by A's descendant (positive control).
    expect(
      (await stratum.resolvePermissions(a1.id))["feature:gamma"],
    ).toBeDefined();

    // Root B, which was granted nothing, resolves nothing.
    expect(
      (await stratum.resolvePermissions(b.id))["feature:gamma"],
    ).toBeUndefined();
  });

  // ---- Boundary 4: CASCADE revocation is bounded, even after a rename -----
  it("CASCADE revocation reaches descendants after a slug rename but never an unrelated root", async () => {
    const { a, a11, b } = await twoRoots("casc");

    // Same permission held independently by: A (root), A11 (its descendant),
    // and B (an unrelated root). All CASCADE.
    const rootPolicy = await stratum.createPermission(
      a.id,
      cascadePerm("feature:beta"),
    );
    await stratum.createPermission(a11.id, cascadePerm("feature:beta"));
    await stratum.createPermission(b.id, cascadePerm("feature:beta"));

    // Baseline: all three resolve the key from their own copy.
    expect(
      (await stratum.resolvePermissions(a11.id))["feature:beta"],
    ).toBeDefined();
    expect(
      (await stratum.resolvePermissions(b.id))["feature:beta"],
    ).toBeDefined();

    // Rename the slug of the tenant the revocation runs on, then CASCADE-revoke.
    await stratum.updateTenant(a.id, { slug: "casc_a_renamed" });
    await stratum.deletePermission(a.id, rootPolicy.id);

    // Reached A's descendant across the rename (CASCADE by stable identity).
    expect(
      (await stratum.resolvePermissions(a11.id))["feature:beta"],
    ).toBeUndefined();
    // Did NOT cross the boundary: B keeps its own grant.
    expect(
      (await stratum.resolvePermissions(b.id))["feature:beta"],
    ).toBeDefined();
  });
});
