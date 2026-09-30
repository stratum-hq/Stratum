import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { scan } from "../scan.js";
import { connectDb, scanTables } from "../../utils/db.js";

vi.mock("../../utils/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/db.js")>()),
  connectDb: vi.fn(),
  scanTables: vi.fn(),
}));

describe("scan --generate", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("generates a policy that reads the tenant setting with NULLIF", async () => {
    (connectDb as Mock).mockResolvedValue({ end: vi.fn(() => Promise.resolve()) });
    (scanTables as Mock).mockResolvedValue([
      { table_name: "orders", has_tenant_id: true, rls_enabled: false, rls_forced: false, has_policy: false },
    ]);

    await scan([], { generate: true });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain('CREATE POLICY tenant_isolation ON "orders"');
    expect(output).toContain(
      "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid",
    );
  });
});
