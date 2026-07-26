import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import type { AuditContext } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * The app-facing audit-write API (stratum.recordAuditEvent) against real
 * Postgres: a consumer-recorded event is queryable via queryAuditLogs, its
 * before/after JSONB and INET source_ip round-trip, defaults land as expected,
 * the actor_type CHECK and INET column reject bad input, and — since the row is
 * stamped for one tenant only — a non-superuser data-plane reader under a tenant
 * context sees its own tenant's event but never another tenant's.
 */
describe("audit-write API against real Postgres (integration)", () => {
  let stratum: Stratum;
  const actor: AuditContext = { actor_id: "seed", actor_type: "system" };

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  }, 30000);

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  it("records a custom event that is queryable via queryAuditLogs, with before/after and INET source_ip", async () => {
    const tenant = await stratum.createTenant(
      tenantInput({ name: "Writer", slug: uniqueSlug("aw") }),
      actor,
    );

    const entry = await stratum.recordAuditEvent({
      tenantId: tenant.id,
      actorId: "user-1",
      actorType: "api_key",
      action: "invoice.sent",
      resourceType: "invoice",
      resourceId: "inv-9",
      before: { status: "draft" },
      after: { status: "sent" },
      metadata: { via: "tenantry" },
      sourceIp: "203.0.113.7",
    });

    expect(entry.tenant_id).toBe(tenant.id);
    expect(entry.action).toBe("invoice.sent");

    const found = await stratum.queryAuditLogs({
      tenant_id: tenant.id,
      action: "invoice.sent",
      limit: 10,
    });
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(entry.id);
    expect(found[0].actor_id).toBe("user-1");
    expect(found[0].actor_type).toBe("api_key");
    expect(found[0].resource_type).toBe("invoice");
    expect(found[0].resource_id).toBe("inv-9");
    expect((found[0].before_state as { status: string }).status).toBe("draft");
    expect((found[0].after_state as { status: string }).status).toBe("sent");
    expect((found[0].metadata as { via: string }).via).toBe("tenantry");
    // INET column round-trips as text with its netmask (Postgres appends /32).
    expect(found[0].source_ip).toBe("203.0.113.7/32");
  });

  it("applies defaults: actor_type 'system', null source_ip / before / after, empty metadata", async () => {
    const tenant = await stratum.createTenant(
      tenantInput({ name: "Defaults", slug: uniqueSlug("awd") }),
      actor,
    );

    await stratum.recordAuditEvent({
      tenantId: tenant.id,
      actorId: "svc",
      action: "thing.happened",
      resourceType: "thing",
      resourceId: null,
    });

    const [row] = await stratum.queryAuditLogs({
      tenant_id: tenant.id,
      action: "thing.happened",
      limit: 10,
    });
    expect(row.actor_type).toBe("system");
    expect(row.resource_id).toBeNull();
    expect(row.source_ip).toBeNull();
    expect(row.before_state).toBeNull();
    expect(row.after_state).toBeNull();
    expect(row.metadata).toEqual({});
  });

  it("stamps created_at from an explicit occurredAt (backdated / historical seed)", async () => {
    const tenant = await stratum.createTenant(
      tenantInput({ name: "Backdate", slug: uniqueSlug("awbd") }),
      actor,
    );

    const occurredAt = "2020-03-15T12:34:56.000Z";
    const entry = await stratum.recordAuditEvent({
      tenantId: tenant.id,
      actorId: "importer",
      action: "legacy.imported",
      resourceType: "record",
      resourceId: "old-1",
      occurredAt,
    });

    // Returned row carries the backdated stamp, not now().
    expect(new Date(entry.created_at).getTime()).toBe(
      new Date(occurredAt).getTime(),
    );

    const [row] = await stratum.queryAuditLogs({
      tenant_id: tenant.id,
      action: "legacy.imported",
      limit: 10,
    });
    expect(new Date(row.created_at).getTime()).toBe(
      new Date(occurredAt).getTime(),
    );
  });

  it("defaults created_at to ~now when occurredAt is omitted (backward compatible)", async () => {
    const tenant = await stratum.createTenant(
      tenantInput({ name: "NowDefault", slug: uniqueSlug("awn") }),
      actor,
    );

    const before = Date.now();
    const entry = await stratum.recordAuditEvent({
      tenantId: tenant.id,
      actorId: "svc",
      action: "thing.now",
      resourceType: "thing",
      resourceId: null,
    });
    const after = Date.now();

    const stamped = new Date(entry.created_at).getTime();
    // now() lands within the call window (allow small clock skew each side).
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(after + 1000);
  });

  it("rejects an invalid occurredAt before touching the database", async () => {
    const tenant = await stratum.createTenant(
      tenantInput({ name: "BadTs", slug: uniqueSlug("awt") }),
      actor,
    );

    await expect(
      stratum.recordAuditEvent({
        tenantId: tenant.id,
        actorId: "user-1",
        action: "x",
        resourceType: "y",
        resourceId: null,
        occurredAt: "not-a-timestamp",
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid source_ip via the INET column type", async () => {
    const tenant = await stratum.createTenant(
      tenantInput({ name: "BadIp", slug: uniqueSlug("awi") }),
      actor,
    );

    await expect(
      stratum.recordAuditEvent({
        tenantId: tenant.id,
        actorId: "user-1",
        action: "x",
        resourceType: "y",
        resourceId: null,
        sourceIp: "not-an-ip",
      }),
    ).rejects.toThrow(/invalid input syntax for type inet|inet/i);
  });

  it("rejects an invalid actor_type via the CHECK constraint (raw backstop)", async () => {
    await expect(
      getPool().query(
        `INSERT INTO audit_logs (actor_id, actor_type, action, resource_type, metadata)
         VALUES ('a', 'not_a_valid_type', 'x', 'y', '{}')`,
      ),
    ).rejects.toThrow(/check|constraint|violates/i);
  });

  it("stamps one tenant only: a non-superuser reader under tenant context sees its own event, never another tenant's", async () => {
    const APP_ROLE = "stratum_audit_write_rls_test";
    const pool = getPool();

    // A non-superuser, non-BYPASSRLS role is the point: it is subject to RLS,
    // exactly like the production stratum_app data-plane role. The superuser test
    // connection would bypass RLS and prove nothing.
    const setup = await pool.connect();
    try {
      await setup.query(`DO $$ BEGIN
        CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
      await setup.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
      await setup.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    } finally {
      setup.release();
    }

    const a = await stratum.createTenant(tenantInput({ name: "A", slug: uniqueSlug("awa") }), actor);
    const b = await stratum.createTenant(tenantInput({ name: "B", slug: uniqueSlug("awb") }), actor);

    // Each event is stamped for exactly the tenant it names.
    await stratum.recordAuditEvent({
      tenantId: a.id, actorId: "alice", action: "custom.a", resourceType: "note", resourceId: "na",
    });
    await stratum.recordAuditEvent({
      tenantId: b.id, actorId: "bob", action: "custom.b", resourceType: "note", resourceId: "nb",
    });

    // Read audit_logs directly as the RLS-bound role with tenant context A.
    // No app-layer WHERE tenant_id: RLS alone must scope visibility.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [a.id]);
      const asA = await c.query<{ tenant_id: string; action: string }>(
        "SELECT tenant_id, action FROM audit_logs",
      );
      const tenantsSeenByA = new Set(asA.rows.map((r) => r.tenant_id));
      expect(tenantsSeenByA.has(b.id)).toBe(false); // B invisible to A
      expect(asA.rows.some((r) => r.action === "custom.a")).toBe(true); // own event visible
      expect(asA.rows.some((r) => r.action === "custom.b")).toBe(false); // B's event hidden
      await c.query("COMMIT");

      // Symmetric under context B.
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [b.id]);
      const asB = await c.query<{ action: string }>("SELECT action FROM audit_logs");
      expect(asB.rows.some((r) => r.action === "custom.b")).toBe(true);
      expect(asB.rows.some((r) => r.action === "custom.a")).toBe(false);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
  });
});
