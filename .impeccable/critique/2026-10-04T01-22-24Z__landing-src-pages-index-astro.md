---
target: landing site
total_score: 22
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 1
target_identity: "file:landing/src/pages/index.astro"
target_fingerprint: "sha256:45c9ab93e52f32a408e207f3f4890fd2a76f0599f35da22984b1fa85cdad5292"
target_path: landing/src/pages/index.astro
timestamp: 2026-10-04T01-22-24Z
slug: landing-src-pages-index-astro
---
Method: dual-agent (A: Sonnet design-review sub-agent · B: Sonnet detector sub-agent). Browser overlay skipped: the shared browser was not available. Evidence: headless screenshots at 1440 and 390, Bedrock and Daylight, reduced motion, of home, compare, what-is-stratum, about, blog and one post (#524 finish pass, 2026-10-03).

Bedrock re-critique, landing. Persuade surface. Heuristics 7, 9, 10 are n/a, as in the baseline.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | No visible active-page state in the nav. |
| 2 | Match system / real world | 3 | Engineer-literal copy; the d0..d4 labels are not explained on first sight. |
| 3 | User control and freedom | 3 | Three hero actions have no clear fork. |
| 4 | Consistency and standards | 3 | Bedrock carries across pages; the compare tables flatten it. |
| 5 | Error prevention | 4 | No inputs on these pages, so nothing to get wrong. |
| 6 | Recognition rather than recall | 3 | The 14-row package list has no grouping. |
| 7 | Flexibility and efficiency | n/a | Persuade surface. |
| 8 | Aesthetic and minimalist design | 3 | Home is disciplined; compare is a long wall. |
| 9 | Error recovery | n/a | Nothing to recover from. |
| 10 | Help and documentation | n/a | Persuade surface. |
| **Total** | | **22/28** | 79%, Good (baseline 17/28) |

Design specificity: authored for this product. The rock bands, depth coding and the magma budget come from the concept, and the hero panel shows the real inheritance model. Compare and what-is-stratum fall back to long text-and-table layouts.

Detector: 0 findings in landing/src (exit 0). One ignore applies (codex-grid-background on index.astro): a real false positive for the near-horizontal strata bands.

Priority issues:
- [P1] /compare is an undifferentiated wall: about 8,600px, six similar sections, the short version last. Fix: lead with the summary matrix, add a jump list. /impeccable distill
- [P2] The package list has 14 rows of equal weight. Fix: group into core, adapters, frameworks and UI, tooling. /impeccable layout
- [P2] Hero action fork is blurred (Get Started, Try it in your browser, GitHub, install box). /impeccable clarify
- [P2] The depth rail is homepage-only and the d-labels are unexplained. /impeccable polish
- [P3] Secondary pages do not reuse the tree. /impeccable bolder

Persona red flags: Jordan meets d0..d4, ltree and RLS before the problem. Riley finds self-authored compare tables with no sources. Casey scrolls 8,360px on the home page at 390, with three stacked actions above the tree.

Minor: the msp line of the home code sample clips at 1440; the about page's GitHub link is a text link next to a button.

Fixed in this pass, before the run: 3px side stripes on the config rows, 10px depth-rail and package-tag labels, the window-dot chrome on code wells, tertiary ink on compare "No" cells.

Questions: What if the hero were the Playground itself? Does an engineer audience need the feature section, or are the code and the tree enough? Why do the busiest pages, the compare tables, look like every other docs site?
