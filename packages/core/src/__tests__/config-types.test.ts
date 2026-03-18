import { describe, it, expect } from "vitest";
import type {
  BatchSetConfigResult,
  BatchSetConfigKeyResult,
  ConfigEntry,
} from "../types/config.js";

describe("BatchSetConfigResult shape validation", () => {
  it("has results array, succeeded count, and failed count", () => {
    const result: BatchSetConfigResult = {
      results: [],
      succeeded: 0,
      failed: 0,
    };

    expect(result.results).toBeInstanceOf(Array);
    expect(typeof result.succeeded).toBe("number");
    expect(typeof result.failed).toBe("number");
  });

  it("results array contains BatchSetConfigKeyResult items", () => {
    const okResult: BatchSetConfigKeyResult = {
      key: "my_key",
      status: "ok",
      entry: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        tenant_id: "660e8400-e29b-41d4-a716-446655440000",
        key: "my_key",
        value: "some_value",
        inherited: false,
        source_tenant_id: "660e8400-e29b-41d4-a716-446655440000",
        locked: false,
        sensitive: false,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
      },
    };

    const errResult: BatchSetConfigKeyResult = {
      key: "locked_key",
      status: "error",
      error: "Config 'locked_key' is locked by tenant xyz",
    };

    const batchResult: BatchSetConfigResult = {
      results: [okResult, errResult],
      succeeded: 1,
      failed: 1,
    };

    expect(batchResult.results).toHaveLength(2);
    expect(batchResult.succeeded).toBe(1);
    expect(batchResult.failed).toBe(1);
  });

  it("succeeded + failed equals results length", () => {
    const results: BatchSetConfigKeyResult[] = [
      { key: "a", status: "ok", entry: makeMinimalEntry("a") },
      { key: "b", status: "error", error: "locked" },
      { key: "c", status: "ok", entry: makeMinimalEntry("c") },
    ];

    const batch: BatchSetConfigResult = {
      results,
      succeeded: 2,
      failed: 1,
    };

    expect(batch.succeeded + batch.failed).toBe(batch.results.length);
  });
});

describe("BatchSetConfigKeyResult with ok status", () => {
  it("has key, status ok, and an entry", () => {
    const result: BatchSetConfigKeyResult = {
      key: "feature_flag",
      status: "ok",
      entry: makeMinimalEntry("feature_flag"),
    };

    expect(result.key).toBe("feature_flag");
    expect(result.status).toBe("ok");
    expect(result.entry).toBeDefined();
    expect(result.entry!.key).toBe("feature_flag");
    expect(result.error).toBeUndefined();
  });

  it("entry contains all required ConfigEntry fields", () => {
    const entry = makeMinimalEntry("test_key");
    const result: BatchSetConfigKeyResult = {
      key: "test_key",
      status: "ok",
      entry,
    };

    expect(result.entry!.id).toBeDefined();
    expect(result.entry!.tenant_id).toBeDefined();
    expect(result.entry!.key).toBe("test_key");
    expect(result.entry!.value).toBeDefined();
    expect(typeof result.entry!.inherited).toBe("boolean");
    expect(result.entry!.source_tenant_id).toBeDefined();
    expect(typeof result.entry!.locked).toBe("boolean");
    expect(typeof result.entry!.sensitive).toBe("boolean");
    expect(result.entry!.created_at).toBeDefined();
    expect(result.entry!.updated_at).toBeDefined();
  });
});

describe("BatchSetConfigKeyResult with error status", () => {
  it("has key, status error, and an error message", () => {
    const result: BatchSetConfigKeyResult = {
      key: "restricted_key",
      status: "error",
      error: "Config 'restricted_key' is locked by tenant parent-123 and cannot be overridden",
    };

    expect(result.key).toBe("restricted_key");
    expect(result.status).toBe("error");
    expect(result.error).toContain("locked");
    expect(result.entry).toBeUndefined();
  });

  it("error field is a descriptive string", () => {
    const result: BatchSetConfigKeyResult = {
      key: "my_key",
      status: "error",
      error: "Some meaningful error description",
    };

    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it("status is strictly 'ok' or 'error'", () => {
    const ok: BatchSetConfigKeyResult = {
      key: "k",
      status: "ok",
      entry: makeMinimalEntry("k"),
    };
    const err: BatchSetConfigKeyResult = {
      key: "k",
      status: "error",
      error: "fail",
    };

    expect(["ok", "error"]).toContain(ok.status);
    expect(["ok", "error"]).toContain(err.status);
  });
});

// Helper to construct a minimal ConfigEntry
function makeMinimalEntry(key: string): ConfigEntry {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    tenant_id: "660e8400-e29b-41d4-a716-446655440000",
    key,
    value: "test_value",
    inherited: false,
    source_tenant_id: "660e8400-e29b-41d4-a716-446655440000",
    locked: false,
    sensitive: false,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  };
}
