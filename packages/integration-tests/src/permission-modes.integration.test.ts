import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  PermissionMode,
  RevocationMode,
  PermissionLockedError,
  PermissionRevocationDeniedError,
} from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Permission delegation and revocation semantics against real Postgres:
 * LOCKED inheritance blocking descendant writes, the resolved mode flags, the
 * UNIQUE(tenant_id, key) constraint, and the PERMANENT / SOFT / CASCADE
 * revocation modes. (CASCADE after a slug rename is covered by
 * cascade-revocation.integration.test.ts; here we prove PERMANENT and SOFT.)
 */
describe("permission modes + revocation (integration)", () => {
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

  async function tree(prefix: string) {
    const root = await stratum.createTenant({
      name: "Root",
      slug: uniqueSlug(`${prefix}r`),
    });
    const child = await stratum.createTenant({
      name: "Child",
      slug: uniqueSlug(`${prefix}c`),
      parent_id: root.id,
    });
    const grand = await stratum.createTenant({
      name: "Grand",
      slug: uniqueSlug(`${prefix}g`),
      parent_id: child.id,
    });
    return { root, child, grand };
  }

  it("a LOCKED ancestor key blocks a descendant from creating or updating it", async () => {
    const { root, child } = await tree("lk");

    // Child owns the key first...
    const childPolicy = await stratum.createPermission(child.id, {
      key: "feature:x",
      value: true,
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });

    // ...then the root LOCKS it.
    await stratum.createPermission(root.id, {
      key: "feature:x",
      value: true,
      mode: PermissionMode.LOCKED,
      revocation_mode: RevocationMode.CASCADE,
    });

    // A new descendant create for the locked key is refused.
    await expect(
      stratum.createPermission(child.id, {
        key: "feature:x",
        value: false,
        mode: PermissionMode.INHERITED,
        revocation_mode: RevocationMode.CASCADE,
      }),
    ).rejects.toThrow(PermissionLockedError);

    // And updating the pre-existing descendant copy is refused too.
    await expect(
      stratum.updatePermission(child.id, childPolicy.id, { value: false }),
    ).rejects.toThrow(PermissionLockedError);
  });

  it("resolves LOCKED / DELEGATED / INHERITED into the right flags", async () => {
    const t = await stratum.createTenant({
      name: "T",
      slug: uniqueSlug("flag"),
    });

    await stratum.createPermission(t.id, {
      key: "k:locked",
      value: true,
      mode: PermissionMode.LOCKED,
      revocation_mode: RevocationMode.CASCADE,
    });
    await stratum.createPermission(t.id, {
      key: "k:delegated",
      value: true,
      mode: PermissionMode.DELEGATED,
      revocation_mode: RevocationMode.CASCADE,
    });
    await stratum.createPermission(t.id, {
      key: "k:inherited",
      value: true,
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });

    const r = await stratum.resolvePermissions(t.id);
    expect(r["k:locked"]).toMatchObject({ locked: true, delegated: false });
    expect(r["k:delegated"]).toMatchObject({ locked: false, delegated: true });
    expect(r["k:inherited"]).toMatchObject({ locked: false, delegated: false });
  });

  it("propagates a root LOCKED permission down to a grandchild in resolution", async () => {
    const { root, grand } = await tree("prop");
    await stratum.createPermission(root.id, {
      key: "billing:admin",
      value: true,
      mode: PermissionMode.LOCKED,
      revocation_mode: RevocationMode.CASCADE,
    });

    const resolved = await stratum.resolvePermissions(grand.id);
    expect(resolved["billing:admin"]).toMatchObject({
      locked: true,
      source_tenant_id: root.id,
    });
  });

  it("nearest ancestor wins when the same INHERITED key is set at two levels", async () => {
    const { root, child, grand } = await tree("near");
    await stratum.createPermission(root.id, {
      key: "k",
      value: "root",
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });
    await stratum.createPermission(child.id, {
      key: "k",
      value: "child",
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });

    const resolved = await stratum.resolvePermissions(grand.id);
    expect(resolved["k"].value).toBe("child");
    expect(resolved["k"].source_tenant_id).toBe(child.id);
  });

  it("rejects a duplicate key on the same tenant (UNIQUE tenant_id, key)", async () => {
    const t = await stratum.createTenant({
      name: "T",
      slug: uniqueSlug("dup"),
    });
    await stratum.createPermission(t.id, {
      key: "k",
      value: true,
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });
    await expect(
      stratum.createPermission(t.id, {
        key: "k",
        value: true,
        mode: PermissionMode.INHERITED,
        revocation_mode: RevocationMode.CASCADE,
      }),
    ).rejects.toThrow();
    const count = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM permission_policies WHERE tenant_id = $1 AND key = 'k'`,
      [t.id],
    );
    expect(count.rows[0].n).toBe("1");
  });

  it("refuses to revoke a PERMANENT permission and leaves it in place", async () => {
    const t = await stratum.createTenant({
      name: "T",
      slug: uniqueSlug("perm"),
    });
    const policy = await stratum.createPermission(t.id, {
      key: "audit:immutable",
      value: true,
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.PERMANENT,
    });

    await expect(stratum.deletePermission(t.id, policy.id)).rejects.toThrow(
      PermissionRevocationDeniedError,
    );
    // Still present.
    expect(
      (await stratum.resolvePermissions(t.id))["audit:immutable"],
    ).toBeDefined();
  });

  it("SOFT revocation drops only the target policy, leaving a descendant's own copy intact", async () => {
    const { root, child } = await tree("soft");

    const rootPolicy = await stratum.createPermission(root.id, {
      key: "k",
      value: "root",
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.SOFT,
    });
    await stratum.createPermission(child.id, {
      key: "k",
      value: "child",
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });

    await stratum.deletePermission(root.id, rootPolicy.id);

    // Root's copy gone; child's own copy survives (SOFT does not cascade).
    expect((await stratum.resolvePermissions(root.id))["k"]).toBeUndefined();
    const childResolved = await stratum.resolvePermissions(child.id);
    expect(childResolved["k"].value).toBe("child");
    expect(childResolved["k"].source_tenant_id).toBe(child.id);
  });
});
