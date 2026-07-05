# @stratum-hq/core

## 0.3.1

### Patch Changes

- c55da6e: Fix `getAncestors` returning an empty or incomplete ancestor chain. `getAncestorIds` assumed ancestry paths include the tenant's own id and sliced off the last element — but paths store only the ancestor chain, so every depth-1 tenant reported zero ancestors and deeper tenants lost their direct parent. `getSelfId` docs corrected to reflect that the last path element is the direct parent.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.
