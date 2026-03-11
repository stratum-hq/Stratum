import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dir,
  server: {
    port: 3300,
    proxy: {
      "/api/v1": "http://localhost:3001",
      "/api/events": "http://localhost:3200",
    },
  },
});
