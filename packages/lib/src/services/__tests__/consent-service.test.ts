import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing consent-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as consentService from "../consent-service.js";
import type { ConsentRecord, GrantConsentInput } from "@stratum/core";

function makeMockPool() {
  return {} as import("pg").Pool;
}

const mockConsentRecord: ConsentRecord = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  tenant_id: "tenant-456",
  subject_id: "user-789",
  purpose: "data_processing",
  granted: true,
  granted_at: "2024-01-01T00:00:00.000Z",
  revoked_at: null,
  expires_at: null,
  metadata: {},
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("grantConsent", () => {
  it("inserts a consent record and returns it", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockConsentRecord] });
    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const input: GrantConsentInput = {
      subject_id: "user-789",
      purpose: "data_processing",
    };

    const result = await consentService.grantConsent(pool, "tenant-456", input);

    expect(result).toEqual(mockConsentRecord);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO consent_records");
    expect(sql).toContain("ON CONFLICT");
    expect(params[0]).toBe("tenant-456"); // tenant_id
    expect(params[1]).toBe("user-789"); // subject_id
    expect(params[2]).toBe("data_processing"); // purpose
  });

  it("passes expires_at and metadata when provided", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockConsentRecord] });
    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const input: GrantConsentInput = {
      subject_id: "user-789",
      purpose: "analytics",
      expires_at: "2025-12-31T23:59:59.000Z",
      metadata: { source: "web" },
    };

    await consentService.grantConsent(pool, "tenant-456", input);

    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBe("2025-12-31T23:59:59.000Z"); // expires_at
    expect(params[4]).toBe(JSON.stringify({ source: "web" })); // metadata
  });
});

describe("revokeConsent", () => {
  it("returns true when a record is revoked", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: "some-id" }] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await consentService.revokeConsent(pool, "tenant-456", "user-789", "data_processing");

    expect(result).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE consent_records");
    expect(sql).toContain("granted = false");
    expect(params).toEqual(["tenant-456", "user-789", "data_processing"]);
  });

  it("returns false when no record matches", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await consentService.revokeConsent(pool, "tenant-456", "user-789", "nonexistent");
    expect(result).toBe(false);
  });
});

describe("listConsent", () => {
  it("returns all consent records for a tenant", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockConsentRecord] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await consentService.listConsent(pool, "tenant-456");

    expect(result).toEqual([mockConsentRecord]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM consent_records");
    expect(params).toEqual(["tenant-456"]);
  });

  it("filters by subject_id when provided", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockConsentRecord] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await consentService.listConsent(pool, "tenant-456", "user-789");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("subject_id = $2");
    expect(params).toEqual(["tenant-456", "user-789"]);
  });
});
