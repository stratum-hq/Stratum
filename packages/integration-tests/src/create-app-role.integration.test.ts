import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { scaffoldProject } from "./helpers/create-cli.js";

/**
 * Generates a postgres-rls project with the built `@stratum-hq/create`, runs
 * its init.sql on a real PostgreSQL server the way the postgres image does
 * (as the bootstrap superuser, inside the new database), and then connects
 * with the generated DATABASE_URL to check that row-level security applies
 * to the role the app uses.
 */

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const PROJECT = "a10-rls-app";
const DB_NAME = "a10_rls_app";

let tmp: string;
let admin: pg.Client;
let appRole: string;
let bootstrapUser: string;
let appUrl: string;

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-role-"));
  const project = scaffoldProject(tmp, PROJECT, "postgres-rls-pg-express");

  const env = fs.readFileSync(path.join(project, ".env.example"), "utf8");
  const generated = new URL(env.match(/^DATABASE_URL=(.*)$/m)![1]);
  appRole = decodeURIComponent(generated.username);
  // Point the generated credentials at the test server.
  const u = new URL(withDb(BASE_URL, DB_NAME));
  u.username = generated.username;
  u.password = generated.password;
  appUrl = u.toString();

  // The postgres image creates POSTGRES_USER as a superuser. Recreate that
  // here from the generated compose file.
  const compose = fs.readFileSync(path.join(project, "docker-compose.yml"), "utf8");
  bootstrapUser = compose.match(/POSTGRES_USER: (\S+)/)![1];
  const bootstrapPassword = compose.match(/POSTGRES_PASSWORD: (\S+)/)![1];

  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  if (appRole !== bootstrapUser) await admin.query(`DROP ROLE IF EXISTS ${appRole}`);
  await admin.query(`DROP ROLE IF EXISTS ${bootstrapUser}`);
  await admin.query(`CREATE ROLE ${bootstrapUser} WITH LOGIN SUPERUSER PASSWORD '${bootstrapPassword}'`);
  await admin.query(`CREATE DATABASE ${DB_NAME} OWNER ${bootstrapUser}`);

  const initSql = fs.readFileSync(path.join(project, "init.sql"), "utf8");
  const bootUrl = new URL(withDb(BASE_URL, DB_NAME));
  bootUrl.username = bootstrapUser;
  bootUrl.password = bootstrapPassword;
  const boot = new pg.Client({ connectionString: bootUrl.toString() });
  await boot.connect();
  try {
    await boot.query(initSql);
    // A tenant-scoped table created by the bootstrap superuser (migrations),
    // following the policy the generated init.sql documents.
    await boot.query(`
      CREATE TABLE orders (id SERIAL PRIMARY KEY, tenant_id UUID NOT NULL, item TEXT NOT NULL);
      ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE orders FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON orders
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
      INSERT INTO orders (tenant_id, item) VALUES
        ('00000000-0000-0000-0000-00000000000a', 'a'),
        ('00000000-0000-0000-0000-00000000000b', 'b');
    `);
  } finally {
    await boot.end();
  }
});

afterAll(async () => {
  await admin?.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  if (appRole && appRole !== bootstrapUser) await admin?.query(`DROP ROLE IF EXISTS ${appRole}`);
  if (bootstrapUser) await admin?.query(`DROP ROLE IF EXISTS ${bootstrapUser}`);
  await admin?.end();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("generated postgres-rls project: the app's database role", () => {
  it("is neither superuser nor BYPASSRLS", async () => {
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      const res = await app.query(
        `SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(res.rows[0]).toEqual({ role: appRole, rolsuper: false, rolbypassrls: false });
    } finally {
      await app.end();
    }
  });

  it("sees only the current tenant's rows", async () => {
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-00000000000a', true)");
      const res = await app.query(`SELECT item FROM orders ORDER BY item`);
      await app.query("ROLLBACK");
      expect(res.rows).toEqual([{ item: "a" }]);
    } finally {
      await app.end();
    }
  });
});
