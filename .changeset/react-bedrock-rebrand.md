---
"@stratum-hq/react": minor
---

Restyle the shipped stylesheet (`@stratum-hq/react/styles`) with the Stratum Bedrock identity.

- New type: Big Shoulders Display, Instrument Sans and Martian Mono replace the previous typefaces. The stylesheet's Google Fonts `@import` loads the new families.
- New palette: the Bedrock (dark) and Daylight (light) values from the shared tokens, with five rock bands, magma as the one accent and vein teal for inherited values. Every existing `--color-*` alias still resolves; new tokens include `--magma`, `--vein`, `--flow`, `--lock`, `--rule`, `--focus`, the rock bands and `--on-*` inks.
- No rounded corners: `--radius-*` are now `0`. Buttons, tags, fields, tree rows and panels take their shape from clip-path edges, with a rock lip and a soft shadow.
- `TenantTree` and `DraggableTenantTree` draw each tenant as a rock band colored by depth, with a 28px stagger per level. Badges show a glyph plus the word (locked, inherited, delegated, own).
- Dark is now the default for everyone. The stylesheet no longer switches to the light palette from the operating system's `prefers-color-scheme`; set `data-theme="light"` on an ancestor to opt in to Daylight.
- Keyboard focus is a 3px `--focus` ring with a halo, and every animation stops under `prefers-reduced-motion`.
