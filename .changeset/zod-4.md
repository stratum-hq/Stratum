---
"@stratum-hq/core": minor
"@stratum-hq/control-plane": minor
---

Move to zod 4 (`^4.6.6`). zod 3 has no fixed release for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), so `npm audit` reported it for every install of `@stratum-hq/core`.

What changes for callers:

- The schemas that `@stratum-hq/core` exports are zod 4 schemas. Code that extends or composes them, or infers types from them, needs zod 4 as well.
- Array inputs have upper limits: at most 100 conditions on an ABAC policy, at most one entry per event type in a webhook's `events`, and at most 3 entries in a role's `scopes`.
- Datetime inputs must include seconds, and a time zone offset must be written as `+HH:MM`. `Date.prototype.toISOString()` output is unaffected.
- The `code` and `message` of each validation issue, in `VALIDATION_ERROR` responses and in `ValidationError` details, are now the values zod 4 reports. For example, a malformed string has `code: "invalid_format"` where it had `invalid_string`. The `path` of each issue is unchanged.
- UUID fields accept the same values as before: any 8-4-4-4-12 hex string, as the PostgreSQL `uuid` type does.

`@stratum-hq/control-plane` no longer depends on `zod-to-json-schema`, which it did not use.
