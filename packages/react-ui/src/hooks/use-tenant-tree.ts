import { useState, useEffect, useCallback, useRef } from "react";
import type { TenantNode } from "@stratum-hq/core";
import { useStratum } from "../provider.js";

export interface TenantTreeNode extends TenantNode {
  children: TenantTreeNode[];
  expanded: boolean;
}

/**
 * Collect all expanded node IDs from a tree (recursive).
 */
function collectExpandedIds(nodes: TenantTreeNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: TenantTreeNode[]) {
    for (const n of list) {
      if (n.expanded) ids.add(n.id);
      walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

export function useTenantTree(rootId?: string) {
  const { apiCall } = useStratum();
  const [tree, setTree] = useState<TenantTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Use a ref to track expanded IDs — avoids stale closures and
  // doesn't trigger re-renders or effect re-runs
  const expandedRef = useRef<Set<string>>(new Set());

  const buildTree = useCallback((nodes: TenantNode[], expanded: Set<string>): TenantTreeNode[] => {
    const map = new Map<string | null, TenantTreeNode[]>();

    for (const node of nodes) {
      const treeNode: TenantTreeNode = { ...node, children: [], expanded: expanded.has(node.id) };
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
      const res = await apiCall<TenantNode[] | { data: TenantNode[] }>(path);
      const nodes = Array.isArray(res) ? res : res.data;
      // Read current expanded state from the ref (never stale)
      const newTree = buildTree(nodes, expandedRef.current);
      setTree(newTree);
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
    // Update the ref
    const next = new Set(expandedRef.current);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    expandedRef.current = next;

    // Update tree state
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
