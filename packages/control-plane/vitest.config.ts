import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    env: {
      JWT_SECRET: "test-jwt-secret-for-unit-tests",
    },
  },
});
