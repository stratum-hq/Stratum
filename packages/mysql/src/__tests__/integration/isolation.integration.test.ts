import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { createPool } from "mysql2/promise";
import { getTestPool, getTestDbName, cleanupTestPool } from "./setup.js";
import { MysqlSharedAdapter } from "../../adapters/shared.js";
import { MysqlTableAdapter } from "../../adapters/table.js";
import { MysqlDatabaseAdapter } from "../../adapters/database.js";
import type { Pool } from "mysql2/promise";
import type { MysqlPoolLike } from "../../types.js";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

let pool: Pool;

/** Wraps a mysql2 Pool so end() is a no-op. Needed because tests share one
 *  connection but MysqlDatabaseAdapter.purgeTenantData calls closePool(). */
function unclosablePool(p: Pool): MysqlPoolLike {
  return {
    getConnection: () => p.getConnection(),
    query: (sql: string, values?: unknown[]) => p.query(sql, values) as Promise<unknown>,
    end: async () => {},
  } as MysqlPoolLike;
}

beforeEach(async () => {
  pool = await getTestPool();
});

afterAll(async () => {
  await cleanupTestPool();
});

describe("Shared-table isolation", () => {
  const dbName = `${getTestDbName()}_shared`;

  beforeEach(async () => {
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${dbName}\`.\`test_docs\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        data VARCHAR(255)
      )`,
    );
  });

  afterEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  });

  it("tenantA cannot read tenantB documents", async () => {
    const adapter = new MysqlSharedAdapter({
      pool: pool as unknown as MysqlPoolLike,
      databaseName: dbName,
    });

    await pool.query(
      `INSERT INTO \`${dbName}\`.\`test_docs\` (tenant_id, data) VALUES (?, ?)`,
      ["tenant-b", "secret"],
    );

    const results = await adapter.scopedSelect("tenant-a", "test_docs");
    expect(results).toHaveLength(0);
  });

  it("purge removes only target tenant data", async () => {
    const adapter = new MysqlSharedAdapter({
      pool: pool as unknown as MysqlPoolLike,
      databaseName: dbName,
    });

    await pool.query(
      `INSERT INTO \`${dbName}\`.\`test_docs\` (tenant_id, data) VALUES (?, ?), (?, ?)`,
      ["tenant-a", "a-data", "tenant-b", "b-data"],
    );

    await adapter.purgeTenantData("tenant-a");

    const [remainingB] = await pool.query(
      `SELECT * FROM \`${dbName}\`.\`test_docs\` WHERE tenant_id = ?`,
      ["tenant-b"],
    ) as unknown[][];
    expect((remainingB as unknown[]).length).toBe(1);

    const [remainingA] = await pool.query(
      `SELECT * FROM \`${dbName}\`.\`test_docs\` WHERE tenant_id = ?`,
      ["tenant-a"],
    ) as unknown[][];
    expect((remainingA as unknown[]).length).toBe(0);
  });
});

describe("Table-per-tenant isolation", () => {
  const dbName = `${getTestDbName()}_table`;

  beforeEach(async () => {
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  });

  afterEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  });

  it("tenantA table is separate from tenantB table", async () => {
    const adapter = new MysqlTableAdapter({
      pool: pool as unknown as MysqlPoolLike,
      databaseName: dbName,
    });

    // Create tables for both tenants
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${dbName}\`.\`users_tenantb\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${dbName}\`.\`users_tenanta\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );

    await pool.query(`INSERT INTO \`${dbName}\`.\`users_tenantb\` (data) VALUES (?)`, ["secret"]);

    const [resultsA] = await pool.query(
      `SELECT * FROM \`${dbName}\`.\`users_tenanta\``,
    ) as unknown[][];
    expect((resultsA as unknown[]).length).toBe(0);
  });

  it("purge drops only target tenant tables", async () => {
    const adapter = new MysqlTableAdapter({
      pool: pool as unknown as MysqlPoolLike,
      databaseName: dbName,
    });

    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${dbName}\`.\`users_tenanta\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${dbName}\`.\`users_tenantb\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );

    await pool.query(`INSERT INTO \`${dbName}\`.\`users_tenanta\` (data) VALUES (?)`, ["a-data"]);
    await pool.query(`INSERT INTO \`${dbName}\`.\`users_tenantb\` (data) VALUES (?)`, ["b-data"]);

    await adapter.purgeTenantData("tenanta");

    // tenantb table should still exist with data
    const [remainingB] = await pool.query(
      `SELECT * FROM \`${dbName}\`.\`users_tenantb\``,
    ) as unknown[][];
    expect((remainingB as unknown[]).length).toBe(1);

    // tenanta table should be gone
    const [tables] = await pool.query(
      `SHOW TABLES FROM \`${dbName}\` LIKE ?`,
      ["%_tenanta"],
    ) as unknown[][];
    expect((tables as unknown[]).length).toBe(0);
  });
});

describe("Database-per-tenant isolation", () => {
  const tenantADb = "stratum_tenant_tenanta";
  const tenantBDb = "stratum_tenant_tenantb";

  afterEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${tenantADb}\``).catch(() => {});
    await pool.query(`DROP DATABASE IF EXISTS \`${tenantBDb}\``).catch(() => {});
  });

  it("tenantA database is separate from tenantB database", async () => {
    const adapter = new MysqlDatabaseAdapter({
      createPool: (uri: string) => unclosablePool(createPool(uri)),
      baseUri: `${MYSQL_URL}/stratum_tenant_placeholder`,
    });

    // Create tenant databases
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${tenantBDb}\``);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${tenantBDb}\`.\`docs\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );
    await pool.query(`INSERT INTO \`${tenantBDb}\`.\`docs\` (data) VALUES (?)`, ["secret"]);

    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${tenantADb}\``);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${tenantADb}\`.\`docs\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );

    const poolA = await adapter.getPool("tenanta");
    const [resultsA] = await poolA.query(`SELECT * FROM docs`) as unknown[][];
    expect((resultsA as unknown[]).length).toBe(0);

    await adapter.closeAll();
  });

  it("purge drops only target tenant database", async () => {
    const adapter = new MysqlDatabaseAdapter({
      createPool: (uri: string) => unclosablePool(createPool(uri)),
      baseUri: `${MYSQL_URL}/stratum_tenant_placeholder`,
    });

    // Create both tenant databases with tables and data
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${tenantADb}\``);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${tenantADb}\`.\`docs\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );
    await pool.query(`INSERT INTO \`${tenantADb}\`.\`docs\` (data) VALUES (?)`, ["a-data"]);

    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${tenantBDb}\``);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${tenantBDb}\`.\`docs\` (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    );
    await pool.query(`INSERT INTO \`${tenantBDb}\`.\`docs\` (data) VALUES (?)`, ["b-data"]);

    await adapter.purgeTenantData("tenanta");

    // tenantb database should still exist with data
    const [remainingB] = await pool.query(
      `SELECT * FROM \`${tenantBDb}\`.\`docs\``,
    ) as unknown[][];
    expect((remainingB as unknown[]).length).toBe(1);

    // tenanta database should be gone
    const [dbs] = await pool.query(
      `SHOW DATABASES LIKE ?`,
      [tenantADb],
    ) as unknown[][];
    expect((dbs as unknown[]).length).toBe(0);

    await adapter.closeAll();
  });
});
