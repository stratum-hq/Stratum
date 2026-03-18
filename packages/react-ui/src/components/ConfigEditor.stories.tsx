import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { ConfigEditor } from "./ConfigEditor.js";
import {
  MockStratumProvider,
  mockConfigEntries,
  mockLockedConfigEntries,
  mockSensitiveConfigEntries,
} from "./storybook-helpers.js";

const meta: Meta<typeof ConfigEditor> = {
  title: "Components/ConfigEditor",
  component: ConfigEditor,
  parameters: {
    docs: {
      description: {
        component:
          "Table-based editor for tenant configuration values. " +
          "Displays each key's value, source tenant, and inheritance status " +
          "(Own, Inherited, Locked). Inherited values show the source tenant ID. " +
          "Locked values cannot be edited or deleted.",
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
type Story = StoryObj<typeof ConfigEditor>;

/**
 * Default state with a mix of own, inherited, and locked configuration
 * values. Represents a typical mid-level tenant (CyberShield MSP) that
 * inherits SSO and MFA settings from Acme Corp but sets its own billing plan.
 */
export const Default: Story = {
  args: {},
};

/**
 * Loading state shown while config entries are being resolved.
 * In production this shows "Loading config..." while the API
 * resolves the full inheritance chain.
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
 * Empty state when the tenant has no configuration values set
 * and nothing is inherited from parent tenants.
 */
export const Empty: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider
        initialTenantId="00000000-0000-0000-0000-000000000003"
        configEntries={[]}
      >
        <div style={{ padding: "24px", maxWidth: 900 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * All values locked by a parent tenant (e.g., Acme Corp enforcing
 * organization-wide policy). No edit or delete actions are available.
 * The rows are highlighted with a warning background.
 */
export const AllLocked: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider
        initialTenantId="00000000-0000-0000-0000-000000000003"
        configEntries={mockLockedConfigEntries}
      >
        <div style={{ padding: "24px", maxWidth: 900 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * Configuration that includes sensitive values like webhook URLs
 * and API secret keys. These are typically locked and inherited
 * from the root tenant.
 */
export const WithSensitiveValues: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider
        initialTenantId="00000000-0000-0000-0000-000000000003"
        configEntries={mockSensitiveConfigEntries}
      >
        <div style={{ padding: "24px", maxWidth: 900 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};
