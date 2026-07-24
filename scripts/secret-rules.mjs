// Secret detection rules: no credential-shaped string reaches a commit.
//
// This module is pure analysis: file name and source text in, findings out. It
// touches no file system and never exits the process. Discovery, the allowlist
// and the reporting all live in check-secrets.mjs, so the rules stay testable
// on their own and the fixture table at the bottom of this file can assert them.
//
// The design constraint is a LOW false-positive rate. A scanner that cries wolf
// gets bypassed with --no-verify, and a bypassed scanner protects nothing. So
// the rules come in two tiers:
//
//   Tier 1  Provider-issued tokens with a distinctive prefix and a fixed shape.
//           A hit is near certainly a real credential, so there is no entropy
//           gate and no placeholder filter.
//   Tier 2  A secret-shaped NAME assigned a high-entropy VALUE. Much broader, so
//           it is gated hard: length, Shannon entropy, and a placeholder filter
//           that knows what a stand-in looks like.
//
// Deliberately NOT implemented: bare high-entropy string scanning with no name
// or prefix context. It is what makes generic scanners unusable, because
// minified assets, hashes, base64 fixtures and ids all trip it.

import { createHash } from "node:crypto";

export const RULES = {
  stratumKey: "stratum-api-key",
  hardcodedKey: "hardcoded-key-literal",
  providerToken: "provider-token",
  privateKey: "private-key",
  connectionString: "connection-string-password",
  assignedSecret: "assigned-secret",
  envFile: "committed-env-file",
};

export const RULE_NAMES = Object.values(RULES);

/**
 * Stratum mints its own keys as `sk_live_` + `randomBytes(32).toString("base64url")`,
 * which is 43 characters of base64url. See API_KEY_PREFIX in packages/core and
 * api-key-service.ts in packages/lib.
 *
 * One regex, two rules, split on the length of the suffix:
 *
 *   >= MINTED_SUFFIX_LENGTH   the minted shape. Tier 1: a real key, rotate it.
 *   <  MINTED_SUFFIX_LENGTH   a hardcoded literal. Not a minted key by
 *                             construction, but still a key literal someone typed
 *                             into the tree, so it is pinned by the allowlist.
 *
 * A short `sk_test_` literal is not reported at all. Stratum mints `sk_live_`
 * and nothing else, so a short `sk_test_` string is a test fixture by
 * construction, and the control plane's route tests hold eleven of them. A
 * `sk_test_` at the minted length is still reported, which is what catches a
 * Stripe test key being pasted in.
 *
 * Stripe uses the same `sk_live_` / `sk_test_` prefix, which is why the Stripe
 * entry in PROVIDER_TOKENS covers only `rk_` and `whsec_`: matching `sk_` in two
 * rules would report one string twice under two different fix instructions.
 */
const KEY_LITERAL = /\bsk_(live|test)_([A-Za-z0-9_-]+)\b/g;
const MINTED_SUFFIX_LENGTH = 32;

/**
 * Tier 1. Each pattern is anchored on a prefix the issuing service actually
 * mints, so the shape alone is the evidence. Keep this list conservative: a
 * pattern that could match ordinary source text belongs in tier 2 instead.
 */
const PROVIDER_TOKENS = [
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g },
  { name: "AWS secret access key", re: /\baws_secret_access_key\s*=\s*([A-Za-z0-9/+=]{40})\b/gi },
  { name: "GitHub token", re: /\bgh[pousr]_[0-9A-Za-z]{36}\b/g },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[0-9A-Za-z_]{60,}\b/g },
  { name: "Stripe restricted or webhook key", re: /\b(?:rk_(?:live|test)_[0-9A-Za-z]{20,}|whsec_[0-9A-Za-z]{30,})\b/g },
  { name: "Slack token", re: /\bxox[abprs]-[0-9A-Za-z-]{12,}\b/g },
  { name: "Slack webhook URL", re: /\bhooks\.slack\.com\/services\/T[0-9A-Z]{6,}\/B[0-9A-Z]{6,}\/[0-9A-Za-z]{20,}/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Anthropic API key", re: /\bsk-ant-[0-9A-Za-z_-]{20,}\b/g },
  { name: "OpenAI API key", re: /\bsk-(?:proj-)?[0-9A-Za-z_-]{32,}\b/g },
  { name: "npm access token", re: /\bnpm_[0-9A-Za-z]{36}\b/g },
  { name: "Fly.io deploy token", re: /\bFlyV1\s+fm[12]_[0-9A-Za-z+/=]{40,}/g },
  { name: "Resend API key", re: /\bre_[0-9A-Za-z]{8}_[0-9A-Za-z]{20,}\b/g },
  { name: "SendGrid API key", re: /\bSG\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}\b/g },
  { name: "Twilio account SID", re: /\bAC[0-9a-f]{32}\b/g },
  { name: "signed JSON Web Token", re: /\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{20,}\b/g },
];

/** A private key block. Zero false positives in practice, and always fatal. */
const PRIVATE_KEY = /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g;

/**
 * A password sitting inline in a connection URI. `DATABASE_URL` is the one
 * credential the control plane cannot run without, so it is the one most likely
 * to be pasted somewhere it should not be.
 */
const CONNECTION_STRING =
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/([^:@/\s]+):([^@/\s]{4,})@([^/\s:]+)/g;

/**
 * Hosts that only ever appear in a local or containerised development URI.
 * The tail of this list is the docker-compose service names from this repo.
 */
const LOCAL_HOSTS =
  /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|db|test-db|stratum-db|database|postgres|postgresql|mysql|redis|mongo|mongodb)$/i;

/**
 * Tier 2. A name that reads as "this holds a credential". Checked against the
 * key normalised to lower_snake_case and fenced with underscores, so both
 * `clientSecret` and `STRATUM_API_KEY_HMAC_SECRET` match while React's `key=`
 * prop and a plain `PUBLIC_URL` do not. `key` and `auth` are absent on purpose:
 * alone they are far too common in ordinary source to carry any signal.
 */
const SECRET_NAME =
  /_(?:secret|secrets|token|tokens|password|passwd|pwd|passphrase|apikey|api_key|secret_key|private_key|access_key|signing_key|encryption_key|client_secret|auth_token|session_secret|webhook_secret|credential|credentials)_/;

/**
 * `NAME = value`, `NAME: value`, in a quoted or bare form. Covers .env, YAML,
 * JSON, TS and shell in one pass, which matters because a secret is just as bad
 * in a workflow file as in application code. The value class stops at
 * whitespace, quotes and the punctuation that ends a literal.
 *
 * The separator is `[ \t]*` and not `\s*` on purpose. `\s` crosses newlines, so
 * an empty `FOO_SECRET=` in a .env template would pair with the NEXT line's key
 * and report it as the value.
 */
const ASSIGNMENT = /([A-Za-z_$][A-Za-z0-9_$.-]{1,48})[ \t]*[:=][ \t]*(["'`]?)([^\s"'`,;)\]}]{16,256})\2/g;

/**
 * `a.b.c`, `row.key_hash`, `options.apiKey`. An expression, not a literal, and
 * high entropy only because identifiers use a wide alphabet.
 */
const IDENTIFIER_EXPRESSION = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;

/**
 * A lowercase kebab or snake phrase of three or more segments:
 * `ci-only-secret-not-production`, `build-placeholder-overridden-at-runtime`.
 * These read as English because they are English, but they clear the entropy
 * floor on character variety alone, which is where a pure entropy gate fails.
 * Machine-minted tokens are not lowercase phrases. A human-chosen passphrase
 * would slip through, and is a documented gap.
 */
const KEBAB_PHRASE = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+){2,}$/;

/**
 * Formats where an unquoted value is the normal way to write a literal. In
 * TypeScript a bare right-hand side is an expression, so requiring quotes there
 * removes a whole class of false positive at no cost to detection.
 */
const BARE_VALUE_FORMATS =
  /(?:^|\/)(?:Dockerfile[^/]*|\.env(?:\.[A-Za-z0-9_-]+)*|[^/]+\.(?:ya?ml|toml|ini|conf|cfg|properties|sh|bash|zsh|env))$/i;

/**
 * Values that announce themselves as stand-ins rather than credentials. Applied
 * to tier 2 values and to short `sk_` suffixes, which is what keeps the
 * `sk_live_your_key_here` in six README files out of the allowlist.
 *
 * `demo` is deliberately absent. The demo stack's bootstrap key is a real
 * global-admin grant in every database that runs the seed, so it is a decision
 * the allowlist should record by hand rather than a shape the scanner waves
 * through. See scripts/secret-allowlist.json.
 */
const PLACEHOLDER =
  /^(?:x+|y+|z+|\*+|\.+|-+|_+|0+|change[-_]?me|your[-_].*|my[-_].*|some[-_].*|example.*|placeholder.*|dummy.*|sample.*|fake.*|redacted.*|dev(?:[-_].*)?|test[-_].*|todo.*|tbd.*|none|null|undefined|unset|empty)$/i;

/** Substrings that mean the value is a reference or a template, not a literal. */
const NOT_A_LITERAL = /\$\{|\$\(|process\.env|import\.meta|<[a-z]|[a-z]>|\{\{|%s|%\(|@\{/i;

/** A UUID is high entropy but is nearly always an id, not a credential. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimum bits of Shannon entropy per character for a tier 2 value. */
const ENTROPY_FLOOR = 3.5;

/**
 * A tracked `.env` is a finding on its own, whatever is inside it. These names
 * are the sanctioned exceptions: they exist to be committed.
 */
const ENV_FILE = /(?:^|\/)\.env(?:\.[A-Za-z0-9_-]+)*$/;
const ENV_TEMPLATE = /\.(?:example|sample|template|dist|defaults)$/i;

/** Shannon entropy in bits per character. */
export function shannonEntropy(value) {
  if (value.length === 0) return 0;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * A stable, non-reversible handle for one finding. The allowlist keys on this
 * so an accepted false positive can be recorded WITHOUT writing the matched
 * string back into the repository.
 */
export function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Never print a match in full. A scanner that echoes credentials into a terminal
 * or a CI log is itself a disclosure, and the developer already knows which
 * string is on the line it names.
 */
export function redact(value) {
  const flat = value.replace(/\s+/g, " ");
  if (flat.length <= 12) return "*".repeat(flat.length);
  return `${flat.slice(0, 4)}${"*".repeat(8)}${flat.slice(-2)} (${flat.length} chars)`;
}

/** lower_snake_case, fenced with underscores, for SECRET_NAME to match against. */
function normaliseKey(key) {
  return `_${key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.\-$]/g, "_")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")}_`;
}

function lineAndColumn(source, index) {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const column = index - (before.lastIndexOf("\n") + 1) + 1;
  return { line, column };
}

function finding(rule, source, index, match, detail) {
  const { line, column } = lineAndColumn(source, index);
  return { rule, line, column, detail, match, evidence: redact(match), id: fingerprint(match) };
}

/** True when a tier 2 value is credential-shaped rather than prose or a reference. */
function looksLikeSecretValue(value) {
  if (value.length < 16) return false;
  if (PLACEHOLDER.test(value)) return false;
  if (NOT_A_LITERAL.test(value)) return false;
  if (UUID.test(value)) return false;
  if (IDENTIFIER_EXPRESSION.test(value)) return false;
  if (KEBAB_PHRASE.test(value)) return false;
  if (value.includes("(") || value.startsWith("[") || value.startsWith("{")) return false;
  if (/^(?:https?|file|data|mailto):/i.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("@/")) return false;
  // A single repeated character is a mask, not a secret.
  if (new Set(value).size <= 2) return false;
  return shannonEntropy(value) >= ENTROPY_FLOOR;
}

/**
 * A path that is a committed `.env`. Returns a finding or null, because this
 * rule is about the file's existence and never reads its contents.
 */
export function analyzeFileName(fileName) {
  if (!ENV_FILE.test(fileName) || ENV_TEMPLATE.test(fileName)) return null;
  return {
    rule: RULES.envFile,
    line: 0,
    column: 0,
    detail: "an environment file is tracked by git",
    match: fileName,
    evidence: fileName,
    id: fingerprint(fileName),
  };
}

/** All findings in one file's text, in source order. */
export function analyzeSource(fileName, source) {
  const findings = [];

  KEY_LITERAL.lastIndex = 0;
  for (const match of source.matchAll(KEY_LITERAL)) {
    const [, env, suffix] = match;
    if (suffix.length >= MINTED_SUFFIX_LENGTH) {
      findings.push(finding(RULES.stratumKey, source, match.index, match[0], "minted-shape API key"));
    } else if (env === "live" && !PLACEHOLDER.test(suffix)) {
      findings.push(finding(RULES.hardcodedKey, source, match.index, match[0], "hardcoded API key literal"));
    }
  }

  for (const { name, re } of PROVIDER_TOKENS) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      // A capture group means the pattern needed context to anchor on. Report
      // the captured credential, not the surrounding text.
      const value = match[1] ?? match[0];
      const index = match.index + (match[1] ? match[0].indexOf(match[1]) : 0);
      findings.push(finding(RULES.providerToken, source, index, value, name));
    }
  }

  PRIVATE_KEY.lastIndex = 0;
  for (const match of source.matchAll(PRIVATE_KEY)) {
    findings.push(finding(RULES.privateKey, source, match.index, match[0], "private key block"));
  }

  CONNECTION_STRING.lastIndex = 0;
  for (const match of source.matchAll(CONNECTION_STRING)) {
    const [, user, password, host] = match;
    if (LOCAL_HOSTS.test(host)) continue;
    if (password === user) continue;
    if (PLACEHOLDER.test(password) || NOT_A_LITERAL.test(password)) continue;
    if (shannonEntropy(password) < 3) continue;
    const index = match.index + match[0].indexOf(`:${password}@`) + 1;
    findings.push(
      finding(RULES.connectionString, source, index, password, `password inline in a URI for ${host}`),
    );
  }

  const bareValuesAllowed = BARE_VALUE_FORMATS.test(fileName);
  ASSIGNMENT.lastIndex = 0;
  for (const match of source.matchAll(ASSIGNMENT)) {
    const [, key, quote, value] = match;
    if (!quote && !bareValuesAllowed) continue;
    if (!SECRET_NAME.test(normaliseKey(key))) continue;
    if (!looksLikeSecretValue(value)) continue;
    const index = match.index + match[0].lastIndexOf(value);
    findings.push(
      finding(RULES.assignedSecret, source, index, value, `\`${key}\` assigned a high-entropy literal`),
    );
  }

  // De-duplicate: a key assigned to STRATUM_API_KEY is one problem, and
  // reporting it under two rules would make the count wrong and the fix unclear.
  const seen = new Set();
  return findings
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .filter((f) => {
      const key = `${f.line}:${f.column}:${f.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The false-positive rate is the whole design constraint, so it gets asserted
 * rather than assumed. There is no root test runner in this monorepo (`npm test`
 * is `turbo test` over the workspaces), so instead of adding one, check-secrets
 * runs this table on every invocation. It is pure regex over a few short strings
 * and costs well under a millisecond, and it means a rule cannot be loosened or
 * tightened without the fixture that covers it failing first.
 *
 * `flag` strings must produce the named rule. `pass` strings must produce
 * nothing: every one of them is a real line, or a close paraphrase of one, that
 * an earlier revision of these rules got wrong.
 */
const FIXTURES = {
  flag: [
    ["app.ts", "sk_live_NOT_A_REAL_KEY_NOT_A_REAL_KEY_NOT_A_REAL_KEY", RULES.stratumKey],
    ["docker-compose.yml", "API_KEY: sk_live_notarealkey", RULES.hardcodedKey],
    ["deploy.sh", "aws_secret_access_key = NOTAREALKEYNOTAREALKEYNOTAREALKEYNOTAREA", RULES.providerToken],
    ["id_rsa", "-----BEGIN OPENSSH PRIVATE KEY-----", RULES.privateKey],
    ["config.ts", 'const url = "postgres://admin:NOT-a-real-password-9Q@db.example.com:5432/app"', RULES.connectionString],
    ["config.ts", 'const JWT_SECRET = "fixture-NOT-a-real-secret-9QxZ7"', RULES.assignedSecret],
  ],
  pass: [
    // Documentation placeholders. Six README files carry these verbatim.
    ["packages/sdk/README.md", 'apiKey: "sk_live_your_key"'],
    ["examples/README.md", "| `STRATUM_API_KEY` | API key | `sk_live_dev` |"],
    // Route test fixtures. The control plane's tests hold eleven of these.
    ["packages/control-plane/src/__tests__/auth.test.ts", 'const key = "sk_test_valid_key"'],
    // Local and containerised development URIs, from docker-compose.yml, ci.yml
    // and the compose file the CLI scaffolds.
    ["docker-compose.yml", "DATABASE_URL: postgres://stratum_app:stratum_dev@db:5432/stratum"],
    [".github/workflows/ci.yml", "DATABASE_URL: postgresql://stratum:stratum@localhost:5432/stratum_test"],
    ["packages/cli/src/commands/scaffold.ts", "DATABASE_URL: postgres://stratum:stratum_dev@stratum-db:5432/stratum"],
    // Env var reads, template references and documented variable names.
    ["seed.ts", 'const API_KEY = process.env.API_KEY || "unset"'],
    ["fly.toml", 'JWT_SECRET = "${JWT_SECRET}"'],
    ["README.md", "| `STRATUM_API_KEY_HMAC_SECRET` | HMAC secret for API key hashing |"],
    // Property access and a column name, not literals.
    ["api-key-service.ts", "const hash = row.key_hash.toString()"],
    // A uuid is high entropy and is nearly always an id.
    ["seed.ts", 'const tenant_secret_id = "a0000000-0000-0000-0000-000000000001"'],
    // A masked value in documentation.
    ["docs.md", 'STRATUM_ENCRYPTION_KEY="xxxxxxxxxxxxxxxxxxxxxxxx"'],
  ],
};

/** Fixture failures, as human-readable strings. Empty means the rules hold. */
export function selfTest() {
  const failures = [];
  for (const [file, source, rule] of FIXTURES.flag) {
    const rules = analyzeSource(file, source).map((f) => f.rule);
    if (!rules.includes(rule)) failures.push(`expected ${rule} in ${file}, got [${rules.join(", ") || "nothing"}]`);
  }
  for (const [file, source] of FIXTURES.pass) {
    const found = analyzeSource(file, source);
    if (found.length > 0) failures.push(`false positive in ${file}: ${found.map((f) => f.rule).join(", ")}`);
  }
  return failures;
}
