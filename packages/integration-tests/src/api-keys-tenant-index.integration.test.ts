import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate, migrateAllSchemas } from "@stratum-hq/lib";

/**
 * A fresh install indexes api_keys.tenant_id (migration 033), so `stratum
 * doctor` reports no missing tenant_id index. The migration is idempotent and
 * also indexes the api_keys table of every schema migrateAllSchemas visits.
 *
 * Uses a scratch database that this file creates and drops, so the install
 * really is fresh.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const scratchDbName = `${new URL(BASE_URL).pathname.slice(1)}_api_keys_index`;
const scratchUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${scratchDbName}`;
  return u.toString();
})();
// Roles are cluster-wide: a name of its own keeps this file from sharing the
// control role of the main test database.
const CONTROL_ROLE = `${scratchDbName.replace(/[^a-z0-9_]/g, "_")}_control`.slice(0, 63);
const SCHEMA_SLUG = "idx_schema_tenant";
const SCHEMA = `tenant_${SCHEMA_SLUG}`;

let admin: pg.Client;
let scratch: pg.Pool;

function runDoctor(): string {
  const res = spawnSync(process.execPath, [CLI, "doctor", "--database-url", scratchUrl], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", NO_COLOR: "1", STRATUM_ENCRYPTION_KEY: "doctor-test-key" },
    timeout: 30000,
  });
  // eslint-disable-next-line no-control-regex
  return `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
}

async function apiKeysTenantIndexes(schema: string): Promise<string[]> {
  const res = await scratch.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = $1 AND tablename = 'api_keys' AND indexdef LIKE '%(tenant_id)%'`,
    [schema],
  );
  return res.rows.map((r) => r.indexname);
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin.query(`CREATE DATABASE "${scratchDbName}"`);
  scratch = new pg.Pool({ connectionString: scratchUrl, max: 3 });
  await scratch.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await scratch.query(`CREATE EXTENSION IF NOT EXISTS "ltree"`);
  await migrate({ pool: scratch, controlRole: CONTROL_ROLE });
});

afterAll(async () => {
  await scratch?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin?.query(`DROP ROLE IF EXISTS "${CONTROL_ROLE}"`);
  await admin?.end();
});

describe("api_keys.tenant_id index (migration 033)", () => {
  it("exists after a fresh migrate", async () => {
    expect(await apiKeysTenantIndexes("public")).toEqual(["idx_api_keys_tenant_id"]);
  });

  it("leaves doctor with no missing tenant_id index on a fresh install", () => {
    const out = runDoctor();
    const line = out.split("\n").find((l) => l.includes("Missing indexes"));
    expect(line, out).toBeDefined();
    expect(line).toContain("All tenant_id columns are indexed");
  });

  it("is idempotent and indexes each tenant schema under migrateAllSchemas", async () => {
    await scratch.query(
      `INSERT INTO tenants (name, slug, ancestry_path, isolation_strategy)
       VALUES ($1, $1, $1, 'SCHEMA_PER_TENANT')`,
      [SCHEMA_SLUG],
    );
    await scratch.query(`CREATE SCHEMA ${SCHEMA}`);

    for (let run = 0; run < 2; run++) {
      const result = await migrateAllSchemas({ pool: scratch, controlRole: CONTROL_ROLE });
      expect(result.failed).toEqual([]);
      expect(result.succeeded).toEqual([SCHEMA]);
    }
    expect(await apiKeysTenantIndexes(SCHEMA)).toEqual(["idx_api_keys_tenant_id"]);

    // Re-running the plain migration set changes nothing.
    await migrate({ pool: scratch, controlRole: CONTROL_ROLE });
    expect(await apiKeysTenantIndexes("public")).toEqual(["idx_api_keys_tenant_id"]);
  });
});
