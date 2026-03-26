/**
 * Minimal structured logger for Stratum.
 * Outputs JSON lines when NODE_ENV=production, human-readable otherwise.
 * Can be replaced by passing a custom logger to Stratum constructor.
 */

export interface StratumLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

const isProduction = process.env.NODE_ENV === "production";

function formatLog(
  level: string,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  if (isProduction) {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...ctx,
    });
  }
  const ctxStr = ctx ? ` ${JSON.stringify(ctx)}` : "";
  return `[stratum:${level}] ${msg}${ctxStr}`;
}

export const defaultLogger: StratumLogger = {
  info(msg, ctx) {
    console.log(formatLog("info", msg, ctx));
  },
  warn(msg, ctx) {
    console.warn(formatLog("warn", msg, ctx));
  },
  error(msg, ctx) {
    console.error(formatLog("error", msg, ctx));
  },
};

/** No-op logger for testing or when logging is disabled. */
export const noopLogger: StratumLogger = {
  info() {},
  warn() {},
  error() {},
};
