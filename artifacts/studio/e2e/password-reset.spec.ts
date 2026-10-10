/**
 * Browser E2E — password reset (PWR).
 *
 * Covers the UI half only: the login-page entry point, the request form's
 * deliberately vague confirmation, and the no-token branch of
 * /reset-password. The token-consuming half lives in the api-server
 * integration suite — e2e does not reach a real inbox.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy so the browser
 * sees one origin — see artifacts/studio/e2e/CLAUDE.md.
 */
import { test, expect } from "./fixtures";

const TIMEOUT = 10_000;

test.describe("password reset (unauthenticated)", () => {
  test.use({ storageState: undefined });

  test("the login page links to the reset flow", async ({ page }) => {
    await page.goto("/login");
    const link = page.getByTestId("link-forgot-password");
    await expect(link).toBeVisible({ timeout: TIMEOUT });
    await link.click();
    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("button-request-reset")).toBeVisible();
  });

  test("requesting a reset for an address with no account shows the vague confirmation", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByTestId("input-email").fill(`e2e-pwr-${Date.now()}@example.test`);
    await page.getByTestId("button-request-reset").click();

    const sent = page.getByTestId("text-reset-sent");
    await expect(sent).toBeVisible({ timeout: TIMEOUT });
    await expect(sent).toContainText(/if that email has an account/i);
  });

  test("/reset-password with no token offers a fresh link instead of a form", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByTestId("text-reset-link-invalid")).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByTestId("input-new-password")).toHaveCount(0);
  });

  test("a token in the fragment is consumed and removed from the URL", async ({ page }) => {
    await page.goto("/reset-password#token=not-a-real-token");
    await expect(page.getByTestId("input-new-password")).toBeVisible({ timeout: TIMEOUT });
    // The page strips the fragment on mount; auto-retrying, and it also
    // catches a token leaking into the query string or path.
    await expect(page).toHaveURL(/\/reset-password$/);

    await page.getByTestId("input-new-password").fill("brandnewpass1");
    // The generic error is identical for empty/unknown/expired tokens, so
    // assert on the request itself to prove WHICH token was sent.
    const req = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/auth/reset-password"));
    await page.getByTestId("button-set-password").click();
    expect((await req).postDataJSON().token).toBe("not-a-real-token");
    await expect(page.getByTestId("alert-reset-error")).toContainText(/invalid or has expired/i, { timeout: TIMEOUT });
  });
});
