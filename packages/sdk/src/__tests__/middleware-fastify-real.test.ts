import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { fastifyPlugin } from "../middleware/fastify.js";
import { getTenantContext } from "../context.js";
import { stratum } from "../index.js";
import type { StratumClient } from "../client.js";

const TENANT = "33333333-3333-4333-8333-333333333333";

function ctx(tenantId: string): ResolvedTenantContext {
  return {
    tenant_id: tenantId,
    ancestry_path: `/${tenantId}`,
    depth: 0,
    resolved_config: {},
    resolved_permissions: {},
    isolation_strategy: "SHARED_RLS",
  };
}

function mockClient() {
  return { resolveTenant: vi.fn(async (id: string) => ctx(id)) } as unknown as StratumClient;
}

function tenantOf(request: unknown): string | undefined {
  return (request as { tenant?: ResolvedTenantContext | null }).tenant?.tenant_id;
}

describe("fastifyPlugin on a real Fastify instance", () => {
  it("runs the tenant hook for routes declared on the instance that registered the plugin", async () => {
    const app = Fastify();
    await app.register(fastifyPlugin, { client: mockClient() });
    app.get("/data", async (request) => ({ tenant_id: tenantOf(request) ?? null }));

    const ok = await app.inject({ method: "GET", url: "/data", headers: { "x-tenant-id": TENANT } });
    expect(ok.json()).toEqual({ tenant_id: TENANT });

    const missing = await app.inject({ method: "GET", url: "/data" });
    expect(missing.statusCode).toBe(400);
    await app.close();
  });

  it("runs the tenant hook for routes on the root when registered through stratum().plugin()", async () => {
    const sdk = stratum({ controlPlaneUrl: "http://cp.invalid", apiKey: "k" });
    vi.spyOn(sdk.client, "resolveTenant").mockImplementation(async (id: string) => ctx(id));
    const app = Fastify();
    await app.register(sdk.plugin());
    app.get("/data", async (request) => ({ tenant_id: tenantOf(request) ?? null }));

    const res = await app.inject({ method: "GET", url: "/data", headers: { "x-tenant-id": TENANT } });
    expect(res.json()).toEqual({ tenant_id: TENANT });
    await app.close();
  });

  it("keeps the ALS tenant context in handlers for requests with a JSON body", async () => {
    const app = Fastify();
    // Attach directly to the root instance so this test does not depend on
    // plugin encapsulation.
    await new Promise<void>((resolve, reject) =>
      fastifyPlugin(app as unknown as Parameters<typeof fastifyPlugin>[0], { client: mockClient() }, (err?: unknown) =>
        err ? reject(err) : resolve(),
      ),
    );
    const seen: Record<string, string | null> = {};
    const handler = (label: string) => async () => {
      try {
        seen[label] = getTenantContext().tenant_id;
      } catch {
        seen[label] = null;
      }
      return { ok: true };
    };
    app.get("/get", handler("get"));
    app.post("/post", handler("post"));
    app.put("/put", handler("put"));

    const headers = { "x-tenant-id": TENANT, "content-type": "application/json" };
    await app.inject({ method: "GET", url: "/get", headers: { "x-tenant-id": TENANT } });
    await app.inject({ method: "POST", url: "/post", headers, payload: JSON.stringify({ a: 1 }) });
    await app.inject({ method: "PUT", url: "/put", headers, payload: JSON.stringify({ a: 1 }) });
    await app.close();

    expect(seen).toEqual({ get: TENANT, post: TENANT, put: TENANT });
  });

  it("keeps the ALS tenant context when the request body arrives after the tenant hook has finished", async () => {
    const app = Fastify();
    await new Promise<void>((resolve, reject) =>
      fastifyPlugin(app as unknown as Parameters<typeof fastifyPlugin>[0], { client: mockClient() }, (err?: unknown) =>
        err ? reject(err) : resolve(),
      ),
    );
    let hookFinished!: () => void;
    const hookDone = new Promise<void>((r) => (hookFinished = r));
    app.addHook("onRequest", (_req, _reply, done) => {
      hookFinished();
      done();
    });
    app.post("/post", async () => {
      try {
        return { tenant_id: getTenantContext().tenant_id };
      } catch {
        return { tenant_id: null };
      }
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as import("node:net").AddressInfo;
    try {
      const http = await import("node:http");
      const body = JSON.stringify({ a: 1 });
      const tenantId = await new Promise<unknown>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: "/post",
            headers: { "x-tenant-id": TENANT, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve((JSON.parse(data) as { tenant_id: unknown }).tenant_id));
          },
        );
        req.on("error", reject);
        req.flushHeaders();
        void hookDone.then(() => setTimeout(() => req.end(body), 50));
      });
      expect(tenantId).toBe(TENANT);
    } finally {
      await app.close();
    }
  });
});
