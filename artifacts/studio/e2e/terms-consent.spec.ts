/**
 * WQF-B — Part B in a real browser: the terms box, the stale-terms log-in
 * (one-time log-out), the reset-password landing, the legal pages and the
 * delete-account dialog. Target: E2E_BASE_URL (local two-server recipe,
 * e2e/CLAUDE.md). Tests that age or read a users row also need DATABASE_URL;
 * the e2e gate step requires 0 skipped in this file.
 */
import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "./fixtures";
import { TERMS_VERSION } from "../src/pages/legal/legalMeta";
import { makeTermsStale, plantResetToken, readTerms, userExists } from "./helpers/termsDb";

const T = 15_000;
const PASSWORD = "correcthorse1";
const newEmail = (tag: string) => `e2e-wqfb-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
const needsDb = () => test.skip(!process.env.DATABASE_URL, "needs DATABASE_URL (local e2e gate only)");

async function registerViaApi(page: Page, tag: string): Promise<string> {
  const email = newEmail(tag);
  const res = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD, acceptTerms: true } });
  expect(res.status()).toBe(201);
  return email;
}

async function logInThroughForm(page: Page, email: string, password = PASSWORD) {
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-password").fill(password);
  await expect(page.getByTestId("button-login")).toBeDisabled();
  await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
  await page.getByTestId("button-login").click({ timeout: T });
}

test.describe("terms consent (unauthenticated)", () => {
  test.use({ storageState: undefined });

  for (const [path, button] of [["/login", "button-login"], ["/register", "button-register"]] as const) {
    test(`${path}: the box starts unticked and the button stays disabled until it is ticked`, async ({ page }) => {
      await page.goto(path);
      const box = page.getByTestId("checkbox-accept-terms");
      await expect(box).toBeVisible({ timeout: T });
      await expect(box).not.toBeChecked();
      await expect(page.locator("label[for='accept-terms']")).toHaveText("I agree to the Terms of Service and the Privacy Notice (FERPA, GDPR)");
      await page.getByTestId("input-email").fill(newEmail("box"));
      await page.getByTestId("input-password").fill(PASSWORD);
      await expect(page.getByTestId(button)).toBeDisabled();
      await box.check({ timeout: T });
      await expect(page.getByTestId(button)).toBeEnabled();
      await box.uncheck({ timeout: T });
      await expect(page.getByTestId(button)).toBeDisabled();
    });
  }

  test("the consent links open the Terms and the Privacy Notice in a new tab", async ({ page }) => {
    await page.goto("/login");
    for (const [id, pageId] of [["link-consent-terms", "page-terms"], ["link-consent-privacy", "page-privacy"]] as const) {
      await expect(page.getByTestId(id)).toHaveAttribute("target", "_blank");
      await expect(page.getByTestId(id)).toHaveAttribute("rel", /noopener/);
      const [popup] = await Promise.all([page.context().waitForEvent("page"), page.getByTestId(id).click({ timeout: T })]);
      await expect(popup.getByTestId(pageId)).toBeVisible({ timeout: T });
      expect(popup.url()).toMatch(pageId === "page-terms" ? /\/terms$/ : /\/privacy$/);
      await popup.close();
    }
    await expect(page).toHaveURL(/\/login$/); // the form tab never navigated
  });

  test("/terms and /privacy are public, versioned, carry the privacy contact, and show no draft banner", async ({ page }) => {
    for (const [path, id] of [["/terms", "page-terms"], ["/privacy", "page-privacy"]] as const) {
      await page.goto(path);
      await expect(page.getByTestId(id)).toBeVisible({ timeout: T });
      await expect(page.getByTestId("legal-draft-banner")).toHaveCount(0); // B9 removed the draft banner
      await expect(page.getByText(/draft/i)).toHaveCount(0); // and no draft wording survives anywhere on the page
      await expect(page.getByTestId("legal-version")).toHaveText(`Version ${TERMS_VERSION}`);
    }
    await page.goto("/privacy");
    await expect(page.getByTestId("page-privacy")).toContainText("privacy@studio.networkdesignbook.com");
  });

  test("registering through the form records the current terms version", async ({ page }) => {
    needsDb();
    const email = newEmail("reg");
    await page.goto("/register");
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill(PASSWORD);
    await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
    await page.getByTestId("button-register").click({ timeout: T });
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
    const row = readTerms(email);
    expect(row.version).toBe(TERMS_VERSION);
    expect(row.acceptedAt).not.toBe("");
  });
});

test.describe("one-time log-out (B4) and terms_required (B3)", () => {
  test.use({ storageState: undefined });

  test("a stale user is signed out, the API refuses without the box, and the form records acceptance", async ({ page }) => {
    needsDb();
    const email = await registerViaApi(page, "stale");
    await page.goto("/");
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T }); // non-vacuity: signed in first

    makeTermsStale(email);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/, { timeout: T });

    const refused = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: "terms_required" });
    expect(refused.headers()["set-cookie"]).toBeUndefined();

    await expect(page.getByTestId("checkbox-accept-terms")).not.toBeChecked();
    await logInThroughForm(page, email);
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
    expect(readTerms(email).version).toBe(TERMS_VERSION);
  });
});

test.describe("reset-password landing (B2)", () => {
  test.use({ storageState: undefined });

  test("a stale account's reset lands on Log in with a notice; ticking the box gets in", async ({ page }) => {
    needsDb();
    const email = await registerViaApi(page, "reset-stale");
    makeTermsStale(email);
    const token = randomBytes(32).toString("base64url");
    plantResetToken(email, token);
    await page.goto(`/reset-password#token=${token}`);
    await page.getByTestId("input-new-password").fill("brandnewpass1");
    await page.getByTestId("button-set-password").click({ timeout: T });
    await expect(page).toHaveURL(/\/login\?reset=done$/, { timeout: T });
    await expect(page.getByTestId("alert-password-changed")).toHaveText("Your password was changed. Log in to continue.");
    await logInThroughForm(page, email, "brandnewpass1");
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
  });

  test("a current account's reset signs straight in", async ({ page }) => {
    needsDb();
    const email = await registerViaApi(page, "reset-current");
    await page.context().clearCookies();
    const token = randomBytes(32).toString("base64url");
    plantResetToken(email, token);
    await page.goto(`/reset-password#token=${token}`);
    await page.getByTestId("input-new-password").fill("brandnewpass1");
    await page.getByTestId("button-set-password").click({ timeout: T });
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
  });
});

test.describe("delete my account (B5)", () => {
  test.use({ storageState: undefined });

  test("the footer link opens a dialog away from Log out; a wrong password is refused; the right one deletes", async ({ page }) => {
    const email = await registerViaApi(page, "delete");
    await page.goto("/");
    const footer = page.getByTestId("homepage-credit-footer");
    await expect(footer.getByTestId("link-delete-account")).toBeVisible({ timeout: T });
    await expect(page.locator("header").getByTestId("link-delete-account")).toHaveCount(0);
    await expect(footer.getByTestId("account-links")).toHaveText(/Terms\s*·\s*Privacy\s*·\s*Delete my account/);

    await footer.getByTestId("link-delete-account").click({ timeout: T });
    const dialog = page.getByTestId("dialog-delete-account");
    await expect(dialog).toBeVisible({ timeout: T });
    await expect(dialog).toContainText("cannot be undone");
    await expect(page.getByTestId("button-confirm-delete")).toBeDisabled();

    await page.getByTestId("input-delete-password").fill("not-my-password");
    await page.getByTestId("button-confirm-delete").click({ timeout: T });
    await expect(page.getByTestId("alert-delete-error")).toHaveText("That password is not correct.", { timeout: T });

    await page.getByTestId("input-delete-password").fill(PASSWORD);
    await page.getByTestId("button-confirm-delete").click({ timeout: T });
    await expect(page).toHaveURL(/\/login$/, { timeout: T });
    expect((await page.context().cookies()).some((c) => c.name === "nos_session")).toBe(false);
    const login = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD, acceptTerms: true } });
    expect(login.status()).toBe(401);
    if (process.env.DATABASE_URL) expect(userExists(email)).toBe(false);
  });

  test("cancel closes the dialog and deletes nothing", async ({ page }) => {
    await registerViaApi(page, "delete-cancel");
    await page.goto("/");
    await page.getByTestId("homepage-credit-footer").getByTestId("link-delete-account").click({ timeout: T });
    await page.getByTestId("button-cancel-delete").click({ timeout: T });
    await expect(page.getByTestId("dialog-delete-account")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
  });
});
