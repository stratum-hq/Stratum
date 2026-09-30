import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource, EntitySchema } from "typeorm";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { getTestPool, cleanupTestPool } from "./setup.js";
import {
  StratumTypeOrmSubscriber,
  registerStratumSubscriber,
} from "../../integrations/typeorm-subscriber.js";
import type { Pool } from "mysql2/promise";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// The database name is unique to this file, so the file can run alongside
// other suites on a shared server.
const DB = "i344_stratum_typeorm_register";

interface Item {
  id: number;
  tenant_id: string;
  name: string;
}

const ItemSchema = new EntitySchema<Item>({
  name: "Item",
  tableName: "items",
  columns: {
    id: { type: Number, primary: true },
    tenant_id: { type: String },
    name: { type: String },
  },
});

let pool: Pool;
let dataSource: DataSource;

function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithTenantContext({ tenant_id: tenantId } as ResolvedTenantContext, fn);
}

async function rowById(id: number): Promise<Item | undefined> {
  const [rows] = await pool.query(`SELECT * FROM \`${DB}\`.\`items\` WHERE id = ?`, [id]);
  return (rows as Item[])[0];
}

function newDataSource(): DataSource {
  return new DataSource({
    type: "mysql",
    url: `${MYSQL_URL}/${DB}`,
    entities: [ItemSchema],
    synchronize: false,
  });
}

beforeAll(async () => {
  pool = (await getTestPool()) as unknown as Pool;
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await pool.query(`CREATE DATABASE \`${DB}\``);
  // The primary key includes tenant_id: the subscriber refuses upserts on a
  // table with a unique key that does not.
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`items\` (
      id INT NOT NULL,
      tenant_id VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      PRIMARY KEY (tenant_id, id)
    )`,
  );
  dataSource = newDataSource();
  await dataSource.initialize();
  registerStratumSubscriber(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanupTestPool();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM \`${DB}\`.\`items\``);
  await asTenant("tenant-a", async () => {
    await dataSource.getRepository(ItemSchema).insert({ id: 1, name: "item" });
  });
});

describe("registerStratumSubscriber with real TypeORM + MySQL", () => {
  it("registers exactly one subscriber when it is called more than once", async () => {
    const first = registerStratumSubscriber(dataSource);
    const second = registerStratumSubscriber(dataSource);

    const registered = dataSource.subscribers.filter(
      (subscriber) => subscriber instanceof StratumTypeOrmSubscriber,
    );
    expect(registered).toHaveLength(1);
    expect(second).toBe(first);
    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a" });
  });

  it("rejects a data source that is not initialized yet", async () => {
    const pending = newDataSource();
    expect(() => registerStratumSubscriber(pending)).toThrow(/initialize/);
    expect(pending.subscribers).toHaveLength(0);
  });
});

describe("StratumTypeOrmSubscriber with TypeORM upserts on MySQL", () => {
  it("stamps the current tenant on a row that an upsert inserts", async () => {
    await asTenant("tenant-a", async () => {
      await dataSource.getRepository(ItemSchema).upsert({ id: 2, name: "new" }, ["id"]);
    });

    expect(await rowById(2)).toMatchObject({ tenant_id: "tenant-a", name: "new" });
  });

  it("keeps tenant_id when an upsert without tenant_id updates a row", async () => {
    await asTenant("tenant-a", async () => {
      await dataSource.getRepository(ItemSchema).upsert({ id: 1, name: "upserted" }, ["id"]);
    });

    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a", name: "upserted" });
  });

  it("does not move a row to another tenant through a repository upsert", async () => {
    await expect(
      asTenant("tenant-b", async () => {
        await dataSource
          .getRepository(ItemSchema)
          .upsert({ id: 1, tenant_id: "tenant-b", name: "moved" }, ["id"]);
      }),
    ).rejects.toThrow(/tenant_id/);

    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a", name: "item" });
  });

  it("does not move a row to another tenant through a query builder orUpdate", async () => {
    await expect(
      asTenant("tenant-b", async () => {
        await dataSource
          .createQueryBuilder()
          .insert()
          .into(ItemSchema)
          .values({ id: 1, name: "moved" })
          .orUpdate(["name", "tenant_id"], ["id"])
          .execute();
      }),
    ).rejects.toThrow(/tenant_id/);

    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a", name: "item" });
  });
});
