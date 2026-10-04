import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StratumProvider } from "@stratum-hq/react";
import { Dashboard } from "./pages/Dashboard.js";
import { Sidebar } from "./components/Sidebar.js";

declare global {
  interface Window {
    /**
     * Demo bootstrap API key, injected at container start by the web entrypoint
     * from the key the seed mints. Empty in local dev (see public/config.js).
     */
    __DEMO_API_KEY__?: string;
  }
}

// Above this width the tenant panel is always visible. Below it, the panel is a drawer.
const WIDE_MIN_WIDTH = 1025;

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= WIDE_MIN_WIDTH);

  useEffect(() => {
    const handler = () => setWide(window.innerWidth >= WIDE_MIN_WIDTH);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return wide;
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem("stratum-theme") !== "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("stratum-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <button type="button" className="demo-button" onClick={() => setDark(!dark)}>
      {dark ? "Light theme" : "Dark theme"}
    </button>
  );
}

/** The Stratum mark: three rock slabs, topsoil, clay and magma (DESIGN.md, Logo). */
function StratumMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path fill="var(--stratum-tree-band-0)" d="M4 9.6 9 10.6 14 8.8 19 7.2 24 8.9 29 10.2 34 10.1 39 8.6 44 7.1 43 29 4 28Z" />
      <path fill="var(--stratum-tree-band-1)" d="M12 26 17 24.5 22 21.9 27 22.8 32 25.6 37 25.5 42 23.8 47 22.3 52 23.9 51 44 12 43Z" />
      <path fill="var(--stratum-accent)" d="M20 38.8 25 37.8 30 37.9 35 40 40 40.5 45 38.2 50 36.8 55 38.9 60 39.7 59 59 20 58Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function App() {
  const wide = useIsWide();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (wide) setDrawerOpen(false);
  }, [wide]);

  // A closed drawer is inert, so its controls leave the tab order and the
  // accessibility tree. An open drawer makes the page behind it inert instead.
  // React 18 has no inert prop, so the attribute is set here.
  useLayoutEffect(() => {
    drawerRef.current?.toggleAttribute("inert", !drawerOpen);
    mainRef.current?.toggleAttribute("inert", drawerOpen);
    if (drawerOpen) {
      drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
  }, [drawerOpen, wide]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    menuRef.current?.focus();
  };

  const sidebar = (
    <Sidebar
      onClose={wide ? undefined : closeDrawer}
      onTenantSelect={wide ? undefined : closeDrawer}
    />
  );

  return (
    <StratumProvider controlPlaneUrl="" apiKey={window.__DEMO_API_KEY__ ?? ""}>
      <div className="demo-app">
        <header className="demo-header">
          {!wide && (
            <button
              ref={menuRef}
              type="button"
              className="demo-icon-button"
              onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
              aria-label={drawerOpen ? "Close tenant list" : "Open tenant list"}
              aria-expanded={drawerOpen}
              aria-controls="tenant-drawer"
            >
              <MenuIcon />
            </button>
          )}
          <span className="demo-brand">
            <StratumMark />
            Stratum
          </span>
          <span className="demo-subtitle">Multi-tenancy engine demo</span>
          <div className="demo-header-end">
            <span className="demo-hierarchy-label">MSSP &rarr; MSP &rarr; Client hierarchy</span>
            <ThemeToggle />
          </div>
        </header>

        <div className="demo-body">
          {wide ? (
            sidebar
          ) : (
            <>
              <div className="demo-scrim" data-open={drawerOpen || undefined} onClick={closeDrawer} />
              <div
                ref={drawerRef}
                id="tenant-drawer"
                className="demo-drawer"
                data-open={drawerOpen || undefined}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeDrawer();
                }}
              >
                {sidebar}
              </div>
            </>
          )}

          <main ref={mainRef} className="demo-main">
            <Dashboard />
          </main>
        </div>
      </div>
    </StratumProvider>
  );
}
