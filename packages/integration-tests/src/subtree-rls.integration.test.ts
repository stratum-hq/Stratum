import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createIsolationPolicy,
  createPolicy,
  enableRLS,
  setTenantContext,
  withTenantContext,
} from "@stratum-hq/db-adapters";
import { runScopedJob } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations } from "./helpers/db.js";

/**
 * Proves the opt-in subtree read scope of migration 031 against real
 * PostgreSQL row-level security.
 *
 * The test connection is a SUPERUSER, and RLS never applies to a superuser.
 * Every check therefore runs as a NOSUPERUSER NOBYPASSRLS role, set with
 * `SET LOCAL ROLE` or with a pool that starts each session as that role.
 *
 * The tree is the MSSP example from the guide:
 *
 *   mssp
 *   ├── mspA
 *   │   ├── a1 (active)
 *   │   │   └── a1x (active)
 *   │   ├── a2 (suspended)
 *   │   ├── a3 (archived)
 *   │   └── a4 (pending)
 *   └── mspB
 *       └── b1 (active)
 *
 * Each tenant owns one config_entries row, with a key that names the tenant.
 */

const APP_ROLE = "stratum_subtree_test";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_POLICY_CHECK = pathToFileURL(
  path.resolve(__dirname, "../../cli/dist/utils/policy-check.js"),
).href;
const run = Date.now();

type Label = "mssp" | "mspA" | "a1" | "a1x" | "a2" | "a3" | "a4" | "mspB" | "b1";

const tree: Array<{ label: Label; parent: Label | null; status: string }> = [
  { label: "mssp", parent: null, status: "active" },
  { label: "mspA", parent: "mssp", status: "active" },
  { label: "a1", parent: "mspA", status: "active" },
  { label: "a1x", parent: "a1", status: "active" },
  { label: "a2", parent: "mspA", status: "suspended" },
  { label: "a3", parent: "mspA", status: "archived" },
  { label: "a4", parent: "mspA", status: "pending" },
  { label: "mspB", parent: "mssp", status: "active" },
  { label: "b1", parent: "mspB", status: "active" },
];

const id = {} as Record<Label, string>;
const ancestry = {} as Record<Label, string>;
let rolePool: pg.Pool;

function keyOf(label: Label): string {
  return `sub_${label.toLowerCase()}_${run}`;
}

/** The labels whose config rows the query returns, sorted. */
function labelsOf(rows: Array<{ key: string }>): string[] {
  const byKey = new Map(tree.map((t) => [keyOf(t.label), t.label]));
  return rows
    .map((r) => byKey.get(r.key))
    .filter((l): l is Label => l !== undefined)
    .sort();
}

const OWN_ROWS = `SELECT key FROM config_entries WHERE key LIKE '%\\_${run}'`;

/** Runs `fn` in a rolled-back transaction as the RLS-bound role. */
async function asApp<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

beforeAll(async () => {
  await runMigrations();
  const c = await getPool().connect();
  try {
    await c.query(`DO $$ BEGIN
      CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);

    // Seeded as the superuser, so RLS does not apply to the setup.
    for (const t of tree) {
      id[t.label] = randomUUID();
      ancestry[t.label] =
        t.parent === null ? "/" : `${ancestry[t.parent] === "/" ? "" : ancestry[t.parent]}/${id[t.parent]}`;
      await c.query(
        `INSERT INTO tenants (id, parent_id, name, slug, ancestry_path, depth, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id[t.label],
          t.parent === null ? null : id[t.parent],
          `Subtree ${t.label} ${run}`,
          `sub_${t.label.toLowerCase()}_${run}`,
          ancestry[t.label],
          ancestry[t.label] === "/" ? 0 : ancestry[t.label].split("/").length - 1,
          t.status,
        ],
      );
      await c.query(
        `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
         VALUES ($1, $2, $3::jsonb, $1)`,
        [id[t.label], keyOf(t.label), JSON.stringify(t.label)],
      );
    }
  } finally {
    c.release();
  }

  const u = new URL(process.env.DATABASE_URL || "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test");
  rolePool = new pg.Pool({ connectionString: u.toString(), max: 2, options: `-c role=${APP_ROLE}` });
}, 30000);

afterAll(async () => {
  await rolePool?.end();
  const c = await getPool().connect();
  try {
    const ids = Object.values(id);
    await c.query(`DELETE FROM webhook_deliveries WHERE event_id IN (SELECT id FROM webhook_events WHERE tenant_id = ANY($1))`, [ids]).catch(() => {});
    await c.query(`DELETE FROM webhook_events WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
    await c.query(`DELETE FROM webhooks WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
    await c.query(`DELETE FROM config_entries WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
    // Children first: parent_id is ON DELETE RESTRICT.
    for (const t of [...tree].reverse()) {
      await c.query(`DELETE FROM tenants WHERE id = $1`, [id[t.label]]).catch(() => {});
    }
  } finally {
    c.release();
  }
  await closePool();
});

describe("subtree read scope (migration 031)", () => {
  it("lets a parent in subtree scope read its own rows and every descendant's rows", async () => {
    const seen = await asApp(async (c) => {
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).toEqual(["a1", "a1x", "a2", "a3", "a4", "mspA"]);
  });

  it("hides sibling and ancestor rows from a parent in subtree scope", async () => {
    const seen = await asApp(async (c) => {
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).not.toContain("mssp");
    expect(seen).not.toContain("mspB");
    expect(seen).not.toContain("b1");
  });

  it("does not let a child in subtree scope read its parent's rows", async () => {
    const seen = await asApp(async (c) => {
      await setTenantContext(c, id.a1, { scope: "subtree" });
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).toEqual(["a1", "a1x"]);
  });

  it("keeps the default scope to the exact tenant", async () => {
    const seen = await asApp(async (c) => {
      await setTenantContext(c, id.mspA);
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).toEqual(["mspA"]);
  });

  it("keeps the explicit exact scope to the exact tenant", async () => {
    const seen = await asApp(async (c) => {
      await setTenantContext(c, id.mspA, { scope: "exact" });
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).toEqual(["mspA"]);
  });

  it("ignores a scope setting that is not exactly 'subtree'", async () => {
    const seen = await asApp(async (c) => {
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [id.mspA]);
      await c.query("SELECT set_config('app.tenant_scope', 'SUBTREE', true)");
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).toEqual(["mspA"]);
  });

  it("returns no rows in subtree scope when no tenant is set", async () => {
    const count = await asApp(async (c) => {
      await c.query("SELECT set_config('app.tenant_scope', 'subtree', true)");
      return (await c.query("SELECT 1 FROM config_entries")).rowCount ?? 0;
    });
    expect(count).toBe(0);
  });

  it("returns to the exact scope when the context is set again in the same transaction", async () => {
    const seen = await asApp(async (c) => {
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      await setTenantContext(c, id.mspA);
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).toEqual(["mspA"]);
  });

  it("does not carry the subtree scope past COMMIT on a pooled connection", async () => {
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      await c.query("COMMIT");
      const after = await c.query<{ v: string | null }>(
        "SELECT current_setting('app.tenant_scope', true) AS v",
      );
      expect(after.rows[0].v === null || after.rows[0].v === "").toBe(true);
    } finally {
      c.release();
    }
  });

  it("reads the subtree through withTenantContext with the subtree scope", async () => {
    const seen = await withTenantContext(
      rolePool,
      id.mspA,
      async (c) => labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows),
      { scope: "subtree" },
    );
    expect(seen).toEqual(["a1", "a1x", "a2", "a3", "a4", "mspA"]);
    const exact = await withTenantContext(rolePool, id.mspA, async (c) =>
      labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows),
    );
    expect(exact).toEqual(["mspA"]);
  });

  it("reads the subtree in a job that runScopedJob runs with the subtree scope", async () => {
    const seen = await runScopedJob(
      rolePool,
      id.mspA,
      async (c) => labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows),
      { scope: "subtree" },
    );
    expect(seen).toEqual(["a1", "a1x", "a2", "a3", "a4", "mspA"]);
  });

  it("follows the tree when a tenant moves to another parent", async () => {
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      // Move b1 under mspA, as the superuser, inside a transaction that rolls back.
      await c.query(`UPDATE tenants SET parent_id = $1, ancestry_path = $2 WHERE id = $3`, [
        id.mspA,
        `${ancestry.mspA === "/" ? "" : ancestry.mspA}/${id.mspA}`,
        id.b1,
      ]);
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      const seen = labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
      expect(seen).toContain("b1");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  describe("writes stay limited to the exact tenant", () => {
    it("rejects an insert for a descendant", async () => {
      await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        await expect(
          c.query(
            `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
             VALUES ($1, $2, '"x"'::jsonb, $1)`,
            [id.a1, `sub_ins_${run}`],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("accepts an insert for the exact tenant", async () => {
      const count = await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        const res = await c.query(
          `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
           VALUES ($1, $2, '"x"'::jsonb, $1) RETURNING id`,
          [id.mspA, `sub_own_${run}`],
        );
        return res.rowCount;
      });
      expect(count).toBe(1);
    });

    it("updates no descendant row", async () => {
      const count = await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        const res = await c.query(`UPDATE config_entries SET value = '"changed"'::jsonb WHERE key = $1`, [
          keyOf("a1"),
        ]);
        return res.rowCount;
      });
      expect(count).toBe(0);
    });

    it("deletes no descendant row", async () => {
      const count = await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        const res = await c.query(`DELETE FROM config_entries WHERE key = $1`, [keyOf("a1")]);
        return res.rowCount;
      });
      expect(count).toBe(0);
    });

    it("rejects an update that moves the tenant's own row to a descendant", async () => {
      await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        await expect(
          c.query(`UPDATE config_entries SET tenant_id = $1 WHERE key = $2`, [id.a1, keyOf("mspA")]),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  it("leaves the bypass unchanged in subtree scope", async () => {
    const seen = await asApp(async (c) => {
      await c.query("SELECT set_config('app.bypass_rls', 'on', true)");
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(seen).toEqual(tree.map((t) => t.label).sort());
  });

  it("lets a parent in subtree scope read its descendants' registry rows", async () => {
    const ids = await asApp(async (c) => {
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      return (await c.query<{ id: string }>("SELECT id FROM tenants")).rows.map((r) => r.id);
    });
    expect(new Set(ids)).toEqual(new Set([id.mspA, id.a1, id.a1x, id.a2, id.a3, id.a4]));
  });

  it("does not let a subtree scope update a descendant's registry row", async () => {
    const count = await asApp(async (c) => {
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      return (await c.query("UPDATE tenants SET name = 'renamed' WHERE id = $1", [id.a1])).rowCount;
    });
    expect(count).toBe(0);
  });

  it("scopes webhook_deliveries through the parent event in subtree scope", async () => {
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      const delivery: Partial<Record<Label, string>> = {};
      const event: Partial<Record<Label, string>> = {};
      for (const label of ["a1", "b1"] as const) {
        const wh = await c.query(
          `INSERT INTO webhooks (tenant_id, url, secret_hash) VALUES ($1, $2, 'hash') RETURNING id`,
          [id[label], "https://example.test/hook"],
        );
        const ev = await c.query(
          `INSERT INTO webhook_events (type, tenant_id) VALUES ('tenant.created', $1) RETURNING id`,
          [id[label]],
        );
        event[label] = ev.rows[0].id;
        const del = await c.query(
          `INSERT INTO webhook_deliveries (webhook_id, event_id) VALUES ($1, $2) RETURNING id`,
          [wh.rows[0].id, ev.rows[0].id],
        );
        delivery[label] = del.rows[0].id;
      }
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      const visible = await c.query<{ id: string }>(
        "SELECT id FROM webhook_deliveries WHERE id = ANY($1)",
        [[delivery.a1, delivery.b1]],
      );
      expect(visible.rows.map((r) => r.id)).toEqual([delivery.a1]);

      // A delivery for a descendant's event is a write outside the exact tenant.
      const whA = await c.query(
        `INSERT INTO webhooks (tenant_id, url, secret_hash) VALUES ($1, $2, 'hash') RETURNING id`,
        [id.mspA, "https://example.test/hook"],
      );
      await expect(
        c.query(`INSERT INTO webhook_deliveries (webhook_id, event_id) VALUES ($1, $2)`, [
          whA.rows[0].id,
          event.a1,
        ]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("puts a read-only subtree policy on every tenant-scoped table", async () => {
    const res = await getPool().query<{ tablename: string; cmd: string; permissive: string }>(
      `SELECT tablename, cmd, permissive FROM pg_policies
        WHERE schemaname = current_schema() AND policyname = 'tenant_subtree_read'
          AND tablename NOT LIKE 'sub\\_gen\\_%'
        ORDER BY tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([
      "abac_policies",
      "api_keys",
      "audit_logs",
      "config_entries",
      "consent_records",
      "permission_policies",
      "principal_roles",
      "roles",
      "tenants",
      "usage_events",
      "webhook_deliveries",
      "webhook_events",
      "webhooks",
    ]);
    for (const r of res.rows) {
      expect(r.cmd).toBe("SELECT");
      expect(r.permissive).toBe("PERMISSIVE");
    }
  });

  describe("db-adapters generators with the subtree read", () => {
    const tables = ["sub_gen_orders", "sub_gen_invoices"] as const;

    beforeAll(async () => {
      const c = await getPool().connect();
      try {
        for (const table of tables) {
          await c.query(`DROP TABLE IF EXISTS ${table}`);
          await c.query(`CREATE TABLE ${table} (id SERIAL PRIMARY KEY, tenant_id UUID NOT NULL, label TEXT NOT NULL)`);
        }
        await enableRLS(c, tables[0]);
        await createPolicy(c, tables[0], { subtreeRead: true });
        await enableRLS(c, tables[1]);
        await createIsolationPolicy(c, tables[1], { subtreeRead: true });
        for (const table of tables) {
          await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${APP_ROLE}`);
          await c.query(`GRANT USAGE ON SEQUENCE ${table}_id_seq TO ${APP_ROLE}`);
          for (const label of ["mssp", "mspA", "a1", "mspB"] as const) {
            await c.query(`INSERT INTO ${table} (tenant_id, label) VALUES ($1, $2)`, [id[label], label]);
          }
        }
      } finally {
        c.release();
      }
    });

    afterAll(async () => {
      for (const table of tables) await getPool().query(`DROP TABLE IF EXISTS ${table}`);
    });

    for (const table of tables) {
      it(`${table}: reads the subtree in subtree scope and the exact tenant by default`, async () => {
        const read = (scope?: "subtree") =>
          asApp(async (c) => {
            await setTenantContext(c, id.mspA, scope ? { scope } : {});
            const res = await c.query<{ label: string }>(`SELECT label FROM ${table} ORDER BY label`);
            return res.rows.map((r) => r.label);
          });
        expect(await read("subtree")).toEqual(["a1", "mspA"]);
        expect(await read()).toEqual(["mspA"]);
      });

      it(`${table}: keeps writes to the exact tenant in subtree scope`, async () => {
        await asApp(async (c) => {
          await setTenantContext(c, id.mspA, { scope: "subtree" });
          await expect(
            c.query(`INSERT INTO ${table} (tenant_id, label) VALUES ($1, 'x')`, [id.a1]),
          ).rejects.toThrow(/row-level security/i);
        });
        const changed = await asApp(async (c) => {
          await setTenantContext(c, id.mspA, { scope: "subtree" });
          const u = await c.query(`UPDATE ${table} SET label = 'changed' WHERE tenant_id = $1`, [id.a1]);
          const d = await c.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id.a1]);
          return (u.rowCount ?? 0) + (d.rowCount ?? 0);
        });
        expect(changed).toBe(0);
      });
    }

    it("accepts the generated policies when createPolicy runs again", async () => {
      const c = await getPool().connect();
      try {
        for (const table of tables) {
          await createPolicy(c, table, { subtreeRead: true });
          await createPolicy(c, table);
        }
      } finally {
        c.release();
      }
    });

    it("counts the tables with the subtree read as isolated in the CLI policy check", async () => {
      const { evaluatePolicies } = (await import(CLI_POLICY_CHECK)) as {
        evaluatePolicies: (rows: unknown[]) => { isolated: boolean; issue: string | null };
      };
      for (const table of [...tables, "config_entries"]) {
        const res = await getPool().query(
          `SELECT policyname, permissive, cmd, qual, with_check FROM pg_policies
            WHERE schemaname = current_schema() AND tablename = $1`,
          [table],
        );
        expect(res.rows.map((r) => r.policyname)).toContain("tenant_subtree_read");
        expect(evaluatePolicies(res.rows)).toEqual({ isolated: true, issue: null });
      }
    });
  });
});
