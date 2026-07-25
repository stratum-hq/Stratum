# @stratum-hq/control-plane

## 1.0.0

### Major Changes

- 5e87692: Unify API-key scope resolution and make scope checks hierarchical (FR-53, #132).

  Two authorization-semantics changes land together:
  - **Hierarchical scopes.** Scope requirements are now checked with a rank
    comparison (`read` < `write` < `admin`) instead of flat set membership, so
    `admin` implies `write` implies `read`. A key minted as `["admin"]` or
    `["write"]` now satisfies the lower-scope routes it previously failed. A new
    `scopeSatisfies(granted, required)` helper in `@stratum-hq/core` is the single
    scope-check primitive; the control-plane authorize middleware uses it. This
    changes same-tenant behavior by scope level only and does not alter any
    cross-tenant boundary.
  - **Single scope source.** `validateApiKey` (the auth boundary) and
    `resolveKeyScopes` now resolve scopes through one `resolveEffectiveScopes`
    function: an assigned role's scopes govern; otherwise the key's own column
    scopes apply; a key with neither defaults to `["read"]`. Previously
    `validateApiKey` read the `api_keys.scopes` column and ignored an assigned
    role, so assigning a role had no effect on control-plane authorization.
    Assigning a role now governs the key's authorization everywhere, which can
    narrow a key whose role is narrower than its column scopes. Keys without a role
    are unaffected.

  Both are breaking changes to authorization behavior; audit any key that carries a
  role alongside column scopes, and mint keys with the scopes the caller actually
  needs. See the migration guide sections 5.2 and 5.3 in `docs/v1.0-api-surface.md`.

### Minor Changes

- c17b1a5: Add an `exports` map to `@stratum-hq/control-plane` and `@stratum-hq/cli` so deep imports no longer resolve (#219, from the #133 v1.0 surface review).

  Neither package is a JS import surface: `@stratum-hq/control-plane` is a deployable server whose `index` calls `main()` on import (its 1.0 contract is the HTTP REST API and OpenAPI document), and `@stratum-hq/cli` is a bin whose contract is its command surface. Both now expose only their documented entry (`.`) and block accidental deep imports such as `@stratum-hq/control-plane/dist/routes/...`. The `stratum` bin and `node dist/index.js` startup are unchanged. If you deep-imported internals from either package (never a supported path), import from the package entry instead.

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
- Updated dependencies [b55ae70]
- Updated dependencies [4eb1c52]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [3fa212b]
- Updated dependencies [86dfbe1]
- Updated dependencies [5e87692]
- Updated dependencies [f071f49]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/lib@1.0.0
  - @stratum-hq/core@1.0.0

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
