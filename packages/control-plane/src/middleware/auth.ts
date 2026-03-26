import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { UnauthorizedError } from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";

interface ApiKeyRecord {
  id: string;
  tenant_id: string | null;
  key_hash: string;
  name: string;
  created_at: Date;
  scopes: string[];
  rate_limit_max: number | null;
  rate_limit_window: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKeyRecord;
    authMethod?: "api_key" | "jwt";
  }
}

export function createAuthMiddleware(stratum: Stratum) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Skip auth for health and documentation endpoints
    if (
      request.url === "/api/v1/health" ||
      request.url.startsWith("/api/v1/health?") ||
      request.url.startsWith("/api/docs")
    ) {
      return;
    }

    // Try API key first
    const apiKeyHeader = request.headers["x-api-key"];
    if (apiKeyHeader && typeof apiKeyHeader === "string") {
      const result = await stratum.validateApiKey(apiKeyHeader);
      if (!result) {
        throw new UnauthorizedError("Invalid or revoked API key");
      }
      request.apiKey = {
        id: result.key_id,
        tenant_id: result.tenant_id,
        key_hash: "",
        name: "",
        created_at: new Date(),
        scopes: result.scopes,
        rate_limit_max: result.rate_limit_max,
        rate_limit_window: result.rate_limit_window,
      };
      request.authMethod = "api_key";
      return;
    }

    // Try JWT Bearer token
    const authHeader = request.headers["authorization"];
    if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as jwt.JwtPayload;

        // JWT must contain a tenant_id claim — JWTs without one are not allowed
        // global access (only API keys may have null tenant_id).
        if (!payload.tenant_id || typeof payload.tenant_id !== "string") {
          throw new UnauthorizedError("JWT must contain a valid tenant_id claim");
        }

        // Verify the claimed tenant actually exists in the database.
        try {
          await stratum.getTenant(payload.tenant_id);
        } catch {
          throw new UnauthorizedError("JWT tenant_id does not correspond to a known tenant");
        }

        // Store a synthetic api key record from JWT claims
        // Extract scopes from JWT claims; default to read-only for safety
        const jwtScopes = Array.isArray(payload.scopes)
          ? (payload.scopes as unknown[]).filter(
              (s): s is string => typeof s === "string" && ["read", "write", "admin"].includes(s),
            )
          : ["read"];
        request.apiKey = {
          id: payload.sub ?? "",
          tenant_id: payload.tenant_id,
          key_hash: "",
          name: payload.name ?? "jwt",
          created_at: new Date(),
          scopes: jwtScopes,
          rate_limit_max: null,
          rate_limit_window: null,
        };
        request.authMethod = "jwt";
        return;
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        throw new UnauthorizedError("Invalid or expired token");
      }
    }

    throw new UnauthorizedError("Authentication required. Provide X-API-Key or Authorization: Bearer header");
  };
}
