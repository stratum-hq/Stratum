import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { migrate } from "@stratum-hq/lib";
import { scaffoldProject } from "./helpers/create-cli.js";
import { ROLE_PREFIX, dropTestRole } from "./helpers/role-model.js";

/**
 * Generates a postgres-rls project with the built `@stratum-hq/create`, runs
 * its init.sql on a real PostgreSQL server the way the postgres image does
 * (as the bootstrap superuser, inside the new database), and then connects
 * with the generated DATABASE_URL to check that row-level security applies
 * to the role the app uses. It then runs the Stratum migrations as the
 * generated Stratum login, as the library does with adminPool, and checks
 * that the app role got no write access to the Stratum tables.
 *
 * Roles are cluster-wide, so the control role the file names is renamed with
 * the test prefix.
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
let stratumRole: string;
let stratumUrl: string;
const CONTROL = `${ROLE_PREFIX}a10_control`;

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

  const stratumEnv = new URL(env.match(/^STRATUM_ADMIN_DATABASE_URL=(.*)$/m)![1]);
  stratumRole = decodeURIComponent(stratumEnv.username);
  const s = new URL(withDb(BASE_URL, DB_NAME));
  s.username = stratumEnv.username;
  s.password = stratumEnv.password;
  stratumUrl = s.toString();

  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  if (appRole !== bootstrapUser) await admin.query(`DROP ROLE IF EXISTS ${appRole}`);
  await dropTestRole(admin, stratumRole);
  await dropTestRole(admin, CONTROL);
  await admin.query(`DROP ROLE IF EXISTS ${bootstrapUser}`);
  await admin.query(`CREATE ROLE ${bootstrapUser} WITH LOGIN SUPERUSER PASSWORD '${bootstrapPassword}'`);
  await admin.query(`CREATE DATABASE ${DB_NAME} OWNER ${bootstrapUser}`);

  const initSql = fs.readFileSync(path.join(project, "init.sql"), "utf8").replace(/\bstratum_control\b/g, CONTROL);
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
  if (admin && stratumRole) await dropTestRole(admin, stratumRole);
  if (admin) await dropTestRole(admin, CONTROL);
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

describe("generated postgres-rls project: the Stratum tables", () => {
  it("gives the app role no write access to them after the Stratum login migrates", async () => {
    const stratumPool = new pg.Pool({ connectionString: stratumUrl, max: 1 });
    try {
      await migrate({ pool: stratumPool, controlRole: CONTROL, applyControlRole: true });
    } finally {
      await stratumPool.end();
    }
    const boot = new pg.Client({ connectionString: withDb(BASE_URL, DB_NAME) });
    await boot.connect();
    try {
      const tables = await boot.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c
          WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relowner = $1::regrole`,
        [stratumRole],
      );
      expect(tables.rows.map((r) => r.relname)).toContain("tenants");
      const writable = await boot.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c
          WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relowner = $2::regrole
            AND (has_table_privilege($1, c.oid, 'INSERT') OR has_table_privilege($1, c.oid, 'UPDATE')
                 OR has_table_privilege($1, c.oid, 'DELETE'))`,
        [appRole, stratumRole],
      );
      expect(writable.rows).toEqual([]);
      const create = await boot.query("SELECT has_schema_privilege($1, 'public', 'CREATE') AS c", [appRole]);
      expect(create.rows[0].c).toBe(false);
      const member = await boot.query("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [appRole, CONTROL]);
      expect(member.rows[0].m).toBe(false);
    } finally {
      await boot.end();
    }
  });

  it("still lets the app role write the tables the bootstrap superuser creates", async () => {
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-00000000000a', true)");
      const res = await app.query("INSERT INTO orders (tenant_id, item) VALUES ('00000000-0000-0000-0000-00000000000a', 'a2') RETURNING item");
      await app.query("ROLLBACK");
      expect(res.rows).toEqual([{ item: "a2" }]);
    } finally {
      await app.end();
    }
  });
});
