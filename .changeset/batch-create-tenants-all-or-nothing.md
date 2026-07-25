---
"@stratum-hq/lib": patch
---

Fix batchCreateTenants to honor its all-or-nothing transaction contract. The
batch runs in a single transaction, so a mid-batch failure (such as a duplicate
slug) rolls every insert back. The returned `created` array was populated in
memory before the failure and still listed the rolled-back tenants, which caused
the facade to emit TENANT_CREATED events and write audit entries for tenants that
were never persisted. `created` is now cleared on failure, so it reflects only
what actually committed and no phantom events or audit entries are emitted.
