import { useState, useEffect, useCallback } from "react";
import type { TenantNode } from "@stratum/core";
import { useStratum } from "../provider.js";

export interface TenantTreeNode extends TenantNode {
  children: TenantTreeNode[];
  expanded: boolean;
}

export function useTenantTree(rootId?: string) {
  const { apiCall } = useStratum();
  const [tree, setTree] = useState<TenantTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const buildTree = useCallback((nodes: TenantNode[]): TenantTreeNode[] => {
    const map = new Map<string | null, TenantTreeNode[]>();

    for (const node of nodes) {
      const treeNode: TenantTreeNode = { ...node, children: [], expanded: false };
      const parentKey = node.parent_id;
      if (!map.has(parentKey)) map.set(parentKey, []);
      map.get(parentKey)!.push(treeNode);
    }

    function attachChildren(parent: TenantTreeNode): void {
      const children = map.get(parent.id) || [];
      parent.children = children;
      for (const child of children) {
        attachChildren(child);
      }
    }

    const roots = map.get(rootId || null) || [];
    for (const root of roots) {
      attachChildren(root);
    }
    return roots;
  }, [rootId]);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = rootId
        ? `/api/v1/tenants/${rootId}/descendants`
        : `/api/v1/tenants`;
      const nodes = await apiCall<TenantNode[]>(path);
      setTree(buildTree(nodes));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [apiCall, rootId, buildTree]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const toggleExpand = useCallback((nodeId: string) => {
    setTree((prev) => {
      function toggle(nodes: TenantTreeNode[]): TenantTreeNode[] {
        return nodes.map((n) => {
          if (n.id === nodeId) return { ...n, expanded: !n.expanded };
          return { ...n, children: toggle(n.children) };
        });
      }
      return toggle(prev);
    });
  }, []);

  return { tree, loading, error, refresh: fetchTree, toggleExpand };
}
