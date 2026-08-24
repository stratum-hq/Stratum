# @stratum-hq/core

## 1.2.1

### Patch Changes

- 36f69d8: Fix public input types to use `z.input` instead of `z.infer` so documented happy-path calls type-check.

  Input types such as `CreateTenantInput` and `SetConfigInput` were declared as `z.infer<typeof Schema>` (the schema OUTPUT type), which made every field carrying a Zod `.default()` required at the type level even though the services apply those defaults at runtime. As a result, calls like `stratum.createTenant({ name, slug })` ran correctly but did not compile.

  Every public input and query type in `@stratum-hq/core` now uses `z.input` (the pre-defaults type), so defaulted fields are optional for callers. This is a backward-compatible widening: previously-required fields become optional, and existing callers that pass them still compile. A new `BatchSetConfigEntry` type derives the `batchSetConfig` entry shape from `SetConfigInput` so the batch and single-key config surfaces cannot drift.

## 1.2.0

### Minor Changes

- e57636a: feat: allow recordAuditEvent to set an explicit occurredAt timestamp

  `RecordAuditEventInput` gains an optional `occurredAt` (ISO 8601 datetime string
  or `Date`). When provided it sets the row's `created_at`, so a consumer seeding
  historical or backdated audit events can control the timestamp; when omitted the
  row is stamped `now()` exactly as before, so existing callers are unaffected. The
  value is validated by Zod and an invalid timestamp is rejected before the write.

## 1.1.0

### Minor Changes

- 6c2efa4: feat: add an app-facing audit-write API

  `stratum.recordAuditEvent(input)` lets a consumer append a custom event to
  Stratum's `audit_logs` through the public surface, instead of writing the table
  directly (Stratum owns it and previously exposed only `queryAuditLogs`). The
  input is validated and mapped onto the same write path the internal services
  use, so a recorded event is indistinguishable from one Stratum writes itself and
  is immediately queryable via `queryAuditLogs`:

  ```ts
  const entry = await stratum.recordAuditEvent({
    tenantId,
    actorId,
    actorType: "api_key", // 'api_key' | 'jwt' | 'system'; defaults to 'system'
    action: "invoice.sent",
    resourceType: "invoice",
    resourceId,
    before,
    after,
    metadata,
    sourceIp, // stored in the INET column
  });
  ```

  The row is stamped for `tenantId` and no other tenant, so under SHARED_RLS a
  data-plane reader only ever sees its own tenant's events. `actorType` matches
  the `actor_type` CHECK and `sourceIp` the `source_ip` INET column. New
  `RecordAuditEventInput` type and `RecordAuditEventInputSchema` are exported from
  `@stratum-hq/core` and re-exported from `@stratum-hq/lib`.

- b739673: First-class tenant lifecycle: create, suspend, resume, archive, purge

  `@stratum-hq/lib` gains `suspendTenant`, `resumeTenant`, and `archiveTenant` (as
  tenant-service functions and `Stratum` methods), consolidating the tenant
  lifecycle into an explicit state machine: active to suspended/archived, and
  either back to active or on to a purge. `deleteTenant` is retained as a
  deprecated alias of `archiveTenant`.

  Descendant rules are now defined and tested against Postgres: suspend and
  archive block when a tenant has active children (leaf-first); resume and create
  require an active parent (top-down); purge requires an empty subtree. A
  migration widens the `tenants.status` CHECK constraint to allow `suspended`.

  `@stratum-hq/core` gains the `suspended` tenant status, the `TenantSuspendedError`
  (403) and `InvalidTenantStateError` (409) error classes, and the
  `tenant.suspended`, `tenant.resumed`, `tenant.archived`, and `tenant.purged`
  webhook event types. Suspended tenants are blocked from `getTenant` and excluded
  from subtree listings, matching archived tenants.

- a2a33a7: feat: per-tenant usage metering primitive (FR-58)

  Add `recordUsage` and `aggregateUsage` to `Stratum` for countable per-tenant
  usage events with per-metric aggregation over a half-open time window. Events
  persist to a new `usage_events` table (migration 020) with optional
  idempotency keys and the same fail-closed RLS tenant isolation as migration 019. New core types: `RecordUsageInput`, `UsageEvent`, `UsageAggregate`,
  `UsageAggregateQuery`.

- 4615784: feat: expose typed webhook event-stream listing

  Adds two read methods on the `Stratum` facade so callers can page the webhook
  event stream that previously had no typed listing:
  - `listWebhookEvents({ tenantId, type?, from?, to?, limit?, offset? })` returns
    `WebhookEvent[]` for a single tenant, newest first. The listing is always
    scoped to `tenantId` (a caller can never page another tenant's events),
    optionally narrowed by event type and a `created_at` window, and paginated
    with `limit` (1-100, default 50) and `offset`.
  - `listDeliveriesByEvent(eventId)` returns `WebhookDelivery[]` for a single
    event, newest first.

  `core` gains the `ListWebhookEventsQuery` input type. The existing
  `listWebhookDeliveries` / delivery methods are unchanged.

- 5a2ef97: feat: export a typed `WebhookUrlValidationError` for webhook-URL validation

  Webhook-URL validation (`validateWebhookUrl` / `validateWebhookUrlWithDns`,
  used by `createWebhook`, `updateWebhook`, and `testWebhook`) now throws a typed
  `WebhookUrlValidationError` instead of a plain `Error`. It extends `StratumError`
  with code `WEBHOOK_URL_INVALID` and status 400, so a consumer can turn a rejected
  URL into a 400 with `instanceof WebhookUrlValidationError` (or `instanceof
StratumError`) instead of matching the human-readable message. The class is
  exported from `@stratum-hq/core` and re-exported from `@stratum-hq/lib`. The
  validation logic and messages are unchanged.

## 1.0.0

### Major Changes

- c17b1a5: Remove `MAX_TREE_DEPTH` from the `@stratum-hq/core` public surface (#219, from the #133 v1.0 surface review).

  No depth limit is enforced anywhere in `@stratum-hq/lib` or `@stratum-hq/core`, so exporting the constant advertised a guarantee that does not exist. It is no longer exported. No enforcement was added. If you imported `MAX_TREE_DEPTH`, drop the import; it was never backed by a runtime check.

- c17b1a5: Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

  The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

  If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.

### Minor Changes

- c17b1a5: Export the canonical `SUPPORTED_ISOLATION_STRATEGIES` constant from `@stratum-hq/core` (#219, from the #133 v1.0 surface review).

  Previously only the `@deprecated` `SUPPORTED_ISOLATION_STRATEGIES_V1` alias was reachable from the package entry, so the deprecated spelling would have been the sole public name at 1.0. The canonical `SUPPORTED_ISOLATION_STRATEGIES` is now exported; `SUPPORTED_ISOLATION_STRATEGIES_V1` remains as a deprecated alias for one more minor and will be removed in a future major. Migrate imports to the non-deprecated name.

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

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.

## 0.3.1

### Patch Changes

- c55da6e: Fix `getAncestors` returning an empty or incomplete ancestor chain. `getAncestorIds` assumed ancestry paths include the tenant's own id and sliced off the last element — but paths store only the ancestor chain, so every depth-1 tenant reported zero ancestors and deeper tenants lost their direct parent. `getSelfId` docs corrected to reflect that the last path element is the direct parent.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.
