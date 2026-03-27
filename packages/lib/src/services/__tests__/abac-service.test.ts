import { describe, it, expect } from "vitest";
import { evaluateCondition, evaluatePolicy } from "../abac-service.js";
import type { AbacCondition, AbacPolicy } from "@stratum-hq/core";

function makePolicy(overrides: Partial<AbacPolicy> = {}): AbacPolicy {
  return {
    id: "pol-1",
    tenant_id: "t-1",
    name: "test-policy",
    resource_type: "document",
    action: "read",
    effect: "allow",
    conditions: [],
    priority: 0,
    mode: "INHERITED",
    source_tenant_id: "t-1",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evaluateCondition — operator tests
// ---------------------------------------------------------------------------
describe("evaluateCondition", () => {
  it("eq: matches when values are equal", () => {
    const c: AbacCondition = { attribute: "role", operator: "eq", value: "admin" };
    expect(evaluateCondition(c, { role: "admin" })).toBe(true);
    expect(evaluateCondition(c, { role: "viewer" })).toBe(false);
  });

  it("neq: matches when values differ", () => {
    const c: AbacCondition = { attribute: "role", operator: "neq", value: "admin" };
    expect(evaluateCondition(c, { role: "viewer" })).toBe(true);
    expect(evaluateCondition(c, { role: "admin" })).toBe(false);
  });

  it("in: matches when value is in array", () => {
    const c: AbacCondition = { attribute: "dept", operator: "in", value: ["eng", "product"] };
    expect(evaluateCondition(c, { dept: "eng" })).toBe(true);
    expect(evaluateCondition(c, { dept: "sales" })).toBe(false);
  });

  it("not_in: matches when value is not in array", () => {
    const c: AbacCondition = { attribute: "dept", operator: "not_in", value: ["eng", "product"] };
    expect(evaluateCondition(c, { dept: "sales" })).toBe(true);
    expect(evaluateCondition(c, { dept: "eng" })).toBe(false);
  });

  it("contains: matches when array attribute contains value", () => {
    const c: AbacCondition = { attribute: "tags", operator: "contains", value: "urgent" };
    expect(evaluateCondition(c, { tags: ["urgent", "important"] })).toBe(true);
    expect(evaluateCondition(c, { tags: ["normal"] })).toBe(false);
  });

  it("gt: numeric greater than", () => {
    const c: AbacCondition = { attribute: "level", operator: "gt", value: 5 };
    expect(evaluateCondition(c, { level: 10 })).toBe(true);
    expect(evaluateCondition(c, { level: 5 })).toBe(false);
    expect(evaluateCondition(c, { level: 3 })).toBe(false);
  });

  it("gte: numeric greater than or equal", () => {
    const c: AbacCondition = { attribute: "level", operator: "gte", value: 5 };
    expect(evaluateCondition(c, { level: 5 })).toBe(true);
    expect(evaluateCondition(c, { level: 4 })).toBe(false);
  });

  it("lt: numeric less than", () => {
    const c: AbacCondition = { attribute: "risk", operator: "lt", value: 3 };
    expect(evaluateCondition(c, { risk: 1 })).toBe(true);
    expect(evaluateCondition(c, { risk: 3 })).toBe(false);
  });

  it("lte: numeric less than or equal", () => {
    const c: AbacCondition = { attribute: "risk", operator: "lte", value: 3 };
    expect(evaluateCondition(c, { risk: 3 })).toBe(true);
    expect(evaluateCondition(c, { risk: 4 })).toBe(false);
  });

  it("returns false when attribute is missing from context", () => {
    const c: AbacCondition = { attribute: "missing", operator: "eq", value: "x" };
    expect(evaluateCondition(c, { other: "y" })).toBe(false);
  });

  it("throws for unknown operator", () => {
    const c = { attribute: "x", operator: "nope" as any, value: "y" };
    expect(() => evaluateCondition(c, { x: "y" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// evaluatePolicy
// ---------------------------------------------------------------------------
describe("evaluatePolicy", () => {
  it("empty conditions → always matches", () => {
    const policy = makePolicy({ conditions: [] });
    expect(evaluatePolicy(policy, {})).toBe(true);
  });

  it("all conditions true → matches", () => {
    const policy = makePolicy({
      conditions: [
        { attribute: "role", operator: "eq", value: "admin" },
        { attribute: "level", operator: "gte", value: 3 },
      ],
    });
    expect(evaluatePolicy(policy, { role: "admin", level: 5 })).toBe(true);
  });

  it("one condition false → does not match (AND semantics)", () => {
    const policy = makePolicy({
      conditions: [
        { attribute: "role", operator: "eq", value: "admin" },
        { attribute: "level", operator: "gte", value: 10 },
      ],
    });
    expect(evaluatePolicy(policy, { role: "admin", level: 5 })).toBe(false);
  });
});
