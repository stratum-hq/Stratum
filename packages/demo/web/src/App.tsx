import React, { useState, useEffect } from "react";
import { StratumProvider } from "@stratum-hq/react";
import { Dashboard } from "./pages/Dashboard.js";
import { Sidebar } from "./components/Sidebar.js";

// ── Responsive layout styles ─────────────────────────────────────────────────

const appStyles = `
.stratum-app {
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-50, #f8fafc);
}

.stratum-app-header {
  background: var(--color-900, #0f172a);
  color: white;
  padding: var(--space-sm, 8px) var(--space-xl, 24px);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-800, #1e293b);
  gap: var(--space-md, 12px);
  min-height: 44px;
}

.stratum-app-brand {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-family: var(--font-display, 'Satoshi', sans-serif);
}

.stratum-app-subtitle {
  font-size: 0.8125rem;
  color: var(--color-400, #94a3b8);
  margin-left: var(--space-sm, 8px);
}

.stratum-app-header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-md, 12px);
}

.stratum-app-hierarchy-label {
  font-size: 0.75rem;
  color: var(--color-600, #475569);
}

.stratum-hamburger {
  display: none;
  background: transparent;
  border: none;
  color: var(--color-400, #94A3B8);
  font-size: 1.25rem;
  cursor: pointer;
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
}

.stratum-app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.stratum-app-main {
  flex: 1;
  overflow: auto;
  padding: var(--space-xl, 24px);
}

/* Sidebar overlay for mobile */
.stratum-sidebar-overlay {
  display: none;
}

/* Tablet: collapsible sidebar */
@media (max-width: 1024px) and (min-width: 769px) {
  .stratum-hamburger {
    display: flex;
  }

  .stratum-sidebar {
    transition: width 250ms cubic-bezier(0.4, 0, 0.2, 1),
                opacity 250ms cubic-bezier(0.4, 0, 0.2, 1);
  }
}

/* Mobile: hidden sidebar, full-width content */
@media (max-width: 768px) {
  .stratum-hamburger {
    display: flex;
  }

  .stratum-app-subtitle {
    display: none;
  }

  .stratum-app-hierarchy-label {
    display: none;
  }

  .stratum-app-header {
    padding: var(--space-sm, 8px) var(--space-md, 12px);
  }

  .stratum-app-main {
    padding: var(--space-lg, 16px);
  }

  /* Sidebar as overlay on mobile */
  .stratum-sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(12, 18, 34, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 250ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .stratum-sidebar-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .stratum-mobile-sidebar-wrapper {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
    width: 280px;
  }

  .stratum-mobile-sidebar-wrapper.mobile-open {
    transform: translateX(0);
  }

  .stratum-mobile-sidebar-wrapper > .stratum-sidebar {
    width: 100% !important;
    height: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stratum-sidebar,
  .stratum-sidebar-overlay,
  .stratum-app-body > .stratum-sidebar {
    transition: none !important;
  }
}
`;

function useBreakpoint() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  if (width > 1024) return "desktop" as const;
  if (width > 768) return "tablet" as const;
  return "mobile" as const;
}

export function App() {
  const breakpoint = useBreakpoint();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // On desktop, sidebar is always open. On tablet, default collapsed. On mobile, default closed.
  useEffect(() => {
    if (breakpoint === "desktop") {
      setSidebarOpen(true);
    } else {
      setSidebarOpen(false);
    }
  }, [breakpoint]);

  const handleToggleSidebar = () => setSidebarOpen((prev) => !prev);

  const showSidebar = breakpoint === "desktop" || sidebarOpen;
  const sidebarCollapsed = breakpoint === "tablet" && !sidebarOpen;

  return (
    <StratumProvider controlPlaneUrl="" apiKey="sk_live_demo_key">
      <style>{appStyles}</style>
      <div className="stratum-app">
        <header className="stratum-app-header">
          {breakpoint !== "desktop" && (
            <button
              className="stratum-hamburger"
              onClick={handleToggleSidebar}
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              &#9776;
            </button>
          )}
          <div>
            <span className="stratum-app-brand">Stratum</span>
            <span className="stratum-app-subtitle">Multi-Tenancy Engine Demo</span>
          </div>
          <div className="stratum-app-header-right">
            <span className="stratum-app-hierarchy-label">
              MSSP &rarr; MSP &rarr; Client hierarchy
            </span>
          </div>
        </header>

        <div className="stratum-app-body">
          {/* Mobile overlay backdrop */}
          {breakpoint === "mobile" && (
            <div
              className={`stratum-sidebar-overlay${sidebarOpen ? " visible" : ""}`}
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          {breakpoint === "mobile" ? (
            <div className={`stratum-mobile-sidebar-wrapper${sidebarOpen ? " mobile-open" : ""}`}>
              <Sidebar
                collapsed={false}
                onToggleCollapse={() => setSidebarOpen(false)}
              />
            </div>
          ) : sidebarCollapsed ? (
            <Sidebar
              collapsed={true}
              onToggleCollapse={handleToggleSidebar}
            />
          ) : showSidebar ? (
            <Sidebar
              collapsed={false}
              onToggleCollapse={breakpoint === "tablet" ? handleToggleSidebar : undefined}
            />
          ) : null}

          {/* Main content */}
          <main className="stratum-app-main">
            <Dashboard />
          </main>
        </div>
      </div>
    </StratumProvider>
  );
}
