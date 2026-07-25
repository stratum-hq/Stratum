import { describe, it, expect } from "vitest";
import { parseArgs } from "../args.js";

describe("parseArgs", () => {
  it("returns empty command for empty argv", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("");
    expect(result.args).toEqual([]);
    expect(result.flags).toEqual({});
  });

  it("extracts the command from the first positional", () => {
    const result = parseArgs(["migrate"]);
    expect(result.command).toBe("migrate");
    expect(result.args).toEqual([]);
  });

  it("collects remaining positionals into args", () => {
    const result = parseArgs(["migrate", "orders", "invoices"]);
    expect(result.command).toBe("migrate");
    expect(result.args).toEqual(["orders", "invoices"]);
  });

  it("parses a long flag with a value", () => {
    const result = parseArgs(["migrate", "--database-url", "postgres://x"]);
    expect(result.flags["database-url"]).toBe("postgres://x");
    expect(result.args).toEqual([]);
  });

  it("treats a valueless long flag as boolean true", () => {
    const result = parseArgs(["migrate", "--scan"]);
    expect(result.flags["scan"]).toBe(true);
  });

  it("treats a long flag followed by another flag as boolean true", () => {
    const result = parseArgs(["migrate", "--all", "--force"]);
    expect(result.flags["all"]).toBe(true);
    expect(result.flags["force"]).toBe(true);
  });

  it("parses a short flag with a value", () => {
    const result = parseArgs(["migrate", "-d", "postgres://y"]);
    expect(result.flags["d"]).toBe("postgres://y");
  });

  it("treats a valueless short flag as boolean true", () => {
    const result = parseArgs(["health", "-v"]);
    expect(result.flags["v"]).toBe(true);
  });

  it("only treats two-character tokens as short flags", () => {
    // "-xy" is length 3, so it is not parsed as a short flag and lands in positionals
    const result = parseArgs(["cmd", "-xy"]);
    expect(result.flags["x"]).toBeUndefined();
    expect(result.args).toEqual(["-xy"]);
  });

  it("keeps positionals and flags in any order", () => {
    const result = parseArgs(["scaffold", "--out", "/tmp/x", "express"]);
    expect(result.command).toBe("scaffold");
    expect(result.args).toEqual(["express"]);
    expect(result.flags["out"]).toBe("/tmp/x");
  });

  it("does not consume a following short flag as a value", () => {
    const result = parseArgs(["cmd", "-a", "-b"]);
    expect(result.flags["a"]).toBe(true);
    expect(result.flags["b"]).toBe(true);
  });
});
