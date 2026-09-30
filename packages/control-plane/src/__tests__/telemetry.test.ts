import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { trace } from "@opentelemetry/api";
import type { Stratum } from "@stratum-hq/lib";
import { registerTelemetryHooks } from "../middleware/telemetry.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createAuthorizeMiddleware } from "../middleware/authorize.js";
import { createTenantScopeEnforcer } from "../middleware/tenant-scope.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createTenantRoutes } from "../routes/tenants.js";
import { createMockStratum, authHeaders, jwtHeaders, SAMPLE_TENANT } from "./test-helpers.js";

/** One span as the recording tracer saw it: its name and its final attributes. */
interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
  ended: boolean;
}

const spans: RecordedSpan[] = [];

// A minimal tracer provider that keeps every span in memory.
// It avoids a dependency on @opentelemetry/sdk-trace-base for one test file.
const recordingProvider = {
  getTracer() {
    return {
      startSpan(name: string, options?: { attributes?: Record<string, unknown> }) {
        const recorded: RecordedSpan = { name, attributes: { ...options?.attributes }, ended: false };
        spans.push(recorded);
        const span = {
          setAttribute(key: string, value: unknown) {
            recorded.attributes[key] = value;
            return span;
          },
          setStatus() {
            return span;
          },
          recordException() {},
          end() {
            recorded.ended = true;
          },
        };
        return span;
      },
    };
  },
};

let stratum: Stratum;
let app: FastifyInstance;

beforeAll(async () => {
  trace.setGlobalTracerProvider(recordingProvider as never);

  stratum = createMockStratum();
  app = Fastify({ logger: false });
  // Same hook order as buildApp: telemetry first, then the auth preHandlers.
  registerTelemetryHooks(app);
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());
  app.addHook("preHandler", createTenantScopeEnforcer(stratum));
  app.setErrorHandler(errorHandler);
  await app.register(createTenantRoutes(stratum), { prefix: "/api/v1/tenants" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  trace.disable();
});

beforeEach(() => {
  spans.length = 0;
  vi.mocked(stratum.getTenant).mockResolvedValue(SAMPLE_TENANT as never);
});

const url = `/api/v1/tenants/${SAMPLE_TENANT.id}?cursor=opaque-cursor-value`;

describe("telemetry span attributes", () => {
  it("sets stratum.tenant_id on the span of a request authenticated with an API key", async () => {
    vi.mocked(stratum.validateApiKey).mockResolvedValue({
      key_id: "tenant-key-id",
      tenant_id: SAMPLE_TENANT.id,
      scopes: ["read"],
      rate_limit_max: null,
      rate_limit_window: null,
    } as never);

    const res = await app.inject({ method: "GET", url, headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    expect(spans).toHaveLength(1);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].attributes["stratum.tenant_id"]).toBe(SAMPLE_TENANT.id);
  });

  it("sets stratum.tenant_id on the span of a request authenticated with a JWT", async () => {
    const res = await app.inject({ method: "GET", url, headers: jwtHeaders({ scopes: ["read"] }) });

    expect(res.statusCode).toBe(200);
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes["stratum.tenant_id"]).toBe(SAMPLE_TENANT.id);
  });

  it("omits stratum.tenant_id when authentication fails", async () => {
    const res = await app.inject({ method: "GET", url });

    expect(res.statusCode).toBe(401);
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes).not.toHaveProperty("stratum.tenant_id");
  });

  it("records no query string in the span name or its URL attributes", async () => {
    vi.mocked(stratum.validateApiKey).mockResolvedValue({
      key_id: "tenant-key-id",
      tenant_id: SAMPLE_TENANT.id,
      scopes: ["read"],
      rate_limit_max: null,
      rate_limit_window: null,
    } as never);

    await app.inject({ method: "GET", url, headers: authHeaders() });

    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("HTTP GET /api/v1/tenants/:id");
    expect(spans[0].attributes["http.route"]).toBe("/api/v1/tenants/:id");
    expect(spans[0].attributes["http.url"]).toBe(`/api/v1/tenants/${SAMPLE_TENANT.id}`);
  });

  it("records no query string for a request that matches no route", async () => {
    await app.inject({ method: "GET", url: "/api/v1/unknown?cursor=opaque-cursor-value" });

    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("HTTP GET /api/v1/unknown");
    expect(spans[0].attributes["http.route"]).toBe("/api/v1/unknown");
    expect(spans[0].attributes["http.url"]).toBe("/api/v1/unknown");
  });
});
