import { z } from "zod";

export const SlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,62}$/, {
    message:
      "Slug must start with a lowercase letter, contain only lowercase letters, numbers, and underscores, and be at most 63 characters",
  });

export const UUIDSchema = z.string().uuid();

export const PaginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;

export interface PaginatedResult<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export function validateSlug(slug: string): boolean {
  return SlugSchema.safeParse(slug).success;
}
