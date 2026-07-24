import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing api-key-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as apiKeyService from "../api-key-service.js";
import { makeMockPool } from "./test-helpers.js";

/** Wire withClient to call the callback with a { query } client. */
function withMockQuery(mockQuery: ReturnType<typeof vi.fn>) {
  vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
    const client = { query: mockQuery } as unknown as import("pg").PoolClient;
    return fn(client);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getApiKey", () => {
  it("selects a key by id and returns its owning tenant", async () => {
    const pool = makeMockPool();
    const row = { id: "key-1", tenant_id: "tenant-1", name: null, created_at: new Date(), last_used_at: null, revoked_at: null, expires_at: null };
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [row] });
    withMockQuery(mockQuery);

    const result = await apiKeyService.getApiKey(pool, "key-1");

    expect(result).toEqual(row);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM api_keys WHERE id = $1");
    expect(sql).toContain("tenant_id");
    expect(params).toEqual(["key-1"]);
  });

  it("returns null when no key has that id", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    withMockQuery(mockQuery);

    const result = await apiKeyService.getApiKey(pool, "ghost");
    expect(result).toBeNull();
  });
});
