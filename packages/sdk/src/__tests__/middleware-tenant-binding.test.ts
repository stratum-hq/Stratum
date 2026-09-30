import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import Module from "node:module";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { expressMiddleware } from "../middleware/express.js";
import { fastifyPlugin } from "../middleware/fastify.js";
import type { MiddlewareOptions } from "../types.js";
import type { StratumClient } from "../client.js";

const SECRET = "tenant-binding-test-secret";
const JWT_TENANT = "11111111-1111-4111-8111-111111111111";
const HEADER_TENANT = "22222222-2222-4222-8222-222222222222";

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

function signHs256(payload: Record<string, unknown>, secret = SECRET): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iat: Math.floor(Date.now() / 1000), ...payload })}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function makeClient() {
  const resolveTenant = vi.fn(async (id: string) => ctx(id));
  return { client: { resolveTenant } as unknown as StratumClient, resolveTenant };
}

interface Outcome {
  status: number;
  body?: unknown;
  resolvedIds: string[];
}

type Harness = {
  name: string;
  run(options: MiddlewareOptions, headers: Record<string, string>): Promise<Outcome>;
  construct(options: MiddlewareOptions): Promise<void>;
};

const expressHarness: Harness = {
  name: "expressMiddleware",
  async run(options, headers) {
    const { client, resolveTenant } = makeClient();
    const mw = expressMiddleware(client, options);
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) {
        status = code;
        return { json: (b: unknown) => { body = b; } };
      },
    };
    const req: { headers: Record<string, string>; tenant?: unknown } = { headers };
    let nextErr: unknown;
    await mw(req, res, (err?: unknown) => { nextErr = err; });
    if (nextErr) status = 500;
    return { status, body, resolvedIds: resolveTenant.mock.calls.map((c) => c[0]) };
  },
  async construct(options) {
    expressMiddleware(makeClient().client, options);
  },
};

const fastifyHarness: Harness = {
  name: "fastifyPlugin",
  async run(options, headers) {
    const { client, resolveTenant } = makeClient();
    const app = Fastify();
    // Attach directly to the root instance so these tests do not depend on
    // how the plugin is encapsulated.
    await new Promise<void>((resolve, reject) =>
      fastifyPlugin(app as unknown as Parameters<typeof fastifyPlugin>[0], { client, ...options }, (err?: unknown) =>
        err ? reject(err) : resolve(),
      ),
    );
    app.get("/", async (request) => ({ tenant_id: (request as unknown as { tenant: ResolvedTenantContext }).tenant.tenant_id }));
    const res = await app.inject({ method: "GET", url: "/", headers });
    await app.close();
    return { status: res.statusCode, body: res.json(), resolvedIds: resolveTenant.mock.calls.map((c) => c[0]) };
  },
  async construct(options) {
    const app = Fastify();
    try {
      await new Promise<void>((resolve, reject) =>
        fastifyPlugin(
          app as unknown as Parameters<typeof fastifyPlugin>[0],
          { client: makeClient().client, ...options },
          (err?: unknown) => (err ? reject(err) : resolve()),
        ),
      );
    } finally {
      await app.close();
    }
  },
};

describe.each([expressHarness, fastifyHarness])("$name tenant binding", (h) => {
  describe("when JWT verification is configured", () => {
    it("rejects an invalid bearer token with 401 instead of falling back to X-Tenant-ID", async () => {
      const out = await h.run(
        { jwtSecret: SECRET },
        { authorization: "Bearer not-a-real-token", "x-tenant-id": HEADER_TENANT },
      );
      expect(out.status).toBe(401);
      expect(out.resolvedIds).toEqual([]);
    });

    it("rejects a token signed with the wrong secret with 401", async () => {
      const out = await h.run(
        { jwtSecret: SECRET },
        { authorization: `Bearer ${signHs256({ tenant_id: JWT_TENANT }, "other")}`, "x-tenant-id": HEADER_TENANT },
      );
      expect(out.status).toBe(401);
      expect(out.resolvedIds).toEqual([]);
    });

    it("rejects a token that jwtVerify refuses with 401", async () => {
      const out = await h.run(
        { jwtVerify: () => null },
        { authorization: "Bearer anything", "x-tenant-id": HEADER_TENANT },
      );
      expect(out.status).toBe(401);
      expect(out.resolvedIds).toEqual([]);
    });

    it("does not bind the X-Tenant-ID header when no token is sent", async () => {
      const out = await h.run({ jwtSecret: SECRET }, { "x-tenant-id": HEADER_TENANT });
      expect(out.status).toBe(400);
      expect(out.resolvedIds).toEqual([]);
    });

    it("binds the tenant from a validly signed HS256 token", async () => {
      const out = await h.run(
        { jwtSecret: SECRET },
        { authorization: `Bearer ${signHs256({ tenant_id: JWT_TENANT })}`, "x-tenant-id": HEADER_TENANT },
      );
      expect(out.status).toBe(200);
      expect(out.resolvedIds).toEqual([JWT_TENANT]);
    });

    it("uses X-Tenant-ID without a token only when trustTenantHeader is true", async () => {
      const out = await h.run({ jwtSecret: SECRET, trustTenantHeader: true }, { "x-tenant-id": HEADER_TENANT });
      expect(out.status).toBe(200);
      expect(out.resolvedIds).toEqual([HEADER_TENANT]);
    });
  });

  describe("jwtAudience and jwtIssuer", () => {
    const AUD = "my-app";
    const ISS = "https://issuer.example";

    it("binds the tenant when the token's audience and issuer match", async () => {
      const out = await h.run(
        { jwtSecret: SECRET, jwtAudience: AUD, jwtIssuer: ISS },
        { authorization: `Bearer ${signHs256({ tenant_id: JWT_TENANT, aud: AUD, iss: ISS })}` },
      );
      expect(out.status).toBe(200);
      expect(out.resolvedIds).toEqual([JWT_TENANT]);
    });

    it("accepts a token whose audience list includes jwtAudience", async () => {
      const out = await h.run(
        { jwtSecret: SECRET, jwtAudience: AUD },
        { authorization: `Bearer ${signHs256({ tenant_id: JWT_TENANT, aud: ["other", AUD] })}` },
      );
      expect(out.status).toBe(200);
      expect(out.resolvedIds).toEqual([JWT_TENANT]);
    });

    it("rejects a token minted for another audience with 401", async () => {
      const out = await h.run(
        { jwtSecret: SECRET, jwtAudience: AUD },
        { authorization: `Bearer ${signHs256({ tenant_id: JWT_TENANT, aud: "other-app" })}` },
      );
      expect(out.status).toBe(401);
      expect(out.resolvedIds).toEqual([]);
    });

    it("rejects a token without an audience when jwtAudience is set", async () => {
      const out = await h.run(
        { jwtSecret: SECRET, jwtAudience: AUD },
        { authorization: `Bearer ${signHs256({ tenant_id: JWT_TENANT })}` },
      );
      expect(out.status).toBe(401);
      expect(out.resolvedIds).toEqual([]);
    });

    it("rejects a token from another issuer with 401", async () => {
      const out = await h.run(
        { jwtSecret: SECRET, jwtIssuer: ISS },
        { authorization: `Bearer ${signHs256({ tenant_id: JWT_TENANT, iss: "https://elsewhere.example" })}` },
      );
      expect(out.status).toBe(401);
      expect(out.resolvedIds).toEqual([]);
    });

    it("enforces jwtAudience on claims returned by jwtVerify", async () => {
      const out = await h.run(
        { jwtVerify: () => ({ tenant_id: JWT_TENANT, aud: "other-app" }), jwtAudience: AUD },
        { authorization: "Bearer anything" },
      );
      expect(out.status).toBe(401);
      expect(out.resolvedIds).toEqual([]);
    });
  });

  describe("headerName", () => {
    it("reads only the configured header and ignores X-Tenant-ID", async () => {
      const out = await h.run({ headerName: "X-Internal-Tenant" }, { "x-tenant-id": HEADER_TENANT });
      expect(out.status).toBe(400);
      expect(out.resolvedIds).toEqual([]);
    });

    it("resolves the tenant from the configured header", async () => {
      const out = await h.run(
        { headerName: "X-Internal-Tenant" },
        { "x-internal-tenant": JWT_TENANT, "x-tenant-id": HEADER_TENANT },
      );
      expect(out.status).toBe(200);
      expect(out.resolvedIds).toEqual([JWT_TENANT]);
    });
  });

  describe("jsonwebtoken availability", () => {
    type LoadFn = (request: string, ...rest: unknown[]) => unknown;
    const M = Module as unknown as { _load: LoadFn };
    const original = M._load;

    afterEach(() => {
      M._load = original;
    });

    function hideJsonwebtoken() {
      M._load = function (this: unknown, request: string, ...rest: unknown[]) {
        if (request === "jsonwebtoken") {
          const err = new Error("Cannot find module 'jsonwebtoken'") as Error & { code: string };
          err.code = "MODULE_NOT_FOUND";
          throw err;
        }
        return original.call(this, request, ...rest);
      } as LoadFn;
    }

    it("fails at construction when jwtSecret is set and jsonwebtoken cannot be loaded", async () => {
      hideJsonwebtoken();
      await expect(h.construct({ jwtSecret: SECRET })).rejects.toThrow(/jsonwebtoken/);
    });

    it("constructs without jsonwebtoken when jwtVerify is supplied", async () => {
      hideJsonwebtoken();
      await expect(h.construct({ jwtSecret: SECRET, jwtVerify: () => null })).resolves.toBeUndefined();
    });
  });
});

describe("@stratum-hq/sdk package manifest", () => {
  it("declares jsonwebtoken as an optional peer dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    expect(pkg.peerDependencies?.["jsonwebtoken"]).toBeDefined();
    expect(pkg.peerDependenciesMeta?.["jsonwebtoken"]?.optional).toBe(true);
  });
});
