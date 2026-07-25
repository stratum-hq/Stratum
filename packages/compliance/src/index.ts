// @stratum-hq/compliance
//
// A content-free compliance kernel: baseline coverage scoring, a finding state
// machine, and a control type vocabulary. Pure TypeScript, zero runtime
// dependencies, no database, no provider, no built-in catalog. Bring your own
// catalog and persistence; this package supplies only the mechanics and shapes.

export { scoreCoverage, looseEqual } from "./scoring.js";
export type {
  ControlStatus,
  ScoredControl,
  CoverageResult,
  ScoreOptions,
} from "./scoring.js";

export { reconcileFinding } from "./finding.js";
export type { ControlOutcome, FindingState, FindingAction } from "./finding.js";

export type {
  FieldType,
  Verification,
  CatalogField,
  CatalogGroup,
  ManualControl,
  ControlDef,
} from "./types.js";
