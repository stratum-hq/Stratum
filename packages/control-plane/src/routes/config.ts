import { FastifyInstance, FastifyRequest } from "fastify";
import {
  ErrorCode,
  SetConfigInputSchema,
  type BatchSetConfigEntry,
  type BatchSetConfigResult,
  type ResolveConfigOptions,
} from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";
import { buildAuditContext } from "./audit-logs.js";
import { declareTenantScope, fromParamId } from "../middleware/tenant-scope.js";
import { declareRequiredScope } from "../middleware/authorize.js";
import { validationErrorBody, type ValidationIssue } from "../middleware/error-handler.js";

/** The library's reason for an entry that an ancestor's lock refused. */
const LOCKED_REASON = /is locked by tenant/;

/**
 * The result of a batch that nothing was written for: every entry failed,
 * with its own reason when it has one.
 */
function rolledBackResult(keys: string[], reasons: Map<number, string>): BatchSetConfigResult {
  const failedKeys = [...reasons.keys()].map((i) => `'${keys[i]}'`).join(", ");
  return {
    results: keys.map((key, i) => ({
      key,
      status: "error",
      error: reasons.get(i) ?? `Not applied: the batch was rolled back because ${failedKeys} failed`,
    })),
    succeeded: 0,
    failed: keys.length,
    rolled_back: true,
  };
}

/**
 * Checks every batch entry and returns the issues, with paths under `entries`.
 * The library refuses the same entries, but checking here keeps them away from it.
 */
function batchEntryIssues(entries: unknown[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  entries.forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push({ path: ["entries", i], message: "Expected object", code: "invalid_type" });
      return;
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.key !== "string" || entry.key.length === 0) {
      issues.push({ path: ["entries", i, "key"], message: "Config key must be a non-empty string", code: "invalid_type" });
    }
    if (entry.value === undefined) {
      issues.push({ path: ["entries", i, "value"], message: "Required", code: "invalid_type" });
    }
    const parsed = SetConfigInputSchema.safeParse(entry);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: ["entries", i, ...issue.path], message: issue.message, code: issue.code });
      }
    }
  });
  return issues;
}

/**
 * Library read options for a config read made by `request`'s caller.
 *
 * A sensitive value inherited from an ancestor is revealed only to a caller
 * whose key belongs to the tenant that set it. A global key is not that
 * tenant, so it gets no viewer and those values stay masked. The API never
 * asks the library to reveal every sensitive value.
 */
export function configReadOptions(request: FastifyRequest): ResolveConfigOptions {
  const viewerTenantId = request.apiKey?.tenant_id;
  return viewerTenantId ? { viewerTenantId } : {};
}

export function createConfigRoutes(stratum: Stratum) {
  return async function configRoutes(app: FastifyInstance): Promise<void> {
    // Tenant-scoped keys can only access config for their own tenant subtree
    declareTenantScope(app, fromParamId);
    declareRequiredScope(app, { read: "read", write: "write" });
    // GET /api/v1/tenants/:id/config: Get resolved config
    app.get<{ Params: { id: string } }>("/", async (request, reply) => {
      const resolved = await stratum.resolveConfig(request.params.id, configReadOptions(request));
      reply.status(200).send(resolved);
    });

    // PUT /api/v1/tenants/:id/config/:key: Set config value
    app.put<{ Params: { id: string; key: string } }>("/:key", async (request, reply) => {
      const input = SetConfigInputSchema.parse(request.body);
      const entry = await stratum.setConfig(request.params.id, request.params.key, input, buildAuditContext(request));
      reply.status(200).send(entry);
    });

    // DELETE /api/v1/tenants/:id/config/:key: Delete config override
    app.delete<{ Params: { id: string; key: string } }>("/:key", async (request, reply) => {
      await stratum.deleteConfig(request.params.id, request.params.key, buildAuditContext(request));
      reply.status(204).send();
    });

    // PUT /api/v1/tenants/:id/config/batch: Set multiple config keys atomically
    app.put<{ Params: { id: string } }>("/batch", async (request, reply) => {
      const body = request.body as { entries?: unknown[] };
      if (!Array.isArray(body?.entries) || body.entries.length === 0) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Body must contain a non-empty 'entries' array" } });
        return;
      }
      if (body.entries.length > 200) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Batch limited to 200 entries" } });
        return;
      }
      const keys = body.entries.map((e) => {
        const key = (e as { key?: unknown } | null)?.key;
        return typeof key === "string" ? key : "";
      });
      const issues = batchEntryIssues(body.entries);
      if (issues.length > 0) {
        const reasons = new Map<number, string>();
        for (const issue of issues) {
          const i = issue.path[1] as number;
          if (!reasons.has(i)) reasons.set(i, issue.message);
        }
        reply.status(400).send(validationErrorBody("Validation failed", issues, { ...rolledBackResult(keys, reasons) }));
        return;
      }
      const entries: BatchSetConfigEntry[] = body.entries.map((e) => {
        const parsed = SetConfigInputSchema.parse(e);
        const entry = e as Record<string, unknown>;
        return { key: entry.key as string, value: parsed.value, locked: parsed.locked, sensitive: parsed.sensitive };
      });
      const batchResult = await stratum.batchSetConfig(request.params.id, entries, buildAuditContext(request));
      if (batchResult.rolled_back) {
        // Nothing was written. A lock gets the status of a single locked write.
        const refused = batchResult.results
          .map((result, i) => ({ result, i }))
          .filter(({ result }) => result.error && !result.error.startsWith("Not applied:"));
        const locked = refused.filter(({ result }) => LOCKED_REASON.test(result.error ?? ""));
        if (locked.length > 0) {
          const lockedKeys = locked.map(({ result }) => `'${result.key}'`).join(", ");
          reply.status(403).send({
            error: {
              code: ErrorCode.CONFIG_LOCKED,
              message: `The batch was rolled back and nothing was written: ${lockedKeys} locked by an ancestor`,
              details: { ...batchResult },
            },
          });
          return;
        }
        const refusedIssues: ValidationIssue[] = refused.map(({ result, i }) => ({
          path: ["entries", i],
          message: result.error as string,
          code: "custom",
        }));
        reply.status(400).send(validationErrorBody("Validation failed", refusedIssues, { ...batchResult }));
        return;
      }
      reply.status(200).send(batchResult);
    });

    // GET /api/v1/tenants/:id/config/inheritance: Get full inheritance view
    app.get<{ Params: { id: string } }>("/inheritance", async (request, reply) => {
      const inheritance = await stratum.getConfigWithInheritance(request.params.id, configReadOptions(request));
      reply.status(200).send(inheritance);
    });
  };
}
