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
  primaryKeyAttributes?: string[];
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
/** True inside a model call that tenant scoping has already handled (but not inside its hooks). */
const scopedCall = new AsyncLocalStorage<boolean>();
/**
 * The model method whose own options the next top-level _injectScope call
 * scopes, and whether that method requires a where clause (update, destroy,
 * increment), in which case a missing where is left for Sequelize to refuse.
 */
const topLevelCall = new AsyncLocalStorage<{ model: ModelClassLike; requiresWhere: boolean }>();
const PATCHED = Symbol("stratum.sequelizeTenantScope");
const guardedInstances = new WeakSet<object>();

/**
 * Runs fn with the tenant's rows scoped for Sequelize models, inside a
 * transaction that also sets the @stratum_tenant_id session variable.
 *
 * Inside fn, for every model with a tenant_id attribute:
 * - findAll, findOne, findByPk, findAndCountAll, count, sum, min, max and
 *   reload() see only the tenant's rows, and every include of a tenant model
 *   (including those that scopes and hooks add) is filtered in its join
 *   condition, so a non-required include keeps the parent;
 * - update, destroy, restore and increment/decrement change only the tenant's
 *   rows, and update never writes tenant_id. update, destroy and increment
 *   without a where clause are still refused by Sequelize;
 * - create, save of a new instance and bulkCreate write the tenant's tenant_id;
 * - save, destroy and restore of an instance whose row belongs to another
 *   tenant, or of a model without a primary key, throw;
 * - upsert, bulkCreate with updateOnDuplicate, truncate, and `or` / `right`
 *   on an include of a tenant model are refused, and a query that carries a
 *   tenant model but bypasses these methods throws, also inside model hooks.
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
    where === undefined || where === null
      ? { [attribute]: tenantId }
      : { [and]: [where, { [attribute]: tenantId }] };

  // Sequelize merges scopes into a call's options, and into each include, in
  // _injectScope. The tenant condition is added after that merge, so scope
  // includes, scope where clauses and includes added by hooks are all covered.
  const originalInject = Model._injectScope as AnyFunction;
  Model._injectScope = function (this: ModelClassLike, options: Options): unknown {
    const result = originalInject.call(this, options);
    const active = scopeFor(this);
    const attribute = tenantAttribute(this);
    if (!active || !attribute) return result;
    if (options.association !== undefined) {
      // An include being validated (_validateIncludedElement).
      if (options.or || options.right) {
        throw new Error(`${REFUSED}: "or" and "right" are refused on an include of a tenant model.`);
      }
      // An include with a where clause defaults to required; keep the
      // caller's join type so a LEFT JOIN still returns the parent row.
      if (options.required === undefined) options.required = !!options.where;
      options.where = withTenant(options.where, attribute, active.tenantId);
      return result;
    }
    const call = topLevelCall.getStore();
    if (call?.model === this && call.requiresWhere && (options.where === undefined || options.where === null)) {
      return result;
    }
    options.where = withTenant(options.where, attribute, active.tenantId);
    return result;
  };

  // Model hooks run user code; the beforeQuery guard applies there again.
  const originalRunHooks = Model.runHooks as AnyFunction;
  Model.runHooks = function (this: unknown, ...args: unknown[]): unknown {
    return scopedCall.run(false, () => originalRunHooks.apply(this, args));
  };

  const wrapStatic = (
    name: string,
    requiresWhere: boolean | undefined,
    scope: (model: ModelClassLike, args: unknown[], tenantId: string) => unknown[],
  ) => {
    const original = Model[name] as AnyFunction;
    Model[name] = function (this: ModelClassLike, ...args: unknown[]): unknown {
      const active = scopeFor(this);
      if (!active) return original.apply(this, args);
      const scopedArgs = scope(this, args, active.tenantId);
      const run = () => scopedCall.run(true, () => original.apply(this, scopedArgs));
      return requiresWhere === undefined ? run() : topLevelCall.run({ model: this, requiresWhere }, run);
    };
  };
  const unchanged = (_model: ModelClassLike, args: unknown[]) => args;
  const refuseForTenantModel = (what: string) => (model: ModelClassLike, args: unknown[]) => {
    if (tenantAttribute(model)) throw new Error(`${REFUSED}: ${what} on a tenant model is refused.`);
    return args;
  };

  wrapStatic("findAll", false, unchanged);
  wrapStatic("aggregate", false, unchanged);
  wrapStatic("increment", true, unchanged);
  wrapStatic("update", true, (model, [values, options]) => {
    const attribute = tenantAttribute(model);
    const scopedValues = { ...(values as Options) };
    if (attribute) delete scopedValues[attribute];
    return [scopedValues, options];
  });
  wrapStatic("destroy", true, (model, args) => {
    if (tenantAttribute(model) && (args[0] as Options | undefined)?.truncate) {
      throw new Error(`${REFUSED}: truncate on a tenant model is refused, because it removes every tenant's rows.`);
    }
    return args;
  });
  // restore() does not go through _injectScope; Sequelize does not require a
  // where clause for it, so the tenant condition is always added.
  wrapStatic("restore", undefined, (model, [options], tenantId) => {
    const attribute = tenantAttribute(model);
    const scoped: Options = { ...((options as Options | undefined) ?? {}) };
    if (attribute) scoped.where = withTenant(scoped.where, attribute, tenantId);
    return [scoped];
  });
  wrapStatic("upsert", undefined, refuseForTenantModel("upsert"));
  wrapStatic("bulkCreate", undefined, (model, [records, options], tenantId) => {
    const attribute = tenantAttribute(model);
    if (!attribute) return [records, options];
    const scopedOptions: Options = { ...((options as Options | undefined) ?? {}) };
    if (scopedOptions.updateOnDuplicate) {
      throw new Error(`${REFUSED}: bulkCreate with updateOnDuplicate on a tenant model is refused.`);
    }
    if (Array.isArray(scopedOptions.fields) && !scopedOptions.fields.includes(attribute)) {
      scopedOptions.fields = [...(scopedOptions.fields as string[]), attribute];
    }
    const scopedRecords = (records as unknown[]).map((record) => {
      if (record instanceof (Model as unknown as new () => object)) {
        (record as ModelInstanceLike).setDataValue(attribute, tenantId);
        return record;
      }
      return { ...(record as Options), [attribute]: tenantId };
    });
    return [scopedRecords, scopedOptions];
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
  // Without a primary key, Sequelize identifies the row by the where clause
  // of the query that loaded it, which cannot be checked here.
  const key = (model.primaryKeyAttributes ?? []).length > 0 ? instance.where() : null;
  const columns = key && typeof key === "object" ? Object.keys(key) : [];
  if (!key || columns.length === 0) {
    throw new Error(`${REFUSED}: the row's tenant cannot be checked, because the model has no primary key.`);
  }
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
