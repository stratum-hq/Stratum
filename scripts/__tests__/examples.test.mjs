// The framework examples are copied into real applications, so they must show
// the safe tenant binding. Since v1.3.0 the SDK ignores the client-supplied
// X-Tenant-ID header when JWT verification is on. An example that reads that
// header itself teaches the pattern the release closed.
//
// The examples are not workspace packages, so no package typecheck covers
// them. These tests compile each example against the workspace sources of the
// @stratum-hq packages, so an SDK change that breaks an example fails here.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLES_DIR = join(ROOT, "examples");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");

const FRAMEWORK_EXAMPLES = ["with-express", "with-hono", "with-nextjs"];

// Workspace packages the examples import, mapped to their sources so the
// check does not need a prior build.
const WORKSPACE_PACKAGES = ["core", "lib", "sdk", "hono"];

// Third-party modules the examples need but the root install does not carry.
// Each stub declares only the surface the examples use, copied from the real
// type definitions. A stub applies only when its package is absent, so a root
// install that has the package type-checks the example against the real types.
const OPTIONAL_THIRD_PARTY = {
  "with-hono": {
    "@hono/node-server": `
      export function serve(
        options: { fetch: (request: Request) => Response | Promise<Response>; port?: number },
        listeningListener?: (info: { address: string; port: number }) => void,
      ): unknown;`,
  },
  "with-nextjs": {
    "next/server": `
      export class NextRequest extends Request {
        readonly nextUrl: URL;
      }
      export class NextResponse<Body = unknown> extends Response {
        static json<JsonBody>(body: JsonBody, init?: ResponseInit): NextResponse<JsonBody>;
        static next(init?: { request?: { headers?: Headers } }): NextResponse;
      }`,
    "next/headers": `
      export function headers(): Promise<Headers>;`,
    jose: `
      export interface JWTPayload { [propName: string]: unknown }
      export function jwtVerify(
        jwt: string | Uint8Array,
        key: Uint8Array,
        options?: { algorithms?: string[] },
      ): Promise<{ payload: JWTPayload }>;`,
  },
};

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function isInstalled(specifier) {
  const pkg = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  return existsSync(join(ROOT, "node_modules", pkg, "package.json"));
}

const tempDirs = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("framework examples", () => {
  describe.each(FRAMEWORK_EXAMPLES)("%s", (name) => {
    const exampleDir = join(EXAMPLES_DIR, name);

    it("does not read the tenant from the X-Tenant-ID header in code", () => {
      const offenders = [];
      for (const file of sourceFiles(join(exampleDir, "src"))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (!isComment(line) && /x-tenant-id/i.test(line)) {
              offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
            }
          });
      }
      expect(offenders).toEqual([]);
    });

    it("has a tsconfig.json so its build script works", () => {
      expect(existsSync(join(exampleDir, "tsconfig.json"))).toBe(true);
    });

    it(
      "typechecks against the workspace packages",
      () => {
        const work = mkdtempSync(join(tmpdir(), `example-${name}-`));
        tempDirs.push(work);

        const stubs = Object.entries(OPTIONAL_THIRD_PARTY[name] ?? {}).filter(([m]) => !isInstalled(m));
        const stubFile = join(work, "stubs.d.ts");
        writeFileSync(stubFile, stubs.map(([m, body]) => `declare module "${m}" {${body}\n}`).join("\n") + "\n");

        const paths = Object.fromEntries(
          WORKSPACE_PACKAGES.map((p) => [`@stratum-hq/${p}`, [join(ROOT, "packages", p, "src", "index.ts")]]),
        );
        const config = {
          extends: join(exampleDir, "tsconfig.json"),
          compilerOptions: {
            noEmit: true,
            rootDir: ROOT,
            incremental: false,
            paths,
            // The config file lives in a temp directory, so point the automatic
            // @types lookup back at the root install.
            typeRoots: [join(ROOT, "node_modules", "@types")],
          },
          include: [join(exampleDir, "src", "**", "*"), stubFile],
        };
        const configFile = join(work, "tsconfig.json");
        writeFileSync(configFile, JSON.stringify(config, null, 2));

        let output = "";
        let status = 0;
        try {
          execFileSync(process.execPath, [TSC, "-p", configFile], { encoding: "utf8", stdio: "pipe" });
        } catch (err) {
          status = err.status ?? 1;
          output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
        }
        expect(output).toBe("");
        expect(status).toBe(0);
      },
      180_000,
    );
  });
});
