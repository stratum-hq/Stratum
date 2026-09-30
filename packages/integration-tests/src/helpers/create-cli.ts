import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CREATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../create");

/**
 * Returns the absolute path of the built `@stratum-hq/create` CLI entry.
 * The path comes from the package's `bin` field, so a move of the entry
 * cannot leave the tests on a stale file.
 */
export function createCliEntry(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(CREATE_DIR, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const entries = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
  if (entries.length !== 1) {
    throw new Error(`@stratum-hq/create must declare exactly one bin entry, found ${entries.length}`);
  }
  return path.resolve(CREATE_DIR, entries[0]);
}

/**
 * Returns the directory of a project that the built CLI generates in `cwd`.
 * Throws if the CLI exits non-zero or writes no project directory. Without
 * this check, a CLI that does nothing shows up later as an unrelated ENOENT.
 */
export function scaffoldProject(cwd: string, project: string, preset: string): string {
  const entry = createCliEntry();
  const res = spawnSync(process.execPath, [entry, project, "--preset", preset, "--skip-install"], {
    cwd,
    encoding: "utf8",
  });
  const output = `entry: ${entry}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`;
  if (res.error || res.status !== 0) {
    throw new Error(`create CLI failed (status ${res.status}, ${res.error ?? "no spawn error"})\n${output}`);
  }
  const dir = path.join(cwd, project);
  if (!fs.existsSync(dir)) {
    throw new Error(`create CLI exited 0 but generated no project directory at ${dir}\n${output}`);
  }
  return dir;
}
