import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { init } from "../init.js";
import { select, confirm } from "../../utils/prompt.js";

vi.mock("../../utils/prompt.js", () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  ask: vi.fn(),
}));

describe("init", () => {
  let detectDir: string; // process.cwd() used for framework/orm/react detection
  let outDir: string; // where generated files are written (--out)
  let logSpy: ReturnType<typeof vi.spyOn>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    detectDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-cli-init-detect-"));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-cli-init-out-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(detectDir);
  });

  afterEach(() => {
    fs.rmSync(detectDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
    logSpy.mockRestore();
    cwdSpy.mockRestore();
  });

  const read = (rel: string) => fs.readFileSync(path.join(outDir, rel), "utf8");
  const exists = (rel: string) => fs.existsSync(path.join(outDir, rel));
  const output = () => logSpy.mock.calls.flat().join("\n");

  it("generates express + direct-library files from interactive answers", async () => {
    // no package.json in detectDir -> nothing detected, so all three selects run
    (select as Mock)
      .mockResolvedValueOnce(0) // framework: Express
      .mockResolvedValueOnce(0) // integration: lib
      .mockResolvedValueOnce(0); // database: pg
    (confirm as Mock).mockResolvedValue(true); // generate scaffolding

    await init({ out: outDir });

    expect(exists(".env.stratum")).toBe(true);
    expect(exists("stratum.config.ts")).toBe(true);
    expect(exists("stratum-middleware.ts")).toBe(true);
    expect(exists("stratum-db.ts")).toBe(true);
    expect(read("stratum.config.ts")).toContain('integration: "lib"');
    expect(read("stratum-middleware.ts")).toContain("@stratum-hq/lib");
    expect(read("stratum-db.ts")).toContain("createTenantPool");
    expect(read(".env.stratum")).toMatch(/JWT_SECRET=.+/);
  });

  it("generates Next.js + SDK files when those answers are chosen", async () => {
    (select as Mock)
      .mockResolvedValueOnce(2) // framework: Next.js
      .mockResolvedValueOnce(1) // integration: sdk
      .mockResolvedValueOnce(0); // database: pg
    (confirm as Mock).mockResolvedValue(true);

    await init({ out: outDir });

    expect(exists("middleware.ts")).toBe(true);
    expect(exists("lib/stratum.ts")).toBe(true);
    expect(read("lib/stratum.ts")).toContain("StratumClient");
    expect(read("stratum.config.ts")).toContain('integration: "sdk"');
  });

  it("uses the detected framework, ORM and React from an existing package.json", async () => {
    fs.writeFileSync(
      path.join(detectDir, "package.json"),
      JSON.stringify({ dependencies: { express: "*", pg: "*", react: "*" } }),
      "utf8",
    );
    // framework + orm are detected, so only the integration-path select runs
    (select as Mock).mockResolvedValueOnce(0); // integration: lib
    (confirm as Mock).mockResolvedValue(true); // "Use express?" + "Generate scaffolding?"

    await init({ out: outDir });

    expect(output()).toContain("Detected framework: express");
    expect(output()).toContain("Detected React");
    // React scaffolding is emitted because react was detected
    expect(exists("stratum-provider.tsx")).toBe(true);
    expect(exists("tenant-guard.tsx")).toBe(true);
    expect(exists("use-tenant.ts")).toBe(true);
  });

  it("writes nothing when the user declines the final confirmation", async () => {
    (select as Mock)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    (confirm as Mock).mockResolvedValue(false); // decline generation

    await init({ out: outDir });

    expect(output()).toContain("Cancelled");
    expect(fs.readdirSync(outDir)).toHaveLength(0);
  });
});
