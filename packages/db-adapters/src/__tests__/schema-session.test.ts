import { describe, it, expect, vi } from "vitest";
import { setSchemaSearchPath } from "../schema/session.js";
import type pg from "pg";

function makeClient(): pg.PoolClient {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { query } as unknown as pg.PoolClient;
}

describe("setSchemaSearchPath", () => {
  it("sets the search_path for a valid tenant slug", async () => {
    const client = makeClient();
    await setSchemaSearchPath(client, "acme_corp_2024");
    expect(client.query).toHaveBeenCalledWith(
      "SET LOCAL search_path TO tenant_acme_corp_2024, public",
    );
  });

  it("rejects a slug outside the canonical charset before issuing any query", async () => {
    const client = makeClient();
    // Anything with characters outside the slug charset must never reach the
    // search_path statement (the schema name is interpolated, not bound).
    await expect(
      setSchemaSearchPath(client, "bad; DROP TABLE tenants--"),
    ).rejects.toThrow(/Invalid tenant slug/);
    expect(client.query).not.toHaveBeenCalled();
  });
});
