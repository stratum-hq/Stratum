import { describe, it, expect } from "vitest";
import {
  parseAncestryPath,
  buildAncestryPath,
  getDepth,
  isAncestorOf,
  isDescendantOf,
  getParentPath,
  appendToPath,
  getAncestorIds,
  getSelfId,
} from "../utils/ancestry.js";

describe("ancestry utilities", () => {
  const rootId = "aaaa-bbbb-cccc-dddd";
  const childId = "eeee-ffff-gggg-hhhh";
  const grandchildId = "iiii-jjjj-kkkk-llll";

  // Paths use leading slash: "/id", "/id/id", "/id/id/id"
  const rootPath = `/${rootId}`;
  const childPath = `/${rootId}/${childId}`;
  const grandchildPath = `/${rootId}/${childId}/${grandchildId}`;

  describe("parseAncestryPath", () => {
    it("parses root path", () => {
      expect(parseAncestryPath(rootPath)).toEqual([rootId]);
    });

    it("parses nested path", () => {
      expect(parseAncestryPath(grandchildPath)).toEqual([
        rootId,
        childId,
        grandchildId,
      ]);
    });

    it("parses empty / root as empty array", () => {
      expect(parseAncestryPath("/")).toEqual([]);
    });
  });

  describe("buildAncestryPath", () => {
    it("builds path from array", () => {
      expect(buildAncestryPath([rootId, childId])).toBe(childPath);
    });

    it("builds root path from single id", () => {
      expect(buildAncestryPath([rootId])).toBe(rootPath);
    });

    it("builds / from empty array", () => {
      expect(buildAncestryPath([])).toBe("/");
    });
  });

  describe("getDepth", () => {
    it("root is depth 1 (one segment)", () => {
      expect(getDepth(rootPath)).toBe(1);
    });

    it("child is depth 2", () => {
      expect(getDepth(childPath)).toBe(2);
    });

    it("grandchild is depth 3", () => {
      expect(getDepth(grandchildPath)).toBe(3);
    });

    it("bare / is depth 0", () => {
      expect(getDepth("/")).toBe(0);
    });
  });

  describe("isAncestorOf", () => {
    it("root is ancestor of child", () => {
      expect(isAncestorOf(rootPath, childPath)).toBe(true);
    });

    it("root is ancestor of grandchild", () => {
      expect(isAncestorOf(rootPath, grandchildPath)).toBe(true);
    });

    it("child is ancestor of grandchild", () => {
      expect(isAncestorOf(childPath, grandchildPath)).toBe(true);
    });

    it("child is not ancestor of root", () => {
      expect(isAncestorOf(childPath, rootPath)).toBe(false);
    });

    it("node is not ancestor of itself", () => {
      expect(isAncestorOf(childPath, childPath)).toBe(false);
    });
  });

  describe("isDescendantOf", () => {
    it("child is descendant of root", () => {
      expect(isDescendantOf(childPath, rootPath)).toBe(true);
    });

    it("grandchild is descendant of root", () => {
      expect(isDescendantOf(grandchildPath, rootPath)).toBe(true);
    });

    it("root is not descendant of child", () => {
      expect(isDescendantOf(rootPath, childPath)).toBe(false);
    });

    it("node is not descendant of itself", () => {
      expect(isDescendantOf(childPath, childPath)).toBe(false);
    });
  });

  describe("getParentPath", () => {
    it("root node parent is /", () => {
      expect(getParentPath(rootPath)).toBe("/");
    });

    it("bare / has no parent (null)", () => {
      expect(getParentPath("/")).toBeNull();
    });

    it("child parent is root path", () => {
      expect(getParentPath(childPath)).toBe(rootPath);
    });

    it("grandchild parent is child path", () => {
      expect(getParentPath(grandchildPath)).toBe(childPath);
    });
  });

  describe("appendToPath", () => {
    it("appends child id to root path", () => {
      expect(appendToPath(rootPath, childId)).toBe(childPath);
    });

    it("appends grandchild id to child path", () => {
      expect(appendToPath(childPath, grandchildId)).toBe(grandchildPath);
    });
  });

  // Ancestry paths as stored by tenant-service EXCLUDE the tenant's own id:
  // a root tenant has "/", its child has "/rootId", a grandchild has
  // "/rootId/childId" (see createTenant: appendToPath(parent.path, parent.id)).
  describe("getAncestorIds", () => {
    it("root tenant (path '/') has no ancestors", () => {
      expect(getAncestorIds("/")).toEqual([]);
    });

    it("child of root (path '/rootId') has ancestors [rootId]", () => {
      expect(getAncestorIds(`/${rootId}`)).toEqual([rootId]);
    });

    it("grandchild (path '/rootId/childId') has ancestors [rootId, childId]", () => {
      expect(getAncestorIds(`/${rootId}/${childId}`)).toEqual([rootId, childId]);
    });
  });

  describe("getSelfId", () => {
    it("returns the direct parent id for a child of root", () => {
      expect(getSelfId(`/${rootId}`)).toBe(rootId);
    });

    it("returns the direct parent id for a grandchild", () => {
      expect(getSelfId(`/${rootId}/${childId}`)).toBe(childId);
    });

    it("returns null for a root tenant path", () => {
      expect(getSelfId("/")).toBeNull();
    });
  });
});
