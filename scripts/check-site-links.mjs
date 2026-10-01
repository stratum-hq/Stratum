#!/usr/bin/env node
// Check the internal links of the built landing and docs sites.
//
// Usage: node scripts/check-site-links.mjs [<dist dir>=<origin> ...]
//
// With no arguments, it checks landing/dist as https://stratum-hq.org and
// website/dist as https://docs.stratum-hq.org. Build both sites first.
//
// A link is internal when its origin is one of the checked sites, so a link
// from the landing site to the docs site is checked against the docs build.
// External links are not fetched. The check reports two problems:
//   broken    no built file answers the path.
//   redirect  the path has no trailing slash, but a directory page answers it.
//             Both sites redirect that form to the slash form, which costs a
//             round trip and does not match the canonical URL.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SITES = [
  { dir: "landing/dist", origin: "https://stratum-hq.org" },
  { dir: "website/dist", origin: "https://docs.stratum-hq.org" },
];

// Attribute values that point at a page or an asset. Meta tags are not read:
// og:url and og:image hold absolute URLs that the canonical link also states.
const LINK_ATTR =
  /<(?:a|link|img|script|source|iframe)\b[^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;

// A 404 page states a canonical URL that no built file answers, by design.
const CANONICAL = /\srel\s*=\s*["']?canonical\b/i;

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...htmlFiles(path));
    else if (name.endsWith(".html")) out.push(path);
  }
  return out;
}

/** Returns the site path that a built HTML file serves. */
function pagePath(dir, file) {
  const rel = relative(dir, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel}`;
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** Returns "ok", "redirect", or "broken" for a path on one built site. */
function resolvePath(dir, pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.endsWith("/")) return isFile(join(dir, decoded, "index.html")) ? "ok" : "broken";
  if (isFile(join(dir, decoded))) return "ok";
  if (isFile(join(dir, decoded, "index.html"))) return "redirect";
  return "broken";
}

/**
 * Returns every internal link problem in the given built sites.
 *
 * @param sites - The built sites, as `{ dir, origin }` objects.
 * @returns One `{ kind, page, href }` object per problem link, in file order.
 */
export function checkSites(sites) {
  const problems = [];
  let checked = 0;
  for (const site of sites) {
    for (const file of htmlFiles(site.dir)) {
      const pageUrl = new URL(pagePath(site.dir, file), site.origin);
      const html = readFileSync(file, "utf8");
      const isNotFoundPage = file.endsWith(`${sep}404.html`);
      for (const match of html.matchAll(LINK_ATTR)) {
        if (isNotFoundPage && CANONICAL.test(match[0])) continue;
        const raw = (match[1] ?? match[2]).replace(/&amp;/g, "&").trim();
        if (raw === "" || raw.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(raw)) {
          continue;
        }
        let url;
        try {
          url = new URL(raw, pageUrl);
        } catch {
          problems.push({ kind: "broken", page: pageUrl.href, href: raw });
          continue;
        }
        const target = sites.find((s) => new URL(s.origin).host === url.host);
        if (!target) continue;
        checked++;
        const kind = resolvePath(target.dir, url.pathname);
        if (kind !== "ok") problems.push({ kind, page: pageUrl.href, href: raw });
      }
    }
  }
  return { checked, problems };
}

function parseArgs(args) {
  if (args.length === 0) return DEFAULT_SITES;
  return args.map((arg) => {
    const at = arg.indexOf("=");
    if (at < 1) throw new Error(`expected <dist dir>=<origin>, got: ${arg}`);
    return { dir: arg.slice(0, at), origin: arg.slice(at + 1) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sites = parseArgs(process.argv.slice(2));
  for (const site of sites) {
    if (!existsSync(site.dir)) {
      console.error(`check-site-links: ${site.dir} not found. Build the site first.`);
      process.exit(2);
    }
  }
  const { checked, problems } = checkSites(sites);
  for (const p of problems) console.log(`${p.kind}\t${p.page}\t${p.href}`);
  console.log(
    `check-site-links: ${checked} internal links checked in ${sites.map((s) => s.dir).join(", ")}; ${problems.length} problems`
  );
  process.exit(problems.length > 0 ? 1 : 0);
}
