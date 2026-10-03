---
"@stratum-hq/react": minor
---

Guard `ConfigEditor` and `WebhookEditor` against destructive and invalid input, and give each toast one live-region role.

- `ConfigEditor` Remove and `WebhookEditor` Delete ask for confirmation first. The first click shows the question with **Yes, remove** (or **Yes, delete**) and **Keep**. Escape or **Keep** cancels.
- `ConfigEditor` no longer saves text that is not valid JSON as a string without asking. It shows an inline error and a **Save as string** button. This applies to the inline edit and to the add row.
- Escape cancels an inline edit in `ConfigEditor`.
- The Source column shows the name of the tenant that set the value instead of a tenant ID prefix. A locked row says "Locked by" and that tenant's name. The names come from `GET /api/v1/tenants/:id/ancestors`; if that request fails, the column shows the first 8 characters of the tenant ID. `useConfig()` entries have a new optional `source_tenant_name` field.
- Below 640px wide, `ConfigEditor` rows show as cards, with the status tag next to the key.
- `Toast` has the `alert` role for an error and the `status` role for the other types, without a conflicting `aria-live`. `ToastContainer` is a `region` named "Notifications" and is no longer a second live region.
- `toast.error(message, detail)` and `Toast` take an optional `detail`, shown behind a **Details** control. The editors now show a plain-language error message and put the raw API error there.
- New message keys: `configEditor.lockedBy`, `configEditor.removePrompt`, `configEditor.confirmRemoveButton`, `configEditor.keepButton`, `configEditor.invalidJson`, `configEditor.saveAsStringButton`, `configEditor.saveFailed`, `configEditor.addFailed`, `configEditor.removeFailed`, and `webhookEditor.*`.
