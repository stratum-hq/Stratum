// Type test: the documented API key calls must compile under `tsc --strict`.
// `npm run typecheck` compiles this file through tsconfig.types.json. It never runs.
//
// The examples come from website/src/content/docs/guides/api-keys.mdx and
// website/src/content/docs/packages/lib.mdx.

import { Stratum } from "@stratum-hq/lib";

declare const stratum: Stratum;

export async function guideCreateTenantKey() {
  const { plaintext_key, id } = await stratum.createApiKey(
    "tenant-uuid",
    { name: "my-service" }
  );
  // Save plaintext_key: it is only returned once
  return { plaintext_key, id };
}

export async function guideCreateGlobalKey() {
  // A global key has no tenant: tenant_id is null.
  const { plaintext_key, tenant_id } = await stratum.createApiKey(null, { name: "admin-service" });
  return { plaintext_key, tenant_id };
}
