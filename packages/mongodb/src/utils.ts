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
 * Strips tenant_id from MongoDB update operators to prevent cross-tenant
 * document reassignment. Handles $set, $unset, $rename, $inc, and
 * top-level replacement documents (no $ operators).
 */
export function stripTenantIdFromUpdate(update: Record<string, unknown>): Record<string, unknown> {
  const result = { ...update };
  const updateOps = ["$set", "$unset", "$rename", "$inc", "$min", "$max", "$mul", "$currentDate"];
  for (const op of updateOps) {
    if (result[op] && typeof result[op] === "object") {
      const inner = { ...(result[op] as Record<string, unknown>) };
      delete inner["tenant_id"];
      result[op] = inner;
    }
  }
  // Block top-level replacement that includes tenant_id (non-operator update)
  if ("tenant_id" in result && !Object.keys(result).some((k) => k.startsWith("$"))) {
    delete result["tenant_id"];
  }
  return result;
}

/** Aggregate pipeline stages that can bypass tenant isolation via cross-collection access. */
const BLOCKED_AGGREGATE_STAGES = new Set(["$lookup", "$merge", "$out", "$unionWith", "$graphLookup"]);

/**
 * Validates that an aggregate pipeline does not contain stages that bypass tenant isolation.
 * Throws if a blocked stage is found.
 */
export function assertSafeAggregatePipeline(pipeline: Record<string, unknown>[]): void {
  for (const stage of pipeline) {
    const stageOp = Object.keys(stage)[0];
    if (BLOCKED_AGGREGATE_STAGES.has(stageOp)) {
      throw new Error(
        `Aggregate stage '${stageOp}' is blocked on tenant-scoped collections because it can bypass tenant isolation. Use the raw collection for cross-collection operations.`,
      );
    }
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
