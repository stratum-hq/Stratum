import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3300,
    proxy: {
      "/api/v1": "http://localhost:3001",
      "/api/events": "http://localhost:3200",
    },
  },
});
