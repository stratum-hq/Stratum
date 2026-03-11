export { IsolationStrategy } from "./tenant.js";

/**
 * V1.2 adds DB_PER_TENANT to the supported strategies.
 */
export const SUPPORTED_ISOLATION_STRATEGIES = [
  "SHARED_RLS",
  "SCHEMA_PER_TENANT",
  "DB_PER_TENANT",
] as const;

/** @deprecated Use SUPPORTED_ISOLATION_STRATEGIES */
export const SUPPORTED_ISOLATION_STRATEGIES_V1 = SUPPORTED_ISOLATION_STRATEGIES;

export function isSupportedIsolationStrategy(strategy: string): boolean {
  return SUPPORTED_ISOLATION_STRATEGIES.includes(strategy as any);
}
