import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { Stratum, verifyWebhookSignature } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// DNS is stubbed so a test controls what a webhook host resolves to. The
// validation lookups (resolve4/resolve6) and the connect-time lookup can be
// given different answers. The shared node:dns/promises module object is
// spied on because @stratum-hq/lib is loaded from its build output.
type LookupResult = { address: string; family: number }[];
let lookupAnswer: LookupResult;

const PUBLIC_IP = "93.184.216.34";
const SECRET = "test-delivery-secret";

/**
 * Stratum.testWebhook against real Postgres: it reads the stored (encrypted)
 * secret, signs a test event with it, and sends it over the same pinned
 * delivery path as automatic delivery.
 */
describe("Stratum.testWebhook (integration)", () => {
  let stratum: Stratum;
  let server: http.Server;
  let port: number;
  let hits: number;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  beforeEach(async () => {
    lookupAnswer = [{ address: PUBLIC_IP, family: 4 }];
    vi.spyOn(dns, "resolve4").mockResolvedValue([PUBLIC_IP]);
    vi.spyOn(dns, "resolve6").mockRejectedValue(
      Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
    );
    vi.spyOn(dns, "lookup").mockImplementation((async () => lookupAnswer) as unknown as typeof dns.lookup);
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
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  async function makeWebhook(url: string) {
    const tenant = await stratum.createTenant({ name: "T", slug: uniqueSlug("twh") });
    return stratum.createWebhook({
      tenant_id: tenant.id,
      url,
      secret: SECRET,
      events: ["tenant.created"],
    });
  }

  it("signs a test event with the webhook secret and returns the endpoint status", async () => {
    const webhook = await makeWebhook("https://hooks.example.test/receive");

    // Capture the outbound request at the transport and answer it locally, so
    // no real network is used. The address it would connect to comes from the
    // lookup the request is given.
    const sent: { headers: Record<string, string>; body: string; address?: string }[] = [];
    const fakeRequest = ((
      _url: URL,
      options: http.RequestOptions,
      onResponse: (res: EventEmitter & { statusCode: number; resume(): void }) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & { end(body: string): void };
      req.end = (body: string) => {
        const entry: (typeof sent)[number] = {
          headers: options.headers as Record<string, string>,
          body,
        };
        options.lookup?.("hooks.example.test", {}, (_err, address) => {
          entry.address = address as string;
        });
        sent.push(entry);
        const res = Object.assign(new EventEmitter(), { statusCode: 204, resume() {} });
        setImmediate(() => onResponse(res));
      };
      return req;
    }) as unknown as typeof http.request;
    vi.spyOn(https, "request").mockImplementation(fakeRequest);

    const result = await stratum.testWebhook(webhook.id);

    expect(result).toMatchObject({ success: true, response_code: 204 });
    expect(sent).toHaveLength(1);
    expect(sent[0].address).toBe(PUBLIC_IP);
    expect(sent[0].headers["X-Stratum-Event"]).toBe("webhook.test");
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: sent[0].headers["X-Stratum-Timestamp"],
        payload: sent[0].body,
        signature: sent[0].headers["X-Stratum-Signature"],
      }),
    ).toBe(true);
  });

  it("does not reach a loopback address when the name resolves differently at connect time", async () => {
    // Validation sees a public address; the connect-time lookup returns loopback.
    // *.localhost also resolves to loopback through the system resolver, so a
    // client that re-resolves the name on its own reaches the local server.
    lookupAnswer = [{ address: "127.0.0.1", family: 4 }];
    const webhook = await makeWebhook(`http://rebind-check.localhost:${port}/hook`);

    const result = await stratum.testWebhook(webhook.id);

    expect(hits).toBe(0);
    expect(result.success).toBe(false);
  });
});
