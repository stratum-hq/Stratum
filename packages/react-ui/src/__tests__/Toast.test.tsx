import React from "react";
import { render, within, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Toast } from "../components/Toast.js";

afterEach(() => {
  cleanup();
});

describe("Toast", () => {
  it("renders without crashing and matches snapshot", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Toast message="Operation successful" type="success" onDismiss={onDismiss} autoDismiss={0} />,
    );
    expect(container).toMatchSnapshot();
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
