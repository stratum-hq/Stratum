# Stratum — Outstanding Work

Last updated: 2026-03-26
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

## P1 — High Priority

- [ ] **Write integration test suite for critical paths** — All existing 417 tests use mocked DB pools. Need NEW integration tests that run against real PostgreSQL for: tenant CRUD, config inheritance, webhook delivery, RLS isolation, GDPR purge, key rotation. (human: 1 week / CC: 1-2 hours)
- [ ] **Add CI E2E pipeline** — GitHub Actions workflow that spins up postgres:16-alpine, runs migrations, executes integration tests. Prevents regression to sandbox-quality code. (human: 2 hours / CC: 15 min)
- [ ] **Update design doc Phase 1.2** — Reframe from "run existing tests against real Postgres" to "write new integration test suite." Existing unit tests are mock-based and valid for logic validation only. (human: 30 min / CC: 5 min)
- [ ] **Default DATABASE_URL uses superuser** — connection.ts:12 falls back to `stratum` superuser which bypasses all RLS. Should default to `stratum_app` (NOBYPASSRLS). (human: 1 hour / CC: 5 min)
- [ ] **Tenant list endpoint bypasses scope guard** — GET /api/v1/tenants/ with a scoped API key can enumerate ALL tenants because fromParamId returns null when there's no :id param. (human: 2 hours / CC: 15 min)

## P2 — Medium Priority

- [ ] **Add Redis service to docker-compose.yml** — Rate limiting validation requires Redis but docker-compose has no Redis service. (human: 30 min / CC: 5 min)
- [ ] **Config inheritance: archived parent lock disagreement** — resolveConfig filters out archived tenants but setConfig still respects their locks. The two code paths disagree. (human: 2 hours / CC: 15 min)
- [ ] **No circular parent detection** — moveTenant doesn't check for cycles. Corrupted ancestry paths produce wrong config silently. (human: 2 hours / CC: 15 min)
- [ ] **Webhook routes inconsistent access control** — Global webhooks visible to every scoped key. Webhook routes lack tenant-scope guard at plugin level. (human: 2 hours / CC: 15 min)
- [ ] **No structured logging in lib package** — Services throw errors but don't log context (tenant, operation, arguments). Debugging is guesswork. (human: 4 hours / CC: 30 min)
- [ ] **Connection pool has no queue depth limit** — 1000 concurrent requests queue for 5 seconds each with no circuit breaker. (human: 2 hours / CC: 15 min)
- [ ] **Pool eviction race condition** — void this.evictLRU() fire-and-forgets pool drain. (human: 1 hour / CC: 10 min)
- [ ] **Add changesets for monorepo version management** — No automated changelog or semantic versioning. (human: 2 hours / CC: 15 min)

## P3 — Nice to Have

- [ ] **SSRF TOCTOU gap in webhook delivery** — DNS resolution check and fetch() resolve independently. DNS rebinding possible. (human: 4 hours / CC: 30 min)
- [ ] **Key rotation: single-transaction locking** — Large deployments will have extended write locks during rotation. Need batched rotation. (human: 4 hours / CC: 30 min)
- [ ] **Key rotation: no dual-key read support** — Rolling deployments can't read data during rotation window. (human: 1 day / CC: 1 hour)
- [ ] **HKDF salt is all-zeros** — Weakens key derivation for cross-deployment scenarios. Add per-deployment salt. (human: 2 hours / CC: 15 min)
- [ ] **React UI: 0 unit tests** — 33 TSX files with no tests. Add snapshot tests for top 5 components. (human: 1 day / CC: 15 min)
- [ ] **CLI: verify scaffold/scan/playground commands work** — May be stubs. (human: 2 hours / CC: 15 min)
