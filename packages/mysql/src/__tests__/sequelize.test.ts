import { describe, it, expect, vi, beforeEach } from "vitest";
import { withMysqlTenantScope } from "../integrations/sequelize.js";
import type { SequelizeLike } from "../integrations/sequelize.js";

/** A stand-in for the Sequelize class: the helper patches its Model class. */
class MockSequelize {
  static Model = class {};
  static Op = { and: Symbol("and") };
  addHook = vi.fn();
  private readonly queryInterface = {};
  getQueryInterface = () => this.queryInterface;
  query = vi.fn().mockResolvedValue(undefined);
  transaction = vi
    .fn()
    .mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn({ id: "mock-txn" }));
}

function createMockSequelize(): SequelizeLike {
  return new MockSequelize();
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

  it("passes the sequelize instance and the scope's transaction to fn", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await withMysqlTenantScope(sequelize, "tenant1", fn);

    const setCall = (sequelize.query as ReturnType<typeof vi.fn>).mock.calls[0];
    const transaction = (setCall[1] as { transaction: unknown }).transaction;
    expect(transaction).toBeDefined();
    expect(fn).toHaveBeenCalledWith(sequelize, transaction);
  });

  it("returns the value returned by fn", async () => {
    const fn = vi.fn().mockResolvedValue("expected-value");
    const result = await withMysqlTenantScope(sequelize, "tenant1", fn);

    expect(result).toBe("expected-value");
  });

  it("refuses an object that is not a Sequelize instance instead of running fn unscoped", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const plain: SequelizeLike = { query: vi.fn(), transaction: vi.fn() };
    await expect(withMysqlTenantScope(plain, "tenant1", fn)).rejects.toThrow(/Sequelize v6 instance/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("guards each Sequelize instance's queries once", async () => {
    const mock = new MockSequelize();
    await withMysqlTenantScope(mock, "tenant1", vi.fn().mockResolvedValue(undefined));
    await withMysqlTenantScope(mock, "tenant1", vi.fn().mockResolvedValue(undefined));
    expect(mock.addHook).toHaveBeenCalledOnce();
    expect(mock.addHook.mock.calls[0][0]).toBe("beforeQuery");
  });
});
