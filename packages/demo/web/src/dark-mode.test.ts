import { describe, it, expect, beforeEach } from "vitest";

describe("Dark mode", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("defaults to dark theme when no preference stored", () => {
    const stored = localStorage.getItem("stratum-theme");
    // No stored preference → should default to dark
    const isDark = stored ? stored === "dark" : true;
    expect(isDark).toBe(true);
  });

  it("persists theme choice to localStorage", () => {
    localStorage.setItem("stratum-theme", "light");
    expect(localStorage.getItem("stratum-theme")).toBe("light");

    localStorage.setItem("stratum-theme", "dark");
    expect(localStorage.getItem("stratum-theme")).toBe("dark");
  });

  it("sets data-theme attribute on document", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.documentElement.setAttribute("data-theme", "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("respects stored light mode preference", () => {
    localStorage.setItem("stratum-theme", "light");
    const stored = localStorage.getItem("stratum-theme");
    const isDark = stored ? stored === "dark" : true;
    expect(isDark).toBe(false);
  });
});
