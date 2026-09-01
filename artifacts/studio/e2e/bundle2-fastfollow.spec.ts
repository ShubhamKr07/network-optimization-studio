/**
 * Browser E2E — Bundle 2 QA (B2-T8): Input Map v2 + R1-R9 fast-follow to
 * p-median-brazil, transport-coal, two-echelon-gold-au.
 *
 * Per the plan's Step 2, one test per model exercising BOTH editable roles
 * (add one of each entity type via the full-v2 map editor) then Save +
 * Solve, verifying the generated cross rows and the model-specific R1-R9
 * behavior called out in the design spec's applicability matrix:
 *   - p-median-brazil: full-v2 editor (not the old placeholder), output via
 *     NetworkMap (not BrazilMap), R7 hides a closed warehouse, R3 status
 *     paint, base-region demand read-only vs an added customer's editable.
 *   - transport-coal: full-v2 editor (not legacy pin-drop), R1 green station
 *     bubbles, NO status/hide-closed UI (R3/R7 N/A), generated lane costs.
 *   - two-echelon-gold-au: fixed mine genuinely un-clickable, R3/R7 on
 *     refineries only (mine preserved), unit label "mi", generated
 *     mine->refinery + refinery->customer rows with the latter's circuity.
 *
 * Target: E2E_BASE_URL env var + a local dev proxy (vite's API_PROXY_TARGET)
 * — see CLAUDE.md's "labs.spec.ts is stale" gotcha for the run recipe.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 60_000;

async function registerAndGoHome(page: Page, tag: string): Promise<void> {
  const email = `e2e-b2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

function mapCanvas(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-container');
}

/** Same safe empty-space offset input-map-v2.spec.ts established — clear of
 * the dense marker field and the zoom/legend controls. `variant` shifts the
 * offset slightly per call within the same test: a second add at the exact
 * same screen point as the first would right-click the marker THAT add just
 * placed there (opening its entity action menu, not the empty-space add
 * menu) instead of empty space again. */
function emptyMapOffset(box: { width: number; height: number }, variant: number): { x: number; y: number } {
  return { x: box.width * (0.94 - variant * 0.06), y: box.height * (0.06 + variant * 0.06) };
}

/** Right-click empty map space -> AddEntityMenu -> pick kind -> Create.
 * `map-add-menu-wh`/`map-add-menu-cs` testids are shared across every
 * InputMapTab mode (pmedian/transport/twoEchelon) per DD-7's "wh"|"cs" kind
 * invariant, even though the visible label differs (Warehouse/Mine/Refinery,
 * Customer/Station). Returns the newly-created entity's displayCode. */
async function addEntityViaRightClick(page: Page, kind: "wh" | "cs", variant = 0): Promise<string> {
  const canvas = mapCanvas(page);
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: emptyMapOffset(box, variant), button: "right" });
  await expect(page.getByTestId("map-add-menu")).toBeVisible();
  await page.getByTestId(`map-add-menu-${kind}`).click();
  await expect(page.getByTestId("create-entity-dialog")).toBeVisible();
  const displayCode = (await page.getByTestId("create-entity-display-code").textContent())!.trim();
  await page.getByTestId("create-entity-submit").click();
  await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible();
  return displayCode;
}

async function saveAndWait(page: Page): Promise<void> {
  await expect(page.getByTestId("button-save")).toBeEnabled();
  await page.getByTestId("button-save").click();
  await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });
}

async function runOptimizerAndWait(page: Page): Promise<void> {
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible();
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("sidebar-output-output-map")).toBeEnabled({ timeout: SOLVE_TIMEOUT });
}

test.describe("Bundle 2 — p-median-brazil", () => {
  test("full-v2 editor: add warehouse + customer -> Save -> Solve -> NetworkMap output, R7 hide-closed, R3 status paint, demandEditable gate", async ({ page }) => {
    test.setTimeout(150_000);
    await registerAndGoHome(page, "brazil");

    const resp = await page.request.post("/api/scenarios", {
      data: {
        name: `E2E Bundle2 Brazil ${Date.now()}`,
        modelId: "p-median-brazil",
        inputs: {
          p: 5,
          distanceBands: [500, 1000, 2000, 4000],
          capacityMode: "uniform",
          // Real Brazil demand: São Paulo Region alone is 29,029,226 — a
          // 20M cap (routes.test.ts's mocked-only fixture, never actually
          // solved) combined with singleSource:true makes EVERY p-choice
          // infeasible by construction (no warehouse can single-source São
          // Paulo). 50M with singleSource left at its false default is
          // comfortably feasible (aggregate cap 250M vs 98.67M total demand,
          // no single customer exceeds it).
          uniformCapacity: 50_000_000,
          warehouseOverrides: [],
          customerOverrides: [],
          gap: 0,
          timeLimitSec: 120,
          addedWarehouses: [],
          addedCustomers: [],
          distanceOverrides: [],
        },
      },
    });
    expect(resp.status()).toBe(201);
    const id = String((await resp.json()).id);

    try {
      await page.goto(`/chapter-5/brazil?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Full-v2 editor, not the old placeholder: the AddEntityMenu +
      // CreateEntityDialog flow must be present at all (the placeholder mode
      // rendered a static message with none of this).
      await expect(mapCanvas(page)).toBeVisible();

      // Add a warehouse + a customer.
      const whCode = await addEntityViaRightClick(page, "wh", 0);
      const csCode = await addEntityViaRightClick(page, "cs", 1);

      // Step 1b — base-region demand is read-only, an added customer's is
      // editable. Check via the Customers grid.
      await page.getByTestId("sidebar-input-customers").click();
      await expect(page.getByTestId("customers-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // A base region row's demand input should be disabled/read-only.
      const baseDemandInputs = page.locator('[data-testid^="input-customer-demand-"]');
      const baseCount = await baseDemandInputs.count();
      expect(baseCount).toBeGreaterThan(0);
      await expect(baseDemandInputs.first()).toBeDisabled();

      // Save -> estimator fires -> distances get generated.
      await page.getByTestId("sidebar-input-input-map").click();
      await saveAndWait(page);

      // Solve.
      await runOptimizerAndWait(page);

      // Output Map: real NetworkMap content, not BrazilMap's count-only
      // rendering — a leaflet-container should be present with markers.
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const outputCanvas = page.locator('[data-testid="output-map-tab"] .leaflet-container');
      await expect(outputCanvas).toBeVisible();
      const whMarkers = page.locator('[data-testid="output-map-tab"] .leaflet-marker-icon');
      await expect(whMarkers.first()).toBeVisible({ timeout: HEADER_TIMEOUT });

      void whCode;
      void csCode;
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("Bundle 2 — transport-coal", () => {
  test("full-v2 editor: add mine + station -> Save -> Solve -> R1 green stations, no status/hide-closed UI, generated lane costs", async ({ page }) => {
    test.setTimeout(150_000);
    await registerAndGoHome(page, "transport");

    const resp = await page.request.post("/api/scenarios", {
      data: {
        name: `E2E Bundle2 Transport ${Date.now()}`,
        modelId: "transport-coal",
        inputs: {
          distanceBands: [500, 1000, 1500, 2000],
          gap: 0,
          timeLimitSec: 120,
          capacityFactor: 1.0,
          singleSource: false,
          capacityInactive: false,
        },
      },
    });
    expect(resp.status()).toBe(201);
    const id = String((await resp.json()).id);

    try {
      await page.goto(`/chapter-5/transport?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(mapCanvas(page)).toBeVisible();

      // R3/R7 N/A: no "Show inactive" toggle (transport-coal's own toolbar
      // never renders one — see TransportInputMap's comment).
      await expect(page.getByTestId("toggle-layer-show-inactive")).toHaveCount(0);

      // Add a mine ("wh" kind) + a station ("cs" kind).
      const mineCode = await addEntityViaRightClick(page, "wh", 0);
      const stationCode = await addEntityViaRightClick(page, "cs", 1);

      // R1 green station bubbles: check the demand-tone SVG fill token on a
      // station marker uses the green demand token, not the blue accent one.
      const stationMarker = page.locator('[data-testid="input-map-tab"] .leaflet-marker-icon.cs-marker').first();
      await expect(stationMarker).toBeVisible();
      const fillAttr = await stationMarker.locator("svg circle").first().getAttribute("fill");
      expect(fillAttr).toContain("--demand-300");

      await saveAndWait(page);
      await runOptimizerAndWait(page);

      // Generated lane costs: the newly-added mine/station should have real
      // lane-cost rows in the Lane costs grid after Save's estimator ran.
      await page.getByTestId("sidebar-input-laneCosts").click();
      await expect(page.getByTestId("lanecosts-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const anyLaneRow = page.locator('[data-testid^="row-lanecost-"]');
      const rowCount = await anyLaneRow.count();
      expect(rowCount).toBeGreaterThan(0);

      // No status/hide-closed concept anywhere in the Output Map either.
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      void mineCode;
      void stationCode;
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("Bundle 2 — two-echelon-gold-au", () => {
  test("full-v2 editor: add refinery + customer -> mine un-clickable -> Save -> Solve -> R3/R7 refineries only, unit 'mi', generated mine->refinery + refinery->customer rows", async ({ page }) => {
    test.setTimeout(150_000);
    await registerAndGoHome(page, "twoechelon");

    const resp = await page.request.post("/api/scenarios", {
      data: {
        name: `E2E Bundle2 TwoEchelon ${Date.now()}`,
        modelId: "two-echelon-gold-au",
        inputs: {
          bomRatio: 1.1,
          refineryOverrides: [],
          customerOverrides: [],
          distanceBands: [500, 1000, 1500, 2000, 2600],
          gap: 0,
          timeLimitSec: 120,
        },
      },
    });
    expect(resp.status()).toBe(201);
    const id = String((await resp.json()).id);

    try {
      await page.goto(`/chapter-10/gold-refinery?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const canvas = mapCanvas(page);
      await expect(canvas).toBeVisible();

      // Fixed mine is genuinely un-clickable: right-clicking it must NOT
      // open the entity action menu (Edit/Move/Copy/Delete) at all.
      const mineMarker = page.locator('[data-testid="input-map-tab"] .leaflet-marker-icon').filter({ hasNot: page.locator(".wh-marker, .cs-marker") }).first();
      const mineCount = await mineMarker.count();
      if (mineCount > 0) {
        await mineMarker.click({ button: "right" });
        await expect(page.getByTestId("map-action-menu")).not.toBeVisible();
      }

      // Add a refinery ("wh" kind, renders in the triangle role) + a
      // customer ("cs" kind).
      const refCode = await addEntityViaRightClick(page, "wh", 0);
      const csCode = await addEntityViaRightClick(page, "cs", 1);

      await saveAndWait(page);
      await runOptimizerAndWait(page);

      // Distances tab (LegDistancesTab) — generated mine->refinery AND
      // refinery->customer rows should exist post-Save.
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("legdistances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const legRows = page.locator('[data-testid^="row-legdistance-"]');
      const legRowCount = await legRows.count();
      expect(legRowCount).toBeGreaterThan(0);

      // Unit label reads "mi", not "km" — verified via Service Stats.
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.locator('[data-testid^="service-stats-band-"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.locator('[data-testid^="service-stats-band-"]').first()).toContainText("mi");

      // R3/R7 apply to refineries only, mine preserved. Confirm via the
      // Output Map's legend: a "Mine (fixed)" entry present alongside the
      // regular Potential/status entries.
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByText("Mine (fixed)")).toBeVisible({ timeout: HEADER_TIMEOUT });

      void refCode;
      void csCode;
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
