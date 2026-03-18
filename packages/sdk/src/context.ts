import { AsyncLocalStorage } from "node:async_hooks";
import { TenantContextNotFoundError } from "@stratum-hq/core";
import type { TenantContextLegacy } from "@stratum-hq/core";

export const tenantStorage = new AsyncLocalStorage<TenantContextLegacy>();

export function getTenantContext(): TenantContextLegacy {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new TenantContextNotFoundError();
  }
  return ctx;
}

export function runWithTenantContext<T>(context: TenantContextLegacy, fn: () => T): T {
  return tenantStorage.run(context, fn);
}

export function setTenantContext(context: TenantContextLegacy): void {
  // Bind the current store value — for middleware entry points
  tenantStorage.enterWith(context);
}
