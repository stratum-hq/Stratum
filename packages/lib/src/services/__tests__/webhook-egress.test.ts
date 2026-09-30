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

describe("webhook egress filter covers the remaining IANA special-purpose ranges", () => {
  const mustReject: [string, string][] = [
    // IPv4
    ["TEST-NET-1 (192.0.2.0/24)", "http://192.0.2.10/hook"],
    ["deprecated 6to4 relay anycast (192.88.99.0/24)", "http://192.88.99.1/hook"],
    ["AS112-v4 (192.31.196.0/24)", "http://192.31.196.1/hook"],
    ["AMT (192.52.193.0/24)", "http://192.52.193.1/hook"],
    ["direct delegation AS112 (192.175.48.0/24)", "http://192.175.48.1/hook"],
    ["TEST-NET-2 (198.51.100.0/24)", "http://198.51.100.7/hook"],
    ["TEST-NET-3 (203.0.113.0/24)", "http://203.0.113.200/hook"],
    ["multicast (224.0.0.0/4)", "http://224.0.0.1/hook"],
    ["multicast, top of range", "http://239.255.255.250/hook"],
    ["reserved (240.0.0.0/4)", "http://240.0.0.1/hook"],
    ["limited broadcast", "http://255.255.255.255/hook"],
    // IPv6
    ["local-use NAT64 (64:ff9b:1::/48)", "http://[64:ff9b:1::a9fe:a9fe]/hook"],
    ["discard-only (100::/64)", "http://[100::1]/hook"],
    ["dummy prefix (100:0:0:1::/64)", "http://[100:0:0:1::1]/hook"],
    ["IETF protocol assignments incl. Teredo (2001::/23)", "http://[2001:0:4136:e378::1]/hook"],
    ["benchmarking (2001:2::/48)", "http://[2001:2::1]/hook"],
    ["documentation (2001:db8::/32)", "http://[2001:db8::1]/hook"],
    ["6to4 (2002::/16)", "http://[2002:a9fe:a9fe::1]/hook"],
    ["AS112-v6 direct delegation (2620:4f:8000::/48)", "http://[2620:4f:8000::1]/hook"],
    ["documentation (3fff::/20)", "http://[3fff::1]/hook"],
    ["SRv6 SIDs (5f00::/16)", "http://[5f00::1]/hook"],
    ["deprecated IPv4-compatible (::/96)", "http://[::7f00:1]/hook"],
    ["deprecated site-local (fec0::/10)", "http://[fec0::1]/hook"],
    ["multicast (ff00::/8)", "http://[ff02::1]/hook"],
  ];
  for (const [label, url] of mustReject) {
    it(`rejects ${label}`, () => {
      expect(() => eventService.validateWebhookUrl(url)).toThrow();
    });
  }

  const mustAllow: [string, string][] = [
    ["a public address just below TEST-NET-1", "http://192.0.1.255/hook"],
    ["a public address just above TEST-NET-3", "http://203.0.114.1/hook"],
    ["the top public unicast address below multicast", "http://223.255.255.254/hook"],
    ["a global unicast IPv6 address", "http://[2606:4700::1111]/hook"],
  ];
  for (const [label, url] of mustAllow) {
    it(`accepts ${label}`, () => {
      expect(() => eventService.validateWebhookUrl(url)).not.toThrow();
    });
  }

  it("rejects a hostname that resolves into TEST-NET-2", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: "198.51.100.7", family: 4 }]);
    dnsMock.resolve4.mockResolvedValue(["198.51.100.7"]);
    dnsMock.resolve6.mockRejectedValue(new Error("ENODATA"));
    await expect(
      eventService.validateWebhookUrlWithDns("https://testnet-check.example/hook"),
    ).rejects.toThrow();
  });

  it("does not deliver to a hostname that resolves into 6to4 at connect time", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: "2002:7f00:1::1", family: 6 }]);
    const result = await eventService.deliverWebhook(
      webhookFor("https://sixtofour-check.example/hook"),
      event,
      "delivery-2",
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked IP/);
  });
});
