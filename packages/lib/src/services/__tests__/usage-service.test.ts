import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing usage-service.
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as usageService from "../usage-service.js";

function makeMockPool() {
  return {} as import("pg").Pool;
}

const TENANT = "550e8400-e29b-41d4-a716-446655440000";

// Row shape as it comes back over the wire: quantity is BIGINT (a string).
const mockRow = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant_id: TENANT,
  metric: "api.calls",
  quantity: "5",
  idempotency_key: null,
  metadata: {},
  occurred_at: "2026-07-01 00:00:00+00",
  recorded_at: "2026-07-01 00:00:00+00",
};

/** Wire withClient to a single mocked client.query and return that mock. */
function wireClient(rowsByCall: unknown[][]): ReturnType<typeof vi.fn> {
  const mockQuery = vi.fn();
  for (const rows of rowsByCall) {
    mockQuery.mockResolvedValueOnce({ rows });
  }
  vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
    const client = { query: mockQuery } as unknown as import("pg").PoolClient;
    return fn(client);
  });
  return mockQuery;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordUsage", () => {
  it("inserts a usage event and maps quantity to a number", async () => {
    const mockQuery = wireClient([[mockRow]]);

    const result = await usageService.recordUsage(makeMockPool(), TENANT, {
      metric: "api.calls",
      quantity: 5,
    });

    expect(result.quantity).toBe(5); // BIGINT string -> number
    expect(typeof result.quantity).toBe("number");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO usage_events");
    expect(sql).toContain("ON CONFLICT (tenant_id, metric, idempotency_key)");
    expect(params[0]).toBe(TENANT); // tenant_id
    expect(params[1]).toBe("api.calls"); // metric
    expect(params[2]).toBe(5); // quantity
    expect(params[3]).toBeNull(); // idempotency_key
    expect(params[5]).toBeNull(); // occurred_at -> COALESCE to now()
  });

  it("defaults quantity to 1 and metadata to {}", async () => {
    const mockQuery = wireClient([[{ ...mockRow, quantity: "1" }]]);

    await usageService.recordUsage(makeMockPool(), TENANT, { metric: "seats" });

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe(1); // quantity default
    expect(params[4]).toBe("{}"); // metadata default, JSON-stringified
  });

  it("rejects a non-positive-integer quantity via the input schema", async () => {
    wireClient([[mockRow]]);
    await expect(
      usageService.recordUsage(makeMockPool(), TENANT, { metric: "x", quantity: -1 }),
    ).rejects.toThrow();
    await expect(
      usageService.recordUsage(makeMockPool(), TENANT, { metric: "x", quantity: 1.5 }),
    ).rejects.toThrow();
  });

  it("rejects an empty metric via the input schema", async () => {
    wireClient([[mockRow]]);
    await expect(
      usageService.recordUsage(makeMockPool(), TENANT, { metric: "" }),
    ).rejects.toThrow();
  });

  it("returns the existing event on an idempotency-key conflict (no double insert)", async () => {
    const stored = { ...mockRow, idempotency_key: "evt-1", quantity: "3" };
    // First call (INSERT ... ON CONFLICT DO NOTHING) returns no rows; the
    // service then SELECTs the already-stored event.
    const mockQuery = wireClient([[], [stored]]);

    const result = await usageService.recordUsage(makeMockPool(), TENANT, {
      metric: "api.calls",
      quantity: 3,
      idempotency_key: "evt-1",
    });

    expect(result.idempotency_key).toBe("evt-1");
    expect(result.quantity).toBe(3);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toContain("SELECT");
    expect(mockQuery.mock.calls[1][1]).toEqual([TENANT, "api.calls", "evt-1"]);
  });
});

describe("aggregateUsage", () => {
  it("always scopes to the tenant and groups per metric", async () => {
    const mockQuery = wireClient([
      [{ metric: "api.calls", total: "42", event_count: "7" }],
    ]);

    const result = await usageService.aggregateUsage(makeMockPool(), { tenant_id: TENANT });

    expect(result).toEqual([{ metric: "api.calls", total: 42, event_count: 7 }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("tenant_id = $1");
    expect(sql).toContain("GROUP BY metric");
    expect(sql).toContain("SUM(quantity)");
    expect(params).toEqual([TENANT]);
  });

  it("applies metric and a half-open [from, to) window", async () => {
    const mockQuery = wireClient([[]]);

    await usageService.aggregateUsage(makeMockPool(), {
      tenant_id: TENANT,
      metric: "api.calls",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("metric = $2");
    expect(sql).toContain("occurred_at >= $3"); // from inclusive
    expect(sql).toContain("occurred_at < $4"); // to exclusive
    expect(params).toEqual([
      TENANT,
      "api.calls",
      "2026-07-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ]);
  });
});
