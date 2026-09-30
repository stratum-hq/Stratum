import Redis from "ioredis";
import { config } from "./config.js";

let redisClient: Redis | null = null;

/**
 * Create a Redis client from the REDIS_URL env var.
 * Returns null if REDIS_URL is not configured.
 * Connection errors are logged but never crash the process. The client keeps
 * reconnecting with capped backoff; while it is down, per-key rate limiting
 * falls back to the in-memory limiter.
 */
export function createRedisClient(): Redis | null {
  if (!config.redisUrl) {
    return null;
  }

  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy(times: number) {
      // Never give up: returning null would stop reconnecting for good.
      return Math.min(times * 200, 5000);
    },
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  client.on("error", (err) => {
    console.warn("[stratum] Redis connection error (rate limiting will fall back to in-memory):", err.message);
  });

  client.on("connect", () => {
    console.info("[stratum] Redis connected — using Redis-backed rate limiting.");
  });

  // Attempt to connect; failures are non-fatal
  client.connect().catch((err) => {
    console.warn("[stratum] Redis initial connection failed (continuing without Redis):", err.message);
  });

  redisClient = client;
  return client;
}

/**
 * Get the current Redis client singleton (may be null).
 */
export function getRedisClient(): Redis | null {
  return redisClient;
}

/**
 * Health check: returns "connected", "disconnected", or "not_configured".
 */
export async function checkRedisHealth(): Promise<"connected" | "disconnected" | "not_configured"> {
  if (!redisClient) {
    return "not_configured";
  }

  try {
    const result = await Promise.race([
      redisClient.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 1000),
      ),
    ]);
    return result === "PONG" ? "connected" : "disconnected";
  } catch {
    return "disconnected";
  }
}
