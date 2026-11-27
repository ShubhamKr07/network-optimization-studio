/**
 * ADM-T6 — admin dashboard in a real browser. Target: E2E_BASE_URL (local
 * two-server recipe, e2e/CLAUDE.md); needs DATABASE_URL for role + fixtures.
 * Seeds one flagged exchange per fresh user, dated now() (inside the default
 * 30-day Chicago-time preset), and removes users + fixtures in afterAll.
 */
import { test, expect, type Page } from "./fixtures";
import { clearAdminFixture, deleteUser, seedAdminFixture, setRole } from "./helpers/adminDb";

const T = 15_000;
const PASSWORD = "correcthorse1";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const adminEmail = `e2e-adm-admin-${RUN}@test.com`;
const studentEmail = `e2e-adm-student-${RUN}@test.com`;
const TAG_MAIN = `ADMT6-${RUN}-main`; // p-median-us
const TAG_DEL = `ADMT6-${RUN}-del`; // delivery-teaching-us: no other data in the dev DB
const DEL_MODEL = "delivery-teaching-us";
const DEL_NAME = "Delivery Company Teaching Example";

test.skip(!process.env.DATABASE_URL, "needs DATABASE_URL (local e2e gate only)");
test.use({ storageState: undefined });

async function register(page: Page, email: string) {
  const res = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD, acceptTerms: true } });
  expect(res.status()).toBe(201);
}
async function login(page: Page, email: string) {
  const res = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD, acceptTerms: true } });
  expect(res.status()).toBeLessThan(300);
}
const tile = (page: Page, label: string) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::div[1]");

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await register(page, adminEmail);
  await register(page, studentEmail);
  await page.close();
  setRole(adminEmail, "admin");
  seedAdminFixture(studentEmail, TAG_MAIN, "p-median-us");
  seedAdminFixture(studentEmail, TAG_DEL, DEL_MODEL);
});

test.afterAll(() => {
  clearAdminFixture(TAG_MAIN);
  clearAdminFixture(TAG_DEL);
  deleteUser(adminEmail);
  deleteUser(studentEmail);
});

test("an admin sees the dashboard and the seeded flagged question expands to its answer", async ({ page }) => {
  await login(page, adminEmail);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible({ timeout: T });
  await expect(page.getByText("Questions answered", { exact: true })).toBeVisible({ timeout: T });
  for (const name of ["Usage", "Quality", "Cost", "Reliability"]) await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What students said" })).toBeVisible();
  const item = page.locator("details").filter({ hasText: `${TAG_MAIN} why is the far warehouse open?` });
  await expect(item).toHaveCount(1, { timeout: T });
  await expect(item.getByText("WatBot answered")).toBeHidden(); // collapsed
  await item.locator("summary").click({ timeout: T });
  await expect(item.getByText("WatBot answered")).toBeVisible();
  await expect(item.getByText("Capacity limits can fill the nearest site.").last()).toBeVisible();
  await expect(item.getByText("Ch 3 · p.71")).toBeVisible();
});

test("a student at /admin gets not-found and no Admin link in the header", async ({ page }) => {
  await login(page, studentEmail);
  await page.goto("/admin");
  await expect(page.getByText("404 Page Not Found")).toBeVisible({ timeout: T });
  await expect(page.getByTestId("admin-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T }); // non-vacuity: signed in
  await expect(page.getByTestId("link-admin")).toHaveCount(0);
});

test("choosing the seeded chapter re-scopes the tiles and the voice column together", async ({ page }) => {
  await login(page, adminEmail);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible({ timeout: T });
  const flaggedTab = page.getByRole("tab", { name: /^Flagged answers/ });
  await expect(flaggedTab).toContainText(/[2-9]|\d{2,}/, { timeout: T }); // both seeds are in scope
  const allCount = Number((await flaggedTab.innerText()).replace(/\D/g, ""));
  const allAnswered = Number((await tile(page, "Questions answered").innerText()).replace(/\D/g, ""));
  expect(allCount).toBeGreaterThanOrEqual(2);
  expect(allAnswered).toBeGreaterThanOrEqual(2);

  await page.getByRole("region", { name: "Filters" }).locator("select").selectOption({ label: DEL_NAME });
  await expect(flaggedTab).toHaveText(/Flagged answers\s*1$/, { timeout: T });
  await expect(tile(page, "Questions answered")).toHaveText("1", { timeout: T });
  await expect(tile(page, "Active students")).toHaveText("1");
  await expect(page.locator("details").filter({ hasText: `${TAG_DEL} why` })).toHaveCount(1);
  await expect(page.locator("details").filter({ hasText: `${TAG_MAIN} why` })).toHaveCount(0);
  await expect(page.locator("#voice")).toContainText(DEL_NAME);
});

test("dark mode at 390x844 shows the jump link and does not overflow horizontally", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  try {
    await login(page, adminEmail);
    await page.addInitScript(() => localStorage.setItem("nos:theme-pref", "dark"));
    await page.goto("/admin");
    await expect(page.getByTestId("admin-dashboard")).toBeVisible({ timeout: T });
    await expect(page.locator("html")).toHaveClass(/dark/); // non-vacuity: really dark
    await expect(page.getByRole("link", { name: /Read what students said/ })).toBeVisible({ timeout: T });
    await expect(page.getByRole("tab", { name: "Usage", exact: true })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  } finally {
    await ctx.close();
  }
});

test("the admin feedback API answers 404 to a student session", async ({ page }) => {
  await login(page, studentEmail);
  const day = new Date().toISOString().slice(0, 10);
  const res = await page.request.get(`/api/admin/feedback?from=${day}&to=${day}`);
  expect(res.status()).toBe(404);
  // non-vacuity: the same call as the admin is not a 404
  await login(page, adminEmail);
  const ok = await page.request.get(`/api/admin/feedback?from=${day}&to=${day}`);
  expect(ok.status()).toBe(200);
});
