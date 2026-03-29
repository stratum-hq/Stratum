import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@stratum-hq/core": path.resolve(__dirname, "../core/src/index.ts"),
      "@stratum-hq/sdk": path.resolve(__dirname, "../sdk/src/index.ts"),
    },
  },
});
