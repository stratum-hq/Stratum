import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { generateDbSetup } from "../generators/db-setup.js";
import { generatePresetPackageJson } from "../generators/package-json.js";
import { generatePresetInitSql } from "../generators/init-sql.js";
import { generatePresetReadme } from "../generators/readme.js";
import { generateMiddleware } from "../generators/middleware.js";
import {
  formatPresetString,
  parsePresetString,
  VALID_COMBINATIONS,
  ormsFor,
  type Database,
  type StackPreset,
} from "../matrix.js";

// A generated project is only useful if its database setup compiles against the
// real Stratum packages. These tests compile the generated files with the
// TypeScript compiler and resolve each `@stratum-hq/*` import to the workspace
// source, so a wrong export name or signature fails here.
//
// Third-party type declarations resolve from the repository root, not from the
// generated package.json. So the compile check cannot see a missing @types
// package. A separate test below checks the generated devDependencies.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
// The generated files exist only in memory. The directory sits inside the
// repository so that module resolution finds the root node_modules.
const VIRTUAL_ROOT = path.join(REPO_ROOT, "packages/create/.generated-presets");

// The workspace installs the drivers these presets import. The prisma and
// drizzle presets need packages that the workspace does not install.
const PRESETS = [
  "postgres-rls-pg-none",
  "postgres-rls-knex-none",
  "postgres-rls-sequelize-none",
  "postgres-schema-pg-none",
  "postgres-database-pg-none",
  "mysql-database-pg-none",
  "mysql-table-prefix-pg-none",
  "mongodb-database-mongoose-none",
  "mongodb-collection-mongoose-none",
].map((s) => parsePresetString(s) as StackPreset);

function projectFiles(preset: StackPreset): Map<string, string> {
  const dir = path.join(VIRTUAL_ROOT, formatPresetString(preset));
  const files = new Map<string, string>();
  files.set(path.join(dir, "package.json"), generatePresetPackageJson("app", preset));
  for (const file of generateDbSetup(preset)) {
    files.set(path.join(dir, file.filename), file.content);
  }
  return files;
}

function isVirtualDir(dir: string): boolean {
  return dir === VIRTUAL_ROOT || dir.startsWith(VIRTUAL_ROOT + path.sep);
}

/** Return the compiler errors in the generated files, keyed by preset string. */
function typecheckPresets(presets: StackPreset[]): Map<string, string[]> {
  const files = new Map<string, string>();
  for (const preset of presets) {
    for (const [name, content] of projectFiles(preset)) files.set(name, content);
  }

  // These options match the tsconfig.json that preset-project.ts writes.
  // noEmit replaces rootDir and outDir, because this check emits nothing.
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    noEmit: true,
    types: ["node"],
    typeRoots: [path.join(REPO_ROOT, "node_modules/@types")],
    paths: {
      "@stratum-hq/*": [path.join(REPO_ROOT, "packages/*/src/index.ts")],
    },
  };

  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, directoryExists, getSourceFile } = host;
  host.fileExists = (f) => files.has(f) || (!isVirtualDir(path.dirname(f)) && fileExists(f));
  host.readFile = (f) => files.get(f) ?? readFile(f);
  host.directoryExists = (d) => isVirtualDir(d) || (directoryExists?.(d) ?? false);
  host.getSourceFile = (f, lang, onError, create) => {
    const content = files.get(f);
    if (content !== undefined) return ts.createSourceFile(f, content, lang, true);
    return getSourceFile(f, lang, onError, create);
  };

  const roots = [...files.keys()].filter((f) => f.endsWith(".ts"));
  const program = ts.createProgram(roots, options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const errors = new Map<string, string[]>();
  for (const preset of presets) errors.set(formatPresetString(preset), []);
  for (const d of diagnostics) {
    // Errors inside the workspace packages come from their own build settings,
    // not from the generated code, so the check reports only generated files.
    if (!d.file || !d.file.fileName.startsWith(VIRTUAL_ROOT)) continue;
    const presetName = path.relative(VIRTUAL_ROOT, d.file.fileName).split(path.sep)[0];
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    const where = `${path.relative(path.join(VIRTUAL_ROOT, presetName), d.file.fileName)}:${line + 1}`;
    errors.get(presetName)?.push(`${where} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }
  return errors;
}

describe("generated database setup typechecks against the workspace packages and root @types", () => {
  let errors: Map<string, string[]>;

  beforeAll(() => {
    errors = typecheckPresets(PRESETS);
  }, 120_000);

  it.each(PRESETS.map((p) => formatPresetString(p)))("%s compiles without errors", (name) => {
    expect(errors.get(name)).toEqual([]);
  });
});

describe("generated PostgreSQL tenant context", () => {
  const knexPostgres = parsePresetString("postgres-rls-knex-none") as StackPreset;

  it("sets app.current_tenant_id with set_config inside a knex transaction", () => {
    const content = generateDbSetup(knexPostgres).find((f) => f.filename === "src/stratum-knex.ts")!.content;
    expect(content).toContain("knex.transaction(");
    expect(content).toContain(`trx.raw("SELECT set_config('app.current_tenant_id', ?, true)", [tenantId])`);
    expect(content).not.toMatch(/\bSET app\./);
  });

  it("names only the app.current_tenant_id setting in generated files", () => {
    const outputs: string[] = [];
    for (const preset of PRESETS) {
      for (const file of generateDbSetup(preset)) outputs.push(file.content);
      outputs.push(generatePresetInitSql("app", preset) ?? "");
      outputs.push(generatePresetReadme("app", preset));
    }
    for (const content of outputs) {
      expect(content).not.toMatch(/app\.current_tenant(?!_id)/);
    }
  });
});

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

describe("generated package.json declares the types that the generated code imports", () => {
  const importsPg = allPresets().filter((preset) =>
    [...generateDbSetup(preset), ...generateMiddleware("app", preset)].some((f) =>
      /from ["']pg["']/.test(f.content),
    ),
  );

  it("finds presets whose generated code imports pg", () => {
    expect(importsPg.length).toBeGreaterThan(0);
  });

  it.each(importsPg.map((p) => formatPresetString(p)))(
    "%s imports pg and lists @types/pg in devDependencies",
    (name) => {
      const pkg = JSON.parse(generatePresetPackageJson("app", parsePresetString(name) as StackPreset)) as {
        devDependencies: Record<string, string>;
      };
      expect(pkg.devDependencies["@types/pg"]).toBeDefined();
    },
  );
});
