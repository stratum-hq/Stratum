# @stratum-hq/nestjs

## 0.3.1

### Patch Changes

- 1a0b9b5: Make the verified JWT tenant authoritative in `StratumGuard`. Tenant resolution now runs JWT (verified) before the `X-Tenant-ID` header, so the header is only consulted as a fallback when no verified JWT tenant is present and can never override a verified identity. This aligns the guard's resolution order with the Express and Fastify middleware.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
  - @stratum-hq/sdk@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
