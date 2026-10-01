import { describe, it, expect, afterEach, vi } from "vitest";
import { usesDefaultDatabaseUrl, playground } from "../playground.js";
import { DEFAULT_DATABASE_URL, getConnectionString } from "../../utils/db.js";
import * as log from "../../utils/log.js";

vi.mock("../../utils/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/db.js")>();
  return {
    ...actual,
    connectDb: vi.fn(async () => {
      throw new Error("no database in unit tests");
    }),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("usesDefaultDatabaseUrl", () => {
  it("is true when no flag and no DATABASE_URL is given", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(getConnectionString({})).toBe(DEFAULT_DATABASE_URL);
    expect(usesDefaultDatabaseUrl({})).toBe(true);
  });

  it("is false with DATABASE_URL, --database-url or -d", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db:5432/x");
    expect(usesDefaultDatabaseUrl({})).toBe(false);
    vi.stubEnv("DATABASE_URL", "");
    expect(usesDefaultDatabaseUrl({ "database-url": "postgres://u:p@db:5432/x" })).toBe(false);
    expect(usesDefaultDatabaseUrl({ d: "postgres://u:p@db:5432/x" })).toBe(false);
  });
});

describe("playground", () => {
  it("warns about the default URL, without its password, when none is given", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    vi.spyOn(log, "heading").mockImplementation(() => {});
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.spyOn(log, "fail").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);

    await expect(playground({})).rejects.toThrow("exit 1");

    expect(warn).toHaveBeenCalledWith(
      "Using the default DATABASE_URL (postgres://stratum_app@localhost:5432/stratum)",
    );
  });

  it("does not warn when DATABASE_URL is set", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db:5432/x");
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    vi.spyOn(log, "heading").mockImplementation(() => {});
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.spyOn(log, "fail").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);

    await expect(playground({})).rejects.toThrow("exit 1");

    expect(warn).not.toHaveBeenCalled();
  });
});
