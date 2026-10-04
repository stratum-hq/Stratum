---
target: docs site
total_score: 27
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 2
target_identity: "file:website/src/content/docs/index.mdx"
target_fingerprint: "sha256:067a1a954b958c0c877e59c2f6b2c19f26fbf79e294822dbc231058ebfb725e4"
target_path: website/src/content/docs/index.mdx
timestamp: 2026-10-04T01-22-29Z
slug: website-src-content-docs-index-mdx
---
Method: dual-agent (A: Sonnet design-review sub-agent · B: Sonnet detector sub-agent). Browser overlay skipped: the shared browser was not available. Evidence: headless screenshots at 1440 and 390, Bedrock and Daylight, of home, installation, packages/react, isolation-strategies and the Playground (#524 finish pass, 2026-10-03).

Bedrock re-critique, docs. Read surface. Heuristic 9 is n/a, as in the baseline.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Clear active sidebar item and TOC; the Playground does not preview what Start does. |
| 2 | Match system / real world | 4 | Exact package names and state words. |
| 3 | User control and freedom | 3 | External header links are marked only by a small icon. |
| 4 | Consistency and standards | 3 | Inline code was a dark slab in Daylight (fixed after the run). |
| 5 | Error prevention | 3 | Prerequisites and destructive commands are flagged. |
| 6 | Recognition rather than recall | 2 | About 17 flat guides; no "which package do I need" path. |
| 7 | Flexibility and efficiency | 3 | Search, TOC, Playground. |
| 8 | Aesthetic and minimalist design | 3 | Empty terminal title bars on shell blocks (fixed after the run). |
| 9 | Error recovery | n/a | No input to fail. |
| 10 | Help and documentation | 3 | Task-oriented, but the home page does not triage by intent. |
| **Total** | | **27/36** | 75%, Good (baseline 24/36) |

Design specificity: authored for this product. The tenant-tree hero with the inherited-value tag shows the model. Below the hero the body is default Starlight structure.

Detector: 0 findings in website/src (exit 0). The side-tab ignore on custom.css covers the code-frame depth rail; the other stripe it covered (the splash config row) is removed in this pass.

Priority issues:
- [P1] Shell code blocks showed an empty terminal title bar with dots. Fixed after the run: shell blocks use the plain code frame. /impeccable polish
- [P1] The home page does not triage the reader (direct lib, HTTP plus SDK, scaffold). /impeccable layout
- [P2] The Bedrock identity stops at the hero. /impeccable bolder
- [P2] Long guides (isolation strategies, about 8,000px) have little disclosure. /impeccable distill
- [P2] Daylight inline code rendered as black chips. Fixed after the run: a surface-3 chip in ink. /impeccable colorize

Persona red flags: Alex has a flat 17-item guide list. Jordan gets no recommended first path. Casey sees install lines scroll sideways at 390.

Fixed in this pass, before the run: the docs code theme is on the Bedrock palette; the splash hero stays flush left on phones; "Multi-Tenancy" no longer breaks at its hyphen; --radius-sm fallbacks removed.

Questions: Why can the reader not click the hero tree to see resolved config? What if each guide opened with its decision? Should the code well be the brand's most recognizable object?
