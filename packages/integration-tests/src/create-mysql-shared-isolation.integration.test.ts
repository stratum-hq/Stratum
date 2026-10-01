import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { scaffoldProject } from "./helpers/create-cli.js";
import { useWorkspaceStratumPackages } from "./helpers/workspace-tarballs.js";
import { ROLE_PREFIX } from "./helpers/role-model.js";

/**
 * Generates the MySQL shared-table presets with the built
 * `@stratum-hq/create`, installs them with the workspace builds of the Stratum
 * packages, and sets up a MySQL server as the generated docker-compose.yml and
 * init.sql do. Then it uses the generated tenant helper as the app user:
 * tenant A must not read, change or delete tenant B's rows. It also starts the
 * generated Express server, which must refuse a token that does not verify.
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

/**
 * The tenant operations of each preset, through its generated helper only.
 * insert() takes a row that names tenant B as its tenant_id, to show that the
 * helper writes the caller's tenant whatever the row says.
 */
const OPS: Record<string, string> = {
  pg: `
const { tenantDb } = await import("./src/stratum-db.js");
const ops = {
  insert: (t: string, body: string, claimed?: string) =>
    tenantDb(t).insert("notes", claimed ? { body, tenant_id: claimed } : { body }),
  list: async (t: string) => ((await tenantDb(t).select("notes")) as any[]).map((r) => r.body),
  idOf: async (t: string, body: string) => ((await tenantDb(t).select("notes", { body })) as any[])[0].id,
  update: async (t: string, id: unknown, body: string) =>
    ((await tenantDb(t).update("notes", { body }, { id })) as any)[0].affectedRows,
  remove: async (t: string, id: unknown) => ((await tenantDb(t).delete("notes", { id })) as any)[0].affectedRows,
  // MysqlSharedAdapter has no join or upsert; its conditions are equality only.
  refused: async (t: string) => tenantDb(t).update("notes", { tenant_id: "${TENANT_B}" }, { body: "a-note" }),
};
`,
  knex: `
const { tenantKnex } = await import("./src/stratum-knex.js");
const ops = {
  insert: (t: string, body: string, claimed?: string) =>
    tenantKnex(t)("notes").insert(claimed ? { body, tenant_id: claimed } : { body }),
  list: async (t: string) => ((await tenantKnex(t)("notes").select("body")) as any[]).map((r) => r.body),
  idOf: async (t: string, body: string) => ((await tenantKnex(t)("notes").select("id").where("body", body)) as any[])[0].id,
  update: (t: string, id: unknown, body: string) => tenantKnex(t)("notes").where("id", id as number).update({ body }),
  remove: (t: string, id: unknown) => tenantKnex(t)("notes").where("id", id as number).delete(),
  // A join would read the joined table without the tenant condition.
  refused: async (t: string) => tenantKnex(t)("notes").join("notes as other", "other.id", "notes.id").select("other.body"),
};
`,
  sequelize: `
const { withTenantScope, Note } = await import("./src/stratum-sequelize.js");
const ops = {
  insert: (t: string, body: string, claimed?: string) =>
    withTenantScope(t, (transaction) => Note.create(claimed ? { body, tenantId: claimed } : { body }, { transaction })),
  list: (t: string) =>
    withTenantScope(t, async (transaction) => (await Note.findAll({ transaction })).map((r: any) => r.get("body"))),
  idOf: (t: string, body: string) =>
    withTenantScope(t, async (transaction) => (await Note.findOne({ where: { body }, transaction }))!.get("id")),
  update: (t: string, id: unknown, body: string) =>
    withTenantScope(t, async (transaction) => (await Note.update({ body }, { where: { id: id as number }, transaction }))[0]),
  remove: (t: string, id: unknown) =>
    withTenantScope(t, (transaction) => Note.destroy({ where: { id: id as number }, transaction })),
  // MySQL applies ON DUPLICATE KEY UPDATE on any unique key, so upsert could change another tenant's row.
  refused: (t: string) => withTenantScope(t, (transaction) => Note.upsert({ id: 1, body: "x" }, { transaction })),
};
`,
};

const CHECK = `
const [A, B] = process.argv.slice(2);
const outcome = (p: Promise<unknown>) => p.then(() => "allowed", (e: Error) => "refused: " + e.message);
await ops.insert(B, "b-secret");
await ops.insert(A, "a-note");
const forgedInsert = await outcome(ops.insert(A, "a-claims-b", B));
const bId = await ops.idOf(B, "b-secret");
const result = {
  forgedInsert,
  aSees: (await ops.list(A)).sort(),
  aUpdated: await ops.update(A, bId, "changed-by-a"),
  aDeleted: await ops.remove(A, bId),
  refused: (await outcome(ops.refused(A))).startsWith("refused") ? "refused" : "allowed",
  bSees: (await ops.list(B)).sort(),
  // ascii_bin ignores trailing spaces, so "A " would match A's rows.
  spaced: (await outcome(ops.list(A + " "))).replace(/^(refused: Invalid tenant ID).*/, "$1"),
  // ascii_bin compares letter case, so this ID names no tenant's rows.
  caseVariant: await ops.list(A.toUpperCase()),
};
console.log("RESULT " + JSON.stringify(result));
process.exit(0);
`;

let tmp: string;

// The generated project reads its settings from its .env file. Node lets a
// variable already in the environment win over .env.
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env };
for (const key of ["DATABASE_URL", "DATABASE_SUPERUSER_URL", "JWT_SECRET", "PORT"]) delete CHILD_ENV[key];

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

/** An HS256 JWT signed with secret. */
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}`;
  return `${unsigned}.${crypto.createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

describe.skipIf(!MYSQL_URL)("generated MySQL shared-table presets", () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-mysql-shared-"));
  });

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  sharedSuite("knex");
  sharedSuite("sequelize");
  sharedSuite("pg");
});

function sharedSuite(orm: "knex" | "sequelize" | "pg"): void {
  const preset = `mysql-shared-${orm}-express`;
  const project = `${PREFIX}myshared-${orm}`.replace(/_/g, "-");

  describe(`generated ${preset} project`, () => {
    let dir: string;
    let root: mysql.Connection;
    let dbName: string;
    let appUser: string;

    async function cleanup(): Promise<void> {
      await root.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
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

    it("keeps each tenant's rows away from the other tenant", async () => {
      const check = path.join(dir, "isolation-check.ts");
      fs.writeFileSync(check, OPS[orm] + CHECK);
      const out = run("npx", ["tsx", "--env-file=.env", check, TENANT_A, TENANT_B], dir);
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      expect(line, out).toBeDefined();
      const result = JSON.parse(line!.slice("RESULT ".length)) as { forgedInsert: string };

      // The helper either writes A's tenant_id over the claimed one or refuses the row.
      const aRows = result.forgedInsert === "allowed" ? ["a-claims-b", "a-note"] : ["a-note"];
      expect(result).toEqual({
        forgedInsert: result.forgedInsert,
        aSees: aRows,
        aUpdated: 0,
        aDeleted: 0,
        refused: "refused",
        bSees: ["b-secret"],
        spaced: "refused: Invalid tenant ID",
        caseVariant: [],
      });

      // What the table holds, read as root without any helper.
      const [rows] = await root.query<mysql.RowDataPacket[]>(
        `SELECT tenant_id, body FROM \`${dbName}\`.notes ORDER BY body`,
      );
      expect(rows.map((r) => [r.tenant_id, r.body])).toEqual([
        ...aRows.map((body) => [TENANT_A, body]),
        [TENANT_B, "b-secret"],
      ]);
    }, 120_000);

    it("gives the app user rows only: no DDL, no TRUNCATE", async () => {
      const appUrl = fs.readFileSync(path.join(dir, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)![1];
      const app = await mysql.createConnection({ uri: appUrl });
      const statements: Record<string, string> = {
        "select notes": "SELECT COUNT(*) FROM notes",
        "create table": "CREATE TABLE app_probe (id INT)",
        "create database": `CREATE DATABASE \`${PREFIX}mysharedprobe\``,
        "alter notes": "ALTER TABLE notes ADD COLUMN extra INT",
        "index notes": "CREATE INDEX probe_idx ON notes (body(10))",
        "truncate notes": "TRUNCATE TABLE notes",
        "drop notes": "DROP TABLE notes",
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
        await root.query(`DROP DATABASE IF EXISTS \`${PREFIX}mysharedprobe\``);
      }
      expect(outcome).toEqual(
        Object.fromEntries(
          Object.keys(statements).map((name) => [
            name,
            name.startsWith("select") ? "allowed" : expect.stringMatching(/^refused /),
          ]),
        ),
      );
    });

    it("takes the tenant from a verified token and refuses a forged one", async () => {
      const secret = fs.readFileSync(path.join(dir, ".env"), "utf8").match(/^JWT_SECRET=(.*)$/m)![1];
      const port = await freePort();
      const server: ChildProcess = spawn("npx", ["tsx", "--env-file=.env", "src/index.ts"], {
        cwd: dir,
        env: { ...CHILD_ENV, PORT: String(port) },
        stdio: "ignore",
        detached: true,
      });
      try {
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; ; i++) {
          const up = await fetch(`${base}/health`).then((r) => r.ok, () => false);
          if (up) break;
          if (i > 100) throw new Error("the generated server did not start");
          await new Promise((r) => setTimeout(r, 200));
        }
        const call = async (token: string) => {
          const res = await fetch(`${base}/tenants`, { headers: { authorization: `Bearer ${token}` } });
          return { status: res.status, tenantId: ((await res.json()) as { tenantId?: string }).tenantId ?? null };
        };
        const unsigned = signJwt({ tenant_id: TENANT_B }, secret).split(".").slice(0, 2).join(".") + ".";
        expect({
          verified: await call(signJwt({ tenant_id: TENANT_A }, secret)),
          otherSecret: await call(signJwt({ tenant_id: TENANT_B }, "not-the-secret")),
          unsigned: await call(unsigned),
        }).toEqual({
          verified: { status: 200, tenantId: TENANT_A },
          otherSecret: { status: 401, tenantId: null },
          unsigned: { status: 401, tenantId: null },
        });
        // A tenant header is not a tenant: without a token the server requires one.
        const headerOnly = await fetch(`${base}/tenants`, { headers: { "x-tenant-id": TENANT_B } });
        expect(headerOnly.status).toBe(401);
      } finally {
        // detached gives npx, tsx and node one process group, so one signal stops them all.
        process.kill(-server.pid!, "SIGTERM");
      }
    }, 120_000);
  });
}
