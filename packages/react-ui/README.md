# @stratum-hq/react

React components and hooks for building multi-tenant administration UIs on top of [Stratum](https://github.com/stratum-hq/Stratum): tenant switching, hierarchy visualization, and config/permission editing.

Read the documentation at [docs.stratum-hq.org/packages/react](https://docs.stratum-hq.org/packages/react/).

## Installation

```bash
npm install @stratum-hq/react react react-dom
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

## Styles

The components use plain class names (`stratum-*`) and read their look from three optional
stylesheets:

```ts
import "@stratum-hq/react/styles/base.css";          // neutral look; also "@stratum-hq/react/styles"
import "@stratum-hq/react/styles/theme-bedrock.css"; // optional: the Bedrock theme
import "@stratum-hq/react/styles/fonts.css";         // optional: the Bedrock fonts, from Google Fonts
```

`base.css` does not change the host page:

- Every rule is in the `stratum` cascade layer, so any unlayered rule of yours wins over it.
- Every custom property starts with `--stratum-`, and every selector matches a `stratum-*` element.
- It makes no network request and loads no font.
- It follows `prefers-color-scheme`. To fix the palette, set `data-theme="light"` or
  `data-theme="dark"` on an ancestor.
- Its reduced-motion rule stops the motion of `stratum-*` elements only.

`theme-bedrock.css` adds the Stratum identity: rock bands for tenant depth, ragged edges, grain and
a display face. Bedrock is its dark palette and Daylight its light palette. `fonts.css` is the only
file that makes a request, to `fonts.googleapis.com`. If your Content Security Policy blocks it, do
not import it, and host Big Shoulders Display, Instrument Sans and Martian Mono yourself.

### Theming tokens

The tokens are declared on the outermost `stratum-*` element, and nested components inherit them.
Set a token on a component root, on `TenantThemeProvider` (its `primaryColor` sets
`--stratum-accent`), or on your own wrapper with the class `stratum-scope`:

```css
.my-admin-panel.stratum-scope {
  --stratum-accent: #0055aa;
  --stratum-font-body: "Inter", sans-serif;
}
```

| Token | Use |
|---|---|
| `--stratum-surface-0` … `--stratum-surface-3` | Page, panel, hover and active surfaces |
| `--stratum-text-primary`, `-secondary`, `-tertiary` | Text |
| `--stratum-accent`, `-hover`, `-text`, `--stratum-on-accent` | Primary action and LOCKED; ink on it |
| `--stratum-flow`, `--stratum-on-flow` | INHERITED and resolved values; ink on it |
| `--stratum-success`, `--stratum-warning`, `--stratum-warning-fill`, `--stratum-on-warning`, `--stratum-error`, `--stratum-info` | Status colors |
| `--stratum-focus`, `--stratum-rule`, `--stratum-border`, `--stratum-border-hover` | Focus ring, control borders, hairlines |
| `--stratum-code-bg`, `--stratum-code-text` | Inline code |
| `--stratum-tree-band-0` … `--stratum-tree-band-4` | Tenant tree row color by depth (depth 4 repeats below) |
| `--stratum-tree-on-band-0` … `--stratum-tree-on-band-4` | Text on each band |
| `--stratum-tree-indent` | Indent per tree level (28px, 14px on phones) |
| `--stratum-font-body`, `--stratum-font-display`, `--stratum-font-mono` | Font stacks |
| `--stratum-font-size-xs` … `--stratum-font-size-2xl` | Type scale |
| `--stratum-space-1` … `--stratum-space-12` | Spacing in 4px steps (1, 2, 3, 4, 6, 12) |
| `--stratum-radius-sm`, `--stratum-radius` | Control and panel corners (0 in Bedrock) |
| `--stratum-shadow`, `--stratum-shadow-raised` | Panel and pop-over shadows (base only) |
| `--stratum-duration-fast`, `-normal`, `-slow`, `--stratum-ease-out`, `--stratum-ease-in-out` | Motion |
| `--stratum-edge` | Bedrock only. Set it to `none` to remove the ragged edges. |

`--stratum-accent-muted`, `--stratum-flow-muted`, `--stratum-lock`, `--stratum-lock-muted` and the
`--stratum-*-bg` status tints follow the tokens above.

## Components & Hooks

- **`StratumProvider`**: context provider; also exposes `TenantThemeProvider` for per-tenant theming.
- **`useStratum()`**: `{ currentTenant, tenantContext, loading, error, switchTenant, apiCall }`.
- **Data hooks:** `useTenant`, `useTenantTree`, `useConfig`, `usePermissions`, `useConfigCascade`, `useWebhooks`, `useAuditLogs`, `useToast`.
- **`TenantSwitcher`**: dropdown to select the active tenant.
- **`TenantTree` / `DraggableTenantTree`**: hierarchical tree view with an isolation-strategy badge per tenant and WAI-ARIA tree keyboard support (drag-to-reparent in the draggable variant).
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
