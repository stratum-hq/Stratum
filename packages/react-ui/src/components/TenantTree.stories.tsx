import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { TenantTree } from "./TenantTree.js";
import {
  MockStratumProvider,
  mockTenants,
  deepHierarchyTenants,
  singleRootTenant,
} from "./storybook-helpers.js";

const meta: Meta<typeof TenantTree> = {
  title: "Components/TenantTree",
  component: TenantTree,
  parameters: {
    docs: {
      description: {
        component:
          "Interactive tree view of the tenant hierarchy. " +
          "Nodes can be expanded/collapsed to reveal children. " +
          "Displays RLS badges and archived status indicators.",
      },
    },
  },
  decorators: [
    (Story) => (
      <MockStratumProvider>
        <div style={{ padding: "24px", maxWidth: 500 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TenantTree>;

/**
 * Default 3-level hierarchy: Acme Corp -> MSSP/Direct channels ->
 * MSPs and clients. Expand nodes to browse the tree.
 */
export const Default: Story = {
  args: {
    onSelect: (id: string) => console.log("Selected tenant:", id),
  },
};

/**
 * Loading state while the tenant tree is being fetched from the API.
 */
export const Loading: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider loading={true}>
        <div style={{ padding: "24px", maxWidth: 500 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * Empty state when no tenants exist in the hierarchy.
 */
export const Empty: Story = {
  args: {},
  decorators: [
    (Story) => (
      <MockStratumProvider tenants={[]}>
        <div style={{ padding: "24px", maxWidth: 500 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * Deep 5-level hierarchy: Global Platform -> Region -> MSSP -> MSP -> Client.
 * Tests indentation and readability at deep nesting levels.
 */
export const DeepHierarchy: Story = {
  args: {
    onSelect: (id: string) => console.log("Selected tenant:", id),
  },
  decorators: [
    (Story) => (
      <MockStratumProvider tenants={deepHierarchyTenants}>
        <div style={{ padding: "24px", maxWidth: 500 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};

/**
 * Single root node with no children. Minimal tree display.
 */
export const SingleRootNode: Story = {
  args: {
    onSelect: (id: string) => console.log("Selected tenant:", id),
  },
  decorators: [
    (Story) => (
      <MockStratumProvider tenants={singleRootTenant}>
        <div style={{ padding: "24px", maxWidth: 500 }}>
          <Story />
        </div>
      </MockStratumProvider>
    ),
  ],
};
