import { defineConfig, devices } from "@playwright/test";

// The tests run against the production build, so `npm run build` must run first.
// PORT lets a local run avoid a preview server that another checkout started.
const port = Number(process.env.PORT ?? 4321);

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 60_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run preview -- --port ${port}`,
    url: `http://localhost:${port}/playground/`,
    reuseExistingServer: !process.env.CI,
  },
});
