import { FastifyRequest, FastifyReply, FastifyError } from "fastify";
import { ZodError } from "zod";
import { StratumError } from "@stratum-hq/core";
import { config } from "../config.js";

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

  if (error instanceof ZodError) {
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
