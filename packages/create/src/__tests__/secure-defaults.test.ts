import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createProject, type Template } from "../index.js";
import { createPresetProject } from "../preset-project.js";
import { VALID_COMBINATIONS, type StackPreset, type Framework } from "../matrix.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-secure-defaults-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readAll(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

function genPreset(preset: StackPreset): Record<string, string> {
  const dir = path.join(tmpDir, `${preset.database}-${preset.strategy}-${preset.orm}-${preset.framework}`);
  fs.mkdirSync(dir, { recursive: true });
  createPresetProject("secure-app", preset, dir, true);
  return readAll(dir);
}

function genTemplate(template: Template): Record<string, string> {
  const dir = path.join(tmpDir, template);
  fs.mkdirSync(dir, { recursive: true });
  createProject("secure-app", template, dir, true);
  return readAll(dir);
}

const FRAMEWORKS: Framework[] = ["express", "fastify", "nextjs", "hono", "nestjs"];

/** Code that reads the tenant from a client-supplied x-tenant-id request header. */
const READS_TENANT_HEADER =
  /headers\[["']x-tenant-id["']\]|headers\.get\(["']x-tenant-id["']\)|req\.header\(["']x-tenant-id["']\)/i;

describe("generated tenant resolution does not trust a client-supplied tenant header", () => {
  for (const framework of FRAMEWORKS) {
    it(`${framework} preset resolves the tenant without reading x-tenant-id from the request`, () => {
      const files = genPreset({ database: "postgres", strategy: "rls", orm: "pg", framework });
      for (const [name, content] of Object.entries(files)) {
        expect(content, name).not.toMatch(READS_TENANT_HEADER);
      }
    });
  }

  it("nextjs preset middleware strips an inbound x-tenant-id before forwarding", () => {
    const files = genPreset({ database: "postgres", strategy: "rls", orm: "pg", framework: "nextjs" });
    expect(files["middleware.ts"]).toContain(`requestHeaders.delete("x-tenant-id")`);
  });

  it("nextjs template middleware strips an inbound x-tenant-id and never reads it", () => {
    const files = genTemplate("nextjs");
    expect(files["middleware.ts"]).not.toMatch(READS_TENANT_HEADER);
    expect(files["middleware.ts"]).toContain(`requestHeaders.delete("x-tenant-id")`);
  });
});

/** user:password from a postgres:// URL. */
function pgUser(url: string): string {
  const m = url.match(/postgres(?:ql)?:\/\/([^:@/]+):/);
  if (!m) throw new Error(`no postgres URL user in ${url}`);
  return m[1];
}

function envValue(env: string, key: string): string {
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) throw new Error(`${key} not set`);
  return m[1];
}

function composeValue(compose: string, key: string): string {
  const m = compose.match(new RegExp(`^\\s+${key}: (.*)$`, "m"));
  if (!m) throw new Error(`${key} not set`);
  return m[1];
}

describe("generated postgres projects connect the app as a role that RLS applies to", () => {
  const postgresPresets: StackPreset[] = VALID_COMBINATIONS.postgres.strategies.map((strategy) => ({
    database: "postgres",
    strategy,
    orm: "pg",
    framework: "express",
  }));

  for (const preset of postgresPresets) {
    it(`postgres-${preset.strategy} preset DATABASE_URL is not the bootstrap superuser`, () => {
      const files = genPreset(preset);
      const superuser = composeValue(files["docker-compose.yml"], "POSTGRES_USER");
      const appUser = pgUser(envValue(files[".env.example"], "DATABASE_URL"));
      expect(appUser).not.toBe(superuser);
      expect(files["init.sql"]).toMatch(
        new RegExp(`CREATE ROLE ${appUser} WITH LOGIN PASSWORD '[^']+' NOSUPERUSER NOBYPASSRLS`),
      );
    });
  }

  it("default template DATABASE_URL is not the bootstrap superuser", () => {
    const files = genTemplate("express");
    const superuser = composeValue(files["docker-compose.yml"], "POSTGRES_USER");
    const appUser = pgUser(envValue(files[".env.example"], "DATABASE_URL"));
    expect(appUser).not.toBe(superuser);
    expect(files["init.sql"]).toMatch(
      new RegExp(`CREATE ROLE ${appUser} WITH LOGIN PASSWORD '[^']+' NOSUPERUSER NOBYPASSRLS`),
    );
  });

  it("rls preset init.sql tells the reader to FORCE row-level security", () => {
    const files = genPreset({ database: "postgres", strategy: "rls", orm: "pg", framework: "express" });
    expect(files["init.sql"]).toContain("FORCE ROW LEVEL SECURITY");
    expect(files["init.sql"]).toContain("app.current_tenant_id");
  });
});
