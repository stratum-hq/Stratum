import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import ts from "typescript";

/**
 * Generates a postgres-rls-knex project with the built `@stratum-hq/create`,
 * compiles its knex files, and runs the generated `withTenantScope` against a
 * real PostgreSQL server. The app connects as a role that RLS applies to, so
 * the rows it sees prove that the policy reads the setting the code sets.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CREATE = path.join(REPO_ROOT, "packages/create/dist/index.js");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const PROJECT = "knex-scope-app";
const APP_ROLE = "create_knex_scope_app";
const APP_PASSWORD = "create_knex_scope_pw";
const TABLE = "create_knex_scope_orders";
const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

interface GeneratedKnexModule {
  knex: { raw(sql: string): Promise<{ rows: Record<string, unknown>[] }>; destroy(): Promise<void> };
  withTenantScope<T>(
    tenantId: string,
    fn: (trx: { raw(sql: string): Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>,
  ): Promise<T>;
}

let tmp: string;
let admin: pg.Client;
let generated: GeneratedKnexModule;

// The generated project is TypeScript. Compile each file to JavaScript next to
// the source, so the relative ".js" imports in it resolve.
function compileInPlace(file: string): void {
  const source = fs.readFileSync(file, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(file.replace(/\.ts$/, ".js"), out.outputText);
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-knex-"));
  const res = spawnSync(
    process.execPath,
    [CREATE, PROJECT, "--preset", "postgres-rls-knex-express", "--skip-install"],
    { cwd: tmp, encoding: "utf8" },
  );
  expect(res.status, res.stderr).toBe(0);

  const project = path.join(tmp, PROJECT);
  // The generated project resolves knex and pg from the workspace install.
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(project, "node_modules"), "dir");
  compileInPlace(path.join(project, "knexfile.ts"));
  compileInPlace(path.join(project, "src/stratum-knex.ts"));

  // Use the policy expression that the generated init.sql documents, so the
  // test checks the guidance and not a copy of it.
  const initSql = fs.readFileSync(path.join(project, "init.sql"), "utf8");
  const policyUsing = initSql.match(/^--\s+USING \((.*)\);$/m)?.[1];
  expect(policyUsing, "init.sql documents a tenant_isolation policy").toBeDefined();

  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  await admin.query(
    `CREATE ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`,
  );
  await admin.query(`
    CREATE TABLE ${TABLE} (id SERIAL PRIMARY KEY, tenant_id UUID NOT NULL, item TEXT NOT NULL);
    ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${TABLE} USING (${policyUsing});
    INSERT INTO ${TABLE} (tenant_id, item) VALUES ('${TENANT_A}', 'a'), ('${TENANT_B}', 'b');
    GRANT SELECT ON ${TABLE} TO ${APP_ROLE};
  `);

  const appUrl = new URL(BASE_URL);
  appUrl.username = APP_ROLE;
  appUrl.password = APP_PASSWORD;
  // knexfile.ts reads DATABASE_URL when the module loads.
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = appUrl.toString();
  try {
    generated = (await import(
      pathToFileURL(path.join(project, "src/stratum-knex.js")).href
    )) as GeneratedKnexModule;
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});

afterAll(async () => {
  await generated?.knex.destroy();
  await admin?.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await admin?.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  await admin?.end();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("generated postgres-rls-knex project: withTenantScope", () => {
  it("sets app.current_tenant_id for queries inside the scope", async () => {
    const value = await generated.withTenantScope(TENANT_A, async (trx) => {
      const res = await trx.raw("SELECT current_setting('app.current_tenant_id', true) AS tenant");
      return res.rows[0].tenant;
    });
    expect(value).toBe(TENANT_A);
  });

  it("shows only the scoped tenant's rows under RLS", async () => {
    const rowsA = await generated.withTenantScope(TENANT_A, async (trx) => {
      const res = await trx.raw(`SELECT item FROM ${TABLE} ORDER BY item`);
      return res.rows;
    });
    const rowsB = await generated.withTenantScope(TENANT_B, async (trx) => {
      const res = await trx.raw(`SELECT item FROM ${TABLE} ORDER BY item`);
      return res.rows;
    });
    expect(rowsA).toEqual([{ item: "a" }]);
    expect(rowsB).toEqual([{ item: "b" }]);
  });

  it("does not keep the tenant setting on the connection after the scope ends", async () => {
    await generated.withTenantScope(TENANT_A, async () => undefined);
    const res = await generated.knex.raw(`SELECT item FROM ${TABLE} ORDER BY item`);
    expect(res.rows).toEqual([]);
  });

  // After a transaction-local set_config ends, the setting reads as '' on that
  // connection. The generated policy must return no rows there, not fail on
  // the uuid cast. Every connection in the pool has run a scope first.
  it("returns no rows on every pooled connection after a scope ends", async () => {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        generated.withTenantScope(TENANT_A, (trx) => trx.raw("SELECT pg_sleep(0.05)")),
      ),
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () => generated.knex.raw(`SELECT item FROM ${TABLE}`)),
    );
    for (const res of results) expect(res.rows).toEqual([]);
  });
});
