import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { scaffoldProject } from "./helpers/create-cli.js";
import { useWorkspaceStratumPackages } from "./helpers/workspace-tarballs.js";
import { ROLE_PREFIX } from "./helpers/role-model.js";

/**
 * Generates the MySQL presets of each strategy with the built
 * `@stratum-hq/create`, installs them with the workspace builds of the Stratum
 * packages, sets up a MySQL server as the generated docker-compose.yml and
 * init.sql do, adds a tenant table as the generated files say to, follows the
 * setup the generated project describes, and then uses the generated tenant
 * helper as the application user. Tenant A must not read or change tenant B's
 * rows.
 *
 * Needs a MySQL server: MYSQL_URL, a URL of a user that can create databases
 * and users (for example mysql://root@localhost:3306). Without it the suite
 * is skipped. Every database and user name carries the test role prefix.
 * Installs need network access to the npm registry for third-party packages.
 */

const MYSQL_URL = process.env.MYSQL_URL;

const PREFIX = ROLE_PREFIX.replace(/[^a-z0-9_]/g, "");

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const TENANT_C = "00000000-0000-4000-8000-00000000000c";

const ITEMS_COLUMNS = `(
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  body TEXT NOT NULL
)`;

const CHECK = `
const h: any = await import("./src/stratum-db.js");
// A table-prefix helper takes a function that names the tenant's tables.
const q = async (id: string, sql: string, params: unknown[] = []) =>
  h.BASE_TABLES
    ? await h.tenantQuery(id, (t: (base: string) => string) => sql.replace(/\\bitems\\b/g, t("items")), params)
    : await h.tenantQuery(id, sql, params);
const [A, B] = process.argv.slice(2);
await q(B, "INSERT INTO items (id, tenant_id, body) VALUES ('row-b', ?, 'b-secret')", [B]);
await q(A, "INSERT INTO items (id, tenant_id, body) VALUES ('row-a', ?, 'a-note')", [A]);
const aSees = (await q(A, "SELECT body FROM items")).map((r: any) => r.body).sort();
const aUpdated = (await q(A, "UPDATE items SET body = 'changed-by-a' WHERE id = 'row-b'")).affectedRows;
const bBody = (await q(B, "SELECT body FROM items WHERE id = 'row-b'"))[0]?.body ?? null;
// A tenant ID that differs from A's only in letter case names no tenant.
const caseVariant = await q(A.toUpperCase(), "SELECT body FROM items").then(
  (rows: any) => rows.map((r: any) => r.body),
  () => "refused",
);
console.log("RESULT " + JSON.stringify({ aSees, aUpdated, bBody, caseVariant }));
process.exit(0);
`;

let tmp: string;

// The generated project reads its settings from its .env file. Node lets a
// variable already in the environment win over .env.
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env };
for (const key of ["DATABASE_URL", "DATABASE_SUPERUSER_URL"]) delete CHILD_ENV[key];

function run(cmd: string, args: string[], cwd: string): string {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env: CHILD_ENV });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

/** The server URL with another user, password and database. */
function serverUrl(user: string, password: string, database: string): string {
  const u = new URL(MYSQL_URL!);
  u.username = user;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
}

describe.skipIf(!MYSQL_URL)("generated MySQL presets", () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-mysql-"));
  });

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  isolationSuite("database");
  isolationSuite("table-prefix");
});

function isolationSuite(strategy: "database" | "table-prefix"): void {
  const preset = `mysql-${strategy}-pg-none`;
  const project = `${PREFIX}myiso-${strategy}`.replace(/_/g, "-");
  const short = strategy === "database" ? "d" : "t";
  const slugs = [`${PREFIX}my${short}a`, `${PREFIX}my${short}b`, `${PREFIX}my${short}c`];

  describe(`generated ${preset} project`, () => {
    let dir: string;
    let root: mysql.Connection;
    let dbName: string;
    let appUser: string;

    async function cleanup(): Promise<void> {
      for (const db of [dbName, ...slugs.map((s) => `stratum_tenant_${s}`)]) {
        await root.query(`DROP DATABASE IF EXISTS \`${db}\``);
      }
      await root.query("DROP USER IF EXISTS ?@'%'", [appUser]);
    }

    beforeAll(async () => {
      dir = scaffoldProject(tmp, project, preset);
      const compose = fs.readFileSync(path.join(dir, "docker-compose.yml"), "utf8");
      const composeValue = (key: string) => compose.match(new RegExp(`${key}: (\\S+)`))![1];
      dbName = composeValue("MYSQL_DATABASE");
      appUser = composeValue("MYSQL_USER");
      const appPassword = composeValue("MYSQL_PASSWORD");

      const rootUrl = new URL(MYSQL_URL!);
      const env = fs.readFileSync(path.join(dir, ".env.example"), "utf8");
      fs.writeFileSync(
        path.join(dir, ".env"),
        env
          .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${serverUrl(appUser, appPassword, dbName)}`)
          .replace(
            /^DATABASE_SUPERUSER_URL=.*$/m,
            `DATABASE_SUPERUSER_URL=${serverUrl(rootUrl.username, rootUrl.password, dbName)}`,
          ),
      );

      // Install the workspace builds of the Stratum packages, so the test
      // checks the code under test even before it is on npm.
      const pkgPath = path.join(dir, "package.json");
      useWorkspaceStratumPackages(dir, tmp);
      run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], dir);

      // The database server as the generated docker-compose.yml sets it up:
      // the database, its user with all privileges on it, then init.sql as root.
      root = await mysql.createConnection({ uri: MYSQL_URL, multipleStatements: true });
      await cleanup();
      await root.query(`CREATE DATABASE \`${dbName}\``);
      await root.query("CREATE USER ?@'%' IDENTIFIED BY ?", [appUser, appPassword]);
      await root.query(`GRANT ALL ON \`${dbName.replace(/_/g, "\\_")}\`.* TO ?@'%'`, [appUser]);
      await root.query(`USE \`${dbName}\``);
      await root.query(fs.readFileSync(path.join(dir, "init.sql"), "utf8"));

      // Add a tenant table, as the generated files say to.
      const tenantSql = path.join(dir, "sql/tenant.sql");
      const scripts = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> }).scripts;
      if (fs.existsSync(tenantSql)) {
        const perTable = fs.readFileSync(tenantSql, "utf8").includes("{slug}");
        fs.appendFileSync(tenantSql, `\nCREATE TABLE \`items${perTable ? "_{slug}" : ""}\` ${ITEMS_COLUMNS};\n`);
        if (perTable) {
          const helperPath = path.join(dir, "src/stratum-db.ts");
          const helper = fs.readFileSync(helperPath, "utf8");
          expect(helper).toContain('BASE_TABLES = ["notes"]');
          fs.writeFileSync(helperPath, helper.replace('BASE_TABLES = ["notes"]', 'BASE_TABLES = ["notes", "items"]'));
        }
      } else {
        // The project describes no tenant tables: create the table once.
        await root.query(`CREATE TABLE items ${ITEMS_COLUMNS}`);
      }

      if (scripts["tenant:provision"]) {
        run("npm", ["run", "tenant:provision", "--", TENANT_A, slugs[0]], dir);
        run("npm", ["run", "tenant:provision", "--", TENANT_B, slugs[1]], dir);
      }
    }, 900_000);

    afterAll(async () => {
      if (root) {
        await cleanup();
        await root.end();
      }
    });

    it("type-checks", () => {
      run("npx", ["tsc", "--noEmit", "-p", "."], dir);
    }, 120_000);

    it("keeps each tenant's rows away from the other tenant", () => {
      const check = path.join(dir, "isolation-check.ts");
      fs.writeFileSync(check, CHECK);
      const out = run("npx", ["tsx", "--env-file=.env", check, TENANT_A, TENANT_B], dir);
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      expect(line, out).toBeDefined();
      const result = JSON.parse(line!.slice("RESULT ".length)) as {
        aSees: string[];
        aUpdated: number;
        bBody: string | null;
      };
      expect(result).toEqual({ aSees: ["a-note"], aUpdated: 0, bBody: "b-secret", caseVariant: "refused" });
    }, 120_000);

    it("refuses a tenant ID that does not fit before it creates anything", async () => {
      const res = spawnSync("npm", ["run", "tenant:provision", "--", "x".repeat(37), slugs[2]], {
        cwd: dir,
        encoding: "utf8",
        env: CHILD_ENV,
      });
      expect(res.status, res.stdout + res.stderr).not.toBe(0);
      expect(res.stderr).toMatch(/Invalid tenant ID/);
      expect(await leftovers(slugs[2])).toEqual({ databases: [], tables: [], records: [] });
    }, 120_000);

    it("removes what a failed run created, so it can run again", async () => {
      const tenantSql = path.join(dir, "sql/tenant.sql");
      const original = fs.readFileSync(tenantSql, "utf8");
      fs.appendFileSync(tenantSql, "\nCREATE TABLE broken (;\n");
      let res;
      try {
        res = spawnSync("npm", ["run", "tenant:provision", "--", TENANT_C, slugs[2]], {
          cwd: dir,
          encoding: "utf8",
          env: CHILD_ENV,
        });
      } finally {
        fs.writeFileSync(tenantSql, original);
      }
      expect(res.status, res.stdout + res.stderr).not.toBe(0);
      expect(await leftovers(slugs[2])).toEqual({ databases: [], tables: [], records: [] });
      run("npm", ["run", "tenant:provision", "--", TENANT_C, slugs[2]], dir);
      expect((await leftovers(slugs[2])).records).toEqual([TENANT_C]);
    }, 120_000);

    /** What exists for a slug: its tenant database, its tenant tables, and its _stratum_tenants record. */
    async function leftovers(slug: string): Promise<{ databases: string[]; tables: string[]; records: string[] }> {
      const [dbs] = await root.query<mysql.RowDataPacket[]>(
        "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
        [`stratum_tenant_${slug}`],
      );
      const [tables] = await root.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE ?",
        [dbName, `%\\_${slug}`],
      );
      const [records] = await root.query<mysql.RowDataPacket[]>(
        `SELECT id FROM \`${dbName}\`._stratum_tenants WHERE slug = ?`,
        [slug],
      );
      return {
        databases: dbs.map((r) => r.name as string),
        tables: tables.map((r) => r.name as string),
        records: records.map((r) => r.id as string),
      };
    }

    it("gives the app user no DDL rights and only read access to _stratum_tenants", async () => {
      const appUrl = fs.readFileSync(path.join(dir, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)![1];
      const app = await mysql.createConnection({ uri: appUrl });
      const tenantTable =
        strategy === "database" ? `\`stratum_tenant_${slugs[0]}\`.notes` : `\`notes_${slugs[0]}\``;
      const statements: Record<string, string> = {
        "select _stratum_tenants": "SELECT slug FROM _stratum_tenants",
        "insert _stratum_tenants": "INSERT INTO _stratum_tenants (id, name, slug) VALUES ('x', 'x', 'x')",
        "update _stratum_tenants": "UPDATE _stratum_tenants SET slug = slug",
        "delete _stratum_tenants": "DELETE FROM _stratum_tenants",
        "alter _stratum_tenants": "ALTER TABLE _stratum_tenants ADD COLUMN extra INT",
        "drop _stratum_tenants": "DROP TABLE _stratum_tenants",
        "create table": "CREATE TABLE app_probe (id INT)",
        "create database": `CREATE DATABASE \`${PREFIX}myprobe\``,
        "select tenant table": `SELECT * FROM ${tenantTable}`,
        "alter tenant table": `ALTER TABLE ${tenantTable} ADD COLUMN extra INT`,
        "drop tenant table": `DROP TABLE ${tenantTable}`,
      };
      const outcome: Record<string, string> = {};
      try {
        for (const [name, sql] of Object.entries(statements)) {
          outcome[name] = await app.query(sql).then(
            () => "allowed",
            (err: { code?: string }) => `refused ${err.code}`,
          );
        }
      } finally {
        await app.end();
        await root.query(`DROP DATABASE IF EXISTS \`${PREFIX}myprobe\``);
      }
      const refused = (name: string) => [name, expect.stringMatching(/^refused /)];
      expect(outcome).toEqual(
        Object.fromEntries([
          ["select _stratum_tenants", "allowed"],
          ["select tenant table", "allowed"],
          ...Object.keys(statements)
            .filter((n) => !n.startsWith("select"))
            .map(refused),
        ]),
      );
    });
  });
}
