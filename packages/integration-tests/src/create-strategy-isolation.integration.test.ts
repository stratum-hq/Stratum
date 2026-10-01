import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate, Stratum } from "@stratum-hq/lib";
import { scaffoldProject } from "./helpers/create-cli.js";
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

const PACKAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKSPACE_PACKAGES = ["core", "lib", "db-adapters"];
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
console.log("RESULT " + JSON.stringify({ aSees, aUpdated, bBody }));
process.exit(0);
`;

let tmp: string;
let admin: pg.Client;
const tarballs: Record<string, string> = {};

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
  for (const name of WORKSPACE_PACKAGES) {
    const [packed] = JSON.parse(
      run("npm", ["pack", "--json", "--pack-destination", tmp], path.join(PACKAGES_DIR, name)),
    ) as { filename: string }[];
    tarballs[`@stratum-hq/${name}`] = `file:${path.join(tmp, packed.filename)}`;
  }
}, 120_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function isolationSuite(strategy: "rls" | "schema" | "database", orm: "prisma" | "pg"): void {
  const preset = `postgres-${strategy}-${orm}-none`;
  const project = `${PREFIX}iso-${strategy}-${orm}`.replace(/_/g, "-");
  const dbName = project.replace(/-/g, "_");
  const control = `${PREFIX}iso_${strategy}_${orm}_control`;
  const slugs = [`${PREFIX}iso${strategy[0]}${orm[0]}a`, `${PREFIX}iso${strategy[0]}${orm[0]}b`];

  describe(`generated ${preset} project`, () => {
    let dir: string;
    let roles: { boot: string; app: string; stratum: string };
    let tenants: [string, string];

    beforeAll(async () => {
      dir = scaffoldProject(tmp, project, preset);
      const env = fs.readFileSync(path.join(dir, ".env.example"), "utf8");
      const read = (key: string) => new URL(env.match(new RegExp(`^${key}=(.*)$`, "m"))![1]);
      const app = read("DATABASE_URL");
      const stratum = read("STRATUM_ADMIN_DATABASE_URL");
      const boot = read("DATABASE_SUPERUSER_URL");
      roles = { boot: boot.username, app: app.username, stratum: stratum.username };
      const urls = {
        app: urlFor(dbName, app.username, app.password),
        stratum: urlFor(dbName, stratum.username, stratum.password),
        boot: urlFor(dbName, boot.username, boot.password),
      };
      fs.writeFileSync(
        path.join(dir, ".env"),
        env
          .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${urls.app}`)
          .replace(/^DATABASE_SUPERUSER_URL=.*$/m, `DATABASE_SUPERUSER_URL=${urls.boot}`)
          .replace(/^STRATUM_ADMIN_DATABASE_URL=.*$/m, `STRATUM_ADMIN_DATABASE_URL=${urls.stratum}`),
      );

      // Install the workspace builds of the Stratum packages, so the test
      // checks the code under test even before it is on npm.
      const pkgPath = path.join(dir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        dependencies: Record<string, string>;
        overrides?: Record<string, string>;
      };
      for (const [name, spec] of Object.entries(tarballs)) pkg.dependencies[name] = spec;
      pkg.overrides = { ...pkg.overrides, "@stratum-hq/core": "$@stratum-hq/core" };
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], dir);

      // Add a tenant-scoped table, as the generated files say to.
      if (orm === "prisma") {
        fs.appendFileSync(path.join(dir, "prisma/schema.prisma"), PRISMA_MODEL);
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

      const scripts = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> }).scripts;
      if (scripts["tenant:provision"]) {
        // The project provisions each Stratum tenant: create the tenants with
        // Stratum, then run the provisioning script for each one.
        const appPool = new pg.Pool({ connectionString: urls.app, max: 1 });
        const stratumPool = new pg.Pool({ connectionString: urls.stratum, max: 2 });
        try {
          await migrate({ pool: stratumPool, controlRole: control, applyControlRole: true });
          const s = new Stratum({ pool: appPool, adminPool: stratumPool, controlRole: control });
          const ids: string[] = [];
          for (const slug of slugs) ids.push((await s.createTenant({ name: slug, slug })).id);
          tenants = [ids[0], ids[1]];
        } finally {
          await appPool.end();
          await stratumPool.end();
        }
        for (const id of tenants) run("npm", ["run", "tenant:provision", "--", id], dir);
      } else if (scripts["db:push"]) {
        // The project keeps a row-level security policy per tenant-scoped
        // table in prisma/rls.sql: add the same statements for the new table.
        tenants = [FIXED_A, FIXED_B];
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
          run("npx", ["prisma", "db", "push", "--skip-generate"], dir, { ...CHILD_ENV, DATABASE_URL: urls.boot });
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
      for (const db of [dbName, ...slugs.map((s) => `stratum_tenant_${s}`)]) {
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
      expect(result).toEqual({ aSees: ["a-note"], aUpdated: 0, bBody: "b-secret" });
    }, 120_000);
  });
}

isolationSuite("rls", "prisma");
isolationSuite("schema", "prisma");
isolationSuite("database", "prisma");
isolationSuite("schema", "pg");
isolationSuite("database", "pg");
