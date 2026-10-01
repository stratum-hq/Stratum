---
"@stratum-hq/core": minor
"@stratum-hq/lib": minor
"@stratum-hq/control-plane": minor
"@stratum-hq/react": minor
---

Sensitive config values are still inherited, but reads of a descendant's config now return them masked: `value: null`, `sensitive: true` and `masked: true`, with `source_tenant_id` naming the tenant that set the value. A tenant's own sensitive values are unchanged.

- `@stratum-hq/lib`: `resolveConfig`, `getConfigWithInheritance`, `getTenantContext` and `diffConfig` take an optional `ResolveConfigOptions`. Pass `{ revealSensitive: true }` in trusted server code that needs an inherited secret, or `{ viewerTenantId }` to reveal only the values that tenant set.
- `@stratum-hq/control-plane`: the config, inheritance, diff and context routes reveal an inherited sensitive value only to a key of the tenant that set it. Global keys get the masked entry and can read the value from the owning tenant's own config.
- `@stratum-hq/react`: `ConfigEditor` and `ConfigInheritanceVisualizer` show a masked value as "Sensitive value set by an ancestor" and never pre-fill it into the edit field.
- `@stratum-hq/core`: `ResolvedConfigEntry` and `ConfigDiffEntry` gain optional `sensitive` and `masked` fields, and `ResolveConfigOptions` is exported.

(GHSA-mg93-96h7-h9fq)
