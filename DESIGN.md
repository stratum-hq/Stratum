# Stratum Design System

This document defines the Stratum visual identity: the "Stratigraphy" direction
approved in issue #145 (`docs/identity-proposal.md`). It is the reference the
landing site (Epic 17) and the docs site (Epic 18) build to. If a value here and
a value in the code disagree, the code's single source of truth wins and this
document is what should be corrected.

## Concept

A stratum is a layer. Stratum is layers of tenancy (root, reseller, client,
team) with configuration, permissions, and isolation flowing down through them.
The identity reads the product as a precision instrument for a layered system:
architectural blueprint, database `EXPLAIN` output, geological core sample. Cool,
dark first, and quiet, with exactly one live color. The register is deliberate:
the audience is backend and platform engineers, for whom "cold and precise"
reads as "serious and trustworthy."

## Single source of truth

All tokens live in one file, `assets/tokens.css`, imported by both surfaces:

- `landing/src/styles/global.css` (Astro marketing site)
- `website/src/styles/custom.css` (Starlight docs)

Neither stylesheet defines a palette of its own. Both `@import` the shared file
and consume the same custom properties, so the two sites cannot drift. Do not
hardcode a hex value in a component. Add or change a token in `assets/tokens.css`
and both sites move together.

`website/src/styles/custom.css` additionally maps Starlight's own `--sl-*`
variables onto these tokens; those mappings reference the tokens with `var()`,
never a literal, so the docs theme inherits any palette change automatically.

## Palette: Core Sample

Six roles plus one functional color. Cool, dark first, one bold accent, and one
warm color that is never decorative.

| Role | Token | Dark | Light | Used for |
|---|---|---|---|---|
| Base canvas | `--basalt` / `--surface-0` | `#0B0E13` | `#F4F7FA` | Page background. A deep cool blue black in dark; cool drafting paper in light, not warm cream. |
| Raised surface | `--core` / `--surface-1` | `#141A22` | `#FFFFFF` | Cards, code wells, readout panels, the depth rail. |
| Boundary line | `--seam` / `--border` | `#26313D` | `#D2DBE4` | Every border and divider. A seam is the line between two strata: a hairline rule means "a boundary," which is the product's whole job. |
| Primary text | `--chalk` / `--text-primary` | `#E7EDF4` | `#0B0E13` | Headlines and body. Cool near white, like chalk on a blueprint. |
| Secondary text | `--graphite` / `--text-secondary` | `#8A97A6` | `#48555F` | Sub text, captions, labels, inactive rail markers. |
| The one accent | `--signal` / `--accent` | `#4FE3C1` | `#0E8C77` | Phosphor teal. Reserved for the live thing only: the resolved config value, the inheritance flow line, the active depth, the cursor, one word in the headline. All of the boldness is spent here. |
| Locked state | `--lock` | `#E0A64F` | `#8A5A0F` | Amber. Used only for "locked, cannot override": a config key a parent sealed. The single warm color on the page, and it always carries that one meaning. Never a heading color, never decoration. |

Supporting tokens derived from the same family: `--surface-2`, `--surface-3`
(raised steps between Core and Seam), `--text-tertiary` (de-emphasized meta and
markers), `--border-hover`, and `--signal-strong` (the accent's hover state).

### Accent tokens and the ink that sits on them

Signal teal is a light color, so text placed on a Signal fill must be dark. The
accent is split into three tokens so contrast never breaks:

- `--accent`: the fill and large or non text use of Signal (buttons, focus
  rings, a headline word).
- `--accent-text`: small accent text and inline links. Identical to `--accent`
  in dark mode; a darker teal in light mode where Signal must darken to stay
  legible at body size.
- `--on-accent`: the ink placed on a Signal fill (Basalt in both themes). This
  is why the primary button label is dark, not white.

The amber Lock is the deliberate inversion of the retired terracotta: the only
warm color left is the one that means "sealed."

## Type: display, body, mono

Three roles, and the deliberate move is to promote the monospace to a
first class identity element, not just the code font.

| Role | Token | Family | Used for |
|---|---|---|---|
| Display | `--font-display` | Archivo, expanded width (`wdth` 125), weight 600 to 800 | Short, loud statements only: the hero headline and section headings. An expanded grotesque reads as industrial signage, engineered and structural. |
| Body | `--font-body` | IBM Plex Sans | All prose. A humanist sans with real engineering heritage, strong on screen legibility, and tabular figures that keep data dense tables aligned. |
| Structural | `--font-mono` | IBM Plex Mono | Labels, eyebrows, depth markers, data readouts, the wordmark, the stratigraphic rail, and code. Coheres with Plex Sans as one superfamily. This is where the "tool for engineers" signal lives. |

The pairing is a real tension (a wide, mechanical display over a warm, readable
body) rather than one family at two weights. Body and mono share the Plex
superfamily so prose and code feel like one document. The fonts are loaded once,
in `assets/tokens.css`.

## Signature: the depth rail and the inheritance flow

The one element the brand is remembered by. Epics 17 and 18 implement it; it is
documented here so both build the same thing.

- **Depth rail.** A thin persistent left vertical axis marked with tenant depth
  (`d0`, `d1`, `d2`, `d3`, ...) in mono, with hairline Seam rules between levels.
  Depth is real ordered information in this product (root is depth 0, a reseller
  is depth 1), so a numbered structural device is honest here in a way generic
  `01 / 02 / 03` markers are not. The rail doubles as scroll position and section
  anchor and persists on every page.
- **Inheritance flow.** A Signal teal line traces down the rail and a config
  value visibly resolves from an upper stratum to a lower one: `max_users: 1000`
  set at `d0`, a teal marker dropping it to a deeper tenant labeled
  `resolved from d0`. Directly beneath, `data_region: LOCKED` sits in amber with
  `children cannot override`. That single graphic states the whole product
  thesis (values flow down the layers unless a parent seals them) in the brand's
  own colors.
- **Code well.** Half the page is code, so a code block is a brand surface. It is
  a Core surface panel with a mono filename tab, a Seam top rule, and a left
  gutter that continues the depth rail. Syntax is restrained so exactly one thing
  glows: the resolved value, in Signal teal (`--syntax-accent`). Keywords are a
  muted violet, strings a muted teal green, numbers the Lock amber, comments the
  tertiary gray. The code well stays dark in both themes so a snippet reads the
  same on the landing page and in a guide.

## Accessibility floor

These are non negotiable and carried in the shared token layer.

### Contrast

Measured against WCAG 2.1 (AA is 4.5:1 for normal text, 3:1 for large text and
UI). Values below are the real ratios for the shipped tokens.

Dark, on Basalt `#0B0E13`:

| Pair | Ratio | Verdict |
|---|---|---|
| Chalk primary text | 16.4:1 | AAA |
| Graphite secondary text | 6.5:1 | AA normal, AAA large |
| Signal accent | 12.1:1 | AAA, safe as small labels and inline code |
| Lock amber | 9.0:1 | AA/AAA, safe for small badge text |
| Basalt ink on a Signal button fill | 12.1:1 | AAA |

Light, on drafting paper `#F4F7FA`:

| Pair | Ratio | Verdict |
|---|---|---|
| Ink primary text | 18.0:1 | AAA |
| Secondary text `#48555F` | 7.1:1 | AA/AAA |
| `--accent` Signal `#0E8C77` | 3.9:1 | large text, UI, and non text only |
| `--accent-text` Signal `#0A6E5B` | 5.8:1 | AA at body size, for small accent text and links |
| Lock amber `#8A5A0F` | 5.5:1 | AA normal |
| Basalt ink on a Signal button fill | 4.6:1 | AA normal |

Two Signal tokens exist in light mode precisely so the accent never drops below
AA at body size: large and UI uses take `--accent`, small text takes
`--accent-text`. Tertiary text and the large accent token sit at 3:1 or above and
are reserved for large, UI, and de-emphasized meta, never for body copy.

### Focus

Every interactive element shows a visible keyboard focus ring: a 2px Signal
`:focus-visible` outline with a 3px offset. Focus is never removed without a
replacement of equal or greater visibility.

### Motion

`prefers-reduced-motion: reduce` is fully honored. Transitions and animations
collapse to near zero duration, smooth scrolling is disabled, and the one shot
inheritance animation on the hero is skipped entirely. Nothing depends on motion
to be understood.

### Never by color alone

Information is never conveyed by color alone. The locked state also carries the
word `LOCKED`; the resolved state also carries `resolved from d0`. Color
reinforces meaning that is already stated in text.

## Token reference

Semantic aliases that components use, all defined in `assets/tokens.css`:

- Surfaces: `--surface-0` (canvas), `--surface-1` (raised), `--surface-2`,
  `--surface-3`.
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary`.
- Accent: `--accent`, `--accent-hover`, `--accent-text`, `--accent-muted`,
  `--on-accent`.
- Boundary: `--border`, `--border-hover`.
- Locked: `--lock`, `--lock-muted`.
- Code: `--code-bg`, `--code-text`, and syntax roles `--syntax-keyword`,
  `--syntax-function`, `--syntax-string`, `--syntax-number`, `--syntax-comment`,
  `--syntax-accent`.
- Type: `--font-display`, `--font-body`, `--font-mono`.
- Scale and motion: `--space-1` through `--space-32`, `--radius-sm` through
  `--radius-full`, `--ease-out` / `--ease-in` / `--ease-in-out`,
  `--duration-fast` / `--duration-normal` / `--duration-slow`, and `--shadow-sm`
  through `--shadow-lg`.

The retired warm palette used a `--sandstone` secondary hue. Core Sample has no
second brand color, so `--sandstone` resolves to neutral graphite and remains
only so existing markup keeps rendering; new work should reference the text and
accent tokens directly.
