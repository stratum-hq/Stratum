---
"@stratum-hq/core": major
"@stratum-hq/sdk": major
"@stratum-hq/lib": major
"@stratum-hq/hono": minor
"@stratum-hq/react": minor
---

Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.
