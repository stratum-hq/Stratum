let slugSeq = 0;

/**
 * Generate a slug unique to this run that satisfies the tenants.slug CHECK
 * constraint (^[a-z][a-z0-9_]{0,62}$). Lets each test isolate its data even
 * though the suite shares one database and one connection.
 */
export function uniqueSlug(prefix = "t"): string {
  slugSeq += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${slugSeq}_${rand}`;
}
