import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as log from "../log.js";

describe("log helpers", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("success prints the message with a check icon", () => {
    log.success("done");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("done");
  });

  it("warn prints the message", () => {
    log.warn("careful");
    expect(logSpy.mock.calls[0][0]).toContain("careful");
  });

  it("table returns without printing when given no rows", () => {
    log.table([]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("table pads each column to the widest cell in that column", () => {
    log.table([
      ["a", "bb"],
      ["ccc", "d"],
    ]);
    // col widths: [3, 2]; cells joined by two spaces, whole line indented two spaces
    expect(logSpy.mock.calls[0][0]).toBe("  a    bb");
    expect(logSpy.mock.calls[1][0]).toBe("  ccc  d ");
  });
});
