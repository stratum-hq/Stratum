import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { createProject, type Template } from "../index.js";
import { generatePresetPackageJson } from "../generators/package-json.js";
import { VALID_COMBINATIONS, ormsFor, formatPresetString, type Database, type StackPreset } from "../matrix.js";

// The test reads the versions from disk so that it does not share a code path with the
// generator it checks.
const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function workspaceVersions(): Map<string, string> {
  const versions = new Map<string, string>();
  for (const dir of fs.readdirSync(packagesDir)) {
    const file = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name: string; version: string };
    versions.set(pkg.name, pkg.version);
  }
  return versions;
}

function allPresets(): StackPreset[] {
  const presets: StackPreset[] = [];
  for (const [database, config] of Object.entries(VALID_COMBINATIONS)) {
    for (const strategy of config.strategies) {
      for (const orm of ormsFor(database as Database, strategy)) {
        for (const framework of config.frameworks) {
          presets.push({ database: database as Database, strategy, orm, framework });
        }
      }
    }
  }
  return presets;
}

function stratumRanges(pkgJson: string): Array<[string, string]> {
  const pkg = JSON.parse(pkgJson) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([name]) =>
    name.startsWith("@stratum-hq/"),
  );
}

// A caret range on the current workspace version is the tightest range that the
// workspace version satisfies and that still takes compatible fixes.
function expectCurrentRanges(pkgJson: string, versions: Map<string, string>): void {
  const ranges = stratumRanges(pkgJson);
  expect(ranges.length).toBeGreaterThan(0);
  for (const [name, range] of ranges) {
    expect(versions.has(name), `${name} is a workspace package`).toBe(true);
    expect(range, name).toBe(`^${versions.get(name)}`);
  }
}

describe("generated @stratum-hq/* ranges", () => {
  const versions = workspaceVersions();

  it.each(allPresets().map((p) => [formatPresetString(p), p] as const))(
    "preset %s pins every @stratum-hq/* package to the workspace version",
    (_name, preset) => {
      expectCurrentRanges(generatePresetPackageJson("test-project", preset), versions);
    },
  );

  describe("default templates", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-versions-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it.each<Template>(["express", "fastify", "nextjs"])(
      "template %s pins every @stratum-hq/* package to the workspace version",
      (template) => {
        const projectDir = path.join(tmpDir, "test-project");
        fs.mkdirSync(projectDir, { recursive: true });
        createProject("test-project", template, projectDir, true);
        expectCurrentRanges(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"), versions);
      },
    );
  });
});
