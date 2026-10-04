---
target: @stratum-hq/react
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/christiancrank/Development/Stratum/Stratum/.claude/worktrees/agent-a3494749c9fb87716/packages/react-ui/src/index.ts"
target_fingerprint: "sha256:b8aac0ecd156bcfe1953283a768f2cf16923e1108613ec68a9a8edbf55d443a2"
target_path: /Users/christiancrank/Development/Stratum/Stratum/.claude/worktrees/agent-a3494749c9fb87716/packages/react-ui/src/index.ts
timestamp: 2026-10-04T01-22-32Z
slug: packages-react-ui-src-index-ts
---
Method: dual-agent (A: Sonnet design-review sub-agent · B: Sonnet detector sub-agent). Browser overlay skipped: the shared browser was not available. Evidence: Storybook screenshots of TenantTree, ConfigEditor and PermissionEditor at 1440 and 390, Bedrock (dark and Daylight) and the neutral base theme (#524 finish pass, 2026-10-03).

Bedrock re-critique, @stratum-hq/react. All ten heuristics scored.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | A collapsed root gives no child count or loading hint. |
| 2 | Match system / real world | 3 | State words read well; raw tenant IDs in Source do not (#538). |
| 3 | User control and freedom | 2 | No lock control (#536), no undo. |
| 4 | Consistency and standards | 2 | PermissionEditor has no stacked phone layout; ConfigEditor does. |
| 5 | Error prevention | 2 | Invalid JSON is flagged; cascade select is unexplained. |
| 6 | Recognition rather than recall | 2 | Mode and Status repeat each other. |
| 7 | Flexibility and efficiency | 2 | Keyboard tree; no filter, sort or bulk action. |
| 8 | Aesthetic and minimalist design | 3 | Rich and restrained; the disabled Add face looks broken. |
| 9 | Error recovery | 2 | No retry path in the shots. |
| 10 | Help and documentation | 1 | No inline explanation of inheritance. |
| **Total** | | **21/40** | Acceptable (baseline 18/40) |

Design specificity: the Bedrock theme is authored for this product (rock lip, depth bands, LOCKED as the hot state). The base theme is deliberately neutral. The P0 from the baseline (the stylesheet took over the host page) is fixed: cascade layers, --stratum- tokens, scoped selectors.

Detector: 0 findings in packages/react-ui/src (exit 0). The side-tab ignore on theme-bedrock.css hid three 4px start-edge stripes; they are removed in this pass and a test keeps them out.

Priority issues:
- [P1] PermissionEditor on a phone: the table scrolls sideways with no cue, so Source, Status and Remove start off-screen. Fix: the data-label stacked rows that ConfigEditor uses. /impeccable adapt
- [P1] LOCKED is spent several times per row and cannot be acted on (#536). The magma start stripe is removed in this pass; the lock control stays with #536. /impeccable quieter
- [P2] Mode and Status duplicate each other (#538). /impeccable distill
- [P2] The tree gives no sense of depth when collapsed. /impeccable clarify
- [P3] The disabled Add face (hatched) reads as an error. /impeccable polish

Persona red flags: Alex has no filter or bulk lock. Sam meets clipped columns at 390 and redundant table roles.

Fixed in this pass, before the run: the selected tree row is vein, not magma; WebhookEditor and AuditLogViewer tables are styled; add-row inputs share the row; Skeleton reads its radius only from the token.

Questions: What if magma were on the LOCKED glyph only, with the row left plain? Would a tree that showed depth as stack position make the table's Source column redundant?
