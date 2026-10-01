import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import knexFactory, { type Knex } from "knex";
import type { Pool } from "mysql2/promise";
import { getTestPool, cleanupTestPool } from "./setup.js";
import { withTenantScope, type KnexLike } from "../../integrations/knex.js";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// Database name is unique to this file so it can run alongside other suites
// against a shared server.
const DB = "u6_stratum_keys";
const TABLE = "u6_notes";

let pool: Pool;
let knex: Knex;

type Row = { id: number; tenant_id: string; body: string };

function scopedKnex(tenantId: string): (table: string) => Knex.QueryBuilder {
  return withTenantScope(knex as unknown as KnexLike, tenantId) as unknown as (
    table: string,
  ) => Knex.QueryBuilder;
}

async function allRows(): Promise<Row[]> {
  const [result] = await pool.query(
    `SELECT id, tenant_id, body FROM \`${DB}\`.\`${TABLE}\` ORDER BY id`,
  );
  return result as Row[];
}

// Keys that MySQL (through Knex, which trims identifier parts) resolves to the
// tenant_id column, although they are not spelled "tenant_id".
const RESOLVING_KEYS = [
  "tenant_id ",
  " tenant_id",
  "tenant_id\t",
  "tenant_id ",
  "tenant_id　",
  "tenant_id﻿",
  `${TABLE} . tenant_id`,
  "tenant_İd",
  "TENANT_İD",
];

const ORIGINAL: Row[] = [
  { id: 1, tenant_id: "tenant-a", body: "a-note" },
  { id: 2, tenant_id: "tenant-b", body: "b-note" },
];

beforeAll(async () => {
  pool = (await getTestPool()) as unknown as Pool;
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\``);
  knex = knexFactory({ client: "mysql2", connection: `${MYSQL_URL}/${DB}` });
});

afterAll(async () => {
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await knex.destroy();
  await cleanupTestPool();
});

describe("Knex withTenantScope data keys", () => {
  beforeEach(async () => {
    await pool.query(`DROP TABLE IF EXISTS \`${DB}\`.\`${TABLE}\``);
    await pool.query(
      `CREATE TABLE \`${DB}\`.\`${TABLE}\` (
        id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, body VARCHAR(255)
      )`,
    );
    await pool.query(
      `INSERT INTO \`${DB}\`.\`${TABLE}\` VALUES (1, 'tenant-a', 'a-note'), (2, 'tenant-b', 'b-note')`,
    );
  });

  it.each(RESOLVING_KEYS)(
    "refuses an update data key outside the identifier set: %j",
    async (key) => {
      await expect(
        (async () =>
          scopedKnex("tenant-a")(TABLE)
            .where("id", 1)
            .update({ [key]: "tenant-b" }))(),
      ).rejects.toThrow(/withTenantScope: update\(\) refuses the column name/);
      expect(await allRows()).toEqual(ORIGINAL);
    },
  );

  it.each(RESOLVING_KEYS)(
    "refuses an update column argument outside the identifier set: %j",
    async (key) => {
      await expect(
        (async () =>
          scopedKnex("tenant-a")(TABLE)
            .where("id", 1)
            .update(key, "tenant-b"))(),
      ).rejects.toThrow(/withTenantScope: update\(\) refuses the column name/);
      expect(await allRows()).toEqual(ORIGINAL);
    },
  );

  it.each(RESOLVING_KEYS)(
    "refuses an insert data key outside the identifier set: %j",
    async (key) => {
      await expect(
        (async () =>
          scopedKnex("tenant-a")(TABLE).insert({
            id: 3,
            body: "new",
            [key]: "tenant-b",
          }))(),
      ).rejects.toThrow(/withTenantScope: insert\(\) refuses the column name/);
      expect(await allRows()).toEqual(ORIGINAL);
    },
  );

  it("still writes ASCII keys, qualified keys, and drops tenant_id", async () => {
    await scopedKnex("tenant-a")(TABLE)
      .where("id", 1)
      .update({ [`${TABLE}.body`]: "edited", TENANT_ID: "tenant-b" });
    await scopedKnex("tenant-a")(TABLE).insert({
      id: 3,
      body: "new",
      tenant_id: "tenant-b",
    });
    expect(await allRows()).toEqual([
      { id: 1, tenant_id: "tenant-a", body: "edited" },
      ORIGINAL[1],
      { id: 3, tenant_id: "tenant-a", body: "new" },
    ]);
  });
});
