export interface JwtResolverOptions {
  secret?: string;
  verify?: (token: string) => Record<string, unknown> | null;
}

function decodePayloadOnly(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1];
    // Pad base64url to standard base64
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function verifyWithJsonwebtoken(token: string, secret: string): Record<string, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
    const decoded = jwt.verify(token, secret);
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
    // Decode-only fallback
    if (!options?.secret && !options?.verify) {
      console.warn(
        "[stratum] JWT is being decoded without signature verification. " +
        "Provide jwtSecret or jwtVerify in middleware options to enable verification.",
      );
    }
    claims = decodePayloadOnly(token);
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
