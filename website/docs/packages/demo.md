---
sidebar_position: 7
title: "@stratum/demo"
---

# @stratum/demo

Demo application showcasing Stratum's multi-tenancy features with an MSSP security events scenario.

## Running

### Prerequisites

- PostgreSQL running (via Docker or local)
- Control plane running on port 3100

### Steps

```bash
# 1. Start PostgreSQL
docker-compose up db -d

# 2. Build everything
npm run build

# 3. Start the control plane (port 3100)
node packages/control-plane/dist/index.js

# 4. Seed demo data (one-time)
npx tsx packages/demo/api/src/seed.ts

# 5. Start the demo (API + web)
npm run dev --workspace=@stratum/demo
```

### URLs

| Service | URL | Description |
|---------|-----|-------------|
| Web UI | http://localhost:3300 | React dashboard |
| Demo API | http://localhost:3200 | Security events API |
| Control Plane | http://localhost:3100 | Tenant management API |
| Swagger Docs | http://localhost:3100/api/docs | Interactive API docs |

### Docker

```bash
docker-compose --profile demo up
```

## Demo Data

The seed script creates:

### Tenant Hierarchy

```
AcmeSec (root MSSP)
├── NorthStar MSP
│   ├── Client Alpha
│   └── Client Beta
└── SouthShield MSP
    └── Client Gamma
```

### Config Values

| Tenant | Key | Value | Locked |
|--------|-----|-------|--------|
| AcmeSec | `max_users` | 1000 | no |
| AcmeSec | `features.siem` | true | **yes** |
| AcmeSec | `features.edr` | false | no |
| NorthStar | `max_users` | 500 | no |
| NorthStar | `features.edr` | true | no |
| Client Alpha | `max_users` | 50 | no |

### Permissions

| Tenant | Key | Mode | Revocation |
|--------|-----|------|------------|
| AcmeSec | `manage_users` | LOCKED | CASCADE |
| NorthStar | `custom_reports` | DELEGATED | SOFT |
| AcmeSec | `api_access` | INHERITED | CASCADE |

### Security Events

12 sample events across all tenants with varying severity levels (low, medium, high, critical) and types (login_attempt, malware_detected, ransomware_attempt, brute_force, phishing, etc.).

## Web UI Tabs

### Dashboard
- Displays the current tenant's security events
- Events are filtered by RLS — switching tenants shows only that tenant's events
- Color-coded severity badges

### Tenants
- `TenantSwitcher` dropdown to change the active tenant
- `TenantTree` showing the full hierarchy
- Detail panel showing ID, slug, ancestry path, depth, status

### Config
- `ConfigEditor` for managing configuration key-value pairs
- `PermissionEditor` for managing permission policies
- Both show inheritance status and source tracking

## Architecture

```
Browser (port 3300)
  |
  |-- /api/v1/*  --> Control Plane (port 3100)
  |                    Tenant CRUD, config, permissions
  |
  |-- /api/events/* --> Demo API (port 3200)
                         Security events with RLS isolation
```

## How RLS Isolation Works in the Demo

The demo API endpoint `GET /api/events/:tenantId`:

1. Acquires a database connection
2. Sets `app.current_tenant_id` via parameterized `set_config()`
3. Queries `security_events` — **no WHERE clause needed**
4. RLS automatically filters to the correct tenant's events
5. Resets tenant context on connection release

This demonstrates that RLS isolation works transparently — the query has no `WHERE tenant_id = ...` clause, yet only the correct tenant's events are returned.
