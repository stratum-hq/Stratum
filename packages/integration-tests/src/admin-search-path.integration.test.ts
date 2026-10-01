import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { inspectRoleModel, migrate, Stratum, type StratumLogger } from "@stratum-hq/lib";
import { BASE_URL, ROLE_PREFIX, controlRoleName, dropTestRole, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * When the application login can create schemas in the database and the
 * admin login's search_path starts from "$user", a schema the application
 * login names after the admin login would come first on the admin login's
 * path. initialize(), inspectRoleModel() and `stratum doctor` report it, and
 * stop once the admin login's path is set in the database.
 */

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");
const DB = scratchDatabase("admin_path");
const APP = `${ROLE_PREFIX}ap_app`;
const ADMIN = `${ROLE_PREFIX}ap_admin`;
const PASSWORD = "ap_pw";

const suUrl = urlFor({ database: DB });
const appUrl = urlFor({ user: APP, password: PASSWORD, database: DB });
const adminUrl = urlFor({ user: ADMIN, password: PASSWORD, database: DB });

let su: pg.Client;
let suPool: pg.Pool;
let control: string;

function capture(): StratumLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, info() {}, error() {}, warn: (msg: string) => warnings.push(msg) };
}

/** The warnings of initialize() with the app and admin logins. */
async function initializeWarnings(): Promise<string[]> {
  const app = new pg.Pool({ connectionString: appUrl, max: 2 });
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const logger = capture();
  try {
    await new Stratum({ pool: app, adminPool: admin, controlRole: control, logger }).initialize();
  } finally {
    await app.end();
    await admin.end();
  }
  return logger.warnings;
}

function doctor(): string {
  const res = spawnSync(
    process.execPath,
    [CLI, "doctor", "--database-url", appUrl, "--admin-database-url", adminUrl],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", STRATUM_ENCRYPTION_KEY: "x".repeat(40), DATABASE_ADMIN_URL: "" },
      timeout: 60000,
    },
  );
  // eslint-disable-next-line no-control-regex
  return `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
}

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [APP, ADMIN]) {
    await dropTestRole(su, role);
    await su.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  }
  await su.query(`CREATE DATABASE "${DB}"`);
  suPool = new pg.Pool({ connectionString: suUrl, max: 2 });
  control = await controlRoleName(suPool);
  await suPool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS ltree`);
  await migrate({ pool: suPool, controlRole: control });
  await su.query(`GRANT "${control}" TO "${ADMIN}"`);
  await suPool.query(`GRANT CREATE ON DATABASE "${DB}" TO "${APP}"`);
}, 120_000);

afterAll(async () => {
  await suPool?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [APP, ADMIN]) await dropTestRole(su, role);
  await su.end();
});

describe("an application login with CREATE on the database", () => {
  it("is reported while the admin login's search_path contains $user", async () => {
    const warnings = await initializeWarnings();
    expect(warnings.some((w) => w.includes(`search_path of the admin login "${ADMIN}"`) && w.includes("$user"))).toBe(true);

    const report = await inspectRoleModel({ pool: suPool, appRole: APP, adminRole: ADMIN, controlRole: control });
    expect(report.searchPathIssue).toMatch(new RegExp(`the app role "${APP}" can create schemas in the database "${DB}"`));

    expect(doctor()).toMatch(/Admin search path\s+A schema the application login can create would come first on it/);
  });

  it("is not reported once the admin login's search_path is set in the database", async () => {
    await su.query(`ALTER ROLE "${ADMIN}" IN DATABASE "${DB}" SET search_path = public`);
    const warnings = await initializeWarnings();
    expect(warnings.filter((w) => w.includes("search_path of the admin login"))).toEqual([]);

    const report = await inspectRoleModel({ pool: suPool, appRole: APP, adminRole: ADMIN, controlRole: control });
    expect(report.searchPathIssue).toBeNull();

    expect(doctor()).not.toMatch(/Admin search path/);
  });
});
