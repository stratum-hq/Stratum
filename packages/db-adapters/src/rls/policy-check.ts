/**
 * Decides whether an existing tenant_isolation policy restricts rows to the
 * current tenant, from the expressions PostgreSQL stores in pg_policies.
 *
 * `createPolicy` uses this before it skips creating a policy that already
 * exists, because a policy's name proves nothing about what it checks.
 *
 * The check recognises the form this package generates, with the operands in
 * either order, with casts, inside an AND with other conditions, and ORed with
 * Stratum's administrative bypass. Anything else is reported as not filtering
 * by tenant, so an unusual but correct policy is refused, never accepted.
 */

/** One row of pg_policies. */
export interface PolicyRow {
  policyname: string;
  /** "PERMISSIVE" or "RESTRICTIVE". */
  permissive: string;
  /** "ALL", "SELECT", "INSERT", "UPDATE" or "DELETE". */
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

/** The session setting that holds the current tenant (see rls/session.ts). */
const TENANT_SETTING = "app.current_tenant_id";
/** The setting Stratum's own policies admit for administrative access. */
const BYPASS_SETTING = "app.bypass_rls";

/** Drops whitespace and casts, lower-cases, and keeps string literals intact. */
function normalize(expr: string): string {
  let out = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") {
      const end = expr.indexOf("'", i + 1);
      const stop = end === -1 ? expr.length : end + 1;
      out += expr.slice(i, stop);
      i = stop - 1;
    } else if (!/\s/.test(ch)) {
      out += ch.toLowerCase();
    }
  }
  // Casts such as ::text, ::uuid and ::character varying (spaces already gone).
  return out.replace(/::[a-z_]+(?:\[\])?/g, "");
}

/** Index of the parenthesis that closes the one at `open`. */
function closingParen(expr: string, open: number): number {
  let depth = 0;
  for (let i = open; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") {
      const end = expr.indexOf("'", i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Removes parentheses that wrap the whole expression. */
function stripOuterParens(expr: string): string {
  let e = expr;
  while (e.startsWith("(") && e.endsWith(")") && closingParen(e, 0) === e.length - 1) {
    e = e.slice(1, -1);
  }
  return e;
}

/**
 * Splits a normalized expression on a top-level boolean operator. Whitespace
 * is gone, so the operator is found between a closing parenthesis and an
 * opening one, which is how PostgreSQL prints every operand of AND / OR.
 */
function splitTopLevel(expr: string, op: "and" | "or"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") {
      const end = expr.indexOf("'", i + 1);
      if (end === -1) break;
      i = end;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && expr.startsWith(`${op}(`, i + 1)) {
        parts.push(expr.slice(start, i + 1));
        start = i + 1 + op.length;
      }
    }
  }
  parts.push(expr.slice(start));
  return parts.map(stripOuterParens);
}

/** Removes every parenthesis; only safe on an operand with no AND / OR in it. */
function flatten(expr: string): string {
  return expr.replace(/[()]/g, "");
}

const SETTING_READ = `current_setting'${TENANT_SETTING.replace(".", "\\.")}'(?:,(?:true|false))?`;
/** The current tenant, read directly or through NULLIF(..., ''). */
const CURRENT_TENANT = `(?:nullif${SETTING_READ},''|${SETTING_READ})`;
const TENANT_MATCH = new RegExp(`^(?:tenant_id=${CURRENT_TENANT}|${CURRENT_TENANT}=tenant_id)$`);
const BYPASS_MATCH = new RegExp(
  `^current_setting'${BYPASS_SETTING.replace(".", "\\.")}'(?:,(?:true|false))?='on'$`,
);

/** True when the normalized expression only admits rows of the current tenant. */
function filtersByTenant(expr: string): boolean {
  const e = stripOuterParens(expr);

  const disjuncts = splitTopLevel(e, "or");
  if (disjuncts.length > 1) {
    // Every branch must be safe; Stratum's administrative bypass is one of them.
    return (
      disjuncts.every((d) => BYPASS_MATCH.test(flatten(d)) || filtersByTenant(d)) &&
      disjuncts.some((d) => !BYPASS_MATCH.test(flatten(d)))
    );
  }

  const conjuncts = splitTopLevel(e, "and");
  if (conjuncts.length > 1) {
    return conjuncts.some((c) => filtersByTenant(c));
  }

  return TENANT_MATCH.test(flatten(e));
}

/** An expression on one line, for messages. */
function oneLine(expr: string | null): string {
  return expr === null ? "none" : expr.replace(/\s+/g, " ");
}

/**
 * Why an existing policy does not restrict every command to the current
 * tenant, or null when it does. The policy must be permissive and apply to
 * ALL commands, like the one `createPolicy` creates.
 */
export function tenantPolicyIssue(p: PolicyRow): string | null {
  const name = `policy "${oneLine(p.policyname)}"`;
  if (p.permissive !== "PERMISSIVE") {
    return `${name} is ${p.permissive.toLowerCase()}, not permissive`;
  }
  if (p.cmd !== "ALL") {
    return `${name} applies to ${p.cmd} only, not ALL commands`;
  }
  if (p.qual === null || !filtersByTenant(normalize(p.qual))) {
    return `${name} USING (${oneLine(p.qual)}) does not filter by tenant`;
  }
  // A missing WITH CHECK means PostgreSQL reuses USING for writes.
  if (p.with_check !== null && !filtersByTenant(normalize(p.with_check))) {
    return `${name} WITH CHECK (${oneLine(p.with_check)}) does not filter by tenant`;
  }
  return null;
}
