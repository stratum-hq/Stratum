import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3300,
    proxy: {
      "/api/v1": "http://localhost:3001",
      "/api/events": "http://localhost:3200",
    },
  },
});
