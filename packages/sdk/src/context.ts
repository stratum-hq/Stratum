import { AsyncLocalStorage } from "node:async_hooks";
import { TenantContextLegacyNotFoundError } from "@stratum-hq/core";
import type { TenantContextLegacy } from "@stratum-hq/core";

export const tenantStorage = new AsyncLocalStorage<TenantContextLegacy>();

export function getTenantContextLegacy(): TenantContextLegacy {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new TenantContextLegacyNotFoundError();
  }
  return ctx;
}

export function runWithTenantContextLegacy<T>(context: TenantContextLegacy, fn: () => T): T {
  return tenantStorage.run(context, fn);
}

export function setTenantContextLegacy(context: TenantContextLegacy): void {
  // Bind the current store value — for middleware entry points
  tenantStorage.enterWith(context);
}
