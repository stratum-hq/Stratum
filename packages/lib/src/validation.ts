import { ValidationError } from "@stratum-hq/core";

interface InputIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

/** The part of a zod schema that parseInput uses. lib does not depend on zod directly. */
interface InputSchema<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: InputIssue[] } };
}

/**
 * Returns the input parsed by a core schema.
 * Throws a ValidationError that carries the zod issues when the input does not match.
 * Library callers then get a validation error instead of a PostgreSQL error.
 */
export function parseInput<T>(schema: InputSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  return result.data;
}
