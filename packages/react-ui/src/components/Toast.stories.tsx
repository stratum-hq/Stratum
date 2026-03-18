import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { Toast } from "./Toast.js";
import { ToastContainer } from "./ToastContainer.js";
import type { ToastData } from "./Toast.js";

const meta: Meta<typeof Toast> = {
  title: "Components/Toast",
  component: Toast,
  parameters: {
    docs: {
      description: {
        component:
          "Toast notification for user feedback. Positioned top-right via " +
          "ToastContainer. Success/info/warning auto-dismiss after 4 seconds; " +
          "error toasts persist until manually dismissed. Left border colored " +
          "by semantic type.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Toast>;

/**
 * Success toast — used after saving config, creating a tenant, etc.
 * Auto-dismisses after 4 seconds.
 */
export const Success: Story = {
  args: {
    message: "Configuration saved successfully for CyberShield MSP",
    type: "success",
    onDismiss: () => console.log("Toast dismissed"),
    autoDismiss: 0, // Disable in Storybook so it stays visible
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
 * Error toast — used for API failures, permission errors, etc.
 * Does not auto-dismiss; requires manual close.
 */
export const Error: Story = {
  args: {
    message: "Failed to update config: Permission denied. This value is locked by Acme Corp.",
    type: "error",
    onDismiss: () => console.log("Toast dismissed"),
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
 * Warning toast — used for non-critical issues like approaching
 * rate limits or deprecated config keys.
 */
export const Warning: Story = {
  args: {
    message: "API rate limit at 90% (900/1000 requests). Consider upgrading the plan.",
    type: "warning",
    onDismiss: () => console.log("Toast dismissed"),
    autoDismiss: 0,
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
 * Info toast — used for general notifications like tenant context
 * switches or background operations completing.
 */
export const Info: Story = {
  args: {
    message: "Switched to tenant: Northwind Security (SCHEMA_PER_TENANT isolation)",
    type: "info",
    onDismiss: () => console.log("Toast dismissed"),
    autoDismiss: 0,
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
 * All four toast variants displayed together, matching the top-right
 * stacked layout from the ToastContainer.
 */
export const AllVariants: Story = {
  render: () => (
    <div style={{ padding: "24px", maxWidth: 400, display: "flex", flexDirection: "column", gap: "8px" }}>
      <Toast
        message="Tenant created: Globex Industries"
        type="success"
        onDismiss={() => {}}
        autoDismiss={0}
      />
      <Toast
        message="Switched to CyberShield MSP context"
        type="info"
        onDismiss={() => {}}
        autoDismiss={0}
      />
      <Toast
        message="Config key 'app.legacy_mode' is deprecated"
        type="warning"
        onDismiss={() => {}}
        autoDismiss={0}
      />
      <Toast
        message="Failed to delete permission: tenant.manage is locked by root"
        type="error"
        onDismiss={() => {}}
      />
    </div>
  ),
};

/**
 * Interactive ToastContainer demo. Click buttons to trigger different
 * toast types and see the stacking behavior (max 3 visible).
 */
export const InteractiveContainer: Story = {
  render: function InteractiveDemo() {
    const [toasts, setToasts] = useState<ToastData[]>([]);
    let counter = 0;

    const addToast = (message: string, type: ToastData["type"]) => {
      counter += 1;
      const id = `toast-${counter}-${Date.now()}`;
      setToasts((prev) => [{ id, message, type }, ...prev]);
    };

    const dismiss = (id: string) => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    return (
      <div style={{ padding: "24px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "24px" }}>
          <button
            type="button"
            onClick={() => addToast("Config saved for CyberShield MSP", "success")}
            style={{ padding: "8px 16px", borderRadius: "4px", border: "1px solid #059669", background: "#D1FAE5", cursor: "pointer" }}
          >
            Success Toast
          </button>
          <button
            type="button"
            onClick={() => addToast("API error: rate limit exceeded (429)", "error")}
            style={{ padding: "8px 16px", borderRadius: "4px", border: "1px solid #DC2626", background: "#FEE2E2", cursor: "pointer" }}
          >
            Error Toast
          </button>
          <button
            type="button"
            onClick={() => addToast("Permission 'billing.view' expires in 7 days", "warning")}
            style={{ padding: "8px 16px", borderRadius: "4px", border: "1px solid #D97706", background: "#FEF3C7", cursor: "pointer" }}
          >
            Warning Toast
          </button>
          <button
            type="button"
            onClick={() => addToast("Tenant tree refreshed (8 tenants loaded)", "info")}
            style={{ padding: "8px 16px", borderRadius: "4px", border: "1px solid #2563EB", background: "#DBEAFE", cursor: "pointer" }}
          >
            Info Toast
          </button>
        </div>
        <p style={{ color: "#64748B", fontSize: "13px" }}>
          Active toasts: {toasts.length} (max 3 visible)
        </p>
        <ToastContainer toasts={toasts} onDismiss={dismiss} maxVisible={3} />
      </div>
    );
  },
};
