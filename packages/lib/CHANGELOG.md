# @stratum-hq/lib

## 1.8.0

### Minor Changes

- 99437c5: Outside `development` and `test`, `@stratum-hq/lib` now refuses to start when `STRATUM_API_KEY_HMAC_SECRET` is set to fewer than 32 bytes, the same minimum as `STRATUM_ENCRYPTION_KEY`. An unset secret is still accepted and keeps SHA-256 key hashing. A deployment with a shorter secret must set a longer one; existing HMAC-hashed keys then no longer match and must be reissued. (GHSA-mg93-96h7-h9fq)
- 99437c5: `batchSetConfig` is now atomic, as the config inheritance guide documents. Every entry is checked before anything is written. If any key is locked by an active ancestor or is invalid (an empty key, or a value that cannot be stored as JSON), nothing is written and the result has `rolled_back: true`, `succeeded: 0`, and `failed` equal to the number of entries. Every result then has status `error`: the keys that caused the rollback carry their own reason, and the others say they were not applied and name those keys. Previously the unlocked keys of a batch were written and only the locked ones failed. `BatchSetConfigResult` in `@stratum-hq/core` gains the optional `rolled_back` field. (#471)
- 99437c5: Opt-in hardening of the control-plane path (GHSA-mg93-96h7-h9fq).

  - New migration 032 adds a NOLOGIN control role (`stratum_control` by default, configurable per database through `controlRole` or the `stratum.control_role` setting) with a `stratum_control_plane` policy on every Stratum table. The SECURITY DEFINER helpers are owned by that role and no longer set `app.bypass_rls`.
  - 032 never stops an upgrade: when the migrating role can neither create nor join the control role, it applies the rest, skips the control role with a warning that prints the bootstrap SQL, and the database keeps its previous behavior. `initialize()` reports the hardening as not active until an administrator runs that SQL, which calls the new idempotent `stratum_apply_control_role()` function.
  - A fresh install no longer needs a superuser. For a migrating role that is not a superuser, `migrate()` drops the `SET app.*` clause lines of the migration 029 and 031 helper functions, which PostgreSQL accepts only from a superuser; 032 re-creates both functions without them.
  - `regions` now has row-level security like the other Stratum tables.
  - `new Stratum({ adminPool, pool })`: the library runs its own queries and `autoMigrate` on `adminPool`, a login that is a member of the control role, and `initialize()` checks both logins against the recommended role model (warns; throws for the application login with `enforceRls`). `adminPool` is optional in 1.x, with a one-time deprecation warning when absent.
  - New exports: `STRATUM_CONTROL_ROLE`, `bootstrapRolesSql()`, `APP_READ_TABLES`.
  - The legacy `app.bypass_rls` path stays available behind the `stratum_security.legacy_guc_bypass` switch, on by default in 1.8. Turn it off once every client uses `adminPool`.
  - New option `allowLegacyKeyHashes` (default true in 1.x). While `STRATUM_API_KEY_HMAC_SECRET` is set, API keys with a legacy SHA-256 hash still authenticate and are re-hashed with HMAC on use, with a one-time warning. Set it to false to accept only HMAC hashes.

  2.0 will require `adminPool`, remove the legacy switch, and default `allowLegacyKeyHashes` to false.

- 99437c5: Migration 032 grants the control role to the migrating login only with `migrate({ applyControlRole: true })` (set by `autoMigrate` with `adminPool`), or when that login is a superuser or already a member, and the control-role functions and bootstrap SQL are hardened. See GHSA-mg93-96h7-h9fq.
- 99437c5: `enforceRls: true` now checks the connecting role every time: `initialize()` (with or without `autoMigrate`), `migrate()` and `migrateAllSchemas()` throw when the role has `BYPASSRLS`. Previously the check ran only inside migration 001, so a database that was already migrated accepted a `BYPASSRLS` role. Upgrade note: a deployment with `enforceRls` on (the control plane turns it on outside development and test) that connects as a `BYPASSRLS` role now refuses to start; connect as a role without `BYPASSRLS`. See GHSA-mg93-96h7-h9fq.
- 99437c5: Role model follow-ups (GHSA-mg93-96h7-h9fq).

  - `bootstrapRolesSql()` first checks that the Stratum tables carry only what the Stratum migrations created (no rules, no triggers, defaults, constraints, indexes or policies that use other functions or operators, no other column types, unchanged Stratum functions) and stops with a list of what it found. `stratum_apply_control_role()` is now one of the Stratum functions it moves to the admin login.
  - The application-login check of `initialize()` also reports a login that owns the schema of the Stratum tables (directly or as the database owner) or is a member of the role that owns them.
  - New `inspectRoleModel()` returns the role-model checks as data, for logins or named roles, without logging. The CLI's `doctor`, `health` and `db roles` use it.
  - `stratum_apply_control_role()` (migration 032, run by the migration and by the bootstrap SQL) now resets row-level security on every Stratum table: it drops all their policies, enables and forces RLS, and re-creates the canonical policies of migrations 019, 020, 031 and 032. Applying it restores policies that an owner of the tables changed, dropped or added.
  - New `stratumPolicyDrift()` and `STRATUM_RLS_TABLES`: compare the RLS flags and policies of the Stratum tables with the canonical set.

- 99437c5: Hardened role-model checks (GHSA-mg93-96h7-h9fq): the catalog queries of the checks, migration 032, `migrate()` and `migrateAllSchemas()` are hardened, with new `pinnedQuery()`, `withPinnedSearchPath()` and `schemaOfTable()`; the control-role opt-in counts only when the migrating session sets it; migration 032 checks the Stratum tables before it applies the control role and warns instead when they carry foreign objects; applying the control role takes over every Stratum function; `initialize()` reports an application login that can create objects in the Stratum schema, and fails on it with `adminPool` and `enforceRls`; `autoMigrate` refuses an `adminPool` that logs in as the same role as `pool`; with `adminPool`, `initialize()` and `inspectRoleModel()` (new `searchPathIssue`) report an application login that can create schemas in the database while the admin login's `search_path` contains `"$user"`.
- 99437c5: Stricter key material checks. Outside `development` and `test` (an unset `NODE_ENV` counts as `development`), the library now refuses to load unless `STRATUM_ENCRYPTION_KEY` is set, is at least 32 bytes, and is not the built-in development key, and `STRATUM_HKDF_SALT` is set and is not the built-in development salt. Previously a missing key failed only on the first sensitive operation. In every environment, a `STRATUM_HKDF_SALT` that is set must be a non-empty, even-length hex string; any other value used to become a shorter or empty salt without warning. The legacy `WEBHOOK_ENCRYPTION_KEY` variable is now read only in development and test.

  Upgrade note: a deployment whose key is shorter than 32 bytes, or whose salt is not valid hex, now refuses to start. Rotate to a new key and salt with `rotateEncryptionKey`, keeping the old values readable through `STRATUM_ENCRYPTION_KEY_PREVIOUS` and `STRATUM_HKDF_SALT_PREVIOUS`, which are not subject to these checks. As the old salt in hex, give the leading hex pairs of the old value, which are the bytes Node used, or `00` when the old value starts with a character that is not hex (an empty salt and `00` derive the same key). A deployment that set only `WEBHOOK_ENCRYPTION_KEY` must set `STRATUM_ENCRYPTION_KEY` to the same value. See GHSA-mg93-96h7-h9fq.

- 99437c5: Sensitive config values are still inherited, but reads of a descendant's config now return them masked: `value: null`, `sensitive: true` and `masked: true`, with `source_tenant_id` naming the tenant that set the value. A tenant's own sensitive values are unchanged.

  - `@stratum-hq/lib`: `resolveConfig`, `getConfigWithInheritance`, `getTenantContext` and `diffConfig` take an optional `ResolveConfigOptions`. Pass `{ revealSensitive: true }` in trusted server code that needs an inherited secret, or `{ viewerTenantId }` to reveal only the values that tenant set.
  - `@stratum-hq/control-plane`: the config, inheritance, diff and context routes reveal an inherited sensitive value only to a key of the tenant that set it. Global keys get the masked entry and can read the value from the owning tenant's own config.
  - `@stratum-hq/react`: `ConfigEditor` and `ConfigInheritanceVisualizer` show a masked value as "Sensitive value set by an ancestor" and never pre-fill it into the edit field.
  - `@stratum-hq/core`: `ResolvedConfigEntry` and `ConfigDiffEntry` gain optional `sensitive` and `masked` fields, and `ResolveConfigOptions` is exported.

  (GHSA-mg93-96h7-h9fq)

### Patch Changes

- 99437c5: The transparent re-hash of a version 1 (SHA-256) API key to HMAC now updates the row only while it is still version 1. (GHSA-mg93-96h7-h9fq)
- 99437c5: New migration 033 adds an index on `api_keys.tenant_id`, so `stratum doctor` no longer warns about a missing `tenant_id` index on a fresh install. The migration is idempotent and also runs in each tenant schema under `migrateAllSchemas`. (#477)
- 99437c5: Reading an encrypted value under the wrong `STRATUM_ENCRYPTION_KEY` or `STRATUM_HKDF_SALT` now throws a `DecryptionError` (code `DECRYPTION_FAILED`) that says which settings to check, instead of Node's "Unsupported state or unable to authenticate data". The original error is kept as `cause`. A value that is not in the encrypted format also throws `DecryptionError`, and its message still contains "Invalid encrypted value format". `@stratum-hq/core` exports the new error class and code, and `@stratum-hq/lib` re-exports it. Key material validation at startup is unchanged. (#477)
- 99437c5: README corrections (#476). lib: the usage metering link works on npm. control-plane: how to start it from an npm install, the health check at `/api/v1/health`, the OpenAPI URLs, and how to create the first admin key. db-adapters: the Sequelize wrapper scopes `query()` only. hono: the quick start defines `sdkClient`. mysql: the TypeORM subscriber reads the tenant from the `@stratum-hq/sdk` context, set with `runWithTenantContext` outside the SDK middleware. compliance: links to its new documentation page.
- e1b2249: `createApiKey()` accepts `null` as the tenant ID, to create a global key. The runtime already stored a global key with `tenant_id` null; the type rejected the call.
- 99437c5: `suspendTenant` on a tenant with active children now reports "Cannot suspend tenant ...", not "Cannot archive tenant ...". `TenantHasChildrenError` takes an optional action (`"archive"` by default, or `"suspend"`) that names the blocked transition. (#477)
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
  - @stratum-hq/db-adapters@1.5.0
  - @stratum-hq/core@1.6.0
  - @stratum-hq/sdk@1.4.0

## 1.7.0

### Minor Changes

- 0c2ef75: Add an opt-in subtree read scope to row-level security. A tenant context in the subtree scope reads the rows of its tenant and of every descendant. Writes stay limited to the exact tenant. The default scope does not change.

  - `@stratum-hq/lib`: migration 031 adds the function `stratum_subtree_tenant_ids()` and a `tenant_subtree_read` policy, for `SELECT` only, to exactly these tables: `config_entries` (rows with `sensitive = false` only), `permission_policies`, `abac_policies`, `roles`, `principal_roles`, `audit_logs`, `usage_events`, `consent_records`, `webhook_events`, `webhook_deliveries` and `tenants`. Credential-bearing rows stay exact-tenant: `api_keys`, `webhooks` and sensitive `config_entries` rows get no subtree read. `SELECT ... FOR UPDATE` and `FOR SHARE` in the subtree scope return the exact tenant's rows only. The function runs once per policy reference in a statement and its cost grows with the subtree, so each table needs an index on `tenant_id`. Migration 031 also refuses a change to the tree columns of `tenants` (`parent_id`, `ancestry_path`, `depth`, `ancestry_ltree`) unless the session has the RLS bypass, which the library's tree operations use, so a move through `moveTenant` changes the subtree at once and a tenant context cannot move itself. It pins the `search_path` of its functions, and of the parent cycle guard of migration 029, with `pg_temp` last. `runScopedJob` takes `{ scope: "subtree" }`.
  - `@stratum-hq/db-adapters`: `setTenantContext` and `withTenantContext` take `{ scope: "exact" | "subtree" }`. `createPolicy` and `createIsolationPolicy` take `{ subtreeRead: true }`. `dropPolicy` also drops `tenant_subtree_read`. The policy check accepts the subtree policy form when the function is unqualified or qualified with the schema of the `tenants` table.
  - `@stratum-hq/cli`: the policy check that `doctor`, `scan`, `migrate` and `health` use counts a table with the subtree policy as isolated when the function is unqualified or qualified with `public`, the schema the check reads.

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.
- Updated dependencies [b737034]
- Updated dependencies [0c2ef75]
- Updated dependencies [a1bd9aa]
- Updated dependencies [0c2ef75]
  - @stratum-hq/core@1.5.1
  - @stratum-hq/sdk@1.3.1
  - @stratum-hq/db-adapters@1.4.0

## 1.6.0

### Minor Changes

- 508c6b8: Key rotation can now move encrypted data to a new HKDF salt. `rotateEncryptionKey` takes an optional fourth argument, `{ oldSalt, newSalt }`, in the hex format of `STRATUM_HKDF_SALT`. The run decrypts with the old key and the old salt, and encrypts with the new key and the new salt. A salt that is not given is the configured `STRATUM_HKDF_SALT`, so existing calls work as before.

  The new `STRATUM_HKDF_SALT_PREVIOUS` variable works together with `STRATUM_ENCRYPTION_KEY_PREVIOUS`. If the current key and salt do not decrypt a value, Stratum tries the previous key with the previous salt. A deployment that moves off the built-in development key can now move to a new random salt. The lib docs give the order of the steps.

### Patch Changes

- 508c6b8: The control plane route `POST /api/v1/maintenance/rotate-encryption-key` accepts optional `old_salt` and `new_salt` in hex, and passes them to `rotateEncryptionKey`. A control plane operator can now move encrypted data to a new HKDF salt. The route accepts the same key as `old_key` and `new_key` when the two salts differ. It answers `400 VALIDATION_ERROR` when a salt is not a non-empty, even-length hex string.

  `rotateEncryptionKey` in `@stratum-hq/lib` now throws a `ValidationError` for an `oldSalt` or `newSalt` that is not a non-empty, even-length hex string, and changes no row. Before, the hex decoder shortened such a salt without an error, and an empty salt fell back to the configured salt.

- Updated dependencies [2930b1a]
  - @stratum-hq/db-adapters@1.3.0

## 1.5.0

### Minor Changes

- 4c1686a: Creating or rotating an API key for a suspended or archived tenant is now refused with `InvalidTenantStateError` (GHSA-p3jw-vw8m-3rqr).
- 4c1686a: Webhook and region audit entries record URLs as `scheme://host/` plus a path fingerprint (`#fp=` and the first 12 hex characters of sha256 of the path), or `[REDACTED]` for a URL without a host; migration 030 applies the same form to existing audit rows, and webhook URL validation errors no longer echo the full URL (GHSA-jx2p-pffr-c5gh).

  Upgrade note: migration 030 scrubs audit rows only. Region rows whose `control_plane_url` already contains credentials keep that value in the `regions` table; update those regions with a URL that has no credentials.

- 4c1686a: `STRATUM_ENCRYPTION_KEY` and `STRATUM_HKDF_SALT` are now required in every environment other than `development` and `test` (an unset `NODE_ENV` counts as `development`); only those fall back to the built-in key (GHSA-jx2p-pffr-c5gh).

  Upgrade note: deployments outside development and test must set `STRATUM_ENCRYPTION_KEY` and `STRATUM_HKDF_SALT`. The match is exact: any other `NODE_ENV` value, such as `dev`, `local`, `ci`, `qa`, `staging` or `Development`, is strict. Data encrypted without them used the built-in development key and must be re-encrypted with `rotateEncryptionKey` while the built-in salt is still in effect: set `STRATUM_HKDF_SALT` to the built-in salt's hex value, then rotate. See "Moving off the built-in development key" in the `@stratum-hq/lib` package docs (`website/src/content/docs/packages/lib.mdx`).

- 4c1686a: Migration 029 refuses a parent_id that would make a tenant its own ancestor (GHSA-54ff-f8q6-8mfx).
- 4c1686a: reorderTenant takes the tenant tree lock and locks the sibling rows, so concurrent reorders and moves run one after the other (GHSA-54ff-f8q6-8mfx).
- 4c1686a: Config, permission, webhook, consent, ABAC policy, tenant role (create and update), role assignment (assignRole, assignRoleToKey) and usage writes now require an active tenant and throw TenantSuspendedError, TenantArchivedError or TenantPendingError otherwise; removals and webhook deactivation still work (GHSA-54ff-f8q6-8mfx).

### Patch Changes

- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
  - @stratum-hq/sdk@1.3.0
  - @stratum-hq/core@1.5.0

## 1.4.0

### Minor Changes

- b47f84f: `@stratum-hq/lib` exports `STRATUM_TABLES`, the list of tables that Stratum's migrations create. `stratum scan` and `stratum migrate --all` now read this list to skip Stratum's own tables, so they no longer report `abac_policies`, `usage_events`, or `principal_roles` as application tables. `stratum scan --generate` no longer emits `CREATE POLICY` for a table that already has a `tenant_isolation` policy, so the generated script applies without error.
- e7e7b74: Report invalid input as a validation error, not as a server or database error.

  Breaking for some callers: `@stratum-hq/lib` now rejects input that it stored before, and `recordAuditEvent` throws a different error class.

  - `@stratum-hq/lib`: `grantConsent` validates its input with `GrantConsentInputSchema`. It now throws a `ValidationError` and writes no row for:
    - an empty `subject_id` or `purpose`.
    - an `expires_at` that is only a date (`2026-12-31`), or a date and time without a time zone offset (`2026-12-31T00:00:00`). Before, PostgreSQL stored these values, and it read a time without an offset in the time zone of the database session.
    - an `expires_at` that PostgreSQL cannot store, such as `infinity`. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/lib`: `createAbacPolicy` validates its input with `CreateAbacPolicyInputSchema`. It now throws a `ValidationError` and writes no row for:
    - an empty `name`, `resource_type` or `action`, or a condition with an empty `attribute` or an unknown `operator`. Before, the policy was stored.
    - a `priority` that is not an integer from -2147483648 to 2147483647. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for invalid input, with the zod issues in `details.issues`. Before, it threw a `ZodError`. A check such as `err instanceof ZodError` no longer matches. Check `err instanceof ValidationError` instead.
  - `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for a `sourceIp` that is not an IP address. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/core`: `RecordAuditEventInputSchema.sourceIp` now accepts only an IPv4 or IPv6 address, with an optional `/prefix` (`203.0.113.7`, `10.0.0.0/8`, `2001:db8::1/128`). This matches the `INET` column. The `source_ip` value that `queryAuditLogs` returns, such as `203.0.113.7/32`, is accepted. The schema rejects an IPv6 zone index (`fe80::1%eth0`) and an IPv4 address with leading zeros (`010.0.0.1`). Before, the schema accepted any string.
  - `@stratum-hq/control-plane`: the error handler identifies a `ZodError` by its shape, so a `ZodError` from another copy of zod now gets a `400 VALIDATION_ERROR` response instead of a `500`.

- 329cb16: Region conflicts now throw typed errors instead of a plain `Error`:

  - `deleteRegion` throws `RegionInUseError` (code `REGION_IN_USE`, status code 409) when active tenants are still assigned to the region.
  - `migrateRegion` throws `RegionNotActiveError` (code `REGION_NOT_ACTIVE`, status code 409) when the target region is not `active`.

  `@stratum-hq/lib` now exports `RegionInUseError` and `RegionNotActiveError`. The thrown class changes from `Error` to these `StratumError` subclasses, so a caller can check the class or the `code`. The error messages do not change.

  The control plane now answers `409` with these codes for `DELETE /api/v1/regions/:id` and `POST /api/v1/tenants/:id/migrate-region`. Before, it answered `500 INTERNAL_SERVER_ERROR`.

- 7e9ebcf: `rotateEncryptionKey` can now resume after a partial failure.

  The rotation commits in batches. Before this change, a run that failed partway could not be repeated: the second run failed on the first value that was already on the new key. Now the run keeps a value that already decrypts with the new key. It also continues past a value that decrypts with neither key.

  `KeyRotationResult` has two new fields:

  - `already_rotated`: the number of values that already decrypt with the new key.
  - `unreadable`: the rows (`table` and `id`) whose value decrypts with neither key. The run leaves them unchanged.

  `config_entries_rotated` and `webhooks_rotated` now count only the values that this run re-encrypted. A value that was already on the new key counts in `already_rotated`, not in these two fields.

  A rotation with the wrong old key still fails, so the new tolerance for unreadable rows cannot hide a wrong key. If encrypted values exist and none of them decrypts with the old key or the new key, `rotateEncryptionKey` throws a `ValidationError` and changes no row. When some rows decrypt and some do not, the run completes and logs the warning `encryption key rotation left unreadable rows` with the count and the rows.

  The control plane `POST /api/v1/maintenance/rotate-encryption-key` response now has these fields: `config_entries_rotated`, `webhooks_rotated`, `already_rotated`, and `unreadable`. The OpenAPI spec documented a `re_encrypted_count` field, which the endpoint never returned; the spec now shows the real response. The endpoint returns `400 VALIDATION_ERROR` when encrypted values exist and none of them decrypts with either key.

- 694a3d3: Add the `tenant.activated` webhook event. `activateTenant` emits it when it moves a pending tenant to `active` (best effort: in rare failure cases around a lost database reply the event can be missed or, with concurrent activations, sent twice). A failed activation emits no event. `TenantEvent.TENANT_ACTIVATED` is the new enum member, and webhooks can now subscribe to it.
- cd7b950: `validateApiKey` now updates `last_used_at` only when the stored value is more than 60 seconds old, and waits at most one second for that update. Concurrent requests with one key no longer wait on its row lock, and a blocked update no longer delays authentication. `last_used_at` can now lag the latest use by up to one minute. `listDormantKeys` counts in days, so its results do not change. A legacy-hash upgrade still runs on the first validation after an HMAC secret is set.

  `activateTenant` now reads the tenant again when the database call fails with an error that is not a Stratum error, such as a dropped connection. If the tenant is `active`, the activation committed: the call succeeds and emits `tenant.activated` (best effort). Before, the call failed and no event was emitted.

### Patch Changes

- 9ed3e01: Subtree queries now use an index. `getDescendants`, CASCADE permission revocation and CASCADE ABAC policy revocation select descendants by the prefix of the tenant's own `ancestry_path`. Migration `028_ancestry_path_prefix_index.sql` adds the `text_pattern_ops` index that serves this prefix match. Before, each of these calls scanned the whole `tenants` table. The returned rows do not change.

  While migration 028 builds the index, PostgreSQL blocks writes to `tenants`. On a large `tenants` table, you can build the index first with `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_ancestry_path_prefix ON tenants (ancestry_path text_pattern_ops);`. The migration then finds the index and skips it.

  CASCADE permission revocation and ABAC policy revocation now throw `TenantNotFoundError` when the tenant is removed while the revocation runs. Before, they threw a `TypeError`.

- b47f84f: Make the build copy of `src/migrations` (lib) and `src/styles` (react) replace the old copy in `dist`. A rebuild without a clean no longer creates `dist/migrations/migrations` or `dist/styles/styles`, and it no longer keeps stale top-level files. Published tarballs do not change, because the release job builds from a clean checkout.
- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- cd7b950: A missing region now gives a typed not-found error. Core adds `RegionNotFoundError` with the code `REGION_NOT_FOUND`. Lib re-exports it, the lib region functions throw it, and `migrateRegion` throws `TenantNotFoundError` for a missing tenant. The control plane answers 404 instead of 500 for these requests.
- 9ed3e01: `withClient` and `withTransaction` now rethrow the original error when the ROLLBACK also fails. Before, the ROLLBACK error replaced it, so a caller that checks an error code such as `23505` saw the wrong error. When the ROLLBACK fails, the connection is now removed from the pool instead of reused.
- 694a3d3: `validateApiKey` now waits for its `last_used_at` update, and for the legacy-hash upgrade, before it resolves. Before, the update ran in the background, so a `listDormantKeys` call made right after a validation could still report the key as dormant. The update still runs after the validation connection is released, so a pool with one connection still works. A failed update still does not fail authentication. A validation that updates `last_used_at` waits for one extra `UPDATE` round trip.
- Updated dependencies [7e9ebcf]
- Updated dependencies [329cb16]
- Updated dependencies [b47f84f]
- Updated dependencies [e7e7b74]
- Updated dependencies [9ed3e01]
- Updated dependencies [329cb16]
- Updated dependencies [cd7b950]
- Updated dependencies [e7e7b74]
- Updated dependencies [9ed3e01]
- Updated dependencies [e7e7b74]
- Updated dependencies [ac561f9]
- Updated dependencies [ac561f9]
- Updated dependencies [ac561f9]
- Updated dependencies [329cb16]
- Updated dependencies [694a3d3]
- Updated dependencies [694a3d3]
  - @stratum-hq/core@1.4.0
  - @stratum-hq/db-adapters@1.2.0
  - @stratum-hq/sdk@1.2.0

## 1.3.0

### Minor Changes

- dca0826: Enforce INHERITED permission mode for descendants and redact webhook secrets from audit entries (GHSA-wf22-q48q-4cjq).
- dca0826: Route testWebhook through pinned delivery and broaden the webhook egress blocklist (GHSA-xq46-9x9m-22p9).
- dca0826: Create tenants with their own schema or database as pending until provisioned, and drop that storage on purge (GHSA-jhhc-cm2c-jh27).
- dca0826: Harden tenant hierarchy integrity under concurrent writes (GHSA-f3h7-j63g-96wh).

### Patch Changes

- dca0826: Harden API key lifecycle, JWT binding and rate limiting (GHSA-rqvw-c6qr-6x37).
- dca0826: Harden control-plane authorization for tenant-scoped callers (GHSA-76p7-8h5v-7qxr).
- dca0826: Harden tenant isolation in the schema-per-tenant and database-per-tenant strategies and the Prisma and Drizzle adapters (GHSA-jhhc-cm2c-jh27). Behavior change: the schema-per-tenant `search_path` is now the tenant schema alone, without `public`; queries that call extension functions or types from another schema must schema-qualify them or opt that schema in with the new `extraSearchPath` option.
- dca0826: Harden policy evaluation, revocation and audit handling in the library (GHSA-wf22-q48q-4cjq).
- dca0826: Harden webhook delivery (GHSA-xq46-9x9m-22p9).
- Updated dependencies [9de2ddb]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
  - @stratum-hq/db-adapters@1.1.0
  - @stratum-hq/sdk@1.1.0
  - @stratum-hq/core@1.3.0

## 1.2.1

### Patch Changes

- 36f69d8: Fix public input types to use `z.input` instead of `z.infer` so documented happy-path calls type-check.

  Input types such as `CreateTenantInput` and `SetConfigInput` were declared as `z.infer<typeof Schema>` (the schema OUTPUT type), which made every field carrying a Zod `.default()` required at the type level even though the services apply those defaults at runtime. As a result, calls like `stratum.createTenant({ name, slug })` ran correctly but did not compile.

  Every public input and query type in `@stratum-hq/core` now uses `z.input` (the pre-defaults type), so defaulted fields are optional for callers. This is a backward-compatible widening: previously-required fields become optional, and existing callers that pass them still compile. A new `BatchSetConfigEntry` type derives the `batchSetConfig` entry shape from `SetConfigInput` so the batch and single-key config surfaces cannot drift.

- Updated dependencies [d78d839]
- Updated dependencies [36f69d8]
  - @stratum-hq/sdk@1.0.1
  - @stratum-hq/core@1.2.1

## 1.2.0

### Minor Changes

- e57636a: feat: allow recordAuditEvent to set an explicit occurredAt timestamp

  `RecordAuditEventInput` gains an optional `occurredAt` (ISO 8601 datetime string
  or `Date`). When provided it sets the row's `created_at`, so a consumer seeding
  historical or backdated audit events can control the timestamp; when omitted the
  row is stamped `now()` exactly as before, so existing callers are unaffected. The
  value is validated by Zod and an invalid timestamp is rejected before the write.

### Patch Changes

- a1a1f04: fix: scope getDescendants by stable tenant id, not the slug-derived ltree

  `getDescendants` matched a tenant's subtree with `ancestry_ltree <@ ...`, where
  `ancestry_ltree` is a slug-derived materialized path maintained by a trigger.
  Renaming a tenant's slug recomputes only that node's label, so the subtree match
  against a renamed node could drop descendants that still carry the old label,
  silently under-including the subtree.

  The query now matches descendants on the stable, ID-based `ancestry_path` (the
  tenant's id appears as a path segment of every descendant), the same approach
  already used for permission and ABAC cascade revocation (#115). The `status =
'active'` default and the `includeArchived` opt-in are unchanged. Fixes #189.

- Updated dependencies [e57636a]
  - @stratum-hq/core@1.2.0

## 1.1.0

### Minor Changes

- 6c2efa4: feat: add an app-facing audit-write API

  `stratum.recordAuditEvent(input)` lets a consumer append a custom event to
  Stratum's `audit_logs` through the public surface, instead of writing the table
  directly (Stratum owns it and previously exposed only `queryAuditLogs`). The
  input is validated and mapped onto the same write path the internal services
  use, so a recorded event is indistinguishable from one Stratum writes itself and
  is immediately queryable via `queryAuditLogs`:

  ```ts
  const entry = await stratum.recordAuditEvent({
    tenantId,
    actorId,
    actorType: "api_key", // 'api_key' | 'jwt' | 'system'; defaults to 'system'
    action: "invoice.sent",
    resourceType: "invoice",
    resourceId,
    before,
    after,
    metadata,
    sourceIp, // stored in the INET column
  });
  ```

  The row is stamped for `tenantId` and no other tenant, so under SHARED_RLS a
  data-plane reader only ever sees its own tenant's events. `actorType` matches
  the `actor_type` CHECK and `sourceIp` the `source_ip` INET column. New
  `RecordAuditEventInput` type and `RecordAuditEventInputSchema` are exported from
  `@stratum-hq/core` and re-exported from `@stratum-hq/lib`.

- c5a79fc: feat: add `getTenantBySlug` for indexed slug lookups

  `getTenantBySlug(slug, includeArchived?)` resolves a tenant by its globally
  unique slug in a single indexed lookup on the `slug` column, the slug-keyed
  counterpart to `getTenant`. Consumers that hold a slug no longer have to scan
  the unindexed `listTenants` / `listOrganizations` pages. It mirrors `getTenant`
  exactly: throws `TenantNotFoundError` when no row matches, and (unless
  `includeArchived` is set) `TenantArchivedError` / `TenantSuspendedError` for a
  non-active row.

- 5c1ac71: feat: add `runScopedJob` for tenant-scoped background jobs

  `runScopedJob(pool, tenantId, fn)` runs a background job bound to a single
  tenant. It establishes both the AsyncLocalStorage tenant context (so in-job code
  sees the tenant via `Stratum.currentTenantId()`) and the Postgres row-level
  security context (`SET LOCAL app.current_tenant_id` via the data-plane
  `withTenantContext`) for the duration of the job, then tears both down on
  completion or error. A job cannot read or write another tenant's rows, and the
  context does not leak onto the next job that reuses a pooled connection.

- 6f0bad4: Add a per-tenant rate-limiting primitive (`RateLimiter`).

  `RateLimiter` is a standalone, storage-agnostic fixed-window limiter for library
  consumers, distinct from the control plane's HTTP rate limiting. It resolves an
  effective per-tenant limit (a `resolveLimit` hook, a static `limits` map, then a
  `defaultLimit`), and exposes `checkLimit(tenantId, key?)` returning
  `{ allowed, limit, remaining, resetAt, retryAfter }`. Storage is pluggable via
  the documented `RateLimitStore` contract; a process-local `MemoryRateLimitStore`
  ships as the default, and the `resolveLimit` hook is the seam for driving limits
  from Stratum config inheritance. No new runtime dependencies.

- b739673: First-class tenant lifecycle: create, suspend, resume, archive, purge

  `@stratum-hq/lib` gains `suspendTenant`, `resumeTenant`, and `archiveTenant` (as
  tenant-service functions and `Stratum` methods), consolidating the tenant
  lifecycle into an explicit state machine: active to suspended/archived, and
  either back to active or on to a purge. `deleteTenant` is retained as a
  deprecated alias of `archiveTenant`.

  Descendant rules are now defined and tested against Postgres: suspend and
  archive block when a tenant has active children (leaf-first); resume and create
  require an active parent (top-down); purge requires an empty subtree. A
  migration widens the `tenants.status` CHECK constraint to allow `suspended`.

  `@stratum-hq/core` gains the `suspended` tenant status, the `TenantSuspendedError`
  (403) and `InvalidTenantStateError` (409) error classes, and the
  `tenant.suspended`, `tenant.resumed`, `tenant.archived`, and `tenant.purged`
  webhook event types. Suspended tenants are blocked from `getTenant` and excluded
  from subtree listings, matching archived tenants.

- a2a33a7: feat: per-tenant usage metering primitive (FR-58)

  Add `recordUsage` and `aggregateUsage` to `Stratum` for countable per-tenant
  usage events with per-metric aggregation over a half-open time window. Events
  persist to a new `usage_events` table (migration 020) with optional
  idempotency keys and the same fail-closed RLS tenant isolation as migration 019. New core types: `RecordUsageInput`, `UsageEvent`, `UsageAggregate`,
  `UsageAggregateQuery`.

- 4615784: feat: expose typed webhook event-stream listing

  Adds two read methods on the `Stratum` facade so callers can page the webhook
  event stream that previously had no typed listing:
  - `listWebhookEvents({ tenantId, type?, from?, to?, limit?, offset? })` returns
    `WebhookEvent[]` for a single tenant, newest first. The listing is always
    scoped to `tenantId` (a caller can never page another tenant's events),
    optionally narrowed by event type and a `created_at` window, and paginated
    with `limit` (1-100, default 50) and `offset`.
  - `listDeliveriesByEvent(eventId)` returns `WebhookDelivery[]` for a single
    event, newest first.

  `core` gains the `ListWebhookEventsQuery` input type. The existing
  `listWebhookDeliveries` / delivery methods are unchanged.

- 5a2ef97: feat: export a typed `WebhookUrlValidationError` for webhook-URL validation

  Webhook-URL validation (`validateWebhookUrl` / `validateWebhookUrlWithDns`,
  used by `createWebhook`, `updateWebhook`, and `testWebhook`) now throws a typed
  `WebhookUrlValidationError` instead of a plain `Error`. It extends `StratumError`
  with code `WEBHOOK_URL_INVALID` and status 400, so a consumer can turn a rejected
  URL into a 400 with `instanceof WebhookUrlValidationError` (or `instanceof
StratumError`) instead of matching the human-readable message. The class is
  exported from `@stratum-hq/core` and re-exported from `@stratum-hq/lib`. The
  validation logic and messages are unchanged.

### Patch Changes

- 6e5dc49: fix: return webhook-listing timestamps as strings and order deterministically

  `listWebhookEvents` and `listDeliveriesByEvent` now cast their timestamp columns
  (`created_at`, `next_retry_at`, `completed_at`) to text in the SELECT, so the
  returned rows honor the `string` type declared by `WebhookEvent` /
  `WebhookDelivery` instead of handing back `Date` objects. Both listings also add
  an `id` tiebreaker (`ORDER BY created_at DESC, id DESC`) so pagination is
  deterministic when rows share a timestamp. This matches the convention already
  used by `queryAuditLogs` and the usage-metering queries.

- Updated dependencies [6c2efa4]
- Updated dependencies [b739673]
- Updated dependencies [a2a33a7]
- Updated dependencies [4615784]
- Updated dependencies [5a2ef97]
  - @stratum-hq/core@1.1.0

## 1.0.0

### Major Changes

- 5e87692: Unify API-key scope resolution and make scope checks hierarchical (FR-53, #132).

  Two authorization-semantics changes land together:
  - **Hierarchical scopes.** Scope requirements are now checked with a rank
    comparison (`read` < `write` < `admin`) instead of flat set membership, so
    `admin` implies `write` implies `read`. A key minted as `["admin"]` or
    `["write"]` now satisfies the lower-scope routes it previously failed. A new
    `scopeSatisfies(granted, required)` helper in `@stratum-hq/core` is the single
    scope-check primitive; the control-plane authorize middleware uses it. This
    changes same-tenant behavior by scope level only and does not alter any
    cross-tenant boundary.
  - **Single scope source.** `validateApiKey` (the auth boundary) and
    `resolveKeyScopes` now resolve scopes through one `resolveEffectiveScopes`
    function: an assigned role's scopes govern; otherwise the key's own column
    scopes apply; a key with neither defaults to `["read"]`. Previously
    `validateApiKey` read the `api_keys.scopes` column and ignored an assigned
    role, so assigning a role had no effect on control-plane authorization.
    Assigning a role now governs the key's authorization everywhere, which can
    narrow a key whose role is narrower than its column scopes. Keys without a role
    are unaffected.

  Both are breaking changes to authorization behavior; audit any key that carries a
  role alongside column scopes, and mint keys with the scopes the caller actually
  needs. See the migration guide sections 5.2 and 5.3 in `docs/v1.0-api-surface.md`.

- c17b1a5: Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

  The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

  If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.

### Minor Changes

- f071f49: Re-export Stratum's typed error classes as runtime values from the `@stratum-hq/lib` public entry (FR-52).

  `@stratum-hq/lib` previously re-exported core's error types only via `export type`, so the error classes were not available as runtime values and could not be used with `instanceof`. Consumers had to import them from `@stratum-hq/core` directly (or match error-message substrings). Every error class in the hierarchy (`StratumError` and its subclasses, plus the `ErrorCode` enum) is now importable as a value:

  ```ts
  import { StratumError, TenantNotFoundError } from "@stratum-hq/lib";

  try {
    await stratum.tenants.get(id);
  } catch (err) {
    if (err instanceof TenantNotFoundError) {
      // ...
    }
  }
  ```

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4eb1c52: Fix batchCreateTenants to honor its all-or-nothing transaction contract. The
  batch runs in a single transaction, so a mid-batch failure (such as a duplicate
  slug) rolls every insert back. The returned `created` array was populated in
  memory before the failure and still listed the rolled-back tenants, which caused
  the facade to emit TENANT_CREATED events and write audit entries for tenants that
  were never persisted. `created` is now cleared on failure, so it reflects only
  what actually committed and no phantom events or audit entries are emitted.
- 3fa212b: Fix moveTenant leaving the moved node's direct children with a stale
  ancestry_path, depth, and ancestry_ltree. The descendant rewrite matched only
  paths with a segment after the moved tenant (a `LIKE 'prefix/%'`), so immediate
  children (whose ancestry_path equals the prefix exactly) were skipped, leaving
  the subtree inconsistent and hiding those children from getDescendants (which
  queries the ltree). The rewrite now also matches the exact prefix. Surfaced by a
  new real-database integration test; the existing unit tests mock the pool and
  never exercised the descendant rows.
- 86dfbe1: Fix reading back a sensitive (encrypted) config value.

  `resolveConfig` and `getConfigWithInheritance` parsed the pg-decoded JSONB value a
  second time before decrypting it. The pg driver already parses the JSONB column, so
  the extra `JSON.parse` ran against an already-decoded string and threw, meaning any
  config key written with `sensitive: true` could not be read back. The same redundant
  parse in `rotateEncryptionKey` broke rotating a sensitive config row. Removing the
  redundant parse lets sensitive values decrypt and round-trip correctly, including
  across a key rotation.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
- Updated dependencies [b55ae70]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [5e87692]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/core@1.0.0
  - @stratum-hq/sdk@1.0.0

## 0.7.0

### Minor Changes

- 523abeb: Enforce the `SHARED_RLS` isolation strategy with real Postgres row-level security.

  Migration `019_rls_policies.sql` enables `ROW LEVEL SECURITY` (with `FORCE`) and a
  tenant-isolation policy on every tenant-scoped shared-schema table, so tenant
  isolation is enforced by the database as a second layer independent of the
  application's `WHERE tenant_id` filters. Context is set per transaction with
  `SET LOCAL` (`app.current_tenant_id`), and a `withRlsBypass` helper (new, exported
  from `@stratum-hq/db-adapters` alongside `withTenantContext`) provides the audited
  system path for control-plane cross-tenant operations.

  Rollout note: after this migration runs, any client connecting as a non-superuser,
  non-`BYPASSRLS` role must set the tenant context (`withTenantContext`) or use a
  bypass, or its direct queries against the protected tables return zero rows. Do not
  enable this against a shared database until every direct client has adopted the
  tenant-context helper. See `docs/adr/0001-postgres-rls-defense-in-depth.md`.

## 0.6.0

### Minor Changes

- f96c3b4: Add `getApiKey(id)` to look up a single API key by id, including its owning tenant. Returns null when no key has that id. The primitive for authorizing operations that target an API key by id whose owning tenant is not otherwise in the request (for example scoping role assignment to the key's tenant).
- 718d977: `getDescendants` now returns only active descendants by default, matching `getChildren`, `listTenants`, and the default of `getTenant`. Archived and soft-deleted tenants are excluded from a subtree listing. Callers that need the full historical subtree (for example lifecycle or data-retention passes) pass the new `includeArchived` argument: `getDescendants(id, true)`. The subtree query and its three-state behavior (active / archived / soft-deleted) are now documented on the method and covered by unit and integration tests.
- e46ffeb: Harden webhook egress validation to reject private, loopback, link-local, unspecified, and cloud-metadata targets across every address notation, including bracketed and IPv4-mapped IPv6 literals. Webhook deliveries now bind a timestamp into their signature for replay resistance, and a `verifyWebhookSignature` helper is exported so consumers can validate the signature and timestamp freshness of incoming deliveries.

### Patch Changes

- eaffc2d: Harden CASCADE permission and ABAC policy revocation so it reaches every current descendant identified by stable tenant identity. Descendant matching now uses the ID-based `ancestry_path` instead of the slug-derived subtree key, so a prior slug rename can no longer leave a revoked permission or policy live on a descendant.
- abc555d: Fix encryption key rotation to re-encrypt every sensitive row exactly once. Rotation now walks config entries and webhook secrets with a keyset cursor over the primary key, so datasets larger than a single batch are rotated fully and correctly instead of stalling after the first batch.

  Validate the tenant slug in `setSchemaSearchPath` before it is used to build the schema identifier, matching the other schema-isolation adapters. Identifiers outside the canonical slug charset are now rejected rather than interpolated into the search-path statement.

## 0.5.1

### Patch Changes

- f6b38fa: `assignRole` and `resolvePrincipalScopes` accept an optional `tenantId`. When set, a role owned by a different tenant is refused on assign and ignored on resolve, while global roles remain allowed. Closes the cross-tenant assignment and resolution gap in principal role scoping. Backward compatible.

## 0.5.0

### Minor Changes

- 949194a: Add principal-agnostic role assignment. `assignRole`, `removeRole`, and `resolvePrincipalScopes` let any principal (an application user or a service account) hold a Stratum role and resolve its effective scopes, not only API keys. Adds the `principal_roles` table (migration 018); one role per principal; `resolvePrincipalScopes` fails closed, returning an empty scope set when the principal is unassigned.

## 0.4.0

### Minor Changes

- 875f234: Add `getRoot(id)` to resolve a tenant's root ancestor: the top-most ancestor, or the tenant itself when it is already a root. Uses single-row lookups rather than walking the full ancestry chain.

## 0.3.1

### Patch Changes

- c55da6e: Fix `getAncestors` returning an empty or incomplete ancestor chain. `getAncestorIds` assumed ancestry paths include the tenant's own id and sliced off the last element, but paths store only the ancestor chain, so every depth-1 tenant reported zero ancestors and deeper tenants lost their direct parent. `getSelfId` docs corrected to reflect that the last path element is the direct parent.
- Updated dependencies [c55da6e]
  - @stratum-hq/core@0.3.1

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
  - @stratum-hq/sdk@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
