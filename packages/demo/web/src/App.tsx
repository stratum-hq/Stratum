import React, { useState } from "react";
import { StratumProvider } from "@stratum/react";
import { Dashboard } from "./pages/Dashboard.js";
import { TenantAdmin } from "./pages/TenantAdmin.js";
import { ConfigAdmin } from "./pages/ConfigAdmin.js";

type Tab = "dashboard" | "tenants" | "config";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  return (
    <StratumProvider controlPlaneUrl="/api/v1" apiKey="sk_live_demo_key">
      <div style={{ fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", height: "100vh" }}>
        <header style={{ background: "#1e293b", color: "white", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>Stratum Demo — MSSP Dashboard</h1>
          <nav style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {(["dashboard", "tenants", "config"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "6px 16px",
                  border: "none",
                  borderRadius: 4,
                  background: activeTab === tab ? "#3b82f6" : "transparent",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 14,
                  textTransform: "capitalize",
                }}
              >
                {tab}
              </button>
            ))}
          </nav>
        </header>

        <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
          {activeTab === "dashboard" && <Dashboard />}
          {activeTab === "tenants" && <TenantAdmin />}
          {activeTab === "config" && <ConfigAdmin />}
        </main>
      </div>
    </StratumProvider>
  );
}
