import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { doctor } from "../doctor.js";
import { connectDb } from "../../utils/db.js";

// The fake pool answers the data checks directly, so the RLS bypass only
// passes the pool through.
vi.mock("../../utils/db.js", () => ({
  connectDb: vi.fn(),
  withRlsBypass: vi.fn((pool: unknown, fn: (client: unknown) => unknown) => fn(pool)),
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
 * which Stratum tables the schema check finds, and `maxDepth` is the deepest
 * active tenant. Everything else reports a clean, healthy database.
 */
function makeFakePool(schemaTables: string[], maxDepth = 3) {
  const pool = {
    query: vi.fn((sql: string) => {
      if (sql.includes("SHOW server_version")) {
        return Promise.resolve({ rows: [{ server_version: "16.9" }] });
      }
      if (sql.includes("pg_tables") && sql.includes("ANY($1)")) {
        return Promise.resolve({ rows: schemaTables.map((t) => ({ tablename: t })) });
      }
      if (sql.includes("MAX(depth)")) {
        return Promise.resolve({ rows: [{ max_depth: String(maxDepth) }] });
      }
      if (sql.includes("depth > $1")) {
        return Promise.resolve({
          rows: [{ id: "deadbeef-0000-0000-0000-000000000000", name: "Deep Tenant", depth: maxDepth }],
        });
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
  let savedDepthWarning: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
    savedKey = process.env.STRATUM_ENCRYPTION_KEY;
    process.env.STRATUM_ENCRYPTION_KEY = "test-key";
    savedDepthWarning = process.env.STRATUM_DOCTOR_DEPTH_WARNING;
    delete process.env.STRATUM_DOCTOR_DEPTH_WARNING;
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
    if (savedKey === undefined) delete process.env.STRATUM_ENCRYPTION_KEY;
    else process.env.STRATUM_ENCRYPTION_KEY = savedKey;
    if (savedDepthWarning === undefined) delete process.env.STRATUM_DOCTOR_DEPTH_WARNING;
    else process.env.STRATUM_DOCTOR_DEPTH_WARNING = savedDepthWarning;
  });

  const output = () => logSpy.mock.calls.flat().join("\n");
  const treeDepthLine = () =>
    logSpy.mock.calls.flat().find((line) => String(line).includes("Tree depth")) as string;

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

  describe("tree depth advisory", () => {
    it("passes and reports the maximum depth at or below the warning threshold", async () => {
      (connectDb as Mock).mockResolvedValue(makeFakePool(STRATUM_TABLES, 20));

      await doctor({});

      expect(treeDepthLine()).toContain("✓");
      expect(treeDepthLine()).toContain("Max depth: 20 (warning threshold: 20)");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("warns above the default threshold of 20 and does not exit non-zero", async () => {
      (connectDb as Mock).mockResolvedValue(makeFakePool(STRATUM_TABLES, 50));

      await doctor({});

      expect(treeDepthLine()).toContain("⚠");
      expect(treeDepthLine()).toContain("Max depth: 50 (warning threshold: 20)");
      expect(output()).toContain("Deep Tenant (deadbeef...): depth 50");
      expect(output()).toContain("0 failed");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("never calls the depth a limit", async () => {
      (connectDb as Mock).mockResolvedValue(makeFakePool(STRATUM_TABLES, 50));

      await doctor({});

      expect(output()).not.toMatch(/limit/i);
    });

    it("takes the threshold from the --depth-warning flag", async () => {
      (connectDb as Mock).mockResolvedValue(makeFakePool(STRATUM_TABLES, 8));

      await doctor({ "depth-warning": "5" });

      expect(treeDepthLine()).toContain("⚠");
      expect(treeDepthLine()).toContain("Max depth: 8 (warning threshold: 5)");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("takes the threshold from STRATUM_DOCTOR_DEPTH_WARNING", async () => {
      process.env.STRATUM_DOCTOR_DEPTH_WARNING = "30";
      (connectDb as Mock).mockResolvedValue(makeFakePool(STRATUM_TABLES, 25));

      await doctor({});

      expect(treeDepthLine()).toContain("✓");
      expect(treeDepthLine()).toContain("Max depth: 25 (warning threshold: 30)");
    });

    it("prefers the --depth-warning flag to STRATUM_DOCTOR_DEPTH_WARNING", async () => {
      process.env.STRATUM_DOCTOR_DEPTH_WARNING = "30";
      (connectDb as Mock).mockResolvedValue(makeFakePool(STRATUM_TABLES, 25));

      await doctor({ "depth-warning": "10" });

      expect(treeDepthLine()).toContain("⚠");
      expect(treeDepthLine()).toContain("(warning threshold: 10)");
    });

    it.each([["abc"], ["0"], ["-3"], ["2.5"], [true]])(
      "warns about an invalid threshold %s, uses the default, and does not exit non-zero",
      async (value) => {
        (connectDb as Mock).mockResolvedValue(makeFakePool(STRATUM_TABLES, 3));

        await doctor({ "depth-warning": value });

        expect(treeDepthLine()).toContain("⚠");
        expect(treeDepthLine()).toContain("Max depth: 3 (warning threshold: 20)");
        expect(output()).toContain("--depth-warning must be a positive integer");
        expect(exitSpy).not.toHaveBeenCalled();
      },
    );
  });
});
