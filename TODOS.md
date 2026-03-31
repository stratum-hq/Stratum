# Stratum — Outstanding Work

Last updated: 2026-03-31
Source: CEO review (/plan-ceo-review) + eng review (/plan-eng-review)

## P0 — Critical (shipping blockers)

All P0 items have been fixed via PRs #29-#35. Merge all 7 fix branches to close these:

- [x] ~~Webhook column mismatch~~ → PR #29
- [x] ~~Key rotation HKDF info mismatch~~ → PR #30
- [x] ~~JWT tenant_id trusted without verification~~ → PR #31
- [x] ~~RLS tenant context leak on connection reuse~~ → PR #32
- [x] ~~Demo admin key hardcoded in migrations~~ → PR #33
- [x] ~~Region database_url stored in plaintext~~ → PR #34
- [x] ~~GDPR purge incomplete (roles, source_tenant_id, audit logs)~~ → PR #34
- [x] ~~Migration idempotency guards missing~~ → PR #35
- [x] ~~Duplicate 002_ migration prefix~~ → PR #35

## P1 — High Priority (DX Sprint — CEO review 2026-03-27)

- [x] ~~Write integration test suite for critical paths~~ → PR #37 (5 test suites: tenant-lifecycle, config-inheritance, webhook-delivery, GDPR-purge, key-rotation)
- [x] ~~Add CI E2E pipeline~~ → PR #37 (ci-integration.yml — postgres:16-alpine, runs integration tests)
- [x] ~~Update design doc Phase 1.2~~ — moot (DESIGN.md moved to local-only)
- [x] ~~Default DATABASE_URL uses superuser~~ — changed to `stratum_app` in connection.ts and db.ts
- [x] ~~Tenant list endpoint bypasses scope guard~~ → PR #42 (route handler filters by apiKey.tenant_id + ancestry_path)
- [x] ~~Fix BYPASSRLS hard-fail for dev-mode quickstart~~ — conditional check: warning in dev, hard-fail when stratum.enforce_rls=on
- [x] ~~Resolve migration package boundary for autoMigrate~~ — migrations moved from control-plane to lib (16 SQL files + runner)
- [x] ~~Create examples/ directory~~ — quickstart, flat-tenancy, with-express, with-nextjs, with-hono
- [x] ~~Fix README install instructions~~ — changed to `npm install @stratum-hq/lib pg`

## P2 — Medium Priority

- [x] ~~Add Redis service to docker-compose.yml~~ — already existed in docker-compose.yml
- [x] ~~Config inheritance: archived parent lock disagreement~~ → PR #42
- [x] ~~No circular parent detection~~ → PR #42
- [x] ~~No structured logging in lib package~~ → PR #43
- [x] ~~Webhook routes inconsistent access control~~ → PR #45
- [x] ~~Connection pool has no queue depth limit~~ → PR #46
- [x] ~~Pool eviction race condition~~ → PR #46
- [x] ~~Add changesets for monorepo version management~~ — @changesets/cli installed, configured with access: public, baseBranch: master
- [x] ~~Docker-compose quickstart with pre-loaded extensions~~ — init-extensions.sql mounted into test-db container
- [x] ~~Docs getting-started rewrite~~ — progressive disclosure: flat first, autoMigrate, hierarchy second
- [x] ~~Distribution — launch blog post + comparison page~~ — blog/why-we-built-stratum + /compare pages created
- [x] ~~GitHub repo polish~~ — CONTRIBUTING.md, SECURITY.md, issue templates (bug report + feature request)
- [x] ~~Flat-tenancy convenience API~~ — createOrganization(), listOrganizations(), getOrganization() on Stratum class
- [x] ~~autoMigrate option on Stratum constructor~~ — initialize() with promise mutex, advisory lock, enforceRls support

## P3 — Nice to Have

- [x] ~~SSRF TOCTOU gap in webhook delivery~~ → PR #48 (redirect blocking + timeout)
- [x] ~~Key rotation: single-transaction locking~~ → PR #49 (batched with SKIP LOCKED)
- [x] ~~Key rotation: no dual-key read support~~ → PR #49 (STRATUM_ENCRYPTION_KEY_PREVIOUS fallback)
- [x] ~~HKDF salt is all-zeros~~ → PR #48 (configurable via STRATUM_HKDF_SALT)
- [x] ~~React UI: 0 unit tests~~ → PR #47 (19 snapshot + behavior tests for top 5 components)
- [x] ~~CLI: verify scaffold/scan/playground commands work~~ → PR #50 (all functional, version string fixed)
- [x] ~~Reserve `@stratum-hq/stratum` npm package name~~ → PR #56 (stub package created, npm publish pending 2FA)
- [x] ~~Browser-based playground~~ → PR #67 (PGlite WASM Postgres + CodeMirror, 4 scenario tabs, runs in browser on Cloudflare Pages)
- [x] ~~`npx @stratum-hq/create` scaffolding~~ → PR #58 (express/fastify/nextjs templates, project name validation)

- [x] ~~Differentiate landing page visual rhythms~~ → PR #73 (index.astro: bold typographic hero with geological gradient, what-is-stratum.astro: quiet editorial entry, compare.astro: compact data-forward header with ORM links)

## P4 — Future Expansion (gleaned from competitive analysis)

Source: Competitive analysis of [lanemc/multi-tenant-saas-toolkit](https://github.com/lanemc/multi-tenant-saas-toolkit) — 2026-03-27

- [x] ~~Sequelize adapter~~ → PR #57 (transaction-wrapping for tenant isolation, SequelizeLike structural interface, 13 tests). Mongoose shipped in PR #76 (see P5).
- [x] ~~ABAC policy engine~~ → PR #60 (hierarchical ABAC with 9 operators, LOCKED/INHERITED/DELEGATED modes, deny-overrides-allow, migration 017, control-plane routes, 14 unit tests)
- [x] ~~NestJS support~~ → PR #59 (StratumGuard, @Tenant() decorator, StratumModule.forRoot/forRootAsync, impersonation, custom resolvers, 14 tests)
- [x] ~~"30-second quickstart" marketing~~ → PR #56 (README hero rewritten with flat-tenancy 5-line quickstart, autoMigrate emphasis)

## P5 — Ecosystem Gaps (gleaned from ecosystem research 2026-03-29)

Source: Analysis of 204 npm packages, 6 GitHub repos, community threads, blog posts. Blog post: /blog/the-state-of-multi-tenancy-in-nodejs

### SDK Expansion (widen the moat)
- [x] ~~Drizzle ORM adapter~~ → PR #69 (DrizzleLike structural interface, transaction-wrapping with set_config, drizzle-orm optional peer dep, 15 tests)
- [x] ~~Hono framework middleware~~ → PR #70 (@stratum-hq/hono package, tenant extraction from header/JWT/path param, ALS context via runWithTenantContext, optional resolve callback, 9 tests)
- [x] ~~Mongoose adapter~~ → PR #76 (@stratum-hq/mongodb package with 3 isolation strategies, Mongoose plugin, 54 unit tests)
- [x] ~~MySQL adapter~~ → PR #80 (@stratum-hq/mysql package with 3 isolation strategies, TypeORM subscriber, Knex helper, Sequelize adapter, MySQL View utilities, 60 unit tests, 6 integration tests)

### DX Improvements (reduce friction)
- [x] ~~AsyncLocalStorage tenant context~~ → PR #72 (Stratum.currentTenantId(), Stratum.currentTenantContext(), Stratum.runWithTenant(), re-exports from @stratum-hq/sdk, 6 tests)
- [x] ~~Cross-tenant isolation test helpers~~ → PR #71 (@stratum-hq/test-utils package, assertIsolation(), assertConfigInheritance(), parameterized SQL, descriptive error messages, 10 tests)
- [x] ~~Migration runner for N tenant schemas~~ → PR #72 (migrateAllSchemas() with chunked Promise.allSettled, configurable concurrency, continue-on-error, progress callback, per-schema advisory locks, idempotent re-run, 7 tests)

### Content and SEO (own the search results)
- [x] ~~Comparison pages for each ORM~~ → PR #73 (CompareORM.astro shared layout + data objects, /compare/prisma, /compare/drizzle, /compare/sequelize, /compare/knex)
- [x] ~~"Multi-tenancy checklist" interactive tool~~ → PR #73 (/checklist with 4 categories, live-updating results, mobile sticky bar, a11y attributes)

### Architecture (long-term)
- [x] ~~Connection pooler integration guide~~ → PR #73 (/guides/connection-pooling covering PgBouncer, Supavisor, transaction-mode set_config, production checklist)
- [ ] **Cost calculator for isolation strategies** — Deprioritized. Needs AWS pricing research. Ship when a user asks. (human: 3 days / CC: 1.5 hours)
