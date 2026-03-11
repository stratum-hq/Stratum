import { useTenantTree, type TenantTreeNode } from "../../hooks/use-tenant-tree.js";
import { useTenant } from "../../hooks/use-tenant.js";

export interface HeadlessTenantTreeAPI {
  tree: TenantTreeNode[];
  selectedId: string | null;
  loading: boolean;
  error: Error | null;
  toggleExpand: (nodeId: string) => void;
  refresh: () => Promise<void>;
  getNodeProps: (node: TenantTreeNode) => {
    role: "treeitem";
    "aria-expanded": boolean | undefined;
    tabIndex: number;
  };
}

export interface HeadlessTenantTreeProps {
  rootId?: string;
  children: (api: HeadlessTenantTreeAPI) => React.ReactNode;
}

export function HeadlessTenantTree({ rootId, children }: HeadlessTenantTreeProps) {
  const { tree, loading, error, toggleExpand, refresh } = useTenantTree(rootId);
  const { tenant } = useTenant();

  const api: HeadlessTenantTreeAPI = {
    tree,
    selectedId: tenant?.id || null,
    loading,
    error,
    toggleExpand,
    refresh,
    getNodeProps: (node: TenantTreeNode) => ({
      role: "treeitem" as const,
      "aria-expanded": node.children.length > 0 ? node.expanded : undefined,
      tabIndex: 0,
    }),
  };

  return <>{children(api)}</>;
}
