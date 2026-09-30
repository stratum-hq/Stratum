import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StratumTypeOrmSubscriber,
  registerStratumSubscriber,
} from "../integrations/typeorm-subscriber.js";

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

describe("StratumTypeOrmSubscriber.beforeQuery", () => {
  const subscriber = new StratumTypeOrmSubscriber();

  it("rejects an upsert that updates tenant_id on conflict", () => {
    const query =
      "INSERT INTO `items`(`id`, `tenant_id`, `name`) VALUES (?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `id` = VALUES(`id`), `TENANT_ID` = VALUES(`TENANT_ID`)";
    expect(() => subscriber.beforeQuery({ query })).toThrow(/tenant_id on conflict/);
  });

  it("allows an upsert that leaves tenant_id out of the conflict update when every unique key has tenant_id", async () => {
    const query =
      "INSERT INTO `items`(`id`, `tenant_id`, `name`) VALUES (?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `x_tenant_id` = VALUES(`x_tenant_id`)";
    const queryRunner = {
      query: vi.fn().mockResolvedValue([
        { index_name: "PRIMARY", column_name: "tenant_id" },
        { index_name: "PRIMARY", column_name: "id" },
      ]),
    };
    await expect(subscriber.beforeQuery({ query, queryRunner })).resolves.toBeUndefined();
    expect(queryRunner.query.mock.calls[0][1]).toEqual([null, "items"]);
  });

  it("refuses an upsert whose table's unique keys cannot be checked", async () => {
    const query =
      "INSERT INTO `items`(`id`, `tenant_id`, `name`) VALUES (?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)";
    await expect(subscriber.beforeQuery({ query })).rejects.toThrow(/cannot be checked/);
  });

  it("allows a plain insert that writes tenant_id", () => {
    const query = "INSERT INTO `items`(`id`, `tenant_id`) VALUES (?, ?)";
    expect(() => subscriber.beforeQuery({ query })).not.toThrow();
  });
});

describe("registerStratumSubscriber", () => {
  it("adds one subscriber and returns it on later calls", () => {
    const dataSource = { isInitialized: true, subscribers: [{}] as unknown[] };
    const first = registerStratumSubscriber(dataSource);
    const second = registerStratumSubscriber(dataSource);
    expect(first).toBeInstanceOf(StratumTypeOrmSubscriber);
    expect(second).toBe(first);
    expect(dataSource.subscribers).toHaveLength(2);
  });

  it("returns a subscriber that was pushed by hand", () => {
    const manual = new StratumTypeOrmSubscriber();
    const dataSource = { isInitialized: true, subscribers: [manual] as unknown[] };
    expect(registerStratumSubscriber(dataSource)).toBe(manual);
    expect(dataSource.subscribers).toHaveLength(1);
  });

  it("rejects a data source that is not initialized", () => {
    const dataSource = { isInitialized: false, subscribers: [] as unknown[] };
    expect(() => registerStratumSubscriber(dataSource)).toThrow(/after dataSource.initialize/);
    expect(dataSource.subscribers).toHaveLength(0);
  });
});
