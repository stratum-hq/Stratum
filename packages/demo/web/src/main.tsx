import React from "react";
import { createRoot } from "react-dom/client";
import "@stratum-hq/react/styles/fonts-ansi-strata.css";
import "@stratum-hq/react/styles/base.css";
import "@stratum-hq/react/styles/theme-ansi-strata.css";
import "./demo.css";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
