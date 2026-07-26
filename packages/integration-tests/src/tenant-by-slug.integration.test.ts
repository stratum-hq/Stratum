import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  TenantNotFoundError,
  TenantArchivedError,
  TenantSuspendedError,
} from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

describe("getTenantBySlug (integration)", () => {
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

  it("resolves an existing slug to the right tenant", async () => {
    const slug = uniqueSlug("acme");
    const created = await stratum.createTenant({ name: "Acme Corp", slug });

    const found = await stratum.getTenantBySlug(slug);

    expect(found.id).toBe(created.id);
    expect(found.slug).toBe(slug);
    expect(found.name).toBe("Acme Corp");
  });

  it("resolves the correct tenant when several exist", async () => {
    const slugA = uniqueSlug("a");
    const slugB = uniqueSlug("b");
    const a = await stratum.createTenant({ name: "A", slug: slugA });
    await stratum.createTenant({ name: "B", slug: slugB });

    const found = await stratum.getTenantBySlug(slugA);
    expect(found.id).toBe(a.id);
    expect(found.slug).toBe(slugA);
  });

  it("throws TenantNotFoundError for an unknown slug", async () => {
    await expect(
      stratum.getTenantBySlug(uniqueSlug("missing")),
    ).rejects.toThrow(TenantNotFoundError);
  });

  it("throws TenantArchivedError for an archived slug by default, like getTenant", async () => {
    const slug = uniqueSlug("arch");
    const t = await stratum.createTenant({ name: "Archived", slug });
    await stratum.archiveTenant(t.id);

    await expect(stratum.getTenantBySlug(slug)).rejects.toThrow(
      TenantArchivedError,
    );
    // getTenant behaves the same way for the same tenant.
    await expect(stratum.getTenant(t.id)).rejects.toThrow(TenantArchivedError);
  });

  it("returns an archived tenant when includeArchived is true, like getTenant", async () => {
    const slug = uniqueSlug("arch2");
    const t = await stratum.createTenant({ name: "Archived", slug });
    await stratum.archiveTenant(t.id);

    const found = await stratum.getTenantBySlug(slug, true);
    expect(found.id).toBe(t.id);
    expect(found.status).toBe("archived");
  });

  it("throws TenantSuspendedError for a suspended slug by default, like getTenant", async () => {
    const slug = uniqueSlug("susp");
    const t = await stratum.createTenant({ name: "Suspended", slug });
    await stratum.suspendTenant(t.id);

    await expect(stratum.getTenantBySlug(slug)).rejects.toThrow(
      TenantSuspendedError,
    );
    await expect(stratum.getTenant(t.id)).rejects.toThrow(TenantSuspendedError);
  });

  it("returns a suspended tenant when includeArchived is true, like getTenant", async () => {
    const slug = uniqueSlug("susp2");
    const t = await stratum.createTenant({ name: "Suspended", slug });
    await stratum.suspendTenant(t.id);

    const found = await stratum.getTenantBySlug(slug, true);
    expect(found.id).toBe(t.id);
    expect(found.status).toBe("suspended");
  });
});
