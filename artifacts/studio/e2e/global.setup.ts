import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/session.json");

setup("authenticate", async ({ page, baseURL }) => {
  // The app redirects to /login when unauthenticated
  await page.goto("/");
  const url = page.url();

  if (url.includes("/login")) {
    // Fill in the login form
    await page.fill('input[name="username"], input[type="text"]', "admin");
    await page.fill('input[name="password"], input[type="password"]', "admin");
    await page.click('button[type="submit"]');
    await page.waitForURL(u => !u.toString().includes("/login"), { timeout: 10_000 });
  }

  // Also authenticate against the API directly to ensure session cookie is set
  await page.request.post(`${baseURL}/api/login`, {
    data: { username: "admin", password: "admin" },
    headers: { "Content-Type": "application/json" },
  });

  await page.context().storageState({ path: AUTH_FILE });
});
