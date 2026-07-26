---
"@stratum-hq/core": patch
"@stratum-hq/lib": patch
---

Fix public input types to use `z.input` instead of `z.infer` so documented happy-path calls type-check.

Input types such as `CreateTenantInput` and `SetConfigInput` were declared as `z.infer<typeof Schema>` (the schema OUTPUT type), which made every field carrying a Zod `.default()` required at the type level even though the services apply those defaults at runtime. As a result, calls like `stratum.createTenant({ name, slug })` ran correctly but did not compile.

Every public input and query type in `@stratum-hq/core` now uses `z.input` (the pre-defaults type), so defaulted fields are optional for callers. This is a backward-compatible widening: previously-required fields become optional, and existing callers that pass them still compile. A new `BatchSetConfigEntry` type derives the `batchSetConfig` entry shape from `SetConfigInput` so the batch and single-key config surfaces cannot drift.
