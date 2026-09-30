import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import knexFactory, { type Knex } from "knex";
import { DataSource, EntitySchema } from "typeorm";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import type { Pool } from "mysql2/promise";
import { getTestPool, cleanupTestPool } from "./setup.js";
import { withTenantScope, type KnexLike } from "../../integrations/knex.js";
import { registerStratumSubscriber } from "../../integrations/typeorm-subscriber.js";
import { MysqlTableAdapter } from "../../adapters/table.js";
import type { MysqlPoolLike } from "../../types.js";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// Database names are unique to this file so it can run alongside other suites
// against a shared server.
const DB = "p2_stratum_scope";
const TABLE_DB = "p2_stratum_table";

let pool: Pool;
let knex: Knex;

function scopedKnex(tenantId: string): (table: string) => Knex.QueryBuilder {
  return withTenantScope(knex as unknown as KnexLike, tenantId) as unknown as (
    table: string,
  ) => Knex.QueryBuilder;
}

async function rows<T>(sql: string): Promise<T[]> {
  const [result] = await pool.query(sql);
  return result as T[];
}

beforeAll(async () => {
  pool = (await getTestPool()) as unknown as Pool;
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\``);
  knex = knexFactory({ client: "mysql2", connection: `${MYSQL_URL}/${DB}` });
});

afterAll(async () => {
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await pool.query(`DROP DATABASE IF EXISTS \`${TABLE_DB}\``);
  await knex.destroy();
  await cleanupTestPool();
});

describe("Knex withTenantScope joins and unions", () => {
  beforeEach(async () => {
    await pool.query(`DROP TABLE IF EXISTS \`${DB}\`.\`orders\`, \`${DB}\`.\`users\``);
    await pool.query(
      `CREATE TABLE \`${DB}\`.\`users\` (
        id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, name VARCHAR(255), email VARCHAR(255)
      )`,
    );
    await pool.query(
      `CREATE TABLE \`${DB}\`.\`orders\` (
        id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, user_id INT
      )`,
    );
    await pool.query(
      `INSERT INTO \`${DB}\`.\`users\` VALUES
        (1, 'tenant-a', 'alice', 'alice@a.test'), (2, 'tenant-b', 'bob', 'bob@b.test')`,
    );
    // Tenant A's order points at tenant B's user id.
    await pool.query(`INSERT INTO \`${DB}\`.\`orders\` VALUES (10, 'tenant-a', 2)`);
  });

  it("refuses union on a tenant-scoped builder instead of returning other tenants' rows", async () => {
    let result: unknown;
    let error: unknown;
    try {
      result = await scopedKnex("tenant-a")("users")
        .select("email")
        .union(knex("users").select("email"));
    } catch (err) {
      error = err;
    }
    expect(result).toBeUndefined();
    expect(String(error)).toMatch(/union\(\) is not allowed on a tenant-scoped builder/);
  });

  it("refuses unionAll on a tenant-scoped builder", async () => {
    await expect(
      (async () =>
        scopedKnex("tenant-a")("users").select("email").unionAll(knex("users").select("email")))(),
    ).rejects.toThrow(/unionAll\(\) is not allowed on a tenant-scoped builder/);
  });

  it("refuses a join to a derived table instead of returning another tenant's row", async () => {
    let result: unknown;
    let error: unknown;
    try {
      result = await scopedKnex("tenant-a")("orders")
        .join(knex("users").select("id as uid", "email").as("u"), "u.uid", "orders.user_id")
        .select("u.email");
    } catch (err) {
      error = err;
    }
    expect(result).toBeUndefined();
    expect(String(error)).toMatch(/join\(\) is not allowed on a tenant-scoped builder/);
  });

  it("refuses every join form with a clear error", async () => {
    const forms = [
      "join",
      "innerJoin",
      "leftJoin",
      "leftOuterJoin",
      "rightJoin",
      "rightOuterJoin",
      "outerJoin",
      "fullOuterJoin",
      "crossJoin",
    ] as const;
    for (const form of forms) {
      await expect(
        (async () =>
          (scopedKnex("tenant-a")("orders") as unknown as Record<string, (...a: unknown[]) => unknown>)[
            form
          ]("users", "users.id", "orders.user_id"))(),
      ).rejects.toThrow(new RegExp(`${form}\\(\\) is not allowed on a tenant-scoped builder`));
    }
    await expect(
      (async () =>
        scopedKnex("tenant-a")("orders").joinRaw("join users on users.id = orders.user_id"))(),
    ).rejects.toThrow(/joinRaw\(\) is not allowed on a tenant-scoped builder/);
  });

  it("still allows a tenant-scoped subquery in whereIn", async () => {
    const result = await scopedKnex("tenant-a")("users").whereIn(
      "id",
      scopedKnex("tenant-a")("orders").select("user_id"),
    );
    expect(result).toEqual([]);
  });
});

interface Doc {
  id: number;
  tenant_id: string;
  name: string;
}

const DocSchema = new EntitySchema<Doc>({
  name: "P2Doc",
  tableName: "docs",
  columns: {
    id: { type: Number, primary: true },
    tenant_id: { type: String },
    name: { type: String },
  },
});

interface Item {
  tenant_id: string;
  sku: string;
  name: string;
}

const ItemSchema = new EntitySchema<Item>({
  name: "P2Item",
  tableName: "items",
  columns: {
    tenant_id: { type: String, primary: true },
    sku: { type: String, primary: true },
    name: { type: String },
  },
});

describe("StratumTypeOrmSubscriber upserts", () => {
  let dataSource: DataSource;

  function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext({ tenant_id: tenantId } as ResolvedTenantContext, fn);
  }

  beforeAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS \`${DB}\`.\`docs\`, \`${DB}\`.\`items\``);
    await pool.query(
      `CREATE TABLE \`${DB}\`.\`docs\` (id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, name VARCHAR(255))`,
    );
    await pool.query(
      `CREATE TABLE \`${DB}\`.\`items\` (
        tenant_id VARCHAR(255) NOT NULL, sku VARCHAR(64) NOT NULL, name VARCHAR(255),
        PRIMARY KEY (tenant_id, sku)
      )`,
    );
    dataSource = new DataSource({
      type: "mysql",
      url: `${MYSQL_URL}/${DB}`,
      entities: [DocSchema, ItemSchema],
      synchronize: false,
    });
    await dataSource.initialize();
    registerStratumSubscriber(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM \`${DB}\`.\`docs\``);
    await pool.query(`DELETE FROM \`${DB}\`.\`items\``);
    await pool.query(`INSERT INTO \`${DB}\`.\`docs\` VALUES (2, 'tenant-b', 'bob-doc')`);
    await pool.query(`INSERT INTO \`${DB}\`.\`items\` VALUES ('tenant-b', 'sku-1', 'bob-item')`);
  });

  it("refuses an orUpdate upsert on a table whose unique key does not include tenant_id", async () => {
    let error: unknown;
    try {
      await asTenant("tenant-a", () =>
        dataSource
          .createQueryBuilder()
          .insert()
          .into(DocSchema)
          .values({ id: 2, name: "overwritten" })
          .orUpdate(["name"], ["id"])
          .execute(),
      );
    } catch (err) {
      error = err;
    }
    expect(await rows<Doc>(`SELECT * FROM \`${DB}\`.\`docs\` WHERE id = 2`)).toEqual([
      { id: 2, tenant_id: "tenant-b", name: "bob-doc" },
    ]);
    expect(String(error)).toMatch(/unique key .* does not include tenant_id/);
  });

  it("refuses a repository upsert on a table whose unique key does not include tenant_id", async () => {
    await expect(
      asTenant("tenant-a", () =>
        dataSource.getRepository(DocSchema).upsert({ id: 2, name: "overwritten" }, {
          conflictPaths: ["id"],
          skipUpdateIfNoValuesChanged: false,
        }),
      ),
    ).rejects.toThrow(/tenant_id/);
    expect((await rows<Doc>(`SELECT * FROM \`${DB}\`.\`docs\` WHERE id = 2`))[0].name).toBe("bob-doc");
  });

  it("allows an upsert when every unique key includes tenant_id, and keeps tenants apart", async () => {
    await asTenant("tenant-a", () =>
      dataSource
        .createQueryBuilder()
        .insert()
        .into(ItemSchema)
        .values({ sku: "sku-1", name: "alice-item" })
        .orUpdate(["name"], ["tenant_id", "sku"])
        .execute(),
    );
    await asTenant("tenant-a", () =>
      dataSource
        .createQueryBuilder()
        .insert()
        .into(ItemSchema)
        .values({ sku: "sku-1", name: "alice-item-2" })
        .orUpdate(["name"], ["tenant_id", "sku"])
        .execute(),
    );
    expect(await rows<Item>(`SELECT * FROM \`${DB}\`.\`items\` ORDER BY tenant_id`)).toEqual([
      { tenant_id: "tenant-a", sku: "sku-1", name: "alice-item-2" },
      { tenant_id: "tenant-b", sku: "sku-1", name: "bob-item" },
    ]);
  });
});

describe("MysqlTableAdapter table names", () => {
  beforeEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${TABLE_DB}\``);
    await pool.query(`CREATE DATABASE \`${TABLE_DB}\``);
  });

  it("never gives two tenants the same physical table when base names and slugs overlap", async () => {
    const adapter = new MysqlTableAdapter({
      pool: pool as unknown as MysqlPoolLike,
      databaseName: TABLE_DB,
    });

    let corpAcmeOrders: string | undefined;
    let acmeOrdersCorp: string | undefined;
    try {
      corpAcmeOrders = adapter.scopedTable("corp_acme", "orders");
      acmeOrdersCorp = adapter.scopedTable("acme", "orders_corp");
    } catch {
      // Refusing to derive an ambiguous name is a safe outcome.
      return;
    }

    // Tenant corp_acme stores a row in its orders table.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${TABLE_DB}\`.${corpAcmeOrders} (id INT PRIMARY KEY, secret VARCHAR(64))`,
    );
    await pool.query(`INSERT INTO \`${TABLE_DB}\`.${corpAcmeOrders} VALUES (1, 'corp_acme secret')`);

    // Tenant acme reads its own orders_corp table.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${TABLE_DB}\`.${acmeOrdersCorp} (id INT PRIMARY KEY, secret VARCHAR(64))`,
    );
    const seen = await rows<{ secret: string }>(`SELECT secret FROM \`${TABLE_DB}\`.${acmeOrdersCorp}`);
    expect(seen).toEqual([]);
  });

  it("refuses to derive a table name without baseTables", () => {
    const adapter = new MysqlTableAdapter({
      pool: pool as unknown as MysqlPoolLike,
      databaseName: TABLE_DB,
    });
    expect(() => adapter.scopedTable("acme", "orders")).toThrow(/baseTables/);
  });
});
