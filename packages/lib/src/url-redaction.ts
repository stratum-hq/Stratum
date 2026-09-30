import crypto from "node:crypto";

// scheme://[userinfo@]host[:port]path — the same expression migration 030 uses,
// applied to the raw string so the write path and the migration agree exactly.
const SCHEME_AUTHORITY_PATH = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)(?:[^/?#]*@)?([^/?#]*)([^?#]*)/;
// A value already in redacted form is kept, so redaction is idempotent.
const ALREADY_REDACTED = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#@]+\/#fp=[0-9a-f]{12}$/;

/**
 * Reduces a URL to a form safe to record: `scheme://host/` when the path is
 * empty or "/", otherwise `scheme://host/#fp=<fingerprint>`, where the
 * fingerprint is the first 12 hex characters of sha256 of the raw path. Userinfo,
 * path, query string and fragment are dropped because they often carry access
 * tokens. A URL without a host (for example `mailto:`) becomes "[REDACTED]".
 */
export function redactUrlForAudit(url: string): string {
  if (ALREADY_REDACTED.test(url)) return url;
  const match = SCHEME_AUTHORITY_PATH.exec(url);
  if (!match || match[2] === "") return "[REDACTED]";
  const [, scheme, host, path] = match;
  if (path === "" || path === "/") return `${scheme}${host}/`;
  const fingerprint = crypto.createHash("sha256").update(path, "utf8").digest("hex").slice(0, 12);
  return `${scheme}${host}/#fp=${fingerprint}`;
}
