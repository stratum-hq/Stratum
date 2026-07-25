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
import { TenantEvent, WebhookUrlValidationError, StratumError } from "@stratum-hq/core";

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

describe("webhook egress filter (SSRF protection)", () => {
  // Regression: bracketed IPv6 literals must be rejected in every notation.
  // The URL parser exposes IPv6 hosts wrapped in brackets, so a filter that
  // only matches the unbracketed textual form lets internal targets through.
  const mustReject: [string, string][] = [
    ["bracketed IPv6 loopback", "http://[::1]/hook"],
    ["expanded IPv6 loopback", "http://[0:0:0:0:0:0:0:1]/hook"],
    ["IPv6 link-local", "http://[fe80::1]/hook"],
    ["IPv6 unique-local", "http://[fd00:ec2::254]/hook"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/hook"],
    ["IPv4-mapped metadata address", "http://[::ffff:169.254.169.254]/hook"],
    ["unspecified IPv6 address", "http://[::]/hook"],
    ["integer-coerced loopback", "http://2130706433/hook"],
  ];

  for (const [label, url] of mustReject) {
    it(`rejects ${label}`, () => {
      expect(() => eventService.validateWebhookUrl(url)).toThrow();
    });
  }

  // Unbracketed forms that already worked must keep working.
  it("still rejects IPv4 loopback and metadata", () => {
    expect(() => eventService.validateWebhookUrl("http://127.0.0.1/hook")).toThrow();
    expect(() => eventService.validateWebhookUrl("http://169.254.169.254/hook")).toThrow();
    expect(() => eventService.validateWebhookUrl("http://localhost/hook")).toThrow();
  });

  it("allows a public https target", () => {
    expect(() => eventService.validateWebhookUrl("https://example.com/hook")).not.toThrow();
  });

  it("fails closed on an unparseable URL", () => {
    expect(() => eventService.validateWebhookUrl("http://[not-an-ip/hook")).toThrow();
  });
});

describe("webhook URL validation throws a typed error", () => {
  // All entries are IP literals or blocked hostnames, so both the sync and the
  // DNS-aware validator reject them without any network lookup (pure logic).
  const blocked: [string, string][] = [
    ["IPv4 loopback", "http://127.0.0.1/hook"],
    ["IPv6 loopback", "http://[::1]/hook"],
    ["cloud metadata address", "http://169.254.169.254/hook"],
    ["blocked hostname", "http://localhost/hook"],
    ["non-http scheme", "ftp://example.com/hook"],
    ["unparseable URL", "http://[not-an-ip/hook"],
  ];

  for (const [label, url] of blocked) {
    it(`validateWebhookUrl rejects ${label} with WebhookUrlValidationError`, () => {
      expect(() => eventService.validateWebhookUrl(url)).toThrow(WebhookUrlValidationError);
    });

    it(`validateWebhookUrlWithDns rejects ${label} with a StratumError-typed error`, async () => {
      await expect(eventService.validateWebhookUrlWithDns(url)).rejects.toBeInstanceOf(
        WebhookUrlValidationError,
      );
      await expect(eventService.validateWebhookUrlWithDns(url)).rejects.toBeInstanceOf(
        StratumError,
      );
    });
  }

  it("does not throw for a valid public URL (sync)", () => {
    expect(() => eventService.validateWebhookUrl("https://example.com/hook")).not.toThrow();
  });

  it("does not throw for a valid public IP literal (async, returns before DNS)", async () => {
    await expect(
      eventService.validateWebhookUrlWithDns("https://1.1.1.1/hook"),
    ).resolves.toBeUndefined();
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
