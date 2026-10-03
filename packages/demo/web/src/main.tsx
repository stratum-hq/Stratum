import React from "react";
import { createRoot } from "react-dom/client";
import "@stratum-hq/react/styles/fonts.css";
import "@stratum-hq/react/styles/base.css";
import "@stratum-hq/react/styles/theme-bedrock.css";
import "./legacy-tokens.css";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
