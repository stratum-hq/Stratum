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

  it("blank prints an empty line", () => {
    log.blank();
    expect(logSpy.mock.calls[0][0]).toBe("");
  });

  it("setStream sends messages to stderr and back to stdout", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      log.setStream("stderr");
      log.info("to stderr");
      log.setStream("stdout");
      log.info("to stdout");
      expect(errSpy.mock.calls.flat().join("\n")).toContain("to stderr");
      expect(logSpy.mock.calls.flat().join("\n")).toContain("to stdout");
      expect(logSpy.mock.calls.flat().join("\n")).not.toContain("to stderr");
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("NO_COLOR", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const ESC = String.fromCharCode(27);

  it("prints ANSI colors when NO_COLOR is unset", async () => {
    vi.stubEnv("NO_COLOR", undefined as unknown as string);
    vi.resetModules();
    const fresh = await import("../log.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    fresh.success("ok");
    expect(String(spy.mock.calls[0][0])).toContain(ESC);
    spy.mockRestore();
  });

  it.each(["1", "true"])("prints no ANSI codes when NO_COLOR=%s", async (value) => {
    vi.stubEnv("NO_COLOR", value);
    vi.resetModules();
    const fresh = await import("../log.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    fresh.success("ok");
    fresh.heading("title");
    fresh.dim("quiet");
    expect(spy.mock.calls.flat().join("\n")).not.toContain(ESC);
    expect(fresh.ansi("\x1b[31m")).toBe("");
    spy.mockRestore();
  });

  it("keeps colors when NO_COLOR is empty", async () => {
    vi.stubEnv("NO_COLOR", "");
    vi.resetModules();
    const fresh = await import("../log.js");
    expect(fresh.ansi("\x1b[31m")).toBe("\x1b[31m");
  });
});
