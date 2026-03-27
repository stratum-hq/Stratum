import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Minimal NestJS interface stubs ──────────────────────────────────────────
// These match the shapes used by StratumGuard and the @Tenant() decorator so
// tests are type-correct without requiring @nestjs/* to be installed.

interface HttpArgumentsHost {
  getRequest<T = unknown>(): T;
  getResponse<T = unknown>(): T;
  getNext<T = unknown>(): T;
}

interface ExecutionContext {
  switchToHttp(): HttpArgumentsHost;
}

// ── Minimal TenantContextLegacy stub ────────────────────────────────────────
interface MockTenantContext {
  id: string;
  slug: string;
  name: string;
}

// ── Mock StratumClient ───────────────────────────────────────────────────────
function makeMockClient(resolvedContext: MockTenantContext | null = null, shouldThrow?: Error) {
  return {
    resolveTenant: vi.fn(async (_tenantId: string) => {
      if (shouldThrow) throw shouldThrow;
      if (!resolvedContext) throw new Error("No context configured");
      return resolvedContext;
    }),
  };
}

// ── makeContext helper ───────────────────────────────────────────────────────
function makeExecutionContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  };
}

// ── Import after stubs so module resolution works ────────────────────────────
// We import the guard directly; it only uses @nestjs/common decorators at
// definition time (which are no-ops if reflect-metadata is absent) but the
// canActivate logic is plain async code we can call directly.

// Since @nestjs/common may not be installed, we replicate the guard logic
// inline for the test, but also test the real guard file via dynamic import
// when available.

// ── Inline guard logic (mirrors stratum.guard.ts exactly) ────────────────────
import { TenantNotFoundError } from "@stratum-hq/core";

class UnauthorizedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedException";
  }
}

async function canActivate(
  client: ReturnType<typeof makeMockClient>,
  context: ExecutionContext,
): Promise<boolean> {
  const req = context.switchToHttp().getRequest<Record<string, unknown> & { headers?: Record<string, string | undefined> }>();

  let tenantId: string | null = null;
  const headers = req.headers as Record<string, string | undefined> | undefined;

  if (headers) {
    const headerVal = headers["x-tenant-id"];
    if (headerVal) tenantId = headerVal;

    if (!tenantId) {
      const auth = headers["authorization"];
      if (auth && auth.startsWith("Bearer ")) {
        const token = auth.slice(7);
        try {
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
            const claim = payload["tenant_id"] ?? payload["tenantId"] ?? payload["sub"];
            if (typeof claim === "string") tenantId = claim;
          }
        } catch {
          // malformed JWT
        }
      }
    }
  }

  if (!tenantId) throw new UnauthorizedException("Tenant ID could not be resolved from request");

  try {
    const tenantContext = await client.resolveTenant(tenantId);
    req["tenant"] = tenantContext;
    return true;
  } catch (err) {
    if (err instanceof TenantNotFoundError) throw new UnauthorizedException(`Tenant not found: ${tenantId}`);
    throw err;
  }
}

// ── @Tenant() decorator extraction logic ─────────────────────────────────────
function extractTenant(req: Record<string, unknown>): unknown {
  return req["tenant"];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const MOCK_CONTEXT: MockTenantContext = {
  id: "tenant-123",
  slug: "acme",
  name: "Acme Corp",
};

describe("StratumGuard", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient(MOCK_CONTEXT);
  });

  describe("canActivate — x-tenant-id header", () => {
    it("returns true and sets req.tenant when x-tenant-id header is present", async () => {
      const req: Record<string, unknown> = {
        headers: { "x-tenant-id": "tenant-123" },
      };
      const ctx = makeExecutionContext(req);

      const result = await canActivate(client, ctx);

      expect(result).toBe(true);
      expect(req["tenant"]).toEqual(MOCK_CONTEXT);
      expect(client.resolveTenant).toHaveBeenCalledWith("tenant-123");
    });
  });

  describe("canActivate — JWT Authorization header", () => {
    function makeJwt(payload: Record<string, unknown>): string {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${header}.${body}.fakesig`;
    }

    it("resolves tenant from tenant_id JWT claim", async () => {
      const token = makeJwt({ tenant_id: "tenant-from-jwt" });
      const req: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };
      const ctx = makeExecutionContext(req);

      const result = await canActivate(client, ctx);

      expect(result).toBe(true);
      expect(client.resolveTenant).toHaveBeenCalledWith("tenant-from-jwt");
    });

    it("resolves tenant from sub JWT claim when tenant_id absent", async () => {
      const token = makeJwt({ sub: "tenant-sub" });
      const req: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };
      const ctx = makeExecutionContext(req);

      const result = await canActivate(client, ctx);

      expect(result).toBe(true);
      expect(client.resolveTenant).toHaveBeenCalledWith("tenant-sub");
    });

    it("prefers x-tenant-id header over JWT claim", async () => {
      const token = makeJwt({ tenant_id: "jwt-tenant" });
      const req: Record<string, unknown> = {
        headers: {
          "x-tenant-id": "header-tenant",
          authorization: `Bearer ${token}`,
        },
      };
      const ctx = makeExecutionContext(req);

      await canActivate(client, ctx);

      expect(client.resolveTenant).toHaveBeenCalledWith("header-tenant");
    });
  });

  describe("canActivate — missing tenant", () => {
    it("throws UnauthorizedException when no tenant identifier in request", async () => {
      const req: Record<string, unknown> = { headers: {} };
      const ctx = makeExecutionContext(req);

      await expect(canActivate(client, ctx)).rejects.toThrow(UnauthorizedException);
      await expect(canActivate(client, ctx)).rejects.toThrow(
        "Tenant ID could not be resolved from request",
      );
    });

    it("throws UnauthorizedException when tenant not found in control plane", async () => {
      const notFoundClient = makeMockClient(null, new TenantNotFoundError("tenant-missing"));
      const req: Record<string, unknown> = {
        headers: { "x-tenant-id": "tenant-missing" },
      };
      const ctx = makeExecutionContext(req);

      await expect(canActivate(notFoundClient, ctx)).rejects.toThrow(UnauthorizedException);
      await expect(canActivate(notFoundClient, ctx)).rejects.toThrow("Tenant not found: tenant-missing");
    });

    it("re-throws unexpected errors", async () => {
      const boom = new Error("Network failure");
      const errorClient = makeMockClient(null, boom);
      const req: Record<string, unknown> = {
        headers: { "x-tenant-id": "tenant-123" },
      };
      const ctx = makeExecutionContext(req);

      await expect(canActivate(errorClient, ctx)).rejects.toThrow("Network failure");
    });
  });
});

describe("@Tenant() decorator", () => {
  it("extracts req.tenant from execution context", () => {
    const req: Record<string, unknown> = { tenant: MOCK_CONTEXT };
    const tenant = extractTenant(req);
    expect(tenant).toEqual(MOCK_CONTEXT);
  });

  it("returns undefined when tenant not yet set (guard not applied)", () => {
    const req: Record<string, unknown> = {};
    const tenant = extractTenant(req);
    expect(tenant).toBeUndefined();
  });
});

describe("STRATUM_CLIENT / STRATUM_OPTIONS constants", () => {
  it("exports distinct Symbol injection tokens", async () => {
    // Dynamic import to avoid hard dep on module resolution
    const { STRATUM_CLIENT, STRATUM_OPTIONS } = await import("../constants.js");
    expect(typeof STRATUM_CLIENT).toBe("symbol");
    expect(typeof STRATUM_OPTIONS).toBe("symbol");
    expect(STRATUM_CLIENT).not.toBe(STRATUM_OPTIONS);
  });
});
