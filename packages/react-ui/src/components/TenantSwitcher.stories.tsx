import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { TenantSwitcher } from "./TenantSwitcher.js";
import {
  MockStratumProvider,
  mockTenants,
  generateManyTenants,
} from "./storybook-helpers.js";

const meta: Meta<typeof TenantSwitcher> = {
  title: "Components/TenantSwitcher",
  component: TenantSwitcher,
  parameters: {
    docs: {
      description: {
        component:
          "Dropdown for switching between tenants in a hierarchical tree. " +
          "Shows tenant names indented by depth with a search filter. " +
          "Connects to the Stratum API via StratumProvider context.",
      },
    },
  },
  decorators: [
    (Story, context) => {
      const {
        tenants = mockTenants,
        initialTenantId,
        loading = false,
      } = (context.args as Record<string, unknown>) ?? {};
      return (
        <MockStratumProvider
          tenants={tenants as typeof mockTenants}
          initialTenantId={initialTenantId as string | undefined}
          loading={loading as boolean}
        >
          <div style={{ padding: "24px", maxWidth: 400 }}>
            <Story />
          </div>
        </MockStratumProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof TenantSwitcher>;

/**
 * Default state with a realistic MSSP/MSP/client hierarchy.
 * Click the trigger to open the dropdown and browse the tenant tree.
 */
export const Default: Story = {
  args: {
    onTenantChange: (id: string) => console.log("Switched to:", id),
  },
};

/**
 * Loading state shown while tenant list is being fetched.
 */
export const Loading: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider loading={true}>
        <div style={{ padding: "24px", maxWidth: 400 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * Empty state when no tenants exist yet.
 * The dropdown opens but shows an empty list.
 */
export const Empty: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider tenants={[]}>
        <div style={{ padding: "24px", maxWidth: 400 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * Stress test with 25+ tenants to verify scrolling, search filtering,
 * and performance with a large tenant list.
 */
export const ManyTenants: Story = {
  args: {
    onTenantChange: (id: string) => console.log("Switched to:", id),
  },
  decorators: [
    (Story) => (
      <MockStratumProvider tenants={generateManyTenants(25)}>
        <div style={{ padding: "24px", maxWidth: 400 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * With a pre-selected tenant. The trigger shows "CyberShield MSP"
 * and the dropdown highlights it as the active selection.
 */
export const WithSelectedTenant: Story = {
  args: {
    onTenantChange: (id: string) => console.log("Switched to:", id),
  },
  decorators: [
    (Story) => (
      <MockStratumProvider initialTenantId="00000000-0000-0000-0000-000000000003">
        <div style={{ padding: "24px", maxWidth: 400 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};
