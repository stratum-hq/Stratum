---
sidebar_position: 15
title: Multi-Region Support
---

# Multi-Region Support

Stratum can be deployed across multiple geographic regions with a global tenant tree and regional data planes. This enables data residency compliance, reduced latency for distributed teams, and regional isolation for regulatory requirements.

## Architecture Overview

Multi-region deployments separate two concerns:

- **Global tenant tree** — the hierarchy of tenants, their relationships, and metadata are managed centrally in the global pool
- **Regional data planes** — tenant data (config, permissions, webhooks, etc.) lives in region-specific database pools

The `RegionalPoolRouter` routes queries to the correct regional pool based on tenant assignment, falling back to the global pool for unassigned tenants.

---

## Region Entity

Each region is defined by:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `uuid` | Unique region identifier |
| `display_name` | `string` | Human-readable name (e.g. "US East") |
| `slug` | `string` | URL-safe identifier (e.g. `us_east`) |
| `control_plane_url` | `string` | The control plane endpoint for this region |
| `is_primary` | `boolean` | Whether this is the primary (global) region |
| `status` | `string` | One of `active`, `draining`, or `inactive` |

---

## Managing Regions

### Via REST API

```bash
# Create a region
curl -X POST http://localhost:3001/api/v1/regions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{
    "display_name": "EU West",
    "slug": "eu_west",
    "control_plane_url": "https://eu-west.stratum.example.com",
    "is_primary": false
  }'

# List all regions
curl http://localhost:3001/api/v1/regions \
  -H "X-API-Key: sk_live_..."

# Update a region
curl -X PATCH http://localhost:3001/api/v1/regions/REGION_UUID \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{ "status": "draining" }'

# Delete a region
curl -X DELETE http://localhost:3001/api/v1/regions/REGION_UUID \
  -H "X-API-Key: sk_live_..."
```

### Via SDK

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_...",
});

// Create a region
const region = await s.createRegion({
  display_name: "EU West",
  slug: "eu_west",
  control_plane_url: "https://eu-west.stratum.example.com",
  is_primary: false,
});

// List regions
const regions = await s.listRegions();

// Update a region
await s.updateRegion(region.id, { status: "active" });

// Delete a region
await s.deleteRegion(region.id);
```

---

## Tenant Region Assignment

Tenants are assigned to a region via the `region_id` field. This field is nullable for backward compatibility — tenants without a region use the global pool.

### Assigning at Creation

```typescript
const tenant = await s.createTenant({
  name: "EU Customer GmbH",
  slug: "eu_customer",
  parent_id: "PARENT_UUID",
  region_id: "EU_WEST_REGION_UUID",
});
```

### Region Inheritance

Child tenants inherit their parent's `region_id` unless explicitly overridden. This means assigning an MSP to a region automatically places all its clients in the same region:

```typescript
// Parent assigned to EU West
const msp = await s.createTenant({
  name: "EU MSP",
  slug: "eu_msp",
  region_id: "EU_WEST_REGION_UUID",
});

// Child inherits EU West automatically
const client = await s.createTenant({
  name: "EU Client",
  slug: "eu_client",
  parent_id: msp.id,
  // region_id is inherited from parent
});
```

---

## Cross-Region Migration

Move a tenant and its data to a different region:

### Via REST API

```bash
curl -X POST http://localhost:3001/api/v1/tenants/TENANT_UUID/migrate-region \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{ "region_id": "US_EAST_REGION_UUID" }'
```

### Via SDK

```typescript
await s.migrateRegion("TENANT_UUID", "US_EAST_REGION_UUID");
```

Migration updates the tenant's `region_id` and triggers data replication to the new regional pool. During migration, the tenant remains accessible through the global pool.

---

## Regional Pool Router

The `RegionalPoolRouter` manages database connections across regions:

```
Database Pool Keys: regionId:slug format
Example: "eu_west_uuid:eu_west"
```

Query routing works as follows:

1. **Tenant data operations** — routed to the tenant's assigned regional pool
2. **Global operations** (tenant tree queries, region management) — always use the global pool
3. **Unassigned tenants** — fall back to the global pool

### SDK Configuration

Point the SDK at a specific region for optimized routing:

```typescript
const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  regionUrl: "https://eu-west.stratum.example.com",
  apiKey: "sk_live_...",
});
```

When `regionUrl` is set, data operations are sent directly to the regional endpoint, reducing cross-region latency.

---

## Region Status Lifecycle

| Status | Behavior |
|--------|----------|
| `active` | Fully operational, accepts new tenants |
| `draining` | No new tenants, existing tenants continue to operate |
| `inactive` | Region is offline, queries fall back to global pool |

Set a region to `draining` before decommissioning to allow graceful migration:

```typescript
// 1. Stop new tenant assignments
await s.updateRegion("EU_WEST_UUID", { status: "draining" });

// 2. Migrate existing tenants to another region
const tenants = await s.listTenants({ region_id: "EU_WEST_UUID" });
for (const tenant of tenants.data) {
  await s.migrateRegion(tenant.id, "EU_CENTRAL_UUID");
}

// 3. Deactivate the region
await s.updateRegion("EU_WEST_UUID", { status: "inactive" });
```

---

## Notes

- Region management requires the `admin` scope. See [Authorization & Scopes](./authorization.md).
- All region operations are recorded in the [audit log](./audit-logging.md).
- The global tenant tree is always consistent — regional pools handle data operations only.
