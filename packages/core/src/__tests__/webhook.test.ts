import { describe, it, expect } from "vitest";
import {
  TenantEvent,
  WebhookSchema,
  CreateWebhookInputSchema,
  UpdateWebhookInputSchema,
  WebhookDeliveryStatus,
  WebhookDeliverySchema,
} from "../types/webhook.js";

describe("TenantEvent", () => {
  it("has correct string values", () => {
    expect(TenantEvent.TENANT_CREATED).toBe("tenant.created");
    expect(TenantEvent.TENANT_UPDATED).toBe("tenant.updated");
    expect(TenantEvent.TENANT_DELETED).toBe("tenant.deleted");
    expect(TenantEvent.TENANT_MOVED).toBe("tenant.moved");
    expect(TenantEvent.CONFIG_UPDATED).toBe("config.updated");
    expect(TenantEvent.CONFIG_DELETED).toBe("config.deleted");
    expect(TenantEvent.PERMISSION_CREATED).toBe("permission.created");
    expect(TenantEvent.PERMISSION_UPDATED).toBe("permission.updated");
    expect(TenantEvent.PERMISSION_DELETED).toBe("permission.deleted");
  });

  it("has 9 event types", () => {
    expect(Object.keys(TenantEvent)).toHaveLength(9);
  });
});

describe("WebhookSchema", () => {
  const validWebhook = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    tenant_id: "550e8400-e29b-41d4-a716-446655440001",
    url: "https://example.com/webhook",
    secret_hash: "abc123def456",
    events: ["tenant.created", "tenant.updated"],
    active: true,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  };

  it("parses a valid webhook", () => {
    const result = WebhookSchema.safeParse(validWebhook);
    expect(result.success).toBe(true);
  });

  it("accepts null tenant_id (global webhook)", () => {
    const result = WebhookSchema.safeParse({ ...validWebhook, tenant_id: null });
    expect(result.success).toBe(true);
  });

  it("accepts optional description", () => {
    const result = WebhookSchema.safeParse({ ...validWebhook, description: "My webhook" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("My webhook");
    }
  });

  it("rejects description over 255 chars", () => {
    const result = WebhookSchema.safeParse({ ...validWebhook, description: "x".repeat(256) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid URL", () => {
    const result = WebhookSchema.safeParse({ ...validWebhook, url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    const result = WebhookSchema.safeParse({ ...validWebhook, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("CreateWebhookInputSchema", () => {
  const validInput = {
    tenant_id: null,
    url: "https://example.com/webhook",
    secret: "mysecretatleast16chars",
    events: [TenantEvent.TENANT_CREATED],
  };

  it("parses valid input", () => {
    const result = CreateWebhookInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects secret shorter than 16 chars", () => {
    const result = CreateWebhookInputSchema.safeParse({ ...validInput, secret: "tooshort" });
    expect(result.success).toBe(false);
  });

  it("rejects secret longer than 255 chars", () => {
    const result = CreateWebhookInputSchema.safeParse({ ...validInput, secret: "x".repeat(256) });
    expect(result.success).toBe(false);
  });

  it("rejects empty events array", () => {
    const result = CreateWebhookInputSchema.safeParse({ ...validInput, events: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid event type", () => {
    const result = CreateWebhookInputSchema.safeParse({ ...validInput, events: ["unknown.event"] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid URL", () => {
    const result = CreateWebhookInputSchema.safeParse({ ...validInput, url: "ftp://bad" });
    expect(result.success).toBe(false);
  });

  it("defaults tenant_id to null", () => {
    const { tenant_id: _t, ...withoutTenantId } = validInput;
    const result = CreateWebhookInputSchema.safeParse(withoutTenantId);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tenant_id).toBeNull();
    }
  });

  it("accepts a description", () => {
    const result = CreateWebhookInputSchema.safeParse({ ...validInput, description: "Test hook" });
    expect(result.success).toBe(true);
  });
});

describe("UpdateWebhookInputSchema", () => {
  it("accepts empty object (no-op update)", () => {
    const result = UpdateWebhookInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial updates", () => {
    const result = UpdateWebhookInputSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
  });

  it("rejects events with invalid event type", () => {
    const result = UpdateWebhookInputSchema.safeParse({ events: ["bad.event"] });
    expect(result.success).toBe(false);
  });

  it("rejects empty events array", () => {
    const result = UpdateWebhookInputSchema.safeParse({ events: [] });
    expect(result.success).toBe(false);
  });
});

describe("WebhookDeliveryStatus", () => {
  it("has correct values", () => {
    expect(WebhookDeliveryStatus.PENDING).toBe("pending");
    expect(WebhookDeliveryStatus.SUCCESS).toBe("success");
    expect(WebhookDeliveryStatus.FAILED).toBe("failed");
  });
});

describe("WebhookDeliverySchema", () => {
  const validDelivery = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    webhook_id: "550e8400-e29b-41d4-a716-446655440001",
    event_id: "550e8400-e29b-41d4-a716-446655440002",
    status: "pending" as const,
    attempts: 0,
    next_retry_at: null,
    last_error: null,
    response_code: null,
    created_at: "2024-01-01T00:00:00.000Z",
    completed_at: null,
  };

  it("parses a valid pending delivery", () => {
    const result = WebhookDeliverySchema.safeParse(validDelivery);
    expect(result.success).toBe(true);
  });

  it("parses a successful delivery", () => {
    const result = WebhookDeliverySchema.safeParse({
      ...validDelivery,
      status: "success",
      attempts: 1,
      response_code: 200,
      completed_at: "2024-01-01T00:00:01.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = WebhookDeliverySchema.safeParse({ ...validDelivery, status: "retrying" });
    expect(result.success).toBe(false);
  });

  it("rejects negative attempts", () => {
    const result = WebhookDeliverySchema.safeParse({ ...validDelivery, attempts: -1 });
    expect(result.success).toBe(false);
  });
});
