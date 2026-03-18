/**
 * OpenTelemetry instrumentation helpers for Stratum.
 *
 * All telemetry is optional — if @opentelemetry/api is not installed the
 * `traced()` helper simply executes the callback without creating spans.
 *
 * IMPORTANT: This file must NOT import @opentelemetry/api at the type level
 * so TypeScript can compile without the package installed. All OTel types
 * are represented as `any` at compile time.
 */

// Lazy-loaded OTel API — stays `null` when the package is absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let otel: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  otel = require("@opentelemetry/api");
} catch {
  // @opentelemetry/api is not installed — telemetry is a no-op.
}

const TRACER_NAME = "@stratum-hq/lib";

/** No-op span stub used when OTel is not available. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NOOP_SPAN: any = {
  setAttribute: () => NOOP_SPAN,
  setAttributes: () => NOOP_SPAN,
  setStatus: () => NOOP_SPAN,
  recordException: () => NOOP_SPAN,
  end: () => {},
  addEvent: () => NOOP_SPAN,
  isRecording: () => false,
  updateName: () => NOOP_SPAN,
  spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
  addLink: () => NOOP_SPAN,
};

/**
 * Returns the OpenTelemetry tracer for Stratum, or `null` when OTel is
 * unavailable.
 */
export function getTracer() {
  return otel ? otel.trace.getTracer(TRACER_NAME) : null;
}

/**
 * Returns `true` when OpenTelemetry instrumentation is active.
 */
export function isTracingEnabled(): boolean {
  return otel !== null;
}

/**
 * Execute `fn` inside an OpenTelemetry span.
 *
 * When @opentelemetry/api is not installed the function is invoked directly
 * without any overhead — the span parameter is a no-op stub.
 */
export async function traced<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (span: any) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();

  if (!tracer || !otel) {
    return fn(NOOP_SPAN);
  }

  const { SpanStatusCode } = otel;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return tracer.startActiveSpan(`stratum.${name}`, async (span: any) => {
    try {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          span.setAttribute(`stratum.${key}`, value);
        }
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
