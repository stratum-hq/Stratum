import { describe, it, expect } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
} from "../webhook-signature.js";

const SECRET = "whsec_test_secret";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "tenant.created" });

describe("signWebhookPayload", () => {
  it("binds the timestamp into the signature", () => {
    const t1 = "2026-07-24T00:00:00.000Z";
    const t2 = "2026-07-24T00:00:01.000Z";
    expect(signWebhookPayload(SECRET, t1, PAYLOAD)).not.toBe(
      signWebhookPayload(SECRET, t2, PAYLOAD),
    );
  });

  it("produces a sha256= prefixed hex digest", () => {
    const sig = signWebhookPayload(SECRET, "2026-07-24T00:00:00.000Z", PAYLOAD);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe("verifyWebhookSignature", () => {
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  const timestamp = "2026-07-24T12:00:00.000Z";
  const signature = signWebhookPayload(SECRET, timestamp, PAYLOAD);

  it("accepts a fresh, correctly signed delivery", () => {
    expect(
      verifyWebhookSignature({ secret: SECRET, payload: PAYLOAD, signature, timestamp, now }),
    ).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: PAYLOAD + "x",
        signature,
        timestamp,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(
      verifyWebhookSignature({
        secret: "whsec_wrong",
        payload: PAYLOAD,
        signature,
        timestamp,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a replayed delivery once it ages past the window", () => {
    const stale = now + (DEFAULT_WEBHOOK_TOLERANCE_SECONDS + 1) * 1000;
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature,
        timestamp,
        now: stale,
      }),
    ).toBe(false);
  });

  it("rejects a timestamp too far in the future", () => {
    const future = now - (DEFAULT_WEBHOOK_TOLERANCE_SECONDS + 1) * 1000;
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature,
        timestamp,
        now: future,
      }),
    ).toBe(false);
  });

  it("accepts a delivery at the edge of the window", () => {
    const edge = now + DEFAULT_WEBHOOK_TOLERANCE_SECONDS * 1000;
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature,
        timestamp,
        now: edge,
      }),
    ).toBe(true);
  });

  it("respects a custom tolerance", () => {
    const drift = now + 10_000; // 10s later
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature,
        timestamp,
        toleranceSeconds: 5,
        now: drift,
      }),
    ).toBe(false);
  });

  it("fails closed on a malformed timestamp", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature,
        timestamp: "not-a-date",
        now,
      }),
    ).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature: "sha256=deadbeef",
        timestamp,
        now,
      }),
    ).toBe(false);
  });
});
