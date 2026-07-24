#!/usr/bin/env node
// Fails the build when the dependency vulnerability surface grows.
//
//   node scripts/check-deps.mjs           check, exit 1 on any drift
//   node scripts/check-deps.mjs --write   rewrite the baseline from `npm audit`
//
// `npm audit` reports real findings in this tree today, across every severity.
// Gating at zero would block every push, so this is a ratchet: it records the
// count at each severity, fails when any count goes up, and fails when one goes
// down until the baseline is regenerated and committed.
//
// Failing on improvement is the point, and it is the part people argue with. A
// gate that only notices regressions lets a stale baseline drift upward
// forever, because nobody has a reason to regenerate it. Failing on the way down
// is what makes the number actually fall.
//
// Two scopes are tracked, not one. `runtime` is `npm audit --omit=dev`, which is
// what ships to a user who installs a published package. `all` includes the
// build and test toolchain. A finding that moves from dev-only to runtime is a
// real escalation that a single total would hide, and the runtime number is the
// one worth arguing about.
//
// The baseline records COUNTS ONLY, deliberately. This is a public repository:
// severity counts are already public to anyone who runs `npm audit`, but a
// committed file naming vulnerable packages and advisories is a convenience for
// somebody scanning for targets. The cost of that choice is written down in
// docs/dependency-policy.md, and it is real: a like-for-like swap at the same
// severity passes.
//
// This script fixes nothing. Remediating the existing findings is separate work
// with real breaking-change risk, and it does not belong in a gate.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "dependency-baseline.json");

/** Most severe first, which is the order a human wants to read them in. */
const SEVERITIES = ["critical", "high", "moderate", "low", "info"];

/** `npm audit --omit=dev` is what a consumer of the published packages gets. */
const SCOPES = {
  runtime: ["audit", "--json", "--omit=dev"],
  all: ["audit", "--json"],
};

const SCOPE_NAMES = Object.keys(SCOPES);

/**
 * `npm audit` exits non-zero whenever it finds anything, which is the normal
 * case here, so a non-zero exit is not an error and stdout still holds the
 * report. A genuine failure (offline, registry down, corrupt lockfile) shows up
 * as stdout that will not parse, and that is the case worth failing loudly on:
 * silently treating an unreachable registry as "no vulnerabilities" is how a
 * ratchet quietly resets itself to zero.
 */
function runAudit(scope) {
  let stdout;
  try {
    stdout = execFileSync("npm", SCOPES[scope], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    stdout = error.stdout ?? "";
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return null;
  }
  const counts = report?.metadata?.vulnerabilities;
  if (!counts) return null;
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, counts[severity] ?? 0]));
}

function total(counts) {
  return SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
}

/** `critical 1, high 6, moderate 11, low 1`, zeros omitted, or `none`. */
function summarise(counts) {
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${s} ${counts[s]}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function readBaseline() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
  if (!parsed?.scopes) return null;
  const scopes = {};
  for (const scope of SCOPE_NAMES) {
    const recorded = parsed.scopes[scope];
    if (!recorded) return null;
    scopes[scope] = Object.fromEntries(SEVERITIES.map((s) => [s, recorded[s] ?? 0]));
  }
  return scopes;
}

function writeBaseline(actual) {
  const payload = {
    $comment: [
      "Generated. Do not hand-edit: run `npm run lint:deps:write`.",
      "Vulnerability counts from `npm audit`, by severity, for two scopes.",
      "`runtime` is `npm audit --omit=dev`: what ships to a consumer of the published",
      "packages. `all` adds the build and test toolchain. Runtime is the number that",
      "matters; the total mostly measures the toolchain.",
      "This is a ratchet. A count going up fails the build. A count going down fails it",
      "too, until you regenerate this file and commit it, which is how improvements get",
      "locked in instead of quietly evaporating.",
      "Counts only, no package names: this repository is public. See",
      "docs/dependency-policy.md.",
      "Regenerating after a count rises is not remediation. It is raising the ceiling,",
      "and it needs a reviewer to agree in the pull request.",
    ],
    generated: new Date().toISOString().slice(0, 10),
    scopes: Object.fromEntries(SCOPE_NAMES.map((scope) => [scope, actual[scope]])),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/** Every severity whose count moved, in either direction. */
function diff(actual, baseline) {
  const worse = [];
  const better = [];
  for (const scope of SCOPE_NAMES) {
    for (const severity of SEVERITIES) {
      const now = actual[scope][severity];
      const was = baseline[scope][severity];
      if (now > was) worse.push({ scope, severity, now, was });
      else if (now < was) better.push({ scope, severity, now, was });
    }
  }
  return { worse, better };
}

function main() {
  const write = process.argv.includes("--write");

  const actual = {};
  for (const scope of SCOPE_NAMES) {
    const counts = runAudit(scope);
    if (!counts) {
      console.error(`\`npm ${SCOPES[scope].join(" ")}\` did not return a report.`);
      console.error("That usually means the registry is unreachable or the lockfile is out of");
      console.error("date. This check fails rather than assuming zero, because assuming zero");
      console.error("would silently reset the ratchet. Run `npm ci` and try again.");
      return 1;
    }
    actual[scope] = counts;
  }

  if (write) {
    const payload = writeBaseline(actual);
    console.log(`Wrote ${relative(REPO_ROOT, BASELINE_PATH)}`);
    for (const scope of SCOPE_NAMES) {
      console.log(`  ${scope}: ${total(payload.scopes[scope])} total (${summarise(payload.scopes[scope])})`);
    }
    return 0;
  }

  const baseline = readBaseline();
  if (!baseline) {
    console.error(`Missing or unreadable ${relative(REPO_ROOT, BASELINE_PATH)}.`);
    console.error("Run `npm run lint:deps:write` to generate it.");
    return 1;
  }

  const { worse, better } = diff(actual, baseline);

  if (worse.length > 0) {
    console.error("The dependency vulnerability surface grew.\n");
    for (const { scope, severity, now, was } of worse) {
      console.error(`  ${scope}  ${severity}: ${was} -> ${now}`);
    }
    console.error("\nEither something you added pulled in a vulnerable package, or an advisory");
    console.error("was published upstream against something already here. `npm audit` tells you");
    console.error("which; it is not repeated in this output or in the baseline, because this");
    console.error("repository is public.");
    console.error("\nFix it by removing or upgrading the dependency. Regenerating the baseline");
    console.error("raises the ceiling instead, so it needs a reviewer to agree in the PR.");
    if (worse.some((entry) => entry.scope === "runtime")) {
      console.error("\nAt least one of these is in `runtime`, which means it reaches anyone who");
      console.error("installs a published @stratum-hq package. Treat it as the higher priority.");
    }
    return 1;
  }

  if (better.length > 0) {
    console.log("The dependency vulnerability surface shrank. Lock the improvement in:\n");
    for (const { scope, severity, now, was } of better) {
      console.log(`  ${scope}  ${severity}: ${was} -> ${now}`);
    }
    console.log("\nRun `npm run lint:deps:write` and commit the baseline.");
    return 1;
  }

  const held = SCOPE_NAMES.map((scope) => `${scope} ${total(actual[scope])}`).join(", ");
  console.log(`Dependency policy holds (${held}).`);
  for (const scope of SCOPE_NAMES) {
    console.log(`  ${scope}: ${summarise(actual[scope])}`);
  }
  return 0;
}

process.exit(main());
