import type { PurgeResult } from "./types.js";

/** Validates that a tenantId is a non-empty string. */
export function assertTenantId(tenantId: string): void {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error(
      `Invalid tenantId: expected a non-empty string, got ${typeof tenantId === "string" ? '""' : String(tenantId)}`,
    );
  }
}

/** True for `tenant_id` itself and for any dotted path beneath it. */
function isTenantIdPath(path: string): boolean {
  return path === "tenant_id" || path.startsWith("tenant_id.");
}

/**
 * Strips tenant_id from MongoDB update operators to prevent cross-tenant
 * document reassignment. Covers every `$` operator (including $setOnInsert),
 * dotted `tenant_id.*` paths, and top-level keys even when mixed with
 * operators (Mongoose moves such keys into $set). Throws for a $rename whose
 * target is tenant_id and for pipeline-style (array) updates.
 */
export function stripTenantIdFromUpdate(update: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(update)) {
    throw new Error(
      "Pipeline-style updates are not supported on tenant-scoped collections. Use an update document with operators.",
    );
  }
  const result = { ...update };
  for (const key of Object.keys(result)) {
    if (!key.startsWith("$")) {
      if (isTenantIdPath(key)) delete result[key];
      continue;
    }
    const value = result[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const inner = { ...(value as Record<string, unknown>) };
    for (const path of Object.keys(inner)) {
      if (isTenantIdPath(path)) {
        delete inner[path];
      } else if (key === "$rename" && typeof inner[path] === "string" && isTenantIdPath(inner[path] as string)) {
        throw new Error("Renaming a field onto tenant_id is not allowed on tenant-scoped collections.");
      }
    }
    result[key] = inner;
  }
  return result;
}

const FILTERED_BULK_OPS = new Set(["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany"]);

/**
 * Scopes bulkWrite operations to a tenant. Only insertOne, updateOne, updateMany,
 * replaceOne, deleteOne and deleteMany are accepted, each in its canonical shape:
 * insertOne documents (including the legacy `{ insertOne: doc }` form) get
 * tenant_id, filters get tenant_id merged in, updates are sanitized, and
 * replacements carry tenant_id. Throws on anything else.
 */
export function scopeBulkWriteOperations(operations: unknown[], tenantId: string): Record<string, unknown>[] {
  if (!Array.isArray(operations)) {
    throw new Error("bulkWrite operations must be an array.");
  }
  return operations.map((op) => {
    if (!op || typeof op !== "object" || Object.keys(op).length !== 1) {
      throw new Error("Each bulkWrite operation must be an object with exactly one operation key.");
    }
    const entry = op as Record<string, unknown>;
    const opType = Object.keys(entry)[0];
    const body = entry[opType];
    if (!body || typeof body !== "object") {
      throw new Error(`bulkWrite operation '${opType}' must have an object body.`);
    }
    const opBody = { ...(body as Record<string, unknown>) };

    if (opType === "insertOne") {
      const doc = opBody.document == null ? opBody : (opBody.document as Record<string, unknown>);
      return { insertOne: { document: { ...doc, tenant_id: tenantId } } };
    }
    if (!FILTERED_BULK_OPS.has(opType)) {
      throw new Error(`bulkWrite operation '${opType}' is not supported on tenant-scoped collections.`);
    }
    if (!opBody.filter || typeof opBody.filter !== "object") {
      throw new Error(`bulkWrite operation '${opType}' requires a filter.`);
    }
    opBody.filter = { ...(opBody.filter as Record<string, unknown>), tenant_id: tenantId };
    if (opType === "replaceOne") {
      if (!opBody.replacement || typeof opBody.replacement !== "object") {
        throw new Error("bulkWrite operation 'replaceOne' requires a replacement document.");
      }
      opBody.replacement = { ...(opBody.replacement as Record<string, unknown>), tenant_id: tenantId };
    }
    if (opType === "updateOne" || opType === "updateMany") {
      opBody.update = stripTenantIdFromUpdate(opBody.update as Record<string, unknown>);
    }
    return { [opType]: opBody };
  });
}

/** Aggregate pipeline stages that can bypass tenant isolation via cross-collection access. */
const BLOCKED_AGGREGATE_STAGES = new Set(["$lookup", "$merge", "$out", "$unionWith", "$graphLookup"]);

/**
 * Validates that an aggregate pipeline does not contain stages that bypass tenant isolation.
 * Blocked stages are rejected at any depth, including inside $facet and nested
 * $lookup / $unionWith sub-pipelines. Throws if a blocked stage is found.
 * Returns a copy of the pipeline (plain objects and arrays are copied) so later
 * mutation of the caller's objects cannot change what was validated.
 */
export function assertSafeAggregatePipeline(pipeline: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!Array.isArray(pipeline)) {
    throw new Error("Aggregate pipeline must be an array of stages.");
  }
  return copyAndCheckStages(pipeline) as Record<string, unknown>[];
}

function copyAndCheckStages(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(copyAndCheckStages);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    // BSON values, Dates, RegExps, etc. cannot contain stages.
    return value;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (BLOCKED_AGGREGATE_STAGES.has(key)) {
      throw new Error(
        `Aggregate stage '${key}' is blocked on tenant-scoped collections because it can bypass tenant isolation. Use the raw collection for cross-collection operations.`,
      );
    }
    copy[key] = copyAndCheckStages(inner);
  }
  return copy;
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
