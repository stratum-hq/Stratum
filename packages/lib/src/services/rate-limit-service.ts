/**
 * Per-tenant rate limiting primitive.
 *
 * A small, storage-agnostic fixed-window rate limiter for library consumers.
 * It is intentionally NOT wired into the `Stratum` facade (which is bound to a
 * single `pg.Pool`): the point of this primitive is that its storage is
 * pluggable, so it ships with a process-local in-memory store and a documented
 * {@link RateLimitStore} contract a consumer can implement over Redis, Postgres,
 * or anything else with an atomic per-key increment.
 *
 * This is distinct from the HTTP-layer rate limiting in
 * `@stratum-hq/control-plane`; this is a building block for embedding
 * per-tenant limits directly in an application.
 */

/** A rate limit: at most `limit` hits per `windowMs` window. */
export interface RateLimit {
  /** Maximum number of hits allowed within the window. Positive integer. */
  limit: number;
  /** Window length in milliseconds. Positive. */
  windowMs: number;
}

/** The outcome of a {@link RateLimiter.checkLimit} call. */
export interface RateLimitResult {
  /** Whether this hit is within the limit. */
  allowed: boolean;
  /** The effective limit that was applied. */
  limit: number;
  /** Hits remaining in the current window. 0 once the limit is reached. */
  remaining: number;
  /** Epoch milliseconds at which the current window ends and the counter clears. */
  resetAt: number;
  /** Seconds until the caller may retry. 0 when `allowed` is true. */
  retryAfter: number;
}

/** A live window's counter state, as returned by a {@link RateLimitStore}. */
export interface RateLimitState {
  /** Hit count within the current window, including the hit that produced it. */
  count: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
}

/**
 * Storage backend contract for {@link RateLimiter}.
 *
 * A conforming store must provide an atomic-per-key increment. Implementations:
 *
 *  - **Redis** — `INCR key` then, when the reply is `1`, `PEXPIRE key windowMs`;
 *    derive `resetAt` from `now + PTTL`. A short Lua script keeps it atomic and
 *    returns both count and TTL in one round trip.
 *  - **Postgres** — `INSERT ... ON CONFLICT (key) DO UPDATE SET count = ... `
 *    returning the new count, resetting the row when `reset_at` has passed.
 *  - **In-memory** — see {@link MemoryRateLimitStore}.
 */
export interface RateLimitStore {
  /**
   * Atomically increment the hit counter for `key` and return the resulting
   * count together with the window's reset time.
   *
   * Contract:
   *  - If no live window exists for `key` (never seen, or the previous window
   *    has already elapsed), begin a fresh window: set count to 1 and `resetAt`
   *    to `now + windowMs`.
   *  - Otherwise increment the existing count by 1 and return the current
   *    window's unchanged `resetAt`.
   *  - The read-modify-write MUST be atomic per key: two concurrent callers must
   *    never both observe the same pre-increment value.
   */
  increment(key: string, windowMs: number): Promise<RateLimitState>;

  /** Clear any counter for `key`, so the next increment starts a new window. */
  reset(key: string): Promise<void>;
}

/**
 * Process-local, in-memory {@link RateLimitStore}. Suitable for single-process
 * deployments, tests, and development.
 *
 * It holds one entry per distinct key seen; an entry is overwritten once its
 * window elapses and it is next incremented, and can be dropped with
 * {@link reset}. Memory therefore scales with the number of distinct
 * `tenantId:key` pairs. For high key cardinality or multi-process deployments,
 * back {@link RateLimiter} with a store that has native TTL eviction (e.g. Redis).
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitState>();

  async increment(key: string, windowMs: number): Promise<RateLimitState> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (existing === undefined || now >= existing.resetAt) {
      const fresh: RateLimitState = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return { ...fresh };
    }
    existing.count += 1;
    return { ...existing };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}

/**
 * Resolves a tenant's effective {@link RateLimit} dynamically. Return
 * `undefined` to fall through to the static map and then the default. This is
 * the seam for Stratum config inheritance: back it with
 * `stratum.resolveConfig(tenantId)` to drive limits from the tenant config tree.
 */
export type RateLimitResolver = (
  tenantId: string,
) => RateLimit | undefined | Promise<RateLimit | undefined>;

export interface RateLimiterOptions {
  /** Backing store. Defaults to a new {@link MemoryRateLimitStore}. */
  store?: RateLimitStore;
  /** Limit applied to any tenant without a more specific one. */
  defaultLimit: RateLimit;
  /** Static per-tenant overrides, keyed by tenant id. */
  limits?: Record<string, RateLimit>;
  /**
   * Dynamic per-tenant resolver, consulted before `limits` and `defaultLimit`.
   * See {@link RateLimitResolver}.
   */
  resolveLimit?: RateLimitResolver;
}

function assertValidLimit(limit: RateLimit, label: string): RateLimit {
  if (!Number.isInteger(limit.limit) || limit.limit <= 0) {
    throw new RangeError(`${label}.limit must be a positive integer, got ${limit.limit}`);
  }
  if (!Number.isFinite(limit.windowMs) || limit.windowMs <= 0) {
    throw new RangeError(`${label}.windowMs must be a positive number, got ${limit.windowMs}`);
  }
  return limit;
}

/**
 * Per-tenant fixed-window rate limiter.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ defaultLimit: { limit: 100, windowMs: 60_000 } });
 * const res = await limiter.checkLimit(tenantId, "api");
 * if (!res.allowed) throw new Error(`rate limited, retry in ${res.retryAfter}s`);
 * ```
 */
export class RateLimiter {
  private readonly store: RateLimitStore;
  private readonly defaultLimit: RateLimit;
  private readonly limits: Record<string, RateLimit>;
  private readonly resolveLimit?: RateLimitResolver;

  constructor(options: RateLimiterOptions) {
    this.store = options.store ?? new MemoryRateLimitStore();
    this.defaultLimit = assertValidLimit(options.defaultLimit, "defaultLimit");
    this.limits = {};
    for (const [tenantId, limit] of Object.entries(options.limits ?? {})) {
      this.limits[tenantId] = assertValidLimit(limit, `limits[${tenantId}]`);
    }
    this.resolveLimit = options.resolveLimit;
  }

  /**
   * Consume one hit against a tenant's limit and report whether it is allowed.
   *
   * `key` sub-scopes the limit within a tenant (e.g. per-endpoint or per-user);
   * omit it for a single tenant-wide bucket. Counters are namespaced by tenant,
   * so one tenant's usage never affects another's.
   */
  async checkLimit(tenantId: string, key = "default"): Promise<RateLimitResult> {
    const limit = await this.resolveEffectiveLimit(tenantId);
    const { count, resetAt } = await this.store.increment(
      `${tenantId}:${key}`,
      limit.windowMs,
    );
    const allowed = count <= limit.limit;
    return {
      allowed,
      limit: limit.limit,
      remaining: Math.max(0, limit.limit - count),
      resetAt,
      retryAfter: allowed ? 0 : Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  }

  /** Clear a tenant's counter for `key`, starting a fresh window on next hit. */
  async reset(tenantId: string, key = "default"): Promise<void> {
    await this.store.reset(`${tenantId}:${key}`);
  }

  private async resolveEffectiveLimit(tenantId: string): Promise<RateLimit> {
    if (this.resolveLimit) {
      const resolved = await this.resolveLimit(tenantId);
      if (resolved !== undefined) {
        return assertValidLimit(resolved, `resolveLimit(${tenantId})`);
      }
    }
    return this.limits[tenantId] ?? this.defaultLimit;
  }
}
