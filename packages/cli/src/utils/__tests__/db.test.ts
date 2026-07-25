import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConnectionString } from "../db.js";

const DEFAULT = "postgres://stratum_app:stratum_dev@localhost:5432/stratum";

describe("getConnectionString", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedEnv;
    }
  });

  it("returns the --database-url flag when provided", () => {
    expect(getConnectionString({ "database-url": "postgres://flag" })).toBe("postgres://flag");
  });

  it("returns the -d flag when provided", () => {
    expect(getConnectionString({ d: "postgres://short" })).toBe("postgres://short");
  });

  it("prefers the flag over DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgres://env";
    expect(getConnectionString({ "database-url": "postgres://flag" })).toBe("postgres://flag");
  });

  it("falls back to DATABASE_URL when no flag is given", () => {
    process.env.DATABASE_URL = "postgres://env";
    expect(getConnectionString({})).toBe("postgres://env");
  });

  it("returns the built-in default when neither flag nor env is set", () => {
    expect(getConnectionString({})).toBe(DEFAULT);
  });

  it("ignores a valueless (boolean) flag and falls through", () => {
    process.env.DATABASE_URL = "postgres://env";
    // `--database-url` with no value parses to boolean true, which is not a string
    expect(getConnectionString({ "database-url": true })).toBe("postgres://env");
  });
});
