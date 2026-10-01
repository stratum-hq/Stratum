import { describe, it, expect } from "vitest";
import { generateDbSetup } from "../generators/db-setup.js";
import { generatePresetInitSql } from "../generators/init-sql.js";
import { generatePresetPackageJson } from "../generators/package-json.js";
import { generatePresetReadme } from "../generators/readme.js";
import { generateMiddleware } from "../generators/middleware.js";
import { generatePresetEnv } from "../preset-project.js";
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
  files.set(".env.example", generatePresetEnv("app", preset));
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
      const table = preset.orm === "prisma" ? "app.notes" : "notes";
      expect(all).toContain(`CREATE POLICY tenant_isolation ON ${table}`);
      expect(all).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
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

describe("PostgreSQL presets that provision as the superuser", () => {
  it.each(postgres.map(formatPresetString))(
    "%s gives the app role no right to create schemas or databases",
    (name) => {
      const preset = postgres.find((p) => formatPresetString(p) === name)!;
      const sql = generatedFiles(preset).get("init.sql")!;
      expect(sql).not.toMatch(/GRANT [A-Z, ]*CREATE[A-Z, ]* ON DATABASE/);
      expect(sql).not.toMatch(/\bCREATEDB\b/);
    },
  );

  it.each(isolated.map(formatPresetString))(
    "%s README says a schema or database name is fixed at provisioning and a slug must not be reused",
    (name) => {
      const preset = isolated.find((p) => formatPresetString(p) === name)!;
      const readme = generatedFiles(preset).get("README.md")!;
      expect(readme).toMatch(/fixed when the tenant is provisioned/);
      expect(readme).toMatch(/Never give a tenant a slug that another tenant had/);
    },
  );
});

describe("PostgreSQL rls Prisma presets", () => {
  const prismaRls = rls.filter((p) => p.orm === "prisma");

  it.each(prismaRls.map(formatPresetString))(
    "%s keeps its models in their own schema, so prisma db push never touches Stratum's tables in public",
    (name) => {
      const preset = prismaRls.find((p) => formatPresetString(p) === name)!;
      const files = generatedFiles(preset);
      const schema = files.get("prisma/schema.prisma")!;
      expect(schema).toMatch(/^\s*schemas\s*=\s*\["app"\]/m);
      expect(schema).toContain('previewFeatures = ["multiSchema"]');
      for (const model of schema.split(/^model /m).slice(1)) {
        expect(model).toContain('@@schema("app")');
      }
      expect(files.get("prisma/rls.sql")).toContain("CREATE POLICY tenant_isolation ON app.notes");
      expect(files.get("init.sql")).toContain("CREATE SCHEMA app;");
      expect(files.get("init.sql")).toMatch(/GRANT USAGE ON SCHEMA app TO \w+_app;/);
    },
  );
});

const mysqlPresets = allPresets().filter((p) => p.database === "mysql");

const MYSQL_ADAPTER: Record<string, string> = {
  database: "MysqlDatabaseAdapter",
  "table-prefix": "MysqlTableAdapter",
};

describe("MySQL presets", () => {
  it("are offered only for the raw driver, which the strategy adapters route", () => {
    expect(new Set(mysqlPresets.map((p) => p.orm))).toEqual(new Set(["pg"]));
    expect(new Set(mysqlPresets.map((p) => p.strategy))).toEqual(new Set(["database", "table-prefix"]));
  });

  it.each(mysqlPresets.map(formatPresetString))(
    "%s routes each tenant with the strategy adapter, by the slug of a verified tenant ID",
    (name) => {
      const preset = mysqlPresets.find((p) => formatPresetString(p) === name)!;
      const files = generatedFiles(preset);
      const helper = files.get("src/stratum-db.ts")!;
      expect(helper).toContain(`new ${MYSQL_ADAPTER[preset.strategy]}(`);
      expect(helper).toContain("await tenantSlug(tenantId)");
      expect(files.get("src/stratum-tenant.ts")).toContain("SELECT slug FROM _stratum_tenants WHERE id = ?");
      expect(files.get("init.sql")).toMatch(/slug VARCHAR\(63\) NOT NULL UNIQUE/);
    },
  );

  it.each(mysqlPresets.map(formatPresetString))("%s generates no helper that leaves scoping to the caller", (name) => {
    const preset = mysqlPresets.find((p) => formatPresetString(p) === name)!;
    for (const [file, content] of generatedFiles(preset)) {
      expect(content, file).not.toContain("...params, tenantId");
      expect(content, file).not.toMatch(/scope queries by tenant_id column/i);
      expect(content, file).not.toMatch(/Connection routing directs queries/);
      expect(content, file).not.toMatch(/Tables are prefixed with the tenant identifier/);
    }
    const files = generatedFiles(preset);
    for (const file of ["src/stratum-tenant.ts", "src/stratum-db.ts"]) {
      expect(files.get(file), file).not.toMatch(/\.headers\b|\.hostname\b|\.subdomains?\b/);
    }
  });

  it.each(mysqlPresets.map(formatPresetString))("%s provisions each tenant as the admin user", (name) => {
    const preset = mysqlPresets.find((p) => formatPresetString(p) === name)!;
    const files = generatedFiles(preset);
    const script = files.get("scripts/provision-tenant.mjs")!;
    expect(script).toContain("process.env.DATABASE_SUPERUSER_URL");
    expect(script).toContain("INSERT INTO _stratum_tenants");
    expect(files.get(".env.example")).toMatch(/^DATABASE_SUPERUSER_URL=mysql:\/\/root:/m);
    const pkg = JSON.parse(files.get("package.json")!) as { scripts: Record<string, string> };
    expect(pkg.scripts["tenant:provision"]).toBe("node --env-file=.env scripts/provision-tenant.mjs");
    const readme = files.get("README.md")!;
    expect(readme).toContain("npm run tenant:provision -- <tenant-id> <slug>");
    expect(readme).toMatch(/fixed when the tenant is provisioned/);
    expect(readme).toMatch(/Never give a tenant a slug that another tenant had/);
  });
});
