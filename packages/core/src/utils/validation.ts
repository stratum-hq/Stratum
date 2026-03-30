import { z } from "zod";

/** Canonical slug regex: starts with lowercase letter, only lowercase alphanumeric + underscore, max 63 chars. */
export const SLUG_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

export const SlugSchema = z
  .string()
  .regex(SLUG_REGEX, {
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

/**
 * Validates a tenant slug. Returns the slug if valid, throws if invalid.
 * Use `isValidSlug()` for a non-throwing boolean check.
 */
export function validateSlug(slug: string): string {
  if (!SLUG_REGEX.test(slug)) {
    throw new Error(
      `Invalid tenant slug: "${slug}". Slugs must start with a lowercase letter and contain only lowercase alphanumeric characters and underscores (max 63 chars).`,
    );
  }
  return slug;
}

/** Returns true if the slug matches the canonical slug pattern. */
export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}
