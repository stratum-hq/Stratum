import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// init() is interactive; answer its prompts from a queue.
const selectAnswers: number[] = [];
vi.mock("../../utils/prompt.js", () => ({
  select: vi.fn(async () => selectAnswers.shift() ?? 0),
  confirm: vi.fn(async () => true),
  ask: vi.fn(async () => ""),
}));

import { scaffold } from "../scaffold.js";
import { init } from "../init.js";

let tmp: string;
let cwd: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-cli-templates-"));
  cwd = process.cwd();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readAll(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

async function scaffoldOut(template: string): Promise<Record<string, string>> {
  const out = path.join(tmp, template);
  await scaffold([template], { out });
  return readAll(out);
}

/**
 * Run `stratum init` in a project whose package.json has the given deps.
 * framework / path answers are select() indices: framework is asked only
 * when nothing is detected, then the integration path.
 */
async function initOut(deps: Record<string, string>, integration: "lib" | "sdk"): Promise<Record<string, string>> {
  const project = path.join(tmp, `init-${Object.keys(deps).join("-")}-${integration}`);
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ dependencies: { pg: "^8", ...deps } }));
  process.chdir(project);
  selectAnswers.length = 0;
  selectAnswers.push(integration === "lib" ? 0 : 1);
  await init({});
  const files = readAll(project);
  delete files["package.json"];
  return files;
}

/** A control-plane key placed in an env var the browser bundle can read. */
const PUBLIC_KEY_VAR = /\b(?:NEXT_PUBLIC|REACT_APP|VITE)_[A-Z0-9_]*(?:API_KEY|SECRET)\b/;

describe("React templates keep the control-plane API key out of the browser", () => {
  const cases: Array<[string, () => Promise<Record<string, string>>]> = [
    ["scaffold nextjs", () => scaffoldOut("nextjs")],
    ["scaffold react", () => scaffoldOut("react")],
    ["scaffold env", () => scaffoldOut("env")],
    ["init (Next.js + React)", () => initOut({ next: "^15", react: "^19" }, "sdk")],
    ["init (Express + React)", () => initOut({ express: "^4", react: "^19" }, "lib")],
  ];

  for (const [name, gen] of cases) {
    it(`${name} puts no API key in a NEXT_PUBLIC_/REACT_APP_/VITE_ variable`, async () => {
      const files = await gen();
      for (const [file, content] of Object.entries(files)) {
        expect(content, file).not.toMatch(PUBLIC_KEY_VAR);
      }
    });

    it(`${name} does not hand an API key to StratumProvider`, async () => {
      const files = await gen();
      for (const [file, content] of Object.entries(files)) {
        if (!content.includes("<StratumProvider")) continue;
        expect(content, file).not.toMatch(/apiKey=/);
      }
    });
  }

  it("scaffold nextjs generates a Stratum API route that holds the key and denies by default", async () => {
    const files = await scaffoldOut("nextjs");
    const route = files[path.join("app", "api", "stratum", "[...path]", "route.ts")];
    expect(route).toBeDefined();
    expect(route).not.toContain('"use client"');
    expect(route).toContain("process.env.STRATUM_API_KEY");
    expect(route).toMatch(/return false;/);
  });
});

/** Code that reads the tenant from a client-supplied x-tenant-id header. */
const READS_TENANT_HEADER =
  /headers\[["']x-tenant-id["']\]|headers\.get\(["']x-tenant-id["']\)/i;

describe("generated tenant resolution does not trust a client-supplied tenant header", () => {
  it("scaffold nextjs middleware strips any inbound x-tenant-id and does not read it", async () => {
    const files = await scaffoldOut("nextjs");
    expect(files["middleware.ts"]).not.toMatch(READS_TENANT_HEADER);
    expect(files["middleware.ts"]).toContain(`requestHeaders.delete("x-tenant-id")`);
  });

  it("init (Next.js) middleware strips any inbound x-tenant-id and does not read it", async () => {
    const files = await initOut({ next: "^15" }, "lib");
    expect(files["middleware.ts"]).not.toMatch(READS_TENANT_HEADER);
    expect(files["middleware.ts"]).toContain(`requestHeaders.delete("x-tenant-id")`);
  });

  for (const framework of ["express", "fastify"]) {
    it(`init (${framework}, lib) resolves the tenant from a verified JWT, not a header`, async () => {
      const files = await initOut({ [framework]: "^4" }, "lib");
      const name = framework === "express" ? "stratum-middleware.ts" : "stratum-plugin.ts";
      expect(files[name]).not.toMatch(READS_TENANT_HEADER);
      expect(files[name]).toContain("jwt.verify(");
    });

    it(`init (${framework}, sdk) fails closed when JWT_SECRET is unset`, async () => {
      const files = await initOut({ [framework]: "^4" }, "sdk");
      const name = framework === "express" ? "stratum-middleware.ts" : "stratum-plugin.ts";
      expect(files[name]).toMatch(/if \(!jwtSecret\) \{\s*throw new Error/);
      expect(files[name]).not.toContain("trustTenantHeader: true");
    });
  }

  for (const template of ["express", "fastify"]) {
    it(`scaffold ${template} fails closed when JWT_SECRET is unset`, async () => {
      const files = await scaffoldOut(template);
      const content = Object.values(files).join("\n");
      expect(content).toMatch(/if \(!jwtSecret\) \{\s*throw new Error/);
      expect(content).toContain("jwtSecret,");
    });
  }
});

describe("scaffold docker", () => {
  it("does not give JWT_SECRET a public default value", async () => {
    const files = await scaffoldOut("docker");
    const compose = files["docker-compose.stratum.yml"];
    expect(compose).not.toContain("change-me-in-production");
    expect(compose).toMatch(/JWT_SECRET: \$\{JWT_SECRET:\?/);
  });

  it("does not pull a control-plane image from a registry namespace the project does not own", async () => {
    const files = await scaffoldOut("docker");
    const compose = files["docker-compose.stratum.yml"];
    expect(compose).not.toMatch(/image:\s*stratum\//);
    expect(compose).toMatch(/context: https:\/\/github\.com\/stratum-hq\/Stratum\.git#\$\{STRATUM_REF:\?/);
  });

  it("connects the control plane as a NOSUPERUSER NOBYPASSRLS role, not the bootstrap superuser", async () => {
    const files = await scaffoldOut("docker");
    const compose = files["docker-compose.stratum.yml"];
    const superuser = compose.match(/POSTGRES_USER: (\S+)/)![1];
    const appUser = compose.match(/DATABASE_URL: postgres:\/\/([^:]+):/)![1];
    expect(appUser).not.toBe(superuser);
    expect(compose).toContain("docker-entrypoint-initdb.d");
    expect(files["stratum-init-db.sql"]).toMatch(
      new RegExp(`CREATE ROLE ${appUser} WITH LOGIN PASSWORD '[^']+' NOSUPERUSER NOBYPASSRLS`),
    );
  });

  it("publishes ports on localhost only", async () => {
    const files = await scaffoldOut("docker");
    const ports = files["docker-compose.stratum.yml"].match(/- "[^"]*:\d+"/g) ?? [];
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) expect(p).toMatch(/^- "127\.0\.0\.1:/);
  });
});

describe("generated projects that verify JWTs depend on jsonwebtoken", () => {
  it("init prints jsonwebtoken in the install command when the middleware uses jwtSecret", async () => {
    const logs: string[] = [];
    await initOut({ express: "^4" }, "sdk");
    for (const call of (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      logs.push(call.map(String).join(" "));
    }
    const install = logs.find((l) => l.includes("npm install"));
    expect(install).toBeDefined();
    expect(install).toContain("jsonwebtoken");
  });
});
