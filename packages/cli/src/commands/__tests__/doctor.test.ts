import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { doctor } from "../doctor.js";
import { connectDb } from "../../utils/db.js";

vi.mock("../../utils/db.js", () => ({
  connectDb: vi.fn(),
}));

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const STRATUM_TABLES = [
  "tenants",
  "config_entries",
  "permission_policies",
  "api_keys",
  "webhooks",
  "webhook_events",
  "audit_logs",
];

/**
 * Fake pool that answers each doctor check query. `schemaTables` controls
 * which Stratum tables the schema check finds; everything else reports a
 * clean, healthy database.
 */
function makeFakePool(schemaTables: string[]) {
  const pool = {
    query: vi.fn((sql: string) => {
      if (sql.includes("SHOW server_version")) {
        return Promise.resolve({ rows: [{ server_version: "16.9" }] });
      }
      if (sql.includes("pg_tables") && sql.includes("ANY($1)")) {
        return Promise.resolve({ rows: schemaTables.map((t) => ({ tablename: t })) });
      }
      if (sql.includes("MAX(depth)")) {
        return Promise.resolve({ rows: [{ max_depth: "3" }] });
      }
      // RLS, policy, index, orphaned-tenant, api-key checks all come back empty
      return Promise.resolve({ rows: [] });
    }),
    end: vi.fn(() => Promise.resolve()),
  };
  return pool;
}

describe("doctor", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let savedKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
    savedKey = process.env.STRATUM_ENCRYPTION_KEY;
    process.env.STRATUM_ENCRYPTION_KEY = "test-key";
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
    if (savedKey === undefined) delete process.env.STRATUM_ENCRYPTION_KEY;
    else process.env.STRATUM_ENCRYPTION_KEY = savedKey;
  });

  const output = () => logSpy.mock.calls.flat().join("\n");

  it("reports a healthy database and does not exit non-zero", async () => {
    const pool = makeFakePool(STRATUM_TABLES);
    (connectDb as Mock).mockResolvedValue(pool);

    await doctor({});

    const out = output();
    expect(out).toContain("PostgreSQL 16.9");
    expect(out).toContain(`${STRATUM_TABLES.length}/${STRATUM_TABLES.length} tables found`);
    expect(out).toMatch(/\d+ passed/);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("fails and exits 1 when the Stratum schema is missing", async () => {
    const pool = makeFakePool([]); // no Stratum tables
    (connectDb as Mock).mockResolvedValue(pool);

    await expect(doctor({})).rejects.toBeInstanceOf(ExitError);
    expect(output()).toContain("No Stratum tables found");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("reports connectivity failure and exits 1 when the database is unreachable", async () => {
    (connectDb as Mock).mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

    await expect(doctor({})).rejects.toBeInstanceOf(ExitError);
    const out = output();
    expect(out).toContain("Connection failed");
    expect(out).toContain("0 passed, 1 failed");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
