import type { CreateTenantInput } from "@stratum-hq/core";

/**
 * Build a CreateTenantInput from just the fields a test cares about.
 *
 * CreateTenantInput is `z.infer<...>` (the schema OUTPUT type), so every field
 * carrying a Zod `.default()` (parent_id, config, metadata, isolation_strategy)
 * is required at the type level even though createTenant() applies the same
 * defaults itself at runtime. This fills them in with those defaults so tests
 * only state what they are actually asserting on.
 */
export function tenantInput(
  overrides: Partial<CreateTenantInput> &
    Pick<CreateTenantInput, "name" | "slug">,
): CreateTenantInput {
  return {
    parent_id: null,
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    ...overrides,
  };
}
