---
sidebar_position: 4
title: React Integration
---

# React Integration

Build multi-tenant admin interfaces with `@stratum/react`.

## Installation

```bash
npm install @stratum/react @stratum/core react react-dom
```

## Provider Setup

Wrap your app in `StratumProvider`:

```tsx
import { StratumProvider } from "@stratum/react";

function App() {
  return (
    <StratumProvider
      controlPlaneUrl="http://localhost:3001"
      apiKey="sk_live_your_key"
      initialTenantId="optional-default-tenant"
    >
      <YourApp />
    </StratumProvider>
  );
}
```

The provider handles API communication, tenant context resolution, and state management.

## useStratum Hook

```tsx
import { useStratum } from "@stratum/react";

function Dashboard() {
  const {
    currentTenant,   // TenantNode | null — currently selected tenant
    tenantContext,    // TenantContext | null — resolved config + permissions
    loading,         // boolean — initial load in progress
    error,           // Error | null — last error
    switchTenant,    // (id: string) => Promise<void>
    apiCall,         // <T>(path, options?) => Promise<T>
  } = useStratum();

  if (loading) return <div>Loading...</div>;
  if (!currentTenant) return <div>Select a tenant</div>;

  return (
    <div>
      <h1>{currentTenant.name}</h1>
      <p>Depth: {currentTenant.depth}</p>
      <p>Strategy: {tenantContext?.isolation_strategy}</p>
    </div>
  );
}
```

## Pre-built Components

### TenantSwitcher

Dropdown to select the active tenant:

```tsx
import { TenantSwitcher } from "@stratum/react";

function Header() {
  return (
    <nav>
      <h1>Admin Panel</h1>
      <TenantSwitcher />
    </nav>
  );
}
```

Fetches the tenant list automatically and calls `switchTenant()` on selection.

### TenantTree

Hierarchical tree view with expand/collapse:

```tsx
import { TenantTree } from "@stratum/react";

function Sidebar() {
  return <TenantTree />;
}
```

Shows the full tenant hierarchy. Clicking a tenant switches to it.

### ConfigEditor

Visual editor for config key-value pairs:

```tsx
import { ConfigEditor } from "@stratum/react";

function ConfigPage() {
  return <ConfigEditor />;
}
```

Features:
- Inline key-value editing
- Lock status indicators (locked keys are read-only)
- Inheritance source labels ("inherited from AcmeSec")
- Add, update, delete operations

### PermissionEditor

Visual editor for permission policies:

```tsx
import { PermissionEditor } from "@stratum/react";

function PermissionsPage() {
  return <PermissionEditor />;
}
```

Features:
- Mode dropdown (LOCKED / INHERITED / DELEGATED)
- Revocation mode dropdown (CASCADE / SOFT / PERMANENT)
- Source tenant tracking
- Add, update, delete operations

## Full Admin Panel Example

```tsx
import {
  StratumProvider,
  useStratum,
  TenantSwitcher,
  TenantTree,
  ConfigEditor,
  PermissionEditor,
} from "@stratum/react";

function App() {
  return (
    <StratumProvider
      controlPlaneUrl="http://localhost:3001"
      apiKey="sk_live_your_key"
    >
      <div style={{ display: "flex" }}>
        <Sidebar />
        <MainContent />
      </div>
    </StratumProvider>
  );
}

function Sidebar() {
  return (
    <aside style={{ width: 250 }}>
      <TenantSwitcher />
      <TenantTree />
    </aside>
  );
}

function MainContent() {
  const { currentTenant, tenantContext } = useStratum();

  if (!currentTenant) return <p>Select a tenant from the sidebar</p>;

  return (
    <main>
      <h1>{currentTenant.name}</h1>
      <p>ID: {currentTenant.id}</p>
      <p>Slug: {currentTenant.slug}</p>
      <p>Depth: {currentTenant.depth}</p>

      <h2>Configuration</h2>
      <ConfigEditor />

      <h2>Permissions</h2>
      <PermissionEditor />
    </main>
  );
}
```

## Custom API Calls

The `apiCall` helper adds authentication headers automatically:

```tsx
const { apiCall } = useStratum();

// GET
const tenants = await apiCall<TenantNode[]>("/api/v1/tenants");

// POST
const newTenant = await apiCall<TenantNode>("/api/v1/tenants", {
  method: "POST",
  body: JSON.stringify({
    name: "New Tenant",
    slug: "new_tenant",
  }),
});
```

## Connecting to Database Layer

For full-stack apps, combine the React UI with database-level RLS:

```
Browser (React + @stratum/react)
  └── Control Plane API
        └── @stratum/lib → PostgreSQL (RLS)

Your Backend (Express/Fastify)
  └── @stratum/sdk middleware → resolves tenant
  └── @stratum/db-adapters → tenant-scoped queries
```

The React UI manages tenants and config through the control plane. Your backend uses the SDK middleware for tenant resolution and db-adapters for isolated database queries.
