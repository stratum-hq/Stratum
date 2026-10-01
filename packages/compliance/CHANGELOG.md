# @stratum-hq/compliance

## 0.1.3

### Patch Changes

- 99437c5: `reconcileFinding` throws a `TypeError` that names the value for an unknown control outcome, instead of returning `undefined`. (#477)
- 99437c5: README corrections (#476). lib: the usage metering link works on npm. control-plane: how to start it from an npm install, the health check at `/api/v1/health`, the OpenAPI URLs, and how to create the first admin key. db-adapters: the Sequelize wrapper scopes `query()` only. hono: the quick start defines `sdkClient`. mysql: the TypeORM subscriber reads the tenant from the `@stratum-hq/sdk` context, set with `runWithTenantContext` outside the SDK middleware. compliance: links to its new documentation page.

## 0.1.2

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.

## 0.1.1

### Patch Changes

- 7e9ebcf: `scoreCoverage` now scores a baseline key as `missing` when `resolved` has no own entry for it. Before, a key that names an `Object.prototype` member, such as `constructor` or `toString`, read the inherited member and was scored as `drift`.

## 0.1.0

### Minor Changes

- dd275d9: feat: add @stratum-hq/compliance, a content-free compliance kernel

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

## 0.2.0

### Minor Changes

- dd275d9: feat: add @stratum-hq/compliance, a content-free compliance kernel

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

## 0.2.0

### Minor Changes

- dd275d9: feat: add @stratum-hq/compliance, a content-free compliance kernel

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
