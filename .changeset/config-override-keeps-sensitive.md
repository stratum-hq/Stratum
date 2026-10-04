---
"@stratum-hq/lib": patch
"@stratum-hq/react": patch
---

Config overrides keep the sensitive flag of the key. An override of a config key that an ancestor marked sensitive is stored as sensitive, even when the write passes `sensitive: false`. Before, the override was stored without the flag. A write to a key that the tenant itself marked sensitive keeps the flag when the write omits it; an explicit `sensitive: false` still clears it. `ConfigEditor` sends the flag when it overrides an inherited sensitive key.
