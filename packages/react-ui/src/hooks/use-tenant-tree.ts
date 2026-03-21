import { useState, useEffect, useCallback } from "react";
import type { TenantNode } from "@stratum-hq/core";
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
  // Persist expansion state across refreshes
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
      // Use current expandedIds to preserve state across refresh
      setTree((prev) => {
        // Collect currently expanded IDs from the existing tree
        const currentExpanded = new Set(expandedIds);
        return buildTree(nodes, currentExpanded);
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [apiCall, rootId, buildTree, expandedIds]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
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
