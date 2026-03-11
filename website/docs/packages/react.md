---
sidebar_position: 6
title: "@stratum/react"
---

# @stratum/react

React components for building multi-tenant administration interfaces.

## Installation

```bash
npm install @stratum/react @stratum/core react react-dom
```

## Provider

Wrap your app in `StratumProvider` to enable all components and hooks:

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

## Hook

```tsx
import { useStratum } from "@stratum/react";

function MyComponent() {
  const {
    currentTenant,   // TenantNode | null
    tenantContext,    // TenantContext | null
    loading,         // boolean
    error,           // Error | null
    switchTenant,    // (id: string) => Promise<void>
    apiCall,         // <T>(path, options?) => Promise<T>
  } = useStratum();
}
```

## Components

### TenantSwitcher

Dropdown to select the active tenant.

```tsx
import { TenantSwitcher } from "@stratum/react";

<TenantSwitcher />
```

Automatically fetches the tenant list from the control plane and calls `switchTenant()` on selection.

### TenantTree

Hierarchical tree view of the tenant structure.

```tsx
import { TenantTree } from "@stratum/react";

<TenantTree />
```

Displays the full tenant hierarchy with expandable nodes. Clicking a tenant switches to it.

### ConfigEditor

Editor for tenant configuration key-value pairs.

```tsx
import { ConfigEditor } from "@stratum/react";

<ConfigEditor />
```

Displays the resolved config for the current tenant with:
- Key-value editing
- Lock status indicators
- Inheritance source information
- Add/update/delete operations

### PermissionEditor

Editor for tenant permission policies.

```tsx
import { PermissionEditor } from "@stratum/react";

<PermissionEditor />
```

Displays resolved permissions with:
- Mode selection (LOCKED/INHERITED/DELEGATED)
- Revocation mode selection (CASCADE/SOFT/PERMANENT)
- Source tenant tracking
- Add/update/delete operations

## apiCall Helper

The `apiCall` function from the context is a convenience wrapper that adds authentication headers:

```tsx
const { apiCall } = useStratum();

// Fetch custom data from control plane
const data = await apiCall<MyType>("/api/v1/tenants");

// POST example
const tenant = await apiCall<TenantNode>("/api/v1/tenants", {
  method: "POST",
  body: JSON.stringify({ name: "New", slug: "new_tenant" }),
});
```

## Full Example

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
      <TenantSwitcher />
      <TenantTree />
      <ConfigEditor />
      <PermissionEditor />
      <Dashboard />
    </StratumProvider>
  );
}

function Dashboard() {
  const { currentTenant, tenantContext, loading } = useStratum();

  if (loading) return <div>Loading...</div>;
  if (!currentTenant) return <div>Select a tenant</div>;

  return (
    <div>
      <h1>{currentTenant.name}</h1>
      <pre>{JSON.stringify(tenantContext?.resolved_config, null, 2)}</pre>
    </div>
  );
}
```
