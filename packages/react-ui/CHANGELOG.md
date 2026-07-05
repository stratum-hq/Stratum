# @stratum-hq/react

## 0.3.1

### Patch Changes

- Support React 19: widen the `react`/`react-dom` peer ranges to `^18 || ^19`. The components are compatible; the old `^18` cap forced `--legacy-peer-deps` on React 19 apps. Found while deploying the MSP reference app on Next 15 / React 19.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
