import { FastifyRequest, FastifyReply } from "fastify";
import type Redis from "ioredis";

export interface RedisRateLimitConfig {
  /** Maximum number of requests allowed in the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

/**
 * Lua script implementing a sliding-window counter.
 *
 * Keys[1] = the rate-limit key
 * ARGV[1] = window TTL in seconds
 * ARGV[2] = current timestamp in seconds (integer)
 *
 * The key is of the form  stratum:ratelimit:{api_key_id}:{window_start}
 * where window_start is computed on the caller side so the key naturally
 * rotates every window.
 *
 * The script INCRs the key, sets a TTL on first creation, and returns the
 * current count.
 */
const SLIDING_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

/**
 * Create a Redis-backed per-key rate limiter.
 *
 * Returns a Fastify preHandler hook. If Redis is unavailable or slow (>500ms)
 * the request is allowed through (fail-open).
 */
export function createRedisRateLimiter(
  redis: Redis,
  defaults: RedisRateLimitConfig,
) {
  // Pre-load the Lua script so subsequent calls use EVALSHA
  let scriptSha: string | null = null;
  redis
    .script("LOAD", SLIDING_WINDOW_LUA)
    .then((sha) => {
      scriptSha = sha as string;
    })
    .catch(() => {
      // Will fall back to EVAL on each call
    });

  return async function redisRateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Skip for unauthenticated requests (health, docs)
    if (!request.apiKey) return;

    const keyId = request.apiKey.id;
    const max = request.apiKey.rate_limit_max ?? defaults.maxRequests;
    const windowMs = request.apiKey.rate_limit_window
      ? parseWindowStr(request.apiKey.rate_limit_window)
      : defaults.windowMs;

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowTtlSec = Math.ceil(windowMs / 1000);
    const redisKey = `stratum:ratelimit:${keyId}:${windowStart}`;

    // The window resets at windowStart + windowMs
    const resetAt = new Date(windowStart + windowMs);

    let currentCount: number;

    try {
      currentCount = await withTimeout(
        evalScript(redis, scriptSha, redisKey, windowTtlSec),
        500,
      );
    } catch {
      // Redis unavailable or slow — fail-open
      return;
    }

    // Set rate-limit headers on every response
    const remaining = Math.max(0, max - currentCount);
    reply.header("X-RateLimit-Limit", String(max));
    reply.header("X-RateLimit-Remaining", String(remaining));
    reply.header("X-RateLimit-Reset", resetAt.toISOString());

    if (currentCount > max) {
      const retryAfterSec = Math.ceil((windowStart + windowMs - now) / 1000);
      reply.header("Retry-After", String(retryAfterSec));
      reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
        },
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function evalScript(
  redis: Redis,
  sha: string | null,
  key: string,
  ttlSec: number,
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  try {
    if (sha) {
      return (await redis.evalsha(sha, 1, key, String(ttlSec), String(now))) as number;
    }
  } catch {
    // NOSCRIPT or other error — fall through to EVAL
  }
  return (await redis.eval(SLIDING_WINDOW_LUA, 1, key, String(ttlSec), String(now))) as number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Redis timeout")), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Parse a duration string like "1 minute" into milliseconds. */
function parseWindowStr(window: string): number {
  const match = window.match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
  if (!match) return 60_000;
  const value = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case "second": return value * 1_000;
    case "minute": return value * 60_000;
    case "hour":   return value * 3_600_000;
    case "day":    return value * 86_400_000;
    default:       return 60_000;
  }
}
