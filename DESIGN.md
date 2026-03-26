# Stratum Design System

Last updated: 2026-03-26
Source: /design-consultation + /design-review

## Design Philosophy

**Technical precision meets geological warmth.** Stratum means "layer" — geological strata.
The visual identity draws from earth tones and rock formations, not the default dev-tool
blue/teal/purple palette. The result is instantly recognizable: warm, grounded, serious.

Every element earns its pixels. No decorative cards, no emoji icons, no symmetrical grids.
Typography and spacing do the heavy lifting. Color is used with restraint — the accent
appears only where it matters most.

## Color System

### Dark Mode (primary)

```css
:root {
  /* Surfaces — deep earth, not pure black */
  --surface-0: #0F0E0C;        /* page background — near-black warm */
  --surface-1: #1A1815;        /* card/section background */
  --surface-2: #252220;        /* elevated surface, hover */
  --surface-3: #302D2A;        /* active, selected */

  /* Text */
  --text-primary: #E8E2D9;     /* warm off-white, not pure white */
  --text-secondary: #A39E95;   /* muted, secondary info */
  --text-tertiary: #6B6560;    /* disabled, placeholder */

  /* Accent — terracotta (used sparingly) */
  --accent: #C05746;           /* primary accent — terracotta */
  --accent-hover: #D4654E;     /* lighter on hover */
  --accent-muted: #C0574620;   /* transparent for backgrounds */

  /* Warm neutrals — sandstone */
  --sandstone: #C4A882;        /* secondary accent, highlights */
  --sandstone-muted: #C4A88240;

  /* Semantic */
  --success: #5B8C5A;          /* muted forest green */
  --warning: #C4A244;          /* amber, warm */
  --error: #C05746;            /* same as accent — terracotta */
  --info: #7A8B9A;             /* cool slate */

  /* Borders */
  --border: #2A2725;           /* subtle, warm */
  --border-hover: #3D3935;

  /* Code */
  --code-bg: #161412;
  --code-text: #C4A882;        /* sandstone for code */
}
```

### Light Mode (secondary — for docs only)

```css
[data-theme="light"] {
  --surface-0: #FAF8F5;        /* warm cream */
  --surface-1: #F0EDE8;
  --surface-2: #E5E0DA;
  --surface-3: #D6D0C8;

  --text-primary: #1A1815;
  --text-secondary: #5C5650;
  --text-tertiary: #8A847D;

  --accent: #A84535;           /* deeper terracotta for contrast */
  --accent-hover: #C05746;

  --border: #D6D0C8;
  --border-hover: #C4BDB4;
}
```

## Typography

### Font Stack

```css
:root {
  /* Display/headings — distinctive, geometric */
  --font-display: "Instrument Sans", system-ui, sans-serif;

  /* Body — clean, readable */
  --font-body: "Instrument Sans", system-ui, sans-serif;

  /* Monospace — for code */
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
}
```

**Why Instrument Sans:** Free (Google Fonts), geometric but warm, has variable weight support,
not overused like Inter/Roboto/DM Sans. The slight character gives Stratum its own voice.

### Type Scale (1.25 major third)

| Level | Size | Weight | Line-height | Usage |
|-------|------|--------|-------------|-------|
| Display | 48-56px | 700 | 1.1 | Hero headline only |
| H1 | 36px | 700 | 1.15 | Page titles |
| H2 | 28px | 600 | 1.2 | Section headings |
| H3 | 22px | 600 | 1.25 | Subsection headings |
| H4 | 18px | 600 | 1.3 | Card titles, labels |
| Body | 16px | 400 | 1.6 | Paragraph text |
| Small | 14px | 400 | 1.5 | Captions, meta |
| Code | 14px | 400 | 1.5 | Inline code, blocks |

### Rules

- Max line length: 65ch for body text
- `text-wrap: balance` on all headings
- `font-variant-numeric: tabular-nums` on number columns
- No letterspacing on lowercase text
- Headings never skip levels (H1 -> H2 -> H3, never H1 -> H3)

## Spacing

8px base scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-24: 96px;
  --space-32: 128px;
}
```

## Border Radius

Hierarchy — not uniform:

```css
:root {
  --radius-sm: 4px;    /* buttons, inputs, tags */
  --radius-md: 8px;    /* cards, containers */
  --radius-lg: 12px;   /* modals, large surfaces */
  --radius-full: 9999px; /* pills, avatars */
}
```

Inner radius = outer radius - gap (nested elements).

## Icons

**SVG only. Never emoji.** Use a consistent icon set:
- Lucide Icons (recommended) — clean, 24x24, 1.5px stroke
- Single color: `currentColor`
- Size: 20px inline, 24px standalone, 16px in compact UI

## Motion

```css
:root {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.5, 0, 0.75, 0);
  --ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}
```

- Only animate `transform` and `opacity`
- `prefers-reduced-motion` respected
- No `transition: all`

## Layout Rules

- Max content width: 1200px
- Landing page hero: full-bleed, edge-to-edge
- No symmetrical 3-column feature grids
- Left-align body text (not centered)
- Cards earn their existence — no decorative card grids
- Sections have varied heights and layouts — break the cookie-cutter rhythm

## Anti-Patterns (never do)

- Emoji as design elements
- Purple/violet/indigo gradients
- Colored left-border on cards
- "Everything you need for..." headings
- Uniform card grids (same size, same style, repeated 3/6x)
- Centered everything
- Decorative blobs, circles, wavy dividers
- Generic hero copy ("Welcome to...", "Unlock the power of...")

## React Component Styling

All React components in `@stratum-hq/react` must use CSS custom properties from this
design system. Components ship with a default theme that matches these values.

- Use `var(--surface-1)` not hardcoded hex
- Use `var(--text-primary)` not `#fff` or `white`
- All interactive elements have hover, focus-visible, and active states
- Touch targets >= 44px
- `cursor: pointer` on all clickable elements

## Docs Site (Starlight)

The docs site should use the light mode palette by default with dark mode toggle.
Override Starlight's default theme with custom CSS using the variables above.
