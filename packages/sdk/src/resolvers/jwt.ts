export interface JwtResolverOptions {
  secret?: string;
  verify?: (token: string) => Record<string, unknown> | null;
}

function verifyWithJsonwebtoken(token: string, secret: string): Record<string, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string") return null;
    return decoded as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveFromJwt(
  req: unknown,
  claimPath: string = "tenant_id",
  options?: JwtResolverOptions,
): string | null {
  const r = req as Record<string, unknown>;
  const headers = r["headers"] as Record<string, string | string[] | undefined> | undefined;
  if (!headers) return null;

  const authHeader = headers["authorization"];
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7);

  let claims: Record<string, unknown> | null = null;

  if (options?.verify) {
    // User-supplied verify function takes priority
    claims = options.verify(token);
  } else if (options?.secret) {
    // Try jsonwebtoken signature verification
    claims = verifyWithJsonwebtoken(token, options.secret);
  } else {
    // No secret or verify function provided — refuse to trust unsigned tokens
    console.warn(
      "[stratum] JWT ignored: no jwtSecret or jwtVerify provided. " +
      "Configure middleware options to enable JWT tenant resolution.",
    );
    return null;
  }

  if (!claims) return null;

  // Support dotted claim paths like "stratum.tenant_id"
  const segments = claimPath.split(".");
  let current: unknown = claims;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[seg];
  }

  return typeof current === "string" ? current : null;
}
