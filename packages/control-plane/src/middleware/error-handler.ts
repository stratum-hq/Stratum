import { FastifyRequest, FastifyReply, FastifyError } from "fastify";
import type { ZodError } from "zod";
import { StratumError } from "@stratum-hq/core";
import { config } from "../config.js";

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

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (config.nodeEnv === "development") {
    console.error("[error]", error);
  }

  if (error instanceof StratumError) {
    reply.status(error.statusCode).send(error.toJSON());
    return;
  }

  if (isZodError(error)) {
    reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
          code: issue.code,
        })),
      },
    });
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
