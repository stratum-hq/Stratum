import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ValidationError } from "@stratum-hq/core";
import { errorHandler } from "../middleware/error-handler.js";

/**
 * Stands in for a ZodError from a second copy of zod. The class identity differs from
 * the zod copy the control plane imports, so an instanceof check cannot match it.
 */
class ForeignZodError extends Error {
  readonly issues = [{ path: ["priority"], message: "Number must be less than or equal to 2147483647", code: "too_big" }];

  constructor() {
    super("validation failed");
    this.name = "ZodError";
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.get("/foreign-zod", async () => {
    throw new ForeignZodError();
  });
  app.get("/validation-error", async () => {
    throw new ValidationError("Validation failed", { issues: [{ path: ["sourceIp"], message: "Invalid ip" }] });
  });
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
  it("answers 400 for a ZodError from a different zod copy", async () => {
    const res = await app.inject({ method: "GET", url: "/foreign-zod" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        issues: [{ path: ["priority"], message: "Number must be less than or equal to 2147483647", code: "too_big" }],
      },
    });
  });

  it("answers 400 with the issue details for a core ValidationError", async () => {
    const res = await app.inject({ method: "GET", url: "/validation-error" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.details.issues[0].path).toEqual(["sourceIp"]);
  });

  it("answers 500 for an error named ZodError that has no issues array", async () => {
    const res = await app.inject({ method: "GET", url: "/named-zod-without-issues" });
    expect(res.statusCode).toBe(500);
  });
});
