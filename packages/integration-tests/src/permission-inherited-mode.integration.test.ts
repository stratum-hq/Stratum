import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { PermissionMode, RevocationMode, ForbiddenError } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * INHERITED delegation mode against real Postgres: descendants may override the
 * value of an INHERITED permission, but may not change its mode (to LOCKED) or
 * re-delegate it (to DELEGATED), on create or on update.
 */
describe("INHERITED permission mode restrictions (integration)", () => {
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
    const root = await stratum.createTenant({ name: "R", slug: uniqueSlug(`${prefix}r`) });
    const child = await stratum.createTenant({
      name: "C",
      slug: uniqueSlug(`${prefix}c`),
      parent_id: root.id,
    });
    const grand = await stratum.createTenant({
      name: "G",
      slug: uniqueSlug(`${prefix}g`),
      parent_id: child.id,
    });
    return { root, child, grand };
  }

  async function countPolicies(tenantId: string, key: string): Promise<number> {
    const res = await getPool().query(
      `SELECT count(*)::int AS n FROM permission_policies WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key],
    );
    return res.rows[0].n;
  }

  it("refuses a descendant creating a DELEGATED or LOCKED policy for a key an ancestor set INHERITED", async () => {
    const { root, child, grand } = await tree("ih");
    await stratum.createPermission(root.id, {
      key: "can_invite",
      value: true,
      mode: PermissionMode.INHERITED,
    });

    await expect(
      stratum.createPermission(child.id, {
        key: "can_invite",
        value: true,
        mode: PermissionMode.DELEGATED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      stratum.createPermission(grand.id, {
        key: "can_invite",
        value: false,
        mode: PermissionMode.LOCKED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await countPolicies(child.id, "can_invite")).toBe(0);
    expect(await countPolicies(grand.id, "can_invite")).toBe(0);
  });

  it("refuses a descendant changing the mode of its override of an INHERITED key", async () => {
    const { root, child } = await tree("ihu");
    await stratum.createPermission(root.id, {
      key: "can_invite",
      value: true,
      mode: PermissionMode.INHERITED,
    });
    const override = await stratum.createPermission(child.id, {
      key: "can_invite",
      value: false,
      mode: PermissionMode.INHERITED,
    });

    await expect(
      stratum.updatePermission(child.id, override.id, { mode: PermissionMode.DELEGATED }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      stratum.updatePermission(child.id, override.id, { mode: PermissionMode.LOCKED }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const resolved = await stratum.resolvePermissions(child.id);
    expect(resolved["can_invite"].mode).toBe(PermissionMode.INHERITED);
  });

  it("still lets a descendant override the value of an INHERITED key, and re-delegate a DELEGATED one", async () => {
    const { root, child, grand } = await tree("iho");
    await stratum.createPermission(root.id, {
      key: "can_invite",
      value: true,
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });
    const override = await stratum.createPermission(child.id, {
      key: "can_invite",
      value: false,
    });
    const updated = await stratum.updatePermission(child.id, override.id, {
      value: "limited",
      mode: PermissionMode.INHERITED,
    });
    expect(updated.value).toBe("limited");

    await stratum.createPermission(root.id, {
      key: "branding",
      value: true,
      mode: PermissionMode.DELEGATED,
    });
    await stratum.createPermission(child.id, {
      key: "branding",
      value: true,
      mode: PermissionMode.DELEGATED,
    });
    await stratum.createPermission(grand.id, {
      key: "branding",
      value: false,
      mode: PermissionMode.LOCKED,
    });
    const resolved = await stratum.resolvePermissions(grand.id);
    expect(resolved["branding"]).toMatchObject({ value: false, locked: true });
  });
});
