import type {
  MongoAdapter,
  MongoSharedAdapterOptions,
  PurgeResult,
  AdapterStats,
  DatabaseLike,
  CollectionLike,
} from "../types.js";
import { ALLOWED_PROXY_METHODS } from "../types.js";
import { assertTenantId, aggregatePurgeResults } from "../utils.js";

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
            return target.find({ ...filter, tenant_id: tenantId }, options);
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
            return target.updateOne({ ...filter, tenant_id: tenantId }, update, options);
          };

        case "updateMany":
          return (filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown) => {
            return target.updateMany({ ...filter, tenant_id: tenantId }, update, options);
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
            return target.aggregate([
              { $match: { tenant_id: tenantId } },
              ...pipeline,
            ]);
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
            const scoped = operations.map((op) => {
              const entry = op as Record<string, Record<string, unknown>>;
              const opType = Object.keys(entry)[0];
              const opBody = { ...entry[opType] };

              if ("filter" in opBody) {
                opBody.filter = { ...(opBody.filter as Record<string, unknown>), tenant_id: tenantId };
              }
              if ("document" in opBody) {
                opBody.document = { ...(opBody.document as Record<string, unknown>), tenant_id: tenantId };
              }
              if ("replacement" in opBody) {
                opBody.replacement = { ...(opBody.replacement as Record<string, unknown>), tenant_id: tenantId };
              }

              return { [opType]: opBody };
            });
            return target.bulkWrite(scoped);
          };

        case "createIndex":
          return (spec: Record<string, unknown>, options?: unknown) => {
            return target.createIndex(spec, options);
          };

        default:
          // All allowed methods are handled above; this is unreachable.
          return (target as unknown as Record<string, unknown>)[prop];
      }
    },
  });
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
