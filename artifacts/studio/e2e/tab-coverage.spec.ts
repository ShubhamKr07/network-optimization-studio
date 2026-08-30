/**
 * Browser E2E — Phase 3.2, Task 5: tab-coverage click-through.
 *
 * One test per Workspace-backed model (p-median-us, transport-coal,
 * two-echelon-gold-au). Each test:
 *   1. Creates its own disposable scenario via the API (same convention as
 *      import.spec.ts/two-echelon.spec.ts) and deletes it afterward, so
 *      repeated runs don't accumulate colliding added-entity ids.
 *   2. Clicks through every Inputs sidebar entry (including the new Input
 *      Map), confirming the page stays live and routes to real content
 *      rather than crashing or 404ing. Outputs entries are NOT clicked here
 *      — SidebarTree.tsx disables every Outputs entry (including Output
 *      Map) until `hasSolvedRun` is true, so clicking one on a disposable,
 *      never-solved scenario is a genuinely disabled button, not a slow
 *      operation (confirmed directly against the real DOM while writing
 *      this spec — Playwright's own actionability retry loop keeps waiting
 *      for "enabled" and only gives up once the whole test times out).
 *      Running a real CBC solve here just to exercise that gate would slow
 *      this spec down for no proportionate benefit — Workspace.
 *      TabCoverage.test.tsx's RTL suite already exhaustively asserts every
 *      output GRID tab's own content against a solved-result fixture, and
 *      this spec instead asserts the disabled state itself (cheap, real
 *      DOM evidence that the gate is wired for each model).
 *   3. Runs the corrected acceptance check from this task's plan review:
 *      a known BASE-dataset row shows a real zip (only base rows are ever
 *      geocoded, per DD-1), then a row added via Input Map click-to-place
 *      shows City/State/Lat/Lng in the "Added <entity>" table — which has
 *      NO Zip column at all, so there's nothing to assert absent, only
 *      present.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md and
 * vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-tabcoverage-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenario(
  page: Page,
  modelId: string,
  inputs: Record<string, unknown>,
  path: string,
): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E TabCoverage ${modelId} ${Date.now()}`, modelId, inputs },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`${path}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

/** Clicks a point roughly in the middle of the Input Map's Leaflet canvas
 * and clicks Confirm, landing on the target Tab with the add-row form
 * prefilled. Doesn't try to read back the exact lat/lng from the draft
 * panel's own text — that's a `.toFixed(4)`-rounded PREVIEW (InputMapTab.tsx
 * renders `draft.lat.toFixed(4)`), whereas the prefilled `<input>` field
 * carries the full-precision value `onPlacePoint` actually received; the
 * caller should read the real value back from the input field itself once
 * this returns. */
async function clickMapAndConfirm(page: Page): Promise<void> {
  await page.getByTestId("sidebar-input-input-map").click();
  await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
  const mapCanvas = page.locator('[data-testid="input-map-tab"] .leaflet-container');
  await expect(mapCanvas).toBeVisible({ timeout: HEADER_TIMEOUT });
  await mapCanvas.click({ position: { x: 200, y: 200 } });

  await expect(page.getByTestId("input-map-draft-panel")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("button-input-map-confirm").click();
}

test.describe("Tab coverage (Phase 3.2, Task 5)", () => {
  test("p-median-us: sweeps every Inputs tab, base row shows a real zip, map-added row shows coordinates with no zip", async ({ page }) => {
    // Generous headroom above playwright.config.ts's global 30s default —
    // the full flow (register, create, sweep 5 Inputs tabs, real-Leaflet map
    // click, fill+submit the add-row form, assert the Added-rows table) runs
    // in a few seconds locally, but a slower CI runner shouldn't flake on
    // this. Set per-test rather than raising the shared config (which other
    // specs also rely on).
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createScenario(
      page,
      "p-median-us",
      {
        p: 3,
        distanceBands: [200, 400, 800, 1600],
        capacityMode: "none",
        uniformCapacity: null,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0,
        timeLimitSec: 120,
      },
      "/chapter-3",
    );

    try {
      // Sweep every Inputs sidebar entry — each must route to real content
      // without crashing the page.
      for (const entity of ["input-map", "customers", "warehouses", "distances", "optimization-parameters"]) {
        await page.getByTestId(`sidebar-input-${entity}`).click();
      }
      // Output Map (and every other Outputs entry) stays disabled — this
      // scenario is never solved.
      await expect(page.getByTestId("sidebar-output-output-map")).toBeDisabled();

      // A known base-dataset row (ALN — Allentown, PA) shows its real zip.
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const alnRow = page.locator("tr", { hasText: "ALN" });
      await expect(alnRow).toContainText("18101");

      // Click a point on the Input Map, Confirm, and land back on
      // Warehouses with Lat/Lng pre-filled.
      await clickMapAndConfirm(page);

      const latInput = page.getByTestId("input-new-warehouse-lat");
      const lngInput = page.getByTestId("input-new-warehouse-lng");
      await expect(latInput).not.toHaveValue("", { timeout: HEADER_TIMEOUT });
      const lat = await latInput.inputValue();
      const lng = await lngInput.inputValue();

      await page.getByTestId("input-new-warehouse-id").fill("E2ENEWWH");
      await page.getByTestId("input-new-warehouse-city").fill("Testburg");
      await page.getByTestId("input-new-warehouse-state").fill("ZZ");
      await page.getByTestId("button-add-warehouse-confirm").click();

      // The new row lands in "Added warehouses" — City/State/Lat/Lng
      // present, matching what was clicked; that table has NO Zip column at
      // all (added rows are never geocoded, DD-1).
      const addedRow = page.getByTestId("row-added-warehouse-E2ENEWWH");
      await expect(addedRow).toBeVisible();
      await expect(addedRow).toContainText("Testburg");
      await expect(addedRow).toContainText("ZZ");
      await expect(addedRow).toContainText(Number(lat).toFixed(4));
      await expect(addedRow).toContainText(Number(lng).toFixed(4));
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("transport-coal: sweeps every Inputs tab, base mine row shows a real zip, map-added mine shows coordinates with no zip", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createScenario(
      page,
      "transport-coal",
      {
        distanceBands: [500, 1000, 1500, 2000],
        gap: 0,
        timeLimitSec: 120,
        capacityFactor: 1.0,
        singleSource: false,
        capacityInactive: false,
      },
      "/chapter-5/transport",
    );

    try {
      for (const entity of ["input-map", "mines", "stations", "laneCosts", "optimization-parameters"]) {
        await page.getByTestId(`sidebar-input-${entity}`).click();
      }
      await expect(page.getByTestId("sidebar-output-output-map")).toBeDisabled();

      // A known base mine row (KY — Pikeville, KY) shows its real zip.
      await page.getByTestId("sidebar-input-mines").click();
      await expect(page.getByTestId("mines-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const kyRow = page.locator("tr", { hasText: "KY" }).first();
      await expect(kyRow).toContainText("41655");

      // Input Map's default placement for this model is "Mine" (first entry
      // in placementOptionsForModel) — no toggle needed.
      await clickMapAndConfirm(page);

      const latInput = page.getByTestId("input-new-mine-lat");
      const lngInput = page.getByTestId("input-new-mine-lng");
      await expect(latInput).not.toHaveValue("", { timeout: HEADER_TIMEOUT });
      const lat = await latInput.inputValue();
      const lng = await lngInput.inputValue();

      await page.getByTestId("input-new-mine-id").fill("E2ENEWMINE");
      await page.getByTestId("input-new-mine-city").fill("Testburg");
      await page.getByTestId("input-new-mine-state").fill("ZZ");
      await page.getByTestId("button-add-mine-confirm").click();

      const addedRow = page.getByTestId("row-added-mine-E2ENEWMINE");
      await expect(addedRow).toBeVisible();
      await expect(addedRow).toContainText("Testburg");
      await expect(addedRow).toContainText("ZZ");
      await expect(addedRow).toContainText(Number(lat).toFixed(4));
      await expect(addedRow).toContainText(Number(lng).toFixed(4));
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("two-echelon-gold-au: sweeps every Inputs tab, base refinery row shows a real zip, map-added refinery shows coordinates with no zip", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createScenario(
      page,
      "two-echelon-gold-au",
      {
        bomRatio: 1.1,
        refineryOverrides: [],
        customerOverrides: [],
        distanceBands: [500, 1000, 1500, 2000, 2600],
        gap: 0,
        timeLimitSec: 120,
      },
      "/chapter-10/gold-refinery",
    );

    try {
      for (const entity of ["input-map", "refineries", "customers", "distances", "optimization-parameters"]) {
        await page.getByTestId(`sidebar-input-${entity}`).click();
      }
      await expect(page.getByTestId("sidebar-output-output-map")).toBeDisabled();

      // A known base refinery row (daggar-hills) shows its real zip.
      await page.getByTestId("sidebar-input-refineries").click();
      await expect(page.getByTestId("refineries-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const refRow = page.locator("tr", { hasText: "daggar-hills" });
      await expect(refRow).toContainText("6638");

      // Input Map's default placement for this model is "Refinery" (first
      // entry in placementOptionsForModel) — no toggle needed.
      await clickMapAndConfirm(page);

      const latInput = page.getByTestId("input-new-warehouse-lat");
      const lngInput = page.getByTestId("input-new-warehouse-lng");
      await expect(latInput).not.toHaveValue("", { timeout: HEADER_TIMEOUT });
      const lat = await latInput.inputValue();
      const lng = await lngInput.inputValue();

      await page.getByTestId("input-new-warehouse-id").fill("e2e-newref");
      await page.getByTestId("input-new-warehouse-city").fill("Testburg");
      await page.getByTestId("input-new-warehouse-state").fill("ZZ");
      await page.getByTestId("button-add-warehouse-confirm").click();

      const addedRow = page.getByTestId("row-added-warehouse-e2e-newref");
      await expect(addedRow).toBeVisible();
      await expect(addedRow).toContainText("Testburg");
      await expect(addedRow).toContainText("ZZ");
      await expect(addedRow).toContainText(Number(lat).toFixed(4));
      await expect(addedRow).toContainText(Number(lng).toFixed(4));
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
