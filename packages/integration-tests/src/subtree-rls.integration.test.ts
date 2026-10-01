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
import { runScopedJob, Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, getAdminPool } from "./helpers/db.js";
import { ROLE_PREFIX, controlRoleName } from "./helpers/role-model.js";

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

  it("follows the tree at once when moveTenant moves a tenant to another parent", async () => {
    const stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
    await stratum.moveTenant(id.b1, id.mspA);
    try {
      const seen = await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
      });
      expect(seen).toContain("b1");
    } finally {
      await stratum.moveTenant(id.b1, id.mspB);
    }
    const after = await asApp(async (c) => {
      await setTenantContext(c, id.mspA, { scope: "subtree" });
      return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
    });
    expect(after).not.toContain("b1");
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

  it("does not let a parent in subtree scope read its descendants' api_keys rows", async () => {
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      const key = await c.query<{ id: string }>(
        `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name)
         VALUES ($1, $2, 'sk_test_', 'subtree key') RETURNING id`,
        [id.a1, `sub_hash_${run}`],
      );
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);

      await setTenantContext(c, id.mspA, { scope: "subtree" });
      const asParent = await c.query("SELECT id FROM api_keys WHERE id = $1", [key.rows[0].id]);
      expect(asParent.rowCount ?? 0).toBe(0);

      // The owner still reads its own key, so the row exists and RLS hides it.
      await setTenantContext(c, id.a1);
      const asOwner = await c.query("SELECT id FROM api_keys WHERE id = $1", [key.rows[0].id]);
      expect(asOwner.rowCount ?? 0).toBe(1);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  describe("credential-bearing rows stay exact-tenant", () => {
    it("does not let a parent in subtree scope read its descendants' webhooks rows", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        const hook: Partial<Record<Label, string>> = {};
        for (const label of ["mspA", "a1"] as const) {
          const wh = await c.query<{ id: string }>(
            `INSERT INTO webhooks (tenant_id, url, secret_hash) VALUES ($1, $2, 'hash') RETURNING id`,
            [id[label], "https://example.test/hook"],
          );
          hook[label] = wh.rows[0].id;
        }
        await c.query(`SET LOCAL ROLE ${APP_ROLE}`);

        await setTenantContext(c, id.mspA, { scope: "subtree" });
        const asParent = await c.query<{ id: string }>("SELECT id FROM webhooks WHERE id = ANY($1)", [
          [hook.mspA, hook.a1],
        ]);
        expect(asParent.rows.map((r) => r.id)).toEqual([hook.mspA]);

        // The owner still reads its own webhook, so the row exists and RLS hides it.
        await setTenantContext(c, id.a1);
        const asOwner = await c.query("SELECT id FROM webhooks WHERE id = $1", [hook.a1]);
        expect(asOwner.rowCount ?? 0).toBe(1);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("does not reach a descendant's webhooks row through webhook_deliveries", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        const wh = await c.query<{ id: string }>(
          `INSERT INTO webhooks (tenant_id, url, secret_hash) VALUES ($1, $2, 'hash') RETURNING id`,
          [id.a1, "https://example.test/hook"],
        );
        const ev = await c.query<{ id: string }>(
          `INSERT INTO webhook_events (type, tenant_id) VALUES ('tenant.created', $1) RETURNING id`,
          [id.a1],
        );
        const del = await c.query<{ id: string }>(
          `INSERT INTO webhook_deliveries (webhook_id, event_id) VALUES ($1, $2) RETURNING id`,
          [wh.rows[0].id, ev.rows[0].id],
        );
        await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
        await setTenantContext(c, id.mspA, { scope: "subtree" });

        const delivery = await c.query("SELECT id FROM webhook_deliveries WHERE id = $1", [del.rows[0].id]);
        expect(delivery.rowCount ?? 0).toBe(1);
        const joined = await c.query(
          `SELECT w.id FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = $1`,
          [del.rows[0].id],
        );
        expect(joined.rowCount ?? 0).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("reads a descendant's non-sensitive config rows but not its sensitive ones in subtree scope", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        const secretKey = `sub_secret_a1_${run}`;
        await c.query(
          `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id, sensitive)
           VALUES ($1, $2, '"s"'::jsonb, $1, true)`,
          [id.a1, secretKey],
        );
        await c.query(`SET LOCAL ROLE ${APP_ROLE}`);

        await setTenantContext(c, id.mspA, { scope: "subtree" });
        const plain = await c.query("SELECT key FROM config_entries WHERE key = $1", [keyOf("a1")]);
        expect(plain.rowCount ?? 0).toBe(1);
        const sensitive = await c.query("SELECT key FROM config_entries WHERE sensitive");
        expect(sensitive.rowCount ?? 0).toBe(0);

        // The owner still reads its own sensitive row.
        await setTenantContext(c, id.a1);
        const asOwner = await c.query("SELECT key FROM config_entries WHERE key = $1", [secretKey]);
        expect(asOwner.rowCount ?? 0).toBe(1);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("still lets a parent in subtree scope read its own sensitive config rows", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        const ownKey = `sub_secret_mspa_${run}`;
        await c.query(
          `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id, sensitive)
           VALUES ($1, $2, '"s"'::jsonb, $1, true)`,
          [id.mspA, ownKey],
        );
        await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        const own = await c.query("SELECT key FROM config_entries WHERE key = $1", [ownKey]);
        expect(own.rowCount ?? 0).toBe(1);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  });

  describe("locking reads and upserts in subtree scope", () => {
    it("returns only the exact tenant's rows to SELECT FOR UPDATE and FOR SHARE", async () => {
      const seen = await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        const forUpdate = labelsOf((await c.query<{ key: string }>(`${OWN_ROWS} FOR UPDATE`)).rows);
        const forShare = labelsOf((await c.query<{ key: string }>(`${OWN_ROWS} FOR SHARE`)).rows);
        return { forUpdate, forShare };
      });
      expect(seen).toEqual({ forUpdate: ["mspA"], forShare: ["mspA"] });
    });

    it("refuses INSERT ON CONFLICT DO UPDATE on a descendant's row", async () => {
      await asApp(async (c) => {
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        await expect(
          c.query(
            `INSERT INTO config_entries (tenant_id, key, value, source_tenant_id)
             VALUES ($1, $2, '"changed"'::jsonb, $1)
             ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
            [id.a1, keyOf("a1")],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
      const res = await getPool().query<{ value: string }>(
        "SELECT value FROM config_entries WHERE key = $1",
        [keyOf("a1")],
      );
      expect(res.rows[0].value).toBe("a1");
    });
  });

  describe("tree columns change only under the bypass", () => {
    const changes: Array<[string, string, unknown]> = [
      ["ancestry_path", "ancestry_path = $2", "/"],
      ["parent_id", "parent_id = $2", null],
      ["depth", "depth = $2", 0],
      ["ancestry_ltree", "ancestry_ltree = $2::ltree", "moved"],
    ];

    for (const [column, set, value] of changes) {
      it(`refuses an update of the tenant's own ${column} from an exact tenant context`, async () => {
        await asApp(async (c) => {
          await setTenantContext(c, id.a1);
          await expect(c.query(`UPDATE tenants SET ${set} WHERE id = $1`, [id.a1, value])).rejects.toThrow(
            /tree columns/i,
          );
        });
      });
    }

    it("refuses an update of the tenant's own parent_id from a subtree context", async () => {
      await asApp(async (c) => {
        await setTenantContext(c, id.a1, { scope: "subtree" });
        await expect(
          c.query(`UPDATE tenants SET parent_id = $2 WHERE id = $1`, [id.a1, id.mspB]),
        ).rejects.toThrow(/tree columns/i);
      });
    });

    it("still lets a tenant context update its own non-tree columns", async () => {
      const count = await asApp(async (c) => {
        await setTenantContext(c, id.a1);
        return (await c.query("UPDATE tenants SET name = 'renamed' WHERE id = $1", [id.a1])).rowCount;
      });
      expect(count).toBe(1);
    });

    it("refuses a tree column update without the bypass, even for a role that skips RLS", async () => {
      // A BYPASSRLS role that is not a member of the control role (032). A
      // superuser counts as a member of every role, so it is not used here.
      const role = `${ROLE_PREFIX}subtree_bypassrls`;
      const c = await getPool().connect();
      try {
        await c.query(`DO $$ BEGIN
          CREATE ROLE "${role}" NOLOGIN NOSUPERUSER BYPASSRLS;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
        await c.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
        await c.query(`GRANT SELECT, UPDATE ON tenants TO "${role}"`);
        await c.query("BEGIN");
        await c.query(`SET LOCAL ROLE "${role}"`);
        await expect(
          c.query(`UPDATE tenants SET depth = depth + 1 WHERE id = $1`, [id.a1]),
        ).rejects.toThrow(/tree columns/i);
      } finally {
        await c.query("ROLLBACK");
        await c.query(`DROP OWNED BY "${role}"`);
        await c.query(`DROP ROLE "${role}"`);
        c.release();
      }
    });

    it("lets a member of the control role change tree columns without the bypass", async () => {
      const control = await controlRoleName(getPool());
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query(`SET LOCAL ROLE "${control}"`);
        const res = await c.query(`UPDATE tenants SET depth = depth + 1 WHERE id = $1`, [id.a1]);
        expect(res.rowCount).toBe(1);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("lets the bypass change tree columns", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL app.bypass_rls = 'on'");
        const res = await c.query(`UPDATE tenants SET depth = depth + 1 WHERE id = $1`, [id.a1]);
        expect(res.rowCount).toBe(1);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  });

  describe("name resolution in the subtree and cycle-guard functions", () => {
    it("ignores a session's temporary tenants table when it computes the subtree", async () => {
      const seen = await asApp(async (c) => {
        await c.query("CREATE TEMP TABLE tenants (id uuid, ancestry_path text) ON COMMIT DROP");
        // b1 placed under mspA in the temporary table only.
        await c.query("INSERT INTO pg_temp.tenants VALUES ($1, $2), ($3, $4)", [
          id.mspA,
          ancestry.mspA,
          id.b1,
          `${ancestry.mspA === "/" ? "" : ancestry.mspA}/${id.mspA}`,
        ]);
        await setTenantContext(c, id.mspA, { scope: "subtree" });
        return labelsOf((await c.query<{ key: string }>(OWN_ROWS)).rows);
      });
      expect(seen).toEqual(["a1", "a1x", "a2", "a3", "a4", "mspA"]);
    });

    it("ignores a session's temporary tenants table when it checks a new parent for a cycle", async () => {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query("CREATE TEMP TABLE tenants (id uuid, parent_id uuid, slug text, ancestry_ltree ltree) ON COMMIT DROP");
        await c.query("SET LOCAL app.bypass_rls = 'on'");
        await expect(
          c.query(`UPDATE public.tenants SET parent_id = $1 WHERE id = $2`, [id.a1, id.mspA]),
        ).rejects.toThrow(/own ancestor/);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  });

  it("puts a read-only subtree policy on every tenant-scoped table except api_keys and webhooks", async () => {
    const res = await getPool().query<{ tablename: string; cmd: string; permissive: string }>(
      `SELECT tablename, cmd, permissive FROM pg_policies
        WHERE schemaname = current_schema() AND policyname = 'tenant_subtree_read'
          AND tablename NOT LIKE 'sub\\_gen\\_%'
        ORDER BY tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([
      "abac_policies",
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
        evaluatePolicies: (
          rows: unknown[],
          functionSchema?: string,
          controlRole?: string,
        ) => { isolated: boolean; issue: string | null };
      };
      const control = await controlRoleName(getPool());
      for (const table of [...tables, "config_entries"]) {
        const res = await getPool().query(
          `SELECT policyname, permissive, cmd, qual, with_check, roles::text[] AS roles FROM pg_policies
            WHERE schemaname = current_schema() AND tablename = $1`,
          [table],
        );
        expect(res.rows.map((r) => r.policyname)).toContain("tenant_subtree_read");
        expect(evaluatePolicies(res.rows, undefined, control)).toEqual({ isolated: true, issue: null });
      }
    });
  });
});
