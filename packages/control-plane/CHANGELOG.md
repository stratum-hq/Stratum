# @stratum-hq/control-plane

## 0.4.0

### Minor Changes

- ab53239: Enforce default-deny authorization on the control plane. Every route must declare its tenant scope; a route that declares none is refused, so a route added without a guard fails closed rather than serving data.
- f96c3b4: Scope the config diff and role administration routes to the caller key's subtree. A tenant-scoped API key may now diff and administer roles only within its own tenant and descendants: the config diff authorizes both compared tenants (query `tenant_a`/`tenant_b`), role create/list authorize the tenant read from the body/query, and the role-by-id and role-assignment routes authorize the target role's and API key's owning tenant. Global operator keys (tenant_id null) keep full access.

### Patch Changes

- 4c53aa5: Harden control-plane authorization. Admin-scope enforcement is evaluated from the resolved request path. Tenant creation is confined to the caller's key scope: a tenant-scoped key may only create tenants within its own subtree and may not create new root tenants, while global (operator) keys remain unrestricted. The batch create route is authorized the same way as single create.
- Updated dependencies [eaffc2d]
- Updated dependencies [f96c3b4]
- Updated dependencies [718d977]
- Updated dependencies [abc555d]
- Updated dependencies [e46ffeb]
  - @stratum-hq/lib@0.6.0

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
  - @stratum-hq/lib@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
- Updated dependencies
  - @stratum-hq/lib@0.2.4
