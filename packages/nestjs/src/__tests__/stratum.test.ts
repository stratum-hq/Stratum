import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveFromHeader, resolveFromJwt, setTenantContext } from "@stratum-hq/sdk";

// ── Minimal NestJS interface stubs ──────────────────────────────────────────
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
      getResponse: () => ({}) as any,
      getNext: () => ({}) as any,
    }),
  } as ExecutionContext;
}

// ── Stubs for NestJS exceptions ──────────────────────────────────────────────
import { TenantNotFoundError } from "@stratum-hq/core";

class UnauthorizedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedException";
  }
}

class ForbiddenException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenException";
  }
}

// ── Guard options shape (mirrors StratumModuleOptions) ───────────────────────
interface GuardOptions {
  jwtClaimPath?: string;
  jwtSecret?: string;
  jwtVerify?: (token: string) => Record<string, unknown> | null;
  resolvers?: Array<{ resolve(req: unknown): string | null | Promise<string | null> }>;
  impersonation?: {
    enabled: boolean;
    headerName?: string;
    authorize: (req: unknown, callerTenantId: string, targetTenantId: string) => boolean | Promise<boolean>;
    onImpersonate?: (req: unknown, callerTenantId: string, targetTenantId: string) => void;
  };
}

// ── Guard logic (mirrors stratum.guard.ts) ───────────────────────────────────
async function canActivate(
  client: ReturnType<typeof makeMockClient>,
  context: ExecutionContext,
  options: GuardOptions = {},
): Promise<boolean> {
  const req = context.switchToHttp().getRequest<Record<string, unknown> & {
    headers?: Record<string, string | string[] | undefined>;
  }>();

  // 1. Resolve tenant ID: header → JWT (verified) → custom resolvers
  let tenantId: string | null = null;

  tenantId = resolveFromHeader(req);

  if (!tenantId) {
    tenantId = resolveFromJwt(req, options.jwtClaimPath, {
      secret: options.jwtSecret,
      verify: options.jwtVerify,
    });
  }

  if (!tenantId && options.resolvers) {
    for (const resolver of options.resolvers) {
      const result = await resolver.resolve(req);
      if (result) {
        tenantId = result;
        break;
      }
    }
  }

  if (!tenantId) {
    throw new UnauthorizedException("Tenant ID could not be resolved from request");
  }

  // 2. Resolve caller tenant context
  let callerContext;
  try {
    callerContext = await client.resolveTenant(tenantId);
  } catch (err) {
    if (err instanceof TenantNotFoundError) {
      throw new UnauthorizedException(`Tenant not found: ${tenantId}`);
    }
    throw err;
  }

  req["tenant"] = callerContext;
  req["impersonating"] = false;

  // 3. Impersonation
  if (options.impersonation?.enabled) {
    const impersonateHeader = options.impersonation.headerName ?? "X-Impersonate-Tenant";
    const headers = req.headers as Record<string, string | string[] | undefined> | undefined;
    const rawVal = headers?.[impersonateHeader.toLowerCase()];
    const impersonateTenantId = Array.isArray(rawVal) ? rawVal[0] : rawVal;

    if (impersonateTenantId && impersonateTenantId !== tenantId) {
      const authorized = await options.impersonation.authorize(req, tenantId, impersonateTenantId);
      if (!authorized) {
        throw new ForbiddenException("Not authorized to impersonate this tenant");
      }

      let impersonatedContext;
      try {
        impersonatedContext = await client.resolveTenant(impersonateTenantId);
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          throw new UnauthorizedException(`Impersonated tenant not found: ${impersonateTenantId}`);
        }
        throw err;
      }

      req["tenant"] = impersonatedContext;
      req["impersonating"] = true;
      req["originalTenantId"] = tenantId;

      options.impersonation.onImpersonate?.(req, tenantId, impersonateTenantId);

      setTenantContext(impersonatedContext as any);
      return true;
    }
  }

  // 4. Bind AsyncLocalStorage context
  setTenantContext(callerContext as any);
  return true;
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

const MOCK_CONTEXT_B: MockTenantContext = {
  id: "tenant-456",
  slug: "other",
  name: "Other Corp",
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

  describe("canActivate — JWT (unverified tokens rejected)", () => {
    function makeJwt(payload: Record<string, unknown>): string {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${header}.${body}.fakesig`;
    }

    it("does NOT trust JWT claims when no jwtSecret or jwtVerify is configured", async () => {
      // Without a secret, the guard must not extract tenant from JWT
      const token = makeJwt({ tenant_id: "forged-tenant" });
      const req: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };
      const ctx = makeExecutionContext(req);

      // No options — should reject because JWT is unverified
      await expect(canActivate(client, ctx, {})).rejects.toThrow(UnauthorizedException);
      await expect(canActivate(client, ctx, {})).rejects.toThrow(
        "Tenant ID could not be resolved from request",
      );
      expect(client.resolveTenant).not.toHaveBeenCalled();
    });

    it("resolves tenant from JWT when jwtVerify is provided", async () => {
      const token = makeJwt({ tenant_id: "tenant-from-jwt" });
      const req: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };
      const ctx = makeExecutionContext(req);

      // Supply a verify function that trusts this token
      const jwtVerify = (_t: string) => ({ tenant_id: "tenant-from-jwt" });

      const result = await canActivate(client, ctx, { jwtVerify });

      expect(result).toBe(true);
      expect(client.resolveTenant).toHaveBeenCalledWith("tenant-from-jwt");
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

      await canActivate(client, ctx, { jwtVerify: () => ({ tenant_id: "jwt-tenant" }) });

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

  describe("canActivate — custom resolvers", () => {
    it("uses custom resolver when header and JWT resolve nothing", async () => {
      const req: Record<string, unknown> = { headers: {} };
      const ctx = makeExecutionContext(req);

      const customResolver = { resolve: vi.fn(async () => "tenant-from-resolver") };

      const result = await canActivate(client, ctx, { resolvers: [customResolver] });

      expect(result).toBe(true);
      expect(customResolver.resolve).toHaveBeenCalledWith(req);
      expect(client.resolveTenant).toHaveBeenCalledWith("tenant-from-resolver");
    });

    it("stops at first resolver that returns a value", async () => {
      const req: Record<string, unknown> = { headers: {} };
      const ctx = makeExecutionContext(req);

      const r1 = { resolve: vi.fn(async () => "first-resolver-tenant") };
      const r2 = { resolve: vi.fn(async () => "second-resolver-tenant") };

      await canActivate(client, ctx, { resolvers: [r1, r2] });

      expect(r1.resolve).toHaveBeenCalled();
      expect(r2.resolve).not.toHaveBeenCalled();
      expect(client.resolveTenant).toHaveBeenCalledWith("first-resolver-tenant");
    });
  });

  describe("canActivate — impersonation", () => {
    it("impersonates target tenant when authorized", async () => {
      // client returns MOCK_CONTEXT for "tenant-123", MOCK_CONTEXT_B for "tenant-456"
      const impClient = {
        resolveTenant: vi.fn(async (id: string) => {
          if (id === "tenant-123") return MOCK_CONTEXT;
          if (id === "tenant-456") return MOCK_CONTEXT_B;
          throw new TenantNotFoundError(id);
        }),
      };

      const req: Record<string, unknown> = {
        headers: {
          "x-tenant-id": "tenant-123",
          "x-impersonate-tenant": "tenant-456",
        },
      };
      const ctx = makeExecutionContext(req);

      const onImpersonate = vi.fn();
      const result = await canActivate(impClient, ctx, {
        impersonation: {
          enabled: true,
          authorize: async () => true,
          onImpersonate,
        },
      });

      expect(result).toBe(true);
      expect(req["tenant"]).toEqual(MOCK_CONTEXT_B);
      expect(req["impersonating"]).toBe(true);
      expect(req["originalTenantId"]).toBe("tenant-123");
      expect(onImpersonate).toHaveBeenCalledWith(req, "tenant-123", "tenant-456");
    });

    it("throws ForbiddenException when impersonation is denied", async () => {
      const req: Record<string, unknown> = {
        headers: {
          "x-tenant-id": "tenant-123",
          "x-impersonate-tenant": "tenant-456",
        },
      };
      const ctx = makeExecutionContext(req);

      await expect(
        canActivate(client, ctx, {
          impersonation: {
            enabled: true,
            authorize: async () => false,
          },
        }),
      ).rejects.toThrow(ForbiddenException);
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
    const { STRATUM_CLIENT, STRATUM_OPTIONS } = await import("../constants.js");
    expect(typeof STRATUM_CLIENT).toBe("symbol");
    expect(typeof STRATUM_OPTIONS).toBe("symbol");
    expect(STRATUM_CLIENT).not.toBe(STRATUM_OPTIONS);
  });
});
