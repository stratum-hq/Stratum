import { describe, it, expect, vi } from "vitest";
import type pg from "pg";
import { DatabaseRawAdapter } from "../adapters/database-raw.js";
import type { DatabasePoolManager } from "../database/pool-manager.js";

function makeAdapter(queryImpl: (text: string) => Promise<unknown>) {
  const events: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      events.push(`query:${text}`);
      return queryImpl(text);
    }),
    release: vi.fn((_err?: Error) => events.push("client.release")),
  };
  const pool = { connect: vi.fn(async () => client) };
  const poolManager = {
    getPool: vi.fn(async () => pool as unknown as pg.Pool),
    releasePool: vi.fn((slug: string) => events.push(`releasePool:${slug}`)),
  };
  const adapter = new DatabaseRawAdapter(poolManager as unknown as DatabasePoolManager);
  return { adapter, poolManager, events, client };
}

describe("DatabaseRawAdapter", () => {
  it("releases the tenant pool after a query", async () => {
    const { adapter, events } = makeAdapter(async () => ({ rows: [] }));

    await adapter.query("acme", "SELECT 1");

    expect(events).toEqual(["query:SELECT 1", "client.release", "releasePool:acme"]);
  });

  it("releases the tenant pool when a query fails", async () => {
    const { adapter, poolManager } = makeAdapter(async () => {
      throw new Error("boom");
    });

    await expect(adapter.query("acme", "SELECT 1")).rejects.toThrow("boom");

    expect(poolManager.releasePool).toHaveBeenCalledWith("acme");
  });

  it("releases the tenant pool after a transaction", async () => {
    const { adapter, events } = makeAdapter(async () => ({ rows: [] }));

    await adapter.executeWithTenantContext("acme", async () => "done");

    expect(events.at(-1)).toBe("releasePool:acme");
  });

  it("releases the tenant pool when a transaction fails", async () => {
    const { adapter, poolManager } = makeAdapter(async () => ({ rows: [] }));

    await expect(
      adapter.executeWithTenantContext("acme", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(poolManager.releasePool).toHaveBeenCalledWith("acme");
  });

  it("keeps the callback error and destroys the connection when ROLLBACK fails", async () => {
    const { adapter, events, client } = makeAdapter(async (text) => {
      if (text === "ROLLBACK") throw new Error("rollback failed");
      return { rows: [] };
    });

    await expect(
      adapter.executeWithTenantContext("acme", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(events.at(-1)).toBe("releasePool:acme");
  });

  it("returns the connection to the pool when ROLLBACK succeeds", async () => {
    const { adapter, client } = makeAdapter(async () => ({ rows: [] }));

    await expect(
      adapter.executeWithTenantContext("acme", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0][0]).toBeUndefined();
  });
});
