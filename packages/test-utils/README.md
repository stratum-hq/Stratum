# @stratum-hq/test-utils

Cross-tenant isolation test helpers for [Stratum](https://github.com/stratum-hq/Stratum). Drop these into your CI pipeline to catch isolation regressions before they reach production.

## Installation

```bash
npm install -D @stratum-hq/test-utils
```

Peer dependencies (install whichever your app uses): `pg` for PostgreSQL, `mongodb` for MongoDB.

## Quick Start

```typescript
import { assertIsolation } from "@stratum-hq/test-utils";

describe("tenant isolation", () => {
  it("tenantA cannot read tenantB's data", async () => {
    await assertIsolation({
      pool,
      tenantA: "acme",
      tenantB: "globex",
      table: "users",
      setup: async (pool, tenantId) => {
        await pool.query(
          "INSERT INTO users (tenant_id, name) VALUES ($1, $2)",
          [tenantId, `User for ${tenantId}`],
        );
      },
    });
  });
});
```

If tenantA can see any of tenantB's rows, the assertion fails with a descriptive message naming the breached boundary.

## API

- **`assertIsolation(options)`** — verifies that tenantA cannot read tenantB's data through parameterized SQL against a PostgreSQL pool.
- **`assertMongoIsolation(options)`** — the same guarantee for MongoDB collections.
- **`assertConfigInheritance(options)`** — verifies config values flow correctly through the tenant hierarchy.

All helpers produce clear failure output showing exactly which isolation boundary was crossed.

## Links

- Documentation: https://docs.stratum-hq.org/packages/test-utils/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
