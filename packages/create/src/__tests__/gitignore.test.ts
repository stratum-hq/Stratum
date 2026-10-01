import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createProject, type Template } from "../index.js";
import { createPresetProject } from "../preset-project.js";
import { VALID_COMBINATIONS, formatPresetString, ormsFor, type Database, type StackPreset } from "../matrix.js";

// The generated README tells the user to copy .env.example to .env and to
// put secrets in it. Every generated project therefore ignores .env, and
// keeps .env.example tracked as the template of the settings.

const TEMPLATES: Template[] = ["express", "fastify", "nextjs"];

function allPresets(): StackPreset[] {
  const out: StackPreset[] = [];
  for (const [database, config] of Object.entries(VALID_COMBINATIONS)) {
    for (const strategy of config.strategies)
      for (const orm of ormsFor(database as Database, strategy))
        for (const framework of config.frameworks)
          out.push({ database: database as Database, strategy, orm, framework });
  }
  return out;
}

let tmp: string;
const projects: Array<{ label: string; prisma: boolean; gitignore: string | null }> = [];

function readGitignore(dir: string): string | null {
  const file = path.join(dir, ".gitignore");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-gitignore-test-"));
  const log = console.log;
  console.log = () => {};
  try {
    for (const template of TEMPLATES) {
      const dir = path.join(tmp, `template-${template}`);
      fs.mkdirSync(dir);
      createProject("app", template, dir, true);
      projects.push({ label: `${template} template`, prisma: false, gitignore: readGitignore(dir) });
    }
    for (const preset of allPresets()) {
      const name = formatPresetString(preset);
      const dir = path.join(tmp, name);
      fs.mkdirSync(dir);
      createPresetProject("app", preset, dir, true);
      projects.push({ label: `${name} preset`, prisma: preset.orm === "prisma", gitignore: readGitignore(dir) });
    }
  } finally {
    console.log = log;
  }
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function lines(gitignore: string): string[] {
  return gitignore
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

describe("the generated .gitignore", () => {
  it("is written by every template and every preset", () => {
    expect(projects.length).toBe(TEMPLATES.length + allPresets().length);
    for (const p of projects) expect(p.gitignore, p.label).not.toBeNull();
  });

  it("ignores .env and .env.*, and keeps .env.example tracked", () => {
    for (const p of projects) {
      const entries = lines(p.gitignore ?? "");
      expect(entries, p.label).toContain(".env");
      expect(entries, p.label).toContain(".env.*");
      // A negation re-includes a file only after the pattern that excludes it.
      expect(entries.indexOf("!.env.example"), p.label).toBeGreaterThan(entries.indexOf(".env.*"));
    }
  });

  it("ignores dependencies, build output, logs and .DS_Store", () => {
    for (const p of projects) {
      const entries = lines(p.gitignore ?? "");
      for (const entry of ["node_modules/", "dist/", ".next/", "out/", "*.log", ".DS_Store"]) {
        expect(entries, `${p.label}: ${entry}`).toContain(entry);
      }
    }
  });

  it("ignores the generated Prisma client only in the Prisma presets", () => {
    expect(projects.some((p) => p.prisma)).toBe(true);
    for (const p of projects) {
      expect(lines(p.gitignore ?? "").includes("src/generated/prisma/"), p.label).toBe(p.prisma);
    }
  });

  it("makes git ignore .env and .env.local and keep .env.example, for each distinct file", () => {
    const distinct = [...new Set(projects.map((p) => p.gitignore ?? ""))];
    for (const [i, content] of distinct.entries()) {
      const repo = path.join(tmp, `git-${i}`);
      fs.mkdirSync(repo);
      expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
      fs.writeFileSync(path.join(repo, ".gitignore"), content);
      const ignored = (file: string) => spawnSync("git", ["check-ignore", "-q", file], { cwd: repo }).status === 0;
      expect(ignored(".env")).toBe(true);
      expect(ignored(".env.local")).toBe(true);
      expect(ignored(".env.example")).toBe(false);
      expect(ignored("src/index.ts")).toBe(false);
    }
  });
});
