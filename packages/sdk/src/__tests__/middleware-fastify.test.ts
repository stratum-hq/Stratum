import { describe, it, expect, vi, beforeEach } from "vitest";
import { fastifyPlugin } from "../middleware/fastify.js";
import type { TenantContext } from "@stratum-hq/core";
import { TenantNotFoundError } from "@stratum-hq/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTenantContext(tenantId: string): TenantContext {
  return {
    tenant_id: tenantId,
    ancestry_path: `/${tenantId}`,
    depth: 1,
    resolved_config: {},
    resolved_permissions: {},
    isolation_strategy: "SHARED_RLS",
  };
}

function makeRequest(headers: Record<string, string> = {}) {
  return {
    headers: { ...headers },
    tenant: undefined as TenantContext | undefined,
  };
}

function makeReply() {
  const reply: Record<string, unknown> = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

function makeClient(overrides: Partial<{ resolveTenant: ReturnType<typeof vi.fn> }> = {}) {
  return {
    resolveTenant:
      overrides.resolveTenant ?? vi.fn().mockResolvedValue(makeTenantContext("default-tenant")),
  } as unknown as import("../client.js").StratumClient;
}

/**
 * Helper to register the fastify plugin and extract the onRequest hook.
 * Returns the hook function so we can call it directly in tests.
 */
function registerPlugin(
  client: ReturnType<typeof makeClient>,
  middlewareOptions: Record<string, unknown> = {},
) {
  let capturedHook: ((request: unknown, reply: unknown, done: unknown) => void) | null = null;

  const fastify = {
    decorateRequest: vi.fn(),
    addHook: vi.fn((hookName: string, fn: (...args: unknown[]) => void) => {
      if (hookName === "onRequest") {
        capturedHook = fn;
      }
    }),
  };

  const pluginDone = vi.fn();
  fastifyPlugin(fastify, { client, ...middlewareOptions }, pluginDone);

  expect(pluginDone).toHaveBeenCalled();
  expect(capturedHook).not.toBeNull();

  return {
    hook: capturedHook!,
    fastify,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fastifyPlugin", () => {
  describe("plugin registration", () => {
    it("decorates request with tenant property", () => {
      const client = makeClient();
      const { fastify } = registerPlugin(client);

      expect(fastify.decorateRequest).toHaveBeenCalledWith("tenant", null);
    });

    it("registers an onRequest hook", () => {
      const client = makeClient();
      const { fastify } = registerPlugin(client);

      expect(fastify.addHook).toHaveBeenCalledWith(
        "onRequest",
        expect.any(Function),
      );
    });

    it("calls done() to signal plugin registration is complete", () => {
      const client = makeClient();
      const fastify = {
        decorateRequest: vi.fn(),
        addHook: vi.fn(),
      };
      const done = vi.fn();

      fastifyPlugin(fastify, { client }, done);

      expect(done).toHaveBeenCalledTimes(1);
    });
  });

  describe("tenant resolution from header", () => {
    it("sets request.tenant from X-Tenant-ID header", async () => {
      const ctx = makeTenantContext("tenant-fast");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const { hook } = registerPlugin(client);
      const request = makeRequest({ "x-tenant-id": "tenant-fast" });
      const reply = makeReply();
      const done = vi.fn();

      // The hook is async internally; it calls done() when complete
      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        hook(request, reply, done);
      });

      expect(request.tenant).toEqual(ctx);
      expect(client.resolveTenant).toHaveBeenCalledWith("tenant-fast");
    });

    it("calls done() on successful resolution", async () => {
      const ctx = makeTenantContext("t-1");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const { hook } = registerPlugin(client);
      const request = makeRequest({ "x-tenant-id": "t-1" });
      const reply = makeReply();
      const done = vi.fn();

      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        hook(request, reply, done);
      });

      expect(done).toHaveBeenCalled();
    });
  });

  describe("missing tenant", () => {
    it("returns 400 when no tenant ID can be resolved", async () => {
      const client = makeClient();
      const { hook } = registerPlugin(client);
      const request = makeRequest(); // No header
      const reply = makeReply();
      const done = vi.fn();

      // The hook resolves asynchronously. When tenant is missing, it calls
      // reply.status(400).send(...) and the done callback is not called with
      // the context. We need to wait for the async operation.
      await new Promise<void>((resolve) => {
        // Override send to resolve the promise
        (reply.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
          resolve();
          return reply;
        });
        hook(request, reply, done);
      });

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "MISSING_TENANT",
          }),
        }),
      );
    });

    it("does not set request.tenant when no tenant is resolved", async () => {
      const client = makeClient();
      const { hook } = registerPlugin(client);
      const request = makeRequest();
      const reply = makeReply();
      const done = vi.fn();

      await new Promise<void>((resolve) => {
        (reply.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
          resolve();
          return reply;
        });
        hook(request, reply, done);
      });

      expect(request.tenant).toBeUndefined();
    });
  });

  describe("tenant not found", () => {
    it("returns 404 when resolveTenant throws TenantNotFoundError", async () => {
      const client = makeClient({
        resolveTenant: vi.fn().mockRejectedValue(new TenantNotFoundError("t-missing")),
      });
      const { hook } = registerPlugin(client);
      const request = makeRequest({ "x-tenant-id": "t-missing" });
      const reply = makeReply();
      const done = vi.fn();

      await new Promise<void>((resolve) => {
        (reply.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
          resolve();
          return reply;
        });
        hook(request, reply, done);
      });

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "TENANT_NOT_FOUND",
          }),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("passes unexpected errors to done() for Fastify error handling", async () => {
      const error = new Error("unexpected failure");
      const client = makeClient({
        resolveTenant: vi.fn().mockRejectedValue(error),
      });
      const { hook } = registerPlugin(client);
      const request = makeRequest({ "x-tenant-id": "t-1" });
      const reply = makeReply();
      const done = vi.fn();

      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        hook(request, reply, done);
      });

      // The .catch(done) in the plugin passes the error to done
      expect(done).toHaveBeenCalledWith(error);
    });

    it("calls onError callback when provided and unexpected error occurs", async () => {
      const error = new Error("unexpected");
      const onError = vi.fn();
      const client = makeClient({
        resolveTenant: vi.fn().mockRejectedValue(error),
      });
      const { hook } = registerPlugin(client, { onError });
      const request = makeRequest({ "x-tenant-id": "t-1" });
      const reply = makeReply();
      const done = vi.fn();

      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        hook(request, reply, done);
      });

      expect(onError).toHaveBeenCalledWith(error, request);
    });
  });

  describe("custom resolvers", () => {
    it("uses custom resolver when header resolution fails", async () => {
      const ctx = makeTenantContext("custom-fastify");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const customResolver = {
        resolve: vi.fn().mockResolvedValue("custom-fastify"),
      };
      const { hook } = registerPlugin(client, {
        resolvers: [customResolver],
      });
      const request = makeRequest(); // No header
      const reply = makeReply();
      const done = vi.fn();

      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        hook(request, reply, done);
      });

      expect(customResolver.resolve).toHaveBeenCalledWith(request);
      expect(request.tenant).toEqual(ctx);
    });

    it("stops at the first resolver that returns a value", async () => {
      const ctx = makeTenantContext("first-fast");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const resolver1 = {
        resolve: vi.fn().mockResolvedValue("first-fast"),
      };
      const resolver2 = {
        resolve: vi.fn().mockResolvedValue("second-fast"),
      };
      const { hook } = registerPlugin(client, {
        resolvers: [resolver1, resolver2],
      });
      const request = makeRequest();
      const reply = makeReply();
      const done = vi.fn();

      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        hook(request, reply, done);
      });

      expect(resolver1.resolve).toHaveBeenCalled();
      expect(resolver2.resolve).not.toHaveBeenCalled();
    });
  });
});
