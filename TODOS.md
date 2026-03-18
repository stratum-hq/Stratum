# Stratum — TODOS

## Phase 2: Stratum Cloud (Hosted Control Plane)

**Priority:** P1 | **Effort:** XL (human) → L (CC) | **Depends on:** npm publishing

Deploy the control plane as a managed service with sign-up, API key provisioning, dashboard, usage billing.

**Why:** Turns Stratum from OSS library into a business. Control plane is already stateless (PostgreSQL = state store), making hosted deployment natural.

**Where to start:** Single-region MVP on Railway/Fly.io. Add sign-up flow, per-org API key provisioning, and a basic usage dashboard. SOC 2 prep can follow.

---

## Additional Language SDKs (Ruby, Java, .NET)

**Priority:** P2 | **Effort:** S per language (CC) | **Depends on:** Python + Go SDKs

Extend OpenAPI SDK generation to Ruby, Java, and .NET after Python + Go prove the pattern.

**Why:** Maximizes addressable market — every major backend language covered.

**Where to start:** Validate Python + Go SDK quality with real users. If generation pipeline is solid, adding languages is mechanical (~15 min CC time per language).

---

## Billing Integration (Stripe Connect)

**Priority:** P3 | **Effort:** L (human) → M (CC) | **Depends on:** Stratum Cloud

Map tenant hierarchies to Stripe Connect sub-merchant model for usage billing.

**Why:** Natural fit — tenant trees map to Stripe Connect's account hierarchy. Enables Stratum Cloud revenue model.

---

## Terraform/Pulumi Provider

**Priority:** P3 | **Effort:** L (human) → M (CC) | **Depends on:** Stable API (post-npm publish)

Infrastructure-as-code provider for tenant hierarchy management.

**Why:** Enterprise customers manage infrastructure declaratively. A Terraform provider makes Stratum fit into existing IaC workflows.

---

## Migration Scanner

**Priority:** P2 | **Effort:** M (human) → S (CC) | **Depends on:** CLI (`stratum doctor`)

Point at an existing database, Stratum identifies tables needing tenant isolation and generates migrations.

**Why:** The biggest adoption friction is migrating existing schemas. An automated scanner removes that barrier.

---

## Drag-and-Drop Tenant Reordering

**Priority:** P3 | **Effort:** M (human) → S (CC) | **Depends on:** Design system, React components

Add drag-and-drop support to the TenantTree component for reparenting tenants visually.

**Why:** Moving tenants in the hierarchy is currently API-only. A drag-and-drop tree would make the admin experience feel modern and reduce friction for ops teams.

**Where to start:** Use `@dnd-kit/core` for the drag library. Integrate with the existing `moveTenant()` API. Add visual drop indicators and undo capability.
