import { describe, it, expect } from "vitest";
import { Stratum } from "../stratum.js";
import type { TenantContextLegacy } from "@stratum-hq/core";

const mockContext: TenantContextLegacy = {
  tenant_id: "t_abc-123",
  ancestry_path: "/t_abc-123",
  depth: 0,
  resolved_config: { feature_x: true },
  resolved_permissions: {},
  isolation_strategy: "SHARED_RLS",
};

describe("Stratum ALS convenience methods", () => {
  it("currentTenantId() returns tenant ID inside runWithTenant", () => {
    const result = Stratum.runWithTenant(mockContext, () => {
      return Stratum.currentTenantId();
    });
    expect(result).toBe("t_abc-123");
  });

  it("currentTenantId() returns undefined outside any context", () => {
    expect(Stratum.currentTenantId()).toBeUndefined();
  });

  it("currentTenantContext() returns full context object", () => {
    const result = Stratum.runWithTenant(mockContext, () => {
      return Stratum.currentTenantContext();
    });
    expect(result).toEqual(mockContext);
  });

  it("currentTenantContext() returns undefined outside any context", () => {
    expect(Stratum.currentTenantContext()).toBeUndefined();
  });

  it("runWithTenant() executes the function and returns its value", () => {
    const result = Stratum.runWithTenant(mockContext, () => 42);
    expect(result).toBe(42);
  });

  it("nested runWithTenant() uses innermost context", () => {
    const inner: TenantContextLegacy = {
      ...mockContext,
      tenant_id: "t_inner-456",
    };
    const result = Stratum.runWithTenant(mockContext, () => {
      return Stratum.runWithTenant(inner, () => {
        return Stratum.currentTenantId();
      });
    });
    expect(result).toBe("t_inner-456");
  });
});
