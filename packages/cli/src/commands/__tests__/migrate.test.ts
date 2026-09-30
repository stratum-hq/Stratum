import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { migrate } from "../migrate.js";
import { connectDb, scanTables, type TableInfo } from "../../utils/db.js";
import { confirm } from "../../utils/prompt.js";

vi.mock("../../utils/db.js", () => ({
  connectDb: vi.fn(),
  scanTables: vi.fn(),
}));
vi.mock("../../utils/prompt.js", () => ({
  confirm: vi.fn(),
  ask: vi.fn(),
  select: vi.fn(),
}));

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

/**
 * Fake pg pool whose client records every SQL string it is asked to run.
 * The only query that returns a non-empty result is the table-existence
 * check (`pg_tables ... tablename = $1`, i.e. a query with bound params),
 * so every "add column / enable RLS / create policy / create index" branch
 * in migrateTable fires.
 */
function makeFakePool(
  opts: { tableExists?: boolean; tenantsExists?: boolean; rowCount?: number } = {},
) {
  const { tableExists = true, tenantsExists = false, rowCount = 0 } = opts;
  const queries: string[] = [];

  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => {
      queries.push(sql.trim());
      if (sql.includes("count(*)")) {
        return Promise.resolve({ rows: [{ n: rowCount }] });
      }
      if (sql.includes("pg_tables") && params && params.length > 0) {
        // table-existence check
        return Promise.resolve({ rows: tableExists ? [{ n: 1 }] : [] });
      }
      if (sql.includes("pg_tables") && sql.includes("'tenants'")) {
        return Promise.resolve({ rows: tenantsExists ? [{ n: 1 }] : [] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(() => Promise.resolve(client)),
    query: vi.fn(() => Promise.resolve({ rows: [] })),
    end: vi.fn(() => Promise.resolve()),
  };

  return { pool, client, queries };
}

describe("migrate", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("migrates a table by adding tenant_id, RLS, policy and index in one transaction", async () => {
    const { pool, queries } = makeFakePool();
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]); // unknown table -> info undefined
    (confirm as Mock).mockResolvedValue(true);

    await migrate(["orders"], {});

    const joined = queries.join("\n");
    expect(queries[0]).toBe("BEGIN");
    expect(joined).toMatch(/ADD COLUMN tenant_id UUID/);
    expect(joined).toMatch(/ALTER TABLE orders ENABLE ROW LEVEL SECURITY/);
    expect(joined).toMatch(/ALTER TABLE orders FORCE ROW LEVEL SECURITY/);
    expect(joined).toMatch(/CREATE POLICY tenant_isolation ON orders/);
    expect(joined).toMatch(/CREATE INDEX idx_orders_tenant_id ON orders/);
    expect(queries[queries.length - 1]).toBe("COMMIT");
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("adds a foreign key to tenants when that table exists", async () => {
    const { pool, queries } = makeFakePool({ tenantsExists: true });
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]);
    (confirm as Mock).mockResolvedValue(true);

    await migrate(["orders"], {});

    expect(queries.join("\n")).toMatch(/ADD CONSTRAINT fk_orders_tenant_id/);
  });

  it("adds tenant_id without a default, then adds the foreign key NOT VALID and validates it", async () => {
    const { pool, queries } = makeFakePool({ tenantsExists: true });
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]);
    (confirm as Mock).mockResolvedValue(true);

    await migrate(["orders"], {});

    const joined = queries.join("\n");
    expect(joined).not.toContain("00000000-0000-0000-0000-000000000000");
    expect(queries).toContain("ALTER TABLE orders ADD COLUMN tenant_id UUID");
    expect(joined).toMatch(/REFERENCES tenants\(id\) ON DELETE CASCADE NOT VALID/);
    const validate = queries.indexOf("ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_tenant_id");
    const setNotNull = queries.indexOf("ALTER TABLE orders ALTER COLUMN tenant_id SET NOT NULL");
    expect(validate).toBeGreaterThan(-1);
    expect(setNotNull).toBeGreaterThan(-1);
  });

  it("rolls back before adding tenant_id when the table has rows and --tenant is absent", async () => {
    const { pool, queries } = makeFakePool({ rowCount: 3 });
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]);
    (confirm as Mock).mockResolvedValue(true);

    await expect(migrate(["orders"], {})).rejects.toThrow(/--tenant <uuid>/);
    expect(queries.join("\n")).not.toMatch(/ADD COLUMN/);
    expect(queries).toContain("ROLLBACK");
  });

  it("assigns existing rows to the --tenant tenant before it sets tenant_id NOT NULL", async () => {
    const tenant = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const { pool, client, queries } = makeFakePool({ rowCount: 3 });
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]);
    (confirm as Mock).mockResolvedValue(true);

    await migrate(["orders"], { tenant });

    const update = queries.indexOf("UPDATE orders SET tenant_id = $1 WHERE tenant_id IS NULL");
    const setNotNull = queries.indexOf("ALTER TABLE orders ALTER COLUMN tenant_id SET NOT NULL");
    expect(update).toBeGreaterThan(-1);
    expect(setNotNull).toBeGreaterThan(update);
    expect(client.query).toHaveBeenCalledWith(
      "UPDATE orders SET tenant_id = $1 WHERE tenant_id IS NULL",
      [tenant],
    );
    expect(queries[queries.length - 1]).toBe("COMMIT");
  });

  it.each([
    ["no value", true, /needs a value/],
    ["a value that is not a UUID", "acme", /Expected a UUID/],
    ["the nil UUID", "00000000-0000-0000-0000-000000000000", /nil UUID/],
  ])("rejects --tenant with %s before it connects", async (_label, tenant, message) => {
    await expect(migrate(["orders"], { tenant })).rejects.toThrow(message);
    expect(connectDb).not.toHaveBeenCalled();
  });

  it("rolls back and rethrows when the target table does not exist", async () => {
    const { pool, queries } = makeFakePool({ tableExists: false });
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]);
    (confirm as Mock).mockResolvedValue(true);

    await expect(migrate(["ghost"], {})).rejects.toThrow(/does not exist/);
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsafe table name before issuing any DDL", async () => {
    const { pool, client } = makeFakePool();
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]);
    (confirm as Mock).mockResolvedValue(true);

    await expect(migrate(["orders; DROP TABLE users"], {})).rejects.toThrow(/Invalid table name/);
    expect(client.query).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the target table is already fully migrated", async () => {
    const { pool, client } = makeFakePool();
    (connectDb as Mock).mockResolvedValue(pool);
    const ready: TableInfo = {
      table_name: "orders",
      has_tenant_id: true,
      rls_enabled: true,
      rls_forced: true,
      has_policy: true,
    };
    (scanTables as Mock).mockResolvedValue([ready]);
    (confirm as Mock).mockResolvedValue(true);

    await migrate(["orders"], {});

    expect(client.query).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("aborts the migration when the user declines the confirmation", async () => {
    const { pool, client } = makeFakePool();
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([]);
    (confirm as Mock).mockResolvedValue(false);

    await migrate(["orders"], {});

    expect(client.query).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("--scan lists tables and never opens a migration transaction", async () => {
    const { pool, client } = makeFakePool();
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: false, rls_enabled: false, rls_forced: false, has_policy: false },
      { table_name: "invoices", has_tenant_id: true, rls_enabled: true, rls_forced: true, has_policy: true },
    ] satisfies TableInfo[]);

    await migrate([], { scan: true });

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("orders");
    expect(out).toContain("invoices");
    expect(out).toContain("need migration");
    expect(client.query).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("--all short-circuits when every table is already migrated", async () => {
    const { pool, client } = makeFakePool();
    (connectDb as Mock).mockResolvedValue(pool);
    (scanTables as Mock).mockResolvedValue([
      { table_name: "invoices", has_tenant_id: true, rls_enabled: true, rls_forced: true, has_policy: true },
    ] satisfies TableInfo[]);

    await migrate([], { all: true });

    expect(logSpy.mock.calls.flat().join("\n")).toContain("already migrated");
    expect(client.query).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("prints usage and exits 1 when given neither a table nor a mode flag", async () => {
    const { pool } = makeFakePool();
    (connectDb as Mock).mockResolvedValue(pool);

    await expect(migrate([], {})).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("Usage: stratum migrate");
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
