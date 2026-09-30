# @stratum-hq/core

## 1.4.0

### Minor Changes

- 7e9ebcf: Input schemas are now stricter, and the control plane rejects some requests that it accepted before. This is a deliberate tightening. Some of the values that the schemas now reject were valid in PostgreSQL and succeeded before this release.

  The control plane returns `400 VALIDATION_ERROR` for these values:

  - `CreateAbacPolicyInputSchema.priority` must be in the `INTEGER` range, -2147483648 to 2147483647. Before this release, a value outside that range caused a `500`.
  - `GrantConsentInputSchema.expires_at` must be an ISO 8601 datetime with a time zone (`Z` or an offset such as `+02:00`). `POST /api/v1/tenants/:tenantId/consent` returned `201` for these forms before, and now returns `400`:
    - a date without a time, such as `2027-12-31`
    - a datetime without a time zone, such as `2027-12-31T00:00:00`
    - the PostgreSQL special values `infinity` and `epoch`

    Send a full datetime with a time zone, such as `2027-12-31T00:00:00Z`.

  - `RecordUsageInputSchema.quantity` must be at most `Number.MAX_SAFE_INTEGER` (2^53 - 1). Before this release, a quantity from 2^53 up to the `BIGINT` limit (about 9.2e18) succeeded, and a larger quantity caused a `500`.
  - The datetime fields of `GrantConsentInputSchema`, `RecordUsageInputSchema`, `UsageAggregateQuerySchema`, `AuditLogQuerySchema`, and `RecordAuditEventInputSchema` reject year 0000, which PostgreSQL has no value for.

- e7e7b74: Report invalid input as a validation error, not as a server or database error.

  Breaking for some callers: `@stratum-hq/lib` now rejects input that it stored before, and `recordAuditEvent` throws a different error class.

  - `@stratum-hq/lib`: `grantConsent` validates its input with `GrantConsentInputSchema`. It now throws a `ValidationError` and writes no row for:
    - an empty `subject_id` or `purpose`.
    - an `expires_at` that is only a date (`2026-12-31`), or a date and time without a time zone offset (`2026-12-31T00:00:00`). Before, PostgreSQL stored these values, and it read a time without an offset in the time zone of the database session.
    - an `expires_at` that PostgreSQL cannot store, such as `infinity`. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/lib`: `createAbacPolicy` validates its input with `CreateAbacPolicyInputSchema`. It now throws a `ValidationError` and writes no row for:
    - an empty `name`, `resource_type` or `action`, or a condition with an empty `attribute` or an unknown `operator`. Before, the policy was stored.
    - a `priority` that is not an integer from -2147483648 to 2147483647. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for invalid input, with the zod issues in `details.issues`. Before, it threw a `ZodError`. A check such as `err instanceof ZodError` no longer matches. Check `err instanceof ValidationError` instead.
  - `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for a `sourceIp` that is not an IP address. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/core`: `RecordAuditEventInputSchema.sourceIp` now accepts only an IPv4 or IPv6 address, with an optional `/prefix` (`203.0.113.7`, `10.0.0.0/8`, `2001:db8::1/128`). This matches the `INET` column. The `source_ip` value that `queryAuditLogs` returns, such as `203.0.113.7/32`, is accepted. The schema rejects an IPv6 zone index (`fe80::1%eth0`) and an IPv4 address with leading zeros (`010.0.0.1`). Before, the schema accepted any string.
  - `@stratum-hq/control-plane`: the error handler identifies a `ZodError` by its shape, so a `ZodError` from another copy of zod now gets a `400 VALIDATION_ERROR` response instead of a `500`.

- 329cb16: Region conflicts now throw typed errors instead of a plain `Error`:

  - `deleteRegion` throws `RegionInUseError` (code `REGION_IN_USE`, status code 409) when active tenants are still assigned to the region.
  - `migrateRegion` throws `RegionNotActiveError` (code `REGION_NOT_ACTIVE`, status code 409) when the target region is not `active`.

  `@stratum-hq/lib` now exports `RegionInUseError` and `RegionNotActiveError`. The thrown class changes from `Error` to these `StratumError` subclasses, so a caller can check the class or the `code`. The error messages do not change.

  The control plane now answers `409` with these codes for `DELETE /api/v1/regions/:id` and `POST /api/v1/tenants/:id/migrate-region`. Before, it answered `500 INTERNAL_SERVER_ERROR`.

- cd7b950: A missing region now gives a typed not-found error. Core adds `RegionNotFoundError` with the code `REGION_NOT_FOUND`. Lib re-exports it, the lib region functions throw it, and `migrateRegion` throws `TenantNotFoundError` for a missing tenant. The control plane answers 404 instead of 500 for these requests.
- 694a3d3: `POST /api/v1/tenants` now removes the schema or database it provisioned when activation of the new tenant fails. Before this change, the storage stayed behind, and purging the pending tenant did not remove it. The tenant stays `pending`, and the response is `TENANT_PROVISIONING_FAILED` with `details.stage` set to `"activation"`. If the removal also fails, `details.storage_removed` is `false`, and an operator must drop the storage by hand. If the activation reports an error but the tenant is `active`, the route returns the active tenant and keeps its storage. If the route cannot read the tenant after the activation error, it also keeps the storage and returns the original error. Check the tenant's status: if it is `pending`, purge it and drop its storage by hand.

  `TenantProvisioningError` has a new optional second argument that names the failed stage. Its `details` now include `stage` (`"provisioning"` or `"activation"`), and `storage_removed` for the activation stage.

- 694a3d3: Add the `tenant.activated` webhook event. `activateTenant` emits it when it moves a pending tenant to `active` (best effort: in rare failure cases around a lost database reply the event can be missed or, with concurrent activations, sent twice). A failed activation emits no event. `TenantEvent.TENANT_ACTIVATED` is the new enum member, and webhooks can now subscribe to it.

### Patch Changes

- 329cb16: Deprecate `TenantEvent.TENANT_PURGED` (`tenant.purged`). `purgeTenant` never emits this event, because the purge erases the event log of the tenant with the tenant itself. A webhook can still subscribe to it, but it receives no delivery. The next major version removes it.

## 1.3.0

### Minor Changes

- dca0826: Create tenants with their own schema or database as pending until provisioned, and drop that storage on purge (GHSA-jhhc-cm2c-jh27).

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
