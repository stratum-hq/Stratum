// The website docs and the static OpenAPI spec are written by hand, so they
// drift from the code without any build error. These checks compare the docs
// with the source files that define the real behavior. They read text only and
// need no build and no database.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS_DIR = join(ROOT, "website", "src", "content", "docs");

/** Return every .md and .mdx file under a directory. */
function docFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return docFiles(path);
    return /\.mdx?$/.test(entry.name) ? [path] : [];
  });
}

const docs = docFiles(DOCS_DIR).map((file) => ({
  name: relative(ROOT, file),
  text: readFileSync(file, "utf8"),
}));

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * Return the fields of a TypeScript interface as a map of name to "optional".
 * The regex parser is enough for the flat interfaces in @stratum-hq/core.
 */
function interfaceFields(file, name) {
  const source = readFileSync(join(ROOT, file), "utf8");
  const body = source.match(new RegExp(`export interface ${name} \\{([^}]*)\\}`))?.[1];
  if (!body) throw new Error(`interface ${name} not found in ${file}`);
  const fields = {};
  for (const [, field, optional] of body.matchAll(/^\s*(\w+)(\?)?:/gm)) {
    fields[field] = Boolean(optional);
  }
  return fields;
}

describe("RLS policy snippets in the website docs", () => {
  // Without the second argument, current_setting raises an error when the
  // variable is not set. On a pooled connection a transaction-local value ends
  // with the transaction, and a later read returns '' instead of NULL. Lib
  // migration 019 uses this form for the same reason.
  const SAFE_READ = "NULLIF(current_setting('app.current_tenant_id', true), '')";

  it("reads app.current_tenant_id only through NULLIF with missing_ok", () => {
    const unsafe = [];
    let reads = 0;
    for (const { name, text } of docs) {
      for (const match of text.matchAll(/current_setting\('app\.current_tenant_id'/g)) {
        reads += 1;
        const start = match.index - "NULLIF(".length;
        if (text.slice(start, start + SAFE_READ.length) !== SAFE_READ) {
          unsafe.push(`${name}:${lineOf(text, match.index)}`);
        }
      }
    }
    // Zero reads means that the pattern no longer matches the docs, not that the docs are safe.
    expect(reads).toBeGreaterThan(0);
    expect(unsafe).toEqual([]);
  });
});

describe("OpenAPI TenantContext schema", () => {
  const spec = JSON.parse(readFileSync(join(ROOT, "scripts", "openapi-spec.json"), "utf8"));
  const schemas = spec.components.schemas;

  function resolveRef(schema) {
    const ref = schema?.$ref;
    return ref ? schemas[ref.replace("#/components/schemas/", "")] : schema;
  }

  function expectSchemaMatches(schema, fields) {
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(fields).sort());
    const required = Object.keys(fields).filter((field) => !fields[field]);
    expect([...(schema.required ?? [])].sort()).toEqual(required.sort());
  }

  const context = schemas.TenantContext;

  it("is the response of GET /api/v1/tenants/{id}/context", () => {
    const response =
      spec.paths["/api/v1/tenants/{id}/context"].get.responses["200"].content["application/json"].schema;
    expect(resolveRef(response)).toBe(context);
  });

  it("has the fields of core's ResolvedTenantContext", () => {
    expectSchemaMatches(
      context,
      interfaceFields("packages/core/src/types/tenant.ts", "ResolvedTenantContext"),
    );
  });

  it("describes isolation_strategy as a required IsolationStrategy value", () => {
    const source = readFileSync(join(ROOT, "packages/core/src/types/tenant.ts"), "utf8");
    const block = source.match(/export const IsolationStrategy = \{([^}]*)\}/)[1];
    const values = [...block.matchAll(/:\s*"(\w+)"/g)].map((m) => m[1]);
    const property = context.properties.isolation_strategy;
    expect(property.enum).toEqual(values);
    expect(property.nullable ?? false).toBe(false);
  });

  it("describes resolved_config as a map of ResolvedConfigEntry by key", () => {
    const property = context.properties.resolved_config;
    expect(property.type).toBe("object");
    expectSchemaMatches(
      resolveRef(property.additionalProperties),
      interfaceFields("packages/core/src/types/config.ts", "ResolvedConfigEntry"),
    );
  });

  it("describes resolved_permissions as a map of ResolvedPermission by key", () => {
    const property = context.properties.resolved_permissions;
    expect(property.type).toBe("object");
    expectSchemaMatches(
      resolveRef(property.additionalProperties),
      interfaceFields("packages/core/src/types/tenant.ts", "ResolvedPermission"),
    );
  });
});

describe("OpenAPI error responses", () => {
  const spec = JSON.parse(readFileSync(join(ROOT, "scripts", "openapi-spec.json"), "utf8"));
  const schemas = spec.components.schemas;
  const error = schemas.Error.properties.error;

  function resolveRef(schema) {
    const ref = schema?.$ref;
    return ref ? schemas[ref.replace("#/components/schemas/", "")] : schema;
  }

  /** Return the names of the issue fields that validationErrorBody keeps. */
  function issueFields() {
    const source = readFileSync(join(ROOT, "packages/control-plane/src/middleware/error-handler.ts"), "utf8");
    const fields = source.match(/\.map\(\(\{([^}]*)\}\)\s*=>/)?.[1];
    if (!fields) throw new Error("issue normalization not found in error-handler.ts");
    return fields.split(",").map((field) => field.trim());
  }

  it("describes the optional details.issues that validationErrorBody sends", () => {
    const details = error.properties.details;
    expect(details.type).toBe("object");
    expect(error.required).not.toContain("details");
    const item = resolveRef(details.properties.issues.items);
    expect(Object.keys(item.properties).sort()).toEqual(issueFields().sort());
    expect([...item.required].sort()).toEqual(issueFields().sort());
  });

  it("marks the top-level issues copy as deprecated", () => {
    expect(error.properties.issues.deprecated).toBe(true);
    expect(resolveRef(error.properties.issues.items)).toBe(resolveRef(error.properties.details.properties.issues.items));
    expect(error.required).not.toContain("issues");
  });

  it("documents 409 REGION_IN_USE on DELETE /api/v1/regions/{id}", () => {
    const responses = spec.paths["/api/v1/regions/{id}"].delete.responses;
    expect(responses["409"].description).toMatch(/REGION_IN_USE/);
  });

  it("documents 409 REGION_NOT_ACTIVE and 404 REGION_NOT_FOUND on migrate-region", () => {
    const responses = spec.paths["/api/v1/tenants/{id}/migrate-region"].post.responses;
    expect(responses["409"].description).toMatch(/REGION_NOT_ACTIVE/);
    expect(responses["404"].description).toMatch(/REGION_NOT_FOUND/);
  });
});

describe("error code tables in the website API docs", () => {
  // A client matches on error.code, so a code in the docs that the control
  // plane never sends makes the client check fail without a sign.
  const ROW = /^\| `([A-Z_]+)` \| \d{3} \|/gm;

  /** Return the codes in core's ErrorCode and the literal codes of the control plane. */
  function knownCodes() {
    const core = readFileSync(join(ROOT, "packages/core/src/utils/errors.ts"), "utf8");
    const block = core.match(/export enum ErrorCode \{([^}]*)\}/)[1];
    const codes = new Set([...block.matchAll(/=\s*"(\w+)"/g)].map((m) => m[1]));
    for (const file of sourceFiles(join(ROOT, "packages/control-plane/src"))) {
      for (const [, code] of readFileSync(file, "utf8").matchAll(/code:\s*"([A-Z_]+)"/g)) codes.add(code);
    }
    return codes;
  }

  /** Return every .ts file under a directory, without tests. */
  function sourceFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    });
  }

  it("names only error codes that core or the control plane defines", () => {
    const known = knownCodes();
    const unknown = [];
    let rows = 0;
    for (const { name, text } of docs.filter((doc) => doc.name.includes("/docs/api/"))) {
      for (const match of text.matchAll(ROW)) {
        rows += 1;
        if (!known.has(match[1])) unknown.push(`${name}:${lineOf(text, match.index)} ${match[1]}`);
      }
    }
    // Zero rows means that the pattern no longer matches the tables, not that the tables are correct.
    expect(rows).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });
});

describe("@stratum-hq/lib imports in the website docs", () => {
  /** Return the names that packages/lib/src/index.ts exports, values and types. */
  function libExports() {
    const source = readFileSync(join(ROOT, "packages/lib/src/index.ts"), "utf8");
    const names = new Set();
    for (const [, list] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      for (const name of identifiers(list)) names.add(name.split(/\s+as\s+/).pop());
    }
    return names;
  }

  /** Split an import or export list into bare names, without comments or `type`. */
  function identifiers(list) {
    return list
      .replace(/\/\/[^\n]*/g, "")
      .split(",")
      .map((part) => part.trim().replace(/^type\s+/, ""))
      .filter(Boolean);
  }

  const exported = libExports();

  it("imports only names that the package exports", () => {
    // The tempered token stops a match at the next `import`, so an import from
    // another package never joins a later import from @stratum-hq/lib.
    const IMPORT = /import\s+(?:type\s+)?\{((?:(?!\bimport\b)[\s\S])*?)\}\s*from\s*["']@stratum-hq\/lib["']/g;
    const missing = [];
    let imports = 0;
    for (const { name, text } of docs) {
      for (const match of text.matchAll(IMPORT)) {
        imports += 1;
        for (const id of identifiers(match[1])) {
          const imported = id.split(/\s+as\s+/)[0];
          if (!exported.has(imported)) missing.push(`${name}:${lineOf(text, match.index)} ${imported}`);
        }
      }
    }
    // Zero imports means that the pattern no longer matches the docs, not that the docs are correct.
    expect(imports).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe("tenant header use in the website docs", () => {
  // Any client can send an x-tenant-id header, so a server that trusts it lets
  // the client choose its tenant. With JWT verification configured, the SDK
  // reads the header only when trustTenantHeader is true. A snippet that uses
  // the header must therefore say that only a gateway can set it.
  const HEADER_USE =
    /(?:\[\s*|\.get\(\s*|\.header\(\s*|header\s*:\s*|-H\s+)["'`]x-tenant-id\b/gi;
  const CAVEAT = /gateway (?:that )?you control/i;
  // The caveat must be near the use, so that a reader who copies one snippet
  // also reads the caveat for it.
  const WINDOW = 20;

  /** Return the line numbers of header uses that have no caveat near them. */
  function uncaveated(text) {
    const lines = text.split("\n");
    const found = [];
    for (const match of text.matchAll(HEADER_USE)) {
      const line = lineOf(text, match.index);
      const near = lines.slice(Math.max(0, line - 1 - WINDOW), line + WINDOW).join("\n");
      if (!CAVEAT.test(near)) found.push(line);
    }
    return found;
  }

  it("finds each form of a tenant header use in a sample", () => {
    const sample = [
      'const a = req.headers["x-tenant-id"];',
      "const b = request.headers.get('X-Tenant-ID');",
      'const c = headerList.get("x-tenant-id");',
      'const d = ctx.req.header("x-tenant-id");',
      'stratumMiddleware({ header: "x-tenant-id" });',
      'curl http://localhost:3000/orders -H "x-tenant-id: $TENANT_A"',
    ].join("\n");
    expect(uncaveated(sample)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(uncaveated(`${sample}\n// Only a gateway you control sets this header.`)).toEqual([]);
  });

  it("states the gateway caveat near every use of x-tenant-id", () => {
    const missing = [];
    let uses = 0;
    for (const { name, text } of docs) {
      uses += [...text.matchAll(HEADER_USE)].length;
      for (const line of uncaveated(text)) missing.push(`${name}:${line}`);
    }
    // Zero uses means that the pattern no longer matches the docs, not that the docs are safe.
    expect(uses).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe("tenant.purged in the website docs and in core", () => {
  // purgeTenant never emits tenant.purged. The purge erases the event log of
  // the tenant, and webhook_events.tenant_id references tenants, so the event
  // row for a purged tenant cannot be stored. Core keeps the event type until
  // the next major version, so each mention must state both facts.
  const DEPRECATED = /deprecated/i;
  const NOT_EMITTED = /never emit/i;

  /** Return the line numbers that name tenant.purged without both facts. */
  function unqualified(text) {
    return text
      .split("\n")
      .flatMap((line, index) =>
        line.includes("tenant.purged") && !(DEPRECATED.test(line) && NOT_EMITTED.test(line))
          ? [index + 1]
          : [],
      );
  }

  it("finds an unqualified mention in a sample", () => {
    expect(unqualified("| `tenant.purged` | Tenant deleted |")).toEqual([1]);
    expect(unqualified("`tenant.purged` is deprecated. purgeTenant never emits it.")).toEqual([]);
  });

  it("states on each line that names tenant.purged that it is deprecated and never emitted", () => {
    const missing = [];
    let mentions = 0;
    for (const { name, text } of docs) {
      if (text.includes("tenant.purged")) mentions += 1;
      for (const line of unqualified(text)) missing.push(`${name}:${line}`);
    }
    // Zero mentions means that the docs no longer name the event, and this check is obsolete.
    expect(mentions).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("marks TENANT_PURGED as @deprecated in the TenantEvent of core", () => {
    const source = readFileSync(join(ROOT, "packages/core/src/types/webhook.ts"), "utf8");
    expect(source).toMatch(/\/\*\*(?:(?!\*\/)[\s\S])*@deprecated(?:(?!\*\/)[\s\S])*\*\/\s*TENANT_PURGED:/);
  });
});

describe("JWT secret snippets in the website docs and the package READMEs", () => {
  // A middleware without a JWT secret does not verify tokens, and it reads the
  // tenant from the header that any client can send. An unset environment
  // variable gives an undefined secret, so an inline read turns verification
  // off without an error. A snippet must read the secret into a variable and
  // throw when it is missing, before the middleware gets it.
  const INLINE_READ =
    /\b(?:jwtSecret|secret)\s*:\s*(?:process\.env\.\w+|process\.env\[[^\]]+\]|config\.get\s*(?:<[^>]*>)?\s*\()/g;

  const readmes = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, "packages", entry.name, "README.md"))
    .filter((file) => existsSync(file))
    .map((file) => ({ name: relative(ROOT, file), text: readFileSync(file, "utf8") }));

  /** Return the line numbers that give a middleware a secret with no guard. */
  function inlineReads(text) {
    return [...text.matchAll(INLINE_READ)].map((match) => lineOf(text, match.index));
  }

  it("finds each form of an inline secret read in a sample", () => {
    const sample = [
      "app.use(s.middleware({ jwtSecret: process.env.JWT_SECRET }));",
      'jwtSecret: config.get("JWT_SECRET"),',
      'jwtSecret: config.get<string>("JWT_SECRET"),',
      'app.use("*", jwt({ secret: process.env.JWT_SECRET!, alg: "HS256" }));',
      'jwtSecret: process.env["JWT_SECRET"],',
    ].join("\n");
    expect(inlineReads(sample)).toEqual([1, 2, 3, 4, 5]);
    const guarded = [
      "const jwtSecret = process.env.JWT_SECRET;",
      'if (!jwtSecret) throw new Error("JWT_SECRET is required.");',
      "app.use(s.middleware({ jwtSecret }));",
      'app.use("*", jwt({ secret: jwtSecret, alg: "HS256" }));',
    ].join("\n");
    expect(inlineReads(guarded)).toEqual([]);
  });

  it("reads each JWT secret into a guarded variable, not inline from the environment", () => {
    const unsafe = [];
    let mentions = 0;
    for (const { name, text } of [...docs, ...readmes]) {
      mentions += [...text.matchAll(/\bjwtSecret\b/g)].length;
      for (const line of inlineReads(text)) unsafe.push(`${name}:${line}`);
    }
    // Zero mentions means that the scan read nothing, not that the snippets are safe.
    expect(readmes.length).toBeGreaterThan(0);
    expect(mentions).toBeGreaterThan(0);
    expect(unsafe).toEqual([]);
  });
});
