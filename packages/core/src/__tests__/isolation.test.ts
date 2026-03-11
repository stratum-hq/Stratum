import { describe, it, expect } from "vitest";
import {
  SUPPORTED_ISOLATION_STRATEGIES,
  SUPPORTED_ISOLATION_STRATEGIES_V1,
  isSupportedIsolationStrategy,
} from "../types/isolation.js";

describe("SUPPORTED_ISOLATION_STRATEGIES", () => {
  it("includes SHARED_RLS", () => {
    expect(SUPPORTED_ISOLATION_STRATEGIES).toContain("SHARED_RLS");
  });

  it("includes SCHEMA_PER_TENANT", () => {
    expect(SUPPORTED_ISOLATION_STRATEGIES).toContain("SCHEMA_PER_TENANT");
  });

  it("includes DB_PER_TENANT", () => {
    expect(SUPPORTED_ISOLATION_STRATEGIES).toContain("DB_PER_TENANT");
  });

  it("SUPPORTED_ISOLATION_STRATEGIES_V1 is an alias for backward compat", () => {
    expect(SUPPORTED_ISOLATION_STRATEGIES_V1).toBe(SUPPORTED_ISOLATION_STRATEGIES);
  });
});

describe("isSupportedIsolationStrategy", () => {
  it("returns true for SHARED_RLS", () => {
    expect(isSupportedIsolationStrategy("SHARED_RLS")).toBe(true);
  });

  it("returns true for SCHEMA_PER_TENANT", () => {
    expect(isSupportedIsolationStrategy("SCHEMA_PER_TENANT")).toBe(true);
  });

  it("returns true for DB_PER_TENANT", () => {
    expect(isSupportedIsolationStrategy("DB_PER_TENANT")).toBe(true);
  });

  it("returns false for unknown strategies", () => {
    expect(isSupportedIsolationStrategy("UNKNOWN")).toBe(false);
    expect(isSupportedIsolationStrategy("")).toBe(false);
  });
});
