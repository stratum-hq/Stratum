import { describe, it, expect } from "vitest";
import {
  StratumError,
  TenantNotFoundError,
  TenantAlreadyExistsError,
  TenantHasChildrenError,
  TenantCycleDetectedError,
  TenantArchivedError,
  IsolationViolationError,
  PermissionLockedError,
  ConfigLockedError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ErrorCode,
} from "../utils/errors.js";

describe("error hierarchy", () => {
  it("StratumError is an Error", () => {
    const err = new TenantNotFoundError("test-id");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StratumError);
  });

  it("TenantNotFoundError has correct code and status", () => {
    const err = new TenantNotFoundError("abc-123");
    expect(err.code).toBe(ErrorCode.TENANT_NOT_FOUND);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("abc-123");
  });

  it("TenantAlreadyExistsError has 409 status", () => {
    const err = new TenantAlreadyExistsError("my-slug");
    expect(err.code).toBe(ErrorCode.TENANT_ALREADY_EXISTS);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("my-slug");
  });

  it("TenantHasChildrenError has 409 status", () => {
    const err = new TenantHasChildrenError("parent-id");
    expect(err.code).toBe(ErrorCode.TENANT_HAS_CHILDREN);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("parent-id");
  });

  it("TenantCycleDetectedError has 409 status", () => {
    const err = new TenantCycleDetectedError("tenant-a", "tenant-b");
    expect(err.code).toBe(ErrorCode.TENANT_CYCLE_DETECTED);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("tenant-a");
    expect(err.message).toContain("tenant-b");
  });

  it("TenantArchivedError has 410 status", () => {
    const err = new TenantArchivedError("arc-id");
    expect(err.code).toBe(ErrorCode.TENANT_ARCHIVED);
    expect(err.statusCode).toBe(410);
    expect(err.message).toContain("arc-id");
  });

  it("IsolationViolationError has 403 status", () => {
    const err = new IsolationViolationError("cross-tenant access");
    expect(err.code).toBe(ErrorCode.ISOLATION_VIOLATION);
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("cross-tenant access");
  });

  it("PermissionLockedError has 403 status and includes key/sourceTenantId", () => {
    // Constructor: (key: string, sourceTenantId: string)
    const err = new PermissionLockedError("manage_users", "source-tenant-id");
    expect(err.code).toBe(ErrorCode.PERMISSION_LOCKED);
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("manage_users");
    expect(err.message).toContain("source-tenant-id");
    expect(err.details).toMatchObject({
      key: "manage_users",
      source_tenant_id: "source-tenant-id",
    });
  });

  it("ConfigLockedError has 403 status and includes key/sourceTenantId", () => {
    // Constructor: (key: string, sourceTenantId: string)
    const err = new ConfigLockedError("max_users", "source-tenant-id");
    expect(err.code).toBe(ErrorCode.CONFIG_LOCKED);
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("max_users");
    expect(err.details).toMatchObject({
      key: "max_users",
      source_tenant_id: "source-tenant-id",
    });
  });

  it("ValidationError has 400 status", () => {
    const err = new ValidationError("bad input");
    expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("bad input");
  });

  it("UnauthorizedError has 401 status", () => {
    const err = new UnauthorizedError();
    expect(err.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(err.statusCode).toBe(401);
  });

  it("UnauthorizedError accepts custom message", () => {
    const err = new UnauthorizedError("token expired");
    expect(err.message).toBe("token expired");
  });

  it("ForbiddenError has 403 status", () => {
    const err = new ForbiddenError();
    expect(err.code).toBe(ErrorCode.FORBIDDEN);
    expect(err.statusCode).toBe(403);
  });

  it("ForbiddenError accepts custom message", () => {
    const err = new ForbiddenError("insufficient permissions");
    expect(err.message).toBe("insufficient permissions");
  });

  it("errors serialize to JSON with nested error envelope", () => {
    // toJSON() returns { error: { code, message, ...details } }
    const err = new TenantNotFoundError("xyz");
    const json = err.toJSON();
    expect(json.error.code).toBe(ErrorCode.TENANT_NOT_FOUND);
    expect(json.error.message).toContain("xyz");
  });

  it("StratumError toJSON omits details when not provided", () => {
    const err = new TenantNotFoundError("xyz");
    const json = err.toJSON();
    expect(json.error).not.toHaveProperty("details");
  });

  it("StratumError toJSON includes details when provided", () => {
    const err = new PermissionLockedError("some_key", "some-tenant");
    const json = err.toJSON();
    expect(json.error).toHaveProperty("details");
  });
});
