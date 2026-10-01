import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { scaffold } from "../scaffold.js";
import { expectEnvSecrets } from "./env-assertions.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("scaffold", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-cli-scaffold-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const read = (rel: string) => fs.readFileSync(path.join(tmpDir, rel), "utf8");
  const exists = (rel: string) => fs.existsSync(path.join(tmpDir, rel));

  it("express template writes middleware and routes using the SDK helpers", async () => {
    await scaffold(["express"], { out: tmpDir });
    expect(exists("stratum-middleware.ts")).toBe(true);
    expect(exists("tenant-routes.ts")).toBe(true);
    expect(read("stratum-middleware.ts")).toContain("expressMiddleware");
  });

  it("fastify template writes the plugin", async () => {
    await scaffold(["fastify"], { out: tmpDir });
    expect(exists("stratum-plugin.ts")).toBe(true);
    expect(read("stratum-plugin.ts")).toContain("fastifyPlugin");
  });

  it("nextjs template writes middleware, lib helper and layout", async () => {
    await scaffold(["nextjs"], { out: tmpDir });
    expect(exists("middleware.ts")).toBe(true);
    expect(exists("lib/stratum.ts")).toBe(true);
    expect(exists("components/tenant-layout.tsx")).toBe(true);
    expect(read("middleware.ts")).toContain("NextResponse");
  });

  it("nextjs template writes the middleware and API route into src when the app lives in src/app", async () => {
    fs.mkdirSync(path.join(tmpDir, "src", "app"), { recursive: true });
    await scaffold(["nextjs"], { out: tmpDir });
    expect(exists("src/middleware.ts")).toBe(true);
    expect(exists("src/app/api/stratum/[...path]/route.ts")).toBe(true);
    expect(exists("middleware.ts")).toBe(false);
    expect(exists("app")).toBe(false);
  });

  it("react template writes provider, guards and hooks", async () => {
    await scaffold(["react"], { out: tmpDir });
    expect(exists("stratum-provider.tsx")).toBe(true);
    expect(exists("tenant-guard.tsx")).toBe(true);
    expect(exists("use-tenant.ts")).toBe(true);
    expect(read("stratum-provider.tsx")).toContain("StratumProvider");
  });

  it("prisma template writes a tenant-scoped client", async () => {
    await scaffold(["prisma"], { out: tmpDir });
    expect(exists("stratum-prisma.ts")).toBe(true);
    expect(read("stratum-prisma.ts")).toContain("prismaWithTenant");
  });

  it("docker template writes a compose file pinned to postgres 16", async () => {
    await scaffold(["docker"], { out: tmpDir });
    expect(exists("docker-compose.stratum.yml")).toBe(true);
    expect(read("docker-compose.stratum.yml")).toContain("postgres:16-alpine");
  });

  it("env template writes a .env.stratum with a generated JWT secret", async () => {
    await scaffold(["env"], { out: tmpDir });
    expect(exists(".env.stratum")).toBe(true);
    const content = read(".env.stratum");
    expect(content).toContain("DATABASE_URL");
    expect(content).toMatch(/JWT_SECRET=.+/);
  });

  it("env template writes the encryption, salt and HMAC secrets and the admin login", async () => {
    await scaffold(["env"], { out: tmpDir });
    expectEnvSecrets(read(".env.stratum"));
  });

  it("env template generates different secrets on each run", async () => {
    await scaffold(["env"], { out: tmpDir });
    const first = read(".env.stratum");
    await scaffold(["env"], { out: tmpDir, force: true });
    const key = (c: string) => c.match(/^STRATUM_ENCRYPTION_KEY=(.+)$/m)?.[1];
    expect(key(first)).toBeDefined();
    expect(key(read(".env.stratum"))).not.toBe(key(first));
  });

  it("docker template sets up the control, admin and app roles of the role model", async () => {
    await scaffold(["docker"], { out: tmpDir });
    const sql = read("stratum-init-db.sql");
    expect(sql).toMatch(/CREATE ROLE stratum_control NOLOGIN NOSUPERUSER NOBYPASSRLS;/);
    expect(sql).toMatch(/CREATE ROLE stratum_admin WITH LOGIN PASSWORD '[^']+' NOSUPERUSER NOBYPASSRLS CREATEDB;/);
    expect(sql).toContain("GRANT stratum_control TO stratum_admin WITH INHERIT TRUE, SET TRUE;");
    expect(sql).toMatch(/CREATE ROLE stratum_app WITH LOGIN PASSWORD '[^']+' NOSUPERUSER NOBYPASSRLS;/);
    // The application login gets no membership in the control role and no
    // privilege on the Stratum tables.
    expect(sql).not.toMatch(/GRANT stratum_control TO stratum_app/);
    expect(sql).not.toMatch(/ON ALL TABLES/);
    const statements = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(statements).not.toMatch(/\bSUPERUSER\b|\bBYPASSRLS\b/);

    const compose = read("docker-compose.stratum.yml");
    expect(compose).toContain("DATABASE_URL: postgres://stratum_app:");
    expect(compose).toContain("DATABASE_ADMIN_URL: postgres://stratum_admin:");
    expect(compose).toMatch(/STRATUM_ENCRYPTION_KEY:\s*\n/);
    expect(compose).toMatch(/STRATUM_HKDF_SALT:\s*\n/);
    expect(compose).toMatch(/STRATUM_API_KEY_HMAC_SECRET:\s*\n/);
  });

  it("docker template runs the same statements as the repository's docker/init-db.sql", async () => {
    await scaffold(["docker"], { out: tmpDir });
    const statements = (sql: string) =>
      sql
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("--") && !l.startsWith("\\c "));
    const repoSql = fs.readFileSync(path.resolve(__dirname, "../../../../../docker/init-db.sql"), "utf8");
    expect(statements(read("stratum-init-db.sql"))).toEqual(statements(repoSql));
  });

  it("skips an existing file without --force but overwrites with --force", async () => {
    await scaffold(["env"], { out: tmpDir });
    // clobber the generated file, then re-run without force -> should be left as-is
    fs.writeFileSync(path.join(tmpDir, ".env.stratum"), "SENTINEL", "utf8");
    await scaffold(["env"], { out: tmpDir });
    expect(read(".env.stratum")).toBe("SENTINEL");
    // with --force it is regenerated
    await scaffold(["env"], { out: tmpDir, force: true });
    expect(read(".env.stratum")).not.toBe("SENTINEL");
    expect(read(".env.stratum")).toContain("DATABASE_URL");
  });

  it("exits 1 with usage when no template is given", async () => {
    await expect(scaffold([], { out: tmpDir })).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("Usage: stratum scaffold");
  });

  it("exits 1 on an unknown template", async () => {
    await expect(scaffold(["nope"], { out: tmpDir })).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("Unknown template: nope");
  });
});
