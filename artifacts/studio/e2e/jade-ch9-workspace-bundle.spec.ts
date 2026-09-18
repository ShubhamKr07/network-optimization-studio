/**
 * Browser E2E — JADE Ch.9 Workspace Bundle QA (Wave D).
 *
 * Real-browser Playwright coverage for the bundle's nine requirements (spec
 * `docs/superpowers/specs/2026-09-17-jade-ch9-workspace-bundle-design.md`
 * §14, plan `docs/superpowers/plans/2026-09-17-jade-ch9-workspace-bundle.md`
 * task QA): overflow band color/label consistency, plant markers on the
 * Output Map, the three weighted-average-distance lines, the restructured
 * Customer Assignments/Flows reports, the Plant Production section, capacity
 * in the Capability Matrix, the "no 10M warehouse-capacity leak" audit, the
 * running solve clock, and FilterMenu on >10-row JADE tables. Also a
 * cross-model regression on `p-median-us` for requirement #1's all-models
 * scope (live band recolor + a bands-only save not going stale).
 *
 * Target: E2E_BASE_URL env var, requires the local dev proxy — see
 * CLAUDE.md's "Local dev DB"/"To run e2e locally" recipe.
 */
import { test, expect, type Page } from "@playwright/test";

// Bounds every action (click/fill/hover/etc — NOT `expect()` assertions,
// which have their own separate default) to a real, diagnosable failure
// instead of silently consuming the whole `test.setTimeout` budget. Found
// necessary the hard way: a plain `.click()`/`.hover()` with no explicit
// timeout defaults to the TEST's own timeout as its action timeout, so an
// action that can never become actionable (e.g. permanently covered by
// another element) doesn't error — it just burns the entire test budget
// before the outer timeout fires with a generic, unhelpful message.
test.use({ actionTimeout: 15_000 });
// A taller-than-default viewport — the default Chromium 1280×720 clips a
// FilterMenu's Radix Popover checkbox out of the viewport when the trigger
// sits low on a tall Workspace page (confirmed: `.click()` retried for the
// full actionTimeout reporting "element is outside of the viewport" on
// `checkbox-filter-plant-Plant 1`). A taller window gives every popover this
// spec opens room to render fully on-screen.
test.use({ viewport: { width: 1400, height: 1400 } });

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;

// ── Shared helpers ──────────────────────────────────────────────────────

async function registerAndGoHome(page: Page, slug: string): Promise<string> {
  const email = `e2e-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
  return email;
}

/** Tracks every request whose URL is a solve-trigger or solve-job-poll
 * endpoint (`POST .../solve`, `GET .../solve-jobs/:jobId`) — used to prove
 * a band edit causes ZERO solve network calls (spec §2's "live band recolor
 * without solve" requirement). */
function makeSolveCallTracker(page: Page) {
  const urls: string[] = [];
  page.on("request", req => {
    const url = req.url();
    if (/\/scenarios\/\d+\/solve(-jobs)?(\/|$|\?)/.test(url)) urls.push(url);
  });
  return { count: () => urls.length, urls };
}

// ── JADE-specific helpers ───────────────────────────────────────────────

/** Ground-truth JADE inputs (mirrors e2e/jade-two-echelon.spec.ts): P=2,
 * wh-11 (Phoenix) + wh-14 (New York) forced open, bands [200,400,800,1600].
 * Solving with this config is known-good (produces a real feasible result
 * serving every customer), which is all this QA task's checks need — the
 * ground-truth OBJECTIVE match itself is jade-two-echelon.spec.ts's job, not
 * re-verified here. */
function jadeGroundTruthInputs() {
  return {
    p: 2,
    distanceBands: [200, 400, 800, 1600],
    gap: 0,
    timeLimitSec: 120,
    warehouseOverrides: [
      { id: "wh-11", status: "forced_open" },
      { id: "wh-14", status: "forced_open" },
    ],
  };
}

async function createJadeScenario(page: Page): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E JADE Bundle QA ${Date.now()}`,
      modelId: "two-echelon-jade-us",
      inputs: jadeGroundTruthInputs(),
    },
  });
  expect(resp.status()).toBe(201);
  const id = Number((await resp.json()).id);
  await page.goto(`/chapter-9/jade?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

/**
 * Opens the Run Optimizer dialog, triggers Solve, makes a best-effort
 * attempt to observe the live dialog clock reach the "Queued Xs · Solving
 * Ys" split state before the dialog auto-closes on success (item #8's
 * "queued→active split" — inherently timing-dependent, since a fast local
 * CBC solve can complete before a poll interval elapses), then waits for the
 * auto-close (Output Map tab becomes visible). Returns whether the split was
 * actually observed, purely informational — item #8's real, DETERMINISTIC
 * assertion is the persistent `output-map-timing` overlay checked
 * separately by the caller, which always shows the queued/active split
 * regardless of how fast the solve was.
 */
async function solveAndObserveClock(page: Page): Promise<boolean> {
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();

  const elapsed = page.getByTestId("solve-dialog-elapsed");
  let sawSplit = false;
  for (let i = 0; i < 100; i++) {
    const dialogVisible = await page.getByTestId("solve-dialog").isVisible().catch(() => false);
    if (!dialogVisible) break;
    const text = await elapsed.innerText().catch(() => "");
    if (/Queued \d+s\s*·\s*Solving \d+s/.test(text)) {
      sawSplit = true;
      break;
    }
    await page.waitForTimeout(150);
  }

  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });
  await expect(page.getByTestId("sidebar-output-cost-summary")).toBeEnabled({ timeout: HEADER_TIMEOUT });
  return sawSplit;
}

/**
 * At the Output Map's fitted zoom level (whole continental US + plants),
 * several of the 100 customer dots visually overlap each other and/or a
 * plant/warehouse marker (this dataset even has exact-coincident points,
 * e.g. customer-11 sits exactly on wh-11). A plain `.first()` customer path
 * can therefore be visually topped by a DIFFERENT entity at the same pixel
 * (confirmed directly: hovering `.first()` — customer-1, Los Angeles — hit
 * plant-4's tooltip, "plant-4 — Long Beach, CA", since LA and Long Beach are
 * ~20 mi apart and collapse to the same screen point at this zoom).
 * `force: true` prevents Playwright's own actionability check from hanging
 * forever, but the underlying native mouse event still targets whatever is
 * physically topmost at that coordinate — so `force` alone doesn't fix
 * WHICH entity gets hit. This picks a customer marker whose bounding box
 * doesn't intersect any OTHER customer marker's or any marker-pane
 * (plant/warehouse) icon's bounding box, so hover/click deterministically
 * lands on that one customer.
 */
async function pickIsolatedCustomerMarker(page: Page) {
  const customerLoc = page.locator('[data-testid="output-map-tab"] .leaflet-overlay-pane path.leaflet-interactive');
  const markerLoc = page.locator('[data-testid="output-map-tab"] .leaflet-marker-pane > div');
  const customerCount = await customerLoc.count();
  const markerCount = await markerLoc.count();

  const customerBoxes: ({ x: number; y: number; width: number; height: number } | null)[] = [];
  for (let i = 0; i < customerCount; i++) customerBoxes.push(await customerLoc.nth(i).boundingBox());
  const markerBoxes: ({ x: number; y: number; width: number; height: number } | null)[] = [];
  for (let i = 0; i < markerCount; i++) markerBoxes.push(await markerLoc.nth(i).boundingBox());

  function overlaps(
    a: { x: number; y: number; width: number; height: number } | null,
    b: { x: number; y: number; width: number; height: number } | null,
    pad = 2,
  ): boolean {
    if (!a || !b) return false;
    return !(a.x + a.width + pad < b.x || b.x + b.width + pad < a.x || a.y + a.height + pad < b.y || b.y + b.height + pad < a.y);
  }

  for (let i = 0; i < customerCount; i++) {
    const box = customerBoxes[i];
    if (!box) continue;
    const overlapsOtherCustomer = customerBoxes.some((b, j) => j !== i && overlaps(box, b));
    const overlapsMarker = markerBoxes.some(b => overlaps(box, b));
    if (!overlapsOtherCustomer && !overlapsMarker) {
      return { locator: customerLoc.nth(i), index: i };
    }
  }
  throw new Error("Could not find an isolated (non-overlapping) customer marker to interact with.");
}

test.describe("JADE Ch.9 Workspace Bundle — QA", () => {
  test("JADE model: overflow color, plants, avg-distance lines, restructured reports, plant production, capability capacity, no 10M leak, solve clock, FilterMenu", async ({ page }) => {
    test.setTimeout(300_000);
    await registerAndGoHome(page, "jade-bundle");
    const id = await createJadeScenario(page);
    const solveCalls = makeSolveCallTracker(page);

    try {
      // ── Item #8 (part 1) — solve + best-effort live clock split ─────────
      const sawLiveSplit = await solveAndObserveClock(page);

      // ── Item #8 (part 2, DETERMINISTIC) — persistent frozen total AFTER
      // the dialog auto-closed, on the Output Map overlay. This is the real
      // assertion for requirement #8 — it always shows both the total AND
      // the queued/active split regardless of solve speed. ────────────────
      const timing = page.getByTestId("output-map-timing");
      await expect(timing).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(timing).toContainText(/Solve time: [\d.]+s/);
      await expect(timing).toContainText(/queued [\d.]+s\s*·\s*active [\d.]+s/);
      // The dialog itself must really be gone (not just occluded) — proves
      // "persistent... AFTER the dialog auto-closes", not "still open".
      await expect(page.getByTestId("solve-dialog")).not.toBeVisible();

      // ── Item #2 — plant markers, connected lanes, union-bounds fit ──────
      await expect(page.getByTestId("checkbox-toggle-plants")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("checkbox-toggle-plants")).toBeChecked();

      const plantRectSelector = '[data-testid="output-map-tab"] .leaflet-marker-pane svg rect';
      // `<rect>` is unique to the plant marker's SVG builder (plantSquareSvg)
      // — warehouse/mine markers use `<polygon>`/`<path>`, never `<rect>` —
      // so this selector unambiguously counts plant markers only.
      const plantMarkerCount = await page.locator(plantRectSelector).count();
      expect(plantMarkerCount).toBeGreaterThan(0);

      // Bounds include plants: the first plant marker's bounding box must
      // fall inside the map container's own bounding box (i.e. it's
      // actually within the fitted viewport, not off-canvas).
      const mapContainer = page.locator('[data-testid="output-map-tab"] .leaflet-container');
      const mapBox = await mapContainer.boundingBox();
      const plantBox = await page.locator(plantRectSelector).first().boundingBox();
      expect(mapBox).not.toBeNull();
      expect(plantBox).not.toBeNull();
      const plantCx = plantBox!.x + plantBox!.width / 2;
      const plantCy = plantBox!.y + plantBox!.height / 2;
      expect(plantCx).toBeGreaterThanOrEqual(mapBox!.x);
      expect(plantCx).toBeLessThanOrEqual(mapBox!.x + mapBox!.width);
      expect(plantCy).toBeGreaterThanOrEqual(mapBox!.y);
      expect(plantCy).toBeLessThanOrEqual(mapBox!.y + mapBox!.height);

      // Toggling the Plants layer hides/shows the markers.
      await page.getByTestId("checkbox-toggle-plants").click();
      await expect(page.locator(plantRectSelector)).toHaveCount(0);
      await page.getByTestId("checkbox-toggle-plants").click();
      await expect(async () => {
        expect(await page.locator(plantRectSelector).count()).toBe(plantMarkerCount);
      }).toPass({ timeout: HEADER_TIMEOUT });

      // Legend has a "Plant" entry.
      await expect(page.getByTestId("legend-output-plant")).toBeVisible();

      // A plant→warehouse lane connects to a plant marker: the leg toggle
      // exists and hiding the OTHER leg (warehouse→customer) still leaves
      // plant→warehouse routes rendered (i.e. they resolve/draw at all,
      // confirming the endpoint lookup against the now-visible plant
      // markers works).
      const routePaths = page.locator(".leaflet-route-pane path");
      await expect(routePaths.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      const fullRouteCount = await routePaths.count();
      const wcLegToggle = page.getByTestId("checkbox-toggle-leg-warehouse_to_customer");
      const pwLegToggle = page.getByTestId("checkbox-toggle-leg-plant_to_warehouse");
      await expect(wcLegToggle).toBeVisible();
      await expect(pwLegToggle).toBeVisible();
      await wcLegToggle.click();
      await expect(async () => {
        const count = await routePaths.count();
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(fullRouteCount);
      }).toPass({ timeout: HEADER_TIMEOUT });
      await wcLegToggle.click(); // restore
      await expect(async () => {
        expect(await routePaths.count()).toBe(fullRouteCount);
      }).toPass({ timeout: HEADER_TIMEOUT });

      // ── Item #3 — three labelled avg-distance lines ─────────────────────
      const pwAvg = page.getByTestId("output-map-leg-avg-plant_to_warehouse");
      const wcAvg = page.getByTestId("output-map-leg-avg-warehouse_to_customer");
      const overallAvg = page.getByTestId("output-map-overall-avg");
      await expect(pwAvg).toBeVisible();
      await expect(wcAvg).toBeVisible();
      await expect(overallAvg).toBeVisible();
      await expect(pwAvg).toContainText(/Plant → Warehouse avg distance: [\d.]+ mi/);
      await expect(wcAvg).toContainText(/Warehouse → Customer avg distance: [\d.]+ mi/);
      await expect(overallAvg).toContainText(/Overall avg distance: [\d.]+ mi/);

      // ── Item #1 — overflow color/label, live recolor, zero solve calls ──
      const solveCallsBeforeBandEdit = solveCalls.count();

      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("optimization-parameters-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("jade-band-editor")).toBeVisible();
      // Set tiny, strictly-ascending, positive-integer bands so EVERY real
      // JADE lane (dozens to hundreds of miles apart) is unambiguously
      // beyond the highest boundary — i.e. universally Overflow. No error
      // should ever show (each intermediate draft stays valid).
      await page.getByTestId("jade-band-slot-0").fill("1");
      await page.getByTestId("jade-band-slot-1").fill("2");
      await page.getByTestId("jade-band-slot-2").fill("3");
      await page.getByTestId("jade-band-slot-3").fill("4");
      await expect(page.getByTestId("jade-band-error")).toHaveCount(0);

      // Customer Assignments' Distance Band column reads the SAME live
      // bands the map reads — confirms the presentation-band lens updates
      // without navigating through a save/solve.
      await page.getByTestId("sidebar-output-customer-assignments").click();
      await expect(page.getByTestId("jade-assignments-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.locator('[data-testid^="cell-jadeassignment-band-"]').first()).toHaveText("Overflow");

      // Back to the Output Map: the map lens is live too
      // (getBandColor(-1) === "var(--band-overflow)", set literally as the
      // SVG stroke attribute by react-leaflet's pathOptions.color). Compute
      // the DETERMINISTIC expected overflow/non-overflow partition from the
      // scenario's own real solved edges rather than assuming "every lane
      // is overflow" — this dataset has two customers (customer-11/wh-11,
      // customer-14/wh-14) at the exact same coordinates as their
      // forced-open warehouse (distance 0), which under tiny bands
      // [1,2,3,4] land in band 0, not Overflow. Every other real geographic
      // lane is easily >4 mi.
      const scenarioResp = await page.request.get(`/api/scenarios/${id}`);
      const scenarioJson = await scenarioResp.json();
      const solvedEdges: { distance: number }[] = scenarioJson.result.edges;
      const TINY_BAND_MAX = 4;
      const expectedOverflowCount = solvedEdges.filter(e => e.distance > TINY_BAND_MAX).length;
      const expectedBandZeroCount = solvedEdges.length - expectedOverflowCount;
      expect(expectedOverflowCount).toBeGreaterThan(0);

      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("legend-overflow-band")).toBeVisible();
      const routePathsAfter = page.locator(".leaflet-route-pane path");
      await expect(routePathsAfter.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await routePathsAfter.count()).toBe(solvedEdges.length);
      const overflowPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-overflow)"]');
      const bandZeroPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-0)"]');
      await expect(overflowPaths).toHaveCount(expectedOverflowCount);
      await expect(bandZeroPaths).toHaveCount(expectedBandZeroCount);

      // Tooltip on a customer marker reads "Overflow" — pick a customer
      // marker that's visually ISOLATED (no other marker overlapping its
      // bounding box) so hover/click deterministically lands on it (see
      // `pickIsolatedCustomerMarker`'s own comment: a naive `.first()`
      // customer at this zoom level can be visually topped by an unrelated
      // marker, e.g. customer-1/Los Angeles sits under plant-4/Long Beach).
      const { locator: customerPath } = await pickIsolatedCustomerMarker(page);
      await expect(customerPath).toBeVisible({ timeout: HEADER_TIMEOUT });
      await customerPath.hover({ timeout: HEADER_TIMEOUT });
      const tooltip = page.locator(".leaflet-tooltip");
      await expect(tooltip).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(tooltip).toContainText("Overflow");
      await expect(tooltip).not.toContainText(/Band \d/);

      // Popup (click) on the same customer: "Overflow" label + overflow
      // color swatch, never "Band N" — and the marker's own highlight fill
      // switches to the overflow color too (consistency across lane +
      // highlight + popup + tooltip, spec §2's explicit all-site
      // requirement).
      await customerPath.click({ timeout: HEADER_TIMEOUT });
      const popupContent = page.locator(".leaflet-popup-content");
      await expect(popupContent).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(popupContent).toContainText("Overflow");
      await expect(popupContent).not.toContainText(/Band \d/);
      await expect(customerPath).toHaveAttribute("fill", "var(--band-overflow)");

      // Zero solve/solve-job network calls fired anywhere in this whole
      // band-edit + navigate + recolor sequence.
      expect(solveCalls.count()).toBe(solveCallsBeforeBandEdit);

      // ── Item #4 — Customer Assignments columns + Flows two inner tabs ───
      await page.getByTestId("sidebar-output-customer-assignments").click();
      await expect(page.getByTestId("jade-assignments-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const assignmentHeaders = await page.locator('[data-testid="jade-assignments-tab"] thead th').allInnerTexts();
      expect(assignmentHeaders).toEqual(["Product", "Customer", "Assigned Warehouse", "Distance", "Distance Band"]);
      expect(assignmentHeaders).not.toContain("Demand");
      expect(assignmentHeaders).not.toContain("Flow");

      await page.getByTestId("sidebar-output-flows").click();
      await expect(page.getByTestId("jade-flows-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-jade-flows-inner-plant-warehouse")).toHaveAttribute("aria-pressed", "true");
      const pwHeaders = await page.locator('[data-testid="jade-flows-pw-table"] thead th').allInnerTexts();
      expect(pwHeaders).toEqual(["Plant", "Warehouse", "Distance", "Flow", "Distance Band"]);
      expect(pwHeaders).not.toContain("Product");
      expect(pwHeaders).not.toContain("Transport Cost");

      await page.getByTestId("button-jade-flows-inner-warehouse-customer").click();
      await expect(page.getByTestId("jade-flows-wc-table")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const wcHeaders = await page.locator('[data-testid="jade-flows-wc-table"] thead th').allInnerTexts();
      expect(wcHeaders).toEqual(["Warehouse", "Customer", "Distance", "Flows", "Distance Band"]);

      // ── Item #5 — Plant Production section (full effective grid) ───────
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.getByTestId("plant-production-section")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const plantProdHeaders = await page
        .locator('[data-testid="plant-production-section"] thead th')
        .allInnerTexts();
      expect(plantProdHeaders).toEqual(["Plant", "Product", "Actual production", "Enabled capacity", "Remaining capacity"]);
      // Full effective 4 plants × 4 products grid — every combo present,
      // including disabled/zero-production ones (not dropped).
      await expect(page.locator('[data-testid^="row-plant-production-"]')).toHaveCount(16);
      // A disabled (off-diagonal) combo still renders with capacity 0 and
      // remaining "—".
      const disabledRow = page.getByTestId("row-plant-production-plant-1-product-2");
      await expect(disabledRow).toBeVisible();
      await expect(disabledRow).toContainText("0");
      await expect(disabledRow).toContainText("—");

      // ── Item #6 — Capability Matrix: read-only capacity, flips live ─────
      await page.getByTestId("sidebar-input-capability-matrix").click();
      await expect(page.getByTestId("capability-matrix-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-capability-capacity-plant-1-product-1")).toHaveText("210,000,000");
      await expect(page.getByTestId("checkbox-capability-plant-1-product-1")).toBeChecked();
      await expect(page.getByTestId("text-capability-capacity-plant-1-product-2")).toHaveText("0");
      await expect(page.getByTestId("checkbox-capability-plant-1-product-2")).not.toBeChecked();

      // Enable the off-diagonal cell -> capacity flips live to 210,000,000
      // (the shared JADE_ENABLED_CAPACITY fallback for ANY enabled cell, not
      // only added-plant cells — spec §7).
      await page.getByTestId("checkbox-capability-plant-1-product-2").click();
      await expect(page.getByTestId("checkbox-capability-plant-1-product-2")).toBeChecked();
      await expect(page.getByTestId("text-capability-capacity-plant-1-product-2")).toHaveText("210,000,000");
      // Toggle back off -> reverts to 0.
      await page.getByTestId("checkbox-capability-plant-1-product-2").click();
      await expect(page.getByTestId("checkbox-capability-plant-1-product-2")).not.toBeChecked();
      await expect(page.getByTestId("text-capability-capacity-plant-1-product-2")).toHaveText("0");

      // ── Item #7 — no warehouse-capacity leak / no 10,000,000 ────────────
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const warehousesTabText = await page.getByTestId("warehouses-tab").innerText();
      expect(warehousesTabText).not.toContain("10,000,000");
      const warehouseHeaders = await page.locator('[data-testid="warehouses-tab"] thead th').allInnerTexts();
      expect(warehouseHeaders).not.toContain("Capacity");
      // The "Add warehouse" form also has no capacity field for JADE.
      await page.getByTestId("button-add-warehouse-row").click();
      await expect(page.getByTestId("add-warehouse-row-form")).toBeVisible();
      await expect(page.getByTestId("input-new-warehouse-capacity")).toHaveCount(0);
      await page.getByTestId("button-add-warehouse-cancel").click();

      await page.getByTestId("sidebar-output-open-warehouses").click();
      await expect(page.locator('[data-testid^="open-warehouse-row-"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      const openWhText = await page.locator("body").innerText();
      expect(openWhText).not.toContain("10,000,000");
      // JADE (capacityModes: []) shows "Demand Served", never "Utilization".
      expect(openWhText).toContain("Demand Served");

      // ── Item #9 — FilterMenu on >10-row JADE tables ─────────────────────
      // Plant Production (16 rows, always > 10 for JADE — a robust,
      // dataset-guaranteed >10-row table).
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.getByTestId("plant-production-section")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const plantProdFilterTrigger = page
        .locator('[data-testid="plant-production-section"]')
        .getByTestId("button-filter-menu-trigger");
      await expect(plantProdFilterTrigger).toBeVisible();
      await plantProdFilterTrigger.click();
      await expect(page.getByTestId("filter-menu-popover")).toBeVisible();
      await expect(page.getByTestId("text-filter-count")).toHaveText("16 of 16");
      await page.getByTestId("checkbox-filter-plant-Plant 1").click();
      await expect(page.getByTestId("text-filter-count")).toHaveText("4 of 16");
      await expect(page.locator('[data-testid^="row-plant-production-"]')).toHaveCount(4);
      await page.getByTestId("button-clear-all-filters").click();
      await expect(page.getByTestId("text-filter-count")).toHaveText("16 of 16");
      await expect(page.locator('[data-testid^="row-plant-production-"]')).toHaveCount(16);
      await page.keyboard.press("Escape");

      // Warehouses input (25 base rows — spec §10's explicit "incl.
      // Warehouses input" ask).
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const whFilterTrigger = page.getByTestId("warehouse-table-filter-bar").getByTestId("button-filter-menu-trigger");
      await expect(whFilterTrigger).toBeVisible();
      await whFilterTrigger.click();
      await expect(page.getByTestId("filter-menu-popover")).toBeVisible();
      await expect(page.getByTestId("text-filter-count")).toHaveText("25 of 25");
      // Type-aware: Status is a select descriptor. Only wh-11/wh-14 are
      // Fixed-Open (the ground-truth forced-open overrides).
      await page.getByTestId("checkbox-filter-status-Fixed-Open").click();
      await expect(page.getByTestId("text-filter-count")).toHaveText("2 of 25");
      await expect(page.locator('[data-testid^="button-wh-"][data-testid$="-active"]')).toHaveCount(2);
      await page.getByTestId("button-clear-all-filters").click();
      await expect(page.getByTestId("text-filter-count")).toHaveText("25 of 25");
      await expect(page.locator('[data-testid^="button-wh-"][data-testid$="-active"]')).toHaveCount(25);

      // A ≤10-row table (Capability Matrix — 4 plant rows) shows no
      // FilterMenu at all.
      await page.getByTestId("sidebar-input-capability-matrix").click();
      await expect(page.getByTestId("capability-matrix-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-filter-menu-trigger")).toHaveCount(0);

      // ── Best-effort informational note (not a hard assertion) ──────────
      test.info().annotations.push({
        type: "solve-dialog-clock-split-observed",
        description: String(sawLiveSplit),
      });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("Cross-model regression — p-median-us (requirement #1 all-models scope)", () => {
  function pMedianInputs() {
    return {
      p: 3,
      distanceBands: [200, 400, 800, 1600],
      capacityMode: "none",
      uniformCapacity: null,
      warehouseOverrides: [],
      customerOverrides: [],
      gap: 0,
      timeLimitSec: 120,
    };
  }

  async function createPMedianScenario(page: Page): Promise<number> {
    const resp = await page.request.post("/api/scenarios", {
      data: { name: `E2E PMedian Bundle QA ${Date.now()}`, modelId: "p-median-us", inputs: pMedianInputs() },
    });
    expect(resp.status()).toBe(201);
    return Number((await resp.json()).id);
  }

  async function solveViaApi(page: Page, scenarioId: number): Promise<void> {
    const solveResp = await page.request.post(`/api/scenarios/${scenarioId}/solve`);
    expect(solveResp.status()).toBe(202);
    const { jobId } = await solveResp.json();
    let status = "queued";
    for (let i = 0; i < 60 && (status === "queued" || status === "running"); i++) {
      await page.waitForTimeout(500);
      const pollResp = await page.request.get(`/api/scenarios/${scenarioId}/solve-jobs/${jobId}`);
      status = (await pollResp.json()).status;
    }
    expect(status).toBe("succeeded");
  }

  test("band edit recolors lanes live (no solve call); a bands-only save does not stale", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page, "pmedian-bundle");
    const id = await createPMedianScenario(page);
    const solveCalls = makeSolveCallTracker(page);

    try {
      await solveViaApi(page, id);
      await page.goto(`/chapter-3?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("stale-output-banner")).toHaveCount(0);
      // Ground-truth bands = [200,400,800,1600] -> 4 legend swatches.
      await expect(page.locator('[data-testid^="legend-band-"]')).toHaveCount(4);
      await expect(page.getByTestId("legend-overflow-band")).toBeVisible();

      const callsBeforeEdit = solveCalls.count();

      // Edit bands on the Optimization Parameters tab (the chip editor —
      // p-median-us is NOT the JADE fixed-4 editor).
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("optimization-parameters-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-bands-plus").click();
      await page.getByTestId("input-new-band").fill("2000");
      await page.getByTestId("button-add-band-confirm").click();
      await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Live recolor on the Output Map — zero navigation-driven data
      // refetch, zero solve calls — just switching tabs re-renders from the
      // same live localInputs.distanceBands.
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.locator('[data-testid^="legend-band-"]')).toHaveCount(5);
      expect(solveCalls.count()).toBe(callsBeforeEdit);
      await expect(page.getByTestId("stale-output-banner")).toHaveCount(0);

      // Save the bands-only change.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("optimization-parameters-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-save")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });

      // Reload for real, re-verify: no stale banner, bands persisted, still
      // 5 legend swatches, still zero solve calls fired by any of this.
      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("stale-output-banner")).toHaveCount(0);
      await expect(page.locator('[data-testid^="legend-band-"]')).toHaveCount(5);
      expect(solveCalls.count()).toBe(callsBeforeEdit);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
