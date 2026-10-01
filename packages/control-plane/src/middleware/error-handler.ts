import { FastifyRequest, FastifyReply, FastifyError } from "fastify";
import type { ZodError } from "zod";
import { ErrorCode } from "@stratum-hq/core";

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
 * Returns the body of a 400 VALIDATION_ERROR response from the key and role routes.
 * The top-level `details` is a deprecated copy of the issues for older clients.
 * It goes away in the next major release.
 */
export function legacyValidationErrorBody(message: string, issues: readonly ValidationIssue[]) {
  const body = validationErrorBody(message, issues);
  return { ...body, details: body.error.details.issues };
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

/**
 * The code for an error below 500 that is not a StratumError, by status.
 * The codes match the codes that the routes and rate limiters send themselves.
 */
const CLIENT_ERROR_CODES: Readonly<Record<number, string>> = {
  400: "BAD_REQUEST",
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
};

/**
 * Returns the code for an error below 500 that is not a StratumError or a ZodError.
 * Only a Fastify schema validation error is a VALIDATION_ERROR.
 * Any other error gets a neutral code for its status, so a client does not read a
 * conflict or a missing resource as a bad field.
 */
function clientErrorCode(error: FastifyError): string {
  if (error.validation || error.code === "FST_ERR_VALIDATION") return ErrorCode.VALIDATION_ERROR;
  return CLIENT_ERROR_CODES[error.statusCode as number] ?? "BAD_REQUEST";
}

/**
 * Logs an error that the API answers with a 5xx status, in every environment.
 * The request logger adds the request id (reqId), so a report from a client
 * can be matched to the log line.
 */
function logServerError(request: FastifyRequest, error: Error): void {
  request.log.error({ err: error }, "request failed with a server error");
}

/**
 * Answers a request that matches no route with the error envelope of every
 * other error. The global hooks run first, so a caller without credentials
 * gets 401 and only an authenticated caller learns that the route is unknown.
 */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  const path = request.url.split("?")[0];
  reply.status(404).send({
    error: {
      code: "NOT_FOUND",
      message: `Route ${request.method} ${path} not found`,
    },
  });
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (isStratumError(error)) {
    if (error.statusCode >= 500) logServerError(request, error);
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

  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    reply.status(fastifyError.statusCode).send({
      error: {
        code: clientErrorCode(fastifyError),
        message: error.message,
      },
    });
    return;
  }

  // The client gets no detail of the cause; the log has it, under the request id.
  logServerError(request, error);
  reply.status(500).send({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
