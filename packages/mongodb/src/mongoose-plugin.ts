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

/** Marks the watch() static this plugin installs, to find Mongoose's own watch() below it. */
const SCOPED_WATCH = Symbol("stratum.scopedWatch");

/**
 * Model.watch() scoped to the current tenant. The change stream starts with
 * `$match: { "fullDocument.tenant_id": <tenant> }`, and fullDocument defaults
 * to "updateLookup" so update events carry the document to match on. Events
 * without a fullDocument (delete, drop, rename, invalidate) are filtered out.
 * The caller's stages are checked like aggregate stages and run after the
 * tenant $match.
 */
function scopedWatch(
  this: WatchableModelLike,
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
  return base.watch.call(
    this,
    [{ $match: { "fullDocument.tenant_id": ctx.tenant_id } }, ...stages],
    { fullDocument: "updateLookup", ...options },
  );
}
(scopedWatch as unknown as Record<symbol, unknown>)[SCOPED_WATCH] = true;

/**
 * Mongoose plugin that auto-injects tenant_id from ALS context.
 *
 * Adds `tenant_id` field to the schema (if not already present) and
 * registers pre-hooks for save, every Mongoose query operation (find, findOne,
 * countDocuments, distinct, updateOne, updateMany, replaceOne, deleteOne,
 * deleteMany, findOneAndUpdate, findOneAndReplace, findOneAndDelete),
 * insertMany, bulkWrite, and aggregate, and replaces the model's watch() with
 * a tenant-filtered change stream. estimatedDocumentCount cannot be scoped and
 * is rejected.
 *
 * Not scoped: `Model.collection` (and `Model.db`, `connection.db`,
 * `connection.watch()`) are the raw driver objects, and every operation on
 * them sees all tenants. Use them only for admin work, never with tenant
 * input.
 *
 * Hooks declared with `(...args)` have length 0, so Mongoose runs them
 * synchronously without a `next` callback; `next` is called only if passed.
 *
 * Each hook reads the current tenant from ALS via `getTenantContext()` from `@stratum-hq/sdk`.
 * If no ALS context is found, a TenantContextNotFoundError is thrown.
 */
export function stratumPlugin(schema: SchemaLike): void {
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

  // Pre-save: inject tenant_id into the document
  schema.pre("save", function (this: unknown, ...args: unknown[]) {
    const doc = this as MongooseDocumentLike;
    const next = args[0] as (() => void) | undefined;
    const ctx = getTenantContext();
    doc.tenant_id = ctx.tenant_id;
    next?.();
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
    schema.pre(hook, function (this: unknown, ...args: unknown[]) {
      const query = this as MongooseQueryLike;
      const next = args[0] as (() => void) | undefined;
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

      next?.();
    });
  }

  // estimatedDocumentCount reads collection metadata and cannot be filtered by tenant.
  schema.pre("estimatedDocumentCount", function () {
    throw new Error(
      "estimatedDocumentCount is not supported on tenant-scoped models because it cannot be filtered by tenant. Use countDocuments instead.",
    );
  });

  // Pre-insertMany: set tenant_id on every document (docs arrive before casting/validation)
  schema.pre("insertMany", function (this: unknown, next: () => void, docs: unknown) {
    const ctx = getTenantContext();
    const list = Array.isArray(docs) ? docs : [docs];
    for (const doc of list) {
      if (doc && typeof doc === "object") {
        (doc as MongooseDocumentLike).tenant_id = ctx.tenant_id;
      }
    }
    next();
  } as (...args: unknown[]) => void);

  // Pre-bulkWrite: scope every operation in place, rejecting unsupported ones
  schema.pre("bulkWrite", function (this: unknown, next: () => void, ops: unknown) {
    const ctx = getTenantContext();
    const scoped = scopeBulkWriteOperations(ops as unknown[], ctx.tenant_id);
    (ops as unknown[]).splice(0, (ops as unknown[]).length, ...scoped);
    next();
  } as (...args: unknown[]) => void);

  // Pre-aggregate: reject cross-collection stages at any depth, then prepend
  // $match stage. The checked pipeline is a fresh copy. For .cursor() it is
  // also frozen: Mongoose hands this array to a driver cursor that the caller
  // can reach, so an edit made after the check would otherwise run. exec() and
  // explain() keep it unfrozen, because Mongoose edits the pipeline of a
  // discriminator model before this hook each time the Aggregate runs.
  schema.pre("aggregate", function (this: unknown, ...args: unknown[]) {
    const agg = this as MongooseAggregateLike;
    const next = args[0] as (() => void) | undefined;
    const ctx = getTenantContext();
    const safe = assertSafeAggregatePipeline(agg.pipeline());
    const scoped = [{ $match: { tenant_id: ctx.tenant_id } }, ...safe];
    agg._pipeline = agg.options?.cursor ? freezePipeline(scoped) : scoped;
    next?.();
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
  schema.static("watch", scopedWatch);
}
