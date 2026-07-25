import { AsyncLocalStorage } from "node:async_hooks";
import { TenantContextNotFoundError } from "@stratum-hq/core";
import type { ResolvedTenantContext } from "@stratum-hq/core";

export const tenantStorage = new AsyncLocalStorage<ResolvedTenantContext>();

export function getTenantContext(): ResolvedTenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new TenantContextNotFoundError();
  }
  return ctx;
}

export function runWithTenantContext<T>(context: ResolvedTenantContext, fn: () => T): T {
  return tenantStorage.run(context, fn);
}

export function setTenantContext(context: ResolvedTenantContext): void {
  // Bind the current store value — for middleware entry points
  tenantStorage.enterWith(context);
}
