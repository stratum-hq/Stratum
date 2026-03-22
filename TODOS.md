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

**Completed:** v0.2.0 (2026-03-21) — `stratum scan` command added with `--generate` flag.

---

## Drag-and-Drop Tenant Reparenting

**Priority:** P3 | **Effort:** M (human) → S (CC) | **Depends on:** Design system, React components

**Completed:** 2026-03-22 — DraggableTenantTree in `@stratum-hq/react` + demo sidebar drag-and-drop with drag handle. Sibling reordering API added (sort_order column + reorderTenant method). DraggableTenantTree UI needs update to call reorder API for same-parent drops.

---

## Sibling Tenant Reordering

**Priority:** P3 | **Effort:** M (human) → S (CC) | **Depends on:** Drag-and-drop reparenting

**Completed:** 2026-03-22 — Added `sort_order` column (migration 002), `reorderTenant()` in lib, `POST /api/v1/tenants/:id/reorder` endpoint. DraggableTenantTree still needs UI update to call reorder API for same-parent drops.

---

## Extract Demo Features to @stratum-hq/react

**Priority:** P2 | **Effort:** M (human) → S (CC) | **Depends on:** Demo CRUD PR merged

**Completed:** 2026-03-22 — Extracted:
1. **WebhookEditor** — useWebhooks hook + WebhookEditor component
2. **AuditLogViewer** — useAuditLogs hook + AuditLogViewer component with action badges
3. **Tenant CRUD on TenantTree** — onEdit, onArchive, onAddChild props added to TenantTree
4. DraggableTenantTree already exists — demo uses its own implementation with drag handle
