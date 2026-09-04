/**
 * Browser E2E — Bundle 4 (auth split-screen + live Landing summary).
 *
 * Covers:
 *   1. The unauthenticated auth split-screen (`/login`, `/register`) —
 *      cover panel, heading/kicker, labs strip, dev-credit links, absence
 *      of the global AppFooter, and the login-error / password-hint paths.
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
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerFreshAccount(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  return email;
}

test.describe("Bundle 4 — auth split-screen (unauthenticated)", () => {
  // These specs must run with no session at all, unlike the rest of the
  // suite (which relies on registering a fresh account per test but still
  // inherits the shared storageState file). The shared file is already an
  // empty placeholder (see global.setup.ts), but override explicitly so
  // this block's "unauthenticated" premise doesn't depend on that being
  // true forever.
  test.use({ storageState: undefined });

  test("/login renders the split-screen shell, cover panel, labs strip, and credit links", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByTestId("auth-shell")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("auth-cover")).toBeVisible();
    await expect(page.getByAltText(/Supply Chain Network Design book cover/i)).toBeVisible();

    await expect(page.getByText("Optimization Studio")).toBeVisible();
    await expect(page.getByText("By Prof. Michael Watson")).toBeVisible();

    // Bundle 6 (T5, item 12): AuthShell's labs strip is now derived from
    // CHAPTERS' non-hidden chapters (deduped by `chapter`), not a hardcoded
    // per-model list — with transport-coal/p-median-brazil/two-echelon-gold-au
    // all hiddenFromLanding, only "Chapter 3" remains.
    await expect(page.getByTestId("auth-labs-strip")).toHaveText("Chapter 3");

    const credit = page.getByTestId("auth-credit");
    await expect(credit).toBeVisible();
    await expect(page.getByTitle("LinkedIn")).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/shubhamkumarcse/",
    );
    await expect(page.getByTitle("Email")).toHaveAttribute(
      "href",
      "mailto:shubham.shubham4995@gmail.com",
    );

    // The global AppFooter is deliberately gone on auth pages — the inline
    // auth-credit block replaces it.
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
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("alert-login-error")).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("/register renders the same split-screen shell and enforces the password-length hint", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByTestId("auth-shell")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("auth-cover")).toBeVisible();
    await expect(page.getByText("Optimization Studio")).toBeVisible();
    await expect(page.getByText("By Prof. Michael Watson")).toBeVisible();
    await expect(page.getByTestId("auth-labs-strip")).toBeVisible();
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
    await expect(page.getByTestId("hero-tagline")).toContainText(/build a scenario/i);

    // Bundle 6 (T5, item 8): only Chapter 3 (p-median-us) is visible on
    // Landing now — transport-coal/p-median-brazil joined two-echelon-gold-au
    // as hiddenFromLanding, and the stats line is computed from the
    // visible-only perChapter rows.
    const stats = page.getByTestId("landing-stats-line");
    await expect(stats).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(stats).toHaveText("1 labs · 0 scenarios · 0 solved");

    const footer = page.getByTestId("landing-card-footer-p-median-us");
    await expect(footer).toContainText("no scenarios yet");
    await expect(footer).toContainText("start");
    await expect(footer).not.toContainText("active");

    const hiddenChapterPaths = ["/chapter-5/transport", "/chapter-5/brazil", "/chapter-10/gold-refinery"];
    for (const path of hiddenChapterPaths) {
      await expect(page.getByTestId(`link-${path}`)).toHaveCount(0);
    }
    for (const modelId of ["transport-coal", "p-median-brazil", "two-echelon-gold-au"]) {
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

    // Baseline before any scenario exists. Bundle 6 (T5): only Chapter 3
    // (p-median-us) is visible, so this and every stats-line assertion below
    // reads "1 labs" instead of the pre-Bundle-6 "3 labs".
    await expect(page.getByTestId("landing-stats-line")).toHaveText(
      "1 labs · 0 scenarios · 0 solved",
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
        "1 labs · 1 scenarios · 0 solved",
        { timeout: HEADER_TIMEOUT },
      );
      const footerUnsolved = page.getByTestId("landing-card-footer-p-median-us");
      await expect(footerUnsolved).toContainText("1 scenarios");
      await expect(footerUnsolved).not.toContainText("active");

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
      await expect(stats).toHaveText("1 labs · 1 scenarios · 1 solved", {
        timeout: HEADER_TIMEOUT,
      });

      const footerSolved = page.getByTestId("landing-card-footer-p-median-us");
      await expect(footerSolved).toContainText("1 scenarios · solved");
      await expect(footerSolved).toContainText("active");

      // Recent-solves row is prefixed with the chapter label.
      await expect(page.getByText(/Chapter 3 ·/)).toBeVisible({ timeout: HEADER_TIMEOUT });
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});
