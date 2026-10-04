---
"@stratum-hq/core": minor
"@stratum-hq/lib": minor
"@stratum-hq/react": patch
"@stratum-hq/control-plane": patch
---

Config overrides keep the sensitive flag of the key. An override of a config key that an ancestor marked sensitive is stored as sensitive, even when the write passes `sensitive: false`. When a tenant stores a key as sensitive, the overrides of that key in its descendants are stored as sensitive in the same transaction. A config write that leaves out `sensitive` keeps the key's current flag; an explicit `sensitive: false` still clears a flag the tenant set itself. A `batchSetConfig` call that names the same key more than once is rolled back. `SetConfigInputSchema` no longer defaults `sensitive` to `false`, so an omitted flag reaches the library as omitted, including through the control plane config routes. `ConfigEditor` sends the flag when it overrides an inherited sensitive key.

After upgrading, run `stratum.applySensitiveConfigFlags()` once to apply the flag to existing overrides.
