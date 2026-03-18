import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { PermissionEditor } from "./PermissionEditor.js";
import { MockStratumProvider, mockPermissions } from "./storybook-helpers.js";

const meta: Meta<typeof PermissionEditor> = {
  title: "Components/PermissionEditor",
  component: PermissionEditor,
  parameters: {
    docs: {
      description: {
        component:
          "Table-based editor for tenant permission policies. " +
          "Shows each permission's key, value, mode (LOCKED / INHERITED / DELEGATED), " +
          "source tenant, and status badges. Locked permissions cannot be removed. " +
          "Supports adding new permissions with configurable mode and revocation policy.",
      },
    },
  },
  decorators: [
    (Story) => (
      <MockStratumProvider initialTenantId="00000000-0000-0000-0000-000000000003">
        <div style={{ padding: "24px", maxWidth: 900 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PermissionEditor>;

/**
 * Default state with a realistic mix of permission modes.
 * - LOCKED: tenant.manage and audit.read (set by root, cannot be changed)
 * - INHERITED: config.write and users.invite (flow from ancestor)
 * - DELEGATED: billing.view and webhooks.manage (delegated to this tenant)
 */
export const Default: Story = {
  args: {},
};

/**
 * Loading state while permissions are being resolved through
 * the inheritance chain.
 */
export const Loading: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider
        initialTenantId="00000000-0000-0000-0000-000000000003"
        loading={true}
      >
        <div style={{ padding: "24px", maxWidth: 900 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * Empty state when no permission policies have been defined.
 * Only the table headers and the "Add" form are visible.
 */
export const Empty: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider
        initialTenantId="00000000-0000-0000-0000-000000000003"
        permissions={[]}
      >
        <div style={{ padding: "24px", maxWidth: 900 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * All permissions locked by the root tenant. No "Remove" actions
 * are available. This represents a leaf tenant with fully restricted
 * permission management.
 */
export const AllLocked: Story = {
  args: {},
  decorators: [
    (Story) => {
      const allLocked = mockPermissions.map((p) => ({
        ...p,
        mode: "LOCKED" as const,
        locked: true,
        delegated: false,
        source_tenant_id: "00000000-0000-0000-0000-000000000001",
      }));
      return (
        <MockStratumProvider
          initialTenantId="00000000-0000-0000-0000-000000000003"
          permissions={allLocked}
        >
          <div style={{ padding: "24px", maxWidth: 900 }}>
            <Story />
          </div>
        </MockStratumProvider>
      );
    },
  ],
};

/**
 * All permissions delegated to this tenant, meaning the tenant
 * has full control and can remove any of them.
 */
export const AllDelegated: Story = {
  args: {},
  decorators: [
    (Story) => {
      const allDelegated = mockPermissions.map((p) => ({
        ...p,
        mode: "DELEGATED" as const,
        locked: false,
        delegated: true,
        source_tenant_id: "00000000-0000-0000-0000-000000000003",
      }));
      return (
        <MockStratumProvider
          initialTenantId="00000000-0000-0000-0000-000000000003"
          permissions={allDelegated}
        >
          <div style={{ padding: "24px", maxWidth: 900 }}>
            <Story />
          </div>
        </MockStratumProvider>
      );
    },
  ],
};
