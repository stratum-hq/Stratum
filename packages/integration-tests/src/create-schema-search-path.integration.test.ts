import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { scaffoldProject } from "./helpers/create-cli.js";
import { ROLE_PREFIX, dropTestRole } from "./helpers/role-model.js";

/**
 * A generated postgres-schema project creates each tenant's schema as the
 * bootstrap superuser, so the app login cannot create schemas. A schema named
 * like a login comes first on that login's default search path, so the
 * init.sql of such a project also keeps every other schema off the search
 * path of the Stratum login and of the bootstrap superuser.
 *
 * The project name, and so its database and role names, carries the test
 * role prefix, because roles are cluster-wide.
 */

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const PROJECT = `${ROLE_PREFIX}schema-app`.replace(/_/g, "-");
const DB_NAME = PROJECT.replace(/-/g, "_");
const CONTROL = `${ROLE_PREFIX}schema_control`;

let tmp: string;
let admin: pg.Client;
let appRole: string;
let stratumRole: string;
let bootstrapUser: string;
const urls: Record<"app" | "stratum" | "boot", string> = { app: "", stratum: "", boot: "" };

function urlAs(user: string, password: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${DB_NAME}`;
  u.username = user;
  u.password = password;
  return u.toString();
}

async function asLogin<T>(which: keyof typeof urls, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urls[which] });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-schema-"));
  const project = scaffoldProject(tmp, PROJECT, "postgres-schema-pg-express");
  const env = fs.readFileSync(path.join(project, ".env.example"), "utf8");
  const app = new URL(env.match(/^DATABASE_URL=(.*)$/m)![1]);
  const stratum = new URL(env.match(/^STRATUM_ADMIN_DATABASE_URL=(.*)$/m)![1]);
  const compose = fs.readFileSync(path.join(project, "docker-compose.yml"), "utf8");
  bootstrapUser = compose.match(/POSTGRES_USER: (\S+)/)![1];
  const bootstrapPassword = compose.match(/POSTGRES_PASSWORD: (\S+)/)![1];
  appRole = decodeURIComponent(app.username);
  stratumRole = decodeURIComponent(stratum.username);
  urls.app = urlAs(app.username, app.password);
  urls.stratum = urlAs(stratum.username, stratum.password);
  urls.boot = urlAs(bootstrapUser, bootstrapPassword);

  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  for (const role of [appRole, stratumRole, CONTROL, bootstrapUser]) await dropTestRole(admin, role);
  await admin.query(`CREATE ROLE "${bootstrapUser}" WITH LOGIN SUPERUSER PASSWORD '${bootstrapPassword}'`);
  await admin.query(`CREATE DATABASE "${DB_NAME}" OWNER "${bootstrapUser}"`);

  const initSql = fs.readFileSync(path.join(project, "init.sql"), "utf8").replace(/\bstratum_control\b/g, CONTROL);
  await asLogin("boot", (c) => c.query(initSql));
}, 120_000);

afterAll(async () => {
  await admin?.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  if (admin) for (const role of [appRole, stratumRole, CONTROL, bootstrapUser]) if (role) await dropTestRole(admin, role);
  await admin?.end();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("generated postgres-schema project", () => {
  it("does not let the app login create schemas", async () => {
    await expect(asLogin("app", (c) => c.query(`CREATE SCHEMA "tenant_acme"`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("keeps schemas named like a login off the search path of the Stratum login and the bootstrap superuser", async () => {
    await asLogin("boot", async (c) => {
      // The owner of a schema can let every login use it.
      await c.query(`CREATE SCHEMA "${stratumRole}"; GRANT USAGE ON SCHEMA "${stratumRole}" TO PUBLIC`);
      await c.query(`CREATE SCHEMA "${bootstrapUser}"; GRANT USAGE ON SCHEMA "${bootstrapUser}" TO PUBLIC`);
    });
    for (const login of ["stratum", "boot"] as const) {
      const path = await asLogin(login, (c) => c.query<{ p: string[] }>("SELECT current_schemas(false)::text[] AS p"));
      expect(path.rows[0].p, login).toEqual(["public"]);
    }
  });
});
