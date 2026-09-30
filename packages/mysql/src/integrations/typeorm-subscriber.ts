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
}

// TypeORM writes an upsert on MySQL as INSERT ... ON DUPLICATE KEY UPDATE and
// quotes each column with backticks.
const UPSERT_CLAUSE = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i;
const TENANT_ASSIGNMENT = /`tenant_id`\s*=/i;

/**
 * TypeORM subscriber that injects tenant_id into inserted entities via ALS and
 * never lets an update change tenant_id.
 *
 * Register it with `registerStratumSubscriber(dataSource)` after
 * `dataSource.initialize()`. TypeORM's `subscribers` option only loads classes
 * decorated with `@EventSubscriber()`, so it does not load this class.
 *
 * Known limitation: TypeORM subscribers cannot intercept query filtering.
 * This subscriber handles writes only. Use the shared-table adapter's
 * structured methods for tenant-scoped reads.
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
   * Rejects an upsert that writes tenant_id on a key conflict.
   *
   * On a conflict, MySQL assigns the inserted tenant_id to the existing row,
   * and that row can belong to another tenant. A subscriber cannot remove one
   * column from the conflict update, so the statement fails before it runs.
   *
   * @throws Error when the ON DUPLICATE KEY UPDATE clause assigns tenant_id.
   */
  beforeQuery(event: BeforeQueryEvent): void {
    const clause = event.query.split(UPSERT_CLAUSE)[1];
    if (clause !== undefined && TENANT_ASSIGNMENT.test(clause)) {
      throw new Error(
        "Stratum: an upsert must not update tenant_id on conflict. " +
          "Remove tenant_id from the entity values or from the orUpdate() columns.",
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
  const existing = dataSource.subscribers.find(
    (subscriber): subscriber is StratumTypeOrmSubscriber =>
      subscriber instanceof StratumTypeOrmSubscriber,
  );
  if (existing) return existing;

  const subscriber = new StratumTypeOrmSubscriber();
  dataSource.subscribers.push(subscriber);
  return subscriber;
}
