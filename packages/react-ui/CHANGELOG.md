# @stratum-hq/react

## 0.7.0

### Minor Changes

- b9122c5: Restyle the shipped stylesheet (`@stratum-hq/react/styles`) with the Stratum Bedrock identity.

  - New type: Big Shoulders Display, Instrument Sans and Martian Mono replace the previous typefaces. The stylesheet's Google Fonts `@import` loads the new families.
  - New palette: the Bedrock (dark) and Daylight (light) values from the shared tokens, with five rock bands, magma as the one accent and vein teal for inherited values. Every existing `--color-*` alias still resolves; new tokens include `--magma`, `--vein`, `--flow`, `--lock`, `--rule`, `--focus`, the rock bands and `--on-*` inks.
  - No rounded corners: `--radius-*` are now `0`. Buttons, tags, fields, tree rows and panels take their shape from clip-path edges, with a rock lip and a soft shadow.
  - `TenantTree` and `DraggableTenantTree` draw each tenant as a rock band colored by depth, with a 28px stagger per level. Badges show a glyph plus the word (locked, inherited, delegated, own).
  - Dark is now the default for everyone. The stylesheet no longer switches to the light palette from the operating system's `prefers-color-scheme`; set `data-theme="light"` on an ancestor to opt in to Daylight.
  - Keyboard focus is a 3px `--focus` ring with a halo, and every animation stops under `prefers-reduced-motion`.

## 0.6.0

### Minor Changes

- 99437c5: Sensitive config values are still inherited, but reads of a descendant's config now return them masked: `value: null`, `sensitive: true` and `masked: true`, with `source_tenant_id` naming the tenant that set the value. A tenant's own sensitive values are unchanged.

  - `@stratum-hq/lib`: `resolveConfig`, `getConfigWithInheritance`, `getTenantContext` and `diffConfig` take an optional `ResolveConfigOptions`. Pass `{ revealSensitive: true }` in trusted server code that needs an inherited secret, or `{ viewerTenantId }` to reveal only the values that tenant set.
  - `@stratum-hq/control-plane`: the config, inheritance, diff and context routes reveal an inherited sensitive value only to a key of the tenant that set it. Global keys get the masked entry and can read the value from the owning tenant's own config.
  - `@stratum-hq/react`: `ConfigEditor` and `ConfigInheritanceVisualizer` show a masked value as "Sensitive value set by an ancestor" and never pre-fill it into the edit field.
  - `@stratum-hq/core`: `ResolvedConfigEntry` and `ConfigDiffEntry` gain optional `sensitive` and `masked` fields, and `ResolveConfigOptions` is exported.

  (GHSA-mg93-96h7-h9fq)

### Patch Changes

- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
  - @stratum-hq/core@1.6.0

## 0.5.2

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.
- Updated dependencies [b737034]
- Updated dependencies [a1bd9aa]
  - @stratum-hq/core@1.5.1

## 0.5.1

### Patch Changes

- b47f84f: Make the build copy of `src/migrations` (lib) and `src/styles` (react) replace the old copy in `dist`. A rebuild without a clean no longer creates `dist/migrations/migrations` or `dist/styles/styles`, and it no longer keeps stale top-level files. Published tarballs do not change, because the release job builds from a clean checkout.
- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- Updated dependencies [7e9ebcf]
- Updated dependencies [329cb16]
- Updated dependencies [e7e7b74]
- Updated dependencies [329cb16]
- Updated dependencies [cd7b950]
- Updated dependencies [694a3d3]
- Updated dependencies [694a3d3]
  - @stratum-hq/core@1.4.0

## 0.5.0

### Minor Changes

- 1669fd7: Harden defaults in generated projects, CLI checks, React hooks and test helpers (GHSA-rrrp-gww6-44gr). Behavior changes: `StratumProvider`'s `apiKey` is optional and generated React code uses a server-side proxy instead; `TenantThemeProvider` ignores `customCss` that is not plain declarations; `assertConfigInheritance` now takes a Stratum instance instead of a pg pool.

### Patch Changes

- Updated dependencies [dca0826]
  - @stratum-hq/core@1.3.0

## 0.4.1

### Patch Changes

- Retheme the shipped component styles (`dist/styles/default.css`) to the "Strata" earth-toned palette (peat/loam/ember) and Libre Franklin / IBM Plex Sans / IBM Plex Mono typefaces, replacing the previous, already-drifted palette. No component API changes; consumers who import the stylesheet will see updated colors and fonts.
- Updated dependencies [36f69d8]
  - @stratum-hq/core@1.2.1

## 0.4.0

### Minor Changes

- c17b1a5: Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

  The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

  If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
- Updated dependencies [b55ae70]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [5e87692]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/core@1.0.0

## 0.3.1

### Patch Changes

- Support React 19: widen the `react`/`react-dom` peer ranges to `^18 || ^19`. The components are compatible; the old `^18` cap forced `--legacy-peer-deps` on React 19 apps. Found while deploying the MSP reference app on Next 15 / React 19.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
