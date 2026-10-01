import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseArgs, createProject } from "../index.js";
import { createPresetProject } from "../preset-project.js";
import { VALID_COMBINATIONS, ormsFor, type Database, type StackPreset } from "../matrix.js";

// ─── parseArgs --preset tests ────────────────────────────────────────────────

describe("parseArgs --preset", () => {
  it("parses --preset flag", () => {
    const result = parseArgs(["my-app", "--preset", "postgres-rls-prisma-express"]);
    expect(result.preset).toBe("postgres-rls-prisma-express");
  });

  it("parses --preset=value syntax", () => {
    const result = parseArgs(["my-app", "--preset=mongodb-database-mongoose-hono"]);
    expect(result.preset).toBe("mongodb-database-mongoose-hono");
  });

  it("preset defaults to null", () => {
    const result = parseArgs(["my-app"]);
    expect(result.preset).toBeNull();
  });

  it("existing --template still works when no preset", () => {
    const result = parseArgs(["my-app", "--template", "fastify"]);
    expect(result.template).toBe("fastify");
    expect(result.preset).toBeNull();
  });
});

// ─── Regression: existing template tests ─────────────────────────────────────

describe("regression: --template path unchanged", () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-preset-regress-"));
    projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--template express still generates correct files", () => {
    createProject("test-project", "express", projectDir, true);
    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "docker-compose.yml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["express"]).toBeDefined();
    expect(pkg.dependencies["@stratum-hq/lib"]).toBeDefined();
  });

  it("--template nextjs still generates correct files", () => {
    createProject("test-project", "nextjs", projectDir, true);
    expect(fs.existsSync(path.join(projectDir, "src", "app", "page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "middleware.ts"))).toBe(false);
  });
});

// ─── Preset project generation ───────────────────────────────────────────────

describe("createPresetProject", () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-preset-test-"));
    projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── PostgreSQL presets ──

  it("generates postgres-rls-prisma-express project", () => {
    const preset: StackPreset = { database: "postgres", strategy: "rls", orm: "prisma", framework: "express" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "docker-compose.yml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "init.sql"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".env.example"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "prisma", "schema.prisma"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "stratum-prisma.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "tsconfig.json"))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@prisma/client"]).toBeDefined();
    expect(pkg.dependencies["express"]).toBeDefined();
    expect(pkg.dependencies["@stratum-hq/lib"]).toBeDefined();
    expect(pkg.dependencies["@stratum-hq/db-adapters"]).toBeDefined();

    const docker = fs.readFileSync(path.join(projectDir, "docker-compose.yml"), "utf8");
    expect(docker).toContain("postgres:16-alpine");

    const sql = fs.readFileSync(path.join(projectDir, "init.sql"), "utf8");
    expect(sql).toContain("uuid-ossp");
    expect(sql).toContain("ltree");
    expect(sql).toContain("Row-Level Security");
  });

  it("generates postgres-schema-prisma-fastify project", () => {
    const preset: StackPreset = { database: "postgres", strategy: "schema", orm: "prisma", framework: "fastify" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "src", "stratum-prisma.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "stratum-tenant.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "scripts", "provision-tenant.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@prisma/client"]).toBeDefined();
    expect(pkg.dependencies["fastify"]).toBeDefined();
    expect(pkg.scripts["tenant:provision"]).toBe("node --env-file=.env scripts/provision-tenant.mjs");

    const server = fs.readFileSync(path.join(projectDir, "src", "index.ts"), "utf8");
    expect(server).toContain("Fastify");
  });

  it("generates postgres-database-pg-express project", () => {
    const preset: StackPreset = { database: "postgres", strategy: "database", orm: "pg", framework: "express" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "src", "stratum-db.ts"))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["pg"]).toBeDefined();
    expect(pkg.dependencies["@stratum-hq/db-adapters"]).toBeDefined();
  });

  // ── MongoDB presets ──

  it("generates mongodb-database-mongoose-hono project", () => {
    const preset: StackPreset = { database: "mongodb", strategy: "database", orm: "mongoose", framework: "hono" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "docker-compose.yml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "stratum-mongoose.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);
    // MongoDB should NOT have init.sql
    expect(fs.existsSync(path.join(projectDir, "init.sql"))).toBe(false);

    const docker = fs.readFileSync(path.join(projectDir, "docker-compose.yml"), "utf8");
    expect(docker).toContain("mongo:7");

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["mongoose"]).toBeDefined();
    expect(pkg.dependencies["hono"]).toBeDefined();
    expect(pkg.dependencies["@stratum-hq/mongodb"]).toBeDefined();

    const env = fs.readFileSync(path.join(projectDir, ".env.example"), "utf8");
    expect(env).toContain("MONGODB_URI");
  });

  // ── MySQL presets ──

  it("generates mysql-table-prefix-pg-nestjs project", () => {
    const preset: StackPreset = { database: "mysql", strategy: "table-prefix", orm: "pg", framework: "nestjs" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "docker-compose.yml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "init.sql"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "stratum-db.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "stratum-tenant.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "sql", "tenant.sql"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "scripts", "provision-tenant.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "main.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "app.module.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "tenant.guard.ts"))).toBe(true);

    const docker = fs.readFileSync(path.join(projectDir, "docker-compose.yml"), "utf8");
    expect(docker).toContain("mysql:8");

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["mysql2"]).toBeDefined();
    expect(pkg.dependencies["@nestjs/core"]).toBeDefined();
    expect(pkg.dependencies["@stratum-hq/mysql"]).toBeDefined();
    expect(pkg.dependencies["@stratum-hq/nestjs"]).toBeDefined();
  });

  it("generates mysql-database-pg-express project", () => {
    const preset: StackPreset = { database: "mysql", strategy: "database", orm: "pg", framework: "express" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "src", "stratum-db.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "scripts", "provision-tenant.mjs"))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["mysql2"]).toBeDefined();
    expect(pkg.dependencies["express"]).toBeDefined();
  });

  // ── Next.js preset ──

  it("generates postgres-rls-prisma-nextjs project", () => {
    const preset: StackPreset = { database: "postgres", strategy: "rls", orm: "prisma", framework: "nextjs" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "src", "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "middleware.ts"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "src", "app", "page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "prisma", "schema.prisma"))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.dependencies["next"]).toBe("^16.3.8");
    expect(pkg.dependencies["react"]).toBe("^19.2.0");
    expect(pkg.dependencies["react-dom"]).toBe("^19.2.0");
    // The Prisma 7 floor, which is later than the Next.js 16 floor of 20.9.
    expect(pkg.engines.node).toBe("^20.19.0 || ^22.12.0 || >=24.0.0");
    expect(pkg.scripts.dev).toBe("next dev");
  });

  // ── "none" framework ──

  it("generates postgres-rls-pg-none project", () => {
    const preset: StackPreset = { database: "postgres", strategy: "rls", orm: "pg", framework: "none" };
    createPresetProject("test-project", preset, projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "stratum-db.ts"))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    // Should not have any framework dependency
    expect(pkg.dependencies["express"]).toBeUndefined();
    expect(pkg.dependencies["fastify"]).toBeUndefined();
    expect(pkg.dependencies["next"]).toBeUndefined();
    expect(pkg.dependencies["hono"]).toBeUndefined();
    expect(pkg.dependencies["@nestjs/core"]).toBeUndefined();
  });

  // ── README content ──

  it("README mentions the preset stack", () => {
    const preset: StackPreset = { database: "postgres", strategy: "rls", orm: "prisma", framework: "express" };
    createPresetProject("test-project", preset, projectDir, true);

    const readme = fs.readFileSync(path.join(projectDir, "README.md"), "utf8");
    expect(readme).toContain("postgres");
    expect(readme).toContain("rls");
    expect(readme).toContain("prisma");
    expect(readme).toContain("Row-Level Security");
  });

  // ── tsconfig.json ──

  it("generates tsconfig with decorators for nestjs", () => {
    const preset: StackPreset = { database: "postgres", strategy: "rls", orm: "prisma", framework: "nestjs" };
    createPresetProject("test-project", preset, projectDir, true);

    const tsconfig = JSON.parse(fs.readFileSync(path.join(projectDir, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true);
    expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true);
  });

  it("generates the nextjs tsconfig that next build on Next 16 leaves unchanged", () => {
    const preset: StackPreset = { database: "postgres", strategy: "rls", orm: "prisma", framework: "nextjs" };
    createPresetProject("test-project", preset, projectDir, true);

    const tsconfig = JSON.parse(fs.readFileSync(path.join(projectDir, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
    expect(tsconfig.compilerOptions.isolatedModules).toBe(true);
    expect(tsconfig.compilerOptions.resolveJsonModule).toBe(true);
    expect(tsconfig.compilerOptions.allowJs).toBe(true);
    expect(tsconfig.compilerOptions.incremental).toBe(true);
    expect(tsconfig.compilerOptions.lib).toEqual(["dom", "dom.iterable", "esnext"]);
    expect(tsconfig.include).toContain(".next/types/**/*.ts");
    expect(tsconfig.include).toContain(".next/dev/types/**/*.ts");
  });
});

// ─── Next.js file layout for every preset ────────────────────────────────────

describe("Next.js presets", () => {
  // Next.js runs the proxy only from the directory that holds the app
  // directory, and next build needs a root layout.
  const presets: StackPreset[] = (Object.keys(VALID_COMBINATIONS) as Database[]).flatMap((database) =>
    VALID_COMBINATIONS[database].strategies.flatMap((strategy) =>
      ormsFor(database, strategy).map((orm) => ({ database, strategy, orm, framework: "nextjs" as const })),
    ),
  );

  for (const preset of presets) {
    const label = `${preset.database}-${preset.strategy}-${preset.orm}-nextjs`;
    it(`${label} writes src/proxy.ts next to src/app, a root layout, and a tsconfig next build accepts`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-next-preset-"));
      try {
        createPresetProject("test-project", preset, dir, true);
        expect(fs.existsSync(path.join(dir, "src", "app", "page.tsx"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "src", "app", "layout.tsx"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "src", "proxy.ts"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "src", "middleware.ts"))).toBe(false);
        expect(fs.existsSync(path.join(dir, "proxy.ts"))).toBe(false);
        const { compilerOptions } = JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
        expect(compilerOptions.rootDir).toBeUndefined();
        expect(compilerOptions.moduleResolution).toBe("Bundler");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
