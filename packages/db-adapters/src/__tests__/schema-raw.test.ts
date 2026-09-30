import { describe, it, expect, vi } from "vitest";
import type pg from "pg";
import { SchemaRawAdapter } from "../adapters/schema-raw.js";

// The fake client fails every statement that starts with a prefix in `failOn`.
function makePool(failOn: string[] = []) {
  const query = vi.fn(async (text: string) => {
    if (failOn.some((prefix) => text.startsWith(prefix))) {
      throw new Error(`${text} failed`);
    }
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as pg.PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;
  return { pool, query, release };
}

describe("SchemaRawAdapter.executeWithTenantContext", () => {
  it("returns the connection to the pool when RESET succeeds", async () => {
    const { pool, release } = makePool();
    const adapter = new SchemaRawAdapter(pool);

    await expect(adapter.executeWithTenantContext("acme", async () => "ok")).resolves.toBe("ok");

    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBeUndefined();
  });

  it("destroys the connection when RESET fails after a commit", async () => {
    const { pool, release } = makePool(["RESET"]);
    const adapter = new SchemaRawAdapter(pool);

    await expect(adapter.executeWithTenantContext("acme", async () => "ok")).resolves.toBe("ok");

    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("keeps the callback error and destroys the connection when RESET also fails", async () => {
    const { pool, release } = makePool(["RESET"]);
    const adapter = new SchemaRawAdapter(pool);
    const original = new Error("callback failed");

    await expect(
      adapter.executeWithTenantContext("acme", async () => {
        throw original;
      }),
    ).rejects.toBe(original);

    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
