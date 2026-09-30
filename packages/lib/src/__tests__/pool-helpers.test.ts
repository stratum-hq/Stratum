import { describe, it, expect, vi } from "vitest";
import type pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";

// The fake client fails the named statement, so each test can put the failure
// in the caller's work, in the ROLLBACK, or in both.
function makeFakePool(failures: Record<string, Error>) {
  const query = vi.fn(async (sql: string) => {
    const failure = failures[sql];
    if (failure) throw failure;
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as pg.PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;
  return { pool, query, release };
}

const helpers = [
  ["withClient", withClient],
  ["withTransaction", withTransaction],
] as const;

describe.each(helpers)("%s", (_name, helper) => {
  it("rethrows the original error when the ROLLBACK also fails", async () => {
    const original = Object.assign(new Error("duplicate key"), { code: "23505" });
    const rollbackFailure = new Error("Client was closed and is not queryable");
    const { pool } = makeFakePool({
      "SELECT work": original,
      ROLLBACK: rollbackFailure,
    });

    await expect(helper(pool, (client) => client.query("SELECT work"))).rejects.toBe(original);
  });

  it("passes the ROLLBACK error to release so the pool discards the connection", async () => {
    const rollbackFailure = new Error("Client was closed and is not queryable");
    const { pool, release } = makeFakePool({
      "SELECT work": new Error("work failed"),
      ROLLBACK: rollbackFailure,
    });

    await expect(helper(pool, (client) => client.query("SELECT work"))).rejects.toThrow(
      "work failed",
    );
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(rollbackFailure);
  });

  it("rolls back and returns the connection to the pool when only the work fails", async () => {
    const original = new Error("work failed");
    const { pool, query, release } = makeFakePool({ "SELECT work": original });

    await expect(helper(pool, (client) => client.query("SELECT work"))).rejects.toBe(original);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBeUndefined();
  });

  it("commits and returns the connection to the pool when the work succeeds", async () => {
    const { pool, query, release } = makeFakePool({});

    await expect(helper(pool, async () => "done")).resolves.toBe("done");
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBeUndefined();
  });
});
