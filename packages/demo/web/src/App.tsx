import React from "react";
import { StratumProvider } from "@stratum/react";
import { Dashboard } from "./pages/Dashboard.js";
import { Sidebar } from "./components/Sidebar.js";

export function App() {
  return (
    <StratumProvider controlPlaneUrl="" apiKey="sk_live_demo_key">
      <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", display: "flex", flexDirection: "column", height: "100vh", background: "#f8fafc" }}>
        <header style={{ background: "#0f172a", color: "white", padding: "10px 20px", display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid #1e293b" }}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>Stratum</span>
            <span style={{ fontSize: 13, color: "#94a3b8", marginLeft: 10 }}>Multi-Tenancy Engine Demo</span>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#475569" }}>
            MSSP &rarr; MSP &rarr; Client hierarchy
          </div>
        </header>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <Sidebar />
          <main style={{ flex: 1, overflow: "auto", padding: 24 }}>
            <Dashboard />
          </main>
        </div>
      </div>
    </StratumProvider>
  );
}
