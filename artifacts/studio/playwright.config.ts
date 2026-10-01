import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.E2E_BASE_URL ||
  "https://7e5e4d86-4aaa-4650-83d8-ce65e36a4fe7-00-286k5vaeu9g0.kirk.replit.dev";

export default defineConfig({
  testDir: "./e2e",
  // labs.spec.ts is pre-D0 dead (asserts the old Replit API shape); excluded from every lane.
  testIgnore: "**/labs.spec.ts",
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/report", open: "never" }],
    ["json", { outputFile: "e2e/report/results.json" }],
  ],
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
      teardown: "cleanup",
    },
    // HND-A — deletes the accounts the run just created. Specs register a
    // fresh account per test and clean up their scenarios but never their
    // user (no DB access from Playwright, no self-delete endpoint), which had
    // accumulated 2039 residual rows in nos_dev. Wired as a project `teardown`
    // rather than a global one so it runs once after chromium finishes,
    // including when specs fail. Non-fatal by design — see the file header.
    {
      name: "cleanup",
      testMatch: "**/global.teardown.ts",
      use: { storageState: undefined },
    },
  ],
});
