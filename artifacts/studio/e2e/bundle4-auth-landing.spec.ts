/**
 * Browser E2E — Bundle 4 (auth split-screen + live Landing summary).
 *
 * Covers:
 *   1. The unauthenticated cover sign-in page (`/login`, `/register`; CSI-1
 *      replaced the split-screen) — h1, offered-by credit links, developer help
 *      link, absence of the global AppFooter, and the login-error / password-hint paths.
 *   2. Landing's hero + T2 baseline (fresh account, zero scenarios).
 *   3. Landing's live `GET /landing-summary` data flow: creating and
 *      solving a real scenario via the API, then confirming the stats
 *      line, the card's "active" badge/status text, and the recent-solves
 *      row all reflect the real DB state after a reload.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md and
 * vite.config.ts.
 */
import { test, expect, type Page } from "./fixtures";

const HEADER_TIMEOUT = 10_000;

async function registerFreshAccount(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1", acceptTerms: true },
  });
  expect(resp.status()).toBe(201);
  return email;
}

test.describe("Bundle 4 — auth cover page (unauthenticated)", () => {
  // These specs must run with no session at all, unlike the rest of the
  // suite (which relies on registering a fresh account per test but still
  // inherits the shared storageState file). The shared file is already an
  // empty placeholder (see global.setup.ts), but override explicitly so
  // this block's "unauthenticated" premise doesn't depend on that being
  // true forever.
  test.use({ storageState: undefined });

  test("/login renders the cover sign-in shell: h1, offered-by credit links, developer help link, form controls", async ({ page }) => {
    await page.goto("/login");

    // CSI-1 replaced the split-screen (auth-shell/auth-cover/auth-labs-strip/auth-credit)
    // with one cover page; chapter names are deliberately gone from it (L12).
    await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cover-strip")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network Design Labs");
    await expect(page.getByTestId("mode-login")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mode-register")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("cover-shell").getByText(/Chapter \d/)).toHaveCount(0);

    const offered = page.getByTestId("cover-offered-by");
    await expect(offered).toBeVisible();
    await expect(offered).toContainText("Offered by");
    await expect(offered).toContainText("Michael Watson");
    await expect(page.getByTestId("link-linkedin")).toHaveAttribute("href", "https://www.linkedin.com/in/michael-watson-07600a1/");
    await expect(page.getByTestId("link-watson-email")).toHaveAttribute("href", "mailto:michael.watson@northwestern.edu");

    // The developer address stays reachable: the footer band's help link.
    await expect(page.getByTestId("cover-help").getByRole("link", { name: "Contact the developer" })).toHaveAttribute(
      "href",
      "mailto:shubham.shubham4995@gmail.com",
    );

    // The global AppFooter is still absent on the auth pages.
    await expect(page.getByTestId("app-footer")).not.toBeVisible();

    // Form inputs are present and usable.
    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("input-password")).toBeVisible();
    await expect(page.getByTestId("button-login")).toBeVisible();
  });

  test("/login shows an error alert on a bad login", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("input-email").fill(`nobody-${Date.now()}@test.com`);
    await page.getByTestId("input-password").fill("wrongpassword1");
    await page.getByTestId("checkbox-accept-terms").check({ timeout: 10_000 });
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("alert-login-error")).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("/register renders the same cover shell in create mode and enforces the password-length hint", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network Design Labs");
    await expect(page.getByTestId("mode-register")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("button-register")).toHaveText("Create account");
    await expect(page.getByTestId("cover-offered-by")).toContainText("Michael Watson");
    await expect(page.getByTestId("app-footer")).not.toBeVisible();

    // Password hint appears below 8 characters and disappears at/above it.
    await page.getByTestId("input-password").fill("short1");
    await expect(page.getByTestId("text-password-hint")).toBeVisible();
    await page.getByTestId("input-password").fill("longenough1");
    await expect(page.getByTestId("text-password-hint")).not.toBeVisible();
  });
});

test.describe("Bundle 4 — Landing hero + baseline (fresh account)", () => {
  test("hero renders and every chapter card shows the zero-scenario baseline", async ({ page }) => {
    const email = await registerFreshAccount(page, "landing-baseline");
    await page.goto("/");
    await expect(page.getByTestId("text-user-email")).toHaveText(email, { timeout: 8_000 });

    await expect(page.getByText("Network Design Labs")).toBeVisible();
    // HCV H1 — the tagline is gone; the header carries "Offered by" as subtext.
    await expect(page.locator("header.home-top")).toContainText("Offered by Michael Watson");
    await expect(page.getByTestId("hero-tagline")).toHaveCount(0);

    // Chapter 3 (p-median-us), Chapter 4 (max-coverage-us), Chapter 5
    // (delivery-teaching-us), Chapter 9 (JADE) and Chapter 10 (gold refinery,
    // ch10-unhide) are visible on Landing now — transport-coal/p-median-brazil
    // (also labeled Chapter 5) stay hiddenFromLanding, and the stats line is
    // computed from the visible-only perChapter rows.
    const stats = page.getByTestId("landing-stats-line");
    await expect(stats).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(stats).toHaveText("6 labs · 0 scenarios · 0 solved");

    const footer = page.getByTestId("landing-card-footer-p-median-us");
    await expect(footer).toContainText("no scenarios yet");
    await expect(footer).toContainText("Start");
    await expect(footer).not.toContainText("Active");

    // The delivery-teaching-us card is visible too (not locked, not hidden).
    await expect(page.getByTestId("landing-card-delivery-teaching-us")).toBeVisible();

    // ch9-unlock (2026-09-30) — Chapter 9 (JADE) was locked by ch4-lock and
    // is reopened: it is a real link again, with no inert wrapper and no
    // Locked badge. transport-coal and p-median-brazil remain hidden entirely
    // (a different thing from locked); Chapter 10 is a visible link as of
    // ch10-unhide.
    await expect(page.getByTestId("link-/chapter-9/jade")).toHaveCount(1);
    await expect(page.getByTestId("locked-/chapter-9/jade")).toHaveCount(0);
    await expect(page.getByTestId("landing-card-locked-two-echelon-jade-us")).toHaveCount(0);
    await expect(page.getByTestId("link-/chapter-10/gold-refinery")).toHaveCount(1);
    const hiddenChapterPaths = ["/chapter-5/transport", "/chapter-5/brazil"];
    for (const path of hiddenChapterPaths) {
      await expect(page.getByTestId(`link-${path}`)).toHaveCount(0);
    }
    for (const modelId of ["transport-coal", "p-median-brazil"]) {
      await expect(page.getByTestId(`landing-card-footer-${modelId}`)).toHaveCount(0);
    }
  });
});

test.describe("Bundle 4 — Landing reflects live solve data", () => {
  test("creating and solving a scenario updates the stats line, the card status/active badge, and recent solves", async ({ page }) => {
    test.setTimeout(90_000);
    await registerFreshAccount(page, "landing-live");
    await page.goto("/");
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });

    // Baseline before any scenario exists. Chapter 3 (p-median-us), Chapter 4
    // (max-coverage-us), Chapter 5 (delivery-teaching-us), and Chapter 9
    // (JADE) and Chapter 10 (ch10-unhide) are visible; transport-coal and
    // p-median-brazil stay hidden — so this and every stats-line assertion
    // below reads "6 labs" (Super Model, SM-3, is visible).
    await expect(page.getByTestId("landing-stats-line")).toHaveText(
      "6 labs · 0 scenarios · 0 solved",
      { timeout: HEADER_TIMEOUT },
    );

    // Create a real p-median-us scenario via the API the app already
    // exposes (same convention as import.spec.ts / tab-coverage.spec.ts).
    const createResp = await page.request.post("/api/scenarios", {
      data: {
        name: `E2E Landing Live ${Date.now()}`,
        modelId: "p-median-us",
        inputs: {
          p: 3,
          distanceBands: [200, 400, 800, 1600],
          capacityMode: "none",
          uniformCapacity: null,
          warehouseOverrides: [],
          customerOverrides: [],
          gap: 0,
          timeLimitSec: 120,
        },
      },
    });
    expect(createResp.status()).toBe(201);
    const scenarioId = (await createResp.json()).id as number;

    try {
      // Reload with just the scenario created (unsolved) — stats/card
      // should reflect the scenario count without a solved badge yet.
      await page.reload();
      await expect(page.getByTestId("landing-stats-line")).toHaveText(
        "6 labs · 1 scenario · 0 solved",
        { timeout: HEADER_TIMEOUT },
      );
      const footerUnsolved = page.getByTestId("landing-card-footer-p-median-us");
      await expect(footerUnsolved).toContainText("1 scenario");
      await expect(footerUnsolved).not.toContainText("1 scenarios");
      await expect(footerUnsolved).not.toContainText("Active");

      // Solve it for real via the async job API (enqueue + poll), the same
      // contract the UI itself drives (POST .../solve -> 202 {jobId}; GET
      // .../solve-jobs/:jobId until status leaves queued/running).
      const solveResp = await page.request.post(`/api/scenarios/${scenarioId}/solve`);
      expect(solveResp.status()).toBe(202);
      const { jobId } = await solveResp.json();

      let status = "queued";
      for (let i = 0; i < 60 && (status === "queued" || status === "running"); i++) {
        await page.waitForTimeout(500);
        const pollResp = await page.request.get(
          `/api/scenarios/${scenarioId}/solve-jobs/${jobId}`,
        );
        expect(pollResp.status()).toBe(200);
        status = (await pollResp.json()).status;
      }
      expect(status).toBe("succeeded");

      // Reload Landing — the summary and history should now show the
      // completed solve.
      await page.reload();
      const stats = page.getByTestId("landing-stats-line");
      await expect(stats).toHaveText("6 labs · 1 scenario · 1 solved", {
        timeout: HEADER_TIMEOUT,
      });

      const footerSolved = page.getByTestId("landing-card-footer-p-median-us");
      await expect(footerSolved).toContainText("1 scenario · solved");
      await expect(footerSolved).not.toContainText("1 scenarios");
      await expect(footerSolved).toContainText("Active");

      // HCV H6 — a Recent-solves row leads with the chapter label in its own mono cell.
      await expect(page.locator(".home-recent .ch", { hasText: /^Chapter 3$/ })).toBeVisible({ timeout: HEADER_TIMEOUT });
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});
