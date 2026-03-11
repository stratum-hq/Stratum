---
sidebar_position: 1
title: Getting Started
---

# Getting Started

This guide walks you through setting up Stratum and creating your first tenant hierarchy.

## Prerequisites

- **Node.js** >= 18
- **PostgreSQL** 16+ (via Docker or local install)
- **npm** >= 10

## Step 1: Start PostgreSQL

Using Docker (recommended):

```bash
docker-compose up db -d
```

Or install locally:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb stratum
```

## Step 2: Install Dependencies

```bash
git clone <repo-url> && cd stratum
npm install
```

## Step 3: Build

```bash
npm run build
```

## Step 4: Start the Control Plane

```bash
node packages/control-plane/dist/index.js
```

This automatically runs database migrations on first start. The API will be available at `http://localhost:3001`.

## Step 5: Create Your First API Key

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_test_bootstrap" \
  -d '{"name": "my-app"}'
```

:::warning
Save the `plaintext_key` from the response — it's only shown once!
:::

## Step 6: Create a Root Tenant

```bash
curl -X POST http://localhost:3001/api/v1/tenants \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY_HERE" \
  -d '{
    "name": "AcmeSec",
    "slug": "acmesec",
    "isolation_strategy": "SHARED_RLS"
  }'
```

## Step 7: Create a Child Tenant

```bash
curl -X POST http://localhost:3001/api/v1/tenants \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY_HERE" \
  -d '{
    "name": "NorthStar MSP",
    "slug": "northstar_msp",
    "parent_id": "PARENT_TENANT_ID"
  }'
```

## Step 8: Set Config with Inheritance

```bash
# Set on root (locked — children can't override)
curl -X PUT http://localhost:3001/api/v1/tenants/ROOT_ID/config/features.siem \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY_HERE" \
  -d '{"value": true, "locked": true}'

# Check child's resolved config — inherits from root
curl http://localhost:3001/api/v1/tenants/CHILD_ID/config \
  -H "X-API-Key: YOUR_KEY_HERE"
```

## Step 9: Create a Permission

```bash
curl -X POST http://localhost:3001/api/v1/tenants/ROOT_ID/permissions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY_HERE" \
  -d '{
    "key": "manage_users",
    "value": true,
    "mode": "LOCKED",
    "revocation_mode": "CASCADE"
  }'
```

## Step 10: Verify with Swagger

Open http://localhost:3001/api/docs to explore all endpoints interactively.

## Next Steps

Choose your integration path:

- **[Direct Library](/docs/guides/direct-library)** — embed `@stratum/lib` in your Node.js app (no HTTP)
- **[Control Plane + SDK](/docs/guides/control-plane-sdk)** — HTTP API with Express/Fastify middleware
- **[React Integration](/docs/guides/react-integration)** — admin UI components
- **[Database & RLS](/docs/guides/database-rls)** — add tenant isolation to your tables
