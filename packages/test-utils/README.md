# @stratum-hq/test-utils

Cross-tenant isolation test helpers for [Stratum](https://github.com/stratum-hq/Stratum). Drop these into your CI pipeline to catch isolation regressions before they reach production.

Read the documentation at [docs.stratum-hq.org/packages/test-utils](https://docs.stratum-hq.org/packages/test-utils/).

## Installation

```bash
npm install -D @stratum-hq/test-utils
```

Peer dependencies (install whichever your app uses): `pg` for PostgreSQL, `mongodb` for MongoDB.

## Quick Start

```typescript
import { assertIsolation, assertConfigInheritance } from "@stratum-hq/test-utils";

describe("tenant isolation", () => {
  it("tenantA cannot read tenantB's data", async () => {
    // Connect `pool` as your application's role. A superuser or BYPASSRLS role
    // ignores row-level security, and the assertion then fails, as it should.
    await assertIsolation(pool, tenantAId, tenantBId, "orders");
  });

  it("config inherits and locks down the tree", async () => {
    // `stratum` is a Stratum instance from @stratum-hq/lib.
    await assertConfigInheritance(stratum, parentId, childId, "test.inheritance_key");
  });
});
```

If tenantA can see any of tenantB's rows, the assertion fails with a descriptive message naming the breached boundary.

## API

- **`assertIsolation(pool, tenantA, tenantB, table, options?)`**: verifies through PostgreSQL row-level security that tenantA cannot read tenantB's data. It inserts a row as tenantB with `tenant_id` set to tenantB and a random UUID in `id`, checks that tenantB can read it back (so a policy that hides every row does not pass), checks that tenantA cannot, and rolls back. Tenant IDs must be UUIDs when your policies cast `app.current_tenant_id` to `uuid`, as Stratum's do. `options.testColumn` (default `"id"`) and `options.tenantColumn` (default `"tenant_id"`) name the columns; other columns must be nullable or have defaults.
- **`assertMongoIsolation(getCollection, tenantA, tenantB)`**: the same guarantee for MongoDB. `getCollection(tenantId)` must return the collection through your Stratum adapter or Mongoose plugin, so the check exercises the real data path.
- **`assertConfigInheritance(stratum, parentId, childId, key)`**: verifies through Stratum's config API that a parent value resolves on the child, that a child override wins, and that a key locked by the parent cannot be overridden (the override must be rejected with `ConfigLockedError`). It writes `key` on both tenants and deletes it afterwards, so pass a key that is not otherwise in use.

All helpers produce clear failure output showing exactly which isolation boundary was crossed.

## Links

- Documentation: https://docs.stratum-hq.org/packages/test-utils/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
