import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { RegionInUseError, ValidationError } from "@stratum-hq/core";
import { errorHandler, legacyValidationErrorBody } from "../middleware/error-handler.js";

/**
 * Stands in for a ZodError from a second copy of zod. The class identity differs from
 * the zod copy the control plane imports, so an instanceof check cannot match it.
 */
class ForeignZodError extends Error {
  readonly issues = [
    {
      path: ["priority"],
      message: "Number must be less than or equal to 2147483647",
      code: "too_big",
      maximum: 2147483647,
    },
  ];

  constructor() {
    super("validation failed");
    this.name = "ZodError";
  }
}

/**
 * Stands in for a StratumError subclass from a second copy of @stratum-hq/core.
 * It does not extend the StratumError class that the control plane imports.
 */
class ForeignStratumError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RegionInUseError";
  }
}

const ZOD_ISSUE = { path: ["priority"], message: "Number must be less than or equal to 2147483647", code: "too_big" };
const CORE_ISSUE = { path: ["sourceIp"], message: "Invalid ip", code: "invalid_string" };

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.get("/foreign-zod", async () => {
    throw new ForeignZodError();
  });
  app.get("/validation-error", async () => {
    throw new ValidationError("Validation failed", { issues: [CORE_ISSUE] });
  });
  app.get("/foreign-validation-error", async () => {
    throw new ForeignStratumError("VALIDATION_ERROR", "Validation failed", 400, { issues: [CORE_ISSUE] });
  });
  app.get("/region-in-use", async () => {
    throw new RegionInUseError("r-1");
  });
  app.get("/foreign-region-in-use", async () => {
    throw new ForeignStratumError("REGION_IN_USE", "Cannot delete region r-1", 409, { region_id: "r-1" });
  });
  app.get("/unknown-code", async () => {
    throw new ForeignStratumError("SOMETHING_ELSE", "not a stratum error", 409);
  });
  app.get("/unknown-code/:status", async (request) => {
    const status = Number((request.params as { status: string }).status);
    throw new ForeignStratumError("SOMETHING_ELSE", "not a stratum error", status);
  });
  app.post(
    "/fastify-schema",
    { schema: { body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } },
    async () => ({ ok: true }),
  );
  app.get("/named-zod-without-issues", async () => {
    const err = new Error("not a validation error");
    err.name = "ZodError";
    throw err;
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("errorHandler", () => {
  it("answers 400 with details.issues for a ZodError from a different zod copy", async () => {
    const res = await app.inject({ method: "GET", url: "/foreign-zod" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: { issues: [ZOD_ISSUE] },
        issues: [ZOD_ISSUE],
      },
    });
  });

  it("answers a core ValidationError with the same shape as a ZodError", async () => {
    const res = await app.inject({ method: "GET", url: "/validation-error" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: { issues: [CORE_ISSUE] },
        issues: [CORE_ISSUE],
      },
    });
  });

  it("answers 400 with details.issues for a ValidationError from a different core copy", async () => {
    const res = await app.inject({ method: "GET", url: "/foreign-validation-error" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.details.issues).toEqual([CORE_ISSUE]);
  });

  it("keeps the status code and details of a StratumError subclass", async () => {
    const res = await app.inject({ method: "GET", url: "/region-in-use" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: {
        code: "REGION_IN_USE",
        message: "Cannot delete region r-1: active tenants are still assigned to it",
        details: { region_id: "r-1" },
      },
    });
  });

  it("keeps the status code of a StratumError subclass from a different core copy", async () => {
    const res = await app.inject({ method: "GET", url: "/foreign-region-in-use" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: "REGION_IN_USE", message: "Cannot delete region r-1", details: { region_id: "r-1" } },
    });
  });

  it("does not answer an error with an unknown code as a StratumError", async () => {
    const res = await app.inject({ method: "GET", url: "/unknown-code" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "CONFLICT", message: "not a stratum error" } });
  });

  it.each([
    [400, "BAD_REQUEST"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [413, "PAYLOAD_TOO_LARGE"],
    [415, "UNSUPPORTED_MEDIA_TYPE"],
    [429, "RATE_LIMITED"],
    [418, "BAD_REQUEST"],
  ])("labels an unknown error with status %i as %s", async (status, code) => {
    const res = await app.inject({ method: "GET", url: `/unknown-code/${status}` });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code, message: "not a stratum error" } });
  });

  it("keeps VALIDATION_ERROR for a Fastify schema validation error", async () => {
    const res = await app.inject({ method: "POST", url: "/fastify-schema", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("labels a request body that is not valid JSON as BAD_REQUEST", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/fastify-schema",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });

  it("labels an unsupported content type as UNSUPPORTED_MEDIA_TYPE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/fastify-schema",
      headers: { "content-type": "application/x-unknown" },
      payload: "x",
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("answers 500 for an error named ZodError that has no issues array", async () => {
    const res = await app.inject({ method: "GET", url: "/named-zod-without-issues" });
    expect(res.statusCode).toBe(500);
  });
});

describe("legacyValidationErrorBody", () => {
  it("adds a top-level details copy of the trimmed issues to the validation body", () => {
    const issues = [{ path: ["name"], message: "Required", code: "invalid_type", expected: "string" }];
    const trimmed = [{ path: ["name"], message: "Required", code: "invalid_type" }];
    expect(legacyValidationErrorBody("Invalid request body", issues)).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: { issues: trimmed },
        issues: trimmed,
      },
      details: trimmed,
    });
  });
});
