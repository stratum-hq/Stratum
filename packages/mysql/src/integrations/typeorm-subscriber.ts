import { AsyncLocalStorage } from "node:async_hooks";
import { getTenantContext } from "@stratum-hq/sdk";
import { assertTenantId } from "../utils.js";

// ─── Structural types (no hard dependency on typeorm) ───

export interface InsertEvent {
  entity: Record<string, unknown>;
  /** The inserted entity's metadata, when TypeORM has it. */
  metadata?: {
    tablePath: string;
    columns: { databaseName: string }[];
    primaryColumns: {
      propertyName: string;
      databaseName: string;
      getEntityValue?(entity: Record<string, unknown>): unknown;
    }[];
  };
  /** The query runner that will run the insert. */
  queryRunner?: { query(sql: string, parameters?: unknown[]): Promise<unknown> };
}

export interface UpdateEvent {
  /** The entity being saved, or the SET values of a query builder / repository update. */
  entity?: Record<string, unknown> | null;
  /** The row as loaded from the database, when TypeORM has it (save()). */
  databaseEntity?: Record<string, unknown> | null;
  metadata?: { columns: { propertyName: string; databaseName: string }[] };
}

export interface BeforeQueryEvent {
  /** The SQL text that TypeORM is about to send to MySQL. */
  query: string;
  /** The query runner that is about to send the query. */
  queryRunner?: { query(sql: string, parameters?: unknown[]): Promise<unknown> };
  /** The data source that is about to send the query. */
  dataSource?: object;
}

export interface EntitySubscriberInterface {
  beforeInsert?(event: InsertEvent): void | Promise<void>;
  beforeUpdate?(event: UpdateEvent): void | Promise<void>;
  beforeQuery?(event: BeforeQueryEvent): void | Promise<void>;
}

/** The part of a TypeORM `DataSource` that the registration helper uses. */
export interface TypeOrmDataSourceLike {
  readonly isInitialized: boolean;
  readonly subscribers: unknown[];
  /**
   * Used once to reach TypeORM's select, insert, update, delete and soft-delete
   * query builder classes. The returned builder is itself the select query builder.
   */
  createQueryBuilder(): { insert(): object; update(): object; delete(): object; softDelete(): object };
}

/** The part of a TypeORM update / delete / soft-delete query builder that tenant scoping uses. */
interface WriteQueryBuilderLike {
  connection: { subscribers: unknown[] };
  expressionMap: {
    mainAlias?: {
      name: string;
      hasMetadata: boolean;
      metadata: { columns: { databaseName: string }[] };
    };
    aliasNamePrefixingEnabled: boolean;
    extraAppendedAndWhereCondition: string;
  };
  escape(name: string): string;
  setParameter(key: string, value: unknown): unknown;
}

/** The part of a TypeORM alias (a FROM or JOIN target) that read scoping uses. */
interface AliasLike {
  name: string;
  hasMetadata: boolean;
  metadata: { columns: { databaseName: string }[] };
  /** Set when the alias is a derived table rather than an entity's table. */
  subQuery?: string;
}

/** The part of a TypeORM select query builder that read scoping uses. */
interface SelectQueryBuilderLike {
  connection: { subscribers: unknown[] };
  expressionMap: {
    mainAlias?: AliasLike;
    joinAttributes: { alias?: AliasLike; condition?: string }[];
    extraAppendedAndWhereCondition: string;
  };
  escape(name: string): string;
  setParameter(key: string, value: unknown): unknown;
}

// TypeORM writes an upsert on MySQL as INSERT ... ON DUPLICATE KEY UPDATE and
// quotes each column with backticks.
const UPSERT_CLAUSE = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i;
const TENANT_ASSIGNMENT = /`tenant_id`\s*=/i;
// The target of an INSERT, as TypeORM writes it: `table` or `schema`.`table`.
const INSERT_TARGET = /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+(?:`((?:[^`]|``)+)`\.)?`((?:[^`]|``)+)`/i;

const UPDATE_OR_DELETE = /^\s*(?:UPDATE|DELETE)\b/i;
// The target of a TRUNCATE, as TypeORM writes it: `table` or `schema`.`table`.
const TRUNCATE_TARGET = /^\s*TRUNCATE\s+(?:TABLE\s+)?(?:`((?:[^`]|``)+)`\.)?`?((?:[^`\s;]|``)+)`?/i;
const TENANT_COLUMN_SQL =
  "SELECT COUNT(*) AS n FROM information_schema.COLUMNS " +
  "WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND LOWER(COLUMN_NAME) = 'tenant_id'";
const TENANT_PARAMETER = "stratumTenantId";
const SCOPED_EXECUTE = Symbol("stratum.tenantScopedExecute");
const SCOPED_GET_QUERY = Symbol("stratum.tenantScopedGetQuery");
/** True while an insert builder with ON DUPLICATE KEY UPDATE (an upsert) runs. */
const upsertInProgress = new AsyncLocalStorage<boolean>();
const MARKED_UPSERT = Symbol("stratum.markedUpsert");
/** The WHERE addition that addTenantCondition set on each write builder's expression map. */
const scopedWriteConditions = new WeakMap<object, string>();
/** Data sources whose update and delete query builders are tenant-scoped. */
const scopedDataSources = new WeakSet<object>();

const UNIQUE_KEYS_SQL =
  "SELECT INDEX_NAME AS index_name, COLUMN_NAME AS column_name " +
  "FROM information_schema.STATISTICS " +
  "WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND NON_UNIQUE = 0";

/**
 * TypeORM subscriber that injects tenant_id into inserted entities via ALS and
 * never lets an update change tenant_id.
 *
 * Register it with `registerStratumSubscriber(dataSource)` after
 * `dataSource.initialize()`. TypeORM's `subscribers` option only loads classes
 * decorated with `@EventSubscriber()`, so it does not load this class.
 * Registration also scopes TypeORM's update, delete and soft-delete query
 * builders (repository update(), delete(), save() of an existing row, remove(),
 * softDelete(), restore()) to the current tenant: `tenant_id = <tenant>` is
 * ANDed to their WHERE clause, and they are refused outside a tenant context.
 *
 * Registration scopes reads the same way. Every SQL statement that TypeORM's
 * select query builder produces (repository find*, findOne*, count*, exists*,
 * sum/average/min/max, preload(), query builder getMany/getOne/getRawMany/
 * getRawOne/getCount/getManyAndCount/getExists/stream, relation loading, the
 * row that save() loads, and the count and pagination queries TypeORM builds
 * internally) ANDs `tenant_id = <tenant>` for the FROM entity to its WHERE
 * clause and adds it to the ON condition of each joined entity, so a LEFT JOIN
 * still returns the parent row. Reads of an entity with a tenant_id column are
 * refused outside a tenant context.
 *
 * Not scoped: raw SQL (`dataSource.query()`, `queryRunner.query()`), SQL taken
 * from a builder's getQuery() / getQueryAndParameters() and run by hand, reads
 * from a table that has no entity on the data source, and many-to-many junction
 * tables. Add the tenant condition to those yourself, or use the shared-table
 * adapter's structured methods.
 */
export class StratumTypeOrmSubscriber implements EntitySubscriberInterface {
  /**
   * Injects the current tenant's ID into the entity before insert.
   *
   * When the entity supplies its whole primary key, the table is first checked
   * for a row with that key. The lookup ignores the read scope, and its result
   * is used only for this decision. save() does not load another tenant's row,
   * so without the check save() would become an insert that either fails on
   * the key or, when the key includes tenant_id, creates a row for this tenant.
   *
   * @returns A promise that rejects when a row with the entity's primary key
   *   belongs to another tenant.
   */
  beforeInsert(event: InsertEvent): void | Promise<void> {
    const context = getTenantContext();
    assertTenantId(context.tenant_id);
    // An upsert is checked in beforeQuery against the table's unique keys.
    const key = upsertInProgress.getStore() ? undefined : suppliedPrimaryKey(event);
    event.entity["tenant_id"] = context.tenant_id;
    if (key) return assertKeyNotOwnedByAnotherTenant(event, key, context.tenant_id);
  }

  /**
   * Keeps tenant_id out of an update. On save() the loaded value is restored,
   * so the column is unchanged; on a repository or query builder update the
   * column is dropped from the SET values (MySQL column names are
   * case-insensitive, so any letter case is dropped).
   *
   * @throws Error when save() loaded a row whose tenant_id is not the current
   *   tenant's. The loaded tenant_id is not copied onto the entity.
   */
  beforeUpdate(event: UpdateEvent): void {
    const entity = event.entity;
    if (!entity) return;

    const loaded = event.databaseEntity;
    if (loaded) {
      const loadedProps = new Set(
        Object.keys(loaded).filter((key) => key.toLowerCase() === "tenant_id"),
      );
      for (const column of event.metadata?.columns ?? []) {
        if (column.databaseName.toLowerCase() === "tenant_id" && column.propertyName in loaded) {
          loadedProps.add(column.propertyName);
        }
      }
      if (loadedProps.size > 0) {
        const context = getTenantContext();
        assertTenantId(context.tenant_id);
        for (const prop of loadedProps) {
          if (loaded[prop] !== context.tenant_id) {
            throw new Error("Stratum: save() refused, because the row belongs to another tenant.");
          }
        }
      }
    }

    const tenantProps = new Set(
      Object.keys(entity).filter((key) => key.toLowerCase() === "tenant_id"),
    );
    for (const column of event.metadata?.columns ?? []) {
      if (column.databaseName.toLowerCase() === "tenant_id" && column.propertyName in entity) {
        tenantProps.add(column.propertyName);
      }
    }

    for (const prop of tenantProps) {
      const loaded = event.databaseEntity;
      if (loaded && prop in loaded) {
        entity[prop] = loaded[prop];
      } else {
        delete entity[prop];
      }
    }
  }

  /**
   * Rejects an upsert that could update another tenant's row.
   *
   * A conflict update must never change the tenant of an existing row. A
   * subscriber cannot remove one column from the conflict update, so the
   * statement fails before it runs.
   *
   * MySQL runs ON DUPLICATE KEY UPDATE on a conflict with any unique key of
   * the table, whatever conflict columns were passed to upsert() or
   * orUpdate(). The upsert is therefore allowed only when every unique key
   * (including the primary key) of the target table contains tenant_id, so a
   * conflict can only ever be with a row of the same tenant. The keys are read
   * from information_schema through the same query runner.
   *
   * @throws Error when the ON DUPLICATE KEY UPDATE clause assigns tenant_id.
   * @returns A promise that rejects when a unique key of the table does not
   *   include tenant_id, or when the table cannot be determined.
   */
  beforeQuery(event: BeforeQueryEvent): void | Promise<void> {
    if (
      event.dataSource &&
      !scopedDataSources.has(event.dataSource) &&
      UPDATE_OR_DELETE.test(event.query)
    ) {
      throw new Error(
        "Stratum: register the subscriber with registerStratumSubscriber(dataSource), " +
          "which scopes updates and deletes to the current tenant.",
      );
    }
    if (/^\s*TRUNCATE\b/i.test(event.query)) return assertNotTenantTable(event);
    const clause = event.query.split(UPSERT_CLAUSE)[1];
    if (clause === undefined) return;
    if (TENANT_ASSIGNMENT.test(clause)) {
      throw new Error(
        "Stratum: an upsert must not update tenant_id on conflict. " +
          "Remove tenant_id from the entity values or from the orUpdate() columns.",
      );
    }
    return assertUniqueKeysIncludeTenant(event);
  }
}

/**
 * ANDs `tenant_id = <current tenant>` to the WHERE clause of an update, delete
 * or soft-delete builder whose data source has the subscriber. Entities without
 * a tenant_id column are left alone; a target without metadata (a table name)
 * is treated as a tenant table.
 */
function addTenantCondition(builder: WriteQueryBuilderLike): void {
  if (!builder.connection.subscribers.some((s) => s instanceof StratumTypeOrmSubscriber)) return;

  const alias = builder.expressionMap.mainAlias;
  let column = "tenant_id";
  if (alias?.hasMetadata) {
    const tenantColumn = alias.metadata.columns.find(
      (c) => c.databaseName.toLowerCase() === "tenant_id",
    );
    if (!tenantColumn) return;
    column = tenantColumn.databaseName;
  }

  const context = getTenantContext();
  assertTenantId(context.tenant_id);
  const qualified =
    builder.expressionMap.aliasNamePrefixingEnabled && alias
      ? `${builder.escape(alias.name)}.${builder.escape(column)}`
      : builder.escape(column);
  const condition = `${qualified} = :${TENANT_PARAMETER}`;
  const existing = builder.expressionMap.extraAppendedAndWhereCondition;
  // A builder that is executed again already carries the condition set here.
  if (scopedWriteConditions.get(builder.expressionMap) !== existing) {
    // TypeORM ANDs this condition, in its own parentheses, to the caller's
    // WHERE clause, so an orWhere() cannot widen the statement past the tenant.
    builder.expressionMap.extraAppendedAndWhereCondition = existing
      ? `(${existing}) AND ${condition}`
      : condition;
    scopedWriteConditions.set(builder.expressionMap, builder.expressionMap.extraAppendedAndWhereCondition);
  }
  builder.setParameter(TENANT_PARAMETER, context.tenant_id);
}

/** Wraps execute() of TypeORM's update, delete and soft-delete query builder classes, once. */
function scopeWriteBuilders(dataSource: TypeOrmDataSourceLike): void {
  const builders = [
    dataSource.createQueryBuilder().update(),
    dataSource.createQueryBuilder().delete(),
    dataSource.createQueryBuilder().softDelete(),
  ];
  for (const builder of builders) {
    const proto = Object.getPrototypeOf(builder) as Record<PropertyKey, unknown>;
    if (proto[SCOPED_EXECUTE]) continue;
    const original = proto.execute as (this: WriteQueryBuilderLike) => Promise<unknown>;
    proto.execute = function (this: WriteQueryBuilderLike): Promise<unknown> {
      addTenantCondition(this);
      return original.call(this);
    };
    proto[SCOPED_EXECUTE] = true;
  }
  scopedDataSources.add(dataSource);
}

/**
 * Returns the primary key values that an inserted entity supplies, keyed by
 * column name. Returns undefined when the entity has no tenant_id column or
 * any part of its primary key is missing.
 */
function suppliedPrimaryKey(event: InsertEvent): Map<string, unknown> | undefined {
  const metadata = event.metadata;
  if (!metadata || !event.queryRunner || metadata.primaryColumns.length === 0) return undefined;
  if (!metadata.columns.some((c) => c.databaseName.toLowerCase() === "tenant_id")) return undefined;
  const key = new Map<string, unknown>();
  for (const column of metadata.primaryColumns) {
    const value = column.getEntityValue
      ? column.getEntityValue(event.entity)
      : event.entity[column.propertyName];
    if (value === undefined || value === null) return undefined;
    key.set(column.databaseName, value);
  }
  return key;
}

/**
 * Refuses an insert whose primary key already belongs to another tenant's
 * row. The lookup is raw SQL on the insert's own query runner, so it is not
 * tenant-scoped, and its result is never returned to the caller.
 */
async function assertKeyNotOwnedByAnotherTenant(
  event: InsertEvent,
  key: Map<string, unknown>,
  tenantId: string,
): Promise<void> {
  const metadata = event.metadata as NonNullable<InsertEvent["metadata"]>;
  const quote = (name: string) => "`" + name.replace(/`/g, "``") + "`";
  const tenantColumn = metadata.columns.find((c) => c.databaseName.toLowerCase() === "tenant_id")
    ?.databaseName as string;
  const table = metadata.tablePath.split(".").map(quote).join(".");
  const where = [...key.keys()].map((column) => `${quote(column)} = ?`).join(" AND ");
  const rows = (await event.queryRunner?.query(
    `SELECT ${quote(tenantColumn)} AS tenant_id FROM ${table} WHERE ${where} LIMIT 1`,
    [...key.values()],
  )) as { tenant_id: unknown }[];
  if (rows.length > 0 && rows[0].tenant_id !== tenantId) {
    throw new Error("Stratum: save() refused, because the row belongs to another tenant.");
  }
}

/** Returns the tenant_id column of an entity alias, or undefined when it has none. */
function tenantColumnOf(alias: AliasLike | undefined): string | undefined {
  if (!alias || alias.subQuery || !alias.hasMetadata) return undefined;
  return alias.metadata.columns.find((c) => c.databaseName.toLowerCase() === "tenant_id")?.databaseName;
}

/**
 * Builds the SQL of a select query builder whose data source has the
 * subscriber, with `tenant_id = <current tenant>` ANDed to the WHERE clause for
 * the FROM entity and to the ON condition of each joined entity that has a
 * tenant_id column. The conditions are added only while the SQL is built and
 * removed afterwards, so a builder that is built again, cloned, or used as a
 * subquery never carries the condition twice.
 */
function buildScopedSelect(builder: SelectQueryBuilderLike, build: () => string): string {
  if (!builder.connection.subscribers.some((s) => s instanceof StratumTypeOrmSubscriber)) return build();

  const map = builder.expressionMap;
  const condition = (alias: AliasLike, column: string) =>
    `${builder.escape(alias.name)}.${builder.escape(column)} = :${TENANT_PARAMETER}`;

  const mainColumn = tenantColumnOf(map.mainAlias);
  const joins = map.joinAttributes
    .map((join) => ({ join, column: tenantColumnOf(join.alias) }))
    .filter((entry): entry is { join: (typeof map.joinAttributes)[number]; column: string } =>
      entry.column !== undefined,
    );
  const setTenantParameter = () => {
    const context = getTenantContext();
    assertTenantId(context.tenant_id);
    builder.setParameter(TENANT_PARAMETER, context.tenant_id);
  };
  if (mainColumn === undefined && joins.length === 0) {
    const sql = build();
    // SQL built by another scoped builder can be embedded here, for example
    // TypeORM's pagination query, which selects from a clone of the builder.
    if (sql.includes(`:${TENANT_PARAMETER}`)) setTenantParameter();
    return sql;
  }

  setTenantParameter();

  const extra = map.extraAppendedAndWhereCondition;
  const joinConditions = joins.map(({ join }) => join.condition);
  try {
    if (mainColumn !== undefined) {
      const main = condition(map.mainAlias as AliasLike, mainColumn);
      // TypeORM ANDs this condition, in its own parentheses, to the caller's
      // WHERE clause, so an orWhere() cannot widen the read past the tenant.
      map.extraAppendedAndWhereCondition = extra ? `(${extra}) AND ${main}` : main;
    }
    for (const { join, column } of joins) {
      // In the ON condition rather than the WHERE clause, so a LEFT JOIN keeps
      // the parent row and only drops the other tenant's joined row.
      const own = condition(join.alias as AliasLike, column);
      join.condition = join.condition ? `(${join.condition}) AND ${own}` : own;
    }
    return build();
  } finally {
    map.extraAppendedAndWhereCondition = extra;
    joins.forEach(({ join }, i) => {
      join.condition = joinConditions[i];
    });
  }
}

/**
 * Wraps getQuery() of TypeORM's select query builder class, once. Every read
 * the builder runs (loadRawResults, stream, the count, exists and pagination
 * queries, and subqueries) builds its SQL through getQuery().
 */
function scopeSelectBuilder(dataSource: TypeOrmDataSourceLike): void {
  const proto = Object.getPrototypeOf(dataSource.createQueryBuilder()) as Record<PropertyKey, unknown>;
  if (proto[SCOPED_GET_QUERY]) return;
  if (!Object.prototype.hasOwnProperty.call(proto, "getQuery") || typeof proto.getQuery !== "function") {
    throw new Error(
      "Stratum: this TypeORM version's select query builder is not supported, so reads cannot be tenant-scoped.",
    );
  }
  const original = proto.getQuery as (this: SelectQueryBuilderLike) => string;
  proto.getQuery = function (this: SelectQueryBuilderLike): string {
    return buildScopedSelect(this, () => original.call(this));
  };
  proto[SCOPED_GET_QUERY] = true;
}

/**
 * Wraps execute() of TypeORM's insert query builder class, once, so that
 * beforeInsert knows when the insert is an upsert.
 */
function markUpserts(dataSource: TypeOrmDataSourceLike): void {
  const proto = Object.getPrototypeOf(dataSource.createQueryBuilder().insert()) as Record<PropertyKey, unknown>;
  if (proto[MARKED_UPSERT]) return;
  const original = proto.execute as (this: { expressionMap: { onUpdate?: unknown } }) => Promise<unknown>;
  proto.execute = function (this: { expressionMap: { onUpdate?: unknown } }): Promise<unknown> {
    return upsertInProgress.run(Boolean(this.expressionMap.onUpdate), () => original.call(this));
  };
  proto[MARKED_UPSERT] = true;
}

/**
 * Refuses a TRUNCATE (Repository.clear(), QueryRunner.clearTable()) of a table
 * with a tenant_id column, because it would empty the table for every tenant.
 * A TRUNCATE whose table cannot be checked is refused too.
 */
async function assertNotTenantTable(event: BeforeQueryEvent): Promise<void> {
  const target = TRUNCATE_TARGET.exec(event.query);
  const unquote = (name: string | undefined) => (name === undefined ? null : name.replace(/``/g, "`"));
  const table = target ? unquote(target[2]) : null;
  let isTenantTable = true;
  if (table && event.queryRunner) {
    const rows = (await event.queryRunner.query(TENANT_COLUMN_SQL, [unquote(target?.[1]), table])) as {
      n: number | string;
    }[];
    isTenantTable = Number(rows[0]?.n ?? 1) > 0;
  }
  if (isTenantTable) {
    throw new Error(
      `Stratum: TRUNCATE of "${table ?? "unknown table"}" is refused, because it would remove every tenant's rows. ` +
        "Delete the current tenant's rows instead.",
    );
  }
}

async function assertUniqueKeysIncludeTenant(event: BeforeQueryEvent): Promise<void> {
  const target = INSERT_TARGET.exec(event.query);
  if (!target || !event.queryRunner) {
    throw new Error(
      "Stratum: an upsert is refused because its table's unique keys cannot be checked for tenant_id.",
    );
  }
  const unquote = (name: string | undefined) => (name === undefined ? null : name.replace(/``/g, "`"));
  const table = unquote(target[2]) as string;
  const rows = (await event.queryRunner.query(UNIQUE_KEYS_SQL, [unquote(target[1]), table])) as {
    index_name: string;
    column_name: string;
  }[];

  const keys = new Map<string, boolean>();
  for (const row of rows) {
    const hasTenant = row.column_name.toLowerCase() === "tenant_id";
    keys.set(row.index_name, (keys.get(row.index_name) ?? false) || hasTenant);
  }
  for (const [key, hasTenant] of keys) {
    if (!hasTenant) {
      throw new Error(
        `Stratum: an upsert on "${table}" is refused, because its unique key "${key}" does not include tenant_id, ` +
          "so a conflict could update another tenant's row. Add tenant_id to every unique key of the table, " +
          "or look the row up by tenant before writing it.",
      );
    }
  }
}

/**
 * Returns the one StratumTypeOrmSubscriber on the data source, and adds it first when it is missing.
 *
 * A second call returns the subscriber that the first call added, so the
 * data source never runs the subscriber twice.
 *
 * It also scopes TypeORM's select, update, delete and soft-delete query
 * builders to the current tenant (see StratumTypeOrmSubscriber). The subscriber refuses an
 * UPDATE or DELETE on a data source that was not registered this way.
 *
 * @param dataSource - An initialized TypeORM `DataSource`.
 * @throws Error when the data source is not initialized. `initialize()` replaces
 *   the subscriber list, so an earlier registration has no effect.
 */
export function registerStratumSubscriber(
  dataSource: TypeOrmDataSourceLike,
): StratumTypeOrmSubscriber {
  if (!dataSource.isInitialized) {
    throw new Error(
      "Stratum: call registerStratumSubscriber() after dataSource.initialize(). " +
        "initialize() replaces the subscriber list.",
    );
  }
  scopeSelectBuilder(dataSource);
  scopeWriteBuilders(dataSource);
  markUpserts(dataSource);
  const existing = dataSource.subscribers.find(
    (subscriber): subscriber is StratumTypeOrmSubscriber =>
      subscriber instanceof StratumTypeOrmSubscriber,
  );
  if (existing) return existing;

  const subscriber = new StratumTypeOrmSubscriber();
  dataSource.subscribers.push(subscriber);
  return subscriber;
}
