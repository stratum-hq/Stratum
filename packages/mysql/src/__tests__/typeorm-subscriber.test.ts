import { describe, it, expect, vi, beforeEach } from "vitest";
import { StratumTypeOrmSubscriber } from "../integrations/typeorm-subscriber.js";

vi.mock("@stratum-hq/sdk", () => ({
  getTenantContext: vi.fn(),
}));

import { getTenantContext } from "@stratum-hq/sdk";

describe("StratumTypeOrmSubscriber", () => {
  let subscriber: StratumTypeOrmSubscriber;

  beforeEach(() => {
    subscriber = new StratumTypeOrmSubscriber();
    vi.clearAllMocks();
  });

  it("injects tenant_id from ALS context into entity before insert", () => {
    (getTenantContext as ReturnType<typeof vi.fn>).mockReturnValue({ tenant_id: "tenant1" });

    const entity: Record<string, unknown> = { name: "Alice" };
    subscriber.beforeInsert({ entity });

    expect(entity["tenant_id"]).toBe("tenant1");
  });

  it("throws when no tenant context is available", () => {
    (getTenantContext as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("No tenant context");
    });

    const entity: Record<string, unknown> = { name: "Bob" };
    expect(() => subscriber.beforeInsert({ entity })).toThrow("No tenant context");
  });

  it("drops tenant_id in any letter case from update SET values", () => {
    const entity: Record<string, unknown> = { name: "x", TENANT_ID: "t2", Tenant_Id: "t3" };
    subscriber.beforeUpdate({ entity });
    expect(entity).toEqual({ name: "x" });
  });

  it("drops a property mapped to the tenant_id column from update SET values", () => {
    const entity: Record<string, unknown> = { name: "x", tenantId: "t2" };
    subscriber.beforeUpdate({
      entity,
      metadata: {
        columns: [
          { propertyName: "name", databaseName: "name" },
          { propertyName: "tenantId", databaseName: "tenant_id" },
        ],
      },
    });
    expect(entity).toEqual({ name: "x" });
  });

  it("restores the loaded tenant_id when a saved entity carries another one", () => {
    const entity: Record<string, unknown> = { id: 1, name: "x", tenant_id: "t2" };
    subscriber.beforeUpdate({ entity, databaseEntity: { id: 1, name: "old", tenant_id: "t1" } });
    expect(entity).toEqual({ id: 1, name: "x", tenant_id: "t1" });
  });
});
