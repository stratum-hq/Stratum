import { getTenantContext } from "@stratum-hq/sdk";
import { assertTenantId } from "../utils.js";

// ─── Structural types (no hard dependency on typeorm) ───

export interface InsertEvent {
  entity: Record<string, unknown>;
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
  /** Used once to reach TypeORM's update, delete and soft-delete query builder classes. */
  createQueryBuilder(): { update(): object; delete(): object; softDelete(): object };
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

// TypeORM writes an upsert on MySQL as INSERT ... ON DUPLICATE KEY UPDATE and
// quotes each column with backticks.
const UPSERT_CLAUSE = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i;
const TENANT_ASSIGNMENT = /`tenant_id`\s*=/i;
// The target of an INSERT, as TypeORM writes it: `table` or `schema`.`table`.
const INSERT_TARGET = /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+(?:`((?:[^`]|``)+)`\.)?`((?:[^`]|``)+)`/i;

const UPDATE_OR_DELETE = /^\s*(?:UPDATE|DELETE)\b/i;
const TENANT_PARAMETER = "stratumTenantId";
const SCOPED_EXECUTE = Symbol("stratum.tenantScopedExecute");
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
 * Not scoped: reads (find, findOne, query builder selects) and raw SQL
 * (`dataSource.query()`). Add the tenant condition to those yourself, or use
 * the shared-table adapter's structured methods.
 */
export class StratumTypeOrmSubscriber implements EntitySubscriberInterface {
  /** Injects the current tenant's ID into the entity before insert. */
  beforeInsert(event: InsertEvent): void {
    const context = getTenantContext();
    assertTenantId(context.tenant_id);
    event.entity["tenant_id"] = context.tenant_id;
  }

  /**
   * Keeps tenant_id out of an update. On save() the loaded value is restored,
   * so the column is unchanged; on a repository or query builder update the
   * column is dropped from the SET values (MySQL column names are
   * case-insensitive, so any letter case is dropped).
   */
  beforeUpdate(event: UpdateEvent): void {
    const entity = event.entity;
    if (!entity) return;

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
  // TypeORM ANDs this condition, in its own parentheses, to the caller's
  // WHERE clause, so an orWhere() cannot widen the statement past the tenant.
  builder.expressionMap.extraAppendedAndWhereCondition = existing
    ? `(${existing}) AND ${condition}`
    : condition;
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
 * It also scopes TypeORM's update, delete and soft-delete query builders to the
 * current tenant (see StratumTypeOrmSubscriber). The subscriber refuses an
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
  scopeWriteBuilders(dataSource);
  const existing = dataSource.subscribers.find(
    (subscriber): subscriber is StratumTypeOrmSubscriber =>
      subscriber instanceof StratumTypeOrmSubscriber,
  );
  if (existing) return existing;

  const subscriber = new StratumTypeOrmSubscriber();
  dataSource.subscribers.push(subscriber);
  return subscriber;
}
