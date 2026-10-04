import type { PermissionWithSource } from "../../hooks/use-permissions.js";
import { usePermissions } from "../../hooks/use-permissions.js";

export interface HeadlessPermissionEditorAPI {
  permissions: PermissionWithSource[];
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
