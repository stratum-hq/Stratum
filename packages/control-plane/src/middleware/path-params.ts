import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ValidationError } from "@stratum-hq/core";

/**
 * Path parameters that hold the id of a database row. Every such id is a UUID.
 * The other path parameters (a config `:key`, a consent `:purpose`) are free text.
 */
export const UUID_PATH_PARAMS: ReadonlySet<string> = new Set(["id", "tenantId", "policyId", "keyId", "deliveryId"]);

const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

/** Returns the names of the path parameters in a route URL, such as `id` in `/tenants/:id`. */
export function pathParamNames(url: string): string[] {
  return [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

/**
 * Gives every route registered after this call a params schema that requires a
 * UUID for each id parameter in its URL.
 *
 * The route keeps a failed check on the request (attachValidation) instead of
 * answering at once. {@link rejectInvalidPathParams} answers it after the
 * caller is authenticated, so a caller without credentials still gets 401.
 */
export function registerUuidPathParams(app: FastifyInstance): void {
  app.addHook("onRoute", (routeOptions) => {
    const names = pathParamNames(routeOptions.url ?? "").filter((name) => UUID_PATH_PARAMS.has(name));
    if (names.length === 0) return;
    const existing = (routeOptions.schema?.params ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
    routeOptions.schema = {
      ...routeOptions.schema,
      params: {
        type: "object",
        ...existing,
        properties: {
          ...existing.properties,
          ...Object.fromEntries(names.map((name) => [name, { type: "string", format: "uuid", pattern: UUID_PATTERN }])),
        },
        required: [...new Set([...(existing.required ?? []), ...names])],
      },
    };
    routeOptions.attachValidation = true;
  });
}

/**
 * A global preHandler, registered after authentication: answers a request whose
 * schema check failed with 400 VALIDATION_ERROR, one issue per bad path id.
 */
export async function rejectInvalidPathParams(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const failure = request.validationError as
    | (Error & { validationContext?: string; validation?: Array<{ instancePath?: string; params?: { missingProperty?: string } }> })
    | undefined;
  if (!failure) return;
  if (failure.validationContext !== "params") throw failure;
  const names = new Set(
    (failure.validation ?? []).map((item) => item.instancePath?.replace(/^\//, "") || item.params?.missingProperty || ""),
  );
  const issues = [...names].map((name) => ({ path: ["params", name], message: "Invalid uuid", code: "invalid_string" }));
  throw new ValidationError("Invalid path parameter", { issues });
}

/** Query-string parameters that hold a tenant id. Every such id is a UUID. */
export const UUID_QUERY_PARAMS: readonly string[] = ["tenant_id", "tenant_a", "tenant_b"];

const UUID_REGEX = new RegExp(UUID_PATTERN);

/**
 * A global preHandler, registered after authentication and before the tenant
 * scope enforcer: answers a request whose query string carries a tenant id that
 * is not a single UUID with 400 VALIDATION_ERROR, one issue per bad parameter.
 */
export async function rejectInvalidQueryTenantIds(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const query = (request.query ?? {}) as Record<string, unknown>;
  const bad = UUID_QUERY_PARAMS.filter(
    (name) => query[name] !== undefined && !(typeof query[name] === "string" && UUID_REGEX.test(query[name])),
  );
  if (bad.length === 0) return;
  const issues = bad.map((name) => ({ path: ["query", name], message: "Invalid uuid", code: "invalid_string" }));
  throw new ValidationError("Invalid query parameter", { issues });
}
