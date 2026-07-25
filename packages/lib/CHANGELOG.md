# @stratum-hq/lib

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

- c17b1a5: Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

  The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

  If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.

### Minor Changes

- f071f49: Re-export Stratum's typed error classes as runtime values from the `@stratum-hq/lib` public entry (FR-52).

  `@stratum-hq/lib` previously re-exported core's error types only via `export type`, so the error classes were not available as runtime values and could not be used with `instanceof`. Consumers had to import them from `@stratum-hq/core` directly (or match error-message substrings). Every error class in the hierarchy (`StratumError` and its subclasses, plus the `ErrorCode` enum) is now importable as a value:

  ```ts
  import { StratumError, TenantNotFoundError } from "@stratum-hq/lib";

  try {
    await stratum.tenants.get(id);
  } catch (err) {
    if (err instanceof TenantNotFoundError) {
      // ...
    }
  }
  ```

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4eb1c52: Fix batchCreateTenants to honor its all-or-nothing transaction contract. The
  batch runs in a single transaction, so a mid-batch failure (such as a duplicate
  slug) rolls every insert back. The returned `created` array was populated in
  memory before the failure and still listed the rolled-back tenants, which caused
  the facade to emit TENANT_CREATED events and write audit entries for tenants that
  were never persisted. `created` is now cleared on failure, so it reflects only
  what actually committed and no phantom events or audit entries are emitted.
- 3fa212b: Fix moveTenant leaving the moved node's direct children with a stale
  ancestry_path, depth, and ancestry_ltree. The descendant rewrite matched only
  paths with a segment after the moved tenant (a `LIKE 'prefix/%'`), so immediate
  children — whose ancestry_path equals the prefix exactly — were skipped, leaving
  the subtree inconsistent and hiding those children from getDescendants (which
  queries the ltree). The rewrite now also matches the exact prefix. Surfaced by a
  new real-database integration test; the existing unit tests mock the pool and
  never exercised the descendant rows.
- 86dfbe1: Fix reading back a sensitive (encrypted) config value.

  `resolveConfig` and `getConfigWithInheritance` parsed the pg-decoded JSONB value a
  second time before decrypting it. The pg driver already parses the JSONB column, so
  the extra `JSON.parse` ran against an already-decoded string and threw, meaning any
  config key written with `sensitive: true` could not be read back. The same redundant
  parse in `rotateEncryptionKey` broke rotating a sensitive config row. Removing the
  redundant parse lets sensitive values decrypt and round-trip correctly, including
  across a key rotation.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
- Updated dependencies [b55ae70]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [5e87692]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/core@1.0.0
  - @stratum-hq/sdk@1.0.0

## 0.7.0

### Minor Changes

- 523abeb: Enforce the `SHARED_RLS` isolation strategy with real Postgres row-level security.

  Migration `019_rls_policies.sql` enables `ROW LEVEL SECURITY` (with `FORCE`) and a
  tenant-isolation policy on every tenant-scoped shared-schema table, so tenant
  isolation is enforced by the database as a second layer independent of the
  application's `WHERE tenant_id` filters. Context is set per transaction with
  `SET LOCAL` (`app.current_tenant_id`), and a `withRlsBypass` helper (new, exported
  from `@stratum-hq/db-adapters` alongside `withTenantContext`) provides the audited
  system path for control-plane cross-tenant operations.

  Rollout note: after this migration runs, any client connecting as a non-superuser,
  non-`BYPASSRLS` role must set the tenant context (`withTenantContext`) or use a
  bypass, or its direct queries against the protected tables return zero rows. Do not
  enable this against a shared database until every direct client has adopted the
  tenant-context helper. See `docs/adr/0001-postgres-rls-defense-in-depth.md`.

## 0.6.0

### Minor Changes

- f96c3b4: Add `getApiKey(id)` to look up a single API key by id, including its owning tenant. Returns null when no key has that id. The primitive for authorizing operations that target an API key by id whose owning tenant is not otherwise in the request (for example scoping role assignment to the key's tenant).
- 718d977: `getDescendants` now returns only active descendants by default, matching `getChildren`, `listTenants`, and the default of `getTenant`. Archived and soft-deleted tenants are excluded from a subtree listing. Callers that need the full historical subtree (for example lifecycle or data-retention passes) pass the new `includeArchived` argument: `getDescendants(id, true)`. The subtree query and its three-state behavior (active / archived / soft-deleted) are now documented on the method and covered by unit and integration tests.
- e46ffeb: Harden webhook egress validation to reject private, loopback, link-local, unspecified, and cloud-metadata targets across every address notation, including bracketed and IPv4-mapped IPv6 literals. Webhook deliveries now bind a timestamp into their signature for replay resistance, and a `verifyWebhookSignature` helper is exported so consumers can validate the signature and timestamp freshness of incoming deliveries.

### Patch Changes

- eaffc2d: Harden CASCADE permission and ABAC policy revocation so it reaches every current descendant identified by stable tenant identity. Descendant matching now uses the ID-based `ancestry_path` instead of the slug-derived subtree key, so a prior slug rename can no longer leave a revoked permission or policy live on a descendant.
- abc555d: Fix encryption key rotation to re-encrypt every sensitive row exactly once. Rotation now walks config entries and webhook secrets with a keyset cursor over the primary key, so datasets larger than a single batch are rotated fully and correctly instead of stalling after the first batch.

  Validate the tenant slug in `setSchemaSearchPath` before it is used to build the schema identifier, matching the other schema-isolation adapters. Identifiers outside the canonical slug charset are now rejected rather than interpolated into the search-path statement.

## 0.5.1

### Patch Changes

- f6b38fa: `assignRole` and `resolvePrincipalScopes` accept an optional `tenantId`. When set, a role owned by a different tenant is refused on assign and ignored on resolve, while global roles remain allowed. Closes the cross-tenant assignment and resolution gap in principal role scoping. Backward compatible.

## 0.5.0

### Minor Changes

- 949194a: Add principal-agnostic role assignment. `assignRole`, `removeRole`, and `resolvePrincipalScopes` let any principal (an application user or a service account) hold a Stratum role and resolve its effective scopes, not only API keys. Adds the `principal_roles` table (migration 018); one role per principal; `resolvePrincipalScopes` fails closed, returning an empty scope set when the principal is unassigned.

## 0.4.0

### Minor Changes

- 875f234: Add `getRoot(id)` to resolve a tenant's root ancestor: the top-most ancestor, or the tenant itself when it is already a root. Uses single-row lookups rather than walking the full ancestry chain.

## 0.3.1

### Patch Changes

- c55da6e: Fix `getAncestors` returning an empty or incomplete ancestor chain. `getAncestorIds` assumed ancestry paths include the tenant's own id and sliced off the last element — but paths store only the ancestor chain, so every depth-1 tenant reported zero ancestors and deeper tenants lost their direct parent. `getSelfId` docs corrected to reflect that the last path element is the direct parent.
- Updated dependencies [c55da6e]
  - @stratum-hq/core@0.3.1

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
