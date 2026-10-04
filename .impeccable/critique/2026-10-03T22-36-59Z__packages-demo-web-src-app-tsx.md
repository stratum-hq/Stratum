---
target: demo dashboard
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:packages/demo/web/src/App.tsx"
target_fingerprint: "sha256:c55c458ddf1edf9d3eb1184aab8c226b2e5bde908e8829147bbe0fa75211aefd"
target_path: packages/demo/web/src/App.tsx
timestamp: 2026-10-03T22-36-59Z
slug: packages-demo-web-src-app-tsx
---
Bedrock critique 2026-10-03, demo. Priorities: [P1] irreversible revoke/delete without confirm (Dashboard.tsx:1457,977,1603) -> harden; [P1] sidebar tree mouse-only spans (Sidebar.tsx:107-200) -> use TenantTree; [P1] demo reimplements tree/config/permissions/webhooks instead of using @stratum-hq/react -> distill; [P2] emoji tabs, border-radius x10, uppercase STRATUM wordmark (App.tsx:45) -> polish; [P2] modal/drawer no Escape/focus trap, closed drawer tabbable (App.tsx:143-157), sidebar width transition (App.tsx:105).
