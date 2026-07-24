#!/usr/bin/env node
// Fails the build when a credential-shaped string is about to be committed.
//
//   node scripts/check-secrets.mjs            scan the working tree
//   node scripts/check-secrets.mjs --staged   scan only what is staged
//
// The July 2026 audit scanned this repository's history and found it clean, and
// `.env` is correctly gitignored. This check exists to keep that true. So unlike
// the dependency policy in check-deps.mjs there is no ratchet and no `--write`:
// the expected count is zero, and every finding either fails or is recorded by
// hand in scripts/secret-allowlist.json with a reason. See docs/secret-scanning.md.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSource, analyzeFileName, selfTest, RULES, RULE_NAMES } from "./secret-rules.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = join(REPO_ROOT, "scripts", "secret-allowlist.json");

/** Nothing here is human-authored text, and all of it is noisy to scan. */
const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm", ".mp3", ".wav",
  ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".jar", ".wasm", ".node",
  ".map", ".snap",
]);

/**
 * This script's own rules module holds fixtures that are deliberately
 * credential-shaped, so scanning it would fail the check forever. It is the only
 * exemption and it is not extensible: there is no per-line ignore pragma,
 * because an ignore pragma is how a real leak gets waved through at 2am.
 */
const NOT_SCANNED = new Set(["scripts/secret-rules.mjs"]);

/** Files above this are generated or vendored, and scanning them finds nothing. */
const MAX_BYTES = 4 * 1024 * 1024;

const GUIDANCE = {
  [RULES.stratumKey]: [
    "A string with the shape of a minted Stratum API key is in the tree:",
    "`sk_live_` followed by 32 or more characters is what api-key-service.ts produces.",
    "Never allowlist this rule.",
    "  1. Revoke the key. Rotation first, cleanup second. If the prefix is in the",
    "     `api_keys` table, delete the row; DELETE /api/v1/api-keys/:id does the same.",
    "  2. Remove it from the file. Read it from `process.env` instead.",
    "  3. Add the variable to .env.example with an empty or placeholder value.",
    "Stripe mints secret keys under the same `sk_live_` prefix, so if the key was not",
    "issued by Stratum, revoke it wherever it did come from.",
    "If it was already committed, say so: rewriting history is a forbidden action in",
    "CLAUDE.md and needs a human decision, not a script.",
  ],
  [RULES.hardcodedKey]: [
    "An API key literal is hardcoded. It is too short to be a minted key, so this is",
    "a fixture, a seed value or a paste that got truncated.",
    "Read it from `process.env` and document the variable in .env.example.",
    "Documentation placeholders (`sk_live_your_key`, `sk_live_dev`) are recognised and",
    "never reported, so this one is not shaped like a placeholder.",
    "If it genuinely has to stay, record it in scripts/secret-allowlist.json with a",
    "reason a reviewer can check. The allowlist keys on a hash, never the text.",
  ],
  [RULES.providerToken]: [
    "A provider-issued token is in the tree. Treat it as compromised the moment it",
    "is written to disk in a repository:",
    "  1. Revoke it at the provider. Rotation first, cleanup second.",
    "  2. Remove it from the file. Read it from `process.env` instead.",
    "  3. Add the variable to .env.example with an empty or placeholder value.",
    "An npm token matters more than most here: these packages publish to npm, and the",
    "release workflow reads NPM_TOKEN from repository secrets, never from the tree.",
  ],
  [RULES.privateKey]: [
    "A private key block is in the tree. Revoke the key pair, then remove it.",
    "Keys belong in a secret store or in an env var, never in the repository.",
  ],
  [RULES.connectionString]: [
    "A connection URI carries an inline password. Move the whole URI into an env",
    "var (`DATABASE_URL`) and read it from `process.env`. Local and docker-compose",
    "hosts are not flagged, so this one points somewhere real.",
  ],
  [RULES.assignedSecret]: [
    "A secret-named variable is assigned a high-entropy literal. Read it from",
    "`process.env` and document the variable in .env.example. `JWT_SECRET`,",
    "`STRATUM_ENCRYPTION_KEY` and `STRATUM_API_KEY_HMAC_SECRET` are all env-only.",
    "If this is genuinely not a credential, add it to scripts/secret-allowlist.json",
    "with a reason. The allowlist keys on a hash, so nothing secret goes in it.",
  ],
  [RULES.envFile]: [
    "An environment file is tracked by git. `.env` is gitignored precisely so this",
    "cannot happen, which means this one was force-added.",
    "  git rm --cached <file>",
    "Keep the sanctioned template instead: .env.example.",
  ],
};

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Everything `git add -A` would sweep up: tracked files plus untracked files
 * that are not ignored. Untracked matters, because the file a developer is about
 * to stage is exactly the one worth checking. Ignored files are excluded, which
 * is what keeps a correctly gitignored `.env` and every node_modules from
 * failing the build on every run.
 */
function workingTreeFiles() {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
}

/** Staged additions and modifications. Deletions have nothing left to scan. */
function stagedFiles() {
  return git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .split("\0")
    .filter(Boolean);
}

function isSkippedPath(file) {
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot).toLowerCase();
  return SKIP_EXTENSIONS.has(ext) || NOT_SCANNED.has(file);
}

/**
 * File contents as text, or null when there is nothing worth scanning. In
 * `--staged` mode the bytes come from the index, not the working tree, so a
 * secret that is staged but since edited out of the file is still caught.
 */
function readContents(file, staged) {
  try {
    const buffer = staged
      ? execFileSync("git", ["show", `:${file}`], { cwd: REPO_ROOT, maxBuffer: MAX_BYTES })
      : readFileSync(join(REPO_ROOT, file));
    if (buffer.length > MAX_BYTES) return null;
    // A NUL byte in the head is the standard binary sniff, and it is what git
    // itself uses. Cheaper and more reliable than trusting the extension.
    if (buffer.subarray(0, 8000).includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    // Unreadable, gone between listing and reading, or too large for the buffer.
    return null;
  }
}

function readAllowlist() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch {
    return { entries: new Map(), broken: true };
  }
  const entries = new Map();
  for (const entry of parsed.accepted ?? []) entries.set(`${entry.path}:${entry.id}`, entry);
  return { entries, broken: false };
}

function scan(files, staged) {
  const findings = [];
  for (const file of files) {
    if (isSkippedPath(file)) continue;
    const named = analyzeFileName(file);
    if (named) findings.push({ ...named, file });
    const contents = readContents(file, staged);
    if (contents === null) continue;
    for (const found of analyzeSource(file, contents)) findings.push({ ...found, file });
  }
  return findings;
}

function report(findings) {
  const byFile = new Map();
  for (const found of findings) {
    if (!byFile.has(found.file)) byFile.set(found.file, []);
    byFile.get(found.file).push(found);
  }
  for (const [file, found] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`\n  ${file}`);
    for (const f of found) {
      const where = f.line === 0 ? file : `${file}:${f.line}:${f.column}`;
      console.error(`    ${where}  ${f.rule}: ${f.detail}`);
      console.error(`      ${f.evidence}`);
      console.error(`      id ${f.id}`);
    }
  }
  const rules = new Set(findings.map((f) => f.rule));
  for (const rule of RULE_NAMES.filter((rule) => rules.has(rule))) {
    console.error(`\n  How to fix ${rule}:`);
    for (const line of GUIDANCE[rule]) console.error(`    ${line}`);
  }
}

function main() {
  const regressions = selfTest();
  if (regressions.length > 0) {
    console.error("The secret rules no longer match their own fixtures, so the scan below");
    console.error("would not mean anything. Fix scripts/secret-rules.mjs before trusting it.");
    for (const failure of regressions) console.error(`  ${failure}`);
    return 1;
  }

  const staged = process.argv.includes("--staged");
  const files = staged ? stagedFiles() : workingTreeFiles();

  if (files.length === 0) {
    console.log(`No ${staged ? "staged" : "tracked"} files to scan for secrets.`);
    return 0;
  }

  const { entries, broken } = readAllowlist();
  if (broken) {
    console.error(`Missing or unreadable ${relative(REPO_ROOT, ALLOWLIST_PATH)}.`);
    console.error("It is hand-maintained and must exist, even when empty. Restore it from git.");
    return 1;
  }

  const findings = scan(files, staged);
  const accepted = findings.filter((f) => entries.has(`${f.file}:${f.id}`));
  const failures = findings.filter((f) => !entries.has(`${f.file}:${f.id}`));

  if (failures.length > 0) {
    const noun = failures.length === 1 ? "secret" : "secrets";
    console.error(`Possible ${noun} in ${staged ? "the staged changes" : "the working tree"}.`);
    console.error("Nothing below is printed in full, on purpose. Open the file and line named.");
    report(failures);
    console.error("\nIf a finding is genuinely not a credential, record it in");
    console.error(`${relative(REPO_ROOT, ALLOWLIST_PATH)} with its id and a reason.`);
    console.error("Rotate first and argue later: a token in a repository is already spent.");
    return 1;
  }

  const scope = staged ? `${files.length} staged files` : `${files.length} files`;
  const note = accepted.length > 0 ? `, ${accepted.length} allowlisted` : "";
  console.log(`No secrets found (${scope} scanned${note}).`);
  return 0;
}

process.exit(main());
