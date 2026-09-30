import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Deployment-safety rules that apply to every environment except development
 * and test, matching the JWT_SECRET startup checks. An unset NODE_ENV counts
 * as development.
 */
const libMigrate = vi.hoisted(() => vi.fn());
vi.mock("@stratum-hq/lib", () => ({ migrate: libMigrate }));
vi.mock("../db/connection.js", () => ({ getPool: () => ({}) }));

const STRONG_SECRET = "s".repeat(48);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  libMigrate.mockReset();
});

async function runMigrate(nodeEnv: string | undefined): Promise<boolean> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const { migrate } = await import("../db/migrate.js");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await migrate();
  return libMigrate.mock.calls[0][0].enforceRls;
}

describe("migration RLS enforcement", () => {
  it("enforces RLS in any non-development, non-test environment", async () => {
    for (const nodeEnv of ["production", "staging", "preview", "qa"]) {
      libMigrate.mockReset();
      expect(await runMigrate(nodeEnv)).toBe(true);
    }
  });

  it("does not enforce RLS in development, test, or when NODE_ENV is unset", async () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      libMigrate.mockReset();
      expect(await runMigrate(nodeEnv)).toBe(false);
    }
  });
});

describe("JWT_AUDIENCE startup warning", () => {
  async function warningsFor(nodeEnv: string | undefined): Promise<string[]> {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("JWT_SECRET", STRONG_SECRET);
    vi.stubEnv("JWT_AUDIENCE", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    await import("../config.js");
    const messages = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    return messages;
  }

  it("warns about a missing JWT_AUDIENCE in any non-development, non-test environment", async () => {
    for (const nodeEnv of ["production", "staging", "preview", "qa"]) {
      expect((await warningsFor(nodeEnv)).some((m) => m.includes("JWT_AUDIENCE"))).toBe(true);
    }
  });

  it("does not warn about JWT_AUDIENCE in development, test, or when NODE_ENV is unset", async () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      expect((await warningsFor(nodeEnv)).some((m) => m.includes("JWT_AUDIENCE"))).toBe(false);
    }
  });
});
