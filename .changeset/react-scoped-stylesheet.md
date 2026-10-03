---
"@stratum-hq/react": major
---

Scope the stylesheet to the components and make Bedrock an optional theme.

`@stratum-hq/react/styles` no longer changes the host page. The old `default.css` is replaced by three files:

- `styles/base.css` (also `@stratum-hq/react/styles`): a neutral look. Every rule is in the `stratum` cascade layer, every custom property starts with `--stratum-`, every selector matches a `stratum-*` element, and the file makes no network request. It follows `prefers-color-scheme` unless an ancestor sets `data-theme="light"` or `data-theme="dark"`. Its reduced-motion rule applies to `stratum-*` elements only.
- `styles/theme-bedrock.css` (optional): the Bedrock look, with Daylight as its light palette.
- `styles/fonts.css` (optional): the Bedrock fonts from Google Fonts. This is now the only file that makes a request.

`DraggableTenantTree` and `ConfigInheritanceVisualizer` no longer render a `<style>` element; their rules are in the stylesheets. `TenantThemeProvider`'s `primaryColor` now sets `--stratum-accent`, so it changes the accent of the components inside it.

Migration:

- To keep the previous look, import all three files: `fonts.css`, `base.css` and `theme-bedrock.css`. Bedrock is no longer forced for every visitor: without `data-theme`, the palette follows `prefers-color-scheme`. Set `data-theme="dark"` on an ancestor to keep Bedrock for everyone.
- The stylesheet no longer declares tokens on `:root`. If your own CSS read them, move to the `--stratum-*` names. They are declared on the outermost `stratum-*` element, so add the class `stratum-scope` to the element whose subtree reads them:
  - `--surface-0` … `--surface-3`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--accent`, `--accent-hover`, `--accent-text`, `--on-accent`, `--accent-muted`, `--flow`, `--on-flow`, `--flow-muted`, `--focus`, `--rule`, `--border`, `--border-hover`, `--lock`, `--lock-muted`, `--success`, `--warning`, `--error`, `--info` and their `-bg` forms, `--code-bg`, `--code-text`, `--font-display`, `--font-body`, `--font-mono`, `--font-size-*`: add the `--stratum-` prefix.
  - `--magma` → `--stratum-accent`; `--magma-deep` → `--stratum-accent-deep`; `--vein` → `--stratum-flow`; `--on-vein` → `--stratum-on-flow`; `--ochre` → `--stratum-warning`; `--amber-fill` → `--stratum-warning-fill`; `--on-ember` → `--stratum-on-warning`; `--oxide` → `--stratum-error`; `--sandstone` → `--stratum-info`; `--font-code` → `--stratum-font-mono`.
  - `--topsoil`, `--clay`, `--sandstone-band`, `--limestone`, `--basalt` → `--stratum-tree-band-0` … `--stratum-tree-band-4`; `--on-strata-dark` / `--on-strata-light` → `--stratum-tree-on-band-0` … `-4`.
  - `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`, `--space-3xl` → `--stratum-space-1`, `-2`, `-3`, `-4`, `-6`, `-12`. `--radius-*` → `--stratum-radius-sm` or `--stratum-radius`.
  - `--duration-fast`, `--duration-normal`, `--duration-slow`, `--ease-out`, `--ease-in-out` → the `--stratum-` forms.
  - Bedrock only: `--edge-*` → `--stratum-edge-*` (set `--stratum-edge: none` to remove all edges); `--grain` → `--stratum-grain`; `--lam` → `--stratum-laminations`; `--lit` → `--stratum-light`; `--shade` → `--stratum-shade`.
  - Removed without a replacement: every `--color-*` alias (use the `--stratum-*` token it pointed to, for example `--color-primary` → `--stratum-accent` and `--color-bg-surface` → `--stratum-surface-1`), `--syntax-*`, `--shadow-sm` … `--shadow-xl`, `--shadow-glow`, `--peat`, `--loam`, `--seam`, `--marl`, `--silt`, `--ember`, `--ember-strong`.
