import { z } from "zod";

export const RegionStatus = {
  ACTIVE: "active",
  DRAINING: "draining",
  INACTIVE: "inactive",
} as const;

export const RegionSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1),
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  control_plane_url: z.string().url().nullable(),
  database_url: z.string().nullable(), // Only used at runtime, never exposed via API
  is_primary: z.boolean().default(false),
  status: z.enum(["active", "draining", "inactive"]).default("active"),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Region = z.infer<typeof RegionSchema>;

export const CreateRegionInputSchema = z.object({
  display_name: z.string().min(1),
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  control_plane_url: z.string().url().optional(),
  is_primary: z.boolean().optional(),
  status: z.enum(["active", "draining", "inactive"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateRegionInput = z.infer<typeof CreateRegionInputSchema>;

export const UpdateRegionInputSchema = z.object({
  display_name: z.string().min(1).optional(),
  control_plane_url: z.string().url().nullable().optional(),
  status: z.enum(["active", "draining", "inactive"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateRegionInput = z.infer<typeof UpdateRegionInputSchema>;
