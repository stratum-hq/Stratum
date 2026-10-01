import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PassThrough } from "node:stream";

/**
 * The prompt helpers read process.stdin through one readline interface for
 * the whole command, so each test swaps in its own stream and loads a fresh
 * copy of the module.
 */
describe("prompt", () => {
  let stdin: PassThrough;
  let stdinSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let prompt: typeof import("../prompt.js");

  beforeEach(async () => {
    stdin = new PassThrough();
    stdinSpy = vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as unknown as typeof process.stdin);
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    prompt = await import("../prompt.js");
  });

  afterEach(() => {
    prompt.closePrompt();
    stdinSpy.mockRestore();
    writeSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("reads every answer when they arrive in one chunk, as from a pipe", async () => {
    stdin.write("first\nsecond\nthird\n");
    expect(await prompt.ask("1? ")).toBe("first");
    expect(await prompt.ask("2? ")).toBe("second");
    expect(await prompt.ask("3? ")).toBe("third");
  });

  it("rejects when stdin closes before an answer", async () => {
    const answer = prompt.ask("Proceed? ");
    stdin.end();
    await expect(answer).rejects.toThrow(/Input closed before an answer/);
  });

  it("rejects a later question once stdin has closed", async () => {
    stdin.end("y\n");
    expect(await prompt.confirm("First?")).toBe(true);
    await expect(prompt.confirm("Second?")).rejects.toThrow(/Input closed/);
  });

  it("confirm accepts its default on an empty answer", async () => {
    stdin.write("\n\n");
    expect(await prompt.confirm("Yes?", true)).toBe(true);
    expect(await prompt.confirm("No?", false)).toBe(false);
  });

  it("select returns the default on an empty answer and shows it", async () => {
    stdin.write("\n");
    expect(await prompt.select("Pick:", ["a", "b", "c"], 2)).toBe(2);
    expect(writeSpy.mock.calls.flat().join("")).toContain("[3]");
  });

  it("select returns the chosen option", async () => {
    stdin.write("2\n");
    expect(await prompt.select("Pick:", ["a", "b", "c"], 0)).toBe(1);
  });
});
