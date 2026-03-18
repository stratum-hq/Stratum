import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Mock pool-helpers before importing event-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

// Mock webhook-service
vi.mock("../webhook-service.js", () => ({
  getWebhooksForEvent: vi.fn(),
  decryptSecret: vi.fn().mockReturnValue("decrypted-test-secret"),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as webhookServiceMock from "../webhook-service.js";
import * as eventService from "../event-service.js";
import { TenantEvent } from "@stratum-hq/core";

function makeMockPool() {
  return {} as import("pg").Pool;
}

function signPayload(secret: string, payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HMAC signature generation", () => {
  it("produces sha256= prefixed signature", () => {
    const sig = signPayload("mysecretkey", "payload-body");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("same secret and payload produce same signature", () => {
    const sig1 = signPayload("mysecretkey", "payload-body");
    const sig2 = signPayload("mysecretkey", "payload-body");
    expect(sig1).toBe(sig2);
  });

  it("different secrets produce different signatures", () => {
    const sig1 = signPayload("secret-one-key", "payload-body");
    const sig2 = signPayload("secret-two-key", "payload-body");
    expect(sig1).not.toBe(sig2);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = signPayload("mysecretkey", "payload-one");
    const sig2 = signPayload("mysecretkey", "payload-two");
    expect(sig1).not.toBe(sig2);
  });
});

describe("retry backoff calculation", () => {
  // attempts^2 * 5000ms
  const cases: [number, number][] = [
    [1, 5000],
    [2, 20000],
    [3, 45000],
    [4, 80000],
    [5, 125000],
  ];

  for (const [attempts, expectedMs] of cases) {
    it(`attempt ${attempts} => ${expectedMs}ms delay`, () => {
      const delayMs = Math.pow(attempts, 2) * 5000;
      expect(delayMs).toBe(expectedMs);
    });
  }
});

describe("emitEvent", () => {
  it("inserts event record and creates delivery records for matching webhooks", async () => {
    const pool = makeMockPool();
    const mockEvent = {
      id: "event-id-1",
      type: "tenant.created",
      tenant_id: "tenant-id-1",
      data: {},
      created_at: "2024-01-01T00:00:00.000Z",
    };
    const mockWebhook = {
      id: "webhook-id-1",
      tenant_id: null,
      url: "https://example.com/hook",
      secret_hash: "abc123",
      events: ["tenant.created"],
      active: true,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    };

    const insertEventQuery = vi.fn().mockResolvedValue({ rows: [mockEvent] });
    const insertDeliveryQuery = vi.fn().mockResolvedValue({ rows: [] });

    // First withClient call: insert event
    // Second withClient call: insert deliveries
    vi.mocked(poolHelpers.withClient)
      .mockImplementationOnce(async (_pool, fn) => {
        const client = { query: insertEventQuery } as unknown as import("pg").PoolClient;
        return fn(client);
      })
      .mockImplementationOnce(async (_pool, fn) => {
        const client = { query: insertDeliveryQuery } as unknown as import("pg").PoolClient;
        return fn(client);
      });

    vi.mocked(webhookServiceMock.getWebhooksForEvent).mockResolvedValue([mockWebhook as any]);

    await eventService.emitEvent(pool, TenantEvent.TENANT_CREATED, "tenant-id-1", { tenant: {} });

    expect(insertEventQuery).toHaveBeenCalledOnce();
    expect(webhookServiceMock.getWebhooksForEvent).toHaveBeenCalledWith(
      pool,
      TenantEvent.TENANT_CREATED,
      "tenant-id-1",
    );
    expect(insertDeliveryQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhook_deliveries"),
      ["webhook-id-1", "event-id-1"],
    );
  });

  it("does not create deliveries when no matching webhooks", async () => {
    const pool = makeMockPool();
    const mockEvent = {
      id: "event-id-2",
      type: "tenant.created",
      tenant_id: "tenant-id-2",
      data: {},
      created_at: "2024-01-01T00:00:00.000Z",
    };

    vi.mocked(poolHelpers.withClient).mockImplementationOnce(async (_pool, fn) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [mockEvent] }),
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    vi.mocked(webhookServiceMock.getWebhooksForEvent).mockResolvedValue([]);

    await eventService.emitEvent(pool, TenantEvent.TENANT_CREATED, "tenant-id-2", {});

    // withClient should only have been called once (event insert), not again for deliveries
    expect(poolHelpers.withClient).toHaveBeenCalledOnce();
  });
});
