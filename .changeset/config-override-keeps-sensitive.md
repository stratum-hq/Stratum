---
"@stratum-hq/core": patch
"@stratum-hq/lib": patch
"@stratum-hq/react": patch
---

Config overrides keep the sensitive flag of the key. An override of a config key that an ancestor marked sensitive is stored as sensitive, even when the write passes `sensitive: false`. Before, the override was stored without the flag. A config write that leaves out `sensitive` keeps the key's current flag; an explicit `sensitive: false` still clears a flag the tenant set itself. `SetConfigInputSchema` no longer defaults `sensitive` to `false`, so an omitted flag reaches the library as omitted, including through the control plane API. `ConfigEditor` sends the flag when it overrides an inherited sensitive key.
