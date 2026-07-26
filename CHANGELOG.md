# Changelog

## 1.2.0 (2026-07-25)

Additive release on `@stratum-hq/core` and `@stratum-hq/lib`.

### Added
- **`recordAuditEvent` accepts an optional `occurredAt`** (ISO 8601 string or `Date`) that sets the row's `created_at`, so a consumer can seed historical or backdated audit events; when omitted the row is stamped `now()` exactly as before and existing callers are unaffected. The value is Zod-validated and an invalid timestamp is rejected before the write. (`@stratum-hq/core` 1.2.0, `@stratum-hq/lib` 1.2.0)

### Fixed
- **`getDescendants` is scoped by stable tenant id, not the slug-derived ltree** — the subtree match previously ran against the slug-derived materialized path, so renaming a tenant's slug could silently drop descendants that still carried the old label. It now matches on the ID-based `ancestry_path`, the same approach used for permission and ABAC cascade revocation. The `status = 'active'` default and the `includeArchived` opt-in are unchanged. (#189)

## 1.1.0 (2026-07-25)

Additive release on `@stratum-hq/core` and `@stratum-hq/lib`.

### Added
- **First-class tenant lifecycle** — `suspendTenant`, `resumeTenant`, and `archiveTenant` on the `Stratum` facade (and as tenant-service functions) consolidate the tenant lifecycle into an explicit state machine: active to suspended/archived, and either back to active or on to a purge. Suspend and archive block when a tenant has active children (leaf-first); resume and create require an active parent (top-down); purge requires an empty subtree. `deleteTenant` is retained as a deprecated alias of `archiveTenant`. Adds the `suspended` tenant status, the `TenantSuspendedError` (403) and `InvalidTenantStateError` (409) error classes, and the `tenant.suspended` / `tenant.resumed` / `tenant.archived` / `tenant.purged` webhook event types. A migration widens the `tenants.status` CHECK to allow `suspended`.
- **App-facing audit write** — `recordAuditEvent(input)` appends a custom event to Stratum's `audit_logs` through the public surface (Stratum owns the table and previously exposed only `queryAuditLogs`); the event is validated, written on the same path the internal services use, and immediately queryable via `queryAuditLogs`. New `RecordAuditEventInput` type and `RecordAuditEventInputSchema`.
- **`getTenantBySlug(slug, includeArchived?)`** — resolve a tenant by its globally unique slug in one indexed lookup, the slug-keyed counterpart to `getTenant` with the same archived/suspended handling.
- **`runScopedJob(pool, tenantId, fn)`** — run a background job bound to a single tenant, establishing both the AsyncLocalStorage tenant context and the Postgres RLS context (`SET LOCAL app.current_tenant_id`) for the job's duration and tearing both down on completion or error, so a job cannot read or write another tenant's rows and the context does not leak onto the next job on a pooled connection.
- **Per-tenant usage metering (FR-58)** — `recordUsage` and `aggregateUsage` record countable per-tenant usage events with per-metric aggregation over a half-open `[from, to)` window. Events persist to a new `usage_events` table (migration 020) with optional idempotency keys and the same fail-closed RLS isolation as migration 019. New types `RecordUsageInput`, `UsageEvent`, `UsageAggregate`, `UsageAggregateQuery`.
- **Typed webhook event-stream listing** — `listWebhookEvents({ tenantId, type?, from?, to?, limit?, offset? })` returns a tenant's `WebhookEvent[]` (always scoped to `tenantId`, newest first, `limit` 1-100 default 50), and `listDeliveriesByEvent(eventId)` returns a single event's `WebhookDelivery[]`. New `ListWebhookEventsQuery` type; existing delivery methods unchanged.
- **`RateLimiter`** — a standalone, storage-agnostic per-tenant fixed-window limiter for library consumers, distinct from the control plane's HTTP rate limiting, with a pluggable `RateLimitStore` and a process-local `MemoryRateLimitStore` default.
- **`WebhookUrlValidationError`** — webhook-URL validation now throws a typed error (extends `StratumError`, code `WEBHOOK_URL_INVALID`, status 400) instead of a plain `Error`; validation logic and messages are unchanged.

### Fixed
- Webhook-listing timestamps (`created_at`, `next_retry_at`, `completed_at`) are returned as strings to match the declared `WebhookEvent` / `WebhookDelivery` types, and both listings order deterministically with an `id` tiebreaker (`ORDER BY created_at DESC, id DESC`).

## 1.0.0 (2026-07-24)

The first stable release. `@stratum-hq/core`, `@stratum-hq/lib`, `@stratum-hq/sdk`, `@stratum-hq/db-adapters`, `@stratum-hq/control-plane`, `@stratum-hq/hono`, and `@stratum-hq/nestjs` are versioned to 1.0.0. See `docs/v1.0-api-surface.md` for the frozen public surface and the v1.0 migration guide (`/guides/v1-migration` on docs.stratum-hq.org) for consumer-facing upgrade steps.

### Security
- **Hierarchical API-key scopes and single-source scope resolution (FR-53, #132).** Scope requirements are now checked with a rank comparison (`read` < `write` < `admin`) via a new `scopeSatisfies(granted, required)` helper in `@stratum-hq/core` instead of flat set membership, so `admin` implies `write` implies `read` and a key minted as `["admin"]` or `["write"]` satisfies the lower-scope routes it previously failed. `validateApiKey` (the auth boundary) and `resolveKeyScopes` now resolve scopes through one `resolveEffectiveScopes` function — an assigned role's scopes govern, otherwise the key's own column scopes, otherwise `["read"]` — where previously `validateApiKey` read the `api_keys.scopes` column and ignored an assigned role. Both are breaking changes to authorization behavior: audit any key that carries a role alongside column scopes (the role now wins and can narrow the key), and mint keys with the scopes the caller actually needs. This changes same-tenant behavior by scope level only and does not alter any cross-tenant boundary. (`@stratum-hq/lib`, `@stratum-hq/control-plane`, `@stratum-hq/core`)

### Changed (breaking — #219 pre-1.0 public-surface cleanup)
- **`TenantContextLegacy` renamed to `ResolvedTenantContext`** at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use, so the 1.0 surface carries no "Legacy" name. No deprecated alias is kept; the shape is unchanged.
- **`@stratum-hq/sdk` no longer exports the raw `tenantStorage`** `AsyncLocalStorage` instance. Use `getTenantContext`, `runWithTenantContext`, and `setTenantContext`, which remain public.
- **`@stratum-hq/db-adapters` tenant-context helpers use one `<orm>`-prefixed scheme** instead of `as`-aliased name collisions: `withTenant` (Prisma) → `prismaWithTenant`, `withDrizzleTenant` → `drizzleWithTenant`, `withTenantScope` (Sequelize) → `sequelizeWithTenantScope`, `withDrizzleTenantScope` → `drizzleWithTenantScope`, and the migration helper `enableRLSMigration` → `enableRLSForMigration` (distinct from the runtime `enableRLS`). Behavior is identical; update imports.
- **`SUPPORTED_ISOLATION_STRATEGIES` is the canonical export** from `@stratum-hq/core` (`SUPPORTED_ISOLATION_STRATEGIES_V1` is kept one more minor as a deprecated alias), and **`MAX_TREE_DEPTH` was removed** because no depth limit is enforced anywhere in `lib` or `core`.

### Added
- **`@stratum-hq/lib` re-exports the typed error classes as runtime values (FR-52)**, so a lib consumer can `instanceof TenantNotFoundError` while importing only `@stratum-hq/lib`. The classes are the same objects re-exported from `@stratum-hq/core`, never redefined, so `instanceof` matches across import paths.

### Fixed
- **`batchCreateTenants` honors its all-or-nothing transaction contract** — a mid-batch failure rolls the whole batch back and `created` is now cleared, so the facade no longer emits `TENANT_CREATED` events or writes audit entries for tenants that never committed.
- **`moveTenant` rewrites the moved node's direct children** — the descendant path/depth/`ancestry_ltree` rewrite previously matched only deeper descendants and skipped immediate children, leaving the subtree inconsistent and hiding those children from `getDescendants`.
- **Sensitive (encrypted) config round-trips again** — `resolveConfig`, `getConfigWithInheritance`, and `rotateEncryptionKey` no longer double-parse the pg-decoded JSONB, which had made any `sensitive: true` config key unreadable and broke rotating a sensitive row.
- Published tarballs no longer ship test files, and package metadata (`license` MIT, `author`, `homepage`, `bugs`, and `engines` Node >=20) is now complete and correct across the scope.

## 0.7.0 (2026-07-24)

### Added
- **Postgres row-level security for the `SHARED_RLS` strategy**: migration `019_rls_policies.sql` enables `ROW LEVEL SECURITY` (with `FORCE`) and a tenant-isolation policy on every tenant-scoped shared-schema table, so isolation is enforced by the database as a second layer independent of the application's `WHERE tenant_id` filters. Context is set per transaction with `SET LOCAL` (`app.current_tenant_id`), and a new `withRlsBypass` helper provides the audited system path for control-plane cross-tenant operations. See `docs/adr/0001-postgres-rls-defense-in-depth.md`. (`@stratum-hq/lib` 0.7.0, `@stratum-hq/db-adapters` 0.4.0) (#201)

## 0.6.0 (2026-07-24)

### Security
- **M1 authorization and tenant-isolation hardening release (GHSA-93wm-g5vg-8j6q)**: default-deny authorization on the control plane so a route without a declared tenant scope fails closed, subtree-scoped config diff and role administration, tenant-creation scoping to the caller key's subtree, CASCADE permission and policy revocation matched by stable tenant id, hardened webhook egress validation with delivery replay protection, active-scoped subtree listing in `getDescendants`, corrected encryption key rotation, schema search-path slug validation, and a JWT-authoritative NestJS guard. Per-package release notes carry the detail. (`@stratum-hq/lib` 0.6.0, `@stratum-hq/control-plane` 0.4.0, `@stratum-hq/db-adapters` 0.3.1, `@stratum-hq/nestjs` 0.3.1)

## @stratum-hq/lib 0.5.1 (2026-07-06)

### Fixed
- **Optional tenant scoping for principal role assignment**: `assignRole` and `resolvePrincipalScopes` accept an optional `tenantId`; when set, a role owned by a different tenant is refused on assign and ignored on resolve, while global roles remain allowed. Backward compatible.

## @stratum-hq/lib 0.5.0 (2026-07-06)

### Added
- **Principal-agnostic role assignment**: `assignRole`, `removeRole`, and `resolvePrincipalScopes` let any principal (an application user or a service account) hold a Stratum role and resolve its effective scopes, not only API keys. New `principal_roles` table (migration 018); one role per principal; `resolvePrincipalScopes` fails closed when a principal is unassigned.

## @stratum-hq/lib 0.4.0 (2026-07-06)

### Added
- **`getRoot(id)`**: resolves a tenant's root ancestor (the top-most ancestor, or the tenant itself when already a root) using single-row lookups rather than walking the full ancestry chain.

## @stratum-hq/react 0.3.1 (2026-07-05)

### Fixed
- Support React 19 — widened `react`/`react-dom` peer ranges to `^18 || ^19` (the components are compatible; the old cap forced `--legacy-peer-deps`). Found while deploying the MSP reference app on Next 15.

## 0.3.1 (2026-07-05)

### Fixed
- **`getAncestors` dropped the direct parent from the ancestor chain** — `getAncestorIds` assumed ancestry paths include the tenant's own id and sliced off the last element, but paths store only the ancestor chain. Every depth-1 tenant returned zero ancestors; deeper tenants lost their nearest parent. Found by dogfooding the MSP reference app. (`@stratum-hq/core` 0.3.1, `@stratum-hq/lib` 0.3.1)

## 0.3.0 (2026-07-05)

### Security
- **Hardening sprint** — NestJS interceptor with `run()` replaces `enterWith()` to prevent cross-tenant context leaks under concurrency; DNS-rebinding-safe webhook URL validation with `redirect: "error"`; production enforcement of real JWT secrets and `STRATUM_HKDF_SALT`; transaction-scoped RLS `set_config`; fail-closed Drizzle/Sequelize adapters when tenant context is missing; Knex tenant_id auto-injection on INSERT; DB-level scoping for scoped API keys; SHA-pinned GitHub Actions. (#84)
- Dependency security bumps across the workspace (fastify, hono, form-data, path-to-regexp, lodash, and more).

### Added
- **`create --preset` architecture** — stack combination matrix (database/strategy/ORM/framework) with ORM-aware project generators, plus the interactive Stack Wizard on the docs site. Scaffolded projects now target Next 15 / React 19 / NestJS 11. (#85)
- **MIT LICENSE and READMEs in every published package.**
- **MongoDB tenant isolation** — new `@stratum-hq/mongodb` package with three isolation strategies: shared-collection (tenant_id field injection via Collection Proxy), collection-per-tenant (namespace separation), and database-per-tenant (with LRU pool manager). Includes Mongoose plugin with ALS-powered auto-scoping, GDPR purge with `Promise.allSettled` for partial-failure resilience, and fail-closed proxy semantics. 54 unit tests. (#76)
- **Hono middleware** — new `@stratum-hq/hono` package with tenant extraction from header/JWT/path param, ALS context via `runWithTenantContext`, and optional resolve callback. (#70)
- **Drizzle ORM adapter** — `@stratum-hq/db-adapters` now supports Drizzle alongside raw pg, Prisma, and Sequelize. `DrizzleLike` structural interface, transaction-wrapping with `set_config`. (#69)
- **Test utilities** — new `@stratum-hq/test-utils` package with `assertIsolation()`, `assertConfigInheritance()`, and `assertMongoIsolation()` helpers for cross-tenant isolation testing. (#71)
- **ALS convenience methods** — `Stratum.currentTenantId()`, `Stratum.currentTenantContext()`, `Stratum.runWithTenant()` on the Stratum class. (#72)
- **Multi-schema migration runner** — `migrateAllSchemas()` with chunked `Promise.allSettled`, configurable concurrency, per-schema advisory locks. (#72)
- **Browser playground** — PGlite + CodeMirror interactive playground running in-browser on Cloudflare Pages. (#67)
- **MySQL tenant isolation** — new `@stratum-hq/mysql` package with three isolation strategies: shared table (structured query methods with tenant_id injection), table-per-tenant (namespace separation), and database-per-tenant (with LRU pool manager, active query tracking, and idle timeout). Includes TypeORM subscriber, Knex `withTenantScope()` helper, Sequelize adapter with try/finally session variable cleanup, and MySQL View utilities. 60 unit tests, 6 integration tests. (#80)
- **Content/SEO pages** — comparison pages for each ORM (/compare/prisma, /compare/drizzle, /compare/sequelize, /compare/knex, /compare/mongodb, /compare/mysql), multi-tenancy checklist tool, connection pooling guide. (#73, #80)
- **About/Contact pages** — plus RSS/Atom feeds and shared Nav/Footer. (#66)
- **MongoDB docs guide** — Starlight docs covering strategy selection, security tradeoffs, and performance. (#76)

### Fixed
- **Compare page navigation** — added Compare link to navbar. (#74)

### Chores
- Updated TODOs with 9 P5 items + 1 P3 item shipped. (#75)
- Ecosystem research blog post and competitive analysis. (#68)
- SEO keywords across all npm packages. (#65)

## 0.2.3 (2026-03-27)

### Added
- **ABAC policy engine** — attribute-based access control with 9 operators (eq, neq, in, not_in, contains, gt, gte, lt, lte). Policies inherit through the tenant hierarchy with LOCKED/INHERITED/DELEGATED modes. Deny-overrides-allow evaluation with priority sorting. New migration 017, control-plane routes, and Stratum class methods.
- **NestJS integration** — `@stratum-hq/nestjs` package with `StratumGuard` (CanActivate), `@Tenant()` parameter decorator, and `StratumModule.forRoot()`/`forRootAsync()` for dependency injection. Supports JWT verification, custom resolvers, and tenant impersonation.
- **Sequelize adapter** — `@stratum-hq/db-adapters` now supports Sequelize alongside raw pg and Prisma. Transaction-wrapping pattern ensures tenant context isolation. `SequelizeLike` structural interface avoids hard dependency.
- **Project scaffolding** — `npx @stratum-hq/create my-app` generates a new project with package.json, docker-compose.yml, .env, and framework-specific starter code (Express, Fastify, or Next.js).
- **npm name reservation** — `@stratum-hq/stratum` package reserved on npm as a placeholder for a future meta-package.
- **30-second quickstart** — README hero rewritten with flat-tenancy 5-line code block emphasizing `autoMigrate`. Progressive disclosure: flat first, hierarchy second.

### Fixed
- **Integration test deadlock** — `cleanTestData()` now uses a single TRUNCATE statement instead of a per-table loop, eliminating deadlocks from concurrent CASCADE locks.

## 0.2.2 (2026-03-27)

### Added
- **autoMigrate** — `new Stratum({ pool, autoMigrate: true })` runs migrations on `initialize()`. Promise-based mutex prevents concurrent races. Advisory lock (`pg_advisory_xact_lock`) prevents TOCTOU.
- **enforceRls** — production mode hard-fails on BYPASSRLS; dev mode warns only.
- **Flat-tenancy API** — `createOrganization()`, `listOrganizations()`, `getOrganization()` convenience methods that hide hierarchy for simple SaaS use cases.
- **Examples directory** — quickstart, flat-tenancy, with-express, with-hono, with-nextjs. Each framework example is standalone with own package.json.
- **Landing pages** — "What is Stratum?" explainer, "Why We Built Stratum" blog post, comparison page (vs tenant_id, WorkOS, ABP.IO).
- **SEO** — keyword-optimized title/H1, canonical URLs, JSON-LD structured data, sitemap, robots.txt.
- **Docker quickstart** — `docker/init-extensions.sql` pre-loads ltree + uuid-ossp in test-db.
- **Repo polish** — CONTRIBUTING.md, SECURITY.md, GitHub issue templates.
- **Changesets** — `@changesets/cli` configured for monorepo version management.

### Changed
- **Migrations moved to lib** — 16 SQL files + runner moved from control-plane to `@stratum-hq/lib`. Lib is now self-contained. Control-plane imports from lib.
- **BYPASSRLS check** — changed from unconditional hard-fail to conditional (warn in dev, fail in prod with `enforceRls`). `CREATE EXTENSION` wrapped in privilege check with graceful warning.
- **Default DATABASE_URL** — fallback changed from `stratum` (superuser) to `stratum_app` (NOBYPASSRLS).
- **README install** — simplified to `npm install @stratum-hq/lib pg` (core is a transitive dep).
- **Docs getting-started** — rewritten with progressive disclosure (flat first, hierarchy second).

## 0.2.1 (2026-03-26)

Republish with all security fixes, integration tests, design overhaul, structured logging,
and bug fixes. The 0.2.0 release on npm was published from pre-fix sandbox code on Mar 22.
**If you are on 0.2.0, upgrade immediately** — it contains critical security issues.

Note: `@stratum-hq/react` is at 0.2.2 (0.2.1 was previously occupied on npm).

## 0.2.0 (2026-03-22) — DEPRECATED

### Security Fixes
- **fix(control-plane):** Verify JWT tenant_id claims against database — prevents tenant impersonation
- **fix(db-adapters):** Prevent RLS tenant context leak on connection pool reuse
- **fix(security):** Move demo bootstrap key out of migration path — no more hardcoded admin key in production
- **fix(security,gdpr):** Encrypt region database URLs, complete GDPR tenant purge (roles, cross-tenant permissions, audit logs)

### Bug Fixes
- **fix(lib):** Correct webhook column name `secret_encrypted` → `secret_hash` — webhook delivery was completely broken
- **fix(lib):** Use correct HKDF info string for key rotation — rotation was deriving the wrong AES key
- **fix(migrations):** Add idempotency guards (IF NOT EXISTS) to migrations 001, 004, 005
- **fix(migrations):** Renumber duplicate `002_sort_order.sql` to `014_sort_order.sql`
- **fix:** Update unit tests to match security fixes (RLS session, auth, retention)
- **fix:** Correct integration test assertions and GDPR purge type cast

### Features
- **feat:** Integration test package with 20 tests against real PostgreSQL 16
- **feat:** CI workflow for integration tests (`ci-integration.yml`)

### Design
- **design(landing):** Rebuild with geological warmth design system — SVG icons, asymmetric layouts, Instrument Sans
- **design(react):** Restyle components with sandstone/terracotta/slate palette
- **design(docs):** Apply geological warmth theme to Starlight docs site
- **design(landing):** Add scroll animations, breathing room, light mode contrast fixes
- **design(landing):** Optimize mobile responsiveness

### Documentation
- **docs:** Add DESIGN.md with geological warmth design system
- **docs:** Refresh README — add "Why not tenant_id?" section, update test counts
- **docs:** Fix Node.js prerequisite from >=18 to >=20 in installation guide
- **chore:** Add TODOS.md with full P0-P3 work tracking

## 0.1.0 (2026-03-19)

Initial release — built in sandbox environment.
