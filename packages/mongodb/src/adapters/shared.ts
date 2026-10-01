import type {
  MongoAdapter,
  MongoSharedAdapterOptions,
  PurgeResult,
  AdapterStats,
  DatabaseLike,
  CollectionLike,
  MongoIndexDirection,
} from "../types.js";
import { ALLOWED_PROXY_METHODS } from "../types.js";
import {
  assertTenantId,
  aggregatePurgeResults,
  stripTenantIdFromUpdate,
  assertSafeAggregatePipeline,
  scopeBulkWriteOperations,
} from "../utils.js";

/**
 * Creates a Proxy over a CollectionLike that injects tenant_id into every operation.
 *
 * - Read queries (find, findOne, countDocuments, distinct, deleteOne, deleteMany, updateOne, updateMany):
 *   tenant_id is merged into the filter argument.
 * - Write operations (insertOne, insertMany): tenant_id is added to each document.
 * - Aggregate: a $match stage for tenant_id is prepended.
 * - bulkWrite: tenant_id is injected into each operation's filter/document.
 * - createIndex: passed through without modification.
 * - Any other method: throws an Error (fail-closed).
 */
export function createTenantScopedCollection(
  collection: CollectionLike,
  tenantId: string,
): CollectionLike {
  assertTenantId(tenantId);

  const allowedSet = new Set<string>(ALLOWED_PROXY_METHODS);

  // Non-method properties that should pass through to the target.
  const passthroughProps = new Set(["collectionName", "constructor", "then"]);

  return new Proxy(collection, {
    get(target, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return (target as unknown as Record<symbol, unknown>)[prop];
      }

      // Pass through well-known non-method properties
      if (passthroughProps.has(prop)) {
        return (target as unknown as Record<string, unknown>)[prop];
      }

      // Block any method not in the allowlist (fail-closed)
      if (!allowedSet.has(prop)) {
        return () => {
          throw new Error(
            `Method '${prop}' is not supported on tenant-scoped collections. Use the raw collection for admin operations.`,
          );
        };
      }

      switch (prop) {
        case "find":
          return (filter?: Record<string, unknown>, options?: unknown) => {
            return guardFindCursor(target.find({ ...filter, tenant_id: tenantId }, options), tenantId);
          };

        case "findOne":
          return (filter?: Record<string, unknown>) => {
            return target.findOne({ ...filter, tenant_id: tenantId });
          };

        case "insertOne":
          return (doc: Record<string, unknown>) => {
            return target.insertOne({ ...doc, tenant_id: tenantId });
          };

        case "insertMany":
          return (docs: Record<string, unknown>[]) => {
            return target.insertMany(
              docs.map((doc) => ({ ...doc, tenant_id: tenantId })),
            );
          };

        case "updateOne":
          return (filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown) => {
            return target.updateOne({ ...filter, tenant_id: tenantId }, stripTenantIdFromUpdate(update), options);
          };

        case "updateMany":
          return (filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown) => {
            return target.updateMany({ ...filter, tenant_id: tenantId }, stripTenantIdFromUpdate(update), options);
          };

        case "deleteOne":
          return (filter: Record<string, unknown>) => {
            return target.deleteOne({ ...filter, tenant_id: tenantId });
          };

        case "deleteMany":
          return (filter: Record<string, unknown>) => {
            return target.deleteMany({ ...filter, tenant_id: tenantId });
          };

        case "aggregate":
          return (pipeline: Record<string, unknown>[]) => {
            const safePipeline = assertSafeAggregatePipeline(pipeline);
            return guardAggregationCursor(
              target.aggregate([
                { $match: { tenant_id: tenantId } },
                ...safePipeline,
              ]),
              tenantId,
              safePipeline,
            );
          };

        case "countDocuments":
          return (filter?: Record<string, unknown>) => {
            return target.countDocuments({ ...filter, tenant_id: tenantId });
          };

        case "distinct":
          return (field: string, filter?: Record<string, unknown>) => {
            return target.distinct(field, { ...filter, tenant_id: tenantId });
          };

        case "bulkWrite":
          return (operations: unknown[]) => {
            const scoped = scopeBulkWriteOperations(operations, tenantId);
            return target.bulkWrite(scoped);
          };

        case "createIndex":
          return (spec: Record<string, MongoIndexDirection>, options?: unknown) => {
            return target.createIndex(spec, options);
          };

        default:
          // All allowed methods are handled above; this is unreachable.
          return (target as unknown as Record<string, unknown>)[prop];
      }
    },
  });
}

type CursorRecord = Record<string, unknown>;
type CursorMethod = (this: unknown, ...args: unknown[]) => unknown;

/** Replaces a cursor method on the instance, if the cursor has it. */
function overrideCursorMethod(
  cursor: CursorRecord,
  name: string,
  wrap: (original: CursorMethod) => CursorMethod,
): void {
  const original = cursor[name];
  if (typeof original === "function") {
    Object.defineProperty(cursor, name, { value: wrap(original as CursorMethod), configurable: false, writable: false });
  }
}

/**
 * Keeps a find cursor scoped after it is returned: any later replacement of the
 * cursor's filter (e.g. via `.filter()`) still carries tenant_id, reading the
 * filter returns a copy (so editing it in place has no effect), and clones are
 * guarded the same way.
 */
function guardFindCursor<T>(cursor: T, tenantId: string): T {
  if (cursor === null || typeof cursor !== "object") return cursor;
  const c = cursor as unknown as CursorRecord;
  if ("cursorFilter" in c) {
    let current: Record<string, unknown> = { ...(c.cursorFilter as Record<string, unknown>), tenant_id: tenantId };
    Object.defineProperty(c, "cursorFilter", {
      configurable: false,
      enumerable: true,
      get: () => ({ ...current, tenant_id: tenantId }),
      set: (value: Record<string, unknown>) => {
        current = { ...value, tenant_id: tenantId };
      },
    });
  }
  overrideCursorMethod(c, "clone", (original) => function (this: unknown) {
    return guardFindCursor(original.call(this), tenantId);
  });
  return cursor;
}

/**
 * Keeps an aggregation cursor safe after it is returned: stages appended later
 * (via `.addStage()` or builder methods such as `.lookup()`) are validated, and
 * clones are guarded the same way.
 *
 * The validated stages are held here, not on the cursor. Reading the cursor's
 * `pipeline` returns a fresh copy that starts with the tenant $match, so
 * editing that array or its stages in place cannot change what runs.
 */
function guardAggregationCursor<T>(
  cursor: T,
  tenantId: string,
  validatedStages: Record<string, unknown>[],
): T {
  if (cursor === null || typeof cursor !== "object") return cursor;
  const c = cursor as unknown as CursorRecord;
  const stages = [...validatedStages];
  overrideCursorMethod(c, "addStage", (original) => function (this: unknown, stage: unknown) {
    const [safeStage] = assertSafeAggregatePipeline([stage as Record<string, unknown>]);
    // The driver's own checks run first; the stage it appends lands on a
    // discarded copy of the pipeline.
    const result = original.call(this, safeStage);
    stages.push(safeStage);
    return result;
  });
  overrideCursorMethod(c, "clone", (original) => function (this: unknown) {
    return guardAggregationCursor(original.call(this), tenantId, stages);
  });
  if ("pipeline" in c) {
    Object.defineProperty(c, "pipeline", {
      configurable: false,
      enumerable: true,
      get: () => [{ $match: { tenant_id: tenantId } }, ...assertSafeAggregatePipeline(stages)],
    });
  }
  return cursor;
}

/**
 * Shared-collection adapter: all tenants share the same collections,
 * isolated by a `tenant_id` field injected via Proxy.
 */
export class MongoSharedAdapter implements MongoAdapter {
  private readonly db: DatabaseLike;

  constructor(options: MongoSharedAdapterOptions) {
    this.db = options.client.db(options.databaseName);
  }

  /** Returns a tenant-scoped collection proxy that injects tenant_id into all operations. */
  scopedCollection(tenantId: string, collectionName: string): CollectionLike {
    const collection = this.db.collection(collectionName);
    return createTenantScopedCollection(collection, tenantId);
  }

  async purgeTenantData(tenantId: string): Promise<PurgeResult> {
    assertTenantId(tenantId);
    const collections = await this.db.listCollections().toArray();
    const results = await Promise.allSettled(
      collections.map(async (col) => {
        const result = await this.db.collection(col.name).deleteMany({ tenant_id: tenantId });
        return { collection: col.name, deletedCount: result.deletedCount };
      }),
    );
    return aggregatePurgeResults(results);
  }

  getStats(): AdapterStats {
    return { strategy: "shared" };
  }
}
