// The pre-push hook must scan the commits a push sends, not the working tree or
// the index. These tests build a throwaway repository, plant a fake token in
// it, and run the real scanner and the real hook against commit ranges.
//
// The fake token is joined at runtime, so its full shape never appears in this
// file. That keeps `npm run lint:secrets` clean without an allowlist entry.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_TOKEN = "gh" + "p_" + "0123456789abcdefghij0123456789ABCDEF";
const ZERO_SHA = "0".repeat(40);

// The fixture must not read the developer's global git config or hooks.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

let repo;

function git(...args) {
  const result = spawnSync("git", args, { cwd: repo, env: GIT_ENV, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(path, contents) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), contents);
  git("add", "-A");
  git("commit", "-q", "-m", `edit ${path}`);
  return git("rev-parse", "HEAD");
}

function remove(path) {
  git("rm", "-q", path);
  git("commit", "-q", "-m", `remove ${path}`);
  return git("rev-parse", "HEAD");
}

function scanRange(range) {
  return spawnSync(process.execPath, ["scripts/check-secrets.mjs", "--range", range], {
    cwd: repo,
    env: GIT_ENV,
    encoding: "utf8",
  });
}

function prePush(localSha, remoteSha) {
  const line = `refs/heads/feature ${localSha} refs/heads/feature ${remoteSha}\n`;
  return spawnSync("sh", [".githooks/pre-push", "origin", "https://example.invalid/repo.git"], {
    cwd: repo,
    env: GIT_ENV,
    input: line,
    encoding: "utf8",
  });
}

let base;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "check-secrets-range-"));
  git("init", "-q", "-b", "main");
  for (const file of ["check-secrets.mjs", "secret-rules.mjs", "secret-allowlist.json"]) {
    cpSync(join(REPO_ROOT, "scripts", file), join(repo, "scripts", file));
  }
  cpSync(join(REPO_ROOT, ".githooks"), join(repo, ".githooks"), { recursive: true });
  base = commit("README.md", "fixture\n");
  // The hook finds the merge base of a new branch through the remote's main.
  git("update-ref", "refs/remotes/origin/main", base);
  git("checkout", "-q", "-b", "feature");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("check-secrets --range", () => {
  it("flags a token that a commit in the range adds", () => {
    const tip = commit("src/config.js", `export const token = "${FAKE_TOKEN}";\n`);
    const result = scanRange(`${base}..${tip}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/config.js");
    expect(result.stderr).toContain(tip.slice(0, 12));
  });

  it("passes a range whose commits add no token", () => {
    const tip = commit("src/config.js", "export const token = process.env.TOKEN;\n");
    const result = scanRange(`${base}..${tip}`);
    expect(result.stdout + result.stderr).toMatch(/No secrets found/);
    expect(result.status).toBe(0);
  });

  it("flags a token that a later commit in the same range removes", () => {
    commit("src/config.js", `export const token = "${FAKE_TOKEN}";\n`);
    const tip = remove("src/config.js");
    const result = scanRange(`${base}..${tip}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/config.js");
  });

  it("ignores a token that entered history before the range starts", () => {
    const old = commit("src/config.js", `export const token = "${FAKE_TOKEN}";\n`);
    const tip = commit("src/other.js", "export const x = 1;\n");
    const result = scanRange(`${old}..${tip}`);
    expect(result.status).toBe(0);
  });
});

describe(".githooks/pre-push", () => {
  it("blocks a new branch whose commits add a token", () => {
    const tip = commit("src/config.js", `export const token = "${FAKE_TOKEN}";\n`);
    const result = prePush(tip, ZERO_SHA);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/config.js");
  });

  it("blocks an update whose new commits add a token", () => {
    const pushed = commit("src/clean.js", "export const x = 1;\n");
    const tip = commit("src/config.js", `export const token = "${FAKE_TOKEN}";\n`);
    const result = prePush(tip, pushed);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/config.js");
  });

  it("allows an update whose new commits add no token", () => {
    const pushed = commit("src/clean.js", "export const x = 1;\n");
    const tip = commit("src/other.js", "export const y = 2;\n");
    const result = prePush(tip, pushed);
    expect(result.stderr).not.toContain("push blocked");
    expect(result.status).toBe(0);
  });

  it("blocks a new branch with a fetch hint when no merge base with the default branch is known", () => {
    const tip = commit("src/clean.js", "export const x = 1;\n");
    git("update-ref", "-d", "refs/remotes/origin/main");
    const result = prePush(tip, ZERO_SHA);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("git fetch origin");
    expect(result.stdout).not.toContain("scanning");
  });

  it("finds the merge base through the remote HEAD when it names a branch other than main", () => {
    git("update-ref", "refs/remotes/origin/dev", base);
    git("update-ref", "-d", "refs/remotes/origin/main");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/dev");
    const tip = commit("src/clean.js", "export const x = 1;\n");
    const result = prePush(tip, ZERO_SHA);
    expect(result.stdout).toContain(`${base}..${tip}`);
    expect(result.status).toBe(0);
  });
});
