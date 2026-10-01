import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Deployment-safety rules that apply to every environment except development
 * and test, matching the JWT_SECRET startup checks. An unset NODE_ENV counts
 * as development.
 */
const libMigrate = vi.hoisted(() => vi.fn());
vi.mock("@stratum-hq/lib", () => ({ migrate: libMigrate }));
const adminPool = vi.hoisted(() => ({ value: undefined as object | undefined }));
/** A pool stand-in whose login is `me`. */
function loginPool(me: string) {
  return { name: me, query: vi.fn(async () => ({ rows: [{ me }] })) };
}
const APP_POOL = loginPool("app");
vi.mock("../db/connection.js", () => ({ getPool: () => APP_POOL, getAdminPool: () => adminPool.value }));

const STRONG_SECRET = "s".repeat(48);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  libMigrate.mockReset();
  adminPool.value = undefined;
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

describe("migrations with DATABASE_ADMIN_URL", () => {
  async function migrateCall(nodeEnv: string): Promise<Record<string, unknown>> {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.resetModules();
    const { migrate } = await import("../db/migrate.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await migrate();
    return libMigrate.mock.calls[0][0];
  }

  it("runs the migrations on the application pool when no admin pool is configured", async () => {
    const call = await migrateCall("production");
    expect(call.pool).toBe(APP_POOL);
    expect(call).not.toHaveProperty("controlRole");
  });

  it("runs the migrations on the admin pool when one is configured, without the RLS check on the admin login", async () => {
    const ADMIN = loginPool("admin");
    adminPool.value = ADMIN;
    const call = await migrateCall("production");
    expect(call.pool).toBe(ADMIN);
    expect(call.enforceRls).toBeUndefined();
  });

  it("refuses an admin URL that logs in as the same role as DATABASE_URL", async () => {
    adminPool.value = loginPool("app");
    await expect(migrateCall("production")).rejects.toThrow(
      /DATABASE_ADMIN_URL and DATABASE_URL log in as the same role "app"/,
    );
    expect(libMigrate).not.toHaveBeenCalled();
  });

  it("passes STRATUM_CONTROL_ROLE to the migrations as the control role", async () => {
    vi.stubEnv("STRATUM_CONTROL_ROLE", "acme_control");
    const call = await migrateCall("development");
    expect(call.controlRole).toBe("acme_control");
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
