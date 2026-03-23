# Stratum — TODOS

## Next Up

### Stratum Cloud (Hosted Control Plane)

**Priority:** P1 | **Effort:** XL (human) → L (CC) | **Depends on:** npm publishing

Deploy the control plane as a managed service with sign-up, API key provisioning, dashboard, usage billing.

**Why:** Turns Stratum from OSS library into a business. Control plane is already stateless (PostgreSQL = state store), making hosted deployment natural.

**Where to start:** Single-region MVP on Railway/Fly.io. Add sign-up flow, per-org API key provisioning, and a basic usage dashboard. SOC 2 prep can follow.

---

### Python/Go SDK Publishing

**Priority:** P2 | **Effort:** S (CC) | **Depends on:** `npm run generate:sdk` working

OpenAPI generator configs already exist at `scripts/openapi-generator-config-{python,go}.json`. Need a CI pipeline that regenerates SDKs on API changes, runs basic compilation checks, and publishes to PyPI/pkg.go.dev.

**Why:** Keeps SDKs in sync with API automatically. Enables adoption by Python/Go developers.

**Where to start:** `npm run generate:sdk` produces the clients locally. Next step is GitHub Actions workflow to automate generation + publish on release.

---

### Documentation Site Audit

**Priority:** P2 | **Effort:** S (CC) | **Depends on:** nothing

Audit all public methods exported from `packages/lib/src/stratum.ts` against the documentation site (`website/`). Verify each documented function's signature matches the actual code. Fix mismatches.

**Why:** Stale docs mislead adopters. The API has evolved and docs may have drifted.

**Where to start:** Compare each method in `stratum.ts` against its corresponding docs page. Update docs to match code.

---

### OpenTelemetry Test Coverage

**Priority:** P3 | **Effort:** S (CC) | **Depends on:** mock OTEL collector or InMemorySpanExporter

Write tests for the OpenTelemetry integration in `packages/lib/src/telemetry.ts`. Currently the only feature with zero test coverage.

**Why:** If telemetry breaks silently, tracing data stops flowing and no one notices.

**Where to start:** Use `@opentelemetry/sdk-trace-base` InMemorySpanExporter for in-process testing. Verify spans are created for key operations.

---

## Aspirational

_Not yet validated — may change based on user feedback._

### Additional Language SDKs (Ruby, Java, .NET)

**Priority:** P2 | **Effort:** S per language (CC) | **Depends on:** Python + Go SDKs validated

Extend OpenAPI SDK generation to Ruby, Java, and .NET after Python + Go prove the pattern. Adding languages is mechanical (~15 min CC time per language) once the generation pipeline is solid.

---

### Billing Integration (Stripe Connect)

**Priority:** P3 | **Effort:** L (human) → M (CC) | **Depends on:** Stratum Cloud

Map tenant hierarchies to Stripe Connect sub-merchant model for usage billing. Natural fit — tenant trees map to Stripe Connect's account hierarchy.

---

### Terraform/Pulumi Provider

**Priority:** P3 | **Effort:** L (human) → M (CC) | **Depends on:** Stable API (post-npm publish)

Infrastructure-as-code provider for tenant hierarchy management. Enterprise customers manage infrastructure declaratively.

---

### Vertical Integrations (MSP/MSSP Platforms)

**Priority:** P3 | **Effort:** M (CC) | **Depends on:** OSS adoption validated

Integrations with ConnectWise, Datto, HaloPSA APIs. Become the multi-tenancy layer for the managed services vertical.
