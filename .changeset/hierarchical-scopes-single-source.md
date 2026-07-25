---
"@stratum-hq/control-plane": major
"@stratum-hq/lib": major
"@stratum-hq/core": minor
---

Unify API-key scope resolution and make scope checks hierarchical (FR-53, #132).

Two authorization-semantics changes land together:

- **Hierarchical scopes.** Scope requirements are now checked with a rank
  comparison (`read` < `write` < `admin`) instead of flat set membership, so
  `admin` implies `write` implies `read`. A key minted as `["admin"]` or
  `["write"]` now satisfies the lower-scope routes it previously failed. A new
  `scopeSatisfies(granted, required)` helper in `@stratum-hq/core` is the single
  scope-check primitive; the control-plane authorize middleware uses it. This
  changes same-tenant behavior by scope level only and does not alter any
  cross-tenant boundary.

- **Single scope source.** `validateApiKey` (the auth boundary) and
  `resolveKeyScopes` now resolve scopes through one `resolveEffectiveScopes`
  function: an assigned role's scopes govern; otherwise the key's own column
  scopes apply; a key with neither defaults to `["read"]`. Previously
  `validateApiKey` read the `api_keys.scopes` column and ignored an assigned
  role, so assigning a role had no effect on control-plane authorization.
  Assigning a role now governs the key's authorization everywhere, which can
  narrow a key whose role is narrower than its column scopes. Keys without a role
  are unaffected.

Both are breaking changes to authorization behavior; audit any key that carries a
role alongside column scopes, and mint keys with the scopes the caller actually
needs. See the migration guide sections 5.2 and 5.3 in `docs/v1.0-api-surface.md`.
