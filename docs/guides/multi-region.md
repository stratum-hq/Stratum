# Multi-Region

Assign tenants to geographic regions with dedicated database connections and support for cross-region migration.

## Overview

Regions represent geographic or logical deployment zones. Each region can have its own:

- **Database URL** — for data residency requirements
- **Control plane URL** — for cross-region API routing
- **Status** — active, draining, or inactive

Tenants can be migrated between regions to satisfy compliance requirements or optimize latency.

## Region Lifecycle

```
active → draining → inactive
```

| Status | Description |
|--------|-------------|
| `active` | Accepting new tenants, serving traffic |
| `draining` | No new tenants, existing tenants being migrated out |
| `inactive` | Empty, can be safely deleted |

## API Usage

### Create a Region

```bash
curl -X POST http://localhost:3001/api/v1/regions \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "EU West",
    "slug": "eu_west",
    "control_plane_url": "https://eu.stratum.example.com",
    "is_primary": false,
    "metadata": { "provider": "aws", "availability_zone": "eu-west-1" }
  }'
```

### List Regions

```bash
curl http://localhost:3001/api/v1/regions \
  -H "X-API-Key: YOUR_KEY"
```

### Update a Region

```bash
curl -X PATCH http://localhost:3001/api/v1/regions/REGION_UUID \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "draining"}'
```

### Delete a Region

```bash
curl -X DELETE http://localhost:3001/api/v1/regions/REGION_UUID \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

Deletion fails if any active tenants are assigned to the region. Migrate or purge all tenants first.

### Migrate a Tenant

```bash
curl -X POST http://localhost:3001/api/v1/tenants/TENANT_UUID/migrate-region \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"region_id": "NEW_REGION_UUID"}'
```

Migration validates that:
- The tenant exists and is not archived
- The target region exists
- The target region status is `active`

## Library Usage

```typescript
import { Stratum } from "@stratum/lib";

// Create a region
const region = await stratum.createRegion({
  display_name: "EU West",
  slug: "eu_west",
  control_plane_url: "https://eu.stratum.example.com",
});

// List all regions
const regions = await stratum.listRegions();

// Update status to draining
await stratum.updateRegion(region.id, { status: "draining" });

// Migrate a tenant to a new region
await stratum.migrateRegion("tenant-uuid", "new-region-uuid");

// Delete an empty region
await stratum.deleteRegion(region.id);
```

## Region Response Shape

```json
{
  "id": "uuid",
  "display_name": "EU West",
  "slug": "eu_west",
  "control_plane_url": "https://eu.stratum.example.com",
  "is_primary": false,
  "status": "active",
  "metadata": { "provider": "aws" },
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:30:00.000Z"
}
```

Note: `database_url` is stored internally but **never** exposed in API responses for security.

## Slug Format

Region slugs follow the same rules as tenant slugs:
- Lowercase letters, digits, and underscores only
- Must start with a letter
- Maximum 63 characters
- Pattern: `^[a-z][a-z0-9_]{0,62}$`

## Authorization

- `GET /api/v1/regions` — requires `read` scope
- `POST /api/v1/regions`, `PATCH`, `DELETE` — requires `write` scope
- `POST /api/v1/tenants/:id/migrate-region` — requires `admin` scope

## Data Residency Example

For GDPR data residency compliance, create regions per jurisdiction and assign tenants accordingly:

```typescript
// Create EU and US regions
const eu = await stratum.createRegion({
  display_name: "EU (Frankfurt)",
  slug: "eu_frankfurt",
});

const us = await stratum.createRegion({
  display_name: "US East (Virginia)",
  slug: "us_east",
  is_primary: true,
});

// EU customer data stays in EU
await stratum.migrateRegion("eu-tenant-uuid", eu.id);

// US customer data stays in US
await stratum.migrateRegion("us-tenant-uuid", us.id);
```
