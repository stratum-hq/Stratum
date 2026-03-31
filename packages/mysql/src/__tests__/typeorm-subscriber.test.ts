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
});
