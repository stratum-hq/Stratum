import { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

/**
 * Per-key rate limit middleware.
 *
 * After auth resolves the API key, this middleware overrides Fastify's
 * global rate limit with per-key limits when configured. Keys without
 * custom limits use the global defaults from config.
 *
 * Uses a simple in-memory sliding window per key ID. Does NOT replace
 * the global @fastify/rate-limit (which provides IP-based protection),
 * but layers on top with key-scoped enforcement.
 */

interface RateLimitEntry {
  timestamps: number[];
  windowMs: number;
  max: number;
}

const keyLimits = new Map<string, RateLimitEntry>();

/** Parse a duration string like "1 minute", "30 seconds", "1 hour" into milliseconds. */
function parseWindow(window: string): number {
  const match = window.match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
  if (!match) return 60_000; // default 1 minute
  const value = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case "second": return value * 1_000;
    case "minute": return value * 60_000;
    case "hour":   return value * 3_600_000;
    case "day":    return value * 86_400_000;
    default:       return 60_000;
  }
}

export function createPerKeyRateLimitMiddleware() {
  const globalMax = config.rateLimitMax;
  const globalWindowMs = parseWindow(config.rateLimitWindow);

  return async function perKeyRateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Skip for unauthenticated requests (health endpoint)
    if (!request.apiKey) return;

    const keyId = request.apiKey.id;
    const max = request.apiKey.rate_limit_max ?? globalMax;
    const windowMs = request.apiKey.rate_limit_window
      ? parseWindow(request.apiKey.rate_limit_window)
      : globalWindowMs;

    let entry = keyLimits.get(keyId);
    if (!entry || entry.max !== max || entry.windowMs !== windowMs) {
      entry = { timestamps: [], windowMs, max };
      keyLimits.set(keyId, entry);
    }

    const now = Date.now();
    const cutoff = now - windowMs;

    // Prune expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= max) {
      const retryAfter = Math.ceil((entry.timestamps[0] + windowMs - now) / 1000);
      reply.header("Retry-After", String(retryAfter));
      reply.header("X-RateLimit-Limit", String(max));
      reply.header("X-RateLimit-Remaining", "0");
      reply.header("X-RateLimit-Reset", new Date(entry.timestamps[0] + windowMs).toISOString());
      reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        },
      });
      return;
    }

    entry.timestamps.push(now);

    // Set rate limit headers on all responses
    reply.header("X-RateLimit-Limit", String(max));
    reply.header("X-RateLimit-Remaining", String(max - entry.timestamps.length));
  };
}
