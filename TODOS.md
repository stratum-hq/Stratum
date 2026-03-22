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

**Partially completed:** v0.2.0 (2026-03-21) — DraggableTenantTree component in `@stratum-hq/react` + demo sidebar drag-and-drop. Supports reparenting (moving a tenant to a new parent) but NOT sibling reordering.

**Remaining:** Sibling reordering requires a `sort_order` column on the tenants table, a `reorderTenant(id, position)` method in `@stratum-hq/lib`, and a new API endpoint. Also need to update the `DraggableTenantTree` in `@stratum-hq/react` to match the working demo sidebar implementation.

---

## Sibling Tenant Reordering

**Priority:** P3 | **Effort:** M (human) → S (CC) | **Depends on:** Drag-and-drop reparenting

Add `sort_order INTEGER` column to the tenants table. Add `reorderTenant(id, position)` method to `@stratum-hq/lib` and `POST /api/v1/tenants/:id/reorder` endpoint to control plane. Update DraggableTenantTree to support both reparenting and reordering.

**Why:** Currently you can drag a tenant to a new parent, but you can't reorder siblings (e.g., move Beta above Alpha within the same parent). This is a core data model limitation, not a UI issue.

---

## Extract Demo Features to @stratum-hq/react

**Priority:** P2 | **Effort:** M (human) → S (CC) | **Depends on:** Demo CRUD PR merged

The demo has several UI components that should be extracted to `@stratum-hq/react`:

1. **WebhookEditor** — create/delete/test webhooks (matches ConfigEditor/PermissionEditor pattern)
2. **AuditLogViewer** — action badges, tenant-scoped filtering, pagination
3. **Tenant CRUD on TenantTree** — edit/archive props on the existing component (currently TenantTree is read-only)
4. **Update DraggableTenantTree** — sync with working demo sidebar implementation (drag handle, dnd-kit integration)

**Why:** These are features every Stratum app needs. Having them in the demo but not in the library means every adopter rebuilds them.
