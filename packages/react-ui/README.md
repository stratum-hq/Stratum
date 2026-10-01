# @stratum-hq/react

React components and hooks for building multi-tenant administration UIs on top of [Stratum](https://github.com/stratum-hq/Stratum): tenant switching, hierarchy visualization, and config/permission editing.

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
    // "/api/stratum" is a server-side proxy on your own origin (see below).
    <StratumProvider controlPlaneUrl="/api/stratum">
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

The provider manages the current tenant state and sends its requests to `controlPlaneUrl`.

### Keep the API key on the server

Everything the provider runs with is visible to whoever loads the page, and bundlers inline
`NEXT_PUBLIC_*`, `REACT_APP_*` and `VITE_*` variables into the JavaScript they ship. So never
pass a control-plane API key to `StratumProvider` from browser code. Point `controlPlaneUrl` at a
route on your own server that authenticates the signed-in user, checks what they may do, and then
forwards the request to the control plane with the key added. `stratum scaffold nextjs` and
`stratum scaffold react` in `@stratum-hq/cli` generate such a proxy. The `apiKey` prop is optional
and should only be used where the code does not run in a browser.

`TenantThemeProvider`'s `branding.customCss` accepts plain CSS declarations only. Values with
braces, at-rules, backslashes, quotes or `url()` are ignored.

## Components & Hooks

- **`StratumProvider`**: context provider; also exposes `TenantThemeProvider` for per-tenant theming.
- **`useStratum()`**: `{ currentTenant, tenantContext, loading, error, switchTenant, apiCall }`.
- **Data hooks:** `useTenant`, `useTenantTree`, `useConfig`, `usePermissions`, `useConfigCascade`, `useWebhooks`, `useAuditLogs`, `useToast`.
- **`TenantSwitcher`**: dropdown to select the active tenant.
- **`TenantTree` / `DraggableTenantTree`**: hierarchical tree view (drag-to-reparent in the draggable variant).
- **`ConfigEditor`**: edit resolved config with lock and inheritance indicators.
- **`PermissionEditor`**: edit permission policies with mode/revocation selection.
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
