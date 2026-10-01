import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate, stratumPolicyDrift } from "@stratum-hq/lib";
import { BASE_URL, controlRoleName, scratchDatabase, urlFor } from "./helpers/role-model.js";

/** stratumPolicyDrift() finds the Stratum tables in a schema whose name needs quotes. */

const DB = scratchDatabase("quoted_schema");
const SCHEMA = "MixedCase";

let su: pg.Client;
let pool: pg.Pool;

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await su.query(`CREATE DATABASE "${DB}"`);
  const setup = new pg.Client({ connectionString: urlFor({ database: DB }) });
  await setup.connect();
  try {
    await setup.query(`CREATE EXTENSION "uuid-ossp"; CREATE EXTENSION ltree; CREATE SCHEMA "${SCHEMA}"`);
  } finally {
    await setup.end();
  }
  pool = new pg.Pool({ connectionString: urlFor({ database: DB }), max: 2, options: `-c search_path="${SCHEMA}",public` });
  await migrate({ pool, controlRole: await controlRoleName(pool) });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await su.end();
});

describe("stratumPolicyDrift()", () => {
  it("compares the policies of Stratum tables in a schema whose name needs quotes", async () => {
    expect(await stratumPolicyDrift(pool)).toEqual([]);
  });
});
