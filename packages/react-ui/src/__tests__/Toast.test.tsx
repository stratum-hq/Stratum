import React from "react";
import { render, within, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Toast } from "../components/Toast.js";
import { ToastContainer } from "../components/ToastContainer.js";

afterEach(() => {
  cleanup();
});

describe("Toast", () => {
  it("renders without crashing", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Toast message="Operation successful" type="success" onDismiss={onDismiss} autoDismiss={0} />,
    );
    expect(container.querySelector(".stratum-toast")).toBeInTheDocument();
    expect(container.textContent).toContain("Operation successful");
  });

  it("displays the message text", () => {
    const onDismiss = vi.fn();
    const { getByText } = render(
      <Toast message="Something went wrong" type="error" onDismiss={onDismiss} />,
    );
    expect(getByText("Something went wrong")).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Toast message="Info message" type="info" onDismiss={onDismiss} autoDismiss={0} />,
    );
    fireEvent.click(within(container).getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders error type with correct role", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Toast message="Error occurred" type="error" onDismiss={onDismiss} />,
    );
    expect(within(container).getByRole("alert")).toBeInTheDocument();
  });
});

describe("Toast live region", () => {
  it("gives an error toast the alert role and no conflicting aria-live", () => {
    const { container } = render(<Toast message="Could not save" type="error" onDismiss={vi.fn()} />);
    expect(within(container).getByRole("alert")).not.toHaveAttribute("aria-live");
  });

  it("gives a success toast the status role", () => {
    const { container } = render(<Toast message="Saved" type="success" onDismiss={vi.fn()} autoDismiss={0} />);
    expect(within(container).getByRole("status")).not.toHaveAttribute("aria-live");
    expect(within(container).queryByRole("alert")).toBeNull();
  });

  it("keeps the raw error message available behind a details control", () => {
    const { container } = render(
      <Toast
        message="Could not save the key."
        detail="duplicate key value violates unique constraint"
        type="error"
        onDismiss={vi.fn()}
      />,
    );
    const details = container.querySelector("details.stratum-toast__details")!;
    expect(details).not.toBeNull();
    expect(details.querySelector("summary")!.textContent).toBe("Details");
    expect(details.textContent).toContain("duplicate key value violates unique constraint");
  });

  it("renders no details control when there is no detail", () => {
    const { container } = render(<Toast message="Could not save" type="error" onDismiss={vi.fn()} />);
    expect(container.querySelector("details")).toBeNull();
  });
});

describe("ToastContainer", () => {
  it("does not wrap the toasts in a second live region", () => {
    const { container } = render(
      <ToastContainer toasts={[{ id: "1", message: "Saved", type: "success" }]} onDismiss={vi.fn()} />,
    );
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(within(container).getByRole("region", { name: "Notifications" })).toBeInTheDocument();
  });

  it("passes the detail of a toast to the toast", () => {
    const { container } = render(
      <ToastContainer
        toasts={[{ id: "1", message: "Could not save", type: "error", detail: "raw" }]}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector("details")!.textContent).toContain("raw");
  });
});
