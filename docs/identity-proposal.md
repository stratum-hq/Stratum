# Stratum Identity Proposal

Status: PROPOSAL for sign-off (issue #145, Epic 16). This document locks a
direction. It does not ship assets or change the token layer. Once approved,
#146 builds the asset set and #147 writes `DESIGN.md` plus the real token layer
from what is decided here. If a choice below is wrong, redirect it now; it is
cheap here and expensive after #147.

A throwaway hero mockup accompanies this doc at
`docs/identity-hero-mockup.html`. It is not part of the `landing/` or `website/`
builds and ships nowhere. It exists only to make the direction concrete.

---

## 1. What exists today, and what is weak about it

Both surfaces (`landing/`, the Astro marketing site, and `website/`, the
Starlight docs) already share one token system: `landing/src/styles/global.css`
and `website/src/styles/custom.css` define the same palette, type, and spacing
by hand in two places.

The current direction, in its own words from the code comments, is a
"geological warmth palette":

- **Surfaces:** warm near-black earth (`#0F0E0C` to `#302D2A`) in dark mode, warm
  cream (`#FAF8F5`) in light mode.
- **Accent:** terracotta (`#C05746`).
- **Secondary:** sandstone (`#C4A882`).
- **Type:** Instrument Sans for both `--font-display` and `--font-body` (they are
  literally the same family), JetBrains Mono for code.

Where it is weak:

1. **It is the exact look the brief rejects.** Warm cream plus a terracotta
   accent is the most common AI-default aesthetic in circulation right now. It
   reads as lifestyle or generic warm-minimal SaaS. Terracotta is a pottery
   color; sandstone is a decor color. Neither says "database infrastructure" to a
   platform engineer. The identity is fighting its own subject.
2. **There is no type pairing.** `--font-display` and `--font-body` resolve to
   the same font. The display face carries no personality of its own, so the
   headline and the body paragraph are the same voice at different weights. For a
   product whose audience lives in a terminal, the monospace is doing real work
   but has no elevated role; it is just "the code font."
3. **The one genuinely ownable asset is treated as decoration.** The hero already
   contains an ASCII tenant tree and a set of isolation-strategy bars
   (`landing/src/pages/index.astro`). That tree is the single most on-subject
   thing on the page, and it is parked in a side panel as an aside. The identity
   has a spine and is not standing on it.
4. **Light mode doubles down on the cliche.** The light theme is warm cream, which
   is the same default in a lighter key rather than a considered second theme.

The bones are competent (the spacing scale, the reduced-motion handling, the
data-dense packages table are all fine and worth keeping). The problem is the
surface aesthetic and the missing typographic point of view, not the
engineering.

---

## 2. The locked proposal: "Stratigraphy"

One idea drives everything: **a stratum is a layer.** The product is layers of
tenancy (root, reseller, client, team) with config, permissions, and isolation
flowing down through them. The current design took the literal geology reading
(clay, earth, terracotta) and rendered it as the warm cliche. This proposal
keeps the layers idea and renders it in the register the audience actually
respects: a precision instrument for reading and controlling a layered system.
Think architectural blueprint, database `EXPLAIN` output, and a geological
core-sample log, not pottery.

The name is reclaimed literally and made technical.

### 2a. Palette: "Core Sample" (6 roles)

Cool, dark-first, high-signal. Exactly one bold color, plus one warm color that
is never decorative and only ever means one thing.

| Role | Name | Hex (dark) | Where it is used |
|---|---|---|---|
| Base canvas | Basalt | `#0B0E13` | Page background. Deep cool blue-black, the viewport of an instrument. Not pure black (softer), not warm. |
| Raised surface | Core | `#141A22` | Cards, code wells, the depth rail, readout panels. |
| Boundary line | Seam | `#26313D` | Every border and divider. A seam is the line between two strata, so a hairline rule here means "a boundary," which is the product's whole job. |
| Primary text | Chalk | `#E7EDF4` | Headlines and body. Cool near-white, like chalk on a blueprint. |
| Secondary text | Graphite | `#8A97A6` | Sub-text, captions, labels, inactive rail markers. |
| The one accent | Signal | `#4FE3C1` | Phosphor teal. Reserved for the live thing only: the resolved config value, the inheritance flow line, the active depth, the cursor, one word in the headline. This is where all the boldness is spent. |

Plus one functional (not brand) color:

| Role | Name | Hex (dark) | Rule |
|---|---|---|---|
| Locked state | Lock | `#E0A64F` | Amber. Used only for "locked / cannot override" (a config key a parent sealed). It is the single warm color on the page, and it always carries that one meaning. Never a heading color, never decoration. |

**Why this palette, against this subject.** Signal teal is chosen precisely
because it is neither of the two other AI defaults (it is not acid green on
black, and the base is not the broadsheet look). It reads as an oscilloscope
trace or a live status indicator, which is what an accent on an infra tool should
signal: this value is live, this path is active. Making it the only saturated
color forces restraint: the eye is trained to read "teal = the result." That maps
directly onto the product, where the entire point of config inheritance is the
resolved value. The amber Lock is a deliberate inversion of the old terracotta:
the only warm color left is the one that means "sealed," which is semantically
loaded rather than aesthetic.

### 2b. Type: display + body + mono, with mono promoted

Three roles, and the deliberate move is to make the **monospace a first-class
identity element**, not just the code font.

- **Display: Archivo (expanded, 800).** A grotesque set at a wide width axis,
  uppercase, tight leading. It reads as industrial signage or the label stamped
  on a machine: engineered, structural, confident. It is not Space Grotesk (the
  current dev-tool default) and it is not a high-contrast serif (the cliche). Used
  only for short, loud statements: the hero headline and section headings.
- **Body: IBM Plex Sans.** Humanist sans with an actual engineering heritage
  (drawn for IBM), excellent on-screen legibility, and tabular figures that keep
  the data-dense tables aligned. It gives the prose a calm, neutral, technical
  voice that contrasts cleanly with the loud expanded display.
- **Mono: IBM Plex Mono.** Coheres with Plex Sans as one superfamily, with more
  character than JetBrains Mono. Promoted beyond code: it sets every label,
  eyebrow, depth marker, data readout, the wordmark, and the stratigraphic rail.
  This is where the "this is a tool for engineers" signal actually lives.

**Why this pairing.** An expanded grotesque display over a humanist body is a
real tension (wide and mechanical against warm and readable) rather than one
family at two weights. Keeping body and mono in the same Plex superfamily makes
prose and code feel like one document, which matters when half the page is code.
Elevating the mono to a structural role is the typographic version of the whole
concept: the instrument layer is always visible.

### 2c. Layout and structure concept: the depth rail

Every page carries a persistent **left stratigraphic rail**: a thin vertical
axis marked with tenant depth (`d0`, `d1`, `d2`, `d3`, ...) in mono, with hairline
Seam rules between levels. It is not ornament. Depth is real ordered information
in this product (root is depth 0, a reseller is depth 1, and so on), so a
numbered/layered structural device is honest here in a way that generic `01 / 02
/ 03` markers are not. The rail doubles as scroll position and section anchor.

Content sits in horizontal strata separated by labeled Seam rules. The hero is a
"core-sample readout": the marketing statement on the left, and on the right an
instrument panel showing a real tenant tree with a value resolving down through
it. Below the fold, sections are strata; the rail keeps the reader oriented in
depth.

### 2d. The one signature element: the inheritance flow

The single thing the brand is remembered by: **a Signal-teal line that traces
down the depth rail, and a config value that visibly resolves from an upper
stratum to a lower one.** On the hero, the core-sample panel shows
`max_users: 1000` set at `d0` and a teal marker dropping it down to a deeper
tenant with the label `resolved from d0`. Directly beneath, `data_region: LOCKED`
sits in amber with `children cannot override`. That single graphic states the
entire product thesis (values flow down the layers, unless a parent seals them)
in the brand's own colors.

On load, this resolves once as an orchestrated motion (the teal line draws from
`d0` down to the leaf, the resolved value lands). One deliberate moment, not
scattered effects, and fully skipped under `prefers-reduced-motion`.

### 2e. The deliberate, defensible risk

**Commit the whole site to reading like an instrument, not a marketing page.**
Monospace labels everywhere, an ever-present depth axis, a cool near-black
canvas, copy in the register of a readout. The risk is that a non-engineer finds
it cold. The justification: the audience is backend and platform engineers, for
whom "cold and precise" reads as "serious and trustworthy," which is exactly the
signal an infrastructure library needs and is the direct opposite of the warm
marketing look being rejected. Coldness is the point, aimed at the right reader.

---

## 3. Landing hero wireframe

```
+------------------------------------------------------------------------+
|  |> STRATUM                          docs  guides  packages  github (o) |   mono wordmark; teal glyph
+----+-------------------------------------------------------------------+
| d0 |                                     +--- CORE SAMPLE ------------+ |
|    |  POSTGRES-NATIVE . MIT   (mono)     | tenant tree . depth 0-3    | |
|    |                                     |                            | |
|    |  MULTI-                             | d0  acmesec         root   | |
| d1 |  TENANCY                            | d1  |_ northstar-msp  MSP  | |
|    |  THAT GOES  DEEP    (Archivo Exp)   | d2     |_ client-alpha     | |
|    |             ^teal                   | d3        |_ team-eng      | |
|    |                                     | -------------------------- | |
| d2 |  When a `tenant_id` column stops    | max_users: 1000  <- from d0| |   teal (resolved)
|    |  scaling ... hierarchy, config      | data_region: LOCKED        | |   amber (locked)
|    |  inheritance, ABAC, RLS.            +----------------------------+ |
|    |  Start flat. Grow deep.                                           |
| d3 |                                                                   |
|    |  [ $ npm i @stratum-hq/lib ]   [ read the docs -> ]               |   mono pill + teal button
|    |                                                                   |
+----+-------------------------------------------------------------------+
   ^
   depth rail: mono markers d0..d3, Seam rules between, a teal Signal line
   traces top-to-bottom. This rail is the signature and persists on every page.
```

## 4. Code sample treatment (part of the identity)

Half the page is code, so the code block is a brand surface, not an afterthought.
It is a "core well": a Core-surface panel, a mono filename tab, a Seam top rule,
and a left gutter that continues the depth rail (line numbers as strata markers).
Syntax highlighting is deliberately restrained so that exactly one thing glows:
the resolved value. The payoff comment (what inheritance produced) is the only
Signal-teal line in the block, tying code color to the product's core idea.

```
+-- setup.ts ----------------------------------- @stratum-hq/lib --+
| 1 | import { Stratum } from "@stratum-hq/lib";                   |
| 2 |                                                              |
| 3 | const stratum = new Stratum({ pool });                       |
| 4 | const root = await stratum.createTenant({ slug: "acmesec" });|
| 5 | const msp  = await stratum.createTenant({ parent_id: root });|
| 6 |                                                              |
| 7 | await stratum.setConfig(root.id, "max_users", 1000);         |
| 8 | const cfg = await stratum.resolveConfig(msp.id);             |
| 9 | // -> max_users: 1000  inherited from "acmesec"    <-- teal  |
+---+--------------------------------------------------------------+
  ^ gutter = continuation of the depth rail (line numbers as strata)
    keywords: muted violet   strings: muted teal-green
    numbers: amber   the resolved comment on line 9: Signal teal
```

## 5. Accessibility (contrast, dark and light)

Contrast was checked against WCAG 2.1 for the primary pairings. Verify final
values in #147 once the token layer is real.

Dark theme (on Basalt `#0B0E13`):

- Chalk `#E7EDF4` text: about 16:1. Passes AAA.
- Graphite `#8A97A6` secondary text: about 6.5:1. Passes AA for normal text,
  AAA for large.
- Signal `#4FE3C1` accent: about 12:1. Passes AAA even as normal text, so it is
  safe as small labels and inline code, not only as large display.
- Lock `#E0A64F` amber: about 9:1. Passes AA/AAA; safe for small badge text.

Light theme is a deliberate cool "drafting paper" (`#F4F7FA`), **not warm
cream**, which is part of rejecting the old look:

- Chalk inverts to ink `#0B0E13` on paper: about 16:1.
- Signal must darken on light. Two tokens: `#0E8C77` (about 3.8:1) is for large
  or bold display, buttons, and non-text UI only; small accent text and inline
  links use a darker `#0A6E5B` (about 5.6:1, passes AA for normal text). #147
  should ship both so the accent never drops below AA at body size.
- Lock darkens to `#8A5A0F` for AA on paper.

Non-color floor, carried over from what already works: visible keyboard focus
(the existing `:focus-visible` teal outline pattern), full `prefers-reduced-motion`
support (the one-shot inheritance animation is skipped, nothing depends on it),
and information never conveyed by color alone (the locked state also carries the
word `LOCKED`, the resolved state also carries `resolved from d0`).

## 6. Carrying the identity into the docs (Starlight, Epic 18)

The docs already theme Starlight through CSS variable overrides in
`website/src/styles/custom.css`, so this direction maps onto the same seams:

- **Tokens:** `--sl-color-accent` becomes Signal; `--sl-color-*` grays remap to
  the Basalt/Core/Seam/Chalk/Graphite ramp; `--sl-color-bg` becomes Basalt (dark)
  and drafting-paper (light). One shared token source feeds both sites in #147 so
  they cannot drift, replacing today's two hand-maintained copies.
- **Type:** `--sl-font` becomes IBM Plex Sans, `--sl-font-mono` becomes IBM Plex
  Mono, and Starlight's heading font becomes Archivo Expanded, matching the
  landing hero exactly.
- **The signature carries:** the depth rail becomes the docs' left edge motif,
  and the existing config badges (`badge-inherited`, `badge-locked`, `badge-own`)
  re-map cleanly, inherited to Signal teal, locked to amber Lock, so the same
  visual grammar that explains inheritance on the landing page explains it in the
  guides. Code blocks use the same core-well treatment, so a snippet looks
  identical whether it is on the landing page or in a guide.
- **Result:** a reader crossing from `stratum-hq.org` to `docs.stratum-hq.org`
  sees one product, one instrument, one palette.

---

## 7. Decision summary (approve or redirect)

- **Concept:** Stratigraphy. The product read as a precision instrument for
  layered tenant systems, reclaiming the name literally in a technical register.
- **Palette:** Core Sample. Basalt `#0B0E13`, Core `#141A22`, Seam `#26313D`,
  Chalk `#E7EDF4`, Graphite `#8A97A6`, Signal teal `#4FE3C1`, plus functional
  Lock amber `#E0A64F`. Cool, dark-first, one accent, cool drafting-paper light
  mode (not warm cream).
- **Type:** Archivo Expanded (display) / IBM Plex Sans (body) / IBM Plex Mono
  (mono, promoted to a structural identity role).
- **Signature:** the depth rail plus the Signal-teal inheritance flow, a config
  value resolving down the strata, with the sealed key in amber.
- **Risk taken:** commit the whole site to an instrument aesthetic aimed at
  engineers, accepting "cold" as the cost of "precise."

If this is approved, #146 and #147 build it. If the accent, the display face, or
the instrument register is not right, redirect any of them here.
