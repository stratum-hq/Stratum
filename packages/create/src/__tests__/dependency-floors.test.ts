import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createProject, type Template } from "../index.js";
import { generatePresetPackageJson } from "../generators/package-json.js";
import { generateDbSetup } from "../generators/db-setup.js";
import { VALID_COMBINATIONS, ormsFor, type Database, type StackPreset } from "../matrix.js";

// The lowest version each generated range allows must be past the published
// advisories for that package, so a lockfile can never pin a vulnerable floor.
// Each entry is the first version without a known advisory at the time of
// writing (GitHub advisory database, checked with npm audit).
const SAFE_FLOORS: Record<string, string> = {
  "drizzle-orm": "0.45.2", // GHSA-gpj5-g38j-94v9
  "drizzle-kit": "0.31.11",
  express: "4.22.3", // body-parser, path-to-regexp, qs, send, cookie
  fastify: "5.12.5", // every 4.x release is affected by fastify advisories
  hono: "4.13.7",
  "@hono/node-server": "1.19.15",
  "@nestjs/core": "11.1.18", // GHSA-36xv-jgw5-4q75
  "@nestjs/common": "11.1.18", // GHSA-cj7v-w2c7-cp7c
  "@nestjs/platform-express": "11.1.18",
  mongoose: "8.24.1",
  mysql2: "3.23.1",
  next: "16.3.0", // postcss advisories: every release before 16.3.0 bundles an affected postcss
  tsx: "4.19.3", // bundled esbuild, GHSA-67mh-4wv8-2f99
};

function floor(range: string): number[] {
  const match = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!match) throw new Error(`unexpected range ${range}`);
  return match.slice(1).map(Number);
}

function atLeast(range: string, version: string): boolean {
  const a = floor(range);
  const b = floor(version);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

interface Pkg {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides?: Record<string, Record<string, string>>;
}

function allPresets(): StackPreset[] {
  const out: StackPreset[] = [];
  for (const [database, config] of Object.entries(VALID_COMBINATIONS)) {
    for (const strategy of config.strategies) {
      for (const orm of ormsFor(database as Database, strategy)) {
        for (const framework of config.frameworks) {
          out.push({ database: database as Database, strategy, orm, framework });
        }
      }
    }
  }
  return out;
}

let tmp: string;
const templatePkgs: Array<[string, Pkg]> = [];

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-floors-test-"));
  for (const name of ["express", "fastify", "nextjs"] as Template[]) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    createProject("floor-app", name, dir, true);
    templatePkgs.push([`${name} template`, JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))]);
  }
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("generated dependency ranges", () => {
  it("start past the published advisories, for every preset and template", () => {
    const pkgs: Array<[string, Pkg]> = [
      ...allPresets().map((p): [string, Pkg] => [
        `${p.database}-${p.strategy}-${p.orm}-${p.framework}`,
        JSON.parse(generatePresetPackageJson("floor-app", p)),
      ]),
      ...templatePkgs,
    ];
    const checked = new Set<string>();
    for (const [label, pkg] of pkgs) {
      for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (!(name in SAFE_FLOORS)) continue;
        checked.add(name);
        expect(atLeast(range, SAFE_FLOORS[name]), `${label}: ${name}@${range}`).toBe(true);
      }
    }
    // Every floor is exercised by at least one generated project.
    expect([...checked].sort()).toEqual(Object.keys(SAFE_FLOORS).sort());
  });
});

describe("the drizzle presets", () => {
  const drizzle = allPresets().filter((p) => p.orm === "drizzle");

  it("exist", () => {
    expect(drizzle.length).toBeGreaterThan(0);
  });

  it("move the esbuild that drizzle-kit pulls in through @esbuild-kit past its advisory", () => {
    for (const p of drizzle) {
      const pkg: Pkg = JSON.parse(generatePresetPackageJson("app", p));
      expect(atLeast(pkg.overrides!["@esbuild-kit/core-utils"].esbuild, "0.25.0")).toBe(true);
    }
  });

  it("generate the schema file that drizzle.config.ts points at", () => {
    for (const p of drizzle) {
      const files = new Map(generateDbSetup(p).map((f) => [f.filename, f.content]));
      const config = files.get("drizzle.config.ts")!;
      const schema = /schema:\s*"\.\/([^"]+)"/.exec(config)?.[1];
      expect(schema).toBe("src/schema.ts");
      expect(files.get(schema!)).toMatch(/export const \w+ = (pg|mysql)Table\(/);
    }
  });

  it("are the only presets with overrides", () => {
    for (const p of allPresets().filter((x) => x.orm !== "drizzle")) {
      expect(JSON.parse(generatePresetPackageJson("app", p)).overrides).toBeUndefined();
    }
  });
});
