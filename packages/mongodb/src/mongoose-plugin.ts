import { getTenantContext } from "@stratum-hq/sdk";

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
 * registers pre-hooks for save, find, findOne, updateOne, updateMany,
 * deleteOne, deleteMany, countDocuments, and aggregate.
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
    const next = args[0] as () => void;
    const ctx = getTenantContext();
    doc.tenant_id = ctx.tenant_id;
    next();
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
  ];

  for (const hook of queryHooks) {
    schema.pre(hook, function (this: unknown, ...args: unknown[]) {
      const query = this as MongooseQueryLike;
      const next = args[0] as () => void;
      const ctx = getTenantContext();
      const filter = query.getQuery();
      query.setQuery({ ...filter, tenant_id: ctx.tenant_id });
      next();
    });
  }

  // Pre-aggregate: prepend $match stage
  schema.pre("aggregate", function (this: unknown, ...args: unknown[]) {
    const agg = this as MongooseAggregateLike;
    const next = args[0] as () => void;
    const ctx = getTenantContext();
    const pipeline = agg.pipeline();
    pipeline.unshift({ $match: { tenant_id: ctx.tenant_id } });
    next();
  });
}
