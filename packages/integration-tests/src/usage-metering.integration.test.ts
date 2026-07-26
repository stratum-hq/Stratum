import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Usage metering (FR-58) against real Postgres: record + aggregate, per-tenant
 * isolation, half-open window boundaries, idempotency, and the migration-020
 * RLS policy as a second, database-level isolation layer.
 */
describe("usage metering against real Postgres (integration)", () => {
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

  it("records events and aggregates the sum + count per metric", async () => {
    const t = await stratum.createTenant({
      name: "Rec",
      slug: uniqueSlug("um"),
    });

    await stratum.recordUsage(t.id, { metric: "api.calls", quantity: 3 });
    await stratum.recordUsage(t.id, { metric: "api.calls", quantity: 2 });
    await stratum.recordUsage(t.id, { metric: "seats" }); // quantity defaults to 1

    const all = await stratum.aggregateUsage({ tenant_id: t.id });
    expect(all).toEqual([
      { metric: "api.calls", total: 5, event_count: 2 },
      { metric: "seats", total: 1, event_count: 1 },
    ]);

    const oneMetric = await stratum.aggregateUsage({
      tenant_id: t.id,
      metric: "api.calls",
    });
    expect(oneMetric).toEqual([
      { metric: "api.calls", total: 5, event_count: 2 },
    ]);
  });

  it("never counts another tenant's events in an aggregate", async () => {
    const a = await stratum.createTenant({
      name: "A",
      slug: uniqueSlug("uma"),
    });
    const b = await stratum.createTenant({
      name: "B",
      slug: uniqueSlug("umb"),
    });

    await stratum.recordUsage(a.id, { metric: "api.calls", quantity: 10 });
    await stratum.recordUsage(b.id, { metric: "api.calls", quantity: 99 });

    const forA = await stratum.aggregateUsage({
      tenant_id: a.id,
      metric: "api.calls",
    });
    expect(forA).toEqual([{ metric: "api.calls", total: 10, event_count: 1 }]);

    const forB = await stratum.aggregateUsage({
      tenant_id: b.id,
      metric: "api.calls",
    });
    expect(forB).toEqual([{ metric: "api.calls", total: 99, event_count: 1 }]);
  });

  it("treats the aggregation window as half-open [from, to) on occurred_at", async () => {
    const t = await stratum.createTenant({
      name: "Win",
      slug: uniqueSlug("umw"),
    });

    // Three events at distinct instants.
    await stratum.recordUsage(t.id, {
      metric: "api.calls",
      quantity: 1,
      occurred_at: "2026-07-01T00:00:00.000Z",
    });
    await stratum.recordUsage(t.id, {
      metric: "api.calls",
      quantity: 1,
      occurred_at: "2026-07-15T12:00:00.000Z",
    });
    await stratum.recordUsage(t.id, {
      metric: "api.calls",
      quantity: 1,
      occurred_at: "2026-08-01T00:00:00.000Z",
    });

    // Window [Jul 1, Aug 1): includes the Jul 1 boundary (inclusive from) and
    // the mid-July event, excludes the Aug 1 boundary (exclusive to).
    const july = await stratum.aggregateUsage({
      tenant_id: t.id,
      metric: "api.calls",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    });
    expect(july).toEqual([{ metric: "api.calls", total: 2, event_count: 2 }]);

    // The next window [Aug 1, Sep 1) picks up exactly the boundary event, so
    // adjacent windows never double count.
    const august = await stratum.aggregateUsage({
      tenant_id: t.id,
      metric: "api.calls",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    });
    expect(august).toEqual([{ metric: "api.calls", total: 1, event_count: 1 }]);
  });

  it("is idempotent per (tenant, metric) on idempotency_key", async () => {
    const t = await stratum.createTenant({
      name: "Idem",
      slug: uniqueSlug("umi"),
    });

    const first = await stratum.recordUsage(t.id, {
      metric: "api.calls",
      quantity: 4,
      idempotency_key: "req-1",
    });
    // Retry with the same key + a different quantity: no-op, returns the original.
    const retry = await stratum.recordUsage(t.id, {
      metric: "api.calls",
      quantity: 999,
      idempotency_key: "req-1",
    });

    expect(retry.id).toBe(first.id);
    expect(retry.quantity).toBe(4); // original quantity wins; the retry did not apply

    // Only one event was stored, so the aggregate counts it once.
    const agg = await stratum.aggregateUsage({
      tenant_id: t.id,
      metric: "api.calls",
    });
    expect(agg).toEqual([{ metric: "api.calls", total: 4, event_count: 1 }]);

    // The same key under a DIFFERENT metric is a distinct event (scope is per metric).
    await stratum.recordUsage(t.id, {
      metric: "other",
      quantity: 1,
      idempotency_key: "req-1",
    });
    const other = await stratum.aggregateUsage({
      tenant_id: t.id,
      metric: "other",
    });
    expect(other).toEqual([{ metric: "other", total: 1, event_count: 1 }]);
  });

  describe("migration-020 RLS (defense in depth)", () => {
    const APP_ROLE = "stratum_usage_rls_test";
    let tenantA: string;
    let tenantB: string;

    beforeAll(async () => {
      const pool = getPool();
      const c = await pool.connect();
      try {
        // A non-superuser, non-BYPASSRLS role is subject to RLS, exactly like the
        // production stratum_app role. The suite's own connection is a superuser
        // and would bypass the policy, hiding any regression.
        await c.query(`DO $$ BEGIN
          CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
        await c.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
        await c.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
        );

        const a = await c.query(
          `INSERT INTO tenants (name, slug, ancestry_path) VALUES ($1, $2, $2) RETURNING id`,
          [`URLS A`, uniqueSlug("url_a")],
        );
        const b = await c.query(
          `INSERT INTO tenants (name, slug, ancestry_path) VALUES ($1, $2, $2) RETURNING id`,
          [`URLS B`, uniqueSlug("url_b")],
        );
        tenantA = a.rows[0].id;
        tenantB = b.rows[0].id;
        await c.query(
          `INSERT INTO usage_events (tenant_id, metric, quantity) VALUES ($1, 'api.calls', 5)`,
          [tenantA],
        );
        await c.query(
          `INSERT INTO usage_events (tenant_id, metric, quantity) VALUES ($1, 'api.calls', 7)`,
          [tenantB],
        );
      } finally {
        c.release();
      }
    });

    afterAll(async () => {
      const pool = getPool();
      const c = await pool.connect();
      try {
        // usage_events cascades from tenants (ON DELETE CASCADE).
        await c
          .query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantA, tenantB]])
          .catch(() => {});
      } finally {
        c.release();
      }
    });

    it("hides another tenant's usage rows with no app-layer filter", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
        await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [
          tenantA,
        ]);

        // No WHERE tenant_id filter: RLS alone must scope this to tenant A.
        const res = await c.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM usage_events",
        );
        const tenants = new Set(res.rows.map((r) => r.tenant_id));
        expect(tenants.has(tenantB)).toBe(false);
        for (const t of tenants) expect(t).toBe(tenantA);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("rejects recording usage stamped for another tenant", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
        await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [
          tenantA,
        ]);

        // Context A, row stamped for B -> WITH CHECK denies.
        await expect(
          c.query(
            `INSERT INTO usage_events (tenant_id, metric, quantity) VALUES ($1, 'evil', 1)`,
            [tenantB],
          ),
        ).rejects.toThrow(/row-level security/i);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("returns zero rows when no tenant context is set (fail closed)", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
        // No set_config at all.
        const res = await c.query("SELECT * FROM usage_events");
        expect(res.rowCount ?? 0).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  });
});
