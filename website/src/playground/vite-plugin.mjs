// Builds the Playground from the workspace packages, so the docs always run
// the library of the same commit. Node-only imports inside packages/ resolve
// to browser shims; imports from the rest of the site resolve as usual.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(here, "../../../packages") + path.sep;
const shimsDir = path.join(here, "shims");
const bufferEntry = createRequire(import.meta.url).resolve("buffer/");

const WORKSPACE = {
  "@stratum-hq/lib": "lib/src/index.ts",
  "@stratum-hq/core": "core/src/index.ts",
  // The library imports only the context helpers from the SDK. The full SDK
  // also brings HTTP middleware and a JWT library.
  "@stratum-hq/sdk": "sdk/src/context.ts",
  "@stratum-hq/db-adapters": "db-adapters/src/index.ts",
  "@stratum-hq/db-adapters/pglite": "db-adapters/src/pglite/index.ts",
};

const SHIMS = {
  pg: "pg.ts",
  "node:crypto": "crypto.ts",
  "node:async_hooks": "async-hooks.ts",
  "node:fs": "node-unavailable.ts",
  "node:path": "node-unavailable.ts",
  "node:dns/promises": "node-unavailable.ts",
  "node:http": "node-unavailable.ts",
  "node:https": "node-unavailable.ts",
  "node:net": "net.ts",
};

// The library reads NODE_ENV to decide whether built-in key material is
// allowed. The Playground is a throwaway in-memory database, so it runs as
// development. The rest of the site keeps the production NODE_ENV.
const PLAYGROUND_ENV = JSON.stringify({ NODE_ENV: "development" });

export function stratumPlayground() {
  return {
    name: "stratum-playground",
    enforce: "pre",
    resolveId(source, importer) {
      if (source in WORKSPACE) return path.join(packagesDir, WORKSPACE[source]);
      if (importer?.startsWith(packagesDir) && source in SHIMS) {
        return path.join(shimsDir, SHIMS[source]);
      }
      return null;
    },
    transform(code, id) {
      if (!id.startsWith(packagesDir) || !id.endsWith(".ts")) return null;
      let out = code.replace(/\bprocess\.env\b/g, `(${PLAYGROUND_ENV})`);
      if (/\bBuffer\b/.test(out)) out = `import { Buffer } from ${JSON.stringify(bufferEntry)};\n${out}`;
      return out === code ? null : { code: out, map: null };
    },
  };
}
