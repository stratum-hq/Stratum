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

  it("nextjs preset proxy strips an inbound x-tenant-id before forwarding", () => {
    const files = genPreset({ database: "postgres", strategy: "rls", orm: "pg", framework: "nextjs" });
    expect(files["src/proxy.ts"]).toContain(`requestHeaders.delete("x-tenant-id")`);
  });

  it("nextjs template proxy strips an inbound x-tenant-id and never reads it", () => {
    const files = genTemplate("nextjs");
    expect(files["src/proxy.ts"]).not.toMatch(READS_TENANT_HEADER);
    expect(files["src/proxy.ts"]).toContain(`requestHeaders.delete("x-tenant-id")`);
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

  for (const preset of postgresPresets) {
    it(`postgres-${preset.strategy} preset gives Stratum its own login and the app no CREATE on public`, () => {
      const files = genPreset(preset);
      const superuser = composeValue(files["docker-compose.yml"], "POSTGRES_USER");
      const appUser = pgUser(envValue(files[".env.example"], "DATABASE_URL"));
      const stratumUser = pgUser(envValue(files[".env.example"], "STRATUM_ADMIN_DATABASE_URL"));
      const sql = files["init.sql"];
      expect(stratumUser).not.toBe(superuser);
      expect(stratumUser).not.toBe(appUser);
      expect(sql).toMatch(new RegExp(`CREATE ROLE ${stratumUser} WITH LOGIN PASSWORD '[^']+' NOSUPERUSER NOBYPASSRLS;`));
      expect(sql).toContain(`GRANT stratum_control TO ${stratumUser} WITH INHERIT TRUE, SET TRUE;`);
      expect(sql).toContain(`GRANT USAGE ON SCHEMA public TO ${appUser};`);
      expect(sql).not.toMatch(new RegExp(`GRANT [A-Z, ]*CREATE ON SCHEMA public TO ${appUser}`));
      // Default privileges only for what the bootstrap superuser creates, never for every creator.
      for (const line of sql.split("\n").filter((l) => l.startsWith("ALTER DEFAULT PRIVILEGES"))) {
        expect(line).toMatch(new RegExp(`^ALTER DEFAULT PRIVILEGES FOR ROLE ${superuser} IN SCHEMA (public|app) `));
      }
      expect(sql).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC;");
    });
  }

  it("postgres-schema preset keeps other schemas off the search path of the Stratum login and the superuser", () => {
    const files = genPreset({ database: "postgres", strategy: "schema", orm: "pg", framework: "express" });
    const stratumUrl = envValue(files[".env.example"], "STRATUM_ADMIN_DATABASE_URL");
    const stratumUser = pgUser(stratumUrl);
    const db = new URL(stratumUrl).pathname.slice(1);
    const sql = files["init.sql"];
    // Set in this database only, not for the whole cluster.
    for (const role of [stratumUser, "CURRENT_USER"]) {
      expect(sql).toContain(`ALTER ROLE ${role} IN DATABASE ${db} SET search_path = public;`);
    }
    expect(sql).not.toMatch(/ALTER ROLE \S+ SET search_path/);
  });

  it("names the superuser URL DATABASE_SUPERUSER_URL, not the admin login's DATABASE_ADMIN_URL", () => {
    const files = genPreset({ database: "postgres", strategy: "rls", orm: "pg", framework: "express" });
    expect(files[".env.example"]).toMatch(/^DATABASE_SUPERUSER_URL=/m);
    expect(files[".env.example"]).not.toMatch(/DATABASE_ADMIN_URL/);
  });

  it("rls preset init.sql tells the reader to FORCE row-level security", () => {
    const files = genPreset({ database: "postgres", strategy: "rls", orm: "pg", framework: "express" });
    expect(files["init.sql"]).toContain("FORCE ROW LEVEL SECURITY");
    expect(files["init.sql"]).toContain("app.current_tenant_id");
  });
});
