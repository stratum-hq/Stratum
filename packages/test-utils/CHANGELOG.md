# @stratum-hq/test-utils

## 0.4.1

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.

## 0.4.0

### Minor Changes

- 1669fd7: Harden defaults in generated projects, CLI checks, React hooks and test helpers (GHSA-rrrp-gww6-44gr). Behavior changes: `StratumProvider`'s `apiKey` is optional and generated React code uses a server-side proxy instead; `TenantThemeProvider` ignores `customCss` that is not plain declarations; `assertConfigInheritance` now takes a Stratum instance instead of a pg pool.
- dca0826: Harden MongoDB tenant scoping in the shared-collection proxy and Mongoose plugin, and make `assertMongoIsolation` run through the adapter under test (GHSA-699c-qcjr-hw36).

## 0.3.1

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.
