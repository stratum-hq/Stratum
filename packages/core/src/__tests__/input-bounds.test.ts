import { describe, it, expect } from "vitest";
import { CreateAbacPolicyInputSchema } from "../types/abac.js";
import { GrantConsentInputSchema } from "../types/consent.js";
import { RecordUsageInputSchema, UsageAggregateQuerySchema } from "../types/usage.js";
import { AuditLogQuerySchema, RecordAuditEventInputSchema } from "../types/audit.js";

// Each input schema must reject every value its database column rejects.
// A value that passes the schema and then fails in PostgreSQL reaches the
// caller as a server error instead of a validation error.

const policy = (priority: unknown) => ({
  name: "p",
  resource_type: "document",
  action: "read",
  effect: "allow",
  conditions: [],
  priority,
});

describe("CreateAbacPolicyInputSchema priority", () => {
  it("accepts the int4 minimum and maximum", () => {
    expect(CreateAbacPolicyInputSchema.safeParse(policy(-2147483648)).success).toBe(true);
    expect(CreateAbacPolicyInputSchema.safeParse(policy(2147483647)).success).toBe(true);
  });

  it("rejects a priority above the int4 maximum", () => {
    expect(CreateAbacPolicyInputSchema.safeParse(policy(2147483648)).success).toBe(false);
    expect(CreateAbacPolicyInputSchema.safeParse(policy(3e9)).success).toBe(false);
  });

  it("rejects a priority below the int4 minimum", () => {
    expect(CreateAbacPolicyInputSchema.safeParse(policy(-2147483649)).success).toBe(false);
  });
});

const consent = (expires_at: unknown) => ({
  subject_id: "user-1",
  purpose: "analytics",
  expires_at,
});

describe("GrantConsentInputSchema expires_at", () => {
  it("accepts an ISO 8601 datetime in UTC or with an offset", () => {
    expect(GrantConsentInputSchema.safeParse(consent("2027-01-01T00:00:00Z")).success).toBe(true);
    expect(GrantConsentInputSchema.safeParse(consent("2027-01-01T00:00:00+02:00")).success).toBe(true);
  });

  it("accepts an omitted expires_at", () => {
    expect(GrantConsentInputSchema.safeParse({ subject_id: "user-1", purpose: "analytics" }).success).toBe(true);
  });

  it("rejects a string that is not a datetime", () => {
    expect(GrantConsentInputSchema.safeParse(consent("next tuesday")).success).toBe(false);
  });

  it("rejects the PostgreSQL special inputs infinity and epoch", () => {
    expect(GrantConsentInputSchema.safeParse(consent("infinity")).success).toBe(false);
    expect(GrantConsentInputSchema.safeParse(consent("-infinity")).success).toBe(false);
    expect(GrantConsentInputSchema.safeParse(consent("epoch")).success).toBe(false);
  });

  it("rejects year 0000, which PostgreSQL has no value for", () => {
    expect(GrantConsentInputSchema.safeParse(consent("0000-06-01T00:00:00Z")).success).toBe(false);
  });

  it("rejects a datetime without a time zone", () => {
    expect(GrantConsentInputSchema.safeParse(consent("2027-01-01T00:00:00")).success).toBe(false);
  });
});

describe("RecordUsageInputSchema quantity", () => {
  it("accepts the largest safe integer", () => {
    expect(
      RecordUsageInputSchema.safeParse({ metric: "calls", quantity: Number.MAX_SAFE_INTEGER }).success,
    ).toBe(true);
  });

  it("rejects a quantity above the largest safe integer", () => {
    expect(RecordUsageInputSchema.safeParse({ metric: "calls", quantity: 1e19 }).success).toBe(false);
    expect(RecordUsageInputSchema.safeParse({ metric: "calls", quantity: 1e21 }).success).toBe(false);
  });
});

describe("datetime inputs stored in TIMESTAMPTZ columns", () => {
  const yearZero = "0000-06-01T00:00:00Z";
  const valid = "0001-01-01T00:00:00Z";
  const auditEvent = (occurredAt: string) => ({
    tenantId: "00000000-0000-4000-8000-000000000001",
    actorId: "a",
    action: "x",
    resourceType: "r",
    resourceId: null,
    occurredAt,
  });

  it("accepts year 0001, the first year PostgreSQL stores", () => {
    expect(RecordUsageInputSchema.safeParse({ metric: "calls", occurred_at: valid }).success).toBe(true);
    expect(AuditLogQuerySchema.safeParse({ from: valid }).success).toBe(true);
    expect(RecordAuditEventInputSchema.safeParse(auditEvent(valid)).success).toBe(true);
  });

  it("rejects year 0000 in usage occurred_at and query bounds", () => {
    expect(RecordUsageInputSchema.safeParse({ metric: "calls", occurred_at: yearZero }).success).toBe(false);
    const tenant_id = "00000000-0000-4000-8000-000000000001";
    expect(UsageAggregateQuerySchema.safeParse({ tenant_id, from: yearZero }).success).toBe(false);
    expect(UsageAggregateQuerySchema.safeParse({ tenant_id, to: yearZero }).success).toBe(false);
  });

  it("rejects year 0000 in audit query bounds and occurredAt", () => {
    expect(AuditLogQuerySchema.safeParse({ from: yearZero }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ to: yearZero }).success).toBe(false);
    expect(RecordAuditEventInputSchema.safeParse(auditEvent(yearZero)).success).toBe(false);
  });
});
