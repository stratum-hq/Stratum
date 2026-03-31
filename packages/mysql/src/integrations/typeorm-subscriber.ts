import { getTenantContext } from "@stratum-hq/sdk";

// ─── Structural types (no hard dependency on typeorm) ───

export interface InsertEvent {
  entity: Record<string, unknown>;
}

export interface EntitySubscriberInterface {
  beforeInsert?(event: InsertEvent): void | Promise<void>;
}

/**
 * TypeORM subscriber that injects tenant_id into inserted entities via ALS.
 *
 * Known limitation: TypeORM subscribers cannot intercept query filtering.
 * This subscriber handles writes only. Use the shared-table adapter's
 * structured methods for tenant-scoped reads.
 */
export class stratumTypeOrmSubscriber implements EntitySubscriberInterface {
  /** Injects the current tenant's ID into the entity before insert. */
  beforeInsert(event: InsertEvent): void {
    const context = getTenantContext();
    event.entity["tenant_id"] = context.tenant_id;
  }
}
