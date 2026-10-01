export interface JwtResolverOptions {
  secret?: string;
  verify?: (token: string) => Record<string, unknown> | null;
  /** When set, the verified token's `aud` claim must equal it or include it. */
  audience?: string;
  /** When set, the verified token's `iss` claim must equal it. */
  issuer?: string;
}

/** True when the claims satisfy the configured audience and issuer, if any. */
function matchesAudienceAndIssuer(claims: Record<string, unknown>, options?: JwtResolverOptions): boolean {
  if (options?.audience !== undefined) {
    const aud = claims["aud"];
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(options.audience)) return false;
  }
  if (options?.issuer !== undefined && claims["iss"] !== options.issuer) return false;
  return true;
}

type JsonWebTokenModule = typeof import("jsonwebtoken");

/**
 * Load the optional `jsonwebtoken` peer dependency. Returns null only when the
 * module is not installed; any other load failure is rethrown.
 */
function loadJsonwebtoken(): JsonWebTokenModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("jsonwebtoken") as JsonWebTokenModule;
  } catch (err) {
    if ((err as { code?: string }).code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

/**
 * Throw if `jwtSecret` is configured without a `jwtVerify` function and the
 * optional `jsonwebtoken` peer dependency cannot be loaded. Called when a
 * middleware is constructed, so a missing module fails loudly at startup
 * instead of making every token look unverifiable.
 */
export function assertJwtSupport(options?: { jwtSecret?: string; jwtVerify?: unknown }): void {
  if (!options?.jwtSecret || options.jwtVerify) return;
  if (!loadJsonwebtoken()) {
    throw new Error(
      "[stratum] jwtSecret is set but the optional peer dependency 'jsonwebtoken' could not be loaded. " +
        "Install jsonwebtoken, or provide jwtVerify.",
    );
  }
}

function verifyWithJsonwebtoken(token: string, secret: string): Record<string, unknown> | null {
  const jwt = loadJsonwebtoken();
  if (!jwt) {
    throw new Error("[stratum] jwtSecret is set but the optional peer dependency 'jsonwebtoken' is not installed.");
  }
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string") return null;
    return decoded as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Outcome of JWT tenant resolution:
 * - `absent`: no bearer token, or no secret / verify function configured
 * - `invalid`: a bearer token was sent but did not verify
 * - `no_claim`: the token verified but carries no string tenant claim
 * - `resolved`: the token verified and carries the tenant claim
 */
export type JwtTenantResolution =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "no_claim" }
  | { status: "resolved"; tenantId: string };

export function resolveJwtTenant(
  req: unknown,
  claimPath: string = "tenant_id",
  options?: JwtResolverOptions,
): JwtTenantResolution {
  const r = req as Record<string, unknown>;
  const headers = r["headers"] as Record<string, string | string[] | undefined> | undefined;
  if (!headers) return { status: "absent" };

  const authHeader = headers["authorization"];
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth || !auth.startsWith("Bearer ")) return { status: "absent" };

  const token = auth.slice(7);

  let claims: Record<string, unknown> | null = null;

  if (options?.verify) {
    // User-supplied verify function takes priority
    claims = options.verify(token);
  } else if (options?.secret) {
    // Try jsonwebtoken signature verification
    claims = verifyWithJsonwebtoken(token, options.secret);
  } else {
    // No secret or verify function provided: refuse to trust unsigned tokens
    console.warn(
      "[stratum] JWT ignored: no jwtSecret or jwtVerify provided. " +
      "Configure middleware options to enable JWT tenant resolution.",
    );
    return { status: "absent" };
  }

  if (!claims) return { status: "invalid" };
  if (!matchesAudienceAndIssuer(claims, options)) return { status: "invalid" };

  // Support dotted claim paths like "stratum.tenant_id"
  const segments = claimPath.split(".");
  let current: unknown = claims;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return { status: "no_claim" };
    current = (current as Record<string, unknown>)[seg];
  }

  return typeof current === "string" ? { status: "resolved", tenantId: current } : { status: "no_claim" };
}

export function resolveFromJwt(
  req: unknown,
  claimPath: string = "tenant_id",
  options?: JwtResolverOptions,
): string | null {
  const result = resolveJwtTenant(req, claimPath, options);
  return result.status === "resolved" ? result.tenantId : null;
}
