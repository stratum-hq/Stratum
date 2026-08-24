# Stratum Design System

This document defines the Stratum visual identity: "Strata," the earth-toned
retheme that replaced the "Core Sample" direction from issue #145
(`docs/identity-proposal.md`, kept as historical record). It is the reference
the landing site, the docs site, `@stratum-hq/react`, and the demo dashboard
build to. If a value here and a value in the code disagree, the code's single
source of truth wins and this document is what should be corrected.

## Concept

A stratum is a layer. Stratum is layers of tenancy (root, reseller, client,
team) with configuration, permissions, and isolation flowing down through them.
Strata reads that literally, off a core sample: peat and loam ground, marl and
silt text, one live mineral accent (ember, a copper patina that only appears
where something is reacting), and one sealed color (ochre) that means exactly
one thing. It keeps Core Sample's grammar (the depth rail, the inheritance-flow
signature, the one-accent discipline) and recolors it warm, dark first, and
quiet. This is a *third* direction, not a reversion to the retired "geological
warmth" palette that used a lifestyle-cream and terracotta combination — this
repo's own earlier identity work called that combination "the most common
AI-default aesthetic in circulation." Strata uses deep, quarried grounds
instead of cream, and a single restrained accent rather than a second brand
hue.

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

`@stratum-hq/react`'s `src/styles/default.css` and the demo dashboard
(`packages/demo/web`) carry their own copies of these same values rather than
importing the shared file directly, since they ship and run independently of
the marketing/docs build. Keep all three in sync by hand when a token changes.

## Palette: Strata

Six roles plus two functional colors. Earth-toned, dark first, one bold accent,
and two warm colors that are never decorative.

| Role | Token | Dark | Light | Used for |
|---|---|---|---|---|
| Base canvas | `--peat` / `--surface-0` | `#12100C` | `#F4EFE4` | Page background. Warm near-black ground in dark; limestone paper (quarried warm, not lifestyle cream) in light. |
| Raised surface | `--loam` / `--surface-1` | `#1C1813` | `#FFFCF6` | Cards, code wells, readout panels, the depth rail. |
| Boundary line | `--seam` / `--border` | `#332B21` | `#DBD2BF` | Every border and divider. A seam is the line between two strata: a hairline rule means "a boundary," which is the product's whole job. |
| Primary text | `--marl` / `--text-primary` | `#EFE7D9` | `#1A1611` | Headlines and body. Warm chalk / limestone. |
| Secondary text | `--silt` / `--text-secondary` | `#A79880` | `#4E4636` | Sub text, captions, labels, inactive rail markers. |
| The one accent | `--ember` / `--accent` | `#C9793F` | `#8B4A26` | Copper patina. Reserved for the live thing only: the resolved config value, the inheritance flow line, the active depth, the cursor, one word in the headline. All of the boldness is spent here. |
| Locked state | `--ochre` / `--lock` | `#D9A03F` | `#8A5A0F` | Used only for "locked, cannot override": a config key a parent sealed. Never a heading color, never decoration. |
| Failure | `--oxide` / `--error` | `#C4573A` | `#9C3A22` | Errors only. |

Supporting tokens derived from the same family: `--surface-2`, `--surface-3`
(raised steps between Loam and Seam), `--text-tertiary` (de-emphasized meta and
markers), `--border-hover`, `--ember-strong` (the accent's hover state), and
`--sandstone` (secondary structural tone for package names, code text, and
other mono runs that must not read as "live").

### Accent tokens and the ink that sits on them

Ember is a light color, so text placed on an ember fill must be dark. The
accent is split into three tokens so contrast never breaks:

- `--accent`: the fill and large or non text use of ember (buttons, focus
  rings, a headline word).
- `--accent-text`: small accent text and inline links. Identical to `--accent`
  in dark mode; a darker ember in light mode where it must darken to stay
  legible at body size.
- `--on-accent`: the ink placed on an ember fill (Peat in both themes). This is
  why the primary button label is dark, not white.

## Type: display, body, mono

Three roles, and the deliberate move (carried over from Core Sample) is to
promote the monospace to a first class identity element, not just the code
font.

| Role | Token | Family | Used for |
|---|---|---|---|
| Display | `--font-display` | Libre Franklin, weight 700 to 900 | Short, loud statements only: the hero headline and section headings. A neutral American grotesque, not expanded — engineering-neutral rather than industrial signage. |
| Body | `--font-body` | IBM Plex Sans | All prose. A humanist sans with real engineering heritage, strong on screen legibility, and tabular figures that keep data dense tables aligned. |
| Structural | `--font-mono` | IBM Plex Mono | Labels, eyebrows, depth markers, data readouts, the wordmark, the stratigraphic rail, and code. Coheres with Plex Sans as one superfamily. This is where the "tool for engineers" signal lives. |

Body and mono share the Plex superfamily so prose and code feel like one
document. The fonts are loaded once per surface, non-blocking, from each
document head (see `assets/tokens.css`'s header comment for why).

## Signature: the depth rail and the inheritance flow

The one element the brand is remembered by, unchanged in structure from Core
Sample and recolored to Strata.

- **Depth rail.** A thin persistent left vertical axis marked with tenant depth
  (`d0`, `d1`, `d2`, `d3`, ...) in mono, with hairline Seam rules between levels.
  Depth is real ordered information in this product (root is depth 0, a reseller
  is depth 1), so a numbered structural device is honest here in a way generic
  `01 / 02 / 03` markers are not. The rail doubles as scroll position and section
  anchor and persists on every page.
- **Inheritance flow.** An ember line traces down the rail and a config value
  visibly resolves from an upper stratum to a lower one: `max_users: 1000` set
  at `d0`, an ember marker dropping it to a deeper tenant labeled
  `resolved from d0`. Directly beneath, `data_region: LOCKED` sits in ochre with
  `children cannot override`. That single graphic states the whole product
  thesis (values flow down the layers unless a parent seals them) in the brand's
  own colors.
- **Code well.** Half the page is code, so a code block is a brand surface. It is
  a Loam surface panel with a mono filename tab, a Seam top rule, and a left
  gutter that continues the depth rail. Syntax is restrained so exactly one thing
  glows: the resolved value, in ember (`--syntax-accent`). Keywords are a dusty
  mauve, strings a clay tan, numbers the ochre lock, comments the tertiary gray.
  The code well stays dark in both themes so a snippet reads the same on the
  landing page and in a guide.

## Accessibility floor

These are non negotiable and carried in the shared token layer.

### Contrast

Measured against WCAG 2.1 (AA is 4.5:1 for normal text, 3:1 for large text and
UI). Values below are the real ratios for the shipped tokens.

Dark, on Peat `#12100C`:

| Pair | Ratio | Verdict |
|---|---|---|
| Marl primary text | 15.1:1 | AAA |
| Silt secondary text | 6.7:1 | AA normal, AAA large |
| Ember accent | 5.7:1 | AA normal, safe as small labels and inline code |
| Ochre lock | 8.4:1 | AA/AAA, safe for small badge text |
| Peat ink on an ember button fill | 5.7:1 | AA |

Light, on limestone paper `#F4EFE4`:

| Pair | Ratio | Verdict |
|---|---|---|
| Ink primary text | 16.6:1 | AAA |
| Secondary text `#4E4636` | 7.6:1 | AA/AAA |
| `--accent` ember `#8B4A26` | 3.9:1 | large text, UI, and non text only |
| `--accent-text` ember `#6E3A1D` | 5.6:1 | AA at body size, for small accent text and links |
| Ochre lock `#8A5A0F` | 5.3:1 | AA normal |
| Peat ink on an ember button fill | 4.4:1 | AA normal |

Two ember tokens exist in light mode precisely so the accent never drops below
AA at body size: large and UI uses take `--accent`, small text takes
`--accent-text`. Tertiary text and the large accent token sit at 3:1 or above and
are reserved for large, UI, and de-emphasized meta, never for body copy.

### Focus

Every interactive element shows a visible keyboard focus ring: a 2px ember
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

`--sandstone` is Strata's own secondary structural tone (sand, `#C9B08A` dark /
`#7A5F35` light), used for package names, code text, and other mono runs that
must not read as "live." It is a real token here, not a neutral fallback the
way it was under Core Sample.

## Logo

The mark is three horizontal strokes of decreasing length and increasing
"depth" (marl/loam text tone → silt → ember), evoking sediment layers and the
tenant hierarchy simultaneously. Variants live in `assets/brand/`:

- `stratum-mark.svg` / `stratum-mark-light.svg` — the three-stroke mark alone,
  for dark and light backgrounds respectively.
- `stratum-mark-tile.svg` — square tile variant (favicons, app icons).
- `stratum-lockup.svg` / `stratum-lockup-stacked.svg` / `stratum-lockup-light.svg`
  — mark plus wordmark, horizontal, stacked, and light-background variants.

No raster (PNG/ICO) exports were regenerated as part of the Strata retheme;
`favicon.svg` was updated on both sites, but `favicon.ico`, the PNG favicons,
`apple-touch-icon.png`, and the `og.png` / `og-square.png` social preview
images still reflect the retired Core Sample mark pending a proper export
pass.
