// Finding state machine.
//
// A pure decision function for reconciling a control's finding when a new
// evaluation outcome arrives. It decides only what should happen (open a
// finding, resolve the active one, or do nothing); persisting that decision is
// the caller's job. This keeps the transition rules testable in isolation from
// any storage.

/** The outcome of evaluating a single control. */
export type ControlOutcome = "pass" | "fail" | "na" | "error";

/** The current state of a control's finding. `none` means no finding exists. */
export type FindingState =
  | "open"
  | "remediating"
  | "resolved"
  | "accepted"
  | "none";

export type FindingAction =
  | { type: "open" } // a new gap: caller should create a finding
  | { type: "resolve" } // gap closed: caller should resolve the active finding
  | { type: "noop" }; // nothing to do

/**
 * Decide what should happen to a control's finding given the new evaluation
 * outcome and the current finding state. Pure.
 *
 * Rules:
 * - `fail` opens a finding, unless one is already active (`open` /
 *   `remediating`) or the risk was formally `accepted`.
 * - `pass` resolves an active finding (`open` / `remediating`), and leaves an
 *   `accepted` finding untouched; there is nothing to resolve otherwise.
 * - `na` and `error` never change a finding.
 */
export function reconcileFinding(
  newOutcome: ControlOutcome,
  currentState: FindingState,
): FindingAction {
  switch (newOutcome) {
    case "fail":
      if (
        currentState === "open" ||
        currentState === "remediating" ||
        currentState === "accepted"
      ) {
        return { type: "noop" };
      }
      return { type: "open" };

    case "pass":
      if (currentState === "open" || currentState === "remediating") {
        return { type: "resolve" };
      }
      return { type: "noop" };

    case "na":
    case "error":
      return { type: "noop" };
  }
}
