/**
 * OpenTelemetry Fastify middleware for the Stratum control plane.
 *
 * Creates a span per HTTP request and records standard HTTP + Stratum
 * attributes. Gracefully no-ops when @opentelemetry/api is not installed.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// Lazy-loaded OTel API; stays `null` when the package is absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let otel: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  otel = require("@opentelemetry/api");
} catch {
  // @opentelemetry/api is not installed, so telemetry is a no-op.
}

const TRACER_NAME = "@stratum-hq/control-plane";

/**
 * Register the telemetry onRequest, onResponse, onRequestAbort, and onError hooks on a Fastify instance.
 *
 * If @opentelemetry/api is not installed, this is a no-op.
 */
export function registerTelemetryHooks(app: FastifyInstance): void {
  if (!otel) return;

  const tracer = otel.trace.getTracer(TRACER_NAME);
  const { SpanStatusCode, SpanKind } = otel;

  // Store spans keyed by request id so the onResponse hook can close them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inflightSpans = new Map<string, any>();

  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    // A query string can carry cursors or filter values, so spans record the path only.
    const path = request.url.split("?", 1)[0];
    const route = request.routeOptions?.url ?? path;
    const span = tracer.startSpan(`HTTP ${request.method} ${route}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": request.method,
        "http.url": path,
        "http.route": route,
        "http.request_id": request.id as string,
      },
    });

    inflightSpans.set(request.id as string, span);
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const span = inflightSpans.get(request.id as string);
    if (!span) return;
    inflightSpans.delete(request.id as string);

    // Authentication runs as a preHandler, after onRequest, so the tenant is known only here.
    if (request.apiKey?.tenant_id) {
      span.setAttribute("stratum.tenant_id", request.apiKey.tenant_id);
    }
    span.setAttribute("http.status_code", reply.statusCode);

    if (reply.statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${reply.statusCode}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  });

  // A client that disconnects early can prevent onResponse, so this hook ends the span instead.
  // Each hook removes the span from the map first, so only one of them can end it.
  app.addHook("onRequestAbort", async (request: FastifyRequest) => {
    const span = inflightSpans.get(request.id as string);
    if (!span) return;
    inflightSpans.delete(request.id as string);

    if (request.apiKey?.tenant_id) {
      span.setAttribute("stratum.tenant_id", request.apiKey.tenant_id);
    }
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: "Client closed the connection before the response",
    });
    span.end();
  });

  // Safety net: if the request errors out before onResponse fires
  app.addHook("onError", async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
    const span = inflightSpans.get(request.id as string);
    if (!span) return;

    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    span.recordException(error);
    // Don't end here; onResponse will still fire and end the span.
  });
}
