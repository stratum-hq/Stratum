import { describe, it, expect } from "vitest";
import type {
  ConfigInheritanceEntry,
  PermissionEntry,
  WebhookEntry,
  TabId,
} from "./types";

describe("Demo section types", () => {
  it("TabId includes all 7 tabs", () => {
    const tabs: TabId[] = [
      "overview",
      "config",
      "permissions",
      "events",
      "audit",
      "api-keys",
      "webhooks",
    ];
    // Type check — if this compiles, all tabs are valid
    expect(tabs).toHaveLength(7);
  });

  it("ConfigInheritanceEntry shape is correct", () => {
    const entry: ConfigInheritanceEntry = {
      key: "max_users",
      value: 100,
      source_tenant_id: "abc-123",
      inherited: true,
      locked: false,
    };
    expect(entry.key).toBe("max_users");
    expect(entry.inherited).toBe(true);
    expect(entry.locked).toBe(false);
  });

  it("PermissionEntry includes delegation modes", () => {
    const locked: PermissionEntry = {
      policy_id: "p1",
      key: "manage_users",
      value: true,
      mode: "LOCKED",
      source_tenant_id: "root",
      locked: true,
      delegated: false,
    };
    expect(locked.mode).toBe("LOCKED");
    expect(locked.locked).toBe(true);

    const delegated: PermissionEntry = {
      policy_id: "p2",
      key: "custom_reports",
      value: true,
      mode: "DELEGATED",
      source_tenant_id: "msp",
      locked: false,
      delegated: true,
    };
    expect(delegated.mode).toBe("DELEGATED");
    expect(delegated.delegated).toBe(true);
  });

  it("WebhookEntry has required fields", () => {
    const webhook: WebhookEntry = {
      id: "wh-1",
      tenant_id: "t-1",
      url: "https://example.com/webhook",
      events: ["tenant.created", "config.updated"],
      active: true,
      secret: "whsec_abc123",
      created_at: "2026-03-21T00:00:00Z",
    };
    expect(webhook.events).toHaveLength(2);
    expect(webhook.active).toBe(true);
    expect(webhook.url).toMatch(/^https:/);
  });
});
