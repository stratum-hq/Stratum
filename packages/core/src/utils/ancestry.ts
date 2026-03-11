/**
 * Ancestry path utilities for materialized path pattern.
 * Format: "/uuid1/uuid2/uuid3" (leading slash, UUID segments)
 */

/**
 * Parse an ancestry path into an array of IDs.
 * parseAncestryPath("/a/b/c") => ["a", "b", "c"]
 */
export function parseAncestryPath(path: string): string[] {
  if (!path || path === "/") return [];
  return path.split("/").filter(Boolean);
}

/**
 * Build an ancestry path from an array of IDs.
 * buildAncestryPath(["a", "b", "c"]) => "/a/b/c"
 */
export function buildAncestryPath(ids: string[]): string {
  if (ids.length === 0) return "/";
  return "/" + ids.join("/");
}

/**
 * Get the depth (number of segments) of an ancestry path.
 * getDepth("/a/b/c") => 3
 */
export function getDepth(path: string): number {
  return parseAncestryPath(path).length;
}

/**
 * Check if ancestorPath is an ancestor of descendantPath.
 * isAncestorOf("/a/b", "/a/b/c") => true
 * isAncestorOf("/a/b/c", "/a/b") => false
 * isAncestorOf("/a/b", "/a/b") => false (not ancestor of self)
 */
export function isAncestorOf(
  ancestorPath: string,
  descendantPath: string,
): boolean {
  if (ancestorPath === descendantPath) return false;
  const normalizedAncestor = ancestorPath.endsWith("/")
    ? ancestorPath
    : ancestorPath + "/";
  return descendantPath.startsWith(normalizedAncestor);
}

/**
 * Check if a path is a descendant of another path.
 */
export function isDescendantOf(
  descendantPath: string,
  ancestorPath: string,
): boolean {
  return isAncestorOf(ancestorPath, descendantPath);
}

/**
 * Get the parent path from an ancestry path.
 * getParentPath("/a/b/c") => "/a/b"
 * getParentPath("/a") => "/"
 * getParentPath("/") => null
 */
export function getParentPath(path: string): string | null {
  const ids = parseAncestryPath(path);
  if (ids.length === 0) return null;
  if (ids.length === 1) return "/";
  return buildAncestryPath(ids.slice(0, -1));
}

/**
 * Append a child ID to a parent ancestry path.
 * appendToPath("/a/b", "c") => "/a/b/c"
 */
export function appendToPath(parentPath: string, childId: string): string {
  const ids = parseAncestryPath(parentPath);
  return buildAncestryPath([...ids, childId]);
}

/**
 * Get all ancestor IDs from an ancestry path (excluding self).
 * getAncestorIds("/a/b/c") => ["a", "b"] (excludes "c")
 */
export function getAncestorIds(path: string): string[] {
  const ids = parseAncestryPath(path);
  return ids.slice(0, -1);
}

/**
 * Get the leaf (self) ID from an ancestry path.
 * getSelfId("/a/b/c") => "c"
 */
export function getSelfId(path: string): string | null {
  const ids = parseAncestryPath(path);
  return ids.length > 0 ? ids[ids.length - 1] : null;
}
