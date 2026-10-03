# Stratum Design System

This document defines the Stratum visual identity: **Bedrock**, rock layers seen
in cross-section. It replaced the "Strata" retheme (a copper accent on
near-black, a grotesque and superfamily type pairing, thin hairline UI), which
itself replaced the "Core
Sample" direction from issue #145 (`docs/identity-proposal.md`, kept as
historical record). It is the reference the landing site, the docs site,
`@stratum-hq/react`, and the demo dashboard build to. If a value here and a
value in the code disagree, the code's single source of truth wins and this
document is what should be corrected.

## Concept

A stratum is a layer. Stratum is layers of tenancy (root, reseller, client,
team) with configuration, permissions, and isolation flowing down through them.
Bedrock draws that literally: every screen is a stack of rock layers, each one
resting on the one above, with ragged cut edges, a thin rock lip and a soft
shadow pool under each layer, and one hot color (magma) breaking through from
below. Its cool counterweight is vein teal, which marks what flows down the
tree.

Rules that hold everywhere:

- **No rounded corners.** Shape comes from clip-path "edge" polygons
  (`--edge-ledge`, `--edge-ledge-b`, `--edge-row`, `--edge-chip`, `--edge-slab`,
  `--edge-fault`). `--radius-md`, `--radius-lg` and `--radius-full` are `0`.
- **Layers stack.** A lower layer overlaps the ragged top of the one above
  (negative margin, rising z-index). No gaps of ground between layers of one
  stack.
- **Rock bands mean depth.** Shallow to deep: `--topsoil`, `--clay`,
  `--sandstone-band`, `--limestone`, `--basalt`. Never reorder them for
  decoration.
- **One hot color per view.** Magma is spent on the single most important
  action or state: the primary button, a locked key, the active isolation depth.
- **State is word plus glyph plus color.** `■ LOCKED` is magma, `↓ INHERITED`
  is vein, `⇄ DELEGATED` is amber, `△ OVERRIDE` is ink.
- **Motion eases, never steps.** `--ease-out` is `cubic-bezier(0.22, 1, 0.36, 1)`.
  No `steps()`, no shaking, and every keyframe stops under
  `prefers-reduced-motion`.

### A note on Daylight and "cream and terracotta"

Earlier identity work in this repository rejected a "cream and terracotta" look
as the most common AI-default aesthetic. Daylight (warm paper `#F2E9D8`, with a
clay band `#D2683C` in the strata) sits close to that line. It is kept as
designed by owner decision: Bedrock (dark) is the default for every visitor,
and Daylight is differentiated by the magma and vein pairing, the textured rock
and the ragged edges rather than by flat cream panels.

## Single source of truth

All tokens live in one file, `assets/tokens.css`, imported by both sites:

- `landing/src/styles/global.css` (Astro marketing site)
- `website/src/styles/custom.css` (Starlight docs)

Neither stylesheet defines a palette of its own. Do not hardcode a hex value in
a component. Add or change a token in `assets/tokens.css` and both sites move
together. `website/src/styles/custom.css` also maps Starlight's `--sl-*`
variables onto these tokens with `var()`, never a literal.

`@stratum-hq/react`'s optional Bedrock theme, `src/styles/theme-bedrock.css`,
carries its own copy of the same values under `--stratum-*` names (it ships
independently of the sites), and the demo dashboard (`packages/demo/web`)
consumes that stylesheet. Keep `theme-bedrock.css` in step with
`assets/tokens.css` by hand when a token changes.

## Themes

Bedrock (dark) is the default on both sites and in `@stratum-hq/react` for every
visitor, whatever the OS color scheme. Daylight applies only when the visitor
picks it with the theme toggle, and the choice is remembered in localStorage
(`stratum-theme` on the landing site, `starlight-theme` on the docs, where
`website/src/components/ThemeProvider.astro` and `ThemeSelect.astro` replace
Starlight's defaults). In `@stratum-hq/react`, Daylight applies under
`[data-theme="light"]`.

## Palette

| Role | Token | Bedrock | Daylight | Used for |
|---|---|---|---|---|
| Ground | `--peat` / `--surface-0` | `#120D0B` | `#F2E9D8` | Page background. |
| Surface | `--loam` / `--surface-1` | `#1C1511` | `#FAF4E6` | The inner face of a Layer: cards, panels. |
| Raised surface | `--surface-2` / `--surface-3` | `#281E18` / `#332820` | `#FFFAF0` / `#E8DCC4` | A panel inside a panel, tags, disabled faces. |
| Primary ink | `--marl` / `--text-primary` | `#F4EAD8` | `#1C140F` | Headlines and body. |
| Secondary ink | `--silt` / `--text-secondary` | `#C2B19A` | `#5A4A3B` | Sub text, captions, labels. |
| Tertiary ink | `--text-tertiary` | `#9A8670` | `#7A6552` | Large or UI meta only, never body copy. |
| Magma | `--magma` / `--accent` (`--ember` kept as an alias) | `#FF5B1F` | `#C93A08` | The one hot color: primary action, LOCKED, active depth. |
| Magma text | `--accent-text` | `#FF6A33` | `#B32F00` | Small magma text and links. |
| Ink on magma | `--on-accent` | `#120D0B` | `#FFFAF0` | Button labels and tag text on a magma fill. Flips by theme. |
| Vein | `--vein` / `--flow` / `--focus` | `#35C2A8` | `#0B7A68` (focus `#0B6B5B`) | INHERITED, the resolved value, success, focus rings. |
| Amber | `--amber-fill` / `--ochre` | `#FFB21E` | fill `#F2A900`, text `#8A5A00` | DELEGATED and warnings. |
| Error | `--oxide` / `--error` | `#FF6A33` | `#B32F00` | Errors, always with the word "Error". |
| Rule | `--rule` | `#8C7660` | `#7A6552` | Control borders and the depth rail, 3:1 on every ground. |
| Seam | `--seam` / `--border` | `#3A2F26` | `#D9CCB2` | Decorative hairlines only. Controls use `--rule`. |

Rock bands, the same in both themes, shallow to deep:

| Band | Token | Value | Ink on it |
|---|---|---|---|
| Topsoil (depth 0) | `--topsoil` | `#8F5F36` | `--on-strata-dark` `#F4EAD8` |
| Clay (depth 1) | `--clay` | `#D2683C` | `--on-strata-light` `#120D0B` |
| Sandstone (depth 2) | `--sandstone-band` | `#E0B266` | `--on-strata-light` |
| Limestone (depth 3) | `--limestone` | `#D6CDB8` | `--on-strata-light` |
| Basalt (depth 4 and deeper) | `--basalt` | `#4A4A52` | `--on-strata-dark` |

`--sandstone` (without `-band`) is still the structural sand used for package
names and other mono runs. The code well stays dark in both themes: `--code-bg`
`#0C0907` with `--code-text` `#D6C3A0`, and restrained syntax colors so one
thing glows: the resolved value, in magma (`--syntax-accent`).

### Texture

Rock fills carry `--grain` (an SVG noise tile) and `--lam` (faint
laminations). Light comes from above: dark-ink bands (clay, sandstone,
limestone) get `--lit`, light-ink bands (topsoil, basalt) get `--shade`. Never
stack both, and never put the grain on a large scrolling container. The only
background texture allowed is the faint drifting strata behind a hero; no
gradients or photographs otherwise.

## Type

| Role | Token | Family | Used for |
|---|---|---|---|
| Display | `--font-display` | Big Shoulders Display, 800 to 900 | The hero, section headings (h1, h2), button labels and tenant names. Uppercase, leading 0.9 to 1.0, about 20 percent larger than a regular face at the same weight. |
| Body | `--font-body` | Instrument Sans | All prose, and card and sub-headings (h3 and below). |
| Structural | `--font-mono` | Martian Mono | Labels, slugs, depth markers, data readouts and code. Labels are uppercase with 0.14em tracking. Martian Mono is wide, so code runs at about 12 to 12.5px. |

Fonts load once per surface, non-blocking (preload plus swap), from each
document head. `assets/tokens.css` does not `@import` fonts. Write "Stratum"
with a capital S in running text; the uppercase treatment belongs to display
styles.

## Components

- **Button.** A rock chip: the face is clipped to `--edge-chip` with grain, the
  lip is `drop-shadow(0 4px 0 var(--magma-deep))` on an unclipped wrapper. Hover
  rises 3px and the lip grows, press drops 2px. One magma button per view; a
  second action is vein, a tertiary action is a "scratch" link with a rule
  underline.
- **Layer.** A rock-band lip clipped to `--edge-ledge`, then the inner surface
  clipped to `--edge-ledge-b` a few px lower so the lip varies in thickness,
  with the lip-and-pool shadow on the unclipped element.
- **Tag.** `--edge-chip`, mono, uppercase, glyph plus word.
- **Tenant tree.** One rock band per tenant, colored by depth (basalt repeats
  past depth 4), indented 28px per level, each row overlapping the one above by
  9px, clipped to `--edge-row`.
- **Field.** A sunk face (`--shadow-sunk`) clipped to `--edge-slab`, with a
  fault line under it that turns `--focus` on focus. The error state adds the
  word "Error:".
- **Depth gauge.** The isolation strategies as one continuous stack: shared RLS
  (sandstone), schema (topsoil), database (basalt). The active strategy gets a
  magma rim along its ragged top and a drill marker.

Clip-path removes box-shadow, borders and outlines, so shadows on clipped
elements are `filter: drop-shadow()` on a wrapper, borders become a rock band or
a `--rule` hairline, and no focusable element is itself clipped.

## Signature: the depth rail and the inheritance flow

- **Depth rail.** A thin left axis marked with tenant depth (`d0`, `d1`, ...) in
  Martian Mono, ticks in `--rule`. The vein cursor tracks scroll and marks light
  up as the active depth resolves downward.
- **Inheritance flow.** The hero tenant tree as depth-colored rock bands, with
  `max_users: 1000` resolving down in vein (`↓ INHERITED FROM D0`) and
  `data_region` carrying a magma `■ LOCKED` tag: values flow down the layers
  unless a parent locks them.
- **Code well.** Dark in both themes, a ragged `--edge-ledge` top (it only cuts
  the top few px, so the horizontal scrollbar is never clipped), a mono filename
  tab, and one glowing token.

## Accessibility floor

### Contrast

Measured against WCAG 2.1 (AA is 4.5:1 for normal text, 3:1 for large text and
UI). Re-measure any pair you add; do not trust the grain or shade overlays to
preserve a marginal pair.

Bedrock, on `#120D0B`:

| Pair | Ratio | Verdict |
|---|---|---|
| Ink `--text-primary` | 16.2:1 | AAA |
| Ink muted `--text-secondary` | 9.2:1 | AAA |
| `--accent-text` | 6.8:1 | AA |
| `--text-tertiary` | 5.5:1 | large and UI only |
| `--rule` | 4.5:1 | UI |
| `--focus` | 8.7:1 | UI |
| Dark ink on magma (`--on-accent`) | 6.2:1 | AA |

Daylight, on `#F2E9D8`:

| Pair | Ratio | Verdict |
|---|---|---|
| Ink `--text-primary` | 15.1:1 | AAA |
| Ink muted `--text-secondary` | 7.0:1 | AAA |
| `--accent-text` | 5.2:1 | AA |
| `--text-tertiary` | 4.6:1 | AA, still kept to meta |
| `--rule` | 4.6:1 | UI |
| `--focus` | 5.3:1 | UI |
| Light ink on magma (`--on-accent`) | 4.9:1 | AA |

Rock bands: `--on-strata-dark` only on topsoil and basalt (4.6:1 and 7.4:1),
`--on-strata-light` only on clay, sandstone and limestone (5.3:1 or better).

### Focus

Every interactive element shows a solid 3px `--focus` outline with an offset
of at least 3px. Focus is never removed without a replacement of equal or
greater visibility.

### Motion

`prefers-reduced-motion: reduce` is fully honored: every keyframe (settle,
breathe, drill, crack, drifting strata) stops, transitions collapse, smooth
scrolling is off, and scroll reveals resolve to their final state. At most one
element per screen breathes. Nothing depends on motion to be understood.

### Never by color alone

The locked state carries the word `LOCKED` and `■`, inherited carries `↓` and
`INHERITED`, delegated carries `⇄` and `DELEGATED`, errors carry "Error".

## Token reference

All defined in `assets/tokens.css`:

- Surfaces: `--surface-0` to `--surface-3`.
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary`.
- Accent: `--accent`, `--accent-hover`, `--accent-text`, `--accent-muted`,
  `--on-accent`, plus `--magma`, `--magma-deep`.
- Flow: `--flow`, `--flow-muted`, `--on-flow`, `--vein`, `--vein-deep`,
  `--on-vein`, `--focus`.
- Lock and amber: `--lock`, `--lock-muted`, `--ochre`, `--amber-fill`,
  `--on-ember`.
- Rock: `--topsoil`, `--clay`, `--sandstone-band`, `--limestone`, `--basalt`,
  `--on-strata-dark`, `--on-strata-light`.
- Boundaries: `--rule`, `--border`, `--border-hover`.
- Code: `--code-bg`, `--code-text`, `--syntax-keyword`, `--syntax-function`,
  `--syntax-string`, `--syntax-number`, `--syntax-comment`, `--syntax-accent`.
- Type: `--font-display`, `--font-body`, `--font-mono`.
- Shape and texture: `--edge-ledge`, `--edge-ledge-b`, `--edge-row`,
  `--edge-chip`, `--edge-slab`, `--edge-fault`, `--grain`, `--lam`, `--lit`,
  `--shade`.
- Scale, motion and shadow: `--space-1` to `--space-32`, `--radius-sm` to
  `--radius-full` (all `0` except `--radius-sm`), `--ease-out` / `--ease-in` /
  `--ease-in-out`, `--duration-fast` / `--duration-normal` / `--duration-slow`,
  `--shadow-sm` to `--shadow-lg`, `--shadow-glow`, `--shadow-sunk`.

## Logo

The mark is three stacked rock slabs stepping down and to the right: topsoil,
clay, magma. It echoes the tenant tree (each layer indented under the one
above) and the one hot color breaking through at the bottom. The same colors
work on both themes. Variants live in `assets/brand/`:

- `stratum-mark.svg` / `stratum-mark-light.svg`: the mark alone (identical
  artwork; both names are kept for existing references).
- `stratum-mark-tile.svg`: the mark on a `#120D0B` square tile (favicons, app
  icons).
- `stratum-lockup.svg` / `stratum-lockup-stacked.svg` / `stratum-lockup-light.svg`:
  mark plus the wordmark "Stratum" in mixed case, Big Shoulders Display 900,
  horizontal, stacked, and for light backgrounds. The wordmark is never set
  uppercase. It is converted to outlines, so the files do not depend on the
  font being installed.

Raster exports were regenerated from these SVGs for the Bedrock identity, in
both `landing/public` and `website/public`: `favicon.ico` (16, 32, 48),
`favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`,
`icon-512.png`, `og.png` (1200x630) and `og-square.png` (1200x1200). Favicon
links carry the cache-bust `?v=bedrock`.
