/**
 * COSM-4 — the homepage feedback widget, end to end in a real browser.
 *
 * The POST is INTERCEPTED on purpose. The global teardown purges test users
 * and the data they own by FK, but a feedback row deliberately has no user
 * FK — it is anonymous at rest — so a real submission here would survive
 * teardown and accumulate one undeletable row per run. Intercepting keeps the
 * assertion honest (the request shape is still verified) with no durable
 * write.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md and
 * vite.config.ts.
 */
import { test, expect, type Page } from "./fixtures";

const TIMEOUT = 10_000;

// Same shape as bundle6-ui-tweaks.spec.ts — each spec owns this helper; there
// is no shared e2e/helpers/auth module.
async function registerFreshAccount(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  return email;
}

test("homepage feedback widget submits and thanks the user", async ({ page }) => {
  await registerFreshAccount(page, "feedback");

  let posted: unknown = null;
  await page.route("**/api/feedback", async route => {
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
  // Every interaction carries an explicit timeout — an unbounded .click() on a
  // never-actionable target inherits the whole remaining test budget and
  // surfaces the failure at an unrelated later line.
  await page.getByTestId("feedback-button").click({ timeout: TIMEOUT });
  await page.getByTestId("feedback-input").fill("e2e feedback");
  await page.getByTestId("feedback-send").click({ timeout: TIMEOUT });

  await expect(page.getByTestId("feedback-thanks")).toBeVisible({ timeout: TIMEOUT });
  expect(posted).toEqual({ body: "e2e feedback" });
});
