import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StratumProvider } from "@stratum-hq/react";
import { Dashboard } from "./Dashboard.js";
import { installApiMock, MSP_ID } from "../test-api.js";

// This test has a file of its own. Vitest gives each file a new module graph, and the
// race does not occur after some of the tests in Dashboard.test.tsx have run in the same
// file.
describe("Dashboard tab selection", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps a tab click that lands right after the tabs first render", async () => {
    installApiMock();
    // React runs effects in a later task when its scheduler sees that time has passed.
    // A clock that moves 3 ms per read makes the scheduler yield after every commit,
    // as it does on a busy CI runner. The scheduler reads performance.now on each call,
    // so the stub acts at once, and the finally block removes it. The stub starts at the
    // real time, because a clock that goes back makes the scheduler never yield.
    const realNow = performance.now;
    let fakeTime = realNow.call(performance);
    performance.now = () => (fakeTime += 3);
    // The click happens in the microtask after the commit that adds the tabs to the DOM,
    // before React runs the effects of that commit.
    let clicked = false;
    const observer = new MutationObserver(() => {
      const tab = document.getElementById("tab-api-keys");
      if (tab && !clicked) {
        clicked = true;
        fireEvent.click(tab);
      }
    });
    try {
      observer.observe(document.body, { childList: true, subtree: true });
      render(
        <StratumProvider controlPlaneUrl="" initialTenantId={MSP_ID}>
          <Dashboard />
        </StratumProvider>,
      );
      // vi.waitFor, not findBy: the findBy helpers change how React runs updates while
      // they wait, and that hides the race.
      await vi.waitFor(() => expect(clicked).toBe(true));
      await vi.waitFor(() => expect(screen.getByText("siem-ingest")).toBeInTheDocument());
      expect(screen.getByRole("tab", { name: "API keys" })).toHaveAttribute("aria-selected", "true");
    } finally {
      observer.disconnect();
      performance.now = realNow;
    }
  });
});
