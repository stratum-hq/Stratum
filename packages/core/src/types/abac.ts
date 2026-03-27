import { z } from "zod";

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

export const CreateAbacPolicyInputSchema = z.object({
  name: z.string().min(1),
  resource_type: z.string().min(1),
  action: z.string().min(1),
  effect: z.enum(["allow", "deny"]),
  conditions: z.array(z.object({
    attribute: z.string().min(1),
    operator: z.enum(["eq", "neq", "in", "not_in", "contains", "gt", "gte", "lt", "lte"]),
    value: z.unknown(),
  })),
  priority: z.number().int().optional(),
  mode: z.enum(["LOCKED", "INHERITED", "DELEGATED"]).optional(),
});

export const AbacEvaluationRequestSchema = z.object({
  subject: z.record(z.unknown()),
  action: z.string().min(1),
  resource: z.record(z.unknown()),
});

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
