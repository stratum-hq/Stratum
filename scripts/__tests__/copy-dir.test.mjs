// `cp -r src/x dist/x` copies into `dist/x/x` when `dist/x` already exists, and
// it leaves the old top-level files in place. A rebuild without a clean then
// ships stale migrations or styles. These tests run the copy step twice, the
// way a rebuild does, and check the result against the source.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const COPY_DIR = join(SCRIPTS_DIR, "copy-dir.mjs");
const PACKAGES_DIR = join(SCRIPTS_DIR, "..", "packages");

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "copy-dir-"));
  mkdirSync(join(work, "src", "migrations"), { recursive: true });
  writeFileSync(join(work, "src", "migrations", "001_init.sql"), "-- v1\n");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function copy() {
  execFileSync(process.execPath, [COPY_DIR, "src/migrations", "dist/migrations"], { cwd: work });
}

const dest = (...parts) => join(work, "dist", "migrations", ...parts);

describe("copy-dir.mjs", () => {
  it("creates the destination and its parent when they do not exist", () => {
    copy();
    expect(readFileSync(dest("001_init.sql"), "utf8")).toBe("-- v1\n");
  });

  it("does not nest the source inside the destination on a second run", () => {
    copy();
    copy();
    expect(existsSync(dest("migrations"))).toBe(false);
  });

  it("replaces a top-level file that changed in the source since the last run", () => {
    copy();
    writeFileSync(join(work, "src", "migrations", "001_init.sql"), "-- v2\n");
    copy();
    expect(readFileSync(dest("001_init.sql"), "utf8")).toBe("-- v2\n");
  });

  it("removes a file that the source no longer contains", () => {
    writeFileSync(join(work, "src", "migrations", "002_old.sql"), "-- old\n");
    copy();
    rmSync(join(work, "src", "migrations", "002_old.sql"));
    copy();
    expect(existsSync(dest("002_old.sql"))).toBe(false);
  });

  it("exits non-zero and names the source when the source directory does not exist", () => {
    copy();
    let error;
    try {
      execFileSync(process.execPath, [COPY_DIR, "src/missing", "dist/migrations"], {
        cwd: work,
        stdio: "pipe",
      });
    } catch (e) {
      error = e;
    }
    expect(error?.status).toBe(1);
    expect(String(error?.stderr)).toContain("source directory not found: src/missing");
    // A wrong source path must not delete the output of the previous build.
    expect(existsSync(dest("001_init.sql"))).toBe(true);
  });
});

// The copy step is only idempotent if the packages call the script.
describe("package build scripts that copy source directories into dist", () => {
  const scripts = (dir) =>
    JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8")).scripts;

  it.each([
    ["lib", "build", "src/migrations dist/migrations"],
    ["react-ui", "postbuild", "src/styles dist/styles"],
  ])("packages/%s %s copies with copy-dir.mjs", (dir, name, args) => {
    const script = scripts(dir)[name];
    expect(script).toContain(`node ../../scripts/copy-dir.mjs ${args}`);
    expect(script).not.toMatch(/\bcp\b/);
  });
});
