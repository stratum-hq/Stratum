import { describe, it, expect, vi } from "vitest";
import { ForbiddenError, TenantArchivedError, TenantNotFoundError, TenantSuspendedError, UnauthorizedError } from "@stratum-hq/core";
import { controlPlaneErrorResponse, tenantErrorResponse } from "../index.js";

// Other adapters (NestJS, Hono) import these from the package entry point.
describe("tenantErrorResponse (package export)", () => {
  const cases = [
    { error: new TenantNotFoundError("t-1"), status: 404, code: "TENANT_NOT_FOUND" },
    { error: new TenantSuspendedError("t-1"), status: 403, code: "TENANT_SUSPENDED" },
    { error: new TenantArchivedError("t-1"), status: 410, code: "TENANT_ARCHIVED" },
    { error: new ForbiddenError(), status: 403, code: "FORBIDDEN" },
  ];

  for (const c of cases) {
    it(`maps ${c.error.name} to ${c.status} ${c.code}`, () => {
      const response = tenantErrorResponse(c.error, "t-1");
      expect(response?.status).toBe(c.status);
      expect(response?.body.error.code).toBe(c.code);
    });
  }

  it("returns null for an error that is not a tenant error", () => {
    expect(tenantErrorResponse(new Error("boom"), "t-1")).toBeNull();
  });
});

describe("controlPlaneErrorResponse (package export)", () => {
  it("maps a TimeoutError to 504 CONTROL_PLANE_TIMEOUT", () => {
    const response = controlPlaneErrorResponse(new DOMException("The operation timed out.", "TimeoutError"));
    expect(response?.status).toBe(504);
    expect(response?.body.error.code).toBe("CONTROL_PLANE_TIMEOUT");
  });

  it("maps an UnauthorizedError to 500 CONTROL_PLANE_AUTH_FAILED and logs the cause", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = controlPlaneErrorResponse(new UnauthorizedError());
    expect(response?.status).toBe(500);
    expect(response?.body.error.code).toBe("CONTROL_PLANE_AUTH_FAILED");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("rejected the SDK API key"));
    log.mockRestore();
  });

  it("returns null for any other error", () => {
    expect(controlPlaneErrorResponse(new Error("boom"))).toBeNull();
    expect(controlPlaneErrorResponse(new TenantNotFoundError("t-1"))).toBeNull();
  });
});
