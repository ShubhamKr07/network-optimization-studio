import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.E2E_BASE_URL ||
  "https://7e5e4d86-4aaa-4650-83d8-ce65e36a4fe7-00-286k5vaeu9g0.kirk.replit.dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Browser stores session so auth runs once per project
    storageState: "e2e/.auth/session.json",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: "**/global.setup.ts",
      use: { storageState: undefined },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
