import { describe, it, expect } from "vitest";
import {
  reconcileFinding,
  type ControlOutcome,
  type FindingState,
  type FindingAction,
} from "../index.js";

// Full truth table: every one of the 4 outcomes against every one of the 5
// states. `open` = create a finding, `resolve` = close the active one, `noop` =
// leave the finding as-is.
const OUTCOMES: ControlOutcome[] = ["pass", "fail", "na", "error"];
const STATES: FindingState[] = [
  "open",
  "remediating",
  "resolved",
  "accepted",
  "none",
];

type ActionType = FindingAction["type"];

// outcome -> state -> expected action
const TRUTH: Record<ControlOutcome, Record<FindingState, ActionType>> = {
  fail: {
    open: "noop", // already active
    remediating: "noop", // already active
    resolved: "open", // regression: reopen
    accepted: "noop", // risk formally accepted, leave alone
    none: "open", // brand new gap
  },
  pass: {
    open: "resolve", // gap closed
    remediating: "resolve", // gap closed
    resolved: "noop", // nothing active to resolve
    accepted: "noop", // accepted untouched
    none: "noop", // nothing to do
  },
  na: {
    open: "noop",
    remediating: "noop",
    resolved: "noop",
    accepted: "noop",
    none: "noop",
  },
  error: {
    open: "noop",
    remediating: "noop",
    resolved: "noop",
    accepted: "noop",
    none: "noop",
  },
};

describe("reconcileFinding truth table", () => {
  for (const outcome of OUTCOMES) {
    for (const state of STATES) {
      const expected = TRUTH[outcome][state];
      it(`${outcome} + ${state} -> ${expected}`, () => {
        expect(reconcileFinding(outcome, state)).toEqual({ type: expected });
      });
    }
  }
});

describe("reconcileFinding invariants", () => {
  it("only ever opens on fail", () => {
    for (const state of STATES) {
      for (const outcome of OUTCOMES) {
        if (reconcileFinding(outcome, state).type === "open") {
          expect(outcome).toBe("fail");
        }
      }
    }
  });

  it("only ever resolves on pass", () => {
    for (const state of STATES) {
      for (const outcome of OUTCOMES) {
        if (reconcileFinding(outcome, state).type === "resolve") {
          expect(outcome).toBe("pass");
        }
      }
    }
  });

  it("never touches an accepted finding", () => {
    for (const outcome of OUTCOMES) {
      expect(reconcileFinding(outcome, "accepted")).toEqual({ type: "noop" });
    }
  });

  it("na and error are always no-ops", () => {
    for (const state of STATES) {
      expect(reconcileFinding("na", state)).toEqual({ type: "noop" });
      expect(reconcileFinding("error", state)).toEqual({ type: "noop" });
    }
  });
});
