import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource, EntitySchema } from "typeorm";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { getTestPool, cleanupTestPool } from "./setup.js";
import { StratumTypeOrmSubscriber } from "../../integrations/typeorm-subscriber.js";
import type { Pool } from "mysql2/promise";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// Database name is unique to this file so it can run alongside other suites
// against a shared server.
const DB = "f1_stratum_typeorm";

interface Doc {
  id: number;
  tenant_id: string;
  name: string;
}

const DocSchema = new EntitySchema<Doc>({
  name: "Doc",
  tableName: "docs",
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

async function rowById(id: number): Promise<Doc> {
  const [rows] = await pool.query(`SELECT * FROM \`${DB}\`.\`docs\` WHERE id = ?`, [id]);
  return (rows as Doc[])[0];
}

beforeAll(async () => {
  pool = (await getTestPool()) as unknown as Pool;
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await pool.query(`CREATE DATABASE \`${DB}\``);
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`docs\` (
      id INT PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      name VARCHAR(255)
    )`,
  );
  dataSource = new DataSource({
    type: "mysql",
    url: `${MYSQL_URL}/${DB}`,
    entities: [DocSchema],
    synchronize: false,
  });
  await dataSource.initialize();
  // TypeORM's `subscribers` option only loads @EventSubscriber()-decorated
  // classes, so an undecorated subscriber is registered as an instance.
  dataSource.subscribers.push(new StratumTypeOrmSubscriber());
});

afterAll(async () => {
  await dataSource?.destroy();
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanupTestPool();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM \`${DB}\`.\`docs\``);
  await asTenant("tenant-a", async () => {
    await dataSource.getRepository(DocSchema).insert({ id: 1, name: "doc" });
  });
});

describe("StratumTypeOrmSubscriber with real TypeORM + MySQL", () => {
  it("stamps the current tenant on insert", async () => {
    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a", name: "doc" });
  });

  it("keeps tenant_id when a loaded entity is saved with another tenant's id", async () => {
    await asTenant("tenant-a", async () => {
      const repo = dataSource.getRepository(DocSchema);
      const doc = await repo.findOneByOrFail({ id: 1 });
      doc.tenant_id = "tenant-b";
      doc.name = "renamed";
      await repo.save(doc);
    });

    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a", name: "renamed" });
  });

  it("does not change tenant_id through a repository update", async () => {
    await asTenant("tenant-a", async () => {
      await dataSource
        .getRepository(DocSchema)
        .update({ id: 1 }, { tenant_id: "tenant-b", name: "updated" });
    });

    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a", name: "updated" });
  });

  it("does not change tenant_id through a query builder update", async () => {
    await asTenant("tenant-a", async () => {
      await dataSource
        .createQueryBuilder()
        .update(DocSchema)
        .set({ tenant_id: "tenant-b", name: "qb" })
        .where("id = :id", { id: 1 })
        .execute();
    });

    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a", name: "qb" });
  });

  it("rejects an update whose only change is tenant_id", async () => {
    await expect(
      asTenant("tenant-a", async () => {
        await dataSource.getRepository(DocSchema).update({ id: 1 }, { tenant_id: "tenant-b" });
      }),
    ).rejects.toThrow();

    expect(await rowById(1)).toMatchObject({ tenant_id: "tenant-a" });
  });
});
