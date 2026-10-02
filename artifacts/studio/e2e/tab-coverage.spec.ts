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
import { test, expect, type Page } from "./fixtures";

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

/** Input Map v2 (replaced the old click→draft-panel→Confirm flow, which no
 * longer exists — `input-map-draft-panel` has 0 src refs): right-clicks an
 * empty spot on the Leaflet canvas, opens the "Add ... here" menu, picks the
 * "wh"-kind entity (warehouse/mine/refinery depending on the model — the
 * menu item testid is generic `map-add-menu-wh` across all of them, see
 * InputMapTab.tsx's `AddEntityMenu`), fills City/State on the
 * CreateEntityDialog that opens (id/display-code are server-shaped and
 * auto-generated — not user-editable in this flow, unlike the old draft
 * panel), and submits. Returns the dialog's own displayed lat/lng (full
 * precision — matches what `onSubmit` actually receives) and the
 * auto-generated display code, so the caller can assert the resulting
 * "Added ..." row without needing to guess the entity's server-generated id. */
async function clickMapAddAndFillCity(
  page: Page,
  city: string,
  state: string,
): Promise<{ lat: string; lng: string; displayCode: string }> {
  await page.getByTestId("sidebar-input-input-map").click();
  await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
  const mapCanvas = page.locator('[data-testid="input-map-tab"] .leaflet-container');
  await expect(mapCanvas).toBeVisible({ timeout: HEADER_TIMEOUT });
  const box = (await mapCanvas.boundingBox())!;
  // Top-right corner — clear of the dense base-marker field (established
  // empty-space zone, same as input-map-v2.spec.ts/workspace-fixups.spec.ts).
  await mapCanvas.click({ position: { x: box.width * 0.94, y: box.height * 0.06 }, button: "right" });
  await expect(page.getByTestId("map-add-menu")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("map-add-menu-wh").click();
  await expect(page.getByTestId("create-entity-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });

  const lat = (await page.getByTestId("create-entity-lat").textContent())!.trim();
  const lng = (await page.getByTestId("create-entity-lng").textContent())!.trim();
  await page.getByTestId("create-entity-city").fill(city);
  await page.getByTestId("create-entity-state").fill(state);
  const displayCode = (await page.getByTestId("create-entity-display-code").textContent())!.trim();
  await page.getByTestId("create-entity-submit").click();
  await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible();
  return { lat, lng, displayCode };
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

      // Right-click the Input Map (empty space), add a warehouse via the
      // CreateEntityDialog, City/State filled in-dialog.
      const { lat, lng, displayCode } = await clickMapAddAndFillCity(page, "Testburg", "ZZ");

      // The new row lands in "Added warehouses" — City/State/Lat/Lng
      // present, matching what was clicked; that table has NO Zip column at
      // all (added rows are never geocoded, DD-1).
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const addedSection = page.getByTestId("added-warehouses-section");
      await expect(addedSection).toBeVisible();
      const addedRow = addedSection.locator('[data-testid^="row-added-warehouse-"]');
      await expect(addedRow).toHaveCount(1, { timeout: HEADER_TIMEOUT });
      await expect(addedRow).toContainText(displayCode);
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

      // Input Map's "wh"-kind add menu item resolves to Mine for this model
      // (InputMapTab.tsx passes `role={MINE_ROLE}` for the transport-coal
      // variant's CreateEntityDialog) — no separate toggle needed.
      const { lat, lng, displayCode } = await clickMapAddAndFillCity(page, "Testburg", "ZZ");

      await page.getByTestId("sidebar-input-mines").click();
      await expect(page.getByTestId("mines-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const addedSection = page.getByTestId("added-mines-section");
      await expect(addedSection).toBeVisible();
      const addedRow = addedSection.locator('[data-testid^="row-added-mine-"]');
      await expect(addedRow).toHaveCount(1, { timeout: HEADER_TIMEOUT });
      await expect(addedRow).toContainText(displayCode);
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

      // Input Map's "wh"-kind add menu item resolves to Refinery for this
      // model (InputMapTab.tsx passes `role={REFINERY_ROLE}` for the
      // two-echelon-gold-au variant's CreateEntityDialog) — no separate
      // toggle needed. Refineries reuse WarehousesTab (entity="refineries")
      // — the "Added" section stays "added-warehouses-section"/
      // "row-added-warehouse-*" by design (WarehousesTab.tsx's own comment:
      // it doesn't thread `entity` into that section's testids).
      const { lat, lng, displayCode } = await clickMapAddAndFillCity(page, "Testburg", "ZZ");

      await page.getByTestId("sidebar-input-refineries").click();
      await expect(page.getByTestId("refineries-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const addedSection = page.getByTestId("added-warehouses-section");
      await expect(addedSection).toBeVisible();
      const addedRow = addedSection.locator('[data-testid^="row-added-warehouse-"]');
      await expect(addedRow).toHaveCount(1, { timeout: HEADER_TIMEOUT });
      await expect(addedRow).toContainText(displayCode);
      await expect(addedRow).toContainText("Testburg");
      await expect(addedRow).toContainText("ZZ");
      await expect(addedRow).toContainText(Number(lat).toFixed(4));
      await expect(addedRow).toContainText(Number(lng).toFixed(4));
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
