export { IsolationStrategy } from "./tenant.js";

/**
 * V1 only supports SHARED_RLS.
 * SCHEMA_PER_TENANT planned for v1.1.
 * DB_PER_TENANT planned for v1.2.
 */
export const SUPPORTED_ISOLATION_STRATEGIES_V1 = ["SHARED_RLS"] as const;

export function isSupportedIsolationStrategy(strategy: string): boolean {
  return SUPPORTED_ISOLATION_STRATEGIES_V1.includes(strategy as any);
}
