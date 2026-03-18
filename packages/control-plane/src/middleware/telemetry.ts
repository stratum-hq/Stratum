/**
 * OpenTelemetry Fastify middleware for the Stratum control plane.
 *
 * Creates a span per HTTP request and records standard HTTP + Stratum
 * attributes. Gracefully no-ops when @opentelemetry/api is not installed.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// Lazy-loaded OTel API — stays `null` when the package is absent.
let otel: typeof import("@opentelemetry/api") | null = null;

try {
  otel = await import("@opentelemetry/api");
} catch {
  // @opentelemetry/api is not installed — telemetry is a no-op.
}

const TRACER_NAME = "@stratum-hq/control-plane";

/**
 * Register the telemetry onRequest / onResponse hooks on a Fastify instance.
 *
 * If @opentelemetry/api is not installed, this is a no-op.
 */
export function registerTelemetryHooks(app: FastifyInstance): void {
  if (!otel) return;

  const tracer = otel.trace.getTracer(TRACER_NAME);
  const { SpanStatusCode, SpanKind } = otel;

  // Store spans keyed by request id so the onResponse hook can close them.
  const inflightSpans = new Map<string, import("@opentelemetry/api").Span>();

  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    const span = tracer.startSpan(`HTTP ${request.method} ${request.routeOptions?.url ?? request.url}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": request.method,
        "http.url": request.url,
        "http.route": request.routeOptions?.url ?? request.url,
        "http.request_id": request.id as string,
      },
    });

    // Attach tenant_id from the authenticated key if available
    if (request.apiKey?.tenant_id) {
      span.setAttribute("stratum.tenant_id", request.apiKey.tenant_id);
    }

    inflightSpans.set(request.id as string, span);
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const span = inflightSpans.get(request.id as string);
    if (!span) return;
    inflightSpans.delete(request.id as string);

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

  // Safety net: if the request errors out before onResponse fires
  app.addHook("onError", async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
    const span = inflightSpans.get(request.id as string);
    if (!span) return;

    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    span.recordException(error);
    // Don't end here — onResponse will still fire and end the span.
  });
}
