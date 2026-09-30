/**
 * Returns true when an ISO 8601 datetime string has a year that PostgreSQL
 * TIMESTAMPTZ accepts.
 *
 * ISO 8601 year 0000 is 1 BC. PostgreSQL has no year zero and rejects it with
 * "date/time field value out of range", so the schema must reject it first.
 * Use this after a `z.string().datetime()` check, which fixes the year format.
 */
export function hasTimestamptzYear(value: string): boolean {
  return !value.startsWith("0000-");
}

export const TIMESTAMPTZ_YEAR_MESSAGE = "Year 0000 is not a valid timestamp";
