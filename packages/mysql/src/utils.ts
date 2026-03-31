import type { PurgeResult } from "./types.js";

/** Validates that a tenantId is a non-empty string. */
export function assertTenantId(tenantId: string): void {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error(
      `Invalid tenantId: expected a non-empty string, got ${typeof tenantId === "string" ? '""' : String(tenantId)}`,
    );
  }
}

/**
 * Backtick-escapes a MySQL identifier (table name, column name, database name).
 * Any backticks inside the name are doubled as defense-in-depth.
 * Note: validateSlug from @stratum-hq/core restricts slugs to [a-z][a-z0-9_]{0,62}
 * so this escaping is an additional safety layer.
 */
export function escapeIdentifier(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

/** Aggregates Promise.allSettled results into a PurgeResult. */
export function aggregatePurgeResults(
  results: PromiseSettledResult<{ table: string; rowsDeleted: number }>[],
): PurgeResult {
  let rowsDeleted = 0;
  let tablesProcessed = 0;
  const errors: PurgeResult["errors"] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      tablesProcessed++;
      rowsDeleted += result.value.rowsDeleted;
    } else {
      const reason = result.reason as { table?: string; error?: Error } | Error;
      if (reason instanceof Error) {
        errors.push({ table: "unknown", error: reason });
      } else {
        errors.push({
          table: reason.table ?? "unknown",
          error: reason.error ?? new Error(String(reason)),
        });
      }
    }
  }

  return {
    success: errors.length === 0,
    tablesProcessed,
    rowsDeleted,
    errors,
  };
}
