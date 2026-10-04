# @stratum-hq/react

## 1.0.0

### Major Changes

- 931194f: Scope the stylesheet to the components and make Bedrock an optional theme.

  `@stratum-hq/react/styles` no longer changes the host page. The old `default.css` is replaced by three files:

  - `styles/base.css` (also `@stratum-hq/react/styles`): a neutral look. Every rule is in the `stratum` cascade layer, every custom property starts with `--stratum-`, every selector matches a `stratum-*` element, and the file makes no network request. It follows `prefers-color-scheme` unless an ancestor sets `data-theme="light"` or `data-theme="dark"`. Its reduced-motion rule applies to `stratum-*` elements only.
  - `styles/theme-bedrock.css` (optional): the Bedrock look, with Daylight as its light palette.
  - `styles/fonts.css` (optional): the Bedrock fonts from Google Fonts. This is now the only file that makes a request.

  `DraggableTenantTree` and `ConfigInheritanceVisualizer` no longer render a `<style>` element; their rules are in the stylesheets. `TenantThemeProvider`'s `primaryColor` now sets `--stratum-accent`, so it changes the accent of the components inside it.

  Migration:

  - To keep the previous look, import all three files: `fonts.css`, `base.css` and `theme-bedrock.css`. Bedrock is no longer forced for every visitor: without `data-theme`, the palette follows `prefers-color-scheme`. Set `data-theme="dark"` on an ancestor to keep Bedrock for everyone.
  - The stylesheet no longer declares tokens on `:root`. If your own CSS read them, move to the `--stratum-*` names. They are declared on the outermost `stratum-*` element, so add the class `stratum-scope` to the element whose subtree reads them:
    - `--surface-0` … `--surface-3`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--accent`, `--accent-hover`, `--accent-text`, `--on-accent`, `--accent-muted`, `--flow`, `--on-flow`, `--flow-muted`, `--focus`, `--rule`, `--border`, `--border-hover`, `--lock`, `--lock-muted`, `--success`, `--warning`, `--error`, `--info` and their `-bg` forms, `--code-bg`, `--code-text`, `--font-display`, `--font-body`, `--font-mono`, `--font-size-*`: add the `--stratum-` prefix.
    - `--magma` → `--stratum-accent`; `--magma-deep` → `--stratum-accent-deep`; `--vein` → `--stratum-flow`; `--on-vein` → `--stratum-on-flow`; `--ochre` → `--stratum-warning`; `--amber-fill` → `--stratum-warning-fill`; `--on-ember` → `--stratum-on-warning`; `--oxide` → `--stratum-error`; `--sandstone` → `--stratum-info`; `--font-code` → `--stratum-font-mono`.
    - `--topsoil`, `--clay`, `--sandstone-band`, `--limestone`, `--basalt` → `--stratum-tree-band-0` … `--stratum-tree-band-4`; `--on-strata-dark` / `--on-strata-light` → `--stratum-tree-on-band-0` … `-4`.
    - `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`, `--space-3xl` → `--stratum-space-1`, `-2`, `-3`, `-4`, `-6`, `-12`. `--radius-*` → `--stratum-radius-sm` or `--stratum-radius`.
    - `--duration-fast`, `--duration-normal`, `--duration-slow`, `--ease-out`, `--ease-in-out` → the `--stratum-` forms.
    - Bedrock only: `--edge-*` → `--stratum-edge-*` (set `--stratum-edge: none` to remove all edges); `--grain` → `--stratum-grain`; `--lam` → `--stratum-laminations`; `--lit` → `--stratum-light`; `--shade` → `--stratum-shade`.
    - Removed without a replacement: every `--color-*` alias (use the `--stratum-*` token it pointed to, for example `--color-primary` → `--stratum-accent` and `--color-bg-surface` → `--stratum-surface-1`), `--syntax-*`, `--shadow-sm` … `--shadow-xl`, `--shadow-glow`, `--peat`, `--loam`, `--seam`, `--marl`, `--silt`, `--ember`, `--ember-strong`.

### Minor Changes

- c169734: `ConfigEditor` can lock and unlock a key that the current tenant owns. A **Lock** or **Unlock** button is on each own row, and the add row has a **Lock for descendants** option. A key that an ancestor locked stays read-only and still says "Locked by {tenant}".

  An edit of an own key keeps its lock and its sensitive flag. `setConfigValue` from `useConfig` and `HeadlessConfigEditor` takes an optional fourth argument, `sensitive`, and `ConfigWithInheritance` has an optional `sensitive` field.

  New message keys: `configEditor.lockButton`, `configEditor.unlockButton`, `configEditor.lockNewLabel`, `configEditor.lockFailed`.

- 83cffdc: Guard `ConfigEditor` and `WebhookEditor` against destructive and invalid input, and give each toast one live-region role.

  - `ConfigEditor` Remove and `WebhookEditor` Delete ask for confirmation first. The first click shows the question with **Yes, remove** (or **Yes, delete**) and **Keep**. Escape or **Keep** cancels.
  - `ConfigEditor` no longer saves text that is not valid JSON as a string without asking. It shows an inline error and a **Save as string** button. This applies to the inline edit and to the add row.
  - Escape cancels an inline edit in `ConfigEditor`.
  - The Source column shows the name of the tenant that set the value instead of a tenant ID prefix. A locked row says "Locked by" and that tenant's name. The names come from `GET /api/v1/tenants/:id/ancestors`; if that request fails, the column shows the first 8 characters of the tenant ID. `useConfig()` entries have a new optional `source_tenant_name` field.
  - Below 640px wide, `ConfigEditor` rows show as cards, with the status tag next to the key.
  - `Toast` has the `alert` role for an error and the `status` role for the other types, without a conflicting `aria-live`. `ToastContainer` is a `region` named "Notifications" and is no longer a second live region.
  - `toast.error(message, detail)` and `Toast` take an optional `detail`, shown behind a **Details** control. The editors now show a plain-language error message and put the raw API error there.
  - New message keys: `configEditor.lockedBy`, `configEditor.removePrompt`, `configEditor.confirmRemoveButton`, `configEditor.keepButton`, `configEditor.invalidJson`, `configEditor.saveAsStringButton`, `configEditor.saveFailed`, `configEditor.addFailed`, `configEditor.removeFailed`, and `webhookEditor.*`.

- 023c1ff: `TenantTree` and `DraggableTenantTree` show the real isolation strategy and work by keyboard.

  - The badge shows the isolation strategy of each tenant: `RLS`, `Schema` or `Database`. Before, every row showed `RLS`. The new message keys are `tenantTree.badgeSchema` and `tenantTree.badgeDatabase`; `tenantTree.badgeRls` keeps its meaning.
  - Both trees follow the WAI-ARIA tree pattern. Exactly one tree item is in the tab order. ArrowUp, ArrowDown, Home and End move the focus. ArrowRight expands a tenant and then moves to its first child. ArrowLeft collapses a tenant and then moves to its parent. Enter calls `onSelect`.
  - The focus now goes on the `treeitem` element. The tenant label is no longer a separate `role="button"` tab stop, and the expand toggle is out of the tab order. The row buttons are in the tab order of the active row only.
  - The row buttons have an `aria-label` that names the tenant. The new message keys are `tenantTree.editTenant`, `tenantTree.addChild`, `tenantTree.archiveTenant` and `tenantTree.moveTenant`.
  - Tenant names keep their own case in the body face, and the label `title` holds the full name when it is truncated. The toggle and the row buttons have a 24px target, and the tree has no text smaller than 11px.
  - In the Bedrock theme, the rows settle once, on first mount, and do not move on hover.

### Patch Changes

- ad4e3a3: Config overrides keep the sensitive flag of the key. An override of a config key that an ancestor marked sensitive is stored as sensitive, even when the write passes `sensitive: false`. When a tenant stores a key as sensitive, the overrides of that key in its descendants are stored as sensitive in the same transaction. A config write that leaves out `sensitive` keeps the key's current flag; an explicit `sensitive: false` still clears a flag the tenant set itself. A `batchSetConfig` call that names the same key more than once is rolled back. `SetConfigInputSchema` no longer defaults `sensitive` to `false`, so an omitted flag reaches the library as omitted, including through the control plane config routes. `ConfigEditor` sends the flag when it overrides an inherited sensitive key.

  After upgrading, run `stratum.applySensitiveConfigFlags()` once to apply the flag to existing overrides.

- ebf3258: Bedrock theme: the selected tenant in `TenantTree` is marked in vein, not magma. Magma stays on the primary action and on LOCKED, so a view that shows a tree next to an editor has one hot color. The active `TenantSwitcher` item, LOCKED rows and the highlighted cascade row lose their 4px left stripe: a raised face or a tint, plus the LOCKED tag, carries the state.
- ebf6888: `PermissionEditor` offers Remove only on the current tenant's own policies, and names the tenant that set each policy.

  - An ancestor's policy no longer shows Remove, because the API deletes only the current tenant's own policies. The row says **Set by {tenant}** instead.
  - The Source column shows the tenant name, with the same ancestors lookup as `ConfigEditor`. It shows a short tenant ID when that request fails.
  - Add and remove errors use plain language, with the raw error message as the toast detail.
  - `usePermissions` and `HeadlessPermissionEditor` return each permission with an optional `source_tenant_name`. The new exported type is `PermissionWithSource`.
  - New message keys: `permissionEditor.setBy`, `permissionEditor.addFailed`, `permissionEditor.removeFailed`.

- 1ce45b4: Fix `PermissionEditor` Remove, and ask for confirmation first.

  - Remove now sends the `policy_id` of the row in `DELETE /api/v1/tenants/:id/permissions/:policyId`. Before, it sent the source tenant ID, so the request did not name the policy.
  - Remove asks for confirmation the same way `ConfigEditor` does. The first click shows the question with **Yes, remove** and **Keep**. Escape or **Keep** cancels and moves focus back to Remove.
  - New message keys: `permissionEditor.removePrompt`, `permissionEditor.confirmRemoveButton`, `permissionEditor.keepButton`.

- ebf3258: `Skeleton` takes its corner radius only from `--stratum-radius-sm`. It no longer carries a 4px fallback, so the theme alone sets its corners.
- ebf3258: `WebhookEditor` and `AuditLogViewer` tables get the same header, cell and code styles as the other editor tables, in the base theme and in Bedrock. The `WebhookEditor` add row is a wrapping flex row, and the inputs of every editor's add row share its width instead of keeping the browser's default size.
- Updated dependencies [ad4e3a3]
  - @stratum-hq/core@1.7.0

## 0.7.0

### Minor Changes

- b9122c5: Restyle the shipped stylesheet (`@stratum-hq/react/styles`) with the Stratum Bedrock identity.

  - New type: Big Shoulders Display, Instrument Sans and Martian Mono replace the previous typefaces. The stylesheet's Google Fonts `@import` loads the new families.
  - New palette: the Bedrock (dark) and Daylight (light) values from the shared tokens, with five rock bands, magma as the one accent and vein teal for inherited values. Every existing `--color-*` alias still resolves; new tokens include `--magma`, `--vein`, `--flow`, `--lock`, `--rule`, `--focus`, the rock bands and `--on-*` inks.
  - No rounded corners: `--radius-*` are now `0`. Buttons, tags, fields, tree rows and panels take their shape from clip-path edges, with a rock lip and a soft shadow.
  - `TenantTree` and `DraggableTenantTree` draw each tenant as a rock band colored by depth, with a 28px stagger per level. Badges show a glyph plus the word (locked, inherited, delegated, own).
  - Dark is now the default for everyone. The stylesheet no longer switches to the light palette from the operating system's `prefers-color-scheme`; set `data-theme="light"` on an ancestor to opt in to Daylight.
  - Keyboard focus is a 3px `--focus` ring with a halo, and every animation stops under `prefers-reduced-motion`.

## 0.6.0

### Minor Changes

- 99437c5: Sensitive config values are still inherited, but reads of a descendant's config now return them masked: `value: null`, `sensitive: true` and `masked: true`, with `source_tenant_id` naming the tenant that set the value. A tenant's own sensitive values are unchanged.

  - `@stratum-hq/lib`: `resolveConfig`, `getConfigWithInheritance`, `getTenantContext` and `diffConfig` take an optional `ResolveConfigOptions`. Pass `{ revealSensitive: true }` in trusted server code that needs an inherited secret, or `{ viewerTenantId }` to reveal only the values that tenant set.
  - `@stratum-hq/control-plane`: the config, inheritance, diff and context routes reveal an inherited sensitive value only to a key of the tenant that set it. Global keys get the masked entry and can read the value from the owning tenant's own config.
  - `@stratum-hq/react`: `ConfigEditor` and `ConfigInheritanceVisualizer` show a masked value as "Sensitive value set by an ancestor" and never pre-fill it into the edit field.
  - `@stratum-hq/core`: `ResolvedConfigEntry` and `ConfigDiffEntry` gain optional `sensitive` and `masked` fields, and `ResolveConfigOptions` is exported.

  (GHSA-mg93-96h7-h9fq)

### Patch Changes

- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
  - @stratum-hq/core@1.6.0

## 0.5.2

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.
- Updated dependencies [b737034]
- Updated dependencies [a1bd9aa]
  - @stratum-hq/core@1.5.1

## 0.5.1

### Patch Changes

- b47f84f: Make the build copy of `src/migrations` (lib) and `src/styles` (react) replace the old copy in `dist`. A rebuild without a clean no longer creates `dist/migrations/migrations` or `dist/styles/styles`, and it no longer keeps stale top-level files. Published tarballs do not change, because the release job builds from a clean checkout.
- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- Updated dependencies [7e9ebcf]
- Updated dependencies [329cb16]
- Updated dependencies [e7e7b74]
- Updated dependencies [329cb16]
- Updated dependencies [cd7b950]
- Updated dependencies [694a3d3]
- Updated dependencies [694a3d3]
  - @stratum-hq/core@1.4.0

## 0.5.0

### Minor Changes

- 1669fd7: Harden defaults in generated projects, CLI checks, React hooks and test helpers (GHSA-rrrp-gww6-44gr). Behavior changes: `StratumProvider`'s `apiKey` is optional and generated React code uses a server-side proxy instead; `TenantThemeProvider` ignores `customCss` that is not plain declarations; `assertConfigInheritance` now takes a Stratum instance instead of a pg pool.

### Patch Changes

- Updated dependencies [dca0826]
  - @stratum-hq/core@1.3.0

## 0.4.1

### Patch Changes

- Retheme the shipped component styles (`dist/styles/default.css`) to the "Strata" earth-toned palette (peat/loam/ember) and Libre Franklin / IBM Plex Sans / IBM Plex Mono typefaces, replacing the previous, already-drifted palette. No component API changes; consumers who import the stylesheet will see updated colors and fonts.
- Updated dependencies [36f69d8]
  - @stratum-hq/core@1.2.1

## 0.4.0

### Minor Changes

- c17b1a5: Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

  The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

  If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
- Updated dependencies [b55ae70]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [5e87692]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/core@1.0.0

## 0.3.1

### Patch Changes

- Support React 19: widen the `react`/`react-dom` peer ranges to `^18 || ^19`. The components are compatible; the old `^18` cap forced `--legacy-peer-deps` on React 19 apps. Found while deploying the MSP reference app on Next 15 / React 19.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
