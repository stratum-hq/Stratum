import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ts from "typescript";

// init() is interactive; answer its prompts from a queue.
const selectAnswers: number[] = [];
vi.mock("../../utils/prompt.js", () => ({
  select: vi.fn(async () => selectAnswers.shift() ?? 0),
  confirm: vi.fn(async () => true),
  ask: vi.fn(async () => ""),
}));

import { scaffold } from "../scaffold.js";
import { init } from "../init.js";

/**
 * Runs the Next.js middleware that `stratum init` and `stratum scaffold nextjs`
 * generate, against requests a client controls: the Host header, any
 * x-tenant-id header, and the bearer token.
 *
 * next/server is replaced with a stand-in that records what the middleware
 * returns. jose is replaced with a minimal HS256 verifier that checks the
 * signature, the algorithm allow-list and expiry the way jose's jwtVerify does.
 */

const SECRET = "test-secret-for-generated-middleware-0123456789";

type Outcome =
  | { kind: "next"; headers: Headers }
  | { kind: "json"; status: number; body: unknown };

const nextServer = {
  NextResponse: {
    next: (init?: { request?: { headers?: Headers } }): Outcome => ({
      kind: "next",
      headers: init?.request?.headers ?? new Headers(),
    }),
    json: (body: unknown, init?: { status?: number }): Outcome => ({
      kind: "json",
      status: init?.status ?? 200,
      body,
    }),
  },
};

const jose = {
  async jwtVerify(token: string, key: Uint8Array, options?: { algorithms?: string[] }) {
    const [h, p, s, ...rest] = token.split(".");
    if (!h || !p || s === undefined || rest.length > 0) throw new Error("JWSInvalid");
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    if (options?.algorithms && !options.algorithms.includes(header.alg)) {
      throw new Error("JOSEAlgNotAllowed");
    }
    if (header.alg !== "HS256") throw new Error("JOSENotSupported");
    const expected = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest();
    const actual = Buffer.from(s, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new Error("JWSSignatureVerificationFailed");
    }
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
      throw new Error("JWTExpired");
    }
    return { payload, protectedHeader: header };
  },
};

function sign(payload: Record<string, unknown>, secret: string, alg = "HS256"): string {
  const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = alg === "none" ? "" : crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

type Middleware = (request: unknown) => Promise<Outcome> | Outcome;

/** Compiles the generated middleware.ts and returns its `middleware` export. */
function loadMiddleware(source: string): Middleware {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const requireStub = (id: string): unknown => {
    if (id === "next/server") return nextServer;
    if (id === "jose") return jose;
    throw new Error(`generated middleware imports an unexpected module: ${id}`);
  };
  new Function("require", "module", "exports", outputText)(requireStub, mod, mod.exports);
  return mod.exports.middleware as Middleware;
}

function request(host: string, headers: Record<string, string> = {}, pathname = "/dashboard"): unknown {
  return { headers: new Headers({ host, ...headers }), nextUrl: { pathname } };
}

let tmp: string;
let cwd: string;
let savedSecret: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-cli-nextjs-"));
  cwd = process.cwd();
  savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function initNextjs(integration: "lib" | "sdk"): Promise<string> {
  const project = path.join(tmp, `init-next-${integration}`);
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ dependencies: { next: "^15", pg: "^8" } }),
  );
  process.chdir(project);
  selectAnswers.length = 0;
  selectAnswers.push(integration === "lib" ? 0 : 1);
  await init({});
  return fs.readFileSync(path.join(project, "middleware.ts"), "utf8");
}

async function scaffoldNextjs(): Promise<string> {
  const out = path.join(tmp, "scaffold-next");
  await scaffold(["nextjs"], { out });
  return fs.readFileSync(path.join(out, "middleware.ts"), "utf8");
}

const generators: Array<[string, () => Promise<string>]> = [
  ["init (Next.js, lib)", () => initNextjs("lib")],
  ["init (Next.js, sdk)", () => initNextjs("sdk")],
  ["scaffold nextjs", scaffoldNextjs],
];

for (const [name, generate] of generators) {
  describe(`${name} middleware takes the tenant only from a verified token`, () => {
    it("refuses a bearer token signed with a key other than JWT_SECRET", async () => {
      const middleware = loadMiddleware(await generate());
      const forged = sign({ tenant_id: "victim-tenant" }, "attacker-chosen-secret");
      const res = await middleware(
        request("victim-tenant.app.example.com", { authorization: `Bearer ${forged}` }),
      );
      expect(res.kind).toBe("json");
      expect(res.kind === "json" && res.status).toBe(401);
    });

    it("refuses an unsigned token with alg none", async () => {
      const middleware = loadMiddleware(await generate());
      const unsigned = sign({ tenant_id: "victim-tenant" }, "", "none");
      const res = await middleware(
        request("app.example.com", { authorization: `Bearer ${unsigned}` }),
      );
      expect(res.kind === "json" && res.status).toBe(401);
    });

    it("refuses a valid token that has no tenant_id claim", async () => {
      const middleware = loadMiddleware(await generate());
      const token = sign({ sub: "user-1" }, SECRET);
      const res = await middleware(request("acme.app.example.com", { authorization: `Bearer ${token}` }));
      expect(res.kind === "json" && res.status).toBe(401);
    });

    it("does not set x-tenant-id from the subdomain the client chose", async () => {
      const middleware = loadMiddleware(await generate());
      const res = await middleware(request("victim-tenant.app.example.com"));
      expect(res.kind).toBe("next");
      expect(res.kind === "next" && res.headers.get("x-tenant-id")).toBeNull();
    });

    it("drops an x-tenant-id header the client sent", async () => {
      const middleware = loadMiddleware(await generate());
      const res = await middleware(
        request("app.example.com", { "x-tenant-id": "victim-tenant" }),
      );
      expect(res.kind === "next" && res.headers.get("x-tenant-id")).toBeNull();
    });

    it("forwards the tenant_id claim of a valid token, whatever the host or headers say", async () => {
      const middleware = loadMiddleware(await generate());
      const token = sign({ tenant_id: "tenant-a" }, SECRET);
      const res = await middleware(
        request("victim-tenant.app.example.com", {
          authorization: `Bearer ${token}`,
          "x-tenant-id": "victim-tenant",
        }),
      );
      expect(res.kind).toBe("next");
      expect(res.kind === "next" && res.headers.get("x-tenant-id")).toBe("tenant-a");
    });
  });
}

describe("init (Next.js) install command", () => {
  it("includes jose, which the generated middleware uses to verify tokens", async () => {
    await initNextjs("lib");
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map(String).join(" "),
    );
    const install = logs.find((l) => l.includes("npm install"));
    expect(install).toContain("jose");
  });
});
