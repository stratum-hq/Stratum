---
"@stratum-hq/lib": minor
"@stratum-hq/core": minor
---

feat: add an app-facing audit-write API

`stratum.recordAuditEvent(input)` lets a consumer append a custom event to
Stratum's `audit_logs` through the public surface, instead of writing the table
directly (Stratum owns it and previously exposed only `queryAuditLogs`). The
input is validated and mapped onto the same write path the internal services
use, so a recorded event is indistinguishable from one Stratum writes itself and
is immediately queryable via `queryAuditLogs`:

```ts
const entry = await stratum.recordAuditEvent({
  tenantId,
  actorId,
  actorType: "api_key", // 'api_key' | 'jwt' | 'system'; defaults to 'system'
  action: "invoice.sent",
  resourceType: "invoice",
  resourceId,
  before,
  after,
  metadata,
  sourceIp, // stored in the INET column
});
```

The row is stamped for `tenantId` and no other tenant, so under SHARED_RLS a
data-plane reader only ever sees its own tenant's events. `actorType` matches
the `actor_type` CHECK and `sourceIp` the `source_ip` INET column. New
`RecordAuditEventInput` type and `RecordAuditEventInputSchema` are exported from
`@stratum-hq/core` and re-exported from `@stratum-hq/lib`.
