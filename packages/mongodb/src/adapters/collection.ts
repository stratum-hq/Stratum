import { validateSlug } from "@stratum-hq/core";
import type {
  MongoAdapter,
  MongoCollectionAdapterOptions,
  PurgeResult,
  AdapterStats,
  DatabaseLike,
  CollectionLike,
} from "../types.js";
import { assertTenantId } from "../utils.js";

/**
 * Collection-per-tenant adapter: each tenant gets its own set of collections
 * named `{baseCollectionName}_{tenantSlug}`.
 *
 * No filter injection needed — isolation is structural.
 */
export class MongoCollectionAdapter implements MongoAdapter {
  private readonly db: DatabaseLike;

  constructor(options: MongoCollectionAdapterOptions) {
    this.db = options.client.db(options.databaseName);
  }

  /** Returns the raw collection for the tenant, named `{baseCollectionName}_{tenantSlug}`. */
  scopedCollection(tenantSlug: string, baseCollectionName: string): CollectionLike {
    validateSlug(tenantSlug);
    const collectionName = `${baseCollectionName}_${tenantSlug}`;
    return this.db.collection(collectionName);
  }

  async purgeTenantData(tenantSlug: string): Promise<PurgeResult> {
    assertTenantId(tenantSlug);
    validateSlug(tenantSlug);

    const suffix = `_${tenantSlug}`;
    const allCollections = await this.db.listCollections().toArray();
    const tenantCollections = allCollections.filter((col) => col.name.endsWith(suffix));

    const results = await Promise.allSettled(
      tenantCollections.map(async (col) => {
        const result = await this.db.collection(col.name).deleteMany({});
        return { collection: col.name, deletedCount: result.deletedCount };
      }),
    );

    let collectionsProcessed = 0;
    let documentsDeleted = 0;
    const errors: PurgeResult["errors"] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        collectionsProcessed++;
        documentsDeleted += result.value.deletedCount;
      } else {
        errors.push({ collection: "unknown", error: result.reason as Error });
      }
    }

    return {
      success: errors.length === 0,
      collectionsProcessed,
      documentsDeleted,
      errors,
    };
  }

  getStats(): AdapterStats {
    return { strategy: "collection-per-tenant" };
  }
}
