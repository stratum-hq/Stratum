import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readFunctionsConfig,
  readMiddlewareManifest,
  run,
  startNext,
  tenantGateTests,
  writeProbeRoute,
  type NextServer,
} from "./helpers/next-app.js";

/**
 * `stratum scaffold nextjs` writes the tenant check that the project's
 * Next.js version runs: proxy.ts on Next.js 16, middleware.ts on Next.js 15.
 * A minimal App Router project is installed at each major, the built CLI
 * writes into it, and `next build` and `next start` prove that Next.js runs
 * the file. Installs run one at a time and need network access to the npm
 * registry. The projects install no Stratum package, so the tests do not
 * wait for a release.
 */

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");
const JWT_SECRET = crypto.randomBytes(32).toString("base64url");

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-cli-next-"));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** Writes a minimal Next.js App Router project with its app in src/app. */
function nextProject(name: string, nextRange: string): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, "src/app"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        private: true,
        scripts: { build: "next build", start: "next start" },
        dependencies: { next: nextRange, react: "^19.2.0", "react-dom": "^19.2.0", jose: "^6.2.12" },
        devDependencies: { typescript: "^5.3.0", "@types/node": "^20.11.0", "@types/react": "^19.0.0" },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "src/app/layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  );
  fs.writeFileSync(path.join(dir, "src/app/page.tsx"), "export default function Home() {\n  return <main>home</main>;\n}\n");
  writeProbeRoute(path.join(dir, "src"));
  return dir;
}

/**
 * Runs `stratum scaffold nextjs` in the project and keeps only the tenant
 * file. The other files it writes import @stratum-hq/sdk and
 * @stratum-hq/react, which these projects do not install.
 */
function scaffoldTenantFile(dir: string): void {
  const res = spawnSync(process.execPath, [CLI, "scaffold", "nextjs", "--out", dir], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (res.status !== 0) throw new Error(`stratum scaffold nextjs failed\n${res.stdout}\n${res.stderr}`);
  for (const extra of ["lib", "components", "src/app/api/stratum"]) {
    fs.rmSync(path.join(dir, extra), { recursive: true, force: true });
  }
}

describe("stratum scaffold nextjs on a Next.js 16 project", () => {
  let dir: string;
  let server: NextServer | undefined;

  beforeAll(async () => {
    dir = nextProject("next16-app", "^16.3.8");
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], dir);
    scaffoldTenantFile(dir);
    run("npx", ["next", "build"], dir, { NODE_ENV: "production" });
    server = await startNext(dir, JWT_SECRET);
  }, 600_000);

  afterAll(() => {
    server?.stop();
  });

  it("writes src/proxy.ts and no middleware.ts", () => {
    expect(fs.readFileSync(path.join(dir, "src/proxy.ts"), "utf8")).toContain("export async function proxy(");
    expect(fs.existsSync(path.join(dir, "src/middleware.ts"))).toBe(false);
  });

  it("registers the proxy on the Node.js runtime", () => {
    expect(readFunctionsConfig(dir)["/_middleware"]?.runtime).toBe("nodejs");
  });

  tenantGateTests(() => server!.baseUrl, JWT_SECRET);
});

describe("stratum scaffold nextjs on a Next.js 15 project", () => {
  let dir: string;
  let server: NextServer | undefined;

  beforeAll(async () => {
    dir = nextProject("next15-app", "^15.5.16");
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], dir);
    scaffoldTenantFile(dir);
    run("npx", ["next", "build"], dir, { NODE_ENV: "production" });
    server = await startNext(dir, JWT_SECRET);
  }, 600_000);

  afterAll(() => {
    server?.stop();
  });

  it("writes src/middleware.ts and no proxy.ts", () => {
    expect(fs.readFileSync(path.join(dir, "src/middleware.ts"), "utf8")).toContain(
      "export async function middleware(",
    );
    expect(fs.existsSync(path.join(dir, "src/proxy.ts"))).toBe(false);
  });

  it("registers the middleware in the build manifest", () => {
    expect(readMiddlewareManifest(dir)).toContain("/");
  });

  tenantGateTests(() => server!.baseUrl, JWT_SECRET);
});
