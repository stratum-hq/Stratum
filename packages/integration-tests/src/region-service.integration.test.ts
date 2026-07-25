import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import type { AuditContext } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * The whole region surface of the Stratum facade is unexercised by any real-DB
 * test: create/get/list/update/delete plus migrateRegion, which moves a tenant
 * across data-residency boundaries. These behaviors are entirely SQL — the
 * regions table's UNIQUE(slug) and status CHECK constraints, the FK from
 * tenants.region_id, the RESTRICT that blocks deleting a region with active
 * tenants, and the "target region must be active" guard on migration — so a
 * mocked pool proves none of them.
 */
describe("region service against real Postgres (integration)", () => {
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

  it("persists all fields and applies defaults, never exposing database_url", async () => {
    const region = await stratum.createRegion({
      display_name: "US East",
      slug: uniqueSlug("use"),
      control_plane_url: "https://cp.example.com",
      metadata: { provider: "aws" },
    });

    expect(region.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(region.display_name).toBe("US East");
    expect(region.control_plane_url).toBe("https://cp.example.com");
    expect(region.is_primary).toBe(false); // default
    expect(region.status).toBe("active"); // default
    expect(region.metadata).toEqual({ provider: "aws" });
    // database_url is a runtime-only secret and must never leave the service.
    expect(region.database_url).toBeNull();

    const fetched = await stratum.getRegion(region.id);
    expect(fetched.slug).toBe(region.slug);
  });

  it("enforces the UNIQUE(slug) constraint at the database", async () => {
    const slug = uniqueSlug("dup");
    await stratum.createRegion({ display_name: "First", slug });
    await expect(
      stratum.createRegion({ display_name: "Second", slug }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("getRegion throws for an unknown id", async () => {
    await expect(
      stratum.getRegion("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/not found/i);
  });

  it("lists regions oldest-first by created_at", async () => {
    const a = await stratum.createRegion({ display_name: "A", slug: uniqueSlug("la") });
    const b = await stratum.createRegion({ display_name: "B", slug: uniqueSlug("lb") });

    const list = await stratum.listRegions();
    expect(list.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("updates only the mutable fields and leaves slug/is_primary alone", async () => {
    const region = await stratum.createRegion({
      display_name: "Old",
      slug: uniqueSlug("upd"),
      is_primary: true,
    });

    const updated = await stratum.updateRegion(region.id, {
      display_name: "New",
      status: "draining",
      metadata: { drained_by: "ops" },
    });

    expect(updated.display_name).toBe("New");
    expect(updated.status).toBe("draining");
    expect(updated.metadata).toEqual({ drained_by: "ops" });
    // Fields not in UpdateRegionInput are untouched.
    expect(updated.slug).toBe(region.slug);
    expect(updated.is_primary).toBe(true);
  });

  it("update with an empty patch is a no-op that returns the current row", async () => {
    const region = await stratum.createRegion({ display_name: "NoOp", slug: uniqueSlug("noop") });
    const updated = await stratum.updateRegion(region.id, {});
    expect(updated.display_name).toBe("NoOp");
    expect(updated.updated_at).toBe(region.updated_at); // untouched, no updated_at bump
  });

  it("updateRegion throws for an unknown id", async () => {
    await expect(
      stratum.updateRegion("00000000-0000-0000-0000-000000000000", { status: "inactive" }),
    ).rejects.toThrow(/not found/i);
  });

  it("deletes a region that has no tenants assigned", async () => {
    const region = await stratum.createRegion({ display_name: "Empty", slug: uniqueSlug("del") });
    await stratum.deleteRegion(region.id);
    await expect(stratum.getRegion(region.id)).rejects.toThrow(/not found/i);
  });

  it("refuses to delete a region while an active tenant is assigned to it", async () => {
    const region = await stratum.createRegion({ display_name: "InUse", slug: uniqueSlug("inuse") });
    const tenant = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("rt") }));
    await stratum.migrateRegion(tenant.id, region.id);

    await expect(stratum.deleteRegion(region.id)).rejects.toThrow(
      /active tenants are still assigned/i,
    );

    // The region is still there.
    expect((await stratum.getRegion(region.id)).id).toBe(region.id);
  });

  it("migrateRegion assigns the tenant's region_id and is reflected in the row", async () => {
    const region = await stratum.createRegion({ display_name: "Dest", slug: uniqueSlug("dest") });
    const tenant = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("mt") }));

    // Freshly created tenants have no region.
    const before = await getPool().query<{ region_id: string | null }>(
      `SELECT region_id FROM tenants WHERE id = $1`,
      [tenant.id],
    );
    expect(before.rows[0].region_id).toBeNull();

    await stratum.migrateRegion(tenant.id, region.id);

    const after = await getPool().query<{ region_id: string | null }>(
      `SELECT region_id FROM tenants WHERE id = $1`,
      [tenant.id],
    );
    expect(after.rows[0].region_id).toBe(region.id);
  });

  it("migrateRegion refuses a target region that is not active", async () => {
    const region = await stratum.createRegion({
      display_name: "Draining",
      slug: uniqueSlug("drn"),
      status: "draining",
    });
    const tenant = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("dt") }));

    await expect(stratum.migrateRegion(tenant.id, region.id)).rejects.toThrow(
      /region is not active/i,
    );
  });

  it("migrateRegion throws when the tenant or the region is unknown", async () => {
    const region = await stratum.createRegion({ display_name: "R", slug: uniqueSlug("mr") });
    const tenant = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("mrt") }));

    await expect(
      stratum.migrateRegion("00000000-0000-0000-0000-000000000000", region.id),
    ).rejects.toThrow(/tenant not found/i);
    await expect(
      stratum.migrateRegion(tenant.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/region not found/i);
  });

  it("writes an audit entry (with null tenant_id) when an AuditContext is passed", async () => {
    const actor: AuditContext = { actor_id: "ops-1", actor_type: "system" };
    const region = await stratum.createRegion(
      { display_name: "Audited", slug: uniqueSlug("aud") },
      actor,
    );

    const rows = await getPool().query<{ action: string; actor_id: string; tenant_id: string | null }>(
      `SELECT action, actor_id, tenant_id FROM audit_logs WHERE resource_type = 'region' AND resource_id = $1`,
      [region.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].action).toBe("region.created");
    expect(rows.rows[0].actor_id).toBe("ops-1");
    expect(rows.rows[0].tenant_id).toBeNull(); // regions are global, not tenant-scoped
  });
});
