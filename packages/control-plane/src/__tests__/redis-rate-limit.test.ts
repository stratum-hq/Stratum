import { describe, it, expect, vi, afterEach } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type Redis from "ioredis";
import { createRedisRateLimiter } from "../middleware/rate-limit-redis.js";

// ioredis is replaced by a stub that records the options the client is built
// with, so the reconnect policy can be inspected without a Redis server.
const ctor = vi.hoisted(() => ({ options: undefined as undefined | { retryStrategy?: (times: number) => number | null | void } }));
vi.mock("ioredis", () => ({
  default: class {
    constructor(_url: string, options: typeof ctor.options) {
      ctor.options = options;
    }
    on() { return this; }
    connect() { return Promise.resolve(); }
  },
}));

/**
 * In-memory stand-in for the ioredis commands the limiter uses (SCRIPT LOAD,
 * EVALSHA, EVAL running an INCR + EXPIRE script). While `down` is set every
 * command rejects immediately, which is how ioredis behaves with
 * enableOfflineQueue: false while it is disconnected.
 */
class FakeRedis {
  down = false;
  calls = 0;
  private counts = new Map<string, number>();
  private run(key: string): Promise<number> {
    this.calls++;
    if (this.down) return Promise.reject(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return Promise.resolve(next);
  }
  script() {
    return this.down ? Promise.reject(new Error("offline")) : Promise.resolve("sha");
  }
  evalsha(_sha: string, _n: number, key: string) { return this.run(key); }
  eval(_script: string, _n: number, key: string) { return this.run(key); }
}

function keyRequest(id: string, max: number): FastifyRequest {
  return {
    authMethod: "api_key",
    apiKey: {
      id, tenant_id: null, key_hash: "", name: "", created_at: new Date(),
      scopes: ["read"], rate_limit_max: max, rate_limit_window: "1 minute",
    },
  } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { statusCode: number } {
  const reply = {
    statusCode: 200,
    header() { return reply; },
    status(code: number) { reply.statusCode = code; return reply; },
    send() { return reply; },
  };
  return reply as unknown as FastifyReply & { statusCode: number };
}

async function hit(limiter: ReturnType<typeof createRedisRateLimiter>, req: FastifyRequest): Promise<number> {
  const reply = fakeReply();
  await limiter(req, reply);
  return reply.statusCode;
}

describe("Redis-backed per-key rate limiting", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("keeps reconnecting to Redis however many attempts have failed", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6399";
    vi.resetModules();
    const { createRedisClient } = await import("../redis.js");
    createRedisClient();
    delete process.env.REDIS_URL;
    const retry = ctor.options!.retryStrategy!;
    for (const attempt of [1, 4, 10, 1000]) {
      const delay = retry(attempt);
      expect(typeof delay).toBe("number");
      expect(delay as number).toBeGreaterThan(0);
    }
  });

  it("enforces the per-key limit in memory while Redis is unavailable", async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const limiter = createRedisRateLimiter(redis as unknown as Redis, { maxRequests: 100, windowMs: 60_000 });
    const req = keyRequest("redis-outage-key", 2);
    expect(await hit(limiter, req)).toBe(200);
    expect(await hit(limiter, req)).toBe(200);
    expect(await hit(limiter, req)).toBe(429);
  });

  it("goes back to counting in Redis once Redis recovers", async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const limiter = createRedisRateLimiter(redis as unknown as Redis, { maxRequests: 100, windowMs: 60_000 });
    const req = keyRequest("redis-recovery-key", 50);
    await hit(limiter, req);
    redis.down = false;
    const before = redis.calls;
    expect(await hit(limiter, req)).toBe(200);
    expect(redis.calls).toBeGreaterThan(before);
  });
});
