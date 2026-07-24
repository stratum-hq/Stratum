import crypto from "node:crypto";

/** Default freshness window, in seconds, for a webhook delivery timestamp. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Compute the signature for a webhook delivery.
 *
 * The timestamp is bound into the signed value (`<timestamp>.<payload>`), so a
 * captured delivery cannot be re-sent with a fresh timestamp to slip past the
 * receiver's freshness check. Producers and {@link verifyWebhookSignature} must
 * sign over the exact same string.
 */
export function signWebhookPayload(
  secret: string,
  timestamp: string,
  payload: string,
): string {
  return (
    "sha256=" +
    crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex")
  );
}

export interface VerifyWebhookOptions {
  /** The shared webhook secret. */
  secret: string;
  /** The raw request body, exactly as received. */
  payload: string;
  /** The `X-Stratum-Signature` header value. */
  signature: string;
  /** The `X-Stratum-Timestamp` header value. */
  timestamp: string;
  /** Freshness window in seconds. Defaults to {@link DEFAULT_WEBHOOK_TOLERANCE_SECONDS}. */
  toleranceSeconds?: number;
  /** Current time in ms since the epoch. Injectable for testing; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Verify a Stratum webhook delivery.
 *
 * Returns `true` only when the signature is valid AND the timestamp falls
 * within the freshness window. The window is the replay defense: it rejects a
 * captured, still-correctly-signed delivery once it ages out. For strict
 * exactly-once handling, also de-duplicate on the `X-Stratum-Delivery-ID`
 * header. The comparison is constant-time and the function never throws.
 */
export function verifyWebhookSignature(options: VerifyWebhookOptions): boolean {
  const {
    secret,
    payload,
    signature,
    timestamp,
    toleranceSeconds = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    now = Date.now(),
  } = options;

  // Reject a missing or malformed timestamp (fail closed).
  const sentMs = Date.parse(timestamp);
  if (Number.isNaN(sentMs)) {
    return false;
  }

  // Reject deliveries outside the freshness window in either direction.
  if (Math.abs(now - sentMs) > toleranceSeconds * 1000) {
    return false;
  }

  const expected = Buffer.from(signWebhookPayload(secret, timestamp, payload));
  const provided = Buffer.from(signature);
  // timingSafeEqual requires equal-length inputs; unequal length is a mismatch.
  if (expected.length !== provided.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, provided);
}
