# Changelog

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
