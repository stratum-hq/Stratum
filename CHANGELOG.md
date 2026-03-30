# Changelog

## 0.3.0 (2026-03-30)

### Added
- **MongoDB tenant isolation** — new `@stratum-hq/mongodb` package with three isolation strategies: shared-collection (tenant_id field injection via Collection Proxy), collection-per-tenant (namespace separation), and database-per-tenant (with LRU pool manager). Includes Mongoose plugin with ALS-powered auto-scoping, GDPR purge with `Promise.allSettled` for partial-failure resilience, and fail-closed proxy semantics. 54 unit tests. (#76)
- **Hono middleware** — new `@stratum-hq/hono` package with tenant extraction from header/JWT/path param, ALS context via `runWithTenantContext`, and optional resolve callback. (#70)
- **Drizzle ORM adapter** — `@stratum-hq/db-adapters` now supports Drizzle alongside raw pg, Prisma, and Sequelize. `DrizzleLike` structural interface, transaction-wrapping with `set_config`. (#69)
- **Test utilities** — new `@stratum-hq/test-utils` package with `assertIsolation()`, `assertConfigInheritance()`, and `assertMongoIsolation()` helpers for cross-tenant isolation testing. (#71)
- **ALS convenience methods** — `Stratum.currentTenantId()`, `Stratum.currentTenantContext()`, `Stratum.runWithTenant()` on the Stratum class. (#72)
- **Multi-schema migration runner** — `migrateAllSchemas()` with chunked `Promise.allSettled`, configurable concurrency, per-schema advisory locks. (#72)
- **Browser playground** — PGlite + CodeMirror interactive playground running in-browser on Cloudflare Pages. (#67)
- **Content/SEO pages** — comparison pages for each ORM (/compare/prisma, /compare/drizzle, /compare/sequelize, /compare/knex, /compare/mongodb), multi-tenancy checklist tool, connection pooling guide. (#73)
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
