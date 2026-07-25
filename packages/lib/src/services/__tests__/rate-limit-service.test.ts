import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RateLimiter,
  MemoryRateLimitStore,
  type RateLimit,
  type RateLimitStore,
  type RateLimitState,
} from "../rate-limit-service.js";

// Deterministic clock: fake timers control Date.now(), which both the limiter
// and MemoryRateLimitStore read, so window math is exact and reproducible.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

const LIMIT: RateLimit = { limit: 3, windowMs: 1000 };

describe("RateLimiter.checkLimit — enforcement", () => {
  it("allows hits up to the limit, then blocks", async () => {
    const limiter = new RateLimiter({ defaultLimit: LIMIT });

    const r1 = await limiter.checkLimit("t1");
    expect(r1).toMatchObject({ allowed: true, limit: 3, remaining: 2, retryAfter: 0 });

    const r2 = await limiter.checkLimit("t1");
    expect(r2).toMatchObject({ allowed: true, remaining: 1 });

    const r3 = await limiter.checkLimit("t1");
    expect(r3).toMatchObject({ allowed: true, remaining: 0 });

    const r4 = await limiter.checkLimit("t1");
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    // Window opened at t=0 with windowMs=1000, so retry is ~1s out.
    expect(r4.retryAfter).toBe(1);
    expect(r4.resetAt).toBe(1000);
  });

  it("reports remaining that never goes negative once over the limit", async () => {
    const limiter = new RateLimiter({ defaultLimit: { limit: 1, windowMs: 1000 } });
    await limiter.checkLimit("t1");
    const over = await limiter.checkLimit("t1");
    const overMore = await limiter.checkLimit("t1");
    expect(over.remaining).toBe(0);
    expect(overMore.remaining).toBe(0);
  });
});

describe("RateLimiter.checkLimit — window reset", () => {
  it("starts a fresh window after the previous one elapses", async () => {
    const limiter = new RateLimiter({ defaultLimit: LIMIT });

    await limiter.checkLimit("t1");
    await limiter.checkLimit("t1");
    await limiter.checkLimit("t1");
    expect((await limiter.checkLimit("t1")).allowed).toBe(false);

    // Still within the window: still blocked.
    vi.advanceTimersByTime(999);
    expect((await limiter.checkLimit("t1")).allowed).toBe(false);

    // Cross the window boundary: counter resets.
    vi.advanceTimersByTime(1);
    const fresh = await limiter.checkLimit("t1");
    expect(fresh).toMatchObject({ allowed: true, remaining: 2, resetAt: 2000 });
  });
});

describe("RateLimiter.checkLimit — isolation", () => {
  it("isolates counters per tenant", async () => {
    const limiter = new RateLimiter({ defaultLimit: LIMIT });

    // Exhaust t1.
    await limiter.checkLimit("t1");
    await limiter.checkLimit("t1");
    await limiter.checkLimit("t1");
    expect((await limiter.checkLimit("t1")).allowed).toBe(false);

    // t2 is unaffected.
    const t2 = await limiter.checkLimit("t2");
    expect(t2).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("isolates counters per key within a tenant", async () => {
    const limiter = new RateLimiter({ defaultLimit: { limit: 1, windowMs: 1000 } });

    expect((await limiter.checkLimit("t1", "read")).allowed).toBe(true);
    expect((await limiter.checkLimit("t1", "read")).allowed).toBe(false);

    // A different key for the same tenant has its own bucket.
    expect((await limiter.checkLimit("t1", "write")).allowed).toBe(true);
  });
});

describe("RateLimiter — effective limit resolution", () => {
  it("applies static per-tenant overrides over the default", async () => {
    const limiter = new RateLimiter({
      defaultLimit: { limit: 1, windowMs: 1000 },
      limits: { vip: { limit: 5, windowMs: 1000 } },
    });

    // Default tenant: 1 then blocked.
    expect((await limiter.checkLimit("free")).allowed).toBe(true);
    expect((await limiter.checkLimit("free")).allowed).toBe(false);

    // vip: gets the override of 5.
    for (let i = 0; i < 5; i++) {
      expect((await limiter.checkLimit("vip")).allowed).toBe(true);
    }
    expect((await limiter.checkLimit("vip")).allowed).toBe(false);
  });

  it("consults the resolver first, then falls through to map and default", async () => {
    const resolveLimit = vi.fn(async (tenantId: string) =>
      tenantId === "dynamic" ? { limit: 2, windowMs: 1000 } : undefined,
    );
    const limiter = new RateLimiter({
      defaultLimit: { limit: 1, windowMs: 1000 },
      limits: { mapped: { limit: 4, windowMs: 1000 } },
      resolveLimit,
    });

    // Resolver hit wins.
    expect((await limiter.checkLimit("dynamic")).limit).toBe(2);
    // Resolver returns undefined -> static map applies.
    expect((await limiter.checkLimit("mapped")).limit).toBe(4);
    // Resolver returns undefined and no map entry -> default.
    expect((await limiter.checkLimit("other")).limit).toBe(1);
    expect(resolveLimit).toHaveBeenCalledWith("dynamic");
  });
});

describe("RateLimiter.reset", () => {
  it("clears a tenant's counter so the next hit starts a new window", async () => {
    const limiter = new RateLimiter({ defaultLimit: { limit: 1, windowMs: 1000 } });

    await limiter.checkLimit("t1");
    expect((await limiter.checkLimit("t1")).allowed).toBe(false);

    await limiter.reset("t1");
    expect((await limiter.checkLimit("t1")).allowed).toBe(true);
  });
});

describe("RateLimiter — option validation", () => {
  it("rejects a non-positive or non-integer limit", () => {
    expect(() => new RateLimiter({ defaultLimit: { limit: 0, windowMs: 1000 } })).toThrow(
      RangeError,
    );
    expect(() => new RateLimiter({ defaultLimit: { limit: 1.5, windowMs: 1000 } })).toThrow(
      RangeError,
    );
  });

  it("rejects a non-positive window", () => {
    expect(() => new RateLimiter({ defaultLimit: { limit: 1, windowMs: 0 } })).toThrow(
      RangeError,
    );
  });

  it("validates a limit produced by the resolver at call time", async () => {
    const limiter = new RateLimiter({
      defaultLimit: { limit: 1, windowMs: 1000 },
      resolveLimit: async () => ({ limit: -1, windowMs: 1000 }),
    });
    await expect(limiter.checkLimit("t1")).rejects.toThrow(RangeError);
  });
});

describe("RateLimiter — custom store", () => {
  it("uses the injected store instead of the in-memory default", async () => {
    const increment = vi.fn(
      async (): Promise<RateLimitState> => ({ count: 1, resetAt: 5000 }),
    );
    const store: RateLimitStore = { increment, reset: vi.fn() };
    const limiter = new RateLimiter({ defaultLimit: LIMIT, store });

    const res = await limiter.checkLimit("t1", "k");
    expect(increment).toHaveBeenCalledWith("t1:k", 1000);
    expect(res).toMatchObject({ allowed: true, remaining: 2, resetAt: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Storage-backend contract, exercised against the reference in-memory store.
// ---------------------------------------------------------------------------
describe("MemoryRateLimitStore — contract", () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
  });

  it("opens a fresh window with count 1 and resetAt = now + windowMs", async () => {
    const s = await store.increment("k", 1000);
    expect(s).toEqual({ count: 1, resetAt: 1000 });
  });

  it("increments within a live window without moving resetAt", async () => {
    await store.increment("k", 1000);
    vi.advanceTimersByTime(500);
    const s = await store.increment("k", 1000);
    expect(s).toEqual({ count: 2, resetAt: 1000 });
  });

  it("opens a new window once the previous one has elapsed", async () => {
    await store.increment("k", 1000);
    vi.advanceTimersByTime(1000); // now === resetAt, window is over
    const s = await store.increment("k", 1000);
    expect(s).toEqual({ count: 1, resetAt: 2000 });
  });

  it("keeps distinct keys independent", async () => {
    await store.increment("a", 1000);
    await store.increment("a", 1000);
    const b = await store.increment("b", 1000);
    expect(b.count).toBe(1);
  });

  it("reset clears the counter", async () => {
    await store.increment("k", 1000);
    await store.reset("k");
    const s = await store.increment("k", 1000);
    expect(s.count).toBe(1);
  });
});
