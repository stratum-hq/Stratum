import { describe, it, expect } from "vitest";
// Import every error class from the package's PUBLIC ENTRY (the module that
// `package.json` "exports" points to), not from @stratum-hq/core. This proves the
// classes are re-exported as runtime VALUES: a type-only re-export (`export type`)
// would erase these bindings, so `new Cls()` would throw at runtime and using the
// class as a value would fail to typecheck. Consumers must be able to branch with
// `instanceof` instead of matching error-message substrings (FR-52, #131).
import {
  ErrorCode,
  StratumError,
  TenantNotFoundError,
  TenantAlreadyExistsError,
  TenantHasChildrenError,
  TenantCycleDetectedError,
  TenantArchivedError,
  TenantContextNotFoundError,
  IsolationViolationError,
  IsolationStrategyUnsupportedError,
  PermissionLockedError,
  PermissionNotFoundError,
  PermissionRevocationDeniedError,
  ConfigLockedError,
  ConfigNotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  WebhookNotFoundError,
  WebhookDeliveryError,
  AbacPolicyNotFoundError,
  InvalidAbacOperatorError,
  AbacPolicyLockedError,
} from "../index.js";

// [name, construct] for every subclass. `construct` calling `new` at runtime is
// itself the proof the binding is a real class and not an erased type-only import.
const cases: [string, () => StratumError][] = [
  ["TenantNotFoundError", () => new TenantNotFoundError("t-1")],
  ["TenantAlreadyExistsError", () => new TenantAlreadyExistsError("slug")],
  ["TenantHasChildrenError", () => new TenantHasChildrenError("t-1")],
  ["TenantCycleDetectedError", () => new TenantCycleDetectedError("t-1", "p-1")],
  ["TenantArchivedError", () => new TenantArchivedError("t-1")],
  ["TenantContextNotFoundError", () => new TenantContextNotFoundError()],
  ["IsolationViolationError", () => new IsolationViolationError("cross-tenant read")],
  ["IsolationStrategyUnsupportedError", () => new IsolationStrategyUnsupportedError("SCHEMA")],
  ["PermissionLockedError", () => new PermissionLockedError("billing.read", "t-1")],
  ["PermissionNotFoundError", () => new PermissionNotFoundError("p-1")],
  ["PermissionRevocationDeniedError", () => new PermissionRevocationDeniedError("billing.read")],
  ["ConfigLockedError", () => new ConfigLockedError("feature.x", "t-1")],
  ["ConfigNotFoundError", () => new ConfigNotFoundError("t-1", "feature.x")],
  ["ValidationError", () => new ValidationError("bad input")],
  ["UnauthorizedError", () => new UnauthorizedError()],
  ["ForbiddenError", () => new ForbiddenError()],
  ["WebhookNotFoundError", () => new WebhookNotFoundError("w-1")],
  ["WebhookDeliveryError", () => new WebhookDeliveryError("w-1", "timeout")],
  ["AbacPolicyNotFoundError", () => new AbacPolicyNotFoundError("p-1")],
  ["InvalidAbacOperatorError", () => new InvalidAbacOperatorError("nope")],
  ["AbacPolicyLockedError", () => new AbacPolicyLockedError("policy", "t-1")],
];

describe("@stratum-hq/lib public error surface", () => {
  it("re-exports StratumError as a runtime value", () => {
    expect(typeof StratumError).toBe("function");
    const err = new StratumError(ErrorCode.VALIDATION_ERROR, "x", 400);
    expect(err).toBeInstanceOf(Error);
  });

  it.each(cases)("%s is a runtime class and instanceof StratumError", (_name, construct) => {
    const err = construct();
    expect(err).toBeInstanceOf(StratumError);
    expect(err).toBeInstanceOf(Error);
  });

  it("lets a consumer catch a thrown error by instanceof and read its code", () => {
    // Simulates a service throwing a typed error across the package boundary.
    function serviceCall(): never {
      throw new TenantNotFoundError("missing-id");
    }

    try {
      serviceCall();
      expect.fail("expected serviceCall to throw");
    } catch (err) {
      // The branch a downstream consumer wants to write, instead of matching
      // error-message substrings.
      if (err instanceof StratumError) {
        expect(err).toBeInstanceOf(TenantNotFoundError);
        expect(err.code).toBe(ErrorCode.TENANT_NOT_FOUND);
        expect(err.statusCode).toBe(404);
      } else {
        expect.fail("thrown error was not catchable as StratumError");
      }
    }
  });
});
