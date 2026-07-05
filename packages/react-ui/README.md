# @stratum-hq/react

React components and hooks for building multi-tenant administration UIs on top of [Stratum](https://github.com/stratum-hq/Stratum) — tenant switching, hierarchy visualization, and config/permission editing.

## Installation

```bash
npm install @stratum-hq/react @stratum-hq/core react react-dom
```

## Quick Start

Wrap your app in `StratumProvider`, then drop in the components and hooks:

```tsx
import {
  StratumProvider,
  useStratum,
  TenantSwitcher,
  TenantTree,
  ConfigEditor,
  PermissionEditor,
} from "@stratum-hq/react";

function App() {
  return (
    <StratumProvider controlPlaneUrl="http://localhost:3001" apiKey="sk_live_your_key">
      <Layout />
    </StratumProvider>
  );
}

function Layout() {
  const { currentTenant, tenantContext, loading } = useStratum();
  if (loading) return <p>Loading...</p>;
  if (!currentTenant) return <p>Select a tenant.</p>;

  return (
    <div style={{ display: "flex" }}>
      <aside style={{ width: 240 }}>
        <TenantSwitcher />
        <TenantTree />
      </aside>
      <main style={{ flex: 1 }}>
        <h1>{currentTenant.name}</h1>
        <ConfigEditor />
        <PermissionEditor />
      </main>
    </div>
  );
}
```

The provider creates a `StratumClient` internally and manages the current tenant state.

## Components & Hooks

- **`StratumProvider`** — context provider; also exposes `TenantThemeProvider` for per-tenant theming.
- **`useStratum()`** — `{ currentTenant, tenantContext, loading, error, switchTenant, apiCall }`.
- **Data hooks** — `useTenant`, `useTenantTree`, `useConfig`, `usePermissions`, `useConfigCascade`, `useWebhooks`, `useAuditLogs`, `useToast`.
- **`TenantSwitcher`** — dropdown to select the active tenant.
- **`TenantTree` / `DraggableTenantTree`** — hierarchical tree view (drag-to-reparent in the draggable variant).
- **`ConfigEditor`** — edit resolved config with lock and inheritance indicators.
- **`PermissionEditor`** — edit permission policies with mode/revocation selection.
- **`ConfigInheritanceVisualizer`**, **`WebhookEditor`**, **`AuditLogViewer`**, **`TenantHealthCard`**, plus headless (`HeadlessTenantSwitcher`, …) variants for full styling control.

## Scaffolding

Generate integration boilerplate (provider, guards, hooks) with the CLI:

```bash
npx @stratum-hq/cli scaffold react --out src/components
```

## Links

- Documentation: https://docs.stratum-hq.org/packages/react/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
