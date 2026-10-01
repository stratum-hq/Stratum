import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// Mock pool-helpers before importing api-key-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as apiKeyService from "../api-key-service.js";
import { makeMockPool } from "./test-helpers.js";

/** Wire withClient to call the callback with a { query } client. */
function withMockQuery(mockQuery: ReturnType<typeof vi.fn>) {
  vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
    const client = { query: mockQuery } as unknown as import("pg").PoolClient;
    return fn(client);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getApiKey", () => {
  it("selects a key by id and returns its owning tenant", async () => {
    const pool = makeMockPool();
    const row = { id: "key-1", tenant_id: "tenant-1", name: null, created_at: new Date(), last_used_at: null, revoked_at: null, expires_at: null };
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [row] });
    withMockQuery(mockQuery);

    const result = await apiKeyService.getApiKey(pool, "key-1");

    expect(result).toEqual(row);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM api_keys WHERE id = $1");
    expect(sql).toContain("tenant_id");
    expect(params).toEqual(["key-1"]);
  });

  it("returns null when no key has that id", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    withMockQuery(mockQuery);

    const result = await apiKeyService.getApiKey(pool, "ghost");
    expect(result).toBeNull();
  });
});

describe("validateApiKey", () => {
  const keyRow = {
    id: "key-1", tenant_id: "tenant-1", key_hash: "h", key_prefix: "sk_live_", name: null,
    created_at: new Date(), last_used_at: null, revoked_at: null, expires_at: null,
    scopes: ["read"], rate_limit_max: null, rate_limit_window: null, hash_version: 1, stamp_due: true,
  };

  /** Run the validation connection normally and hand the stamp connection to `stamp`. */
  function mockConnections(stamp: () => Promise<unknown>) {
    const validationQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [keyRow] })
      .mockResolvedValueOnce({ rows: [{ scopes: ["read"], role_scopes: null }] });
    vi.mocked(poolHelpers.withClient)
      .mockImplementationOnce(async (_pool, fn) =>
        fn({ query: validationQuery } as unknown as import("pg").PoolClient))
      .mockImplementationOnce(() => stamp() as Promise<never>);
  }

  it("waits for the last_used_at stamp before it resolves", async () => {
    let finishStamp!: () => void;
    const stampDone = new Promise<void>((resolve) => { finishStamp = resolve; });
    mockConnections(() => stampDone);

    let resolved = false;
    const pending = apiKeyService.validateApiKey(makeMockPool(), "presented-key").then((r) => {
      resolved = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(poolHelpers.withClient)).toHaveBeenCalledTimes(2);
    expect(resolved).toBe(false);

    finishStamp();
    expect((await pending)?.key_id).toBe("key-1");
  });

  it("opens no stamp connection when the key was stamped less than a minute ago", async () => {
    const validationQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ...keyRow, stamp_due: false }] })
      .mockResolvedValueOnce({ rows: [{ scopes: ["read"], role_scopes: null }] });
    vi.mocked(poolHelpers.withClient).mockImplementationOnce(async (_pool, fn) =>
      fn({ query: validationQuery } as unknown as import("pg").PoolClient));

    const result = await apiKeyService.validateApiKey(makeMockPool(), "presented-key");

    expect(result?.key_id).toBe("key-1");
    expect(vi.mocked(poolHelpers.withClient)).toHaveBeenCalledTimes(1);
  });

  it("still authenticates the key when the last_used_at stamp fails", async () => {
    mockConnections(() => Promise.reject(new Error("connection lost")));

    const result = await apiKeyService.validateApiKey(makeMockPool(), "presented-key");

    expect(result?.key_id).toBe("key-1");
  });
});

describe("validateApiKey hash candidates", () => {
  const HMAC_ENV_NAME = "STRATUM_API_KEY_HMAC_SECRET";
  const sha256 = (k: string) => crypto.createHash("sha256").update(k).digest("hex");
  const hmac = (k: string, s: string) => crypto.createHmac("sha256", s).update(k).digest("hex");

  /** The [hash, version] pairs validateApiKey looks up for `key`, none of which match. */
  async function lookups(options?: { allowLegacyHashes?: boolean }): Promise<Array<[unknown, unknown]>> {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    withMockQuery(mockQuery);
    expect(await apiKeyService.validateApiKey(makeMockPool(), "presented-key", options)).toBeNull();
    return mockQuery.mock.calls.map(([, params]) => [params[0], params[2]]);
  }

  afterEach(() => {
    delete process.env[HMAC_ENV_NAME];
  });

  it("looks up only the SHA-256 hash with version 1 when no HMAC secret is set", async () => {
    expect(await lookups()).toEqual([[sha256("presented-key"), 1]]);
  });

  it("looks up the HMAC hash first, then the legacy SHA-256 hash, by default once an HMAC secret is set", async () => {
    process.env[HMAC_ENV_NAME] = "unit-secret";
    expect(await lookups()).toEqual([
      [hmac("presented-key", "unit-secret"), 2],
      [sha256("presented-key"), 1],
    ]);
  });

  it("looks up only the HMAC hash with version 2 when legacy hashes are turned off", async () => {
    process.env[HMAC_ENV_NAME] = "unit-secret";
    expect(await lookups({ allowLegacyHashes: false })).toEqual([[hmac("presented-key", "unit-secret"), 2]]);
  });

  it("re-hashes a version 1 key with HMAC only while the stored row is still version 1", async () => {
    process.env[HMAC_ENV_NAME] = "unit-secret";
    const legacyRow = {
      id: "key-1", tenant_id: null, key_hash: sha256("presented-key"), key_prefix: "sk_live_", name: null,
      created_at: new Date(), last_used_at: null, revoked_at: null, expires_at: null,
      scopes: ["read"], rate_limit_max: null, rate_limit_window: null, hash_version: 1, stamp_due: false,
    };
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [legacyRow] })
      .mockResolvedValue({ rows: [{ scopes: ["read"], role_scopes: null }] });
    withMockQuery(mockQuery);

    expect((await apiKeyService.validateApiKey(makeMockPool(), "presented-key"))?.key_id).toBe("key-1");

    const update = mockQuery.mock.calls.find(([sql]) => String(sql).includes("SET key_hash"));
    expect(update).toBeDefined();
    const [sql, params] = update!;
    expect(String(sql).replace(/\s+/g, " ")).toContain("WHERE id = $3 AND hash_version = 1");
    expect(params).toEqual([hmac("presented-key", "unit-secret"), 2, "key-1"]);
  });
});

