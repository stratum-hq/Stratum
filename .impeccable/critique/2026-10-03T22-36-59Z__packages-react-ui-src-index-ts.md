---
target: @stratum-hq/react
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/Users/christiancrank/Development/Stratum/Stratum/packages/react-ui/src/index.ts"
target_fingerprint: "sha256:b8aac0ecd156bcfe1953283a768f2cf16923e1108613ec68a9a8edbf55d443a2"
target_path: /Users/christiancrank/Development/Stratum/Stratum/packages/react-ui/src/index.ts
timestamp: 2026-10-03T22-36-59Z
slug: packages-react-ui-src-index-ts
---
Bedrock critique 2026-10-03, react-ui. Priorities: [P0] stylesheet hijacks host: Google Fonts import (default.css:8), ~28 unprefixed :root tokens (:18,:156,:224), global reduced-motion !important (:350) -> scope under @layer + --stratum-* prefix, opt-in fonts, harden; [P1] Bedrock non-optional, forced dark -> base.css + opt-in theme-bedrock.css; [P1] TenantTree hard-coded RLS badge (TenantTree.tsx:66), uppercased names, no roving tabindex, unstyled action buttons, 700ms per-row settle anim -> clarify+harden; [P1] ConfigEditor no remove confirm/undo, invalid JSON silently stored as string (ConfigEditor.tsx:32-36,58-62,136), UUID in Source column, mobile hides status -> adapt+harden; [P2] 10px badges/toggle -> typeset. Toast role=alert + aria-live=polite conflict (Toast.tsx:50).
