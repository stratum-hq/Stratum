import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { PermissionMode, RevocationMode } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";

// createPermission takes the schema OUTPUT type, so the .default() fields are
// required at the type level. This states the CASCADE defaults explicitly.
const cascadePerm = (key: string) => ({
  key,
  mode: PermissionMode.INHERITED,
  revocation_mode: RevocationMode.CASCADE,
});

/**
 * CASCADE revocation must reach every current descendant identified by stable
 * tenant identity, not by a slug-derived subtree key. A slug rename must not
 * leave a revoked permission (or ABAC policy) live on a descendant.
 *
 * Builds a three-level tree (root -> child -> grandchild) where both the root
 * and the grandchild hold their own copy of the same permission/policy, then
 * revokes at the root with CASCADE. The grandchild's own copy must be removed.
 */
describe("CASCADE revocation after slug rename (integration)", () => {
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
    const child = await stratum.createTenant({
      name: "Child",
      slug: `${prefix}_child`,
      parent_id: root.id,
    });
    const grandchild = await stratum.createTenant({
      name: "Grandchild",
      slug: `${prefix}_grand`,
      parent_id: child.id,
    });
    return { root, child, grandchild };
  }

  it("cascades permission revocation to a descendant (control, no rename)", async () => {
    const { root, grandchild } = await buildTree("ctrl");

    const rootPolicy = await stratum.createPermission(
      root.id,
      cascadePerm("feature:beta"),
    );
    await stratum.createPermission(grandchild.id, cascadePerm("feature:beta"));

    // Baseline: grandchild resolves the key (from its own copy).
    const before = await stratum.resolvePermissions(grandchild.id);
    expect(before["feature:beta"]).toBeDefined();

    await stratum.deletePermission(root.id, rootPolicy.id);

    // CASCADE removed the grandchild's own copy too.
    const after = await stratum.resolvePermissions(grandchild.id);
    expect(after["feature:beta"]).toBeUndefined();
  });

  it("cascades permission revocation to a descendant after the revoked tenant's slug is renamed", async () => {
    const { root, grandchild } = await buildTree("prev");

    const rootPolicy = await stratum.createPermission(
      root.id,
      cascadePerm("feature:beta"),
    );
    await stratum.createPermission(grandchild.id, cascadePerm("feature:beta"));

    // Rename the slug of the tenant the revocation runs on.
    await stratum.updateTenant(root.id, { slug: "prev_root_renamed" });

    await stratum.deletePermission(root.id, rootPolicy.id);

    // The grandchild must NOT retain the permission. Before the fix, the
    // slug-derived subtree match failed to reach the grandchild, so its own
    // copy survived and still resolved.
    const after = await stratum.resolvePermissions(grandchild.id);
    expect(after["feature:beta"]).toBeUndefined();
  });

  it("cascades ABAC policy revocation to a descendant after the revoked tenant's slug is renamed", async () => {
    const { root, grandchild } = await buildTree("arev");

    const rootPolicy = await stratum.createAbacPolicy(root.id, {
      name: "beta_gate",
      resource_type: "report",
      action: "read",
      effect: "allow",
      conditions: [],
    });
    await stratum.createAbacPolicy(grandchild.id, {
      name: "beta_gate",
      resource_type: "report",
      action: "read",
      effect: "allow",
      conditions: [],
    });

    await stratum.updateTenant(root.id, { slug: "arev_root_renamed" });

    await stratum.deleteAbacPolicy(root.id, rootPolicy.id);

    // The grandchild must retain no copy of the revoked policy.
    const resolved = await stratum.resolveAbacPolicies(grandchild.id);
    expect(resolved).toHaveLength(0);
  });
});
