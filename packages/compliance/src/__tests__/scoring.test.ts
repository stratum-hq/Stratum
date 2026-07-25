import { describe, it, expect } from "vitest";
import {
  scoreCoverage,
  looseEqual,
  type CoverageResult,
} from "../index.js";

// ---------------------------------------------------------------------------
// looseEqual
// ---------------------------------------------------------------------------

describe("looseEqual", () => {
  it("compares booleans / numbers / strings by textual form", () => {
    expect(looseEqual(true, "true")).toBe(true);
    expect(looseEqual(5, "5")).toBe(true);
    expect(looseEqual(5, 5)).toBe(true);
    expect(looseEqual("on", "on")).toBe(true);
  });

  it("distinguishes values with different textual forms", () => {
    expect(looseEqual(true, "false")).toBe(false);
    expect(looseEqual(0, false)).toBe(false); // "0" vs "false"
    expect(looseEqual(1, "one")).toBe(false);
  });

  it("treats null and undefined by their textual form", () => {
    expect(looseEqual(null, null)).toBe(true);
    expect(looseEqual(undefined, undefined)).toBe(true);
    expect(looseEqual(null, undefined)).toBe(false); // "null" vs "undefined"
  });

  it("compares objects and arrays by their JSON form", () => {
    expect(looseEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(looseEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(looseEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("is JSON-order-sensitive for objects", () => {
    expect(looseEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
  });

  it("never treats an object as equal to a primitive", () => {
    expect(looseEqual({ a: 1 }, "[object Object]")).toBe(false);
    expect(looseEqual([1], "1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreCoverage — status classification
// ---------------------------------------------------------------------------

const wrap = (values: Record<string, unknown>): Record<string, { value: unknown }> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }]));

describe("scoreCoverage classification", () => {
  it("marks a matching control compliant", () => {
    const r = scoreCoverage({ mfa: true }, wrap({ mfa: true }));
    expect(r.details).toEqual([
      { key: "mfa", expected: true, actual: true, status: "compliant" },
    ]);
    expect(r.compliant).toBe(1);
    expect(r.drift).toBe(0);
    expect(r.missing).toBe(0);
  });

  it("marks a mismatching control drift", () => {
    const r = scoreCoverage({ mfa: true }, wrap({ mfa: false }));
    expect(r.details[0].status).toBe("drift");
    expect(r.drift).toBe(1);
  });

  it("marks an absent control missing with undefined actual", () => {
    const r = scoreCoverage({ mfa: true }, wrap({}));
    expect(r.details[0]).toEqual({
      key: "mfa",
      expected: true,
      actual: undefined,
      status: "missing",
    });
    expect(r.missing).toBe(1);
  });

  it("distinguishes a missing key from a key resolved to undefined (drift)", () => {
    const r = scoreCoverage({ mfa: true }, { mfa: { value: undefined } });
    expect(r.details[0].status).toBe("drift");
    expect(r.missing).toBe(0);
    expect(r.drift).toBe(1);
  });

  it("scores only baseline keys, ignoring extra resolved keys", () => {
    const r = scoreCoverage({ mfa: true }, wrap({ mfa: true, extra: 99 }));
    expect(r.total).toBe(1);
    expect(r.details.map((d) => d.key)).toEqual(["mfa"]);
  });
});

// ---------------------------------------------------------------------------
// scoreCoverage — score math (0 to 100)
// ---------------------------------------------------------------------------

describe("scoreCoverage score math", () => {
  it("is 100 when every control is compliant", () => {
    const r = scoreCoverage({ a: 1, b: 2 }, wrap({ a: 1, b: 2 }));
    expect(r.score).toBe(100);
  });

  it("is 0 when no control is compliant", () => {
    const r = scoreCoverage({ a: 1, b: 2 }, wrap({ a: 9, b: 9 }));
    expect(r.score).toBe(0);
  });

  it("counts only compliant controls toward the score (drift and missing do not)", () => {
    // 1 of 3 compliant -> round(33.33) = 33
    const r = scoreCoverage(
      { a: 1, b: 2, c: 3 },
      wrap({ a: 1, b: 9 }), // a compliant, b drift, c missing
    );
    expect(r).toMatchObject<Partial<CoverageResult>>({
      total: 3,
      compliant: 1,
      drift: 1,
      missing: 1,
      score: 33,
    });
  });

  it("rounds to the nearest integer", () => {
    // 2 of 3 compliant -> round(66.67) = 67
    const r = scoreCoverage({ a: 1, b: 2, c: 3 }, wrap({ a: 1, b: 2, c: 9 }));
    expect(r.score).toBe(67);
  });

  it("treats an empty baseline as fully compliant (100)", () => {
    const r = scoreCoverage({}, wrap({ anything: 1 }));
    expect(r).toEqual({
      total: 0,
      compliant: 0,
      drift: 0,
      missing: 0,
      score: 100,
      details: [],
    });
  });
});

// ---------------------------------------------------------------------------
// scoreCoverage — equality
// ---------------------------------------------------------------------------

describe("scoreCoverage equality", () => {
  it("uses looseEqual by default (textual coercion counts as compliant)", () => {
    const r = scoreCoverage({ mfa: true, days: 30 }, wrap({ mfa: "true", days: "30" }));
    expect(r.compliant).toBe(2);
    expect(r.score).toBe(100);
  });

  it("honors an injected strict comparator", () => {
    const strict = (e: unknown, a: unknown) => e === a;
    const r = scoreCoverage({ mfa: true }, wrap({ mfa: "true" }), { equals: strict });
    expect(r.details[0].status).toBe("drift");
    expect(r.score).toBe(0);
  });

  it("passes expected and actual to the comparator in order", () => {
    const calls: Array<[unknown, unknown]> = [];
    scoreCoverage({ k: "E" }, wrap({ k: "A" }), {
      equals: (e, a) => {
        calls.push([e, a]);
        return true;
      },
    });
    expect(calls).toEqual([["E", "A"]]);
  });
});
