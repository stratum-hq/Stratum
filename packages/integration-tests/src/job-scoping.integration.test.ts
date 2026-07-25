import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runScopedJob, Stratum } from "@stratum-hq/lib";
import { getCurrentTenantId } from "@stratum-hq/db-adapters";
import { getPool, closePool, runMigrations } from "./helpers/db.js";

/**
 * Proves FR-58: a background job run through `runScopedJob` carries its tenant
 * context and cannot escape it.
 *
 * Two things are asserted throughout:
 *   - AsyncLocalStorage: `Stratum.currentTenantId()` inside the job returns the
 *     job's tenant, and is `undefined` once the job settles.
 *   - Postgres RLS: an unfiltered read inside the job returns only the job's
 *     tenant, and a direct lookup of another tenant's row returns nothing.
 *
 * The RLS half is only real against a NON-superuser, NON-BYPASSRLS role: a
 * superuser bypasses RLS regardless of FORCE, which would make every assertion
 * here vacuous (see rls-enforcement.integration.test.ts). So the pool passed to
 * `runScopedJob` authenticates AS a dedicated login role that is subject to RLS,
 * exactly as a production application pool (connected as `stratum_app`) is. The
 * whole primitive transaction runs under that role.
 */

const APP_ROLE = "stratum_job_test";
const APP_PASSWORD = "stratum_job_test";
const run = Date.now();

let tenantA: string;
let tenantB: string;
let cfgKeyA: string;
let cfgKeyB: string;

// max > 1: escape / error / concurrency tests. Connections auth as the RLS role.
let jobPool: pg.Pool;
// max = 1: forces both jobs onto ONE physical connection for the leak test.
let jobPoolSingle: pg.Pool;

function jobConnectionString(): string {
  const base =
    process.env.DATABASE_URL ||
    "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";
  const u = new URL(base);
  u.username = APP_ROLE;
  u.password = APP_PASSWORD;
  return u.toString();
}

async function seed(): Promise<void> {
  const pool = getPool();
  const c = await pool.connect();
  try {
    // Seed as the superuser (RLS bypassed) so both tenants' rows land regardless
    // of context.
    const a = await c.query(
      `INSERT INTO tenants (name, slug, ancestry_path) VALUES ($1, $2, $2) RETURNING id`,
      [`Job A ${run}`, `job_a_${run}`],
    );
    const b = await c.query(
      `INSERT INTO tenants (name, slug, ancestry_path) VALUES ($1, $2, $2) RETURNING id`,
      [`Job B ${run}`, `job_b_${run}`],
    );
    tenantA = a.rows[0].id;
    tenantB = b.rows[0].id;

    cfgKeyA = `job_key_a_${run}`;
    cfgKeyB = `job_key_b_${run}`;
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
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  await runMigrations();

  const pool = getPool();
  const c = await pool.connect();
  try {
    // A login role that is subject to RLS. NOSUPERUSER + NOBYPASSRLS is the point.
    await c.query(`DO $$ BEGIN
      CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await c.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
  } finally {
    c.release();
  }

  await seed();

  jobPool = new pg.Pool({ connectionString: jobConnectionString(), max: 4 });
  jobPoolSingle = new pg.Pool({ connectionString: jobConnectionString(), max: 1 });
}, 30000);

afterAll(async () => {
  await jobPool?.end();
  await jobPoolSingle?.end();

  const pool = getPool();
  const c = await pool.connect();
  try {
    await c
      .query(`DELETE FROM config_entries WHERE tenant_id = ANY($1)`, [[tenantA, tenantB]])
      .catch(() => {});
    await c
      .query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantA, tenantB]])
      .catch(() => {});
    // Drop privileges before the role, then the role itself.
    await c
      .query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`)
      .catch(() => {});
    await c.query(`REVOKE USAGE ON SCHEMA public FROM ${APP_ROLE}`).catch(() => {});
    await c.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => {});
  } finally {
    c.release();
  }
  await closePool();
});

describe("runScopedJob tenant scoping (FR-58)", () => {
  it("scopes a job to its tenant and blocks reading another tenant's rows", async () => {
    const result = await runScopedJob(jobPool, tenantA, async (client) => {
      // The job carries its tenant in the ALS context.
      const alsTenant = Stratum.currentTenantId();

      // Deliberately NO `WHERE tenant_id` filter: RLS must scope this to A.
      const all = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM config_entries",
      );
      // The escape attempt: read tenant B's row directly by key.
      const b = await client.query("SELECT * FROM config_entries WHERE key = $1", [cfgKeyB]);
      // Positive control: the job's own row is visible.
      const a = await client.query("SELECT * FROM config_entries WHERE key = $1", [cfgKeyA]);

      return {
        alsTenant,
        tenants: new Set(all.rows.map((r) => r.tenant_id)),
        bCount: b.rowCount ?? 0,
        aCount: a.rowCount ?? 0,
      };
    });

    expect(result.alsTenant).toBe(tenantA); // job carries tenant context
    expect(result.bCount).toBe(0); // escape blocked: B invisible
    expect(result.aCount).toBe(1); // own tenant readable
    expect(result.tenants.has(tenantB)).toBe(false);
    for (const t of result.tenants) expect(t).toBe(tenantA);

    // Context is cleared once the job settles.
    expect(Stratum.currentTenantId()).toBeUndefined();
  });

  it("does not leak tenant context onto the next job on a reused connection", async () => {
    // Job 1 on the single-connection pool: context = A.
    await runScopedJob(jobPoolSingle, tenantA, async (client) => {
      const r = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM config_entries",
      );
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.rows.every((row) => row.tenant_id === tenantA)).toBe(true);
      expect(Stratum.currentTenantId()).toBe(tenantA);
    });

    // Same physical connection (max: 1). Job 1's SET LOCAL context must be gone.
    const c = await jobPoolSingle.connect();
    try {
      expect(await getCurrentTenantId(c)).toBeNull();
    } finally {
      c.release();
    }

    // Job 2 on the reused connection: context = B. Must never see A's rows.
    await runScopedJob(jobPoolSingle, tenantB, async (client) => {
      const r = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM config_entries",
      );
      const seen = new Set(r.rows.map((row) => row.tenant_id));
      expect(seen.has(tenantA)).toBe(false); // no bleed from job 1
      expect(seen.has(tenantB)).toBe(true);
      expect(Stratum.currentTenantId()).toBe(tenantB);
    });
  });

  it("clears both context layers when the job throws", async () => {
    await expect(
      runScopedJob(jobPoolSingle, tenantA, async () => {
        expect(Stratum.currentTenantId()).toBe(tenantA);
        throw new Error("job boom");
      }),
    ).rejects.toThrow("job boom");

    // ALS context gone.
    expect(Stratum.currentTenantId()).toBeUndefined();

    // RLS context rolled back on the reused connection.
    const c = await jobPoolSingle.connect();
    try {
      expect(await getCurrentTenantId(c)).toBeNull();
    } finally {
      c.release();
    }
  });

  it("isolates two concurrent jobs from each other (async isolation)", async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const [ra, rb] = await Promise.all([
      runScopedJob(jobPool, tenantA, async (client) => {
        await delay(25); // force the two jobs to interleave
        const als = Stratum.currentTenantId();
        const rows = await client.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM config_entries",
        );
        return { als, tenants: [...new Set(rows.rows.map((r) => r.tenant_id))] };
      }),
      runScopedJob(jobPool, tenantB, async (client) => {
        await delay(10);
        const als = Stratum.currentTenantId();
        const rows = await client.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM config_entries",
        );
        return { als, tenants: [...new Set(rows.rows.map((r) => r.tenant_id))] };
      }),
    ]);

    expect(ra.als).toBe(tenantA);
    expect(ra.tenants).toEqual([tenantA]);
    expect(rb.als).toBe(tenantB);
    expect(rb.tenants).toEqual([tenantB]);
  });
});
