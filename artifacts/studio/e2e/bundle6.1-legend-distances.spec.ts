/**
 * Browser E2E — Bundle 6.1 (T3, per docs/superpowers/plans/2026-09-05-
 * bundle6.1-legend-distances.md's T3 section).
 *
 * Covers the two real UI contracts T1/T2 shipped:
 *   1. Legend — the shared `MapLegend` (T1): Input variant's status/demand
 *      swatches never clip their 24px cells (resolution #1), Output
 *      variant shows "Open" (never a separate "Forced Open" entry,
 *      resolution #7) with no demand ramp, and the Output legend's
 *      facility/customer entries follow their own layer-visibility
 *      toggles independently (resolution #3).
 *   2. Distances — the merged DistancesTab (T2): ONE table (no separate
 *      "Base distances (reference)" sub-table / old two-pager testids),
 *      base rows show a read-only base value + an editable override cell,
 *      adding an override marks the row "Changed" without touching the
 *      base value, and a single pager spans the whole merged row set.
 *      two-echelon-gold-au's sibling LegDistancesTab (confirmed a T2b
 *      no-op — already Customers-tab-styled) still renders its own leg
 *      badge column.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md and
 * vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerAndGoHome(page: Page, tag: string): Promise<void> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
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

/** Solves a scenario for real via the async job API (enqueue + poll). */
async function solveScenario(page: Page, scenarioId: number): Promise<void> {
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

interface DatasetWarehouse {
  id: string;
  kind?: "mine" | "facility";
}

async function getDataset(page: Page, modelId: string): Promise<{ warehouses: DatasetWarehouse[]; customers: { id: string }[] }> {
  const resp = await page.request.get(`/api/dataset?modelId=${modelId}`);
  expect(resp.status()).toBe(200);
  return resp.json();
}

/**
 * Resolution #1's literal DoD: the swatch (the SVG rendered inside a legend
 * cell) must never overflow its cell's bounding box on any side. A small
 * epsilon absorbs sub-pixel layout rounding, not a real overflow.
 */
async function assertSwatchContained(page: Page, cellTestId: string): Promise<void> {
  const cell = page.getByTestId(cellTestId);
  await expect(cell).toBeVisible({ timeout: HEADER_TIMEOUT });
  const cellBox = await cell.boundingBox();
  const svgBox = await cell.locator("svg").boundingBox();
  expect(cellBox).not.toBeNull();
  expect(svgBox).not.toBeNull();

  const EPS = 0.5;
  expect(svgBox!.x).toBeGreaterThanOrEqual(cellBox!.x - EPS);
  expect(svgBox!.y).toBeGreaterThanOrEqual(cellBox!.y - EPS);
  expect(svgBox!.x + svgBox!.width).toBeLessThanOrEqual(cellBox!.x + cellBox!.width + EPS);
  expect(svgBox!.y + svgBox!.height).toBeLessThanOrEqual(cellBox!.y + cellBox!.height + EPS);
}

test.describe("Bundle 6.1 — Map legend (Input size ramp, Output states, layer-follow)", () => {
  test("Input Map: one map-legend box, demand-bucket swatches size-encode and fit their cells, status entries align", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page, "b61-legend-input");

    const scenarioId = await createPMedianScenario(page, `E2E B6.1 Legend Input ${Date.now()}`);

    try {
      await page.goto(`/chapter-3?scenario=${scenarioId}`);
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Exactly one legend box for the Input Map.
      await expect(page.getByTestId("map-legend")).toHaveCount(1);

      // Status entries (Potential/Fixed-Open/Inactive) — each triangle swatch
      // fits its 24px cell (resolution #1) and the label sits alongside it.
      for (const status of ["active", "forced_open", "inactive"]) {
        await assertSwatchContained(page, `legend-status-${status}`);
      }

      // Demand size ramp — a `legend-demand-bucket-*` per bucket the real
      // customer population actually occupies, each an SVG circle (not a
      // variable-sized wrapper div), each contained by its cell.
      const bucketCells = page.locator('[data-testid^="legend-demand-bucket-"]');
      const bucketCount = await bucketCells.count();
      expect(bucketCount).toBeGreaterThan(0);
      for (let i = 0; i < bucketCount; i++) {
        const testId = await bucketCells.nth(i).getAttribute("data-testid");
        expect(testId).not.toBeNull();
        await expect(bucketCells.nth(i).locator("svg")).toBeVisible();
        await expect(bucketCells.nth(i).locator("svg circle")).toHaveCount(1);
        await assertSwatchContained(page, testId!);
      }
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });

  test("Output Map: legend shows Open (never a separate Forced Open entry), no demand ramp, entries follow their own layer toggle", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page, "b61-legend-output");

    const scenarioId = await createPMedianScenario(page, `E2E B6.1 Legend Output ${Date.now()}`);
    await solveScenario(page, scenarioId);

    try {
      await page.goto(`/chapter-3?scenario=${scenarioId}`);
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const legend = page.getByTestId("map-legend");
      await expect(legend).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Resolution #7 — "Open", never a separate "Forced Open" entry (a
      // forced-open facility resolves to `open` in a solved result). The
      // testid'd span is the swatch cell itself (just the SVG icon); its
      // label is a sibling <span>, so assert both the swatch's presence and
      // the "Open" label text within the legend.
      await expect(page.getByTestId("legend-output-open")).toBeVisible();
      await expect(legend.getByText("Open", { exact: true })).toBeVisible();
      await expect(legend).not.toContainText("Forced Open");
      await expect(page.getByTestId("legend-output-potential")).toBeVisible();
      await expect(page.getByTestId("legend-output-customer")).toBeVisible();

      // Resolution #1 — Output has no demand ramp at all (no "size by
      // demand" toggle to show a scale for).
      await expect(legend).not.toContainText("Demand");
      await expect(page.locator('[data-testid^="legend-demand-bucket-"]')).toHaveCount(0);

      // Resolution #3 — toggling the Warehouses layer off removes the
      // facility legend entries, independently of the Customer entry.
      await page.getByTestId("checkbox-toggle-warehouses").click();
      await expect(page.getByTestId("legend-output-potential")).toHaveCount(0);
      await expect(page.getByTestId("legend-output-open")).toHaveCount(0);
      await expect(page.getByTestId("legend-output-customer")).toBeVisible();

      // Toggling the Customer layer off (independently) removes only the
      // Customer entry.
      await page.getByTestId("checkbox-toggle-customers").click();
      await expect(page.getByTestId("legend-output-customer")).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});

test.describe("Bundle 6.1 — Distances tab (merged base + override table)", () => {
  test("p-median-us: one merged table (no separate reference sub-table / old two-pager), base row stays read-only while its override marks Changed", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page, "b61-distances-merge");

    const dataset = await getDataset(page, "p-median-us");
    const warehouseId = dataset.warehouses[0].id;
    const customerId = dataset.customers[0].id;

    const scenarioId = await createPMedianScenario(page, `E2E B6.1 Distances ${Date.now()}`);

    try {
      await page.goto(`/chapter-3?scenario=${scenarioId}`);
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // T2's merge removed the old separate reference sub-table and its own
      // pager — those testids must not exist anymore.
      await expect(page.locator('[data-testid^="row-reference-distance-"]')).toHaveCount(0);
      await expect(page.getByTestId("ref-page-indicator")).toHaveCount(0);
      await expect(page.getByTestId("ov-page-indicator")).toHaveCount(0);

      // A single pager spans the whole merged base×base matrix (26
      // warehouses x 200 customers = 5200 pairs / 50 per page = 104 pages).
      const pageIndicator = page.getByTestId("distances-page-indicator");
      await expect(pageIndicator).toHaveText("Page 1 of 104");
      await expect(page.getByTestId("button-distances-prev")).toBeDisabled();
      await expect(page.getByTestId("button-distances-next")).toBeEnabled();
      await page.getByTestId("button-distances-next").click();
      await expect(pageIndicator).toHaveText("Page 2 of 104");

      // Filter down to one specific base pair to isolate its row.
      await page.getByTestId("input-filter-from").fill(warehouseId);
      await page.getByTestId("input-filter-to").fill(customerId);

      const row = page.getByTestId(`row-distance-${warehouseId}-${customerId}`);
      await expect(row).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Base cell (3rd column) shows the read-only reference distance.
      const baseCell = row.locator("td").nth(2);
      const baseValueBefore = (await baseCell.textContent())?.trim();
      expect(baseValueBefore).toBeTruthy();
      expect(baseValueBefore).not.toBe("—");
      expect(baseValueBefore).not.toBe("unavailable");

      // Adding an override marks the row Changed and does NOT touch the
      // base column's value.
      await page.getByTestId(`input-distance-${warehouseId}-${customerId}`).fill("555");
      await expect(page.getByTestId(`badge-distance-changed-${warehouseId}-${customerId}`)).toBeVisible({
        timeout: HEADER_TIMEOUT,
      });
      const baseValueAfter = (await baseCell.textContent())?.trim();
      expect(baseValueAfter).toBe(baseValueBefore);
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});

test.describe("Bundle 6.1 — Leg distances (two-echelon-gold-au, T2b audit confirmed no-op)", () => {
  test("Leg distances tab renders the restyled table with its leg badge column", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page, "b61-legdistances");

    const dataset = await getDataset(page, "two-echelon-gold-au");
    const mine = dataset.warehouses.find((w) => w.kind === "mine");
    const refinery = dataset.warehouses.find((w) => w.kind === "facility");
    expect(mine).toBeDefined();
    expect(refinery).toBeDefined();

    const resp = await page.request.post("/api/scenarios", {
      data: {
        name: `E2E B6.1 LegDistances ${Date.now()}`,
        modelId: "two-echelon-gold-au",
        inputs: {
          bomRatio: 1.1,
          refineryOverrides: [],
          customerOverrides: [],
          distanceBands: [500, 1000, 1500, 2000, 2600],
          gap: 0,
          timeLimitSec: 120,
          distanceOverrides: [{ fromId: mine!.id, toId: refinery!.id, distance: 321 }],
        },
      },
    });
    expect(resp.status()).toBe(201);
    const scenarioId = (await resp.json()).id as number;

    try {
      await page.goto(`/chapter-10/gold-refinery?scenario=${scenarioId}`);
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("legdistances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const legBadge = page.getByTestId(`badge-leg-${mine!.id}-${refinery!.id}`);
      await expect(legBadge).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(legBadge).toContainText("Mine → Refinery");
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});
