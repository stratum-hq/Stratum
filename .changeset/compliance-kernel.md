---
"@stratum-hq/compliance": minor
---

feat: add @stratum-hq/compliance, a content-free compliance kernel

A new package with the pure mechanics and type shapes a compliance product
needs, and none of the content. Zero runtime dependencies, no database, no
provider, and no built-in catalog.

- `scoreCoverage(baseline, resolved, options?)` diffs a declared baseline
  against a resolved value map and returns per-control `compliant` / `drift` /
  `missing` plus a 0 to 100 coverage score. Equality is injectable and defaults
  to the exported `looseEqual` (textual form for primitives, JSON form for
  objects).
- `reconcileFinding(newOutcome, currentState)` is the finding state machine as a
  pure decision: `fail` opens a finding (unless already active or accepted),
  `pass` resolves an active one (leaving `accepted` untouched), and `na` /
  `error` are no-ops.
- A structural, content-free type vocabulary (`FieldType`, `Verification`,
  `CatalogField`, `CatalogGroup`, `ManualControl`, `ControlDef`, plus the
  scoring and finding types) for describing a catalog of controls. Bring your
  own catalog and persistence.

Starts at 0.1.0: new and unproven.
