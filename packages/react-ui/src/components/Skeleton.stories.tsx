import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Skeleton } from "./Skeleton.js";
import { TableSkeleton } from "./TableSkeleton.js";

const meta: Meta<typeof Skeleton> = {
  title: "Components/Skeleton",
  component: Skeleton,
  parameters: {
    docs: {
      description: {
        component:
          "Placeholder loading skeleton used while data is being fetched. " +
          "Supports text, rectangle, and circle variants with customizable " +
          "dimensions and count. Used internally by TableSkeleton.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

/**
 * Text variant — default skeleton for loading text lines.
 * Full width, 13px height matching the base font size.
 */
export const Text: Story = {
  args: {
    variant: "text",
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px", maxWidth: 400 }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * Multiple text lines simulating a paragraph or list loading state.
 */
export const TextMultipleLines: Story = {
  args: {
    variant: "text",
    count: 4,
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px", maxWidth: 400 }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * Rectangle variant — for cards, images, or block-level placeholders.
 */
export const Rect: Story = {
  args: {
    variant: "rect",
    width: "300px",
    height: "120px",
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px" }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * Circle variant — for avatar or icon placeholders.
 */
export const Circle: Story = {
  args: {
    variant: "circle",
    width: "48px",
    height: "48px",
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px" }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * Composite layout: avatar circle next to text lines,
 * simulating a tenant detail card loading state.
 */
export const CompositeLayout: Story = {
  render: () => (
    <div style={{ padding: "24px", maxWidth: 400 }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <Skeleton variant="circle" width="40px" height="40px" />
        <div style={{ flex: 1 }}>
          <Skeleton variant="text" width="60%" />
          <div style={{ height: "8px" }} />
          <Skeleton variant="text" width="40%" />
        </div>
      </div>
      <div style={{ marginTop: "16px" }}>
        <Skeleton variant="rect" height="80px" />
      </div>
    </div>
  ),
};

/**
 * Custom sizing with small dimensions for inline placeholders.
 */
export const CustomSizing: Story = {
  args: {
    variant: "text",
    width: "120px",
    height: "10px",
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px" }}>
        <Story />
      </div>
    ),
  ],
};

// ---------------------------------------------------------------------------
// TableSkeleton stories
// ---------------------------------------------------------------------------

const tableMeta: Meta<typeof TableSkeleton> = {
  title: "Components/TableSkeleton",
  component: TableSkeleton,
  parameters: {
    docs: {
      description: {
        component:
          "Table placeholder shown while config or permission data is loading. " +
          "Uses Skeleton components in a table layout with configurable row and column counts.",
      },
    },
  },
};

// We export the table stories under a second meta via a named story export
// pattern. Storybook CSF only supports one default export per file, so
// TableSkeleton stories are included here as additional stories.

/**
 * Default TableSkeleton with 5 rows and 4 columns, matching the
 * ConfigEditor table layout.
 */
export const TableDefault: StoryObj<typeof TableSkeleton> = {
  render: () => (
    <div style={{ padding: "24px", maxWidth: 900 }}>
      <TableSkeleton rows={5} columns={4} />
    </div>
  ),
};

/**
 * Config-style table skeleton with 5 columns (Key, Value, Source, Status, Actions).
 */
export const TableConfigLayout: StoryObj<typeof TableSkeleton> = {
  render: () => (
    <div style={{ padding: "24px", maxWidth: 900 }}>
      <TableSkeleton rows={7} columns={5} />
    </div>
  ),
};

/**
 * Minimal skeleton — 2 rows, 2 columns.
 */
export const TableMinimal: StoryObj<typeof TableSkeleton> = {
  render: () => (
    <div style={{ padding: "24px", maxWidth: 400 }}>
      <TableSkeleton rows={2} columns={2} />
    </div>
  ),
};
