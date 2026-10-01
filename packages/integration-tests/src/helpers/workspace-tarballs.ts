import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Manifest {
  name: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

function readManifest(file: string): Manifest {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

/** The directory of each published workspace package, by package name. */
function workspaceDirs(): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const entry of fs.readdirSync(PACKAGES_DIR)) {
    const file = path.join(PACKAGES_DIR, entry, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = readManifest(file);
    if (!pkg.private) dirs.set(pkg.name, path.join(PACKAGES_DIR, entry));
  }
  return dirs;
}

// One tarball per package and pack directory, so a suite with many projects packs once.
const packed = new Map<string, string>();

function pack(dir: string, dest: string): string {
  const key = `${dest}\0${dir}`;
  const hit = packed.get(key);
  if (hit) return hit;
  const res = spawnSync("npm", ["pack", "--json", "--pack-destination", dest], { cwd: dir, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`npm pack failed in ${dir} (${res.status})\n${res.stdout}\n${res.stderr}`);
  const [{ filename }] = JSON.parse(res.stdout) as { filename: string }[];
  const spec = `file:${path.join(dest, filename)}`;
  packed.set(key, spec);
  return spec;
}

/**
 * Points a generated project at the workspace builds of every `@stratum-hq`
 * package it installs, directly or through another Stratum package.
 *
 * The npm registry does not serve a workspace version between the version PR
 * and the release, and it can serve an older build than the workspace. A
 * project that installs the Stratum packages from tarballs therefore installs
 * and tests the code under test at any time.
 *
 * A direct dependency gets the tarball as its spec. Every Stratum package also
 * gets an override, so that a Stratum package resolves its own Stratum
 * dependencies to the tarballs too. The project keeps its set of direct
 * dependencies, so a type check still finds an import that the project does
 * not declare. Call it before the install. The tarballs go to `packDir`.
 */
export function useWorkspaceStratumPackages(projectDir: string, packDir: string): void {
  const dirs = workspaceDirs();
  const pkgPath = path.join(projectDir, "package.json");
  const pkg = readManifest(pkgPath);
  const direct = [pkg.dependencies, pkg.devDependencies];

  const needed = new Set<string>();
  const queue = direct.flatMap((deps) => Object.keys(deps ?? {})).filter((name) => dirs.has(name));
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (needed.has(name)) continue;
    needed.add(name);
    const deps = readManifest(path.join(dirs.get(name)!, "package.json")).dependencies ?? {};
    queue.push(...Object.keys(deps).filter((dep) => dirs.has(dep)));
  }

  const overrides: Record<string, unknown> = { ...pkg.overrides };
  for (const name of needed) {
    const spec = pack(dirs.get(name)!, packDir);
    const owner = direct.find((deps) => deps && name in deps);
    if (owner) {
      owner[name] = spec;
      // npm refuses an override that differs from the spec of a direct dependency.
      overrides[name] = `$${name}`;
    } else {
      overrides[name] = spec;
    }
  }
  pkg.overrides = overrides;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
}
