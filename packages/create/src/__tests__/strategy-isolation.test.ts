import { describe, it, expect } from "vitest";
import { generateDbSetup } from "../generators/db-setup.js";
import { generatePresetInitSql } from "../generators/init-sql.js";
import { generatePresetPackageJson } from "../generators/package-json.js";
import { generatePresetReadme } from "../generators/readme.js";
import { generateMiddleware } from "../generators/middleware.js";
import {
  VALID_COMBINATIONS,
  formatPresetString,
  ormsFor,
  type Database,
  type StackPreset,
} from "../matrix.js";

// Each PostgreSQL strategy isolates tenants differently, so the generated
// tenant helper must match the strategy. A schema or database preset routes
// each tenant to its own schema or database and must not ship the helpers of
// the shared-table strategy, which isolate nothing without a policy. An rls
// preset must create the policy its helper depends on.

function allPresets(): StackPreset[] {
  const presets: StackPreset[] = [];
  for (const [database, config] of Object.entries(VALID_COMBINATIONS)) {
    for (const strategy of config.strategies)
      for (const orm of ormsFor(database as Database, strategy))
        for (const framework of config.frameworks)
          presets.push({ database: database as Database, strategy, orm, framework });
  }
  return presets;
}

/** Every generated file of a preset that can hold tenant code or setup text, by file name. */
function generatedFiles(preset: StackPreset): Map<string, string> {
  const files = new Map<string, string>();
  for (const f of generateDbSetup(preset)) files.set(f.filename, f.content);
  for (const f of generateMiddleware("app", preset)) files.set(f.filename, f.content);
  files.set("init.sql", generatePresetInitSql("app", preset) ?? "");
  files.set("README.md", generatePresetReadme("app", preset));
  files.set("package.json", generatePresetPackageJson("app", preset));
  return files;
}

const postgres = allPresets().filter((p) => p.database === "postgres");
const isolated = postgres.filter((p) => p.strategy === "schema" || p.strategy === "database");
const rls = postgres.filter((p) => p.strategy === "rls");

const SHARED_TABLE_HELPERS = [
  "prismaWithTenant",
  "createTenantPool",
  "drizzleWithTenant",
  "sequelizeWithTenantScope",
  "set_config",
  "app.current_tenant_id",
];

const ADAPTER: Record<string, Record<string, string>> = {
  schema: { prisma: "SchemaPrismaAdapter", pg: "SchemaRawAdapter" },
  database: { prisma: "DatabasePrismaAdapter", pg: "DatabaseRawAdapter" },
};

describe("PostgreSQL schema and database presets", () => {
  it("are offered only for ORMs with a strategy adapter", () => {
    expect(new Set(isolated.map((p) => p.orm))).toEqual(new Set(["prisma", "pg"]));
  });

  it.each(isolated.map(formatPresetString))("%s contains no shared-table tenant helper", (name) => {
    const preset = isolated.find((p) => formatPresetString(p) === name)!;
    for (const [file, content] of generatedFiles(preset)) {
      for (const helper of SHARED_TABLE_HELPERS) {
        expect(content.includes(helper), `${file} contains ${helper}`).toBe(false);
      }
      expect(content, file).not.toMatch(/filtered by RLS|RLS polic/i);
    }
  });

  it.each(isolated.map(formatPresetString))(
    "%s routes each tenant with the strategy adapter, by the slug of a verified tenant ID",
    (name) => {
      const preset = isolated.find((p) => formatPresetString(p) === name)!;
      const files = generatedFiles(preset);
      const helper = files.get(preset.orm === "prisma" ? "src/stratum-prisma.ts" : "src/stratum-db.ts")!;
      expect(helper).toContain(ADAPTER[preset.strategy][preset.orm]);
      expect(helper).toContain("await tenantSlug(tenantId)");
      expect(files.get("src/stratum-tenant.ts")).toContain("stratum.getTenant(tenantId)");
    },
  );

  it.each(isolated.map(formatPresetString))(
    "%s provisions each tenant as the superuser, not as the app role",
    (name) => {
      const preset = isolated.find((p) => formatPresetString(p) === name)!;
      const files = generatedFiles(preset);
      const script = files.get("scripts/provision-tenant.mjs")!;
      expect(script).toContain(preset.strategy === "schema" ? "createSchema(" : "createDatabase(");
      expect(script).toContain("process.env.DATABASE_SUPERUSER_URL");
      expect(script).toContain("new pg.Client({ connectionString: superuserUrl })");
      const pkg = JSON.parse(files.get("package.json")!) as { scripts: Record<string, string> };
      expect(pkg.scripts["tenant:provision"]).toBe("node --env-file=.env scripts/provision-tenant.mjs");
      expect(files.get("README.md")).toContain("npm run tenant:provision -- <tenant-id>");
    },
  );

  it.each(isolated.filter((p) => p.strategy === "database").map(formatPresetString))(
    "%s gives the pool manager the URL parts, so pg cannot replace the tenant database name",
    (name) => {
      const preset = isolated.find((p) => formatPresetString(p) === name)!;
      const helper = generatedFiles(preset).get(
        preset.orm === "prisma" ? "src/stratum-prisma.ts" : "src/stratum-db.ts",
      )!;
      const managerConfig = helper.slice(helper.indexOf("new DatabasePoolManager("));
      expect(managerConfig.slice(0, managerConfig.indexOf("});"))).not.toContain("connectionString");
    },
  );
});

describe("PostgreSQL rls presets", () => {
  it.each(rls.map(formatPresetString))("%s creates a tenant_isolation policy", (name) => {
    const preset = rls.find((p) => formatPresetString(p) === name)!;
    const all = [...generatedFiles(preset).values()].join("\n");
    if (preset.orm === "drizzle") {
      expect(all).toContain('pgPolicy("tenant_isolation"');
      expect(all).toContain("current_setting('app.current_tenant_id', true)");
    } else {
      expect(all).toContain("CREATE POLICY tenant_isolation ON notes");
      expect(all).toContain("ALTER TABLE notes FORCE ROW LEVEL SECURITY;");
      expect(all).toContain("USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)");
    }
  });

  it.each(rls.filter((p) => p.orm === "prisma").map(formatPresetString))(
    "%s pushes its tables and policies as the superuser",
    (name) => {
      const preset = rls.find((p) => formatPresetString(p) === name)!;
      const files = generatedFiles(preset);
      expect(files.get("scripts/db-push.mjs")).toContain("DATABASE_URL: superuserUrl");
      expect(files.get("scripts/db-push.mjs")).toContain('readFileSync("prisma/rls.sql"');
      const pkg = JSON.parse(files.get("package.json")!) as { scripts: Record<string, string> };
      expect(pkg.scripts["db:push"]).toBe("node --env-file=.env scripts/db-push.mjs");
      expect(files.get("README.md")).not.toContain("npx prisma db push");
    },
  );
});
