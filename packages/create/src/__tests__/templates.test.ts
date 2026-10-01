import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createProject, type Template } from "../index.js";
import { createPresetProject } from "../preset-project.js";
import type { Framework } from "../matrix.js";

// The express and fastify templates must generate the same tenant middleware
// as the presets, and a README that points only at files that exist.

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-templates-test-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function template(name: Template): string {
  const dir = path.join(tmp, `template-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  createProject("tpl-app", name, dir, true);
  return dir;
}

function preset(framework: Framework): string {
  const dir = path.join(tmp, `preset-${framework}`);
  fs.mkdirSync(dir, { recursive: true });
  createPresetProject("tpl-app", { database: "postgres", strategy: "rls", orm: "pg", framework }, dir, true);
  return dir;
}

const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

describe.each<Template & Framework>(["express", "fastify"])("the %s template", (name) => {
  it("writes the same server, with the verified-JWT tenant middleware, as the preset", () => {
    const server = read(template(name), "src/index.ts");
    expect(server).toBe(read(preset(name), "src/index.ts"));
    expect(server).toContain(`import { jwtVerify } from "jose";`);
    expect(server).toContain(`algorithms: ["HS256"]`);
    expect(server).toContain(`"/tenants"`);
  });

  it("lists jose and the framework in package.json", () => {
    const pkg = JSON.parse(read(template(name), "package.json"));
    expect(pkg.dependencies.jose).toBeDefined();
    expect(pkg.dependencies[name]).toBeDefined();
  });
});

describe.each<Template>(["express", "fastify", "nextjs"])("the %s template README", (name) => {
  it("names only source files that the template generates", () => {
    const dir = template(name);
    const mentioned = [...read(dir, "README.md").matchAll(/`(src\/[\w./-]+\.tsx?)`/g)].map((m) => m[1]);
    expect(mentioned.length).toBeGreaterThan(0);
    for (const file of mentioned) {
      expect(fs.existsSync(path.join(dir, file)), `${file} is named in the README`).toBe(true);
    }
  });
});
