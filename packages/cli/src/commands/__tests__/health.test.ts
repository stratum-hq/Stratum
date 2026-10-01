import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { health } from "../health.js";
import {
  connectDb,
  checkExtensions,
  checkBypassRLS,
  checkStratumTables,
  scanTables,
} from "../../utils/db.js";

vi.mock("@stratum-hq/lib", () => ({
  inspectRoleModel: vi.fn(() => Promise.resolve({ migrated: false })),
}));
vi.mock("../../utils/db.js", () => ({
  connectDb: vi.fn(),
  connectAdminDb: vi.fn(() => Promise.resolve(undefined)),
  controlRoleFlag: vi.fn(() => undefined),
  checkExtensions: vi.fn(),
  checkBypassRLS: vi.fn(),
  checkStratumTables: vi.fn(),
  scanTables: vi.fn(),
}));

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

function fakePool(version = "16.4") {
  return {
    query: vi.fn(() => Promise.resolve({ rows: [{ server_version: version }] })),
    end: vi.fn(() => Promise.resolve()),
  };
}

describe("health exit code", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
    (checkExtensions as Mock).mockResolvedValue({ uuid_ossp: true, ltree: true });
    (checkBypassRLS as Mock).mockResolvedValue(false);
    (checkStratumTables as Mock).mockResolvedValue(true);
    (scanTables as Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("returns normally when every check passes", async () => {
    const pool = fakePool();
    (connectDb as Mock).mockResolvedValue(pool);

    await health({});

    expect(exitSpy).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("returns normally when there are only warnings", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool("15.6"));
    (checkStratumTables as Mock).mockResolvedValue(false);
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: false, rls_enabled: false, rls_forced: false, has_policy: false },
    ]);

    await health({});

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 when an extension is missing", async () => {
    const pool = fakePool();
    (connectDb as Mock).mockResolvedValue(pool);
    (checkExtensions as Mock).mockResolvedValue({ uuid_ossp: true, ltree: false });

    await expect(health({})).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/1 check\(s\) failed/);
  });

  it("exits 1 when the role has BYPASSRLS", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool());
    (checkBypassRLS as Mock).mockResolvedValue(true);

    await expect(health({})).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when PostgreSQL is older than 14", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool("13.2"));

    await expect(health({})).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when the database connection fails", async () => {
    (connectDb as Mock).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(health({})).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
