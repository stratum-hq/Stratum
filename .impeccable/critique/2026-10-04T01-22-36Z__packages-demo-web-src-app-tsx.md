---
target: demo dashboard
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:packages/demo/web/src/App.tsx"
target_fingerprint: "sha256:5c2d422942740550a071054f4b0f8e27defe681410e736c4f693d4a8fbb52c00"
target_path: packages/demo/web/src/App.tsx
timestamp: 2026-10-04T01-22-36Z
slug: packages-demo-web-src-app-tsx
---
Method: dual-agent (A: Sonnet design-review sub-agent · B: Sonnet detector sub-agent). Browser overlay skipped: the shared browser was not available. Evidence: screenshots of every demo view against a mocked control plane, at 1440 and 390, Bedrock and Daylight, plus the phone tenant drawer (#524 finish pass, 2026-10-03).

Bedrock re-critique, demo dashboard. All ten heuristics scored.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | No loading, sync or last-updated signal. |
| 2 | Match system / real world | 3 | Tiers match the domain; "Resolved context" is jargon. |
| 3 | User control and freedom | 3 | Drawer closes on Escape, scrim and X; focus returns. |
| 4 | Consistency and standards | 2 | Saturated tier bands compete with the hot color. |
| 5 | Error prevention | 2 | Small tree action targets sit side by side. |
| 6 | Recognition rather than recall | 3 | Breadcrumb and tabs carry state. |
| 7 | Flexibility and efficiency | 2 | No tenant search. |
| 8 | Aesthetic and minimalist design | 3 | Clean Overview; the sidebar dominates. |
| 9 | Error recovery | 1 | No error or offline state in any view. |
| 10 | Help and documentation | 2 | Section descriptions teach the model; no link to docs. |
| **Total** | | **23/40** | Acceptable (baseline 20/40) |

Design specificity: the sidebar tree, the tier-colored breadcrumb and the Bedrock palette make it Stratum. The content area is a stock tab-and-table layout.

Detector: 0 findings in packages/demo/web/src (exit 0), with no ignore on this tree.

Review notes on Assessment A: it reported that Revoke has no confirmation and that tabs have no keyboard navigation. Both are false: RevokeKeyButton asks first, and the tabs take arrow, Home and End keys (Dashboard.tsx). Its P1 on the terracotta tier bands conflicts with DESIGN.md, which fixes the band colors by depth; it is not taken.

Priority issues:
- [P1] The Overview reports counts with no "what needs attention". /impeccable shape
- [P2] The empty state on a phone has no direct way to open the tenant list. /impeccable onboard
- [P2] Tree action buttons are 24px and adjacent on touch. /impeccable harden
- [P3] The tab bar at 390 hides two tabs with no scroll cue. /impeccable adapt

Persona red flags: Alex has no tenant search and expands the tree level by level. Sam meets small icon targets and two tabs off-screen at 390.

Fixed in this pass, before the run: the audit log shows the whole actor (only a UUID is shortened); the selected tree row is vein; the webhook table and add row are styled.

Questions: If only the selected tenant carried color, would the main area become the loudest thing on the page? What does a tenant owner need to know in three seconds?
