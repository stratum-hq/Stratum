import { getTenantContext } from "@stratum-hq/sdk";
import { stripTenantIdFromUpdate, assertSafeAggregatePipeline, scopeBulkWriteOperations } from "./utils.js";

interface SchemaLike {
  path(name: string): unknown;
  add(obj: Record<string, unknown>): void;
  pre(method: string | string[], fn: (...args: unknown[]) => void): void;
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
}

/**
 * Mongoose plugin that auto-injects tenant_id from ALS context.
 *
 * Adds `tenant_id` field to the schema (if not already present) and
 * registers pre-hooks for save, every Mongoose query operation (find, findOne,
 * countDocuments, distinct, updateOne, updateMany, replaceOne, deleteOne,
 * deleteMany, findOneAndUpdate, findOneAndReplace, findOneAndDelete),
 * insertMany, bulkWrite, and aggregate. estimatedDocumentCount cannot be
 * scoped and is rejected.
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

  // Pre-aggregate: reject cross-collection stages at any depth, then prepend $match stage
  schema.pre("aggregate", function (this: unknown, ...args: unknown[]) {
    const agg = this as MongooseAggregateLike;
    const next = args[0] as (() => void) | undefined;
    const ctx = getTenantContext();
    const pipeline = agg.pipeline();
    assertSafeAggregatePipeline(pipeline);
    pipeline.unshift({ $match: { tenant_id: ctx.tenant_id } });
    next?.();
  });
}
