import pg from "pg";
import * as tenantService from "./services/tenant-service.js";
import * as configService from "./services/config-service.js";
import * as permissionService from "./services/permission-service.js";
import * as apiKeyService from "./services/api-key-service.js";
import type {
  TenantNode,
  CreateTenantInput,
  UpdateTenantInput,
  PaginationInput,
  PaginatedResult,
  ConfigEntry,
  SetConfigInput,
  ResolvedConfig,
  PermissionPolicy,
  CreatePermissionInput,
  UpdatePermissionInput,
  ResolvedPermission,
} from "@stratum/core";

export interface StratumOptions {
  pool: pg.Pool;
  keyPrefix?: string;
}

export class Stratum {
  private readonly pool: pg.Pool;
  private readonly keyPrefix: string;

  constructor(options: StratumOptions) {
    this.pool = options.pool;
    this.keyPrefix = options.keyPrefix ?? "sk_live_";
  }

  // Tenant operations
  createTenant(input: CreateTenantInput): Promise<TenantNode> {
    return tenantService.createTenant(this.pool, input);
  }
  getTenant(id: string, includeArchived?: boolean): Promise<TenantNode> {
    return tenantService.getTenant(this.pool, id, includeArchived);
  }
  listTenants(pagination: PaginationInput): Promise<PaginatedResult<TenantNode>> {
    return tenantService.listTenants(this.pool, pagination);
  }
  updateTenant(id: string, patch: UpdateTenantInput): Promise<TenantNode> {
    return tenantService.updateTenant(this.pool, id, patch);
  }
  deleteTenant(id: string): Promise<void> {
    return tenantService.deleteTenant(this.pool, id);
  }
  moveTenant(id: string, newParentId: string): Promise<TenantNode> {
    return tenantService.moveTenant(this.pool, id, newParentId);
  }
  getAncestors(id: string): Promise<TenantNode[]> {
    return tenantService.getAncestors(this.pool, id);
  }
  getDescendants(id: string): Promise<TenantNode[]> {
    return tenantService.getDescendants(this.pool, id);
  }
  getChildren(id: string): Promise<TenantNode[]> {
    return tenantService.getChildren(this.pool, id);
  }

  // Config operations
  resolveConfig(tenantId: string): Promise<ResolvedConfig> {
    return configService.resolveConfig(this.pool, tenantId);
  }
  setConfig(tenantId: string, key: string, input: SetConfigInput): Promise<ConfigEntry> {
    return configService.setConfig(this.pool, tenantId, key, input);
  }
  deleteConfig(tenantId: string, key: string): Promise<void> {
    return configService.deleteConfig(this.pool, tenantId, key);
  }
  getConfigWithInheritance(tenantId: string): Promise<ResolvedConfig> {
    return configService.getConfigWithInheritance(this.pool, tenantId);
  }

  // Permission operations
  resolvePermissions(tenantId: string): Promise<Record<string, ResolvedPermission>> {
    return permissionService.resolvePermissions(this.pool, tenantId);
  }
  createPermission(tenantId: string, input: CreatePermissionInput): Promise<PermissionPolicy> {
    return permissionService.createPermission(this.pool, tenantId, input);
  }
  updatePermission(tenantId: string, policyId: string, input: UpdatePermissionInput): Promise<PermissionPolicy> {
    return permissionService.updatePermission(this.pool, tenantId, policyId, input);
  }
  deletePermission(tenantId: string, policyId: string): Promise<void> {
    return permissionService.deletePermission(this.pool, tenantId, policyId);
  }

  // API Key operations
  createApiKey(tenantId: string, name?: string): Promise<apiKeyService.CreatedApiKey> {
    return apiKeyService.createApiKey(this.pool, this.keyPrefix, tenantId, name);
  }
  validateApiKey(key: string): Promise<{ tenant_id: string | null; key_id: string } | null> {
    return apiKeyService.validateApiKey(this.pool, key);
  }
  revokeApiKey(keyId: string): Promise<boolean> {
    return apiKeyService.revokeApiKey(this.pool, keyId);
  }
}
