import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bootstrapRolesSql } from "@stratum-hq/lib";
import { db } from "../db.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("stratum db", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const output = () => logSpy.mock.calls.flat().join("\n");

  it("db roles prints the bootstrap SQL of @stratum-hq/lib without connecting", async () => {
    await db(["roles"], { "admin-role": "acme_admin", "app-role": "acme_app", "control-role": "acme_control" });
    expect(output()).toContain(
      bootstrapRolesSql({ adminRole: "acme_admin", appRole: "acme_app", controlRole: "acme_control", schema: "public" }),
    );
  });

  it("db roles prints only SQL and SQL comments, so the output can be piped to psql", async () => {
    await db(["roles"], { "admin-role": "acme_admin", "app-role": "acme_app" });
    const firstLines = output().split("\n").slice(0, 2);
    expect(firstLines.every((l) => l.startsWith("--"))).toBe(true);
  });

  it("db roles grants REFERENCES on tenants(id) to the app login only with --grant-references", async () => {
    await db(["roles"], { "app-role": "acme_app" });
    expect(output()).not.toContain("GRANT REFERENCES");
    logSpy.mockClear();
    await db(["roles"], { "app-role": "acme_app", "grant-references": true });
    expect(output()).toContain(`GRANT REFERENCES (id) ON "public".tenants TO "acme_app";`);
  });

  it("db roles refuses --grant-references without --app-role", async () => {
    await expect(db(["roles"], { "grant-references": true })).rejects.toThrow(/needs --app-role/);
  });

  it("db roles refuses the same login as admin and app", async () => {
    await expect(db(["roles"], { "admin-role": "acme", "app-role": "acme" })).rejects.toThrow(/must be different/);
  });

  it("db roles refuses a role name that is not a plain lowercase identifier", async () => {
    await expect(db(["roles"], { "app-role": "app; DROP TABLE tenants" })).rejects.toThrow(/Invalid --app-role/);
  });

  it("exits 1 for an unknown db command", async () => {
    await expect(db(["explode"], {})).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
