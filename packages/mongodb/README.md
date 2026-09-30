# @stratum-hq/mongodb

MongoDB tenant isolation adapters for Stratum.

Three isolation strategies:
- **Shared collection** — tenant_id field injection via Collection Proxy
- **Collection-per-tenant** — `{collection}_{slug}` naming convention. Pass `baseCollections` (every base collection name) to `MongoCollectionAdapter`; `purgeTenantData` requires it and purges exactly `{base}_{slug}` for each entry
- **Database-per-tenant** — dedicated database with MongoPoolManager LRU cache

## Installation

```bash
npm install @stratum-hq/mongodb mongodb
```
