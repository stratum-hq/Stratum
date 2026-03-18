import { AsyncLocalStorage } from "node:async_hooks";
import { TenantContextNotFoundError } from "@stratum-hq/core";
import type { TenantContext } from "@stratum-hq/core";

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new TenantContextNotFoundError();
  }
  return ctx;
}

export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return tenantStorage.run(context, fn);
}

export function setTenantContext(context: TenantContext): void {
  // Bind the current store value — for middleware entry points
  tenantStorage.enterWith(context);
}
