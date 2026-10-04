import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import { installApiMock } from "./test-api.js";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
}

function drawer(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("#tenant-drawer");
  if (!el) throw new Error("tenant drawer not rendered");
  return el;
}

describe("App tenant drawer", () => {
  beforeEach(() => {
    installApiMock();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("makes the closed drawer inert on a phone, so its controls leave the tab order", async () => {
    setViewportWidth(390);
    const { container } = render(<App />);
    await waitFor(() => expect(drawer(container)).toHaveAttribute("inert"));

    fireEvent.click(screen.getByRole("button", { name: "Open tenant list" }));
    expect(drawer(container)).not.toHaveAttribute("inert");
  });

  it("closes the open drawer on Escape and returns focus to the menu button", async () => {
    setViewportWidth(390);
    const { container } = render(<App />);
    const menu = screen.getByRole("button", { name: "Open tenant list" });
    fireEvent.click(menu);

    fireEvent.keyDown(drawer(container), { key: "Escape" });

    expect(drawer(container)).toHaveAttribute("inert");
    expect(menu).toHaveFocus();
  });

  it("shows the tenant list without a drawer on a wide screen", () => {
    setViewportWidth(1440);
    const { container } = render(<App />);
    expect(container.querySelector("#tenant-drawer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open tenant list" })).toBeNull();
  });
});
