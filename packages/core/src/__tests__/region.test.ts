import { describe, it, expect } from "vitest";
import { CreateRegionInputSchema, UpdateRegionInputSchema } from "../types/region.js";

describe("region control_plane_url", () => {
  const base = { display_name: "EU West", slug: "eu_west" };

  it("rejects a control_plane_url that carries credentials on create", () => {
    for (const url of [
      "https://user:pass@cp.example.test",
      "https://token@cp.example.test/api",
      "https://:pass@cp.example.test",
    ]) {
      expect(CreateRegionInputSchema.safeParse({ ...base, control_plane_url: url }).success).toBe(false);
    }
  });

  it("rejects a control_plane_url that carries credentials on update", () => {
    expect(
      UpdateRegionInputSchema.safeParse({ control_plane_url: "https://user:pass@cp.example.test" }).success,
    ).toBe(false);
  });

  it("rejects a control_plane_url that is not http or https", () => {
    for (const url of ["ftp://cp.example.test/api", "mailto:ops@example.test", "file:///etc/cp", "javascript:alert(1)"]) {
      expect(CreateRegionInputSchema.safeParse({ ...base, control_plane_url: url }).success).toBe(false);
      expect(UpdateRegionInputSchema.safeParse({ control_plane_url: url }).success).toBe(false);
    }
  });

  it("accepts a control_plane_url without credentials, and null on update", () => {
    expect(
      CreateRegionInputSchema.safeParse({ ...base, control_plane_url: "https://cp.example.test:8443/api" }).success,
    ).toBe(true);
    expect(UpdateRegionInputSchema.safeParse({ control_plane_url: "https://cp.example.test" }).success).toBe(true);
    expect(UpdateRegionInputSchema.safeParse({ control_plane_url: "http://cp.internal.example.test" }).success).toBe(true);
    expect(UpdateRegionInputSchema.safeParse({ control_plane_url: null }).success).toBe(true);
  });
});
