/**
 * Shared mock data and decorator for Storybook stories.
 *
 * All styled components depend on StratumProvider context via useStratum().
 * This module provides a MockStratumProvider that injects controlled data
 * into the real StratumContext so all hooks work without a live API.
 */
import React, { useState, useCallback, type ReactNode } from "react";
import type { TenantNode } from "@stratum-hq/core";
import { StratumContext, type StratumContextValue } from "../provider.js";

// ---------------------------------------------------------------------------
// Mock Tenant Data
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

export const mockTenants: TenantNode[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    parent_id: null,
    ancestry_path: "/",
    depth: 0,
    name: "Acme Corp",
    slug: "acme_corp",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    parent_id: "00000000-0000-0000-0000-000000000001",
    ancestry_path: "/acme_corp",
    depth: 1,
    name: "Acme MSSP",
    slug: "acme_mssp",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    parent_id: "00000000-0000-0000-0000-000000000002",
    ancestry_path: "/acme_corp/acme_mssp",
    depth: 2,
    name: "CyberShield MSP",
    slug: "cybershield_msp",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    parent_id: "00000000-0000-0000-0000-000000000003",
    ancestry_path: "/acme_corp/acme_mssp/cybershield_msp",
    depth: 3,
    name: "Globex Industries",
    slug: "globex_industries",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "00000000-0000-0000-0000-000000000005",
    parent_id: "00000000-0000-0000-0000-000000000002",
    ancestry_path: "/acme_corp/acme_mssp",
    depth: 2,
    name: "Northwind Security",
    slug: "northwind_security",
    config: {},
    metadata: {},
    isolation_strategy: "SCHEMA_PER_TENANT",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "00000000-0000-0000-0000-000000000006",
    parent_id: "00000000-0000-0000-0000-000000000001",
    ancestry_path: "/acme_corp",
    depth: 1,
    name: "Acme Direct",
    slug: "acme_direct",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "00000000-0000-0000-0000-000000000007",
    parent_id: "00000000-0000-0000-0000-000000000006",
    ancestry_path: "/acme_corp/acme_direct",
    depth: 2,
    name: "Wayne Enterprises",
    slug: "wayne_enterprises",
    config: {},
    metadata: {},
    isolation_strategy: "DB_PER_TENANT",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "00000000-0000-0000-0000-000000000008",
    parent_id: "00000000-0000-0000-0000-000000000003",
    ancestry_path: "/acme_corp/acme_mssp/cybershield_msp",
    depth: 3,
    name: "Initech LLC",
    slug: "initech_llc",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "archived",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
];

/** Generate a large list of tenants for stress-testing. */
export function generateManyTenants(count: number): TenantNode[] {
  const base = [...mockTenants];
  for (let i = 9; i <= count; i++) {
    const parentIdx = Math.floor(Math.random() * Math.min(i - 1, 6)) + 1;
    const parentId = `00000000-0000-0000-0000-${String(parentIdx).padStart(12, "0")}`;
    base.push({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      parent_id: parentId,
      ancestry_path: "/generated",
      depth: 2,
      name: `Tenant ${i}`,
      slug: `tenant_${i}`,
      config: {},
      metadata: {},
      isolation_strategy: "SHARED_RLS",
      status: "active",
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
  }
  return base;
}

// Deep hierarchy (5 levels)
export const deepHierarchyTenants: TenantNode[] = [
  {
    id: "d0000000-0000-0000-0000-000000000001",
    parent_id: null,
    ancestry_path: "/",
    depth: 0,
    name: "Global Platform",
    slug: "global_platform",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "d0000000-0000-0000-0000-000000000002",
    parent_id: "d0000000-0000-0000-0000-000000000001",
    ancestry_path: "/global_platform",
    depth: 1,
    name: "North America Region",
    slug: "na_region",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "d0000000-0000-0000-0000-000000000003",
    parent_id: "d0000000-0000-0000-0000-000000000002",
    ancestry_path: "/global_platform/na_region",
    depth: 2,
    name: "SecureNet MSSP",
    slug: "securenet_mssp",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "d0000000-0000-0000-0000-000000000004",
    parent_id: "d0000000-0000-0000-0000-000000000003",
    ancestry_path: "/global_platform/na_region/securenet_mssp",
    depth: 3,
    name: "Metro MSP Group",
    slug: "metro_msp",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
  {
    id: "d0000000-0000-0000-0000-000000000005",
    parent_id: "d0000000-0000-0000-0000-000000000004",
    ancestry_path: "/global_platform/na_region/securenet_mssp/metro_msp",
    depth: 4,
    name: "Downtown Office Client",
    slug: "downtown_client",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
];

// Single root node
export const singleRootTenant: TenantNode[] = [
  {
    id: "s0000000-0000-0000-0000-000000000001",
    parent_id: null,
    ancestry_path: "/",
    depth: 0,
    name: "Standalone Tenant",
    slug: "standalone",
    config: {},
    metadata: {},
    isolation_strategy: "DB_PER_TENANT",
    status: "active",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  },
];

// ---------------------------------------------------------------------------
// Mock Config Data
// ---------------------------------------------------------------------------

export const mockConfigEntries = [
  {
    key: "app.theme",
    value: "dark",
    source_tenant_id: "00000000-0000-0000-0000-000000000001",
    inherited: true,
    locked: false,
  },
  {
    key: "feature.sso_enabled",
    value: true,
    source_tenant_id: "00000000-0000-0000-0000-000000000001",
    inherited: true,
    locked: true,
  },
  {
    key: "billing.plan",
    value: "enterprise",
    source_tenant_id: "00000000-0000-0000-0000-000000000003",
    inherited: false,
    locked: false,
  },
  {
    key: "security.mfa_required",
    value: true,
    source_tenant_id: "00000000-0000-0000-0000-000000000001",
    inherited: true,
    locked: true,
  },
  {
    key: "notifications.email_digest",
    value: "weekly",
    source_tenant_id: "00000000-0000-0000-0000-000000000003",
    inherited: false,
    locked: false,
  },
  {
    key: "api.rate_limit",
    value: 1000,
    source_tenant_id: "00000000-0000-0000-0000-000000000002",
    inherited: true,
    locked: false,
  },
  {
    key: "storage.max_upload_mb",
    value: 50,
    source_tenant_id: "00000000-0000-0000-0000-000000000003",
    inherited: false,
    locked: false,
  },
];

export const mockSensitiveConfigEntries = [
  ...mockConfigEntries,
  {
    key: "integrations.slack_webhook_url",
    value: "https://hooks.slack.com/services/T00000/B00000/XXXX",
    source_tenant_id: "00000000-0000-0000-0000-000000000003",
    inherited: false,
    locked: false,
  },
  {
    key: "integrations.stripe_secret_key",
    value: "sk_live_51Abc...redacted",
    source_tenant_id: "00000000-0000-0000-0000-000000000001",
    inherited: true,
    locked: true,
  },
];

export const mockLockedConfigEntries = mockConfigEntries.map((entry) => ({
  ...entry,
  locked: true,
  inherited: true,
  source_tenant_id: "00000000-0000-0000-0000-000000000001",
}));

// ---------------------------------------------------------------------------
// Mock Permission Data
// ---------------------------------------------------------------------------

export const mockPermissions = [
  {
    policy_id: "pol-001",
    key: "tenant.manage",
    value: true,
    mode: "LOCKED",
    source_tenant_id: "00000000-0000-0000-0000-000000000001",
    locked: true,
    delegated: false,
  },
  {
    policy_id: "pol-002",
    key: "config.write",
    value: true,
    mode: "INHERITED",
    source_tenant_id: "00000000-0000-0000-0000-000000000002",
    locked: false,
    delegated: false,
  },
  {
    policy_id: "pol-003",
    key: "billing.view",
    value: true,
    mode: "DELEGATED",
    source_tenant_id: "00000000-0000-0000-0000-000000000003",
    locked: false,
    delegated: true,
  },
  {
    policy_id: "pol-004",
    key: "users.invite",
    value: true,
    mode: "INHERITED",
    source_tenant_id: "00000000-0000-0000-0000-000000000001",
    locked: false,
    delegated: false,
  },
  {
    policy_id: "pol-005",
    key: "audit.read",
    value: true,
    mode: "LOCKED",
    source_tenant_id: "00000000-0000-0000-0000-000000000001",
    locked: true,
    delegated: false,
  },
  {
    policy_id: "pol-006",
    key: "webhooks.manage",
    value: true,
    mode: "DELEGATED",
    source_tenant_id: "00000000-0000-0000-0000-000000000003",
    locked: false,
    delegated: true,
  },
];

// ---------------------------------------------------------------------------
// Mock Provider — injects controlled data into the real StratumContext
// ---------------------------------------------------------------------------

interface MockStratumProviderProps {
  tenants?: TenantNode[];
  configEntries?: typeof mockConfigEntries;
  permissions?: typeof mockPermissions;
  initialTenantId?: string;
  loading?: boolean;
  children: ReactNode;
}

/**
 * Wraps children with the real StratumContext populated by mock data.
 * All real hooks (useTenant, useTenantTree, useConfig, usePermissions)
 * will read from this context and receive controlled responses via apiCall.
 */
export function MockStratumProvider({
  tenants = mockTenants,
  configEntries = mockConfigEntries,
  permissions = mockPermissions,
  initialTenantId,
  loading: forceLoading = false,
  children,
}: MockStratumProviderProps) {
  const [currentTenant, setCurrentTenant] = useState<TenantNode | null>(
    initialTenantId
      ? tenants.find((t) => t.id === initialTenantId) ?? null
      : tenants[0] ?? null,
  );
  const [loading, setLoading] = useState(forceLoading);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      setLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const found = tenants.find((t) => t.id === tenantId);
      if (found) setCurrentTenant(found);
      setLoading(false);
    },
    [tenants],
  );

  const apiCall = useCallback(
    async <T,>(path: string, _options?: RequestInit): Promise<T> => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      // GET /api/v1/tenants
      if (path === "/api/v1/tenants") {
        return { data: tenants } as T;
      }
      // GET /api/v1/tenants/:id/descendants
      if (path.match(/\/api\/v1\/tenants\/[^/]+\/descendants/)) {
        return tenants as unknown as T;
      }
      // GET /api/v1/tenants/:id/config (not config/:key)
      if (path.match(/\/api\/v1\/tenants\/[^/]+\/config$/)) {
        const configMap: Record<string, unknown> = {};
        for (const entry of configEntries) {
          configMap[entry.key] = entry;
        }
        return configMap as T;
      }
      // PUT/DELETE config operations
      if (path.match(/\/api\/v1\/tenants\/[^/]+\/config\//)) {
        return {} as T;
      }
      // GET /api/v1/tenants/:id/permissions
      if (path.match(/\/api\/v1\/tenants\/[^/]+\/permissions$/)) {
        const permMap: Record<string, unknown> = {};
        for (const perm of permissions) {
          permMap[perm.key] = perm;
        }
        return permMap as T;
      }
      // POST/DELETE permission operations
      if (path.match(/\/api\/v1\/tenants\/[^/]+\/permissions\//)) {
        return {} as T;
      }
      // GET /api/v1/tenants/:id
      if (path.match(/\/api\/v1\/tenants\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const tenant = tenants.find((t) => t.id === id);
        if (tenant) return tenant as T;
        throw new Error("Tenant not found");
      }
      return {} as T;
    },
    [tenants, configEntries, permissions],
  );

  const noopToast = {
    success: (_msg: string) => "",
    error: (_msg: string) => "",
    warning: (_msg: string) => "",
    info: (_msg: string) => "",
  };

  const value: StratumContextValue = {
    currentTenant,
    tenantContext: null,
    loading,
    error: null,
    switchTenant,
    apiCall,
    messages: {},
    toast: noopToast,
  };

  return (
    <StratumContext.Provider value={value}>
      {children}
    </StratumContext.Provider>
  );
}
