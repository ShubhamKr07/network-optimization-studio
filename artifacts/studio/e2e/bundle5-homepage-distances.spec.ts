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
 *   3. Distances tab pagination + the From/To filter applying live. Bundle
 *      6.1 (T2) merged the old separate reference/overrides tables into ONE
 *      table over the full base×base matrix — this section paginates/
 *      filters that single merged table now (see bundle6.1-legend-
 *      distances.spec.ts for the fuller base+override merge coverage).
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
  test("the merged table paginates over the full base matrix and the From/To filter narrows it live", async ({ page }) => {
    test.setTimeout(60_000);
    await registerAndGoHome(page, "distances");

    // Build 120 distanceOverrides using real dataset ids (26 warehouses,
    // 200 customers) so every row passes server-side validation. Bundle 6.1
    // (T2) merged the reference/overrides tables into ONE row list keyed by
    // the base×base matrix — an override on an EXISTING base pair (as these
    // all are: fromId/toId both drawn from the real dataset) decorates that
    // row rather than adding a new one, so seeding 120 overrides no longer
    // changes the merged table's row COUNT (still exactly 26*200=5200); it's
    // still useful here to prove an override renders inline in the SAME row
    // as its base value (asserted below), not just to inflate a page count.
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

      // Single merged table paginates over the full base matrix (26
      // warehouses x 200 customers = 5200 pairs -> 104 pages of 50).
      const pageIndicator = page.getByTestId("distances-page-indicator");
      await expect(pageIndicator).toHaveText("Page 1 of 104");
      await expect(page.getByTestId("button-distances-prev")).toBeDisabled();
      await expect(page.getByTestId("button-distances-next")).toBeEnabled();

      await page.getByTestId("button-distances-next").click();
      await expect(pageIndicator).toHaveText("Page 2 of 104");

      // Global From filter: typing a specific warehouse id resets to page 1
      // and narrows the merged table to just that warehouse's 200 customer
      // pairs -> 4 pages of 50.
      await page.getByTestId("input-filter-from").fill(warehouseIds[0]);
      await expect(pageIndicator).toHaveText("Page 1 of 4");

      const rows = page.locator('[data-testid^="row-distance-"]');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
      for (let i = 0; i < rowCount; i++) {
        const testid = await rows.nth(i).getAttribute("data-testid");
        expect(testid).toContain(`row-distance-${warehouseIds[0]}-`);
      }

      // Narrowing further with the To filter isolates one exact pair that
      // ALSO carries one of the 120 seeded overrides — distanceOverrides[26]
      // targets (fromId=warehouseIds[0], toId=customerIds[26]) since
      // 26 % warehouseIds.length === 0 — so this row's override renders
      // inline with a real base value, proving the merge (not just the
      // filter). customerIds[26] ("C27" in the real dataset) is used
      // instead of customerIds[0] ("C1") deliberately: a short numeric
      // suffix like "1" is a SUBSTRING of "C10"/"C100"-"C199" too under the
      // filter's plain `.includes()` match, so "C1" alone doesn't isolate a
      // single row — "C27" has no such collision (nothing else contains it).
      const toFilterId = customerIds[26];
      await page.getByTestId("input-filter-to").fill(toFilterId);
      await expect(pageIndicator).toHaveText("Page 1 of 1");
      const isolatedRow = page.getByTestId(`row-distance-${warehouseIds[0]}-${toFilterId}`);
      await expect(isolatedRow).toBeVisible();

      // This override was seeded via the scenario-creation API, so it IS
      // the scenario's SAVED state (not an unsaved edit) — the "Changed"
      // badge only lights up for a delta from the saved state, so it does
      // NOT apply here (there's dedicated "add an override -> Changed"
      // coverage in bundle6.1-legend-distances.spec.ts). What this DOES
      // prove is the merge itself: the override's distance (126, i.e.
      // 100+26) renders in the editable Override input, alongside a real,
      // DIFFERENT base value in the read-only Base column of the SAME row.
      await expect(page.getByTestId(`input-distance-${warehouseIds[0]}-${toFilterId}`)).toHaveValue("126");
      const baseValue = (await isolatedRow.locator("td").nth(2).textContent())?.trim();
      expect(baseValue).toBeTruthy();
      expect(baseValue).not.toBe("—");
      expect(baseValue).not.toBe("unavailable");
      expect(baseValue).not.toBe("126");
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});
