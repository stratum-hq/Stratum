// A published package installs its siblings from the registry, not from this
// workspace. An open range such as "*" or ">=1.0.0" lets npm keep any version a
// consumer already has, including one that lacks the API the dependent calls,
// or a future major. This test reads every package, so a sibling dependency
// added later is covered with no change here.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages");

/** Dependency fields that npm resolves when a consumer installs the package. */
const INSTALLED_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

const CARET_RANGE = /^\^(\d+)\.(\d+)\.(\d+)$/;

const manifests = readdirSync(PACKAGES_DIR)
  .map((dir) => join(PACKAGES_DIR, dir, "package.json"))
  .filter((file) => existsSync(file))
  .map((file) => JSON.parse(readFileSync(file, "utf8")));

const versions = new Map(manifests.map((pkg) => [pkg.name, pkg.version]));

const siblingRanges = manifests
  .filter((pkg) => !pkg.private)
  .flatMap((pkg) =>
    INSTALLED_FIELDS.flatMap((field) =>
      Object.entries(pkg[field] ?? {})
        .filter(([name]) => versions.has(name))
        .map(([name, range]) => ({ from: pkg.name, field, name, range })),
    ),
  );

/** Returns true when `version` is inside the caret range `^major.minor.patch`. */
function caretAccepts(range, version) {
  const [, ...low] = CARET_RANGE.exec(range).map(Number);
  const cur = version.split(".").map(Number);
  // A caret range holds the first non-zero component fixed.
  const fixed = low[0] > 0 ? 1 : low[1] > 0 ? 2 : 3;
  for (let i = 0; i < fixed; i++) if (cur[i] !== low[i]) return false;
  for (let i = fixed; i < 3; i++) if (cur[i] !== low[i]) return cur[i] > low[i];
  return true;
}

describe("sibling @stratum-hq dependency ranges in published packages", () => {
  it("finds sibling dependencies to check", () => {
    expect(siblingRanges.length).toBeGreaterThan(0);
  });

  it.each(siblingRanges)("$from $field $name uses a caret range ($range)", ({ range }) => {
    expect(range).toMatch(CARET_RANGE);
  });

  it.each(siblingRanges)("$from $field $name $range accepts the workspace version", ({
    name,
    range,
  }) => {
    expect(CARET_RANGE.test(range) && caretAccepts(range, versions.get(name))).toBe(true);
  });
});
