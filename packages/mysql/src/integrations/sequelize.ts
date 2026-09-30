import { AsyncLocalStorage } from "node:async_hooks";
import { assertTenantId, escapeIdentifier } from "../utils.js";

// ─── Structural types (no hard dependency on sequelize) ───

export interface SequelizeLike {
  query(sql: string, options?: unknown): Promise<unknown>;
  transaction<T>(fn: (t: unknown) => Promise<T>): Promise<T>;
}

type Options = Record<PropertyKey, unknown>;
type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

/** The part of a Sequelize model class that tenant scoping uses. */
interface ModelClassLike {
  sequelize?: object;
  rawAttributes?: Record<string, { field?: string }>;
  associations?: Record<string, { target: ModelClassLike }>;
  getTableName(): unknown;
}

/** The part of a Sequelize model instance that tenant scoping uses. */
interface ModelInstanceLike {
  constructor: ModelClassLike;
  isNewRecord: boolean;
  where(): Record<string, unknown>;
  setDataValue(key: string, value: unknown): void;
}

/** The part of a Sequelize instance (and its class) that tenant scoping uses. */
interface ScopableSequelize extends SequelizeLike {
  constructor: { Model?: unknown; Op?: { and: symbol } };
  addHook(name: string, fn: (options: Options) => void): unknown;
  getQueryInterface(): { queryGenerator: { quoteTable(table: unknown): string } };
}

interface Scope {
  sequelize: object;
  tenantId: string;
}

const REFUSED = "Stratum: withMysqlTenantScope";
/** The tenant scope of the running withMysqlTenantScope callback. */
const scopeStorage = new AsyncLocalStorage<Scope>();
/** True inside a model call that tenant scoping has already handled. */
const scopedCall = new AsyncLocalStorage<boolean>();
const PATCHED = Symbol("stratum.sequelizeTenantScope");
const guardedInstances = new WeakSet<object>();

/**
 * Runs fn with the tenant's rows scoped for Sequelize models, inside a
 * transaction that also sets the @stratum_tenant_id session variable.
 *
 * Inside fn, for every model with a tenant_id attribute:
 * - findAll, findOne, findByPk, findAndCountAll, count, sum, min, max and
 *   reload() see only the tenant's rows, and includes of tenant models are
 *   filtered in their join condition (a non-required include keeps the parent);
 * - update, destroy, restore and increment/decrement change only the tenant's
 *   rows, and update never writes tenant_id;
 * - create, save of a new instance and bulkCreate write the tenant's tenant_id;
 * - save, destroy and restore of an instance whose row belongs to another
 *   tenant throw;
 * - upsert, bulkCreate with updateOnDuplicate, truncate, and include `all`
 *   are refused, and any other model query that bypasses the scoping throws.
 * Hooks passed `hooks: false` do not skip the filter. Raw `sequelize.query()`
 * and models without a tenant_id attribute are not scoped. Outside fn,
 * Sequelize behaves as usual.
 *
 * The session variable exists only on the transaction's connection. fn
 * receives that transaction as its second argument; pass it to queries that
 * must run in the transaction.
 *
 * @throws Error when sequelize is not a Sequelize v6 instance, because the
 *   tenant scope could not be applied.
 */
export async function withMysqlTenantScope<T>(
  sequelize: SequelizeLike,
  tenantId: string,
  fn: (sequelize: SequelizeLike, transaction: unknown) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  installTenantScoping(sequelize);
  return sequelize.transaction(async (transaction) => {
    await sequelize.query("SET @stratum_tenant_id = ?", {
      replacements: [tenantId],
      transaction,
    });
    try {
      return await scopeStorage.run({ sequelize, tenantId }, () => fn(sequelize, transaction));
    } finally {
      await sequelize.query("SET @stratum_tenant_id = NULL", { transaction });
    }
  });
}

/** Patches Sequelize's Model class once and guards this instance's queries. */
function installTenantScoping(sequelize: SequelizeLike): void {
  const candidate = sequelize as ScopableSequelize;
  const Model = candidate.constructor?.Model;
  const Op = candidate.constructor?.Op;
  if (typeof Model !== "function" || !Op || typeof candidate.addHook !== "function") {
    throw new Error(
      `${REFUSED} needs a Sequelize v6 instance, because it scopes the tenant's rows through Sequelize's models.`,
    );
  }
  const statics = Model as unknown as Record<PropertyKey, unknown>;
  if (!statics[PATCHED]) {
    patchModel(statics, Op.and);
    statics[PATCHED] = true;
  }
  if (!guardedInstances.has(sequelize)) {
    // Any model query that did not go through the scoped methods is refused.
    candidate.addHook("beforeQuery", (options: Options) => {
      const scope = scopeStorage.getStore();
      if (!scope || scope.sequelize !== sequelize || scopedCall.getStore()) return;
      const instance = options.instance as ModelInstanceLike | undefined;
      const model = (options.model as ModelClassLike | undefined) ?? instance?.constructor;
      if (model && tenantAttribute(model)) {
        throw new Error(`${REFUSED}: this query on a tenant model is not tenant-scoped and was refused.`);
      }
    });
    guardedInstances.add(sequelize);
  }
}

/** Returns the attribute that maps to the tenant_id column, if the model has one. */
function tenantAttribute(model: ModelClassLike): string | undefined {
  for (const [name, attribute] of Object.entries(model.rawAttributes ?? {})) {
    if ((attribute.field ?? name).toLowerCase() === "tenant_id") return name;
  }
  return undefined;
}

/** Returns the running scope when it belongs to this model's Sequelize instance. */
function scopeFor(model: ModelClassLike): Scope | undefined {
  const scope = scopeStorage.getStore();
  return scope && scope.sequelize === model.sequelize ? scope : undefined;
}

function patchModel(Model: Record<PropertyKey, unknown>, and: symbol): void {
  const withTenant = (where: unknown, attribute: string, tenantId: string): unknown =>
    where === undefined ? { [attribute]: tenantId } : { [and]: [where, { [attribute]: tenantId }] };

  /** Adds the tenant condition to each include of a tenant model, recursively. */
  const scopeIncludes = (parent: ModelClassLike, include: unknown, tenantId: string): unknown => {
    if (include === undefined) return undefined;
    const list = Array.isArray(include) ? include : [include];
    return list.map((entry) => {
      let item: Options;
      if (typeof entry === "function") item = { model: entry };
      else if (typeof entry === "string") item = { association: entry };
      else item = { ...(entry as Options) };
      if (item.all) throw new Error(`${REFUSED}: include "all" is refused; list the includes.`);
      const association = item.association;
      const target =
        (item.model as ModelClassLike | undefined) ??
        (typeof association === "string"
          ? parent.associations?.[association]?.target
          : (association as { target?: ModelClassLike } | undefined)?.target);
      if (!target) throw new Error(`${REFUSED}: an include could not be resolved to a model.`);
      const attribute = tenantAttribute(target);
      if (attribute) {
        // An include with a where clause defaults to required; keep the
        // caller's join type so a LEFT JOIN still returns the parent row.
        item.required = item.required ?? item.where !== undefined;
        item.where = withTenant(item.where, attribute, tenantId);
      }
      if (item.include !== undefined) item.include = scopeIncludes(target, item.include, tenantId);
      return item;
    });
  };

  /** Scopes the where clause and includes of a model call's options. */
  const scopeOptions = (model: ModelClassLike, options: unknown, tenantId: string): Options => {
    const scoped: Options = { ...((options as Options | undefined) ?? {}) };
    const attribute = tenantAttribute(model);
    if (attribute) scoped.where = withTenant(scoped.where, attribute, tenantId);
    if (scoped.include !== undefined) scoped.include = scopeIncludes(model, scoped.include, tenantId);
    return scoped;
  };

  const wrapStatic = (
    name: string,
    scope: (model: ModelClassLike, args: unknown[], tenantId: string) => unknown[],
  ) => {
    const original = Model[name] as AnyFunction;
    Model[name] = function (this: ModelClassLike, ...args: unknown[]): unknown {
      const active = scopeFor(this);
      if (!active) return original.apply(this, args);
      const scopedArgs = scope(this, args, active.tenantId);
      return scopedCall.run(true, () => original.apply(this, scopedArgs));
    };
  };

  const refuseForTenantModel = (what: string) => (model: ModelClassLike, args: unknown[]) => {
    if (tenantAttribute(model)) throw new Error(`${REFUSED}: ${what} on a tenant model is refused.`);
    return args;
  };

  wrapStatic("findAll", (model, [options], tenantId) => [scopeOptions(model, options, tenantId)]);
  wrapStatic("aggregate", (model, [field, fn, options], tenantId) => [
    field,
    fn,
    scopeOptions(model, options, tenantId),
  ]);
  wrapStatic("update", (model, [values, options], tenantId) => {
    const attribute = tenantAttribute(model);
    const scopedValues = { ...(values as Options) };
    if (attribute) delete scopedValues[attribute];
    return [scopedValues, scopeOptions(model, options, tenantId)];
  });
  wrapStatic("destroy", (model, [options], tenantId) => {
    if (tenantAttribute(model) && (options as Options | undefined)?.truncate) {
      throw new Error(`${REFUSED}: truncate on a tenant model is refused, because it removes every tenant's rows.`);
    }
    return [scopeOptions(model, options, tenantId)];
  });
  wrapStatic("restore", (model, [options], tenantId) => [scopeOptions(model, options, tenantId)]);
  wrapStatic("increment", (model, [fields, options], tenantId) => [
    fields,
    scopeOptions(model, options, tenantId),
  ]);
  wrapStatic("upsert", refuseForTenantModel("upsert"));
  wrapStatic("bulkCreate", (model, [records, options], tenantId) => {
    const attribute = tenantAttribute(model);
    if (!attribute) return [records, options];
    if ((options as Options | undefined)?.updateOnDuplicate) {
      throw new Error(`${REFUSED}: bulkCreate with updateOnDuplicate on a tenant model is refused.`);
    }
    const scopedRecords = (records as unknown[]).map((record) => {
      if (record instanceof (Model as unknown as new () => object)) {
        (record as ModelInstanceLike).setDataValue(attribute, tenantId);
        return record;
      }
      return { ...(record as Options), [attribute]: tenantId };
    });
    return [scopedRecords, options];
  });

  const proto = Model.prototype as Record<PropertyKey, unknown>;
  const wrapInstance = (name: string) => {
    const original = proto[name] as AnyFunction;
    proto[name] = async function (this: ModelInstanceLike, ...args: unknown[]): Promise<unknown> {
      const model = this.constructor;
      const active = scopeFor(model);
      const attribute = tenantAttribute(model);
      if (!active || !attribute) return original.apply(this, args);
      const options = { ...((args[0] as Options | undefined) ?? {}) };
      if (name === "save" && this.isNewRecord) {
        if (Array.isArray(options.fields) && !options.fields.includes(attribute)) {
          options.fields = [...(options.fields as string[]), attribute];
        }
      } else {
        await assertRowOfTenant(this, attribute, active.tenantId, options.transaction);
      }
      if (name === "save") this.setDataValue(attribute, active.tenantId);
      return scopedCall.run(true, () => original.apply(this, [options, ...args.slice(1)]));
    };
  };
  wrapInstance("save");
  wrapInstance("destroy");
  wrapInstance("restore");
}

/**
 * Throws when the row that an instance's primary key identifies belongs to
 * another tenant. The lookup is raw SQL, so it is not tenant-scoped, and its
 * result is used only for this decision.
 */
async function assertRowOfTenant(
  instance: ModelInstanceLike,
  attribute: string,
  tenantId: string,
  transaction: unknown,
): Promise<void> {
  const model = instance.constructor;
  const sequelize = model.sequelize as ScopableSequelize;
  const key = instance.where();
  const columns = Object.keys(key);
  if (columns.length === 0) return;
  const tenantColumn = model.rawAttributes?.[attribute]?.field ?? attribute;
  const sql =
    `SELECT ${escapeIdentifier(tenantColumn)} AS tenant_id ` +
    `FROM ${sequelize.getQueryInterface().queryGenerator.quoteTable(model.getTableName())} ` +
    `WHERE ${columns.map((column) => `${escapeIdentifier(column)} = ?`).join(" AND ")} LIMIT 1`;
  const rows = (await sequelize.query(sql, {
    replacements: columns.map((column) => key[column]),
    transaction,
    type: "SELECT",
    raw: true,
  })) as { tenant_id: unknown }[];
  if (rows.length > 0 && rows[0].tenant_id !== tenantId) {
    throw new Error(`${REFUSED}: the row belongs to another tenant.`);
  }
}
