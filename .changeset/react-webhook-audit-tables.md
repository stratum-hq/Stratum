---
"@stratum-hq/react": patch
---

`WebhookEditor` and `AuditLogViewer` tables get the same header, cell and code styles as the other editor tables, in the base theme and in Bedrock. The `WebhookEditor` add row is a wrapping flex row, and the inputs of every editor's add row share its width instead of keeping the browser's default size.
