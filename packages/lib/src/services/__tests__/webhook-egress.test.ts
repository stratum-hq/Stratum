import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// DNS is mocked so a test can hand out one answer to the validation lookup
// and a different one to the lookup the connection itself makes.
const dnsMock = vi.hoisted(() => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ default: dnsMock, ...dnsMock }));

vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("../webhook-service.js", () => ({
  getWebhooksForEvent: vi.fn(),
  decryptSecret: vi.fn().mockReturnValue("decrypted-test-secret"),
}));

import * as eventService from "../event-service.js";

const PUBLIC_IP = "93.184.216.34";

let server: http.Server;
let port: number;
let hits: number;

beforeEach(async () => {
  vi.clearAllMocks();
  hits = 0;
  server = http.createServer((_req, res) => {
    hits++;
    res.statusCode = 200;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function webhookFor(url: string) {
  return {
    id: "wh-1",
    tenant_id: "t-1",
    url,
    secret_hash: "v1:enc",
    events: ["tenant.created"],
    active: true,
    description: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const event = {
  id: "ev-1",
  type: "tenant.created",
  tenant_id: "t-1",
  data: {},
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("webhook delivery connects only to a validated address", () => {
  it("does not reach a loopback address when the name resolves differently at connect time", async () => {
    // First answer (what a separate validation lookup sees): public.
    dnsMock.resolve4.mockResolvedValue([PUBLIC_IP]);
    dnsMock.resolve6.mockRejectedValue(
      Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
    );
    // Second answer (what the connection sees): loopback.
    dnsMock.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    // *.localhost resolves to loopback through the system resolver too, so an
    // unpinned client that re-resolves the name on its own reaches the server.
    const result = await eventService.deliverWebhook(
      webhookFor(`http://rebind-check.localhost:${port}/hook`),
      event,
      "delivery-1",
    );

    expect(hits).toBe(0);
    expect(result.success).toBe(false);
  });
});

describe("webhook egress filter covers special-use ranges", () => {
  const mustReject: [string, string][] = [
    ["CGNAT shared address space", "http://100.64.0.1/hook"],
    ["CGNAT-hosted metadata address", "http://100.100.100.200/hook"],
    ["benchmarking range", "http://198.18.0.1/hook"],
    ["IETF protocol assignments", "http://192.0.0.1/hook"],
    [
      "NAT64 mapping of the metadata address",
      "http://[64:ff9b::a9fe:a9fe]/hook",
    ],
  ];
  for (const [label, url] of mustReject) {
    it(`rejects ${label}`, () => {
      expect(() => eventService.validateWebhookUrl(url)).toThrow();
    });
  }

  it("rejects a hostname that resolves into a special-use range", async () => {
    dnsMock.lookup.mockResolvedValue([
      { address: "100.100.100.200", family: 4 },
    ]);
    dnsMock.resolve4.mockResolvedValue(["100.100.100.200"]);
    dnsMock.resolve6.mockRejectedValue(new Error("ENODATA"));
    await expect(
      eventService.validateWebhookUrlWithDns(
        "https://cgnat-check.example/hook",
      ),
    ).rejects.toThrow();
  });
});
