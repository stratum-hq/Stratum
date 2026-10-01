import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getDatabaseName, tenantSchemaName } from "@stratum-hq/db-adapters";
import { ROLE_PREFIX, dropTestRole, urlFor } from "./helpers/role-model.js";

/**
 * Runs the Prisma helpers of @stratum-hq/db-adapters with a real generated
 * Prisma 6 client and a real generated Prisma 7 client against real Postgres.
 * Prisma 7 has no `datasources` option, so its clients connect through
 * PrismaPg from @prisma/adapter-pg. Each tenant must reach only its own
 * schema, its own database, or its own rows.
 *
 * Each Prisma version installs in a temporary project, so the test needs
 * network access to the npm registry. Prisma 6 also downloads its query
 * engine. A child process in that project runs the workspace build of
 * @stratum-hq/db-adapters and prints what each tenant client saw.
 * Databases and roles are cluster-wide, so every name carries the test prefix.
 */

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";
const PACKAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DB_ADAPTERS = path.join(PACKAGES_DIR, "db-adapters/dist/index.js");
const PREFIX = ROLE_PREFIX.replace(/[^a-z0-9_]/g, "");
const TENANT_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const TENANT_B = "0b0b0b0b-0000-4000-8000-00000000000b";

const VERSIONS = [
  { major: 6, packages: ["prisma@6.19.3", "@prisma/client@6.19.3"] },
  { major: 7, packages: ["prisma@7.10.0", "@prisma/client@7.10.0", "@prisma/adapter-pg@7.10.0"] },
];

const ORDERS_TABLE = "CREATE TABLE orders (id text PRIMARY KEY, tenant_id text NOT NULL)";

function schemaFile(major: number): string {
  // Prisma 7 reads the connection URL from prisma.config.ts, not from the schema.
  const url = major >= 7 ? "" : '\n  url      = env("DATABASE_URL")';
  return `generator client {
  provider = "prisma-client-js"
  output   = "./client"
}

datasource db {
  provider = "postgresql"${url}
}

model Order {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")

  @@map("orders")
}
`;
}

// The application code under test. Prisma 5 and 6 take the datasource URL.
// Prisma 7 takes the driver adapter class.
const CHECK = `
const { PrismaClient } = require("./client");
const { SchemaPrismaAdapter, DatabasePrismaAdapter, prismaWithTenant } = require(process.env.DB_ADAPTERS);
const major = Number(process.env.PRISMA_MAJOR);
const PrismaPg = major >= 7 ? require("@prisma/adapter-pg").PrismaPg : undefined;
const [mode, url, a, b] = process.argv.slice(2);

async function useTenants(getClient, tenantOf) {
  await getClient(a).order.create({ data: { tenantId: tenantOf(a) } });
  await getClient(b).order.create({ data: { tenantId: tenantOf(b) } });
  const seen = {};
  for (const slug of [a, b]) seen[slug] = (await getClient(slug).order.findMany()).map((o) => o.tenantId);
  return seen;
}

async function main() {
  const options = PrismaPg ? { driverAdapter: PrismaPg } : 50;
  let seen;
  if (mode === "schema") {
    const adapter = new SchemaPrismaAdapter(PrismaClient, url, options);
    seen = await useTenants((s) => adapter.getClient(s), (s) => s);
    await adapter.disconnectAll();
  } else if (mode === "database") {
    const adapter = new DatabasePrismaAdapter({}, PrismaClient, url, options);
    seen = await useTenants((s) => adapter.getClient(s), (s) => s);
    await adapter.disconnectAll();
  } else {
    // "rls": a and b are tenant IDs, and url names the schema of the RLS table.
    const parsed = new URL(url);
    const schema = parsed.searchParams.get("schema");
    parsed.searchParams.delete("schema");
    const prisma = PrismaPg
      ? new PrismaClient({ adapter: new PrismaPg({ connectionString: parsed.toString() }, { schema }) })
      : new PrismaClient({ datasources: { db: { url } } });
    const clients = { [a]: prismaWithTenant(prisma, () => a, {}), [b]: prismaWithTenant(prisma, () => b, {}) };
    seen = await useTenants((t) => clients[t], (t) => t);
    await prisma.$disconnect();
  }
  console.log("SEEN " + JSON.stringify(seen));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

let tmp: string;
let admin: pg.Client;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-prisma-versions-"));
  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
});

afterAll(async () => {
  await admin?.end();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

for (const { major, packages } of VERSIONS) {
  describe(`Prisma ${major}`, () => {
    let dir: string;
    const schemaSlugs = [`${PREFIX}p${major}_sa`, `${PREFIX}p${major}_sb`];
    const dbSlugs = [`${PREFIX}p${major}_da`, `${PREFIX}p${major}_db`];
    const rlsSchema = `${PREFIX}p${major}_rls`;
    const appRole = `${PREFIX}p${major}_app`;

    function check(mode: string, url: string, a: string, b: string): Record<string, string[]> {
      const out = run("node", ["check.cjs", mode, url, a, b], dir, {
        ...process.env,
        DATABASE_URL: BASE_URL,
        DB_ADAPTERS,
        PRISMA_MAJOR: String(major),
      });
      const line = out.split("\n").find((l) => l.startsWith("SEEN "));
      if (!line) throw new Error(`no result from the Prisma ${major} check:\n${out}`);
      return JSON.parse(line.slice(5)) as Record<string, string[]>;
    }

    async function dropFixtures(): Promise<void> {
      for (const slug of schemaSlugs) {
        await admin.query(`DROP SCHEMA IF EXISTS "${tenantSchemaName(slug)}" CASCADE`);
      }
      for (const slug of dbSlugs) {
        await admin.query(`DROP DATABASE IF EXISTS "${getDatabaseName(slug)}" WITH (FORCE)`);
      }
      await admin.query(`DROP SCHEMA IF EXISTS "${rlsSchema}" CASCADE`);
      await dropTestRole(admin, appRole);
    }

    beforeAll(async () => {
      dir = path.join(tmp, `prisma-${major}`);
      fs.mkdirSync(dir);
      run("npm", ["init", "-y"], dir);
      run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", ...packages], dir);
      fs.writeFileSync(path.join(dir, "schema.prisma"), schemaFile(major));
      run("npx", ["prisma", "generate", "--schema", "schema.prisma"], dir, {
        ...process.env,
        DATABASE_URL: BASE_URL,
      });
      fs.writeFileSync(path.join(dir, "check.cjs"), CHECK);

      await dropFixtures();
      for (const slug of schemaSlugs) {
        const schema = tenantSchemaName(slug);
        await admin.query(`CREATE SCHEMA "${schema}"`);
        await admin.query(ORDERS_TABLE.replace("orders", `"${schema}".orders`));
      }
      for (const slug of dbSlugs) {
        const db = getDatabaseName(slug);
        await admin.query(`CREATE DATABASE "${db}"`);
        const tenantDb = new pg.Client({ connectionString: urlFor({ database: db }) });
        await tenantDb.connect();
        await tenantDb.query(ORDERS_TABLE);
        await tenantDb.end();
      }
    }, 300_000);

    afterAll(async () => {
      await dropFixtures();
    });

    it("routes two tenants to two schemas with SchemaPrismaAdapter", async () => {
      const [a, b] = schemaSlugs;
      const seen = check("schema", BASE_URL, a, b);
      expect(seen).toEqual({ [a]: [a], [b]: [b] });
      for (const slug of schemaSlugs) {
        const r = await admin.query(`SELECT tenant_id FROM "${tenantSchemaName(slug)}".orders`);
        expect(r.rows.map((row) => row.tenant_id)).toEqual([slug]);
      }
    });

    it("routes two tenants to two databases with DatabasePrismaAdapter", async () => {
      const [a, b] = dbSlugs;
      const seen = check("database", BASE_URL, a, b);
      expect(seen).toEqual({ [a]: [a], [b]: [b] });
      for (const slug of dbSlugs) {
        const tenantDb = new pg.Client({ connectionString: urlFor({ database: getDatabaseName(slug) }) });
        await tenantDb.connect();
        const r = await tenantDb.query("SELECT tenant_id FROM orders");
        await tenantDb.end();
        expect(r.rows.map((row) => row.tenant_id)).toEqual([slug]);
      }
    });

    it("limits each tenant to its own rows with prismaWithTenant under RLS", async () => {
      // A superuser bypasses RLS, so the client connects as a login role without it.
      await admin.query(`CREATE ROLE "${appRole}" LOGIN PASSWORD 'app_pw' NOSUPERUSER NOBYPASSRLS`);
      await admin.query(`CREATE SCHEMA "${rlsSchema}"`);
      await admin.query(ORDERS_TABLE.replace("orders", `"${rlsSchema}".orders`));
      await admin.query(`ALTER TABLE "${rlsSchema}".orders ENABLE ROW LEVEL SECURITY`);
      await admin.query(`ALTER TABLE "${rlsSchema}".orders FORCE ROW LEVEL SECURITY`);
      await admin.query(
        `CREATE POLICY tenant_isolation ON "${rlsSchema}".orders
         USING (tenant_id = current_setting('app.current_tenant_id', true))`,
      );
      await admin.query(`GRANT USAGE ON SCHEMA "${rlsSchema}" TO "${appRole}"`);
      await admin.query(`GRANT SELECT, INSERT ON "${rlsSchema}".orders TO "${appRole}"`);
      await admin.query(
        `INSERT INTO "${rlsSchema}".orders (id, tenant_id) VALUES ('a-seed', $1), ('b-seed', $2)`,
        [TENANT_A, TENANT_B],
      );

      const url = new URL(urlFor({ user: appRole, password: "app_pw" }));
      url.searchParams.set("schema", rlsSchema);
      const seen = check("rls", url.toString(), TENANT_A, TENANT_B);
      expect(seen).toEqual({ [TENANT_A]: [TENANT_A, TENANT_A], [TENANT_B]: [TENANT_B, TENANT_B] });
    });
  });
}
