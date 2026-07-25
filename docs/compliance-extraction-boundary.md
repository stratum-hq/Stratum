# Compliance extraction boundary (@stratum-hq/compliance)

Status: PROPOSAL (for PM and user review). Nothing here is built or moved.
Date: 2026-07-25
Issue: stratum-hq/Stratum#136 (FR-57), under epic #135.
Scope of this document: design and analysis only. It maps Tenantry's existing
compliance functionality, draws a line between the reusable engine mechanics and
Tenantry's proprietary product value, and frames the open-source decision for the
user. It does NOT move code, create the package, or change any export. #137 builds
the package and #138 migrates Tenantry, both only after sign-off on this boundary.

## How to read this

- This repo is PUBLIC and every `@stratum-hq/*` package is MIT. Anything named as
  belonging to `@stratum-hq/compliance` below becomes open source the moment #137
  lands. Anything named as "stays in Tenantry" remains proprietary.
- The engine candidate is the MECHANICS: the algorithms and the type vocabulary
  that any compliance product needs. The product value is the CONTENT (which
  controls, mapped to which real settings, for which framework) and the pipeline
  around it (connectors, persistence, UI, billing). This document keeps Tenantry's
  content out of it deliberately, because the document itself is public.
- Every inventory claim is grounded in a file path in the Tenantry checkout
  (`stratum-hq/stratum-msp`). Line-level reproduction of proprietary catalogs is
  intentionally omitted.

---

## 1. TL;DR and recommendation

Tenantry's compliance surface splits cleanly into a small pure-computation core and
a large product. The reusable core is roughly 250 to 350 lines: two algorithms
(config-to-baseline scoring, and a finding state machine) plus a type vocabulary.
Everything else (the framework catalog content, the connector/evidence pipeline,
persistence, API routes, entitlement gating, UI, reports) is Tenantry product.

Recommended boundary (Option A below):

- Extract into `@stratum-hq/compliance` ONLY the pure, content-free, database-free
  mechanics: the scoring / coverage function, the finding (drift) state machine as
  a pure decision function, and a minimal structural type vocabulary. The package
  owns NO data model, does NO SQL, and knows NOTHING about Microsoft 365, Google,
  CMMC, HIPAA, or any specific control.
- Tenantry keeps: the entire framework catalog and control content, the connector /
  evidence / verification pipeline, every `msp_*` table and all SQL, the API routes,
  the subscription gating, the cron sweep, the reports, and all UI.

Why this line: the moat is the catalog content and the evidence pipeline, not the
arithmetic that turns a baseline plus a resolved config into a percentage, nor the
three-state transition rule that opens and closes a finding. Those mechanics are
commodity and safe to publish; the content is competitive and stays closed.

The decision the user must make is in section 8. It is not "where is the clean
line" (that is section 4, and it is clean). It is "should even the commodity
mechanics be open-sourced, given the package is small and publishing the type
vocabulary discloses how Tenantry models compliance." That is a business call.

---

## 2. What exists today

Grounded inventory of Tenantry's compliance functionality.

### Core library (`src/lib/`)

| File | What it is | Real logic |
|---|---|---|
| `compliance.ts` | Posture engine. Diffs a framework baseline (`config_snapshot`) against a tenant's resolved config, producing per-control `compliant` / `drift` / `missing` plus a 0 to 100 score. `computePosture` (single) and `computePostureForClients` (batch roll-up). | `looseEqual` + `scoreSnapshot` are ~55 lines of pure scoring. The `compute*` wrappers add SQL against `msp_client_frameworks` + `onboarding_presets` and a call to `stratum.resolveConfig`. |
| `framework-catalog.ts` | The catalog of config keys a framework can set: labels, types, dropdown options, per-key help, the verified / attestation / declared verification model, and the plain-language mapping to the real M365 / Google setting. | Types (~40 lines) are generic shape. The `FRAMEWORK_CATALOG` and `CATALOG_GROUPS` data is proprietary product content. |
| `attestations.ts` | The manual-controls catalog: framework requirements no API can prove, covered by a signed operator attestation instead. | `ManualControl` type is generic shape. The `MANUAL_CONTROLS` data (which controls, which frameworks they satisfy) is proprietary content. |
| `audit-package.ts` | Assembles the auditor-ready evidence package for one client: declared posture, verified-control history, raw provider evidence, the POA&M trail, and manual attestations, with per-section error isolation. | The `section()` isolation helper (~15 lines) and the `AuditPackage` envelope shape are generic. `buildAuditPackage` itself is bound to five `msp_*` tables and Tenantry's product model. |

### Connector layer (`src/lib/connectors/`)

| File | What it is | Classification signal |
|---|---|---|
| `verify.ts` | Turns raw provider evidence into provider-agnostic signals, then runs control tests against thresholds to produce pass / fail / na / error. Holds `CONTROL_DEFS` (the verified-control catalog) and the `Signals` model. | The `VerifiedStatus` / `ControlDef` / `ControlResult` shapes are a generic state model. `Signals`, `CONTROL_DEFS`, the thresholds, and the Graph / Google parsers are proprietary. Not a clean extraction target. |
| `drift.ts` | Continuous drift detection. Compares each control's new status against its previous latest and maintains a finding: into `fail` opens, back to `pass` resolves, `accepted` is left alone, `na` / `error` are no-ops. | The transition RULES are a generic state machine (~15 lines of decision logic). The implementation is inline SQL against `msp_findings`. |
| `sync.ts`, `drift-sweep.ts`, `provider.ts`, `m365-simulated.ts`, `google-simulated.ts` | Provider integration, sync orchestration, the sweep runner. | Entirely Tenantry-specific. Not a candidate. |

### Product surface (routes, cron, UI)

- `src/app/api/compliance/[tenantId]/export.csv/route.ts` and
  `src/app/api/reports/compliance/export.csv/route.ts`: CSV evidence export, gated
  behind an active subscription (`getMspEntitlements`), with RFC 4180 plus
  formula-injection-safe CSV formatting.
- `src/app/api/cron/compliance-drift/route.ts`: the scheduled drift sweep endpoint,
  authorized by a shared `x-cron-secret`.
- `src/app/(msp)/compliance/*`, `src/app/compliance/[tenantId]/report/*`,
  `src/app/portal/[slug]/modules/compliance.tsx`: the operator roll-up, the printable
  client report, and the client-portal module.

All of the product surface is Tenantry-specific by construction (Next.js routes,
entitlements, NextAuth, the Roofline design system).

### Data model (all Tenantry-owned tables, defined in `db/migrate.ts`)

`msp_client_frameworks`, `onboarding_presets`, `msp_connections`,
`msp_evidence_snapshots`, `msp_control_results`, `msp_findings`,
`msp_attestations`, `msp_posture_snapshots`. These are Tenantry's, not Stratum's.
None of them is proposed for extraction.

---

## 3. How it composes with @stratum-hq/lib today

Tenantry's compliance code already reaches Stratum only through the public client
(`getStratum()` in `src/lib/stratum.ts`), consistent with the repo's boundary rule.
The touch points that matter for extraction:

- `stratum.resolveConfig(tenantId)`: the posture engine's input. The scoring is a
  diff of a baseline against this resolved config map.
- `stratum.getDescendants(tenantId)`: the audit package scopes to the client subtree.
- `stratum.getTenant(tenantId)`: tenant name for the package header.
- Audit write: compliance state changes (an attestation signed, a finding accepted)
  can be recorded through the app-facing audit-write API that `@stratum-hq/lib` now
  exports (landed under #198 / #236), rather than a Tenantry-owned audit table.
- RLS: all persistence runs on Tenantry's RLS-scoped pool (`app.current_tenant_id`,
  see the scoped-job pattern and ADR 0001). Tenant isolation is enforced at the
  data plane, below any compliance code.

The important consequence: the reusable mechanics do not need any of this. Scoring
and the state machine are pure functions over data the caller already loaded. The
composition with `@stratum-hq/lib` (resolveConfig, getDescendants, audit, RLS) stays
entirely on the Tenantry side of the boundary. That is what lets the engine be a
zero-dependency, database-free, tenant-model-agnostic package.

---

## 4. Classification: engine mechanics vs Tenantry product

The test applied to each piece: does it need Tenantry's schema, Tenantry's catalog
content, a provider, or the product UI to be meaningful? If yes, it stays. If it is
a pure function or a structural type that any compliance product would need, it is
an engine candidate.

### Engine candidates (generic mechanics)

| Piece | Source today | Why it is generic |
|---|---|---|
| Scoring / coverage computation | `scoreSnapshot` + `looseEqual` in `compliance.ts` | Given a baseline map and a resolved-value map, compute per-key compliant / drift / missing and a coverage score. No schema, no content, no provider. Any product that measures "resolved state against a declared baseline" needs exactly this. |
| Finding state machine | the transition rules inside `detectDrift` in `drift.ts` | Given a control's previous status, its new status, and whether an active or accepted finding exists, decide: open, resolve, or no-op. Pure decision. The persistence is separable. |
| Framework / control type vocabulary | `CatalogField`, `FieldType`, `Verification`, `CatalogGroup` (`framework-catalog.ts`); `ManualControl` (`attestations.ts`); `ControlStatus`, `PostureControl`, `PostureResult` (`compliance.ts`); `VerifiedStatus`, `ControlDef`, `ControlResult` (`verify.ts`) | The SHAPES for describing a control, its verification method, and its computed status. Reusable by definition. Note the disclosure tradeoff in section 6 and 8: the shapes reveal the conceptual model even though they carry no content. |
| Catalog lookup helpers | `catalogField` / `isKnownKey` (`framework-catalog.ts`); `manualControl` / `isManualControl` (`attestations.ts`) | Trivial map lookups. Generic only if generalized to operate over a caller-supplied catalog rather than the built-in one. |
| Per-section error isolation | `section()` in `audit-package.ts` | A generic "run this section, capture its failure, keep going" helper. Arguably belongs in `@stratum-hq/lib` utilities rather than a compliance package. |

### Stays in Tenantry (proprietary product value)

| Piece | Source today | Why it stays |
|---|---|---|
| All framework and control CONTENT | `FRAMEWORK_CATALOG`, `CATALOG_GROUPS`, `MANUAL_CONTROLS`, `CONTROL_DEFS`, every M365 / Google mapping and threshold | This is the competitive knowledge: what to check, how it maps to a real provider setting, which framework it satisfies. The single most valuable thing in the compliance feature. |
| The connector / evidence / verification pipeline | `verify.ts` evaluation, `sync.ts`, `provider.ts`, the provider adapters | Turning real provider evidence into verdicts is core product. |
| All persistence and data loading | the SQL wrappers in `computePosture` / `computePostureForClients`, `buildAuditPackage`, `detectDrift`; every `msp_*` table | Tenantry's schema and tenancy model. |
| The audit package assembler | `buildAuditPackage` | Bound to five `msp_*` tables and the product's evidence model. Only its envelope shape and `section()` helper are generic. |
| All API routes, cron, entitlement gating, reports, UI | `src/app/api/compliance/*`, `src/app/api/cron/compliance-drift/*`, `src/app/(msp)/compliance/*`, the portal module | Product surface. |

---

## 5. Proposed @stratum-hq/compliance public API surface

Design intent: a pure, zero-database, zero-provider computation kernel. No `pg`
dependency, no network, no built-in catalog. The caller supplies data; the package
returns results and decisions. This keeps the package free of Tenantry's schema,
free of the six-table Stratum boundary rules, and reusable by any Stratum app.

Placement: `packages/compliance`, name `@stratum-hq/compliance`. Runtime dependency
on `@stratum-hq/core` only if it throws a shared error class; otherwise zero runtime
dependencies. Pure TypeScript, same build and semver policy as the other packages
(see `docs/v1.0-api-surface.md`).

### 5.1 Scoring / coverage

```ts
export type ControlStatus = "compliant" | "drift" | "missing";

export interface ScoredControl {
  key: string;
  expected: unknown;
  actual: unknown;
  status: ControlStatus;
}

export interface CoverageResult {
  total: number;
  compliant: number;
  drift: number;
  missing: number;
  /** 0 to 100, share of baseline controls that are compliant. */
  score: number;
  details: ScoredControl[];
}

export interface ScoreOptions {
  /** Value equality. Defaults to string-loose (booleans / numbers / strings
   *  compare by textual form, objects by JSON). Callers can override. */
  equals?: (expected: unknown, actual: unknown) => boolean;
}

/** Diff a declared baseline against a resolved value map. Pure. No IO. */
export function scoreCoverage(
  baseline: Record<string, unknown>,
  resolved: Record<string, { value: unknown }>,
  options?: ScoreOptions,
): CoverageResult;

/** The default string-loose comparator, exported for reuse. */
export function looseEqual(expected: unknown, actual: unknown): boolean;
```

This is `scoreSnapshot` / `looseEqual` lifted verbatim in behavior, with the
equality made injectable and the framework-name / assigned fields dropped (those
are Tenantry concerns the caller layers back on).

### 5.2 Finding state machine

```ts
export type ControlOutcome = "pass" | "fail" | "na" | "error";
export type FindingState = "open" | "remediating" | "resolved" | "accepted" | "none";

export type FindingAction =
  | { type: "open" }      // a new gap: caller should create a finding
  | { type: "resolve" }   // gap closed: caller should resolve the active finding
  | { type: "noop" };     // nothing to do

/**
 * Decide what should happen to a control's finding given the new evaluation
 * outcome and the current finding state. Pure. Encodes the rules today in
 * detectDrift: into fail opens (unless already active or accepted), back to
 * pass resolves (leaving accepted untouched), na / error are no-ops.
 */
export function reconcileFinding(
  newOutcome: ControlOutcome,
  currentState: FindingState,
): FindingAction;
```

Tenantry keeps the persistence: it maps `open` to the guarded `INSERT` and
`resolve` to the `UPDATE` on `msp_findings`, preserving the partial-unique index
and the idempotency guarantees that live in SQL today.

### 5.3 Type vocabulary (structural, content-free)

```ts
export type FieldType = "boolean" | "number" | "enum";
export type Verification = "verified" | "attestation" | "declared";

export interface CatalogField {
  key: string;
  label: string;
  group: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  presets?: { value: number; label: string }[];
  help: string;
  verification: Verification;
  verifiedControl?: string;
}

export interface CatalogGroup { name: string; blurb: string; }

export interface ManualControl {
  key: string;
  label: string;
  frameworks: string[];
  description: string;
}

export interface ControlDef {
  key: string;
  label: string;
  declaredKey: string | null;
}
```

These are the shapes only. The `microsoft365` / `googleWorkspace` mapping fields on
`CatalogField`, the `resources` field on `ControlDef`, the `Signals` model, and
every catalog VALUE stay in Tenantry (they are provider-specific content). Whether
to publish even these empty shapes is the disclosure question in section 8.

### 5.4 Optional: catalog helpers and section isolation

```ts
export class Catalog<T extends { key: string }> {
  constructor(fields: T[]);
  get(key: string): T | undefined;
  has(key: string): boolean;
}

export async function isolateSection<T>(
  onError: (name: string, err: unknown) => void,
  name: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T>;
```

Low value. `Catalog` generalizes the trivial `BY_KEY` lookups; `isolateSection`
generalizes `section()` from `audit-package.ts` and is really a generic utility.
Recommend deferring both, or routing `isolateSection` to `@stratum-hq/lib` instead.

### What is NOT in the surface

No `computePosture`, no `buildAuditPackage`, no `detectDrift`, no CSV export, no
provider code, no catalog data, no `pg` types, no `Stratum` coupling. Those are the
Tenantry-side wrappers that load data, call the pure kernel, and persist the result.

---

## 6. What becomes PUBLIC if extracted

Stated plainly so the user can weigh it. Under the recommended boundary, the public,
MIT-licensed surface would be:

1. A string-loose config-to-baseline scoring algorithm returning a coverage score.
2. A three-outcome finding state machine (open / resolve / noop).
3. A set of empty structural TypeScript interfaces describing a control, its
   verification method (verified / attestation / declared), and its computed status.

What does NOT become public: every framework, every control, every mapping to a real
Microsoft 365 or Google setting, every threshold, the evidence pipeline, the audit
package assembler, the schema, and the entire product surface.

Honest assessment of the disclosure:

- The two algorithms are commodity. A competent engineer reconstructs config-diff
  scoring and a fail-to-open / pass-to-resolve rule in an afternoon. Publishing them
  gives away little.
- The type vocabulary is a softer disclosure. It reveals HOW Tenantry models
  compliance: the verified / attestation / declared honesty model, the idea of a
  declared control keyed to a verified control (`verifiedControl` / `declaredKey`),
  the catalog-field shape. This is the schema of the moat, not the moat, but it does
  telegraph the product's conceptual approach.
- The moat itself (the catalog content and the evidence pipeline) is not disclosed
  under any option here. No option in this document open-sources framework content.

---

## 7. Migration approach for #138 (how Tenantry consumes it)

Sequenced so Tenantry behavior is unchanged and the diff is mechanical.

1. #137 builds `@stratum-hq/compliance` with the section 5 surface, ported verbatim
   in behavior from Tenantry's current logic, with unit tests that pin the scoring
   output and the state-machine truth table.
2. #138 in Tenantry:
   - `src/lib/compliance.ts` keeps `computePosture` / `computePostureForClients`,
     but their internal `scoreSnapshot` / `looseEqual` are replaced by
     `scoreCoverage` / `looseEqual` from the package. The SQL and `resolveConfig`
     call are untouched. `PostureResult` becomes `CoverageResult` plus Tenantry's
     `assigned` / `framework_name` fields layered on.
   - `src/lib/connectors/drift.ts` keeps `detectDrift` and its SQL, but the branch
     decision (into-fail / back-to-pass / no-op) is replaced by `reconcileFinding`.
     The guarded INSERT / UPDATE and the partial-unique guarantees stay exactly as
     they are.
   - `framework-catalog.ts` and `attestations.ts` keep all their DATA and re-import
     the type SHAPES from the package instead of declaring them locally. Provider
     mapping fields stay as a Tenantry-side extension of `CatalogField`.
   - `audit-package.ts`, `verify.ts`, the routes, cron, and UI are untouched, except
     for importing shared types.
3. Verification: Tenantry's existing compliance tests must pass unchanged, because
   behavior is identical. That is the acceptance gate for #138.

What stays proprietary after migration: everything in the "stays in Tenantry" column
of section 4. Tenantry consumes the engine exactly the way it consumes
`@stratum-hq/lib` today, through a narrow public surface, keeping content and
persistence on its side of the line.

---

## 8. Decisions for the user

The boundary (sections 4 and 5) is clean and I recommend it as drawn. These are the
calls that are yours, not mine, because they are business decisions, not engineering
ones.

### Decision 1: open-source the mechanics at all?

The reusable, content-free core is small (roughly 250 to 350 lines, mostly types and
two short algorithms). Three defensible positions:

- Option A (recommended): extract the pure mechanics and the type vocabulary into
  `@stratum-hq/compliance`. Publishes only commodity algorithms and empty shapes;
  keeps all content and the pipeline closed. Gives other Stratum apps a real
  compliance-scoring primitive and gives Tenantry a clean, tested dependency.
- Option B (narrowest): extract ONLY the two algorithms (`scoreCoverage`,
  `reconcileFinding`) and the minimal status enums. Leave the richer type vocabulary
  (`CatalogField`, `Verification`, `ControlDef`) inside Tenantry, so the conceptual
  model is not disclosed. Less reuse, least disclosure.
- Option C (keep it closed): do not create the package. Keep the mechanics as a
  Tenantry-internal module. Justified if the compliance model is considered core IP,
  or if a ~300-line public package is not worth the semver, docs, and maintenance
  overhead. This is the conservative default for a proprietary product and is a
  legitimate outcome of this issue.

My recommendation is A, with the explicit note that the value to the open-source
project is modest and the value to Tenantry is mostly hygiene (a tested, shared
kernel). If the user does not want to disclose the verification model shapes, B is
the honest middle. If the mechanics are seen as too small to be worth a package,
C is fine and this epic can stop here.

### Decision 2: if extracting, how much of the type vocabulary?

Independent of Decision 1's A vs B: the algorithms carry no product information, but
the `CatalogField` / `Verification` shapes reveal the model. Publish the algorithms
either way; decide separately whether the vocabulary ships (A) or stays private (B).

### Decision 3: proceed to #137 / #138?

#137 (build) and #138 (migrate Tenantry) should not start until Decisions 1 and 2
are made. If Option C, close #137 and #138. If Option A or B, #137 builds to the
section 5 surface trimmed to the chosen scope.

---

## 9. Risks and open questions

- Package size vs overhead: a ~300-line package still carries the full cost of a
  published, versioned, documented `@stratum-hq/*` unit. Flagged in Decision 1.
- Disclosure of the verification model: the `verified / attestation / declared`
  vocabulary is a genuine product idea. Option B exists precisely to avoid publishing
  it. Called out in section 6 and Decision 2.
- Behavior parity: `looseEqual` is intentionally loose (textual coercion, JSON for
  objects). Any consumer expecting strict typing will be surprised. The injectable
  `equals` in `ScoreOptions` mitigates this, and the default must be documented.
- No catalog in the package by design: consumers must bring their own control
  catalog. This is correct (the catalog is the product), but it means the package is
  a kernel, not a turnkey compliance feature. Worth stating clearly in its README so
  it is not mistaken for a batteries-included compliance solution.
- The `section()` / `isolateSection` helper is arguably misplaced in a compliance
  package; if it is extracted at all it likely belongs in `@stratum-hq/lib`.
