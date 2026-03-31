import { describe, it, expect, vi, beforeEach } from "vitest";
import { withMysqlTenantScope } from "../integrations/sequelize.js";
import type { SequelizeLike } from "../integrations/sequelize.js";

function createMockSequelize(): SequelizeLike {
  const mockTransaction = { id: "mock-txn" };
  return {
    query: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(mockTransaction),
    ),
  };
}

describe("withMysqlTenantScope", () => {
  let sequelize: SequelizeLike;

  beforeEach(() => {
    sequelize = createMockSequelize();
  });

  it("uses a transaction to guarantee single connection", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    await withMysqlTenantScope(sequelize, "tenant1", fn);

    expect(sequelize.transaction).toHaveBeenCalledOnce();
  });

  it("sets session variable before executing fn", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    await withMysqlTenantScope(sequelize, "tenant1", fn);

    const calls = (sequelize.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("SET @stratum_tenant_id = ?");
    expect(calls[0][1]).toMatchObject({ replacements: ["tenant1"] });
  });

  it("clears session variable after fn completes", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    await withMysqlTenantScope(sequelize, "tenant1", fn);

    const calls = (sequelize.query as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe("SET @stratum_tenant_id = NULL");
  });

  it("clears session variable even when fn throws (try/finally)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fn failed"));

    await expect(withMysqlTenantScope(sequelize, "tenant1", fn)).rejects.toThrow("fn failed");

    const calls = (sequelize.query as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe("SET @stratum_tenant_id = NULL");
  });

  it("passes sequelize instance to fn", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await withMysqlTenantScope(sequelize, "tenant1", fn);

    expect(fn).toHaveBeenCalledWith(sequelize);
  });

  it("returns the value returned by fn", async () => {
    const fn = vi.fn().mockResolvedValue("expected-value");
    const result = await withMysqlTenantScope(sequelize, "tenant1", fn);

    expect(result).toBe("expected-value");
  });
});
