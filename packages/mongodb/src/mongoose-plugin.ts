import { getTenantContext } from "@stratum-hq/sdk";
import {
  stripTenantIdFromUpdate,
  assertSafeAggregatePipeline,
  scopeBulkWriteOperations,
  freezePipeline,
} from "./utils.js";

interface SchemaLike {
  path(name: string): unknown;
  add(obj: Record<string, unknown>): void;
  pre(method: string | string[], fn: (...args: unknown[]) => void): void;
  static(name: string, fn: (...args: never[]) => unknown): unknown;
  statics?: Record<string, unknown>;
}

interface MongooseDocumentLike {
  tenant_id?: string;
}

interface MongooseQueryLike {
  getFilter(): Record<string, unknown>;
  setQuery(query: Record<string, unknown>): void;
  getQuery(): Record<string, unknown>;
}

interface MongooseAggregateLike {
  pipeline(): Record<string, unknown>[];
  _pipeline: Record<string, unknown>[];
  options?: { cursor?: unknown };
}

interface WatchableModelLike {
  watch(pipeline?: Record<string, unknown>[], options?: Record<string, unknown>): unknown;
}

interface WatchModelLike extends WatchableModelLike {
  collection: { collectionName: string };
  db: { listCollections(): Promise<Array<{ name: string; options?: Record<string, unknown> }>> };
}

interface ChangeStreamLike {
  closed?: boolean;
  emit(event: string, ...args: unknown[]): boolean;
  close(): unknown;
}

/** Options for `stratumPlugin`. */
export interface StratumPluginOptions {
  /**
   * Deliver delete events from the scoped `watch()`. A delete event has no
   * `fullDocument`, so the stream reads the tenant from the pre-image. This
   * needs MongoDB 6.0 or later and `changeStreamPreAndPostImages` enabled on
   * the collection. Default `false`.
   */
  watchDeletes?: boolean;
}

/**
 * Return the `next` callback and the first argument of a pre hook that
 * declares parameters. Mongoose 8 calls such a hook with `(next, ...args)`,
 * and Mongoose 9 calls it with `(...args)` and never passes `next`.
 */
function hookArguments(first: unknown, second: unknown): { next?: () => void; payload: unknown } {
  return typeof first === "function" ? { next: first as () => void, payload: second } : { payload: first };
}

/** Marks the watch() static this plugin installs, to find Mongoose's own watch() below it. */
const SCOPED_WATCH = Symbol("stratum.scopedWatch");

/**
 * Return the first stage of a scoped change stream for the tenant.
 *
 * With `watchDeletes`, a delete event matches on its pre-image. Every other
 * event matches on `fullDocument`, and its pre-image must not belong to
 * another tenant: an unscoped write can move a document between tenants, and
 * the pre-image then holds the data of the old tenant.
 */
function tenantStage(tenantId: string, watchDeletes: boolean): Record<string, unknown> {
  if (!watchDeletes) return { $match: { "fullDocument.tenant_id": tenantId } };
  return {
    $match: {
      $or: [
        { operationType: "delete", "fullDocumentBeforeChange.tenant_id": tenantId },
        {
          operationType: { $ne: "delete" },
          "fullDocument.tenant_id": tenantId,
          "fullDocumentBeforeChange.tenant_id": { $in: [tenantId, null] },
        },
      ],
    },
  };
}

/**
 * Emit an error on the stream and close it when the collection of the model
 * has no change stream pre-images. Without this check, the server reports the
 * problem only at the first update or delete event, and that event is lost.
 */
function assertPreImages(model: WatchModelLike, stream: ChangeStreamLike): void {
  const name = model.collection.collectionName;
  model.db.listCollections().then(
    (collections) => {
      const info = collections.find((c) => c.name === name);
      const preImages = info?.options?.changeStreamPreAndPostImages as { enabled?: boolean } | undefined;
      if (preImages?.enabled || stream.closed) return;
      stream.emit(
        "error",
        new Error(
          `stratumPlugin: watchDeletes needs change stream pre-images on the collection "${name}". ` +
            `Enable them with { collMod: "${name}", changeStreamPreAndPostImages: { enabled: true } } ` +
            "(MongoDB 6.0 or later).",
        ),
      );
      void stream.close();
    },
    (err: unknown) => {
      if (stream.closed) return;
      stream.emit("error", err);
      void stream.close();
    },
  );
}

/**
 * Return a Model.watch() scoped to the current tenant. The change stream
 * starts with a tenant `$match` on `fullDocument`, and fullDocument defaults
 * to "updateLookup" so update events carry the document to match on. Events
 * without a fullDocument (delete, drop, rename, invalidate) are filtered out.
 * With `watchDeletes`, delete events match on their pre-image instead, and
 * `fullDocumentBeforeChange` is always "required".
 * The caller's stages are checked like aggregate stages and run after the
 * tenant $match.
 */
function makeScopedWatch(watchDeletes: boolean) {
  function scopedWatch(
    this: WatchModelLike,
    pipeline?: Record<string, unknown>[],
    options?: Record<string, unknown>,
  ): unknown {
    const ctx = getTenantContext();
    const stages = assertSafeAggregatePipeline(pipeline ?? []);
    let base = Object.getPrototypeOf(this) as WatchableModelLike | null;
    while (base && (base.watch as unknown as Record<symbol, unknown>)[SCOPED_WATCH]) {
      base = Object.getPrototypeOf(base) as WatchableModelLike | null;
    }
    if (!base || typeof base.watch !== "function") {
      throw new Error("stratumPlugin: Mongoose Model.watch() was not found.");
    }
    const stream = base.watch.call(
      this,
      [tenantStage(ctx.tenant_id, watchDeletes), ...stages],
      watchDeletes
        ? { fullDocument: "updateLookup", ...options, fullDocumentBeforeChange: "required" }
        : { fullDocument: "updateLookup", ...options },
    );
    if (watchDeletes) assertPreImages(this, stream as ChangeStreamLike);
    return stream;
  }
  (scopedWatch as unknown as Record<symbol, unknown>)[SCOPED_WATCH] = true;
  return scopedWatch;
}

/**
 * Mongoose plugin that auto-injects tenant_id from ALS context.
 *
 * Adds `tenant_id` field to the schema (if not already present) and
 * registers pre-hooks for validate, save, every Mongoose query operation (find, findOne,
 * countDocuments, distinct, updateOne, updateMany, replaceOne, deleteOne,
 * deleteMany, findOneAndUpdate, findOneAndReplace, findOneAndDelete),
 * insertMany, bulkWrite, and aggregate, and replaces the model's watch() with
 * a tenant-filtered change stream. estimatedDocumentCount cannot be scoped and
 * is rejected. Set `options.watchDeletes` to also deliver delete events from
 * watch(); see `StratumPluginOptions`.
 *
 * Not scoped: `Model.collection` (and `Model.db`, `connection.db`,
 * `connection.watch()`) are the raw driver objects, and every operation on
 * them sees all tenants. Use them only for admin work, never with tenant
 * input.
 *
 * Supports Mongoose 8 and 9. Most hooks take no parameters, so both versions
 * run them synchronously without a `next` callback. The insertMany and
 * bulkWrite hooks need their arguments; see `hookArguments`.
 *
 * Each hook reads the current tenant from ALS via `getTenantContext()` from `@stratum-hq/sdk`.
 * If no ALS context is found, a TenantContextNotFoundError is thrown.
 */
export function stratumPlugin(schema: SchemaLike, options: StratumPluginOptions = {}): void {
  // Idempotent: skip if tenant_id already defined
  if (!schema.path("tenant_id")) {
    schema.add({
      tenant_id: {
        type: String,
        required: true,
        index: true,
      },
    });
  }

  // Set tenant_id before validation, because the field is required and
  // Mongoose validates before the pre-save hooks of the schema run. The
  // pre-save hook also sets it, for a save() with validateBeforeSave: false.
  schema.pre(["validate", "save"], function (this: unknown) {
    (this as MongooseDocumentLike).tenant_id = getTenantContext().tenant_id;
  });

  // Pre-find/query hooks: merge tenant_id into the query filter
  const queryHooks = [
    "find",
    "findOne",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "countDocuments",
    "distinct",
    "replaceOne",
    "findOneAndUpdate",
    "findOneAndReplace",
    "findOneAndDelete",
  ];
  const updateHooks = new Set(["updateOne", "updateMany", "findOneAndUpdate"]);
  const replaceHooks = new Set(["replaceOne", "findOneAndReplace"]);

  for (const hook of queryHooks) {
    schema.pre(hook, function (this: unknown) {
      const query = this as MongooseQueryLike;
      const ctx = getTenantContext();
      const filter = query.getQuery();
      query.setQuery({ ...filter, tenant_id: ctx.tenant_id });

      // Sanitize update payloads to prevent tenant_id reassignment
      if (updateHooks.has(hook) || replaceHooks.has(hook)) {
        const update = (query as unknown as { getUpdate(): Record<string, unknown> | null }).getUpdate();
        if (update) {
          const sanitized = stripTenantIdFromUpdate(update);
          (query as unknown as { setUpdate(u: Record<string, unknown>): void }).setUpdate(
            replaceHooks.has(hook) ? { ...sanitized, tenant_id: ctx.tenant_id } : sanitized,
          );
        }
      }
    });
  }

  // estimatedDocumentCount reads collection metadata and cannot be filtered by tenant.
  schema.pre("estimatedDocumentCount", function () {
    throw new Error(
      "estimatedDocumentCount is not supported on tenant-scoped models because it cannot be filtered by tenant. Use countDocuments instead.",
    );
  });

  // Pre-insertMany: set tenant_id on every document (docs arrive before casting/validation)
  schema.pre("insertMany", function (this: unknown, first: unknown, second: unknown) {
    const { next, payload: docs } = hookArguments(first, second);
    const ctx = getTenantContext();
    const list = Array.isArray(docs) ? docs : [docs];
    for (const doc of list) {
      if (doc && typeof doc === "object") {
        (doc as MongooseDocumentLike).tenant_id = ctx.tenant_id;
      }
    }
    next?.();
  });

  // Pre-bulkWrite: scope every operation in place, rejecting unsupported ones
  schema.pre("bulkWrite", function (this: unknown, first: unknown, second: unknown) {
    const { next, payload } = hookArguments(first, second);
    const ops = payload as unknown[];
    const ctx = getTenantContext();
    const scoped = scopeBulkWriteOperations(ops, ctx.tenant_id);
    ops.splice(0, ops.length, ...scoped);
    next?.();
  });

  // Pre-aggregate: reject cross-collection stages at any depth, then prepend
  // $match stage. The checked pipeline is a fresh copy. For .cursor() it is
  // also frozen: Mongoose hands this array to a driver cursor that the caller
  // can reach, so an edit made after the check would otherwise run. exec() and
  // explain() keep it unfrozen, because Mongoose edits the pipeline of a
  // discriminator model before this hook each time the Aggregate runs.
  schema.pre("aggregate", function (this: unknown) {
    const agg = this as MongooseAggregateLike;
    const ctx = getTenantContext();
    const safe = assertSafeAggregatePipeline(agg.pipeline());
    const scoped = [{ $match: { tenant_id: ctx.tenant_id } }, ...safe];
    agg._pipeline = agg.options?.cursor ? freezePipeline(scoped) : scoped;
  });

  // watch(): the change stream is filtered to the current tenant's documents.
  // A watch() static defined before the plugin is refused rather than
  // replaced; one defined after the plugin replaces the scoped watch().
  if (schema.statics && Object.prototype.hasOwnProperty.call(schema.statics, "watch")) {
    throw new Error(
      "stratumPlugin: the schema already defines a watch() static, which the plugin would replace " +
        "with a tenant-scoped watch(). Remove it, or apply the plugin to a schema without it.",
    );
  }
  schema.static("watch", makeScopedWatch(options.watchDeletes === true));
}
