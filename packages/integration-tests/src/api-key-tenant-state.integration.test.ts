import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum, InvalidTenantStateError } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// API keys are issued only for tenants that can use them. A key for a
// suspended or archived tenant could never authenticate, so creating or
// rotating one is refused with a tenant-state error instead of silently
// issuing an unusable credential.

async function keyCount(tenantId: string): Promise<number> {
  const res = await getPool().query(
    `SELECT count(*)::int AS n FROM api_keys WHERE tenant_id = $1`,
    [tenantId],
  );
  return res.rows[0].n;
}

describe("API key issuance and tenant state (integration)", () => {
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

  it("creates an API key for an active tenant", async () => {
    const tenant = await stratum.createTenant({ name: "ok", slug: uniqueSlug("ok") });
    const key = await stratum.createApiKey(tenant.id, "k");
    expect(key.tenant_id).toBe(tenant.id);
  });

  it("refuses to create an API key for a suspended tenant", async () => {
    const tenant = await stratum.createTenant({ name: "s", slug: uniqueSlug("s") });
    await stratum.suspendTenant(tenant.id);

    await expect(stratum.createApiKey(tenant.id, "k")).rejects.toBeInstanceOf(InvalidTenantStateError);
    expect(await keyCount(tenant.id)).toBe(0);
  });

  it("refuses to create an API key for an archived tenant", async () => {
    const tenant = await stratum.createTenant({ name: "a", slug: uniqueSlug("a") });
    await stratum.archiveTenant(tenant.id);

    await expect(stratum.createApiKey(tenant.id, "k")).rejects.toBeInstanceOf(InvalidTenantStateError);
    expect(await keyCount(tenant.id)).toBe(0);
  });

  it("refuses to rotate an API key whose tenant is suspended, and keeps the old key", async () => {
    const tenant = await stratum.createTenant({ name: "rs", slug: uniqueSlug("rs") });
    const key = await stratum.createApiKey(tenant.id, "k");
    await stratum.suspendTenant(tenant.id);

    await expect(stratum.rotateApiKey(key.id)).rejects.toBeInstanceOf(InvalidTenantStateError);
    const res = await getPool().query(`SELECT revoked_at FROM api_keys WHERE id = $1`, [key.id]);
    expect(res.rows[0].revoked_at).toBeNull();
    expect(await keyCount(tenant.id)).toBe(1);
  });

  it("refuses to rotate an API key whose tenant is archived", async () => {
    const tenant = await stratum.createTenant({ name: "ra", slug: uniqueSlug("ra") });
    const key = await stratum.createApiKey(tenant.id, "k");
    await stratum.archiveTenant(tenant.id);

    await expect(stratum.rotateApiKey(key.id)).rejects.toBeInstanceOf(InvalidTenantStateError);
    expect(await keyCount(tenant.id)).toBe(1);
  });

  it("still creates and rotates global (tenantless) keys", async () => {
    // Global keys have no tenant, so tenant state does not apply.
    const res = await getPool().query(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name) VALUES (NULL, $1, 'sk_test_', 'g') RETURNING id`,
      [`it-global-${Date.now()}`],
    );
    const rotated = await stratum.rotateApiKey(res.rows[0].id);
    expect(rotated.tenant_id).toBeNull();
  });
});
