import { describe, it, expect, vi, beforeEach } from "vitest";
import { withMysqlTenantScope } from "../integrations/sequelize.js";
import type { SequelizeLike } from "../integrations/sequelize.js";

function createMockSequelize(): SequelizeLike {
  return {
    query: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation((fn: (t: unknown) => Promise<unknown>) =>
      fn({}),
    ),
  };
}

describe("withMysqlTenantScope", () => {
  let sequelize: SequelizeLike;

  beforeEach(() => {
    sequelize = createMockSequelize();
  });

  it("sets session variable before executing fn", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    await withMysqlTenantScope(sequelize, "tenant1", fn);

    expect(sequelize.query).toHaveBeenCalledWith("SET @stratum_tenant_id = ?", {
      replacements: ["tenant1"],
    });
  });

  it("clears session variable after fn completes", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    await withMysqlTenantScope(sequelize, "tenant1", fn);

    expect(sequelize.query).toHaveBeenLastCalledWith("SET @stratum_tenant_id = NULL");
  });

  it("clears session variable even when fn throws (try/finally)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fn failed"));

    await expect(withMysqlTenantScope(sequelize, "tenant1", fn)).rejects.toThrow("fn failed");

    expect(sequelize.query).toHaveBeenLastCalledWith("SET @stratum_tenant_id = NULL");
  });

  it("passes correct tenantId to SET query", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await withMysqlTenantScope(sequelize, "my_tenant", fn);

    const calls = (sequelize.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toEqual(["SET @stratum_tenant_id = ?", { replacements: ["my_tenant"] }]);
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
