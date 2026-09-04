/**
 * Browser E2E — Bundle 5 (homepage polish + Distances pagination).
 *
 * Covers:
 *   1. Recent-solves dedupe — solving the same scenario twice must yield
 *      exactly ONE row on "/" (the newest job), not one row per job. This is
 *      the core T4 (`/solve-history` DISTINCT-ON dedupe) verification.
 *   2. Homepage chrome — hero band book-cover `<img>`, the
 *      "Developed by Shubham" credit footer (and the ABSENCE of the global
 *      AppFooter on "/"), and a chapter card's sunken full-bleed footer
 *      strip.
 *   3. Distances tab pagination + the From/To filter applying live to both
 *      the reference and overrides tables.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md and
 * vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerAndGoHome(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
  return email;
}

function pMedianInputs(overrides: Record<string, unknown> = {}) {
  return {
    p: 3,
    distanceBands: [200, 400, 800, 1600],
    capacityMode: "none",
    uniformCapacity: null,
    warehouseOverrides: [],
    customerOverrides: [],
    gap: 0,
    timeLimitSec: 120,
    ...overrides,
  };
}

async function createPMedianScenario(
  page: Page,
  name: string,
  inputs: Record<string, unknown> = pMedianInputs(),
): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name, modelId: "p-median-us", inputs },
  });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

async function solveAndWait(page: Page, scenarioId: number): Promise<void> {
  const solveResp = await page.request.post(`/api/scenarios/${scenarioId}/solve`);
  expect(solveResp.status()).toBe(202);
  const { jobId } = await solveResp.json();

  let status = "queued";
  for (let i = 0; i < 60 && (status === "queued" || status === "running"); i++) {
    await page.waitForTimeout(500);
    const pollResp = await page.request.get(`/api/scenarios/${scenarioId}/solve-jobs/${jobId}`);
    expect(pollResp.status()).toBe(200);
    status = (await pollResp.json()).status;
  }
  expect(status).toBe("succeeded");
}

test.describe("Bundle 5 — recent-solves dedupe", () => {
  test("solving the same scenario twice yields exactly one recent-solves row", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page, "dedupe");

    const scenarioId = await createPMedianScenario(page, `E2E Dedupe ${Date.now()}`);

    try {
      // Two full solves of the SAME scenario — two solve_jobs rows in the DB.
      await solveAndWait(page, scenarioId);
      await solveAndWait(page, scenarioId);

      await page.reload();
      const subtitle = page.getByText("Most recent solve per scenario — click to open one.");
      await expect(subtitle).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Exactly one recent-solves link references this scenario, not two.
      const rowsForScenario = page.locator(`a[href*="scenario=${scenarioId}"]`);
      await expect(rowsForScenario).toHaveCount(1);
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});

test.describe("Bundle 5 — homepage chrome", () => {
  test("hero band shows the book-cover icon, the developer-credit footer, and no global AppFooter", async ({ page }) => {
    await registerAndGoHome(page, "chrome");

    const header = page.getByTestId("text-user-email").locator("xpath=ancestor::header");
    await expect(header.locator("img")).toBeVisible({ timeout: HEADER_TIMEOUT });

    const footer = page.getByTestId("homepage-credit-footer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("Developed by Shubham");
    await expect(page.getByTestId("app-footer")).not.toBeVisible();

    // Log-out gets a band-appropriate hover class (asserted via DOM, not a
    // real hover — Playwright hover doesn't reliably trigger CSS :hover
    // pseudo-class assertions the same way a class-name check does).
    const logoutClass = await page.getByTestId("button-logout").getAttribute("class");
    expect(logoutClass).toContain("hover:bg-white/10");
  });

  test("a chapter card has the sunken full-bleed footer strip", async ({ page }) => {
    await registerAndGoHome(page, "card");

    const footer = page.getByTestId("landing-card-footer-p-median-us");
    await expect(footer).toBeVisible({ timeout: HEADER_TIMEOUT });
    const footerClass = await footer.getAttribute("class");
    expect(footerClass).toContain("border-t");

    // Full-bleed + clipped to the card's rounded corners — the ancestor Card
    // carries overflow-hidden.
    const cardHandle = footer.locator("xpath=ancestor::*[contains(@class,'overflow-hidden')][1]");
    await expect(cardHandle).toHaveCount(1);
  });
});

test.describe("Bundle 5 — Distances pagination + global filter", () => {
  test("overrides and reference tables paginate at 50/page and the From/To filter applies to both live", async ({ page }) => {
    test.setTimeout(60_000);
    await registerAndGoHome(page, "distances");

    // Build 120 distanceOverrides using real dataset ids (26 warehouses,
    // 200 customers) so every row passes server-side validation.
    const datasetResp = await page.request.get("/api/dataset?modelId=p-median-us");
    expect(datasetResp.status()).toBe(200);
    const dataset = await datasetResp.json();
    const warehouseIds: string[] = dataset.warehouses.map((w: { id: string }) => w.id);
    const customerIds: string[] = dataset.customers.map((c: { id: string }) => c.id);

    const distanceOverrides = Array.from({ length: 120 }, (_, i) => ({
      fromId: warehouseIds[i % warehouseIds.length],
      toId: customerIds[i % customerIds.length],
      distance: 100 + i,
    }));

    const scenarioId = await createPMedianScenario(
      page,
      `E2E Distances ${Date.now()}`,
      pMedianInputs({ distanceOverrides }),
    );

    try {
      await page.goto(`/chapter-3?scenario=${scenarioId}`);
      await expect(page.getByTestId("sidebar-input-distances")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Overrides table: 120 rows -> 3 pages of 50.
      const ovIndicator = page.getByTestId("ov-page-indicator");
      await expect(ovIndicator).toHaveText("Page 1 of 3");
      await expect(page.getByTestId("button-ov-prev")).toBeDisabled();
      await expect(page.getByTestId("button-ov-next")).toBeEnabled();

      await page.getByTestId("button-ov-next").click();
      await expect(ovIndicator).toHaveText("Page 2 of 3");

      // Reference table also paginates (26 warehouses x 200 customers =
      // 5200 pairs -> 104 pages).
      const refIndicator = page.getByTestId("ref-page-indicator");
      await expect(refIndicator).toHaveText("Page 1 of 104");
      await expect(page.getByTestId("button-ref-prev")).toBeDisabled();

      // Global From filter: typing a specific warehouse id resets both
      // tables to page 1 and narrows the visible rows on each.
      await page.getByTestId("input-filter-from").fill(warehouseIds[0]);
      await expect(ovIndicator).toContainText("Page 1 of");
      await expect(refIndicator).toContainText("Page 1 of");

      const overridesRows = page.locator('[data-testid^="row-distance-"]');
      const referenceRows = page.locator('[data-testid^="row-reference-distance-"]');
      const ovCount = await overridesRows.count();
      const refCount = await referenceRows.count();
      expect(ovCount).toBeGreaterThan(0);
      expect(refCount).toBeGreaterThan(0);
      for (let i = 0; i < ovCount; i++) {
        const testid = await overridesRows.nth(i).getAttribute("data-testid");
        expect(testid).toContain(`row-distance-${warehouseIds[0]}-`);
      }
      for (let i = 0; i < refCount; i++) {
        const testid = await referenceRows.nth(i).getAttribute("data-testid");
        expect(testid).toContain(`row-reference-distance-${warehouseIds[0]}-`);
      }
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});
