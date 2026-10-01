import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  PermissionMode,
  RevocationMode,
  PermissionRevocationDeniedError,
} from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
  getAdminPool,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * PERMANENT revocation mode against real Postgres: a PERMANENT policy cannot be
 * turned into a deletable one by an update, and an ancestor's CASCADE revocation
 * leaves a descendant's own PERMANENT policy on the same key in place.
 */
describe("PERMANENT permission revocation (integration)", () => {
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

  async function countPolicies(tenantId: string, key: string): Promise<number> {
    const res = await getPool().query(
      `SELECT count(*)::int AS n FROM permission_policies WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key],
    );
    return res.rows[0].n;
  }

  it("refuses to change a PERMANENT policy's revocation mode, so it stays undeletable", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("pp") });
    const p = await stratum.createPermission(t.id, {
      key: "compliance_flag",
      value: true,
      mode: PermissionMode.LOCKED,
      revocation_mode: RevocationMode.PERMANENT,
    });

    await expect(
      stratum.updatePermission(t.id, p.id, { revocation_mode: RevocationMode.CASCADE }),
    ).rejects.toBeInstanceOf(PermissionRevocationDeniedError);

    await expect(stratum.deletePermission(t.id, p.id)).rejects.toBeInstanceOf(
      PermissionRevocationDeniedError,
    );
    expect(await countPolicies(t.id, "compliance_flag")).toBe(1);
  });

  it("still allows other updates to a PERMANENT policy and re-stating PERMANENT", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("ppu") });
    const p = await stratum.createPermission(t.id, {
      key: "compliance_flag",
      value: true,
      revocation_mode: RevocationMode.PERMANENT,
    });

    const updated = await stratum.updatePermission(t.id, p.id, {
      value: false,
      revocation_mode: RevocationMode.PERMANENT,
    });
    expect(updated.value).toBe(false);
    expect(updated.revocation_mode).toBe(RevocationMode.PERMANENT);
  });

  it("keeps a descendant's PERMANENT policy when an ancestor revokes the same key with CASCADE", async () => {
    const root = await stratum.createTenant({ name: "R", slug: uniqueSlug("ppr") });
    const child = await stratum.createTenant({ name: "C", slug: uniqueSlug("ppc"), parent_id: root.id });
    const grand = await stratum.createTenant({ name: "G", slug: uniqueSlug("ppg"), parent_id: child.id });

    const rootPolicy = await stratum.createPermission(root.id, {
      key: "feature_x",
      value: true,
      revocation_mode: RevocationMode.CASCADE,
    });
    await stratum.createPermission(child.id, {
      key: "feature_x",
      value: true,
      revocation_mode: RevocationMode.PERMANENT,
    });
    await stratum.createPermission(grand.id, {
      key: "feature_x",
      value: false,
      revocation_mode: RevocationMode.CASCADE,
    });

    await stratum.deletePermission(root.id, rootPolicy.id);

    expect(await countPolicies(root.id, "feature_x")).toBe(0);
    expect(await countPolicies(child.id, "feature_x")).toBe(1);
    // Non-PERMANENT descendant rows are still revoked by the cascade.
    expect(await countPolicies(grand.id, "feature_x")).toBe(0);
  });
});
