// Type test: documented library calls must compile under `tsc --strict`.
// `npm run typecheck` compiles this file through tsconfig.types.json. It never runs.
//
// The examples come from website/src/content/docs/packages/lib.mdx,
// website/src/content/docs/guides/webhooks.mdx and
// packages/control-plane/README.md. When you change an example there, change
// it here too.

import { Pool } from "pg";
import type { AuditContext } from "@stratum-hq/core";
import { Stratum, migrate, verifyWebhookSignature } from "@stratum-hq/lib";

declare const stratum: Stratum;
declare const adminPool: Pool;
declare const pool: Pool;
declare const payload: string;
declare const webhookSecret: string;
declare const signatureHeader: string | undefined;
declare const timestampHeader: string | undefined;

// lib.mdx: the `audit` argument
export async function libAuditArgument() {
  const audit: AuditContext = {
    actor_id: "user-123",     // required: who made the change
    actor_type: "jwt",        // required: "api_key" | "jwt" | "system"
    source_ip: "203.0.113.7", // optional
    request_id: "req-42",     // optional
  };
  await stratum.createTenant({ name: "Acme Corp", slug: "acme" }, audit);
}

// lib.mdx: recordAuditEvent with only the required fields
export async function libRecordAuditEventRequired() {
  return stratum.recordAuditEvent({
    tenantId: "00000000-0000-0000-0000-000000000001",
    actorId: "user-123",
    action: "invoice.sent",
    resourceType: "invoice",
    resourceId: null,
  });
}

// lib.mdx: Prerequisites
export async function libPrerequisites() {
  // Option 1: run the migrations when the instance initializes
  const stratum = new Stratum({ adminPool, pool, autoMigrate: true });
  await stratum.initialize();

  // Option 2: run them as a deploy step, on the admin login
  await migrate({ pool: adminPool });
}

// guides/webhooks.mdx: verifying a delivery
export function webhookVerify() {
  return verifyWebhookSignature({
    secret: webhookSecret,
    payload,
    signature: signatureHeader ?? "",
    timestamp: timestampHeader ?? "",
  });
}

// control-plane README: the first admin key
export async function controlPlaneFirstAdminKey() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const stratum = new Stratum({ adminPool, pool });
  await stratum.initialize();

  // A global key (tenant null) with a role that grants the admin scope.
  const role = await stratum.createRole({ name: "operator", scopes: ["admin"] });
  const key = await stratum.createApiKey(null, { name: "bootstrap-admin" });
  await stratum.assignRoleToKey(key.id, role.id);
  console.log(key.plaintext_key); // shown once: store it now

  await Promise.all([pool.end(), adminPool.end()]);
}
