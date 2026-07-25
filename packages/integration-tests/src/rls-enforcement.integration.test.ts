import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { getPool, closePool, runMigrations } from "./helpers/db.js";

/**
 * Proves that migration 019 makes tenant isolation real: Postgres row-level
 * security, not just an application WHERE clause.
 *
 * The CI / local test connection (stratum_test) is a SUPERUSER, and a SUPERUSER
 * always bypasses RLS regardless of FORCE. So every test here drops to a
 * dedicated NON-superuser, NON-BYPASSRLS role with `SET LOCAL ROLE` inside its
 * transaction. That role is subject to RLS exactly like the production
 * `stratum_app` role. Without this, these tests would silently pass without ever
 * exercising a policy.
 *
 * The role sets the tenant context the same way the shipped helpers do:
 *   context: SELECT set_config('app.current_tenant_id', $1, true)   (withTenantContext)
 *   bypass:  SELECT set_config('app.bypass_rls', 'on', true)        (withRlsBypass)
 * Both are SET LOCAL (third arg true), so they reset at COMMIT / ROLLBACK.
 */

const APP_ROLE = "stratum_rls_test";
const run = Date.now();

let tenantA: string;
let tenantB: string;
let cfgKeyA: string;
let cfgKeyB: string;
let deliveryB: string;

async function seed(): Promise<void> {
  const pool = getPool();
  const c = await pool.connect();
  try {
    // Seed as the superuser (RLS bypassed), so inserts for both tenants succeed
    // regardless of context.
    const a = await c.query(
      `INSERT INTO tenants (name, slug, ancestry_path) VALUES ($1, $2, $2) RETURNING id`,
      [`RLS A ${run}`, `rls_a_${run}`],
    );
    const b = await c.query(
      `INSERT INTO tenants (name, slug, ancestry_path) VALUES ($1, $2, $2) RETURNING id`,
      [`RLS B ${run}`, `rls_b_${run}`],
    );
    tenantA = a.rows[0].id;
    tenantB = b.rows[0].id;

    cfgKeyA = `rls_key_a_${run}`;
    cfgKeyB = `rls_key_b_${run}`;
    await c.query(
      `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
       VALUES ($1, $2, $3::jsonb, $1)`,
      [tenantA, cfgKeyA, JSON.stringify("value-A")],
    );
    await c.query(
      `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
       VALUES ($1, $2, $3::jsonb, $1)`,
      [tenantB, cfgKeyB, JSON.stringify("value-B")],
    );

    // Webhook chain for tenant B, to exercise the indirect policy on
    // webhook_deliveries (no tenant_id; scoped through webhook_events).
    const wh = await c.query(
      `INSERT INTO webhooks (tenant_id, url, secret_hash) VALUES ($1, $2, $3) RETURNING id`,
      [tenantB, "https://example.test/hook", "hash"],
    );
    const ev = await c.query(
      `INSERT INTO webhook_events (type, tenant_id) VALUES ($1, $2) RETURNING id`,
      ["tenant.created", tenantB],
    );
    const del = await c.query(
      `INSERT INTO webhook_deliveries (webhook_id, event_id) VALUES ($1, $2) RETURNING id`,
      [wh.rows[0].id, ev.rows[0].id],
    );
    deliveryB = del.rows[0].id;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  await runMigrations();

  const pool = getPool();
  const c = await pool.connect();
  try {
    // A non-superuser, non-BYPASSRLS role is the whole point: it is subject to RLS.
    await c.query(`DO $$ BEGIN
      CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await c.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
  } finally {
    c.release();
  }

  await seed();
}, 30000);

afterAll(async () => {
  const pool = getPool();
  const c = await pool.connect();
  try {
    // Clean up seeded rows (as superuser). FK order: children first.
    await c.query(`DELETE FROM webhook_deliveries WHERE id = $1`, [deliveryB]).catch(() => {});
    await c.query(`DELETE FROM webhook_events WHERE tenant_id = ANY($1)`, [[tenantA, tenantB]]).catch(() => {});
    await c.query(`DELETE FROM webhooks WHERE tenant_id = ANY($1)`, [[tenantA, tenantB]]).catch(() => {});
    await c.query(`DELETE FROM config_entries WHERE tenant_id = ANY($1)`, [[tenantA, tenantB]]).catch(() => {});
    await c.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantA, tenantB]]).catch(() => {});
  } finally {
    c.release();
  }
  await closePool();
});

describe("Postgres RLS enforcement (SHARED_RLS)", () => {
  it("hides another tenant's rows even with no app-layer filter", async () => {
    const pool = getPool();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);

      // Deliberately NO WHERE tenant_id filter. RLS must scope this to tenant A.
      const res = await c.query<{ tenant_id: string }>("SELECT tenant_id FROM config_entries");
      const tenants = new Set(res.rows.map((r) => r.tenant_id));

      expect(tenants.has(tenantB)).toBe(false); // tenant B invisible
      for (const t of tenants) expect(t).toBe(tenantA); // only tenant A visible

      // And a direct lookup of B's row by key returns nothing.
      const b = await c.query("SELECT * FROM config_entries WHERE key = $1", [cfgKeyB]);
      expect(b.rowCount ?? 0).toBe(0);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("rejects a write that targets another tenant", async () => {
    const pool = getPool();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);

      // INSERT a row stamped for tenant B while context is A -> WITH CHECK denies.
      await expect(
        c.query(
          `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
           VALUES ($1, $2, $3::jsonb, $1)`,
          [tenantB, `evil_${run}`, JSON.stringify("x")],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("does not leak tenant context across a reused pooled connection", async () => {
    const pool = getPool();
    const c = await pool.connect(); // one physical connection, two logical requests
    try {
      // Request 1: context = A
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r1 = await c.query<{ tenant_id: string }>("SELECT tenant_id FROM config_entries");
      expect(r1.rows.every((r) => r.tenant_id === tenantA)).toBe(true);
      expect(r1.rows.length).toBeGreaterThan(0);
      await c.query("COMMIT"); // SET LOCAL role + context reset here

      // Request 2 on the SAME connection: context = B. Must see only B, never A.
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      // Prove request 1's context did not survive the COMMIT.
      const leaked = await c.query<{ v: string | null }>(
        "SELECT current_setting('app.current_tenant_id', true) AS v",
      );
      expect(leaked.rows[0].v === null || leaked.rows[0].v === "").toBe(true);

      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      const r2 = await c.query<{ tenant_id: string }>("SELECT tenant_id FROM config_entries");
      const seen = new Set(r2.rows.map((r) => r.tenant_id));
      expect(seen.has(tenantA)).toBe(false); // no bleed from request 1
      expect(seen.has(tenantB)).toBe(true);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
  });

  it("returns zero rows and blocks writes when no context is set (fail closed)", async () => {
    const pool = getPool();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      // No set_config at all.
      const res = await c.query("SELECT * FROM config_entries");
      expect(res.rowCount ?? 0).toBe(0);

      await expect(
        c.query(
          `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
           VALUES ($1, $2, $3::jsonb, $1)`,
          [tenantA, `nocontext_${run}`, JSON.stringify("x")],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("crosses the boundary only via the bypass flag (withRlsBypass path)", async () => {
    const pool = getPool();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      // Same SQL withRlsBypass issues. As a non-superuser role this is the ONLY
      // in-band way to see across tenants.
      await c.query("SELECT set_config('app.bypass_rls', 'on', true)");
      const res = await c.query<{ tenant_id: string }>("SELECT tenant_id FROM config_entries");
      const seen = new Set(res.rows.map((r) => r.tenant_id));
      expect(seen.has(tenantA)).toBe(true);
      expect(seen.has(tenantB)).toBe(true); // cross-tenant visibility under bypass
      await c.query("COMMIT");

      // Sanity: without bypass and without context, the same role sees nothing.
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      const none = await c.query("SELECT * FROM config_entries");
      expect(none.rowCount ?? 0).toBe(0);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
  });

  it("scopes the tenants registry to the current tenant (self-scope)", async () => {
    const pool = getPool();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query<{ id: string }>("SELECT id FROM tenants");
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(tenantA);
      expect(ids).not.toContain(tenantB);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("scopes webhook_deliveries through its tenant-bearing parent event", async () => {
    const pool = getPool();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      // Context A: B's delivery (via B's event) must be invisible.
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const asA = await c.query("SELECT id FROM webhook_deliveries WHERE id = $1", [deliveryB]);
      expect(asA.rowCount ?? 0).toBe(0);

      // Context B: B's own delivery is visible.
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      const asB = await c.query("SELECT id FROM webhook_deliveries WHERE id = $1", [deliveryB]);
      expect(asB.rowCount ?? 0).toBe(1);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
