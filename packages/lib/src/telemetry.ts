/**
 * OpenTelemetry instrumentation helpers for Stratum.
 *
 * All telemetry is optional — if @opentelemetry/api is not installed the
 * `traced()` helper simply executes the callback without creating spans.
 */

// Lazy-loaded OTel API — stays `null` when the package is absent.
let otel: typeof import("@opentelemetry/api") | null = null;

try {
  // Dynamic require / import so bundlers can tree-shake when OTel is absent.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  otel = await import("@opentelemetry/api");
} catch {
  // @opentelemetry/api is not installed — telemetry is a no-op.
}

const TRACER_NAME = "@stratum-hq/lib";

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

type Span = import("@opentelemetry/api").Span;

/**
 * Execute `fn` inside an OpenTelemetry span.
 *
 * When @opentelemetry/api is not installed the function is invoked directly
 * without any overhead.
 *
 * @param name  - Operation name (will be prefixed with `stratum.`).
 * @param attributes - Key/value pairs set as span attributes (each key is
 *   prefixed with `stratum.`).
 * @param fn - The async work to perform; receives the active span (or a
 *   no-op stub when tracing is disabled).
 */
export async function traced<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();

  if (!tracer || !otel) {
    // No-op stub so callers don't need to branch.
    const noop: Span = {
      setAttribute: () => noop,
      setAttributes: () => noop,
      setStatus: () => noop,
      recordException: () => noop,
      end: () => {},
      addEvent: () => noop,
      isRecording: () => false,
      updateName: () => noop,
      spanContext: () => ({
        traceId: "",
        spanId: "",
        traceFlags: 0,
      }),
      addLink: () => noop,
    } as unknown as Span;

    return fn(noop);
  }

  const { SpanStatusCode } = otel;

  return tracer.startActiveSpan(`stratum.${name}`, async (span) => {
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
