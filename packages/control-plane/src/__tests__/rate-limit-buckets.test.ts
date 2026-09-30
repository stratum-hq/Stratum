import { describe, it, expect } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type Redis from "ioredis";
import { createPerKeyRateLimitMiddleware } from "../middleware/per-key-rate-limit.js";
import { createRedisRateLimiter } from "../middleware/rate-limit-redis.js";

function jwtRequest(tenantId: string, sub: string): FastifyRequest {
  return {
    authMethod: "jwt",
    apiKey: {
      id: sub,
      tenant_id: tenantId,
      key_hash: "",
      name: "jwt",
      created_at: new Date(),
      scopes: ["read"],
      rate_limit_max: 1,
      rate_limit_window: "1 minute",
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

describe("per-key rate limit buckets for JWT callers", () => {
  it("keeps the in-memory buckets of two tenants apart when their tokens share a subject", async () => {
    const limiter = createPerKeyRateLimitMiddleware();
    const first = fakeReply();
    await limiter(jwtRequest("tenant-bucket-a", "shared-sub"), first);
    const second = fakeReply();
    await limiter(jwtRequest("tenant-bucket-b", "shared-sub"), second);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it("keeps the Redis buckets of two tenants apart when their tokens share a subject", async () => {
    const keys: string[] = [];
    const redis = {
      script: async () => "sha",
      evalsha: async (_sha: string, _n: number, key: string) => { keys.push(key); return 1; },
      eval: async (_s: string, _n: number, key: string) => { keys.push(key); return 1; },
    } as unknown as Redis;
    const limiter = createRedisRateLimiter(redis, { maxRequests: 100, windowMs: 60_000 });
    await limiter(jwtRequest("tenant-redis-a", "shared-sub"), fakeReply());
    await limiter(jwtRequest("tenant-redis-b", "shared-sub"), fakeReply());
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
