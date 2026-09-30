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
  private readonly baseCollections: string[] | undefined;

  constructor(options: MongoCollectionAdapterOptions) {
    this.db = options.client.db(options.databaseName);
    if (options.baseCollections) {
      for (const a of options.baseCollections) {
        for (const b of options.baseCollections) {
          if (b.startsWith(`${a}_`)) {
            throw new Error(
              `MongoCollectionAdapter: base collections "${a}" and "${b}" are ambiguous, ` +
                `because "${b}_{slug}" can also be read as "${a}_{slug}"`,
            );
          }
        }
      }
      this.baseCollections = [...options.baseCollections];
    }
  }

  /** Returns the raw collection for the tenant, named `{baseCollectionName}_{tenantSlug}`. */
  scopedCollection(tenantSlug: string, baseCollectionName: string): CollectionLike {
    validateSlug(tenantSlug);
    if (this.baseCollections && !this.baseCollections.includes(baseCollectionName)) {
      throw new Error(`MongoCollectionAdapter: "${baseCollectionName}" is not in baseCollections`);
    }
    const collectionName = `${baseCollectionName}_${tenantSlug}`;
    return this.db.collection(collectionName);
  }

  /**
   * Deletes every document in `{base}_{tenantSlug}` for each base in the
   * baseCollections option. Throws when baseCollections is not set:
   * discovering collections by name suffix would also match other tenants
   * whose slug ends with this one.
   */
  async purgeTenantData(tenantSlug: string): Promise<PurgeResult> {
    assertTenantId(tenantSlug);
    validateSlug(tenantSlug);
    if (!this.baseCollections) {
      throw new Error(
        "MongoCollectionAdapter: purgeTenantData requires the baseCollections option, " +
          "listing every base collection name that has a per-tenant copy",
      );
    }

    const results = await Promise.allSettled(
      this.baseCollections.map(async (base) => {
        const name = `${base}_${tenantSlug}`;
        const result = await this.db.collection(name).deleteMany({});
        return { collection: name, deletedCount: result.deletedCount };
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
