#!/usr/bin/env node
// Replace a build output directory with a fresh copy of a source directory.
//
// Usage: node copy-dir.mjs <source> <destination>
//
// `cp -r src dest` copies into `dest/src` when `dest` already exists, so a
// rebuild without a clean nests the copy and keeps the old top-level files.
// This script removes the destination first, so every run gives the same
// result. It uses Node instead of a shell so the build also runs on Windows.

import { cpSync, existsSync, rmSync } from "node:fs";

const [source, destination] = process.argv.slice(2);

if (!source || !destination) {
  console.error("Usage: node copy-dir.mjs <source> <destination>");
  process.exit(2);
}

// Check first: otherwise a wrong source path deletes the old output and copies nothing.
if (!existsSync(source)) {
  console.error(`copy-dir: source directory not found: ${source}`);
  process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
