import { type ApiKeyScope } from "../types/api-key.js";

/**
 * API-key scopes form a hierarchy: read < write < admin. A granted scope
 * satisfies any required scope of equal-or-lower rank, so `admin` implies
 * `write` implies `read`.
 */
const SCOPE_RANK: Record<ApiKeyScope, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

/** Rank of a scope string, or 0 for any unrecognized scope. */
function rankOf(scope: string): number {
  return SCOPE_RANK[scope as ApiKeyScope] ?? 0;
}

/**
 * True when `granted` satisfies `required` under the read < write < admin
 * hierarchy: the key holds at least one scope whose rank is >= the required
 * scope's rank. This is the single scope-check primitive; use it everywhere a
 * scope requirement is evaluated rather than a flat `includes`.
 *
 * Fails closed: an unrecognized `required` scope (rank 0) is satisfied by
 * nothing, and unrecognized granted scopes contribute no rank.
 */
export function scopeSatisfies(
  granted: readonly string[],
  required: ApiKeyScope,
): boolean {
  const need = rankOf(required);
  if (need === 0) return false;
  return granted.some((scope) => rankOf(scope) >= need);
}
