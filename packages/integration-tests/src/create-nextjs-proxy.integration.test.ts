import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCliEntry, scaffoldProject } from "./helpers/create-cli.js";
import { useWorkspaceStratumPackages } from "./helpers/workspace-tarballs.js";
import {
  readFunctionsConfig,
  run,
  startNext,
  tenantGateTests,
  writeProbeRoute,
  type NextServer,
} from "./helpers/next-app.js";

/**
 * The Next.js projects that `@stratum-hq/create` generates must run their
 * tenant proxy. Next.js runs the proxy only from the directory that holds
 * the app directory, so with the app in src/app the proxy must be
 * src/proxy.ts, and `next build` needs a root layout.
 *
 * The template and the preset write the same Next.js files, which the first
 * tests check. One generated project (the preset) is then installed, built
 * with `next build` and started, to prove that Next.js registers the proxy
 * on the Node.js runtime, that it rejects every token that does not verify,
 * and that it strips a client x-tenant-id. Installing needs network access
 * to the npm registry.
 */

const PRESET = "postgres-rls-pg-nextjs";
const JWT_SECRET = crypto.randomBytes(32).toString("base64url");

let tmp: string;
let templateDir: string;
let presetDir: string;
let server: NextServer | undefined;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-next-"));
  const res = spawnSync(process.execPath, [createCliEntry(), "next-template-app", "--template", "nextjs", "--skip-install"], {
    cwd: tmp,
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`create --template nextjs failed\n${res.stdout}\n${res.stderr}`);
  templateDir = path.join(tmp, "next-template-app");
  presetDir = scaffoldProject(tmp, "next-preset-app", PRESET);
});

afterAll(() => {
  server?.stop();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("@stratum-hq/create Next.js file layout", () => {
  for (const [name, dir] of [
    ["template", () => templateDir],
    ["preset", () => presetDir],
  ] as const) {
    it(`${name}: writes the proxy next to the app directory and a root layout`, () => {
      expect(fs.existsSync(path.join(dir(), "src/app/page.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(dir(), "src/app/layout.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(dir(), "src/proxy.ts"))).toBe(true);
      expect(fs.existsSync(path.join(dir(), "src/middleware.ts"))).toBe(false);
      expect(fs.existsSync(path.join(dir(), "proxy.ts"))).toBe(false);
    });
  }

  it("template and preset write the same proxy and layout", () => {
    for (const file of ["src/proxy.ts", "src/app/layout.tsx"]) {
      const read = (dir: string, name: string) =>
        fs.readFileSync(path.join(dir, file), "utf8").replaceAll(name, "<project>");
      expect(read(templateDir, "next-template-app")).toBe(read(presetDir, "next-preset-app"));
    }
  });
});

describe(`@stratum-hq/create ${PRESET} built with next build`, () => {
  let tsconfigBefore: string;

  beforeAll(async () => {
    writeProbeRoute(path.join(presetDir, "src"));
    tsconfigBefore = fs.readFileSync(path.join(presetDir, "tsconfig.json"), "utf8");
    // The workspace builds of the Stratum packages, so the test checks the
    // code under test even before it is on npm.
    useWorkspaceStratumPackages(presetDir, tmp);
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], presetDir);
    run("npx", ["next", "build"], presetDir, { NODE_ENV: "production" });
    server = await startNext(presetDir, JWT_SECRET);
  }, 600_000);

  it("registers the proxy on the Node.js runtime with the generated matcher", () => {
    const proxy = readFunctionsConfig(presetDir)["/_middleware"];
    expect(proxy?.runtime).toBe("nodejs");
    expect(proxy?.matchers?.map((m) => m.originalSource)).toEqual([
      "/((?!_next/static|_next/image|favicon.ico).*)",
    ]);
  });

  it("leaves the generated tsconfig.json as it was", () => {
    expect(JSON.parse(fs.readFileSync(path.join(presetDir, "tsconfig.json"), "utf8"))).toEqual(
      JSON.parse(tsconfigBefore),
    );
  });

  tenantGateTests(() => server!.baseUrl, JWT_SECRET);

  it("installs no package with a high or critical advisory", () => {
    // npm audit exits non-zero when it finds anything, so read its JSON report.
    const res = spawnSync("npm", ["audit", "--json"], { cwd: presetDir, encoding: "utf8" });
    const report = JSON.parse(res.stdout) as {
      metadata?: { vulnerabilities?: Record<string, number> };
    };
    const counts = report.metadata?.vulnerabilities;
    expect(counts).toBeDefined();
    expect({ high: counts?.high, critical: counts?.critical }).toEqual({ high: 0, critical: 0 });
  }, 120_000);
});
