import { vi } from "vitest";

// A fake control plane for component tests. It answers the routes the demo and
// @stratum-hq/react call, and records every request so a test can assert what
// was sent and what was not.

const now = "2026-10-01T12:00:00.000Z";

function tenant(id: string, parentId: string | null, depth: number, name: string, slug: string) {
  return {
    id,
    parent_id: parentId,
    ancestry_path: "",
    depth,
    name,
    slug,
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    region_id: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

export const ROOT_ID = "11111111-1111-4111-8111-111111111111";
export const MSP_ID = "22222222-2222-4222-8222-222222222222";
export const ACTIVE_KEY_ID = "9f3c2a71-0000-4000-8000-000000000001";

const tenants = [
  tenant(ROOT_ID, null, 0, "AcmeSec", "acmesec"),
  tenant(MSP_ID, ROOT_ID, 1, "NorthStar MSP", "northstar_msp"),
];

function config(tenantId: string) {
  return {
    max_users: { key: "max_users", value: 1000, source_tenant_id: ROOT_ID, inherited: tenantId !== ROOT_ID, locked: false },
    data_region: { key: "data_region", value: "eu-west-1", source_tenant_id: ROOT_ID, inherited: tenantId !== ROOT_ID, locked: true },
    siem_enabled: { key: "siem_enabled", value: true, source_tenant_id: tenantId, inherited: false, locked: false },
  };
}

function permissions(tenantId: string) {
  return {
    manage_users: { policy_id: "p1", key: "manage_users", value: true, mode: "LOCKED", source_tenant_id: ROOT_ID, locked: true, delegated: false },
    custom_reports: { policy_id: "p2", key: "custom_reports", value: true, mode: "DELEGATED", source_tenant_id: tenantId, locked: false, delegated: true },
  };
}

const apiKeys = [
  { id: ACTIVE_KEY_ID, tenant_id: MSP_ID, name: "siem-ingest", created_at: now, last_used_at: null, revoked_at: null, expires_at: null },
  { id: "7b1d44e0-0000-4000-8000-000000000002", tenant_id: MSP_ID, name: "old-exporter", created_at: now, last_used_at: null, revoked_at: now, expires_at: null },
];

const webhooks = [
  { id: "w1", tenant_id: MSP_ID, url: "https://hooks.example.com/stratum", events: ["tenant.created"], active: true, secret: "x", created_at: now },
];

const auditLogs = [
  {
    id: "a1",
    action: "config.updated",
    resource_type: "config",
    resource_id: "5e0c9d12-0000-4000-8000-000000000003",
    actor_id: "admin@acme.test",
    actor_type: "user",
    tenant_id: MSP_ID,
    created_at: now,
  },
];

export interface RecordedCall {
  method: string;
  path: string;
}

function route(method: string, path: string): unknown {
  if (method !== "GET") return {};
  if (path === "/api/v1/tenants") return tenants;
  if (path.startsWith("/api/events/")) return [];
  if (path === "/api/v1/api-keys") return apiKeys;
  if (path === "/api/v1/webhooks") return webhooks;
  if (path === "/api/v1/audit-logs") return auditLogs;
  const match = path.match(/^\/api\/v1\/tenants\/([^/]+)(\/.*)?$/);
  if (!match) return {};
  const [, id, rest = ""] = match;
  if (rest === "") return tenants.find((t) => t.id === id);
  if (rest === "/ancestors") return id === MSP_ID ? [tenants[0]] : [];
  if (rest === "/config") return config(id);
  if (rest === "/permissions") return permissions(id);
  if (rest === "/context") return { resolved_config: config(id), resolved_permissions: permissions(id) };
  return {};
}

/** Replace fetch with the fake control plane and return the list of requests it receives. */
export function installApiMock(): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://demo.test");
      const method = init?.method ?? "GET";
      calls.push({ method, path: url.pathname });
      return new Response(JSON.stringify(route(method, url.pathname)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}
