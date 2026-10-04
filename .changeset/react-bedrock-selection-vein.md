---
"@stratum-hq/react": patch
---

Bedrock theme: the selected tenant in `TenantTree` is marked in vein, not magma. Magma stays on the primary action and on LOCKED, so a view that shows a tree next to an editor has one hot color. The active `TenantSwitcher` item, LOCKED rows and the highlighted cascade row lose their 4px left stripe: a raised face or a tint, plus the LOCKED tag, carries the state.
