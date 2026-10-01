import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { scan } from "../scan.js";
import { connectDb, scanTables } from "../../utils/db.js";
import * as log from "../../utils/log.js";

vi.mock("../../utils/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/db.js")>()),
  connectDb: vi.fn(),
  scanTables: vi.fn(),
}));

/** A pool whose only query is the check for Stratum's tenants table. */
function fakePool(hasTenants = true) {
  return {
    query: vi.fn(() => Promise.resolve({ rows: [{ ok: hasTenants }] })),
    // The check runs on a client with the search path pinned.
    connect: vi.fn(() =>
      Promise.resolve({ query: vi.fn(() => Promise.resolve({ rows: [{ ok: hasTenants }] })), release: vi.fn() }),
    ),
    end: vi.fn(() => Promise.resolve()),
  };
}

const ESC = String.fromCharCode(27);

describe("scan --generate", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    log.setStream("stdout");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  const stdout = () => logSpy.mock.calls.map((c) => String(c[0])).join("\n");
  const stderr = () => errSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("generates a policy that reads the tenant setting with NULLIF", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool());
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: true, rls_enabled: false, rls_forced: false, has_policy: false },
    ]);

    await scan([], { generate: true });

    expect(stdout()).toContain('CREATE POLICY tenant_isolation ON "orders"');
    expect(stdout()).toContain(
      "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid",
    );
  });

  it("writes only SQL to stdout and the report to stderr", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool());
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: false, rls_enabled: false, rls_forced: false, has_policy: false },
      { table_name: "invoices", has_tenant_id: true, rls_enabled: true, rls_forced: true, has_policy: true },
    ]);

    await scan([], { generate: true });

    const out = stdout();
    expect(out).not.toContain(ESC);
    expect(out).not.toMatch(/Scanning database|Summary|already isolated/);
    // Every line is SQL or a SQL comment.
    for (const line of out.split("\n")) {
      expect(line === "" || line.startsWith("--") || /^[A-Z]/.test(line)).toBe(true);
    }
    expect(out.trimStart().startsWith("-- Stratum Migration Scanner")).toBe(true);
    expect(stderr()).toContain("Scanning database");
    expect(stderr()).toContain("Summary: 1 table(s) need migration");
  });

  it("keeps the report on stdout without --generate", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool());
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: false, rls_enabled: false, rls_forced: false, has_policy: false },
    ]);

    await scan([], {});

    expect(stdout()).toContain("Summary: 1 table(s) need migration");
    expect(stdout()).not.toContain("BEGIN;");
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("adds tenant_id without a foreign key when the tenants table does not exist", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool(false));
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: false, rls_enabled: false, rls_forced: false, has_policy: false },
    ]);

    await scan([], { generate: true });

    expect(stdout()).toContain('ALTER TABLE "orders" ADD COLUMN tenant_id UUID;');
    expect(stdout()).not.toContain("REFERENCES tenants(id)");
  });

  it("references tenants(id) when the tenants table exists", async () => {
    (connectDb as Mock).mockResolvedValue(fakePool(true));
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: false, rls_enabled: false, rls_forced: false, has_policy: false },
    ]);

    await scan([], { generate: true });

    expect(stdout()).toContain('ALTER TABLE "orders" ADD COLUMN tenant_id UUID REFERENCES tenants(id);');
  });
});
