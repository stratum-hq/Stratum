import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import type { AuditContext } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * Audit log behaviors against real Postgres: before/after state captured as
 * JSONB, the actor_type CHECK constraint, the source_ip INET column, the
 * filtered/ordered query, and that the purge audit entry survives the very
 * purge it records (written with a null tenant_id after the tenant's rows are
 * gone).
 */
describe("audit-service against real Postgres (integration)", () => {
  let stratum: Stratum;
  const actor: AuditContext = { actor_id: "user-1", actor_type: "api_key", source_ip: "203.0.113.7" };

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

  it("captures before/after state and the source_ip on create and update", async () => {
    const slug = uniqueSlug("aud");
    const tenant = await stratum.createTenant(tenantInput({ name: "Audited", slug }), actor);

    const created = await stratum.queryAuditLogs({
      tenant_id: tenant.id,
      action: "tenant.created",
      limit: 10,
    });
    expect(created).toHaveLength(1);
    expect(created[0].before_state).toBeNull();
    expect((created[0].after_state as { slug: string }).slug).toBe(slug);
    // INET column round-trips as text with its netmask (Postgres appends /32).
    expect(created[0].source_ip).toBe("203.0.113.7/32");

    await stratum.updateTenant(tenant.id, { name: "Renamed" }, actor);
    const updated = await stratum.queryAuditLogs({
      tenant_id: tenant.id,
      action: "tenant.updated",
      limit: 10,
    });
    expect(updated).toHaveLength(1);
    expect((updated[0].after_state as { name: string }).name).toBe("Renamed");
  });

  it("rejects an invalid actor_type via the CHECK constraint", async () => {
    await expect(
      getPool().query(
        `INSERT INTO audit_logs (actor_id, actor_type, action, resource_type, metadata)
         VALUES ('a', 'not_a_valid_type', 'x', 'y', '{}')`,
      ),
    ).rejects.toThrow(/check|constraint|violates/i);
  });

  it("filters by tenant / action / actor and returns newest first", async () => {
    const a = await stratum.createTenant(tenantInput({ name: "A", slug: uniqueSlug("qa") }), {
      actor_id: "alice", actor_type: "api_key",
    });
    const b = await stratum.createTenant(tenantInput({ name: "B", slug: uniqueSlug("qb") }), {
      actor_id: "bob", actor_type: "jwt",
    });
    await stratum.setConfig(a.id, "k", { value: 1, locked: false, sensitive: false }, {
      actor_id: "alice", actor_type: "api_key",
    });

    // Scope by tenant.
    const forA = await stratum.queryAuditLogs({ tenant_id: a.id, limit: 50 });
    expect(forA.every((e) => e.tenant_id === a.id)).toBe(true);
    expect(forA.map((e) => e.action).sort()).toEqual(["config.updated", "tenant.created"]);

    // Scope by actor.
    const byBob = await stratum.queryAuditLogs({ actor_id: "bob", limit: 50 });
    expect(byBob).toHaveLength(1);
    expect(byBob[0].tenant_id).toBe(b.id);

    // Scope by action across tenants.
    const creates = await stratum.queryAuditLogs({ action: "tenant.created", limit: 50 });
    expect(creates).toHaveLength(2);
    // Newest first (created_at DESC, id DESC): the later create leads.
    expect(new Date(creates[0].created_at).getTime()).toBeGreaterThanOrEqual(
      new Date(creates[1].created_at).getTime(),
    );
  });

  it("keeps the purge audit entry after the tenant is purged (null tenant_id)", async () => {
    const tenant = await stratum.createTenant(tenantInput({ name: "Doomed", slug: uniqueSlug("pur") }), actor);
    await stratum.setConfig(tenant.id, "k", { value: 1, locked: false, sensitive: false }, actor);

    await stratum.purgeTenant(tenant.id, actor);

    // Its tenant-scoped audit rows are gone with the tenant...
    const scoped = await stratum.queryAuditLogs({ tenant_id: tenant.id, limit: 50 });
    expect(scoped).toHaveLength(0);

    // ...but the purge record itself survives, tenant_id null, pointing at the id.
    const purges = await stratum.queryAuditLogs({ action: "tenant.purged", limit: 50 });
    const mine = purges.find((e) => e.resource_id === tenant.id);
    expect(mine).toBeDefined();
    expect(mine?.tenant_id).toBeNull();
  });
});
