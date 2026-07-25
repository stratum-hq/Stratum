// Baseline coverage scoring.
//
// A pure, content-free primitive for any product that measures a resolved state
// against a declared baseline. Given a baseline map (what each control is
// expected to be) and a resolved map (what each control actually is), it reports
// per-control compliant / drift / missing and an overall coverage score. It
// knows nothing about frameworks, providers, or where the values came from.

/** The computed state of one control against its baseline. */
export type ControlStatus = "compliant" | "drift" | "missing";

/** One control's contribution to a {@link CoverageResult}. */
export interface ScoredControl {
  key: string;
  expected: unknown;
  /** The resolved value, or `undefined` when the control is missing. */
  actual: unknown;
  status: ControlStatus;
}

export interface CoverageResult {
  /** Number of controls in the baseline. */
  total: number;
  compliant: number;
  drift: number;
  missing: number;
  /** 0 to 100, the share of baseline controls that are compliant. */
  score: number;
  details: ScoredControl[];
}

export interface ScoreOptions {
  /**
   * Value equality. Defaults to {@link looseEqual} (booleans / numbers /
   * strings compare by textual form, objects by JSON). Callers can override,
   * for example to compare strictly or with domain-specific tolerance.
   */
  equals?: (expected: unknown, actual: unknown) => boolean;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * The default string-loose comparator, exported for reuse.
 *
 * Objects and arrays compare by their JSON form; every other value (booleans,
 * numbers, strings, `null`, `undefined`) compares by its textual form, so
 * `true` equals `"true"` and `5` equals `"5"`. This tolerates the common case
 * where a resolved config value arrives as a string even though its baseline
 * was declared as a boolean or number. Note JSON comparison is order-sensitive:
 * objects whose keys are in a different order are treated as unequal.
 */
export function looseEqual(expected: unknown, actual: unknown): boolean {
  if (isObjectLike(expected) || isObjectLike(actual)) {
    if (!isObjectLike(expected) || !isObjectLike(actual)) return false;
    return JSON.stringify(expected) === JSON.stringify(actual);
  }
  return String(expected) === String(actual);
}

/**
 * Diff a declared baseline against a resolved value map. Pure. No IO.
 *
 * Only the keys present in `baseline` are scored; extra keys in `resolved` are
 * ignored. A baseline key with no matching entry in `resolved` is `missing`; a
 * matching entry whose value satisfies `equals` is `compliant`, otherwise it is
 * `drift`. An empty baseline scores 100 (nothing is required, so nothing is out
 * of compliance).
 */
export function scoreCoverage(
  baseline: Record<string, unknown>,
  resolved: Record<string, { value: unknown }>,
  options?: ScoreOptions,
): CoverageResult {
  const equals = options?.equals ?? looseEqual;
  const details: ScoredControl[] = [];
  let compliant = 0;
  let drift = 0;
  let missing = 0;

  for (const key of Object.keys(baseline)) {
    const expected = baseline[key];
    const entry = resolved[key];

    if (entry === undefined) {
      missing++;
      details.push({ key, expected, actual: undefined, status: "missing" });
      continue;
    }

    const actual = entry.value;
    if (equals(expected, actual)) {
      compliant++;
      details.push({ key, expected, actual, status: "compliant" });
    } else {
      drift++;
      details.push({ key, expected, actual, status: "drift" });
    }
  }

  const total = details.length;
  const score = total === 0 ? 100 : Math.round((compliant / total) * 100);

  return { total, compliant, drift, missing, score, details };
}
