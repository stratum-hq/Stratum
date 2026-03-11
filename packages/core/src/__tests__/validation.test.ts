import { describe, it, expect } from "vitest";
import {
  SlugSchema,
  UUIDSchema,
  PaginationSchema,
  validateSlug,
} from "../utils/validation.js";

describe("validation schemas", () => {
  describe("SlugSchema", () => {
    it("accepts valid slugs", () => {
      // Must start with lowercase letter, only lowercase letters/numbers/underscores
      expect(SlugSchema.safeParse("acmesec").success).toBe(true);
      expect(SlugSchema.safeParse("northstar_msp").success).toBe(true);
      expect(SlugSchema.safeParse("client_alpha").success).toBe(true);
      expect(SlugSchema.safeParse("a").success).toBe(true); // single char minimum
      expect(SlugSchema.safeParse("a1").success).toBe(true);
    });

    it("rejects slugs that start with a number", () => {
      expect(SlugSchema.safeParse("1client").success).toBe(false);
    });

    it("rejects empty string", () => {
      expect(SlugSchema.safeParse("").success).toBe(false);
    });

    it("rejects slugs with spaces", () => {
      expect(SlugSchema.safeParse("has spaces").success).toBe(false);
    });

    it("rejects slugs with hyphens (ltree incompatible)", () => {
      expect(SlugSchema.safeParse("has-hyphens").success).toBe(false);
    });

    it("rejects uppercase letters", () => {
      expect(SlugSchema.safeParse("UPPERCASE").success).toBe(false);
      expect(SlugSchema.safeParse("MixedCase").success).toBe(false);
    });

    it("rejects slugs exceeding 63 characters", () => {
      // 64 chars: starts with 'a', followed by 63 more chars
      const tooLong = "a" + "b".repeat(63);
      expect(SlugSchema.safeParse(tooLong).success).toBe(false);
    });

    it("accepts slug at exactly 63 characters", () => {
      const maxLength = "a" + "b".repeat(62);
      expect(maxLength.length).toBe(63);
      expect(SlugSchema.safeParse(maxLength).success).toBe(true);
    });
  });

  describe("UUIDSchema", () => {
    it("accepts valid UUIDs", () => {
      expect(
        UUIDSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success,
      ).toBe(true);
    });

    it("rejects non-UUID strings", () => {
      expect(UUIDSchema.safeParse("not-a-uuid").success).toBe(false);
    });

    it("rejects empty string", () => {
      expect(UUIDSchema.safeParse("").success).toBe(false);
    });

    it("rejects UUID without hyphens", () => {
      expect(UUIDSchema.safeParse("550e8400e29b41d4a716446655440000").success).toBe(
        false,
      );
    });
  });

  describe("PaginationSchema", () => {
    it("accepts valid pagination with limit", () => {
      const result = PaginationSchema.safeParse({ limit: 20 });
      expect(result.success).toBe(true);
    });

    it("provides default limit of 50 when not specified", () => {
      const result = PaginationSchema.parse({});
      expect(result.limit).toBe(50);
    });

    it("accepts optional cursor as UUID", () => {
      const result = PaginationSchema.safeParse({
        cursor: "550e8400-e29b-41d4-a716-446655440000",
        limit: 10,
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-UUID cursor", () => {
      const result = PaginationSchema.safeParse({ cursor: "not-a-uuid" });
      expect(result.success).toBe(false);
    });

    it("rejects limit below 1", () => {
      expect(PaginationSchema.safeParse({ limit: 0 }).success).toBe(false);
    });

    it("rejects limit above 100", () => {
      expect(PaginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it("coerces string limit to number", () => {
      const result = PaginationSchema.safeParse({ limit: "25" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(25);
      }
    });
  });

  describe("validateSlug helper", () => {
    it("returns true for valid slug", () => {
      expect(validateSlug("acme")).toBe(true);
    });

    it("returns false for invalid slug", () => {
      expect(validateSlug("INVALID")).toBe(false);
      expect(validateSlug("has-hyphens")).toBe(false);
    });
  });
});
