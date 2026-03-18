import type { ResolvedPermission } from "@stratum-hq/core";
import { usePermissions } from "../../hooks/use-permissions.js";

export interface HeadlessPermissionEditorAPI {
  permissions: ResolvedPermission[];
  loading: boolean;
  error: Error | null;
  createPermission: (key: string, value: unknown, mode: string, revocationMode: string) => Promise<void>;
  deletePermission: (policyId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface HeadlessPermissionEditorProps {
  children: (api: HeadlessPermissionEditorAPI) => React.ReactNode;
}

export function HeadlessPermissionEditor({ children }: HeadlessPermissionEditorProps) {
  const { permissions, loading, error, createPermission, deletePermission, refresh } = usePermissions();

  return <>{children({ permissions, loading, error, createPermission, deletePermission, refresh })}</>;
}
