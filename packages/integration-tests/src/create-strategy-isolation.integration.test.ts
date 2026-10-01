import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { migrate, Stratum } from "@stratum-hq/lib";
import { scaffoldProject } from "./helpers/create-cli.js";
import { useWorkspaceStratumPackages } from "./helpers/workspace-tarballs.js";
import { ROLE_PREFIX, dropTestRole } from "./helpers/role-model.js";

/**
 * Generates schema-per-tenant, database-per-tenant and row-level security
 * PostgreSQL presets with the built `@stratum-hq/create`, installs them with
 * the workspace builds of the Stratum packages, adds a tenant-scoped table as
 * the generated files say to, follows the setup the generated project
 * describes, and then uses the generated tenant helper as the application
 * role. Tenant A must not read or change tenant B's rows.
 *
 * Roles and databases are cluster-wide, so every name carries the test role
 * prefix. Installs run one at a time and need network access to the npm
 * registry for the third-party packages.
 */

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const PREFIX = ROLE_PREFIX.replace(/[^a-z0-9_]/g, "");

// Fixed tenant IDs, used when the generated project needs no Stratum tenant.
const FIXED_A = "00000000-0000-4000-8000-00000000000a";
const FIXED_B = "00000000-0000-4000-8000-00000000000b";

const PRISMA_MODEL = `
model Item {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id") @db.Uuid
  body     String

  @@map("items")
}
`;

const ITEMS_TABLE = `CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  body text NOT NULL
);
`;

const PRISMA_CHECK = `
const h: any = await import("./src/stratum-prisma.js");
const forTenant = async (id: string) =>
  h.getTenantPrisma ? await h.getTenantPrisma(id) : h.createTenantPrisma(() => id);
const [A, B] = process.argv.slice(2);
const a = await forTenant(A);
const b = await forTenant(B);
const bRow = await b.item.create({ data: { tenantId: B, body: "b-secret" } });
await a.item.create({ data: { tenantId: A, body: "a-note" } });
const aSees = (await a.item.findMany()).map((r: any) => r.body).sort();
const aUpdated = (await a.item.updateMany({ where: { id: bRow.id }, data: { body: "changed-by-a" } })).count;
const bBody = (await b.item.findUnique({ where: { id: bRow.id } }))?.body ?? null;
console.log("RESULT " + JSON.stringify({ aSees, aUpdated, bBody }));
process.exit(0);
`;

const PG_CHECK = `
const h: any = await import("./src/stratum-db.js");
const q = async (id: string, sql: string, params: unknown[] = []) =>
  h.tenantQuery ? await h.tenantQuery(id, sql, params) : await h.getTenantPool(id).query(sql, params);
const [A, B] = process.argv.slice(2);
const bRow = (await q(B, "INSERT INTO items (tenant_id, body) VALUES ($1, 'b-secret') RETURNING id", [B])).rows[0];
await q(A, "INSERT INTO items (tenant_id, body) VALUES ($1, 'a-note')", [A]);
const aSees = (await q(A, "SELECT body FROM items")).rows.map((r: any) => r.body).sort();
const aUpdated = (await q(A, "UPDATE items SET body = 'changed-by-a' WHERE id = $1", [bRow.id])).rowCount;
const bBody = (await q(B, "SELECT body FROM items WHERE id = $1", [bRow.id])).rows[0]?.body ?? null;
// DATABASE_URL carries sslmode and application_name: the tenant's connection keeps them.
const appName = (await q(A, "SHOW application_name")).rows[0].application_name;
console.log("RESULT " + JSON.stringify({ aSees, aUpdated, bBody, appName }));
process.exit(0);
`;

// What a tenant reads from items, or "refused" when the helper refuses the tenant.
const PRISMA_SEES = `
const h: any = await import("./src/stratum-prisma.js");
const sees = await h
  .getTenantPrisma(process.argv[2])
  .then((p: any) => p.item.findMany())
  .then((rows: any[]) => rows.map((r) => r.body).sort(), () => "refused");
console.log("SEES " + JSON.stringify(sees));
process.exit(0);
`;

const PG_SEES = `
const h: any = await import("./src/stratum-db.js");
const sees = await h
  .tenantQuery(process.argv[2], "SELECT body FROM items")
  .then((r: any) => r.rows.map((row: any) => row.body).sort(), () => "refused");
console.log("SEES " + JSON.stringify(sees));
process.exit(0);
`;

const APP_NAME = `${ROLE_PREFIX.replace(/[^a-z0-9_]/g, "")}iso_app`;

let tmp: string;
let admin: pg.Client;

// The generated project reads its settings from its .env file. Node and
// Prisma let a variable already in the environment win over .env, so child
// processes start without the ones the test runner may have set.
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env };
for (const key of ["DATABASE_URL", "DATABASE_SUPERUSER_URL", "STRATUM_ADMIN_DATABASE_URL"]) delete CHILD_ENV[key];

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = CHILD_ENV): string {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

function urlFor(db: string, user: string, password: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${db}`;
  u.username = user;
  u.password = password;
  return u.toString();
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-isolation-"));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function isolationSuite(strategy: "rls" | "schema" | "database", orm: "prisma" | "pg"): void {
  const preset = `postgres-${strategy}-${orm}-none`;
  const project = `${PREFIX}iso-${strategy}-${orm}`.replace(/_/g, "-");
  const dbName = project.replace(/-/g, "_");
  const control = `${PREFIX}iso_${strategy}_${orm}_control`;
  const slugs = [
    `${PREFIX}iso${strategy[0]}${orm[0]}a`,
    `${PREFIX}iso${strategy[0]}${orm[0]}b`,
    `${PREFIX}iso${strategy[0]}${orm[0]}c`,
    `${PREFIX}iso${strategy[0]}${orm[0]}d`,
  ];

  describe(`generated ${preset} project`, () => {
    let dir: string;
    let roles: { boot: string; app: string; stratum: string };
    let tenants: [string, string];
    let stratumMigrated = false;
    let urls: Record<"app" | "stratum" | "boot", string>;

    beforeAll(async () => {
      dir = scaffoldProject(tmp, project, preset);
      const env = fs.readFileSync(path.join(dir, ".env.example"), "utf8");
      const read = (key: string) => new URL(env.match(new RegExp(`^${key}=(.*)$`, "m"))![1]);
      const app = read("DATABASE_URL");
      const stratum = read("STRATUM_ADMIN_DATABASE_URL");
      const boot = read("DATABASE_SUPERUSER_URL");
      roles = { boot: boot.username, app: app.username, stratum: stratum.username };
      urls = {
        app: urlFor(dbName, app.username, app.password),
        stratum: urlFor(dbName, stratum.username, stratum.password),
        boot: urlFor(dbName, boot.username, boot.password),
      };
      fs.writeFileSync(
        path.join(dir, ".env"),
        env
          .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${urls.app}?sslmode=disable&application_name=${APP_NAME}`)
          .replace(/^DATABASE_SUPERUSER_URL=.*$/m, `DATABASE_SUPERUSER_URL=${urls.boot}`)
          .replace(/^STRATUM_ADMIN_DATABASE_URL=.*$/m, `STRATUM_ADMIN_DATABASE_URL=${urls.stratum}`),
      );

      // Install the workspace builds of the Stratum packages, so the test
      // checks the code under test even before it is on npm.
      const pkgPath = path.join(dir, "package.json");
      useWorkspaceStratumPackages(dir, tmp);
      run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], dir);

      // Add a tenant-scoped table, as the generated files say to. A Prisma
      // schema that lists its database schemas needs one on every model.
      if (orm === "prisma") {
        const schemaPath = path.join(dir, "prisma/schema.prisma");
        const dbSchema = fs.readFileSync(schemaPath, "utf8").match(/^\s*schemas\s*=\s*\["(\w+)"\]/m)?.[1];
        fs.appendFileSync(
          schemaPath,
          dbSchema ? PRISMA_MODEL.replace(/\n}\n$/, `\n  @@schema("${dbSchema}")\n}\n`) : PRISMA_MODEL,
        );
        run("npx", ["prisma", "generate"], dir);
      } else if (fs.existsSync(path.join(dir, "sql/tenant.sql"))) {
        fs.appendFileSync(path.join(dir, "sql/tenant.sql"), `\n${ITEMS_TABLE}`);
      }

      // The database server: the bootstrap superuser of the generated compose
      // file, its database, and the generated init.sql.
      admin = new pg.Client({ connectionString: BASE_URL });
      await admin.connect();
      await cleanup();
      await admin.query(`CREATE ROLE "${roles.boot}" WITH LOGIN SUPERUSER PASSWORD '${decodeURIComponent(boot.password)}'`);
      await admin.query(`CREATE DATABASE "${dbName}" OWNER "${roles.boot}"`);
      const initSql = fs
        .readFileSync(path.join(dir, "init.sql"), "utf8")
        .replace(/\bstratum_control\b/g, control);
      const bootClient = new pg.Client({ connectionString: urls.boot });
      await bootClient.connect();
      try {
        await bootClient.query(initSql);
      } finally {
        await bootClient.end();
      }

      // Create Stratum's tables and the two tenants with Stratum, as the
      // generated README says to before the project's own setup.
      async function createStratumTenants(): Promise<[string, string]> {
        const appPool = new pg.Pool({ connectionString: urls.app, max: 1 });
        const stratumPool = new pg.Pool({ connectionString: urls.stratum, max: 2 });
        try {
          await migrate({ pool: stratumPool, controlRole: control, applyControlRole: true });
          const s = new Stratum({ pool: appPool, adminPool: stratumPool, controlRole: control });
          const ids: string[] = [];
          for (const slug of slugs.slice(0, 2)) ids.push((await s.createTenant({ name: slug, slug })).id);
          return [ids[0], ids[1]];
        } finally {
          await appPool.end();
          await stratumPool.end();
        }
      }

      const scripts = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> }).scripts;
      if (scripts["tenant:provision"]) {
        // The project provisions each Stratum tenant: create the tenants with
        // Stratum, then run the provisioning script for each one.
        stratumMigrated = true;
        tenants = await createStratumTenants();
        for (const id of tenants) run("npm", ["run", "tenant:provision", "--", id], dir);
      } else if (scripts["db:push"]) {
        // The project keeps a row-level security policy per tenant-scoped
        // table in prisma/rls.sql: add the same statements for the new table.
        // Stratum's tables are already there when the project pushes its own.
        stratumMigrated = true;
        tenants = await createStratumTenants();
        const rlsPath = path.join(dir, "prisma/rls.sql");
        const statements = fs
          .readFileSync(rlsPath, "utf8")
          .split("\n")
          .filter((line) => !line.startsWith("--"))
          .join("\n")
          .replace(/\bnotes\b/g, "items");
        fs.appendFileSync(rlsPath, `\n${statements}`);
        run("npm", ["run", "db:push"], dir);
      } else {
        // The project describes no provisioning: create the table once, as
        // the superuser that runs migrations.
        tenants = [FIXED_A, FIXED_B];
        if (orm === "prisma") {
          run("npx", ["prisma", "db", "push"], dir, { ...CHILD_ENV, DATABASE_URL: urls.boot });
        } else {
          const c = new pg.Client({ connectionString: urls.boot });
          await c.connect();
          try {
            await c.query(ITEMS_TABLE);
          } finally {
            await c.end();
          }
        }
      }
    }, 900_000);

    async function cleanup(): Promise<void> {
      for (const db of [dbName, ...[...slugs, `${slugs[0]}r`].map((s) => `stratum_tenant_${s}`)]) {
        await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      }
      if (roles) {
        for (const role of [roles.app, roles.stratum, control, roles.boot]) await dropTestRole(admin, role);
      }
    }

    afterAll(async () => {
      if (admin) {
        await cleanup();
        await admin.end();
      }
    });

    it("gives the app role no right to create schemas or databases", async () => {
      const r = await admin.query<{ create: boolean; createdb: boolean }>(
        `SELECT has_database_privilege($1, $2, 'CREATE') AS create,
                (SELECT rolcreatedb FROM pg_roles WHERE rolname = $1) AS createdb`,
        [roles.app, dbName],
      );
      expect(r.rows[0]).toEqual({ create: false, createdb: false });
    });

    it("keeps Stratum's tables and rows through the project's setup", async () => {
      if (!stratumMigrated) return;
      const c = new pg.Client({ connectionString: urls.stratum });
      await c.connect();
      try {
        const r = await c.query<{ slug: string }>("SELECT slug FROM tenants ORDER BY slug");
        expect(r.rows.map((row) => row.slug)).toEqual(slugs.slice(0, 2).sort());
      } finally {
        await c.end();
      }
    });

    it("keeps .env, node_modules and the generated Prisma client out of git, and .env.example in it", () => {
      run("git", ["init", "-q"], dir);
      const ignored = (file: string) =>
        spawnSync("git", ["check-ignore", "-q", file], { cwd: dir, env: CHILD_ENV }).status === 0;
      expect(fs.existsSync(path.join(dir, ".env"))).toBe(true);
      expect(ignored(".env")).toBe(true);
      expect(ignored("node_modules")).toBe(true);
      expect(ignored(".env.example")).toBe(false);
      expect(ignored("src/stratum-tenant.ts")).toBe(false);
      if (orm === "prisma") {
        expect(fs.existsSync(path.join(dir, "src/generated/prisma/client.ts"))).toBe(true);
        expect(ignored("src/generated/prisma/client.ts")).toBe(true);
      }
    });

    it("type-checks", () => {
      run("npx", ["tsc", "--noEmit", "-p", "."], dir);
    }, 120_000);

    it("keeps each tenant's rows away from the other tenant", () => {
      const check = path.join(dir, "isolation-check.ts");
      fs.writeFileSync(check, orm === "prisma" ? PRISMA_CHECK : PG_CHECK);
      const out = run("npx", ["tsx", "--env-file=.env", check, tenants[0], tenants[1]], dir);
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      expect(line, out).toBeDefined();
      const result = JSON.parse(line!.slice("RESULT ".length)) as {
        aSees: string[];
        aUpdated: number;
        bBody: string | null;
      };
      expect(result).toEqual({
        aSees: ["a-note"],
        aUpdated: 0,
        bBody: "b-secret",
        ...(orm === "pg" && { appName: APP_NAME }),
      });
    }, 120_000);

    it("removes what a failed provisioning run created, so it can run again", async () => {
      if (strategy === "rls") return;
      const appPool = new pg.Pool({ connectionString: urls.app, max: 1 });
      const stratumPool = new pg.Pool({ connectionString: urls.stratum, max: 2 });
      let tenantD: string;
      try {
        const s = new Stratum({ pool: appPool, adminPool: stratumPool, controlRole: control });
        tenantD = (await s.createTenant({ name: slugs[3], slug: slugs[3] })).id;
      } finally {
        await appPool.end();
        await stratumPool.end();
      }
      const source = path.join(dir, orm === "prisma" ? "prisma/schema.prisma" : "sql/tenant.sql");
      const original = fs.readFileSync(source, "utf8");
      fs.appendFileSync(source, orm === "prisma" ? "\nmodel Broken {\n" : "\nCREATE TABLE broken (;\n");
      let failed;
      try {
        failed = spawnSync("npm", ["run", "tenant:provision", "--", tenantD], { cwd: dir, encoding: "utf8", env: CHILD_ENV });
      } finally {
        fs.writeFileSync(source, original);
      }
      expect(failed.status, failed.stdout + failed.stderr).not.toBe(0);
      const leftovers = async () => {
        const r = await admin.query<{ databases: string[] }>(
          `SELECT ARRAY(SELECT datname::text FROM pg_database WHERE datname = $1) AS databases`,
          [`stratum_tenant_${slugs[3]}`],
        );
        const c = new pg.Client({ connectionString: urls.boot });
        await c.connect();
        try {
          const schemas = await c.query<{ nspname: string }>("SELECT nspname FROM pg_namespace WHERE nspname = $1", [
            `tenant_${slugs[3]}`,
          ]);
          const records = await c.query<{ tenant_id: string }>(
            "SELECT tenant_id FROM provisioned_tenants WHERE slug = $1",
            [slugs[3]],
          );
          return {
            databases: r.rows[0].databases,
            schemas: schemas.rows.map((row) => row.nspname),
            records: records.rows.map((row) => row.tenant_id),
          };
        } finally {
          await c.end();
        }
      };
      expect(await leftovers()).toEqual({ databases: [], schemas: [], records: [] });
      run("npm", ["run", "tenant:provision", "--", tenantD], dir);
      expect((await leftovers()).records).toEqual([tenantD]);
    }, 300_000);

    it("routes a renamed tenant to its own data, and a tenant that took its old slug only to its own", async () => {
      if (strategy === "rls") return;
      // Rename A, then create C with A's old slug, as Stratum allows.
      const appPool = new pg.Pool({ connectionString: urls.app, max: 1 });
      const stratumPool = new pg.Pool({ connectionString: urls.stratum, max: 2 });
      let tenantC: string;
      try {
        const s = new Stratum({ pool: appPool, adminPool: stratumPool, controlRole: control });
        await s.updateTenant(tenants[0], { slug: `${slugs[0]}r` });
        tenantC = (await s.createTenant({ name: slugs[0], slug: slugs[0] })).id;
      } finally {
        await appPool.end();
        await stratumPool.end();
      }
      const check = path.join(dir, "rename-check.ts");
      fs.writeFileSync(check, orm === "prisma" ? PRISMA_SEES : PG_SEES);
      const sees = (id: string) => {
        const out = run("npx", ["tsx", "--env-file=.env", check, id], dir);
        const line = out.split("\n").find((l) => l.startsWith("SEES "));
        expect(line, out).toBeDefined();
        return JSON.parse(line!.slice("SEES ".length)) as string[] | string;
      };

      // Before C is provisioned, it reaches nothing; A still reaches its own rows.
      expect({ a: sees(tenants[0]), c: sees(tenantC) }).toEqual({ a: ["a-note"], c: "refused" });

      // C's slug names A's ${strategy}, so provisioning C under it is refused.
      const refused = spawnSync("npm", ["run", "tenant:provision", "--", tenantC], {
        cwd: dir,
        encoding: "utf8",
        env: CHILD_ENV,
      });
      expect(refused.status, refused.stdout + refused.stderr).not.toBe(0);
      expect({ a: sees(tenants[0]), c: sees(tenantC) }).toEqual({ a: ["a-note"], c: "refused" });

      // Provisioned under another name, C reaches only its own, empty ${strategy}.
      run("npm", ["run", "tenant:provision", "--", tenantC, slugs[2]], dir);
      expect({ a: sees(tenants[0]), c: sees(tenantC) }).toEqual({ a: ["a-note"], c: [] });
    }, 300_000);
  });
}

isolationSuite("rls", "prisma");
isolationSuite("schema", "prisma");
isolationSuite("database", "prisma");
isolationSuite("schema", "pg");
isolationSuite("database", "pg");
