import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import knexFactory, { type Knex } from "knex";
import { getTestPool, cleanupTestPool } from "./setup.js";
import { MysqlSharedAdapter } from "../../adapters/shared.js";
import { MysqlTableAdapter } from "../../adapters/table.js";
import { createTenantView } from "../../views/manager.js";
import { withTenantScope, type KnexLike } from "../../integrations/knex.js";
import { createPool, type Pool } from "mysql2/promise";
import type { MysqlPoolLike } from "../../types.js";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// Database names are unique to this file so it can run alongside other suites
// against a shared server.
const SHARED_DB = "a4_stratum_shared";
const TABLE_DB = "a4_stratum_table";

let pool: Pool;
let knex: Knex;

type Row = { id: number; tenant_id: string; name: string; email: string };

function scopedKnex(tenantId: string): (table: string) => Knex.QueryBuilder {
  return withTenantScope(knex as unknown as KnexLike, tenantId) as unknown as (
    table: string,
  ) => Knex.QueryBuilder;
}

async function allRows(): Promise<Row[]> {
  const [rows] = await pool.query(`SELECT * FROM \`${SHARED_DB}\`.\`users\` ORDER BY id`);
  return rows as Row[];
}

beforeAll(async () => {
  pool = await getTestPool();
  knex = knexFactory({ client: "mysql2", connection: `${MYSQL_URL}/${SHARED_DB}` });
});

afterAll(async () => {
  await pool.query(`DROP DATABASE IF EXISTS \`${SHARED_DB}\``);
  await pool.query(`DROP DATABASE IF EXISTS \`${TABLE_DB}\``);
  await knex.destroy();
  await cleanupTestPool();
});

describe("shared-table tenant filter", () => {
  beforeEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${SHARED_DB}\``);
    await pool.query(`CREATE DATABASE \`${SHARED_DB}\``);
    await pool.query(
      `CREATE TABLE \`${SHARED_DB}\`.\`users\` (
        id INT PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        email VARCHAR(255)
      )`,
    );
    await pool.query(
      `INSERT INTO \`${SHARED_DB}\`.\`users\` (id, tenant_id, name, email) VALUES
        (1, 'tenant-a', 'alice', 'alice@a.test'),
        (2, 'tenant-b', 'bob', 'bob@b.test')`,
    );
  });

  describe("Knex withTenantScope", () => {
    it("keeps the tenant filter when the caller adds orWhere", async () => {
      const rows = await scopedKnex("tenant-a")("users")
        .where("name", "like", "%nobody%")
        .orWhere("email", "like", "%@b.test");
      expect(rows).toHaveLength(0);
    });

    it("keeps the tenant filter on a cloned builder", async () => {
      const rows = await scopedKnex("tenant-a")("users").where("id", 1).clone().orWhere("id", 2);
      expect((rows as Row[]).map((r) => r.id)).toEqual([1]);
    });

    it("keeps the tenant filter when used as a subquery", async () => {
      const rows = await knex("users").whereIn(
        "id",
        scopedKnex("tenant-a")("users").select("id").where("id", 1).orWhere("id", 2),
      );
      expect((rows as Row[]).map((r) => r.id)).toEqual([1]);
    });

    it("keeps the tenant filter after clearWhere", async () => {
      const rows = await scopedKnex("tenant-a")("users").clearWhere();
      expect((rows as Row[]).map((r) => r.id)).toEqual([1]);
    });

    it("deletes only the caller's rows when the caller adds orWhere", async () => {
      await scopedKnex("tenant-a")("users").where("id", 1).orWhere("id", 2).delete();
      expect((await allRows()).map((r) => r.id)).toEqual([2]);
    });

    it("updates only the caller's rows when the caller adds orWhere", async () => {
      await scopedKnex("tenant-a")("users")
        .where("id", 1)
        .orWhere("id", 2)
        .update({ name: "changed" });
      expect((await allRows()).map((r) => r.name)).toEqual(["changed", "bob"]);
    });

    it("refuses an insert with onConflict().merge()", async () => {
      const attempts = [
        () =>
          scopedKnex("tenant-a")("users")
            .insert({ id: 2, name: "mallory", email: "m@a.test" })
            .onConflict("id")
            .merge(),
        () =>
          scopedKnex("tenant-a")("users")
            .clearWhere()
            .insert({ id: 2, name: "mallory", email: "m@a.test" })
            .onConflict("id")
            .merge(),
      ];
      for (const attempt of attempts) {
        await expect((async () => attempt())()).rejects.toThrow();
      }
      expect(await allRows()).toContainEqual({
        id: 2,
        tenant_id: "tenant-b",
        name: "bob",
        email: "bob@b.test",
      });
    });

    it("refuses upsert", async () => {
      await expect(
        (async () =>
          scopedKnex("tenant-a")("users").upsert({
            id: 2,
            tenant_id: "tenant-b",
            name: "mallory",
            email: "m@a.test",
          }))(),
      ).rejects.toThrow();
      expect((await allRows()).find((r) => r.id === 2)?.name).toBe("bob");
    });

    it("refuses truncate", async () => {
      await expect(
        (async () => scopedKnex("tenant-a")("users").clearWhere().truncate())(),
      ).rejects.toThrow();
      expect(await allRows()).toHaveLength(2);
    });

    it("update cannot change tenant_id", async () => {
      await scopedKnex("tenant-a")("users").where("id", 1).update({ tenant_id: "tenant-b", name: "x" });
      await scopedKnex("tenant-a")("users").where("id", 1).update({ Tenant_Id: "tenant-b", name: "y" });
      await expect(
        (async () =>
          scopedKnex("tenant-a")("users").where("id", 1).update("tenant_id", "tenant-b"))(),
      ).rejects.toThrow();
      expect((await allRows()).find((r) => r.id === 1)?.tenant_id).toBe("tenant-a");
    });

    it("update cannot change tenant_id through a table- or schema-qualified key in any letter case", async () => {
      for (const key of ["users.tenant_id", `${SHARED_DB}.users.tenant_id`, "users.TENANT_ID", "USERS.Tenant_Id"]) {
        await scopedKnex("tenant-a")("users").where("id", 1).update({ [key]: "tenant-b", name: key });
        await expect(
          (async () => scopedKnex("tenant-a")("users").where("id", 1).update(key, "tenant-b"))(),
        ).rejects.toThrow(/cannot change tenant_id/);
        await expect(
          (async () => scopedKnex("tenant-a")("users").where("id", 1).increment(key, 1))(),
        ).rejects.toThrow(/cannot change tenant_id/);
      }
      const alice = (await allRows()).find((r) => r.id === 1);
      expect(alice?.tenant_id).toBe("tenant-a");
      expect(alice?.name).toBe("USERS.Tenant_Id");
    });

    it("insert writes the caller's tenant_id even when the data names tenant_id with a qualified or cased key", async () => {
      await scopedKnex("tenant-a")("users").insert({ id: 3, name: "c", "users.tenant_id": "tenant-b" });
      await scopedKnex("tenant-a")("users").insert([
        { id: 4, name: "d", TENANT_ID: "tenant-b" },
        { id: 5, name: "e", [`${SHARED_DB}.users.Tenant_Id`]: "tenant-b" },
      ]);
      const added = (await allRows()).filter((r) => r.id >= 3).map((r) => [r.id, r.tenant_id]);
      expect(added).toEqual([
        [3, "tenant-a"],
        [4, "tenant-a"],
        [5, "tenant-a"],
      ]);
    });
  });

  describe("MysqlSharedAdapter qualified tenant keys", () => {
    it("scopedUpdate and scopedInsert never write another tenant through a qualified or cased key", async () => {
      const adapter = new MysqlSharedAdapter({
        pool: pool as unknown as MysqlPoolLike,
        databaseName: SHARED_DB,
      });
      const attempt = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch {
          // refused
        }
      };

      for (const key of ["users.tenant_id", `${SHARED_DB}.users.tenant_id`, "TENANT_ID"]) {
        await attempt(() => adapter.scopedUpdate("tenant-a", "users", { [key]: "tenant-b", name: "x" }, { id: 1 }));
        await attempt(() => adapter.scopedInsert("tenant-a", "users", { id: 9, name: "z", [key]: "tenant-b" }));
      }

      const rows = await allRows();
      expect(rows.find((r) => r.id === 1)?.tenant_id).toBe("tenant-a");
      expect(rows.filter((r) => r.tenant_id === "tenant-b").map((r) => r.id)).toEqual([2]);
    });
  });

  describe("MysqlSharedAdapter.scopedUpdate", () => {
    it("does not move a row to another tenant through tenant_id in data", async () => {
      const adapter = new MysqlSharedAdapter({
        pool: pool as unknown as MysqlPoolLike,
        databaseName: SHARED_DB,
      });

      await adapter.scopedUpdate("tenant-a", "users", { tenant_id: "tenant-b", name: "x" }, { id: 1 });
      await adapter.scopedUpdate("tenant-a", "users", { TENANT_ID: "tenant-b", name: "y" }, { id: 1 });

      const alice = (await allRows()).find((r) => r.id === 1);
      expect(alice?.tenant_id).toBe("tenant-a");
      expect(alice?.name).toBe("y");
    });
  });
});

describe("table-per-tenant purge", () => {
  beforeEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${TABLE_DB}\``);
    await pool.query(`CREATE DATABASE \`${TABLE_DB}\``);
  });

  it("purging one tenant leaves a tenant whose slug ends with the same text untouched", async () => {
    const adapter = new MysqlTableAdapter({
      pool: pool as unknown as MysqlPoolLike,
      databaseName: TABLE_DB,
      baseTables: ["orders"],
    });

    // Tenant "acme" and tenant "corp_acme" each have an orders table.
    for (const slug of ["acme", "corp_acme"]) {
      const table = adapter.scopedTable(slug, "orders");
      await pool.query(`CREATE TABLE \`${TABLE_DB}\`.${table} (id INT PRIMARY KEY)`);
      await pool.query(`INSERT INTO \`${TABLE_DB}\`.${table} (id) VALUES (1)`);
    }

    await adapter.purgeTenantData("acme");

    const [tables] = await pool.query(`SHOW TABLES FROM \`${TABLE_DB}\``);
    const names = (tables as Array<Record<string, string>>).map((r) => Object.values(r)[0]);
    expect(names).toEqual(["orders_corp_acme"]);
  });
});

describe("createTenantView", () => {
  it("fails with an explanatory error instead of a server error", async () => {
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${SHARED_DB}\``);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${SHARED_DB}\`.\`users\` (id INT PRIMARY KEY, tenant_id VARCHAR(255))`,
    );
    const dbPool = createPool(`${MYSQL_URL}/${SHARED_DB}`);
    try {
      await expect(
        createTenantView(dbPool as unknown as MysqlPoolLike, "users"),
      ).rejects.toThrow(/not supported/i);
    } finally {
      await dbPool.end();
    }
  });
});
