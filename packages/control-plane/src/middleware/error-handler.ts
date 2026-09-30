import { FastifyRequest, FastifyReply, FastifyError } from "fastify";
import type { ZodError } from "zod";
import { ErrorCode } from "@stratum-hq/core";
import { config } from "../config.js";

/** One failed field of a request, in the shape every validation response uses. */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

/**
 * Returns the body of a 400 VALIDATION_ERROR response.
 * The issues go in `error.details.issues`, next to any other details.
 * `error.issues` is a deprecated copy for older clients.
 * It goes away in the next major release.
 */
export function validationErrorBody(
  message: string,
  issues: readonly ValidationIssue[],
  details?: Record<string, unknown>,
) {
  // A zod issue has more fields than these three, and they differ per issue code.
  const normalized: ValidationIssue[] = issues.map(({ path, message, code }) => ({ path, message, code }));
  return {
    error: {
      code: ErrorCode.VALIDATION_ERROR,
      message,
      details: { ...details, issues: normalized },
      issues: normalized,
    },
  };
}

/**
 * Returns true when the error has the shape of a ZodError.
 * The check is structural because a process can load more than one copy of zod.
 * An instanceof check fails for an error from a copy other than this one.
 */
function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

interface StratumErrorShape extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: Record<string, unknown>;
}

const ERROR_CODES: ReadonlySet<string> = new Set(Object.values(ErrorCode));

/**
 * Returns true when the error has the shape of a StratumError.
 * The check is structural for the same reason as isZodError: a process can load more
 * than one copy of @stratum-hq/core. A known error code tells it apart from a Fastify
 * error, which also has a code and a status code.
 */
function isStratumError(error: unknown): error is StratumErrorShape {
  if (!(error instanceof Error)) return false;
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  return (
    typeof code === "string" &&
    ERROR_CODES.has(code) &&
    typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
  );
}

/** Returns true when every item has the three fields of a ValidationIssue. */
function isIssueList(value: unknown): value is ValidationIssue[] {
  return (
    Array.isArray(value) &&
    value.every(
      (issue: unknown) =>
        typeof issue === "object" &&
        issue !== null &&
        Array.isArray((issue as { path?: unknown }).path) &&
        typeof (issue as { message?: unknown }).message === "string" &&
        typeof (issue as { code?: unknown }).code === "string",
    )
  );
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (config.nodeEnv === "development") {
    console.error("[error]", error);
  }

  if (isStratumError(error)) {
    const issues = error.details?.issues;
    if (error.code === ErrorCode.VALIDATION_ERROR && isIssueList(issues)) {
      reply.status(error.statusCode).send(validationErrorBody(error.message, issues, error.details));
      return;
    }
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (isZodError(error)) {
    reply.status(400).send(validationErrorBody("Validation failed", error.issues));
    return;
  }

  // Fastify validation errors (e.g. schema validation)
  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    reply.status(fastifyError.statusCode).send({
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
      },
    });
    return;
  }

  reply.status(500).send({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
