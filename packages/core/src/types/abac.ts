export type AbacOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export interface AbacCondition {
  attribute: string;
  operator: AbacOperator;
  value: unknown;
}

export interface AbacPolicy {
  id: string;
  tenant_id: string;
  name: string;
  resource_type: string;
  action: string;
  effect: "allow" | "deny";
  conditions: AbacCondition[];
  priority: number;
  mode: "LOCKED" | "INHERITED" | "DELEGATED";
  source_tenant_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAbacPolicyInput {
  name: string;
  resource_type: string;
  action: string;
  effect: "allow" | "deny";
  conditions: AbacCondition[];
  priority?: number;
  mode?: "LOCKED" | "INHERITED" | "DELEGATED";
}

export interface AbacEvaluationRequest {
  subject: Record<string, unknown>;
  action: string;
  resource: Record<string, unknown>;
}

export interface AbacEvaluationResult {
  allowed: boolean;
  matched_policy?: AbacPolicy;
  reason: string;
}

export interface ResolvedAbacPolicy {
  policy: AbacPolicy;
  source_tenant_id: string;
  locked: boolean;
  delegated: boolean;
}
