import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  createPglitePool,
  createRestrictedPool,
  type PglitePool,
} from "../pglite/index.js";
import { withTenantContext } from "../rls/session.js";

// These tests run a real PostgreSQL engine in process through PGlite.
// One instance boots in about a second, so the suite shares it.

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

describe("createPglitePool", () => {
  let pool: PglitePool;

  beforeAll(async () => {
    pool = await createPglitePool();
    await pool.query(`
      CREATE TABLE items (id serial PRIMARY KEY, tenant_id uuid NOT NULL, title text, data jsonb, n bigint);
      CREATE TABLE notes (tenant_id uuid NOT NULL, body text);
      ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE notes FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON notes FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    `);
    await pool.query(
      "INSERT INTO notes (tenant_id, body) VALUES ($1, 'a note'), ($2, 'b note')",
      [TENANT_A, TENANT_B],
    );
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  it("loads the ltree and uuid-ossp extensions", async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS ltree; CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    const { rows } = await pool.query("SELECT 'a.b.c'::ltree <@ 'a'::ltree AS inside, uuid_generate_v4() AS id");
    expect(rows[0].inside).toBe(true);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("runs a query without parameters that holds several statements", async () => {
    const res = await pool.query("SELECT 1 AS one; SELECT 2 AS two");
    expect(res.rows).toEqual([{ two: 2 }]);
  });

  it("accepts a query config object with text and values", async () => {
    const res = await pool.query({ text: "SELECT $1::text AS v", values: ["x"] });
    expect(res.rows).toEqual([{ v: "x" }]);
  });

  it("reports rowCount as pg does for INSERT, SELECT and UPDATE", async () => {
    const ins = await pool.query(
      "INSERT INTO items (tenant_id, title) VALUES ($1, 'one'), ($1, 'two')",
      [TENANT_A],
    );
    expect(ins.rowCount).toBe(2);
    const sel = await pool.query("SELECT * FROM items WHERE tenant_id = $1", [TENANT_A]);
    expect(sel.rowCount).toBe(2);
    const upd = await pool.query("UPDATE items SET title = $1 WHERE title = 'one'", ["uno"]);
    expect(upd.rowCount).toBe(1);
  });

  it("serializes a plain object parameter as JSON, as pg does", async () => {
    const res = await pool.query(
      "INSERT INTO items (tenant_id, data, title) VALUES ($1, $2, $3) RETURNING data, title",
      [TENANT_A, { level: 1 }, { as: "text" }],
    );
    expect(res.rows[0].data).toEqual({ level: 1 });
    expect(res.rows[0].title).toBe('{"as":"text"}');
  });

  it("returns int8 and numeric values as strings, as pg does", async () => {
    const res = await pool.query("SELECT 9007199254740993::bigint AS big, count(*) AS c, 1.50::numeric AS num");
    expect(res.rows[0]).toEqual({ big: "9007199254740993", c: expect.any(String), num: "1.50" });
  });

  it("passes the PGlite error with its SQLSTATE code to the caller", async () => {
    await expect(pool.query("SELECT 1/0")).rejects.toMatchObject({ code: "22012" });
  });

  it("gives each checked-out client exclusive use of the connection until release", async () => {
    const order: string[] = [];
    const first = await pool.connect();
    const second = pool.connect().then((client) => {
      order.push("second acquired");
      return client;
    });
    await first.query("BEGIN");
    await first.query("INSERT INTO items (tenant_id, title) VALUES ($1, 'in tx')", [TENANT_A]);
    await new Promise((r) => setTimeout(r, 20));
    order.push("first rolls back");
    await first.query("ROLLBACK");
    first.release();
    const client = await second;
    const res = await client.query("SELECT count(*)::int AS n FROM items WHERE title = 'in tx'");
    client.release();
    expect(order).toEqual(["first rolls back", "second acquired"]);
    expect(res.rows[0].n).toBe(0);
  });

  it("rolls back an open transaction when release receives an error", async () => {
    const client = await pool.connect();
    await client.query("BEGIN");
    await client.query("INSERT INTO items (tenant_id, title) VALUES ($1, 'abandoned')", [TENANT_A]);
    client.release(new Error("connection state unknown"));
    const res = await pool.query("SELECT count(*)::int AS n FROM items WHERE title = 'abandoned'");
    expect(res.rows[0].n).toBe(0);
  });

  it("runs as a superuser by default, so row-level security does not apply", async () => {
    const res = await withTenantContext(pool, TENANT_A, (c) => c.query("SELECT body FROM notes"));
    expect(res.rows).toHaveLength(2);
  });

  describe("createRestrictedPool", () => {
    let restricted: PglitePool;

    beforeAll(async () => {
      restricted = await createRestrictedPool(pool);
    });

    it("runs each query as a role that is not a superuser and cannot bypass RLS", async () => {
      const res = await restricted.query(
        "SELECT current_user AS who, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(res.rows[0]).toEqual({ who: "stratum_app", rolsuper: false, rolbypassrls: false });
    });

    it("returns only the rows of the tenant in context", async () => {
      const res = await withTenantContext(restricted, TENANT_A, (c) => c.query("SELECT body FROM notes"));
      expect(res.rows).toEqual([{ body: "a note" }]);
    });

    it("rejects an insert for a tenant that is not in context", async () => {
      await expect(
        withTenantContext(restricted, TENANT_A, (c) =>
          c.query("INSERT INTO notes (tenant_id, body) VALUES ($1, 'cross')", [TENANT_B]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("grants access to a table created after the role", async () => {
      await pool.query("CREATE TABLE later (v int); INSERT INTO later VALUES (7)");
      const res = await restricted.query("SELECT v FROM later");
      expect(res.rows).toEqual([{ v: 7 }]);
    });

    it("returns the shared connection to the superuser after release", async () => {
      await restricted.query("SELECT 1");
      const res = await pool.query("SELECT current_user AS who");
      expect(res.rows[0].who).toBe("postgres");
    });

    it("rejects a role name that is not a plain lowercase identifier", async () => {
      await expect(createRestrictedPool(pool, { role: 'x"; DROP TABLE items; --' })).rejects.toThrow(
        /role name/,
      );
    });
  });
});

describe("createPglitePool with a caller-owned instance", () => {
  it("leaves the instance open when the pool ends", async () => {
    const db = new PGlite();
    const pool = await createPglitePool(db);
    await pool.end();
    const res = await db.query<{ one: number }>("SELECT 1 AS one");
    expect(res.rows[0].one).toBe(1);
    expect(pool.pglite).toBe(db);
    await db.close();
  }, 30_000);
});
