import type { PurgeResult } from "./types.js";

/** Validates that a tenantId is a non-empty string. */
export function assertTenantId(tenantId: string): void {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error(
      `Invalid tenantId: expected a non-empty string, got ${typeof tenantId === "string" ? '""' : String(tenantId)}`,
    );
  }
}

/** Aggregates Promise.allSettled results into a PurgeResult. */
export function aggregatePurgeResults(
  results: PromiseSettledResult<{ collection: string; deletedCount: number }>[],
): PurgeResult {
  let documentsDeleted = 0;
  let collectionsProcessed = 0;
  const errors: PurgeResult["errors"] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      collectionsProcessed++;
      documentsDeleted += result.value.deletedCount;
    } else {
      const reason = result.reason as { collection?: string; error?: Error } | Error;
      if (reason instanceof Error) {
        errors.push({ collection: "unknown", error: reason });
      } else {
        errors.push({
          collection: reason.collection ?? "unknown",
          error: reason.error ?? new Error(String(reason)),
        });
      }
    }
  }

  return {
    success: errors.length === 0,
    collectionsProcessed,
    documentsDeleted,
    errors,
  };
}
