# @stratum-hq/lib

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
