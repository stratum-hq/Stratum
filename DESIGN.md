# Design System — Stratum

## Product Context
- **What this is:** Universal Tenant Context Engine — hierarchical multi-tenancy for any stack
- **Who it's for:** Backend/fullstack developers building B2B SaaS with nested tenant architectures (MSSP/MSP/client)
- **Space/industry:** Developer infrastructure tools (peers: Stripe, Clerk, WorkOS, Prisma, Linear)
- **Project type:** Developer tool library (embeddable React components) + dashboard + docs site + CLI

## Design Concept: Hierarchy Made Visible

Stratum's product is about things flowing downward — config inheritance, permission delegation, tenant trees. The design system makes hierarchy visible: depth cues, layered surfaces, inheritance color language, and flow indicators. The user should feel the structure before reading a word.

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian — function-first, data-dense, technically credible
- **Decoration level:** Intentional — subtle depth cues (layered surfaces, soft shadows suggesting stacking order) to reinforce hierarchy. Not flat, not skeuomorphic — just enough dimension to show "this is above that"
- **Mood:** The cockpit of a well-designed system. Warm enough to feel intentional, precise enough to feel trustworthy. Developers should look at it and think "these people care about the details"
- **Reference sites:** Stripe (accessibility rigor, restrained color), Linear (compact density, dark-first), Clerk (theming architecture, CSS variables)

## Typography
- **Display/Hero:** Satoshi — geometric sans with authority. Not as clinical as Inter, not as trendy as Clash. Has weight and confidence that reads as "we made deliberate choices"
- **Body/UI:** DM Sans — excellent legibility at 13-14px, tabular-nums support for data alignment, friendly but not playful
- **UI/Labels:** DM Sans (same as body)
- **Data/Tables:** DM Sans with `font-variant-numeric: tabular-nums` for column alignment
- **Code:** JetBrains Mono — the developer standard. Ligatures, clear at 12px
- **Loading:** Satoshi via [Fontshare](https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap), DM Sans + JetBrains Mono via Google Fonts
- **Scale:**
  - `xs`: 11px / 0.6875rem — labels, captions, meta
  - `sm`: 12px / 0.75rem — secondary text, badges, small UI
  - `base`: 13px / 0.8125rem — default body, table cells
  - `md`: 14px / 0.875rem — primary body, form inputs
  - `lg`: 16px / 1rem — section titles, large body
  - `xl`: 20px / 1.25rem — page titles
  - `2xl`: 24px / 1.5rem — hero subtitles
  - `3xl`: 32px / 2rem — display headings
  - `4xl`: 40px / 2.5rem — hero headings

## Color

### Approach: Restrained
One strong accent + warm neutrals. Color is rare and meaningful — not decorative.

### Brand Colors
- **Primary:** `#2563EB` (blue-600) — trust, reliability, depth. Used sparingly: active states, links, primary CTA only
- **Accent:** `#0D9488` (teal-600) — the "inheritance" color. Used for inherited values, flow indicators, tree connections. This is Stratum's visual signature: teal means "this value flowed from above"
  - Hover: `#0F766E`
  - Light: `#CCFBF1`
  - Muted: `#F0FDFA`

### Neutrals (Warm Slate)
| Token | Hex | Usage |
|-------|-----|-------|
| 950 | `#0C1222` | Deepest background (dark mode base) |
| 900 | `#0F172A` | Sidebar background, dark surfaces |
| 800 | `#1E293B` | Sidebar hover, elevated dark surfaces |
| 700 | `#334155` | Dark mode borders, strong dark text |
| 600 | `#475569` | Secondary text (light mode) |
| 500 | `#64748B` | Tertiary text, placeholders |
| 400 | `#94A3B8` | Disabled text, meta information |
| 300 | `#CBD5E1` | Borders (strong) |
| 200 | `#E2E8F0` | Borders (default), dividers |
| 100 | `#F1F5F9` | Background (light mode), table headers |
| 50  | `#F8FAFC` | Page background (light mode) |

### Semantic Colors
| Purpose | Color | Light BG | Usage |
|---------|-------|----------|-------|
| Success | `#059669` | `#D1FAE5` | Active keys, successful operations, "own" positive states |
| Warning | `#D97706` | `#FEF3C7` | Locked values, expiring keys, attention needed |
| Error   | `#DC2626` | `#FEE2E2` | Revoked keys, failed deliveries, destructive actions |
| Info    | `#2563EB` | `#DBEAFE` | RLS badges, informational states (same as primary) |

### Hierarchy Badge Colors
This is the core visual language unique to Stratum:
| Status | Badge Color | Icon | Meaning |
|--------|------------|------|---------|
| Inherited | Teal (`#0D9488` on `#CCFBF1`) | ↑ | Value flows from an ancestor |
| Locked | Warning (`#D97706` on `#FEF3C7`) | ↓ | Value locked by ancestor, cannot override |
| Own | Neutral (`#475569` on `#F1F5F9`) | • | Value set directly on this tenant |

### Dark Mode Strategy
- Swap surface direction: darkest (`#0A0F1A`) as page background, lighter darks as elevated surfaces
- Reduce accent saturation ~15% and shift toward lighter tints for readability
- Dark primary: `#3B82F6`, dark accent: `#2DD4BF`
- Semantic colors shift to lighter tints: success `#34D399`, warning `#FBBF24`, error `#F87171`
- Use `prefers-color-scheme: dark` for auto-detection + manual toggle via `data-theme` attribute

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — data-dense but not cramped. Tables and forms have room to breathe.
- **Scale:**
  | Token | Value | Usage |
  |-------|-------|-------|
  | `2xs` | 2px | Hairline gaps, badge padding |
  | `xs` | 4px | Tight internal padding, icon gaps |
  | `sm` | 8px | Button padding, table cell padding, card internal |
  | `md` | 12px | Form field padding, alert padding |
  | `lg` | 16px | Section padding, card padding, sidebar items |
  | `xl` | 24px | Section gaps, dashboard gutter |
  | `2xl` | 32px | Major section separation |
  | `3xl` | 48px | Page-level separation |
  | `4xl` | 64px | Hero spacing, page top/bottom margins |

## Layout
- **Approach:** Grid-disciplined — strict alignment, predictable structure
- **Grid:** 12 columns on desktop, 8 on tablet, 4 on mobile
- **Max content width:** 1120px
- **Dashboard layout:** Fixed sidebar (240px) + flexible content area with tabbed navigation
- **Breakpoints:**
  | Name | Width | Layout |
  |------|-------|--------|
  | Desktop | >1024px | Sidebar + tabbed content |
  | Tablet | 768-1024px | Collapsible sidebar (hamburger toggle) + full-width content |
  | Mobile | <768px | Bottom sheet tenant switcher, full-width tabs, stacked controls |
- **Border radius** (hierarchical scale):
  | Token | Value | Usage |
  |-------|-------|-------|
  | `sm` | 4px | Inputs, buttons, table cells |
  | `md` | 6px | Cards, dropdowns, alerts |
  | `lg` | 8px | Panels, modals |
  | `xl` | 12px | Dashboard shell, large containers |
  | `full` | 9999px | Badges, pills, avatar circles |

## Shadows (Hierarchy Depth)
Shadows reinforce the stacking metaphor — parent surfaces cast more shadow than children:
| Token | Value | Usage |
|-------|-------|-------|
| `sm` | `0 1px 2px rgba(12,18,34,0.05)` | Table rows, flat cards |
| `md` | `0 2px 8px rgba(12,18,34,0.08), 0 1px 2px rgba(12,18,34,0.04)` | Elevated cards, dropdowns |
| `lg` | `0 4px 16px rgba(12,18,34,0.10), 0 2px 4px rgba(12,18,34,0.06)` | Modals, overlays |
| `xl` | `0 8px 32px rgba(12,18,34,0.12), 0 4px 8px rgba(12,18,34,0.06)` | Dashboard shell, top-level containers |

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension. No decorative animation.
- **Easing:**
  - Enter: `cubic-bezier(0, 0, 0.2, 1)` (ease-out) — elements arrive quickly, settle gently
  - Exit: `cubic-bezier(0.4, 0, 1, 1)` (ease-in) — elements accelerate away
  - Move: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-in-out) — position changes
- **Duration:**
  | Token | Value | Usage |
  |-------|-------|-------|
  | `micro` | 50-100ms | Hover states, focus rings |
  | `short` | 150ms | Button press, toggle, badge appear |
  | `medium` | 250ms | Tab switch, expand/collapse, panel transition |
  | `long` | 400ms | Layout shift, modal enter/exit, page transition |
- **Reduced motion:** Respect `prefers-reduced-motion: reduce` — disable all animations, use instant state changes

## Component Patterns

### Buttons
| Variant | Usage | Style |
|---------|-------|-------|
| Primary | Main CTA (Create Tenant, Save Config) | Blue fill, white text |
| Accent | Inheritance-related actions (View Inherited) | Teal fill, white text |
| Secondary | Cancel, secondary actions | White fill, gray border |
| Ghost | Tertiary actions (Reset, Clear) | Transparent, gray text |

### Badges (Hierarchy-Aware)
| Variant | Usage | Visual |
|---------|-------|--------|
| Inherited | Values from ancestor | Teal bg + text, ↑ arrow |
| Locked | Values locked by ancestor | Yellow bg + text, ↓ arrow |
| Own | Values set on this tenant | Gray bg + text, • dot |
| Success/Error/Info | Status states | Semantic color bg + text |

### Tables (Data-Dense)
- Alternating row hover (not alternating row bg — too busy)
- Monospace font for keys, values, IDs
- Right-align numeric columns
- Uppercase, small, spaced-out column headers
- Sort indicators where applicable

### Empty States
Every empty state must include:
1. A brief, warm explanation of why it's empty
2. A primary action to fix it (e.g., "Create your first tenant")
3. A link to relevant documentation
4. Never just "No items found."

### Toast Notifications
- Position: top-right
- Auto-dismiss: 4 seconds for success/info, persist for errors
- Max 3 stacked, newest on top
- Left border accent matching semantic color

## Accessibility Requirements
- `:focus-visible` ring on all interactive elements (2px, primary blue, 3px offset)
- Skip-to-content link as first focusable element
- `aria-live="polite"` on toast notification container
- All badges use icon + text (never color alone)
- Touch targets minimum 44x44px
- `prefers-reduced-motion` media query disables all animations
- Tab navigation: arrow keys move between tabs, Enter selects
- Color contrast: minimum 4.5:1 for normal text, 3:1 for large text (WCAG AA)

## Theming (CSS Custom Properties)
All design tokens are exposed as CSS custom properties (`--color-*`, `--space-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--duration-*`). Integrators can override any token to match their brand:

```css
:root {
  --color-primary: #7C3AED;      /* Override blue with purple */
  --color-accent: #0D9488;        /* Keep teal for inheritance */
  --font-display: 'Your Font', sans-serif;
}
```

The headless component variants (`Headless*`) carry no styles — integrators provide their own.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-18 | Initial design system created | Created by /design-consultation based on competitive research (Stripe, Linear, Clerk) and product positioning as "hierarchy made visible" |
| 2026-03-18 | Teal as inheritance accent color | Gives Stratum a unique visual signature — "teal means inherited" — differentiating from the sea of blue-only dev tools |
| 2026-03-18 | Satoshi over Inter/system fonts | Geometric confidence that reads as deliberate. One extra font load (~20KB) for instant visual differentiation |
| 2026-03-18 | Layered shadow depth | Shadows reinforce the hierarchy metaphor — parent surfaces cast more shadow than children |
| 2026-03-18 | Dark mode via CSS custom properties | Required for a 2026 component library. Auto-detect via prefers-color-scheme + manual data-theme toggle |
| 2026-03-18 | Three responsive breakpoints | Component library ships to other people's products — their users WILL be on tablets |
