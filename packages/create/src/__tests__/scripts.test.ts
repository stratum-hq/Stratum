import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createProject, type Template } from "../index.js";
import { createPresetProject } from "../preset-project.js";
import type { StackPreset } from "../matrix.js";

// These tests read the generated files only. They do not run npm install,
// so they check that each script can find its files, not that it runs.

interface GeneratedPackage {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/**
 * Assert that every file a script names is one the scaffold writes or the build emits.
 *
 * @param projectDir - The directory of the generated project.
 * @param entry - The entry file the scaffold writes, relative to `src/`, without extension.
 */
function expectScriptsResolve(projectDir: string, entry: string): void {
  const pkg = readJson<GeneratedPackage>(path.join(projectDir, "package.json"));
  const { dev, build, start } = pkg.scripts;

  // tsc with no tsconfig.json prints its help text and exits 1.
  expect(build).toBe("tsc");
  const tsconfigPath = path.join(projectDir, "tsconfig.json");
  expect(fs.existsSync(tsconfigPath)).toBe(true);
  const { compilerOptions } = readJson<{
    compilerOptions: { rootDir: string; outDir: string };
  }>(tsconfigPath);

  // Node 20 cannot run a .ts file, so dev needs a TypeScript runner.
  expect(dev).toBe(`tsx watch --env-file=.env src/${entry}.ts`);
  expect(pkg.devDependencies["tsx"]).toBeDefined();
  expect(fs.existsSync(path.join(projectDir, "src", `${entry}.ts`))).toBe(true);

  // tsc writes <rootDir>/<path>.ts to <outDir>/<path>.js.
  expect(compilerOptions.outDir).toBe("dist");
  const emitted = path.posix.relative(compilerOptions.rootDir, `src/${entry}`);
  expect(start).toBe(`node dist/${emitted}.js`);

  // tsc rejects a source file outside rootDir with TS6059.
  const rootDir = path.resolve(projectDir, compilerOptions.rootDir);
  for (const imported of relativeImports(path.join(projectDir, "src"))) {
    expect(fs.existsSync(imported)).toBe(true);
    expect(path.relative(rootDir, imported).startsWith("..")).toBe(false);
  }
}

/**
 * Return the TypeScript file behind each relative import in the .ts files under a directory.
 *
 * @param dir - The directory to read. The function reads its subdirectories too.
 */
function relativeImports(dir: string): string[] {
  const found: string[] = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      found.push(...relativeImports(file));
      continue;
    }
    if (!file.endsWith(".ts")) continue;
    const source = fs.readFileSync(file, "utf8");
    // NodeNext resolution needs the .js extension; the source file is the .ts next to it.
    for (const match of source.matchAll(/from "(\.{1,2}\/[^"]+)\.js"/g)) {
      found.push(path.resolve(path.dirname(file), `${match[1]}.ts`));
    }
  }
  return found;
}

function expectReadmeRunsDevScript(projectDir: string): void {
  const readme = fs.readFileSync(path.join(projectDir, "README.md"), "utf8");
  expect(readme).toContain("npm run dev");
  expect(readme).not.toMatch(/node --env-file=\.env src\//);
}

describe("generated package scripts", () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-scripts-test-"));
    projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const templates: Template[] = ["express", "fastify"];
  for (const template of templates) {
    it(`point at files that the ${template} template creates or builds`, () => {
      createProject("test-project", template, projectDir, true);
      expectScriptsResolve(projectDir, "index");
    });

    it(`tell the reader of the ${template} README to run the dev script`, () => {
      createProject("test-project", template, projectDir, true);
      expectReadmeRunsDevScript(projectDir);
    });
  }

  it("give the express template the pg type declarations that tsc needs", () => {
    createProject("test-project", "express", projectDir, true);
    const pkg = readJson<GeneratedPackage>(path.join(projectDir, "package.json"));
    expect(pkg.devDependencies["@types/pg"]).toBeDefined();
  });

  const presets: Array<[StackPreset, string]> = [
    [{ database: "postgres", strategy: "rls", orm: "pg", framework: "express" }, "index"],
    [{ database: "postgres", strategy: "rls", orm: "pg", framework: "none" }, "index"],
    [{ database: "mysql", strategy: "table-prefix", orm: "sequelize", framework: "nestjs" }, "main"],
    [{ database: "postgres", strategy: "rls", orm: "knex", framework: "express" }, "index"],
    [{ database: "mysql", strategy: "database", orm: "knex", framework: "nestjs" }, "main"],
  ];
  for (const [preset, entry] of presets) {
    const label = `${preset.database}-${preset.strategy}-${preset.orm}-${preset.framework}`;

    it(`point at files that the ${label} preset creates or builds`, () => {
      createPresetProject("test-project", preset, projectDir, true);
      expectScriptsResolve(projectDir, entry);
    });

    it(`tell the reader of the ${label} README to run the dev script`, () => {
      createPresetProject("test-project", preset, projectDir, true);
      expectReadmeRunsDevScript(projectDir);
    });
  }
});
