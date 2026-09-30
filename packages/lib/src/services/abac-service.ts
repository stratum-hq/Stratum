import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import { lockTree } from "./tenant-service.js";
import {
  type AbacCondition,
  type AbacPolicy,
  type CreateAbacPolicyInput,
  type AbacEvaluationRequest,
  type AbacEvaluationResult,
  type ResolvedAbacPolicy,
  AbacPolicyNotFoundError,
  AbacPolicyLockedError,
  InvalidAbacOperatorError,
  TenantNotFoundError,
  parseAncestryPath,
  appendToPath,
} from "@stratum-hq/core";

// ---------------------------------------------------------------------------
// Pure evaluation functions
// ---------------------------------------------------------------------------

/**
 * Evaluate a single ABAC condition against an attribute context.
 * Returns false when the attribute is missing from context.
 * Throws InvalidAbacOperatorError for unknown operators.
 */
export function evaluateCondition(
  condition: AbacCondition,
  context: Record<string, unknown>,
): boolean {
  if (!(condition.attribute in context)) {
    return false;
  }
  const attr = context[condition.attribute];
  const val = condition.value;

  switch (condition.operator) {
    case "eq":
      return attr === val;

    case "neq":
      return attr !== val;

    case "in":
      return Array.isArray(val) && val.includes(attr);

    case "not_in":
      return Array.isArray(val) && !val.includes(attr);

    case "contains":
      return Array.isArray(attr) && attr.includes(val);

    case "gt":
      return typeof attr === "number" && typeof val === "number" && attr > val;

    case "gte":
      return typeof attr === "number" && typeof val === "number" && attr >= val;

    case "lt":
      return typeof attr === "number" && typeof val === "number" && attr < val;

    case "lte":
      return typeof attr === "number" && typeof val === "number" && attr <= val;

    default:
      throw new InvalidAbacOperatorError(String(condition.operator));
  }
}

/**
 * Evaluate all conditions for a policy against a context (AND semantics).
 * Empty conditions array → true (open policy).
 */
export function evaluatePolicy(
  policy: AbacPolicy,
  context: Record<string, unknown>,
): boolean {
  if (policy.conditions.length === 0) {
    return true;
  }
  return policy.conditions.every((c) => evaluateCondition(c, context));
}

// ---------------------------------------------------------------------------
// Hierarchical resolution
// ---------------------------------------------------------------------------

/**
 * Resolve effective ABAC policies for a tenant by batch-loading all ancestor
 * policies in a single query and walking root→leaf (same pattern as resolvePermissions).
 */
export async function resolveAbacPolicies(
  pool: pg.Pool,
  tenantId: string,
): Promise<ResolvedAbacPolicy[]> {
  return withClient(pool, async (client) => {
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(tenantId);
    }

    const ancestryPath = tenantRes.rows[0].ancestry_path;
    const ancestorIds = parseAncestryPath(ancestryPath);
    const allIds = [...ancestorIds, tenantId];

    const policiesRes = await client.query<AbacPolicy>(
      `SELECT * FROM abac_policies WHERE tenant_id = ANY($1) ORDER BY priority DESC`,
      [allIds],
    );

    // Group by tenant_id preserving ancestor order
    const byTenant = new Map<string, AbacPolicy[]>();
    for (const id of allIds) {
      byTenant.set(id, []);
    }
    for (const policy of policiesRes.rows) {
      const list = byTenant.get(policy.tenant_id);
      if (list) {
        list.push(policy);
      }
    }

    // Walk root→leaf applying LOCKED/INHERITED/DELEGATED mode semantics.
    // We track policies by (resource_type + action + name) composite key so
    // that descendants cannot override a LOCKED policy. A descendant's policies
    // replace an ancestor's for the same composite, but every policy a single
    // tenant holds for that composite is kept, so a same-name deny is never
    // dropped in favour of a same-name allow from the same tenant.
    const resolvedMap = new Map<string, ResolvedAbacPolicy[]>();

    for (const currentTenantId of allIds) {
      const policies = byTenant.get(currentTenantId) ?? [];

      for (const policy of policies) {
        const compositeKey = `${policy.resource_type}:${policy.action}:${policy.name}`;
        const existing = resolvedMap.get(compositeKey) ?? [];

        if (existing.some((r) => r.locked && r.source_tenant_id !== currentTenantId)) {
          // Locked by an ancestor — descendants cannot override it
          continue;
        }

        const resolvedPolicy: ResolvedAbacPolicy = {
          policy,
          source_tenant_id: currentTenantId,
          locked: policy.mode === "LOCKED",
          delegated: policy.mode === "DELEGATED",
        };
        const sameTenant = existing.filter((r) => r.source_tenant_id === currentTenantId);
        resolvedMap.set(compositeKey, [...sameTenant, resolvedPolicy]);
      }
    }

    return Array.from(resolvedMap.values()).flat();
  });
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate an ABAC request against the resolved policies for a tenant.
 * - Deny overrides allow.
 * - Policies sorted by priority (higher first).
 * - Default deny if no policy matches.
 * - Supports '*' wildcard for resource_type or action.
 */
export async function evaluateAbac(
  pool: pg.Pool,
  tenantId: string,
  request: AbacEvaluationRequest,
): Promise<AbacEvaluationResult> {
  const resolved = await resolveAbacPolicies(pool, tenantId);

  // Filter to matching resource_type + action (with '*' wildcard support)
  const matching = resolved.filter(({ policy }) => {
    const resourceMatch =
      policy.resource_type === "*" ||
      policy.resource_type === (request.resource.type ?? request.resource.resource_type);
    const actionMatch =
      policy.action === "*" || policy.action === request.action;
    return resourceMatch && actionMatch;
  });

  if (matching.length === 0) {
    return { allowed: false, reason: "no_matching_policy" };
  }

  // Build the attribute context. Subject and resource keep separate namespaces:
  // `subject.<name>` and `resource.<name>` always read their own side. A bare
  // `<name>` reads whichever side carries it; when both do, the reference is
  // ambiguous and the request is denied rather than letting one side's value
  // stand in for the other's.
  const context: Record<string, unknown> = {};
  const ambiguous = new Set<string>();
  const isQualified = (key: string) =>
    key.startsWith("subject.") || key.startsWith("resource.");
  for (const [key, value] of Object.entries(request.subject)) {
    if (!isQualified(key)) context[key] = value;
  }
  for (const [key, value] of Object.entries(request.resource)) {
    if (isQualified(key)) continue;
    if (Object.prototype.hasOwnProperty.call(request.subject, key)) {
      ambiguous.add(key);
      delete context[key];
    } else {
      context[key] = value;
    }
  }
  for (const [key, value] of Object.entries(request.subject)) {
    context[`subject.${key}`] = value;
  }
  for (const [key, value] of Object.entries(request.resource)) {
    context[`resource.${key}`] = value;
  }

  const usesAmbiguousAttribute = matching.some(({ policy }) =>
    policy.conditions.some((c) => ambiguous.has(c.attribute)),
  );
  if (usesAmbiguousAttribute) {
    return { allowed: false, reason: "ambiguous_attribute" };
  }

  // Sort by priority descending
  const sorted = [...matching].sort(
    (a, b) => b.policy.priority - a.policy.priority,
  );

  // Evaluate each policy; collect matches
  const matchedAllow: ResolvedAbacPolicy[] = [];
  const matchedDeny: ResolvedAbacPolicy[] = [];

  for (const resolved of sorted) {
    if (evaluatePolicy(resolved.policy, context)) {
      if (resolved.policy.effect === "deny") {
        matchedDeny.push(resolved);
      } else {
        matchedAllow.push(resolved);
      }
    }
  }

  // Deny overrides allow
  if (matchedDeny.length > 0) {
    return {
      allowed: false,
      matched_policy: matchedDeny[0].policy,
      reason: "explicit_deny",
    };
  }

  if (matchedAllow.length > 0) {
    return {
      allowed: true,
      matched_policy: matchedAllow[0].policy,
      reason: "explicit_allow",
    };
  }

  return { allowed: false, reason: "no_matching_policy" };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new ABAC policy for a tenant.
 * Rejects if an ancestor policy with the same composite key is LOCKED.
 */
export async function createAbacPolicy(
  pool: pg.Pool,
  tenantId: string,
  input: CreateAbacPolicyInput,
): Promise<AbacPolicy> {
  return withTransaction(pool, async (client) => {
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenantRes.rows.length === 0) {
      throw new TenantNotFoundError(tenantId);
    }

    const ancestorIds = parseAncestryPath(tenantRes.rows[0].ancestry_path);
    if (ancestorIds.length > 0) {
      const lockedRes = await client.query<AbacPolicy>(
        `SELECT * FROM abac_policies
         WHERE tenant_id = ANY($1)
           AND name = $2
           AND resource_type = $3
           AND action = $4
           AND mode = 'LOCKED'`,
        [ancestorIds, input.name, input.resource_type, input.action],
      );
      if (lockedRes.rows.length > 0) {
        const locker = lockedRes.rows[0];
        throw new AbacPolicyLockedError(input.name, locker.source_tenant_id);
      }
    }

    const res = await client.query<AbacPolicy>(
      `INSERT INTO abac_policies
         (tenant_id, name, resource_type, action, effect, conditions, priority, mode, source_tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $1)
       RETURNING *`,
      [
        tenantId,
        input.name,
        input.resource_type,
        input.action,
        input.effect,
        JSON.stringify(input.conditions),
        input.priority ?? 0,
        input.mode ?? "INHERITED",
      ],
    );

    return res.rows[0];
  });
}

/**
 * Get all ABAC policies owned by a tenant (non-resolved, own policies only).
 */
export async function getAbacPolicies(
  pool: pg.Pool,
  tenantId: string,
): Promise<AbacPolicy[]> {
  return withClient(pool, async (client) => {
    const res = await client.query<AbacPolicy>(
      `SELECT * FROM abac_policies WHERE tenant_id = $1 ORDER BY priority DESC, created_at ASC`,
      [tenantId],
    );
    return res.rows;
  });
}

/**
 * Delete an ABAC policy, with CASCADE: removes descendant policies sharing
 * the same (resource_type, action, name) composite.
 */
export async function deleteAbacPolicy(
  pool: pg.Pool,
  tenantId: string,
  policyId: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<AbacPolicy>(
      `SELECT * FROM abac_policies WHERE id = $1 AND tenant_id = $2`,
      [policyId, tenantId],
    );
    if (existing.rows.length === 0) {
      throw new AbacPolicyNotFoundError(policyId);
    }
    const policy = existing.rows[0];

    // Cascade: delete from all descendants. Match descendants by the stable,
    // ID-based ancestry_path so revocation reaches all current descendants
    // regardless of any slug rename. ancestry_ltree is derived from slugs and
    // must not scope revocation. A prefix match lets
    // idx_tenant_ancestry_path_prefix (028) serve the query.
    await lockTree(client, "shared");
    const tenantRes = await client.query<{ ancestry_path: string }>(
      `SELECT ancestry_path FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const subtreePath = appendToPath(tenantRes.rows[0].ancestry_path, tenantId);
    const descendantsRes = await client.query<{ id: string }>(
      `SELECT id FROM tenants
       WHERE ancestry_path = $1 OR ancestry_path LIKE $2`,
      [subtreePath, `${subtreePath}/%`],
    );
    const descendantIds = descendantsRes.rows.map((r) => r.id);

    if (descendantIds.length > 0) {
      await client.query(
        `DELETE FROM abac_policies
         WHERE tenant_id = ANY($1)
           AND resource_type = $2
           AND action = $3
           AND name = $4`,
        [descendantIds, policy.resource_type, policy.action, policy.name],
      );
    }

    await client.query(
      `DELETE FROM abac_policies WHERE id = $1`,
      [policyId],
    );
  });
}
