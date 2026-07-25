import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  TenantSuspendedError,
  TenantArchivedError,
  InvalidTenantStateError,
  TenantHasChildrenError,
  TenantNotFoundError,
} from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * First-class tenant lifecycle against a real database (FR-58, #142):
 *
 *   create   -> active
 *   suspend  active               -> suspended   (reversible, blocks access)
 *   resume   suspended | archived -> active       (reverses suspend/archive)
 *   archive  active | suspended   -> archived     (soft delete, reversible)
 *   purge    any                  -> (row gone)   (GDPR, irreversible)
 *
 * These prove the actual Postgres behaviour: the CHECK constraint accepts the
 * new state, the guards fire, and the descendant rules hold, not just the SQL
 * text asserted by the lib unit tests.
 */
describe("Tenant lifecycle transitions (integration)", () => {
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

  const root = (slug?: string) =>
    stratum.createTenant(tenantInput({ name: "Root", slug: slug ?? uniqueSlug("root") }));
  const child = (parentId: string, slug?: string) =>
    stratum.createTenant(
      tenantInput({ name: "Child", slug: slug ?? uniqueSlug("child"), parent_id: parentId }),
    );

  // Read status/deleted_at straight from the row, bypassing getTenant's guards.
  async function statusOf(id: string): Promise<string | null> {
    const r = await getPool().query<{ status: string }>(
      `SELECT status FROM tenants WHERE id = $1`,
      [id],
    );
    return r.rows[0]?.status ?? null;
  }

  it("create yields an active tenant", async () => {
    const t = await root();
    expect(t.status).toBe("active");
  });

  it("suspend blocks access and resume restores it", async () => {
    const t = await root();

    const suspended = await stratum.suspendTenant(t.id);
    expect(suspended.status).toBe("suspended");

    // Blocked from normal access, but reachable via the includeArchived hatch.
    await expect(stratum.getTenant(t.id)).rejects.toThrow(TenantSuspendedError);
    const raw = await stratum.getTenant(t.id, true);
    expect(raw.status).toBe("suspended");

    const resumed = await stratum.resumeTenant(t.id);
    expect(resumed.status).toBe("active");
    expect((await stratum.getTenant(t.id)).status).toBe("active");
  });

  it("a suspended tenant drops out of subtree listings", async () => {
    const r = await root();
    const c = await child(r.id);

    await stratum.suspendTenant(c.id);

    expect(await stratum.getChildren(r.id)).toHaveLength(0);
    expect(await stratum.getDescendants(r.id)).toHaveLength(0);
    // ...but the full historical subtree still sees it.
    const all = await stratum.getDescendants(r.id, true);
    expect(all.map((d) => d.id)).toContain(c.id);
  });

  it("archive soft-deletes and resume restores, clearing deleted_at", async () => {
    const t = await root();

    const archived = await stratum.archiveTenant(t.id);
    expect(archived.status).toBe("archived");
    expect(archived.deleted_at).not.toBeNull();
    await expect(stratum.getTenant(t.id)).rejects.toThrow(TenantArchivedError);

    const resumed = await stratum.resumeTenant(t.id);
    expect(resumed.status).toBe("active");
    expect(resumed.deleted_at).toBeNull();
  });

  it("archive accepts a suspended tenant", async () => {
    const t = await root();
    await stratum.suspendTenant(t.id);
    const archived = await stratum.archiveTenant(t.id);
    expect(archived.status).toBe("archived");
  });

  it("rejects invalid lifecycle transitions", async () => {
    const t = await root();

    // resume an active tenant
    await expect(stratum.resumeTenant(t.id)).rejects.toThrow(InvalidTenantStateError);

    await stratum.suspendTenant(t.id);
    // suspend an already-suspended tenant
    await expect(stratum.suspendTenant(t.id)).rejects.toThrow(InvalidTenantStateError);

    await stratum.resumeTenant(t.id);
    await stratum.archiveTenant(t.id);
    // archive an already-archived tenant
    await expect(stratum.archiveTenant(t.id)).rejects.toThrow(InvalidTenantStateError);
    // suspend an archived tenant
    await expect(stratum.suspendTenant(t.id)).rejects.toThrow(InvalidTenantStateError);
  });

  // --- Descendant semantics: destructive ops block, they never cascade. ------

  it("suspend is blocked when the tenant has active children (leaf-first)", async () => {
    const r = await root();
    const c = await child(r.id);

    await expect(stratum.suspendTenant(r.id)).rejects.toThrow(TenantHasChildrenError);
    expect(await statusOf(r.id)).toBe("active"); // parent untouched, no cascade

    // Leaf-first succeeds and does not touch the ancestor's state.
    await stratum.suspendTenant(c.id);
    const suspendedRoot = await stratum.suspendTenant(r.id);
    expect(suspendedRoot.status).toBe("suspended");
    expect(await statusOf(c.id)).toBe("suspended");
  });

  it("archive is blocked when the tenant has active children", async () => {
    const r = await root();
    await child(r.id);
    await expect(stratum.archiveTenant(r.id)).rejects.toThrow(TenantHasChildrenError);
    expect(await statusOf(r.id)).toBe("active");
  });

  it("resume is top-down: cannot resume under an archived parent", async () => {
    const r = await root();
    const c = await child(r.id);

    await stratum.archiveTenant(c.id);
    await stratum.archiveTenant(r.id);

    // Child cannot come back while its parent is archived.
    await expect(stratum.resumeTenant(c.id)).rejects.toThrow(TenantArchivedError);

    // Parent first, then child.
    await stratum.resumeTenant(r.id);
    const resumedChild = await stratum.resumeTenant(c.id);
    expect(resumedChild.status).toBe("active");
  });

  it("resume is top-down: cannot resume under a suspended parent", async () => {
    const r = await root();
    const c = await child(r.id);

    await stratum.archiveTenant(c.id); // clear the parent's active children
    await stratum.suspendTenant(r.id);

    await expect(stratum.resumeTenant(c.id)).rejects.toThrow(TenantSuspendedError);
  });

  it("cannot create a child under a non-active parent", async () => {
    const r = await root();

    await stratum.suspendTenant(r.id);
    await expect(child(r.id)).rejects.toThrow(TenantSuspendedError);

    await stratum.resumeTenant(r.id);
    await stratum.archiveTenant(r.id);
    await expect(child(r.id)).rejects.toThrow(TenantArchivedError);
  });

  it("purge requires an empty subtree and is irreversible", async () => {
    const r = await root();
    const c = await child(r.id);

    // A parent with a child cannot be purged...
    await expect(stratum.purgeTenant(r.id)).rejects.toThrow(/child/i);
    // ...even once the child is archived: an archived child is still a row.
    await stratum.archiveTenant(c.id);
    await expect(stratum.purgeTenant(r.id)).rejects.toThrow(/child/i);

    // Purge leaf-first. The rows are gone, not soft-deleted.
    await stratum.purgeTenant(c.id);
    expect(await statusOf(c.id)).toBeNull();
    await stratum.purgeTenant(r.id);
    expect(await statusOf(r.id)).toBeNull();

    // Irreversible: nothing left to resume.
    await expect(stratum.resumeTenant(r.id)).rejects.toThrow(TenantNotFoundError);
  });
});
