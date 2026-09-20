/**
 * Browser E2E — Workspace fixups 2 (QA, Wave 5).
 *
 * Real-browser Playwright coverage for the 7 items in
 * `docs/superpowers/specs/2026-09-20-workspace-fixups-2-design.md` §9:
 *   1. No "Added Entities" tab — each input tab has an inline "+ Add"
 *      button that adds an entity, and Save persists it.
 *   2. A >10-row OUTPUT table shows City, State above the mono display-ID
 *      (matches the Open Warehouses cell) — exercised on a non-JADE model
 *      (p-median-us's Customer Assignments) per the plan's own DoD.
 *   3. A JADE input tab has the Filter on the same line as Import/Export;
 *      a non-JADE input tab has no filter at all.
 *   4. Map marker hover shows "Type · ID · City, State" on BOTH the Input
 *      and Output map, for a warehouse, a customer, a plant, the gold-au
 *      fixed mine (keeps "(fixed)" on the Input map), a gold-au facility
 *      ("Refinery"), and transport-coal's supply/demand roles ("Mine"/
 *      "Station").
 *   5. The homepage "AL's Athletics" card shows no "P-Median".
 *   6. A JADE Distance-Band filter option reads "Band N: X mi - Y mi" /
 *      "Band N: > X mi"; table CELLS stay "Band N"/"Overflow".
 *   7. JADE's Run Optimizer shows the same free chip band editor as
 *      Chapter 3 (not a fixed-4 editor); a 5th band can be added and
 *      solved; removing bands down to one disables the last "×".
 *
 * Target: E2E_BASE_URL env var + a local dev proxy (vite's
 * API_PROXY_TARGET) — see CLAUDE.md's "Local dev DB"/"To run e2e locally"
 * recipe. Each test registers its own disposable account and deletes its
 * own scenario in a `finally` block.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

// Same rationale as jade-ch9-workspace-bundle.spec.ts/workspace-fixups.spec.ts:
// a plain `.click()`/`.hover()` with no explicit action timeout defaults to
// the whole TEST timeout, so an action that can never become actionable
// burns the entire budget before a diagnosable error appears. A taller
// viewport keeps markers/dialogs fully on-screen.
test.use({ actionTimeout: 15_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 120_000;

// ── Shared helpers ──────────────────────────────────────────────────────

async function registerAndGoHome(page: Page, slug: string): Promise<void> {
  const email = `e2e-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenario(page: Page, modelId: string, inputs: Record<string, unknown>, path: string): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E WorkspaceFixups2 ${modelId} ${Date.now()}`, modelId, inputs },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`${path}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

/** Item 1 — confirmed structurally absent everywhere (no per-model sidebar
 * entry survives the revert). Called once per model's test as a cheap,
 * always-true-if-the-revert-landed sanity check. */
async function expectNoAddedEntitiesTab(page: Page): Promise<void> {
  await expect(page.getByTestId("sidebar-input-added-entities")).toHaveCount(0);
}

async function solveAndWait(page: Page): Promise<void> {
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });
  await expect(page.getByTestId("solve-dialog")).not.toBeVisible();
}

// ── Map-hover helpers (item 4) ──────────────────────────────────────────
//
// The Output map (`NetworkMap.tsx`) renders warehouse/mine/plant/refinery
// markers as `L.divIcon` SVGs with an EMPTY `className` (no `wh-marker`/
// `cs-marker` class to key off, unlike the Input map's `EntityMarkers.tsx`)
// and customers as `CircleMarker` SVG `<path>`s in the overlay pane, not the
// marker pane. So role is identified by SHAPE (`<polygon>` vs `<path>` vs
// `<polygon fill="var(--map-plant)">`) rather than a CSS class, confirmed
// directly against NetworkMap.tsx's `createTriangleIcon`/`createStarIcon`/
// `createPlantIcon` (fixed literal SVG strings) before writing this.
//
// Markers of DIFFERENT roles can sit inside the same dense cluster at a
// dataset's default fitted zoom (confirmed directly: JADE's 4 plants render
// inside a tight NYC-area warehouse/customer cluster, with zero fully
// isolated candidate) — geometric non-overlap can't always be proven up
// front. Instead of picking by geometry, this hovers each candidate IN TURN
// and checks the SEMANTIC result (does the resulting tooltip actually start
// with the expected role?), stopping at the first real match — robust to
// any overlap shape, since it only needs ONE candidate to land correctly.

/** Leaflet keeps a just-closed tooltip's DOM node around briefly during its
 * fade-out CSS transition, so right after a NEW hover both the old and new
 * `.leaflet-tooltip` nodes can transiently co-exist (confirmed directly —
 * an unscoped `.leaflet-tooltip` locator hit a Playwright strict-mode
 * violation with 2 matches). Leaflet always APPENDS the newly-opened
 * tooltip as the tooltip pane's last child, so `.last()` reliably targets
 * the just-opened one regardless of a stale sibling still fading out. */
async function readTooltipText(page: Page, mapTestId: string): Promise<string> {
  const tooltip = page.locator(`[data-testid="${mapTestId}"] .leaflet-tooltip`).last();
  await expect(tooltip).toBeVisible({ timeout: 10_000 });
  return (await tooltip.innerText()).trim();
}

async function hoverUntilType(page: Page, mapTestId: string, candidateLoc: Locator, expectedType: string): Promise<string> {
  const n = await candidateLoc.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const el = candidateLoc.nth(i);
    const box = await el.boundingBox();
    if (!box) continue;
    await el.scrollIntoViewIfNeeded();
    // `force: true` — bypass Playwright's "not obscured" actionability
    // check (a marker can be visually stacked under another at this pixel);
    // the real synthetic mouse event still lands at the element's
    // coordinates and the browser hit-tests whatever is truly topmost
    // there, which is exactly what we want to observe via the resulting
    // tooltip's own text, not assume in advance.
    await el.hover({ timeout: 15_000, force: true });
    let text: string;
    try {
      text = await readTooltipText(page, mapTestId);
    } catch {
      continue;
    }
    if (text.startsWith(`${expectedType} ·`)) return text;
  }
  throw new Error(`Could not find a "${expectedType}" tooltip among ${n} candidate marker(s) on ${mapTestId}.`);
}

/** Asserts the tooltip text starts with "<Type> · <id> · <City>, <ST>"
 * (real Australian states like "QLD" run 2-4 letters, hence the range; a
 * base plant's display id is a base-dataset `name` like "Plant 1" — a
 * multi-word string, not always a single token — hence the non-greedy
 * `.+?` rather than `\S+`) — extra suffixes (demand, band, customer count,
 * "(fixed)") are allowed after, per item 4's "existing extras preserved"
 * DoD. */
function assertTooltipShape(text: string, type: string): void {
  const re = new RegExp(`^${type} · .+? · [^,]+, [A-Z]{2,4}\\b`);
  expect(text).toMatch(re);
}

// Input map (EntityMarkers.tsx) — divIcon markers carry role-specific
// classes.
function inputWarehouseMarkers(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-marker-icon.wh-marker');
}
function inputCustomerMarkers(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-marker-icon.cs-marker');
}
function inputPlantMarkers(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-marker-icon.pl-marker');
}
/** The gold-au fixed mine — a BARE `<Marker>` with no custom `icon` prop
 * (InputMapTab.tsx ~line 1859), so it renders Leaflet's DEFAULT pin icon
 * (an `<img class="leaflet-marker-icon">`), unlike every other role's
 * `L.divIcon` (`<div class="leaflet-marker-icon ...">`). It's the ONLY
 * `<img>` marker on this model's Input Map — a clean, tag-based selector. */
function inputFixedMineMarker(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-marker-pane img.leaflet-marker-icon');
}

// Output map (NetworkMap.tsx) — divIcon markers all share an EMPTY class,
// so role is identified by the SVG shape/fill each icon's fixed literal
// string always produces; `:has()` returns the wrapping `.leaflet-marker-icon`
// div itself (matching `allEntityBoxes`' own collection unit).
function outputWarehouseTriangleMarkers(page: Page): Locator {
  return page.locator('[data-testid="output-map-tab"] .leaflet-marker-pane .leaflet-marker-icon:has(svg polygon[points="12,2 22,20 2,20"])');
}
function outputMineStarMarkers(page: Page): Locator {
  return page.locator('[data-testid="output-map-tab"] .leaflet-marker-pane .leaflet-marker-icon:has(svg path[d^="M12 2L14.2"])');
}
function outputPlantMarkers(page: Page): Locator {
  return page.locator('[data-testid="output-map-tab"] .leaflet-marker-pane .leaflet-marker-icon:has(svg polygon[fill="var(--map-plant)"])');
}
function outputCustomerMarkers(page: Page): Locator {
  return page.locator('[data-testid="output-map-tab"] .leaflet-overlay-pane path.leaflet-interactive');
}

// ══════════════════════════════════════════════════════════════════════
// p-median-us — items 1, 2, 3, 4, 5
// ══════════════════════════════════════════════════════════════════════

test.describe("Workspace fixups 2 — p-median-us", () => {
  test("homepage card has no P-Median; no Added Entities tab; inline add + Save persists; no input filter; warehouse/customer hover both maps; >10-row output table shows stacked City,State", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page, "wfx2-pmedian");

    // ── Item 5 — homepage AL's Athletics card, checked on Landing before
    // navigating away. ────────────────────────────────────────────────────
    const alsCard = page.locator('[data-testid="link-/chapter-3"]');
    await expect(alsCard).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(alsCard).toContainText("AL's Athletics");
    await expect(alsCard).not.toContainText("P-Median");

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
      await expectNoAddedEntitiesTab(page);

      // ── Item 1 — inline "+ Add" on the base Warehouses tab; Save
      // persists it (real reload, not just the in-memory draft). ─────────
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("added-warehouses-section")).toBeVisible();

      // ── Item 3 (non-JADE half) — no FilterMenu anywhere on this tab,
      // even though it has 26 > 10 rows. ──────────────────────────────────
      await expect(page.locator('[data-testid="warehouses-tab"] [data-testid="button-filter-menu-trigger"]')).toHaveCount(0);

      await page.getByTestId("button-add-warehouse-row").click();
      await page.getByTestId("input-new-warehouse-city").fill("Testburg");
      await page.getByTestId("input-new-warehouse-state").fill("ZZ");
      await page.getByTestId("input-new-warehouse-lat").fill("40.5");
      await page.getByTestId("input-new-warehouse-lng").fill("-75.2");
      await page.getByTestId("button-add-warehouse-confirm").click();

      const addedRow = page.locator('[data-testid="added-warehouses-section"] [data-testid^="row-added-warehouse-"]');
      await expect(addedRow).toHaveCount(1, { timeout: HEADER_TIMEOUT });
      await expect(addedRow).toContainText("Testburg");
      await expect(addedRow).toContainText("ZZ");

      await expect(page.getByTestId("button-save")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("text-unsaved-changes")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });

      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.locator('[data-testid="added-warehouses-section"] [data-testid^="row-added-warehouse-"]')).toHaveCount(1, { timeout: HEADER_TIMEOUT });

      const persisted = await page.request.get(`/api/scenarios/${id}`);
      const persistedJson = await persisted.json();
      expect((persistedJson.inputs.addedWarehouses as unknown[]).length).toBe(1);

      // ── Item 4 (Input map) — a base warehouse + a base customer. ────────
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const whTooltipIn = await hoverUntilType(page, "input-map-tab", inputWarehouseMarkers(page), "Warehouse");
      assertTooltipShape(whTooltipIn, "Warehouse");
      const csTooltipIn = await hoverUntilType(page, "input-map-tab", inputCustomerMarkers(page), "Customer");
      assertTooltipShape(csTooltipIn, "Customer");

      // ── Solve, so the Output Map + Customer Assignments have real data. ─
      await solveAndWait(page);

      // ── Item 4 (Output map) — a warehouse + a customer. ──────────────────
      const whTooltipOut = await hoverUntilType(page, "output-map-tab", outputWarehouseTriangleMarkers(page), "Warehouse");
      assertTooltipShape(whTooltipOut, "Warehouse");
      const csTooltipOut = await hoverUntilType(page, "output-map-tab", outputCustomerMarkers(page), "Customer");
      assertTooltipShape(csTooltipOut, "Customer");

      // ── Item 2 — Customer Assignments (200 rows, well over 10) shows the
      // stacked City,State-above-mono-id cell, matching Open Warehouses'
      // reference pattern, for a NON-JADE model (the plan's own explicit
      // "at least one non-JADE consumer" DoD). ────────────────────────────
      await page.getByTestId("sidebar-output-customer-assignments").click();
      await expect(page.locator('[data-testid^="assignment-row-"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      const rowCount = await page.locator('[data-testid^="assignment-row-"]').count();
      expect(rowCount).toBeGreaterThan(10);

      const firstRow = page.locator('[data-testid^="assignment-row-"]').first();
      const customerCell = firstRow.locator("td").nth(0);
      const stack = customerCell.locator(".flex.flex-col");
      await expect(stack).toBeVisible();
      const spans = stack.locator("span");
      await expect(spans).toHaveCount(2);
      const cityStateText = (await spans.nth(0).innerText()).trim();
      const idText = (await spans.nth(1).innerText()).trim();
      expect(cityStateText).toMatch(/^[^,]+,\s*[A-Z]{2}$/);
      expect(await spans.nth(1).getAttribute("class")).toContain("font-mono");
      expect(idText.length).toBeGreaterThan(0);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// two-echelon-gold-au — item 4 (Refinery + the fixed Mine, both maps)
// ══════════════════════════════════════════════════════════════════════

test.describe("Workspace fixups 2 — two-echelon-gold-au", () => {
  test("no Added Entities tab; hover a refinery facility (Refinery) and the fixed mine (Mine, keeps (fixed) on the Input map) on both maps", async ({ page }) => {
    test.setTimeout(150_000);
    await registerAndGoHome(page, "wfx2-goldau");
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
      await expectNoAddedEntitiesTab(page);
      // Item 1 light touch — the shared inline add-section is present here
      // too (same component as p-median-us's Warehouses, reused for
      // Refineries; the full add/Save/persist round trip is already proven
      // above, this just confirms it wasn't accidentally dropped for the
      // reused entity).
      await page.getByTestId("sidebar-input-refineries").click();
      await expect(page.getByTestId("refineries-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-add-warehouse-row")).toBeVisible();

      // ── Item 4 (Input map) — a refinery facility ("Refinery") + the
      // fixed mine ("Mine", keeps "(fixed)"). ──────────────────────────────
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const refineryTooltipIn = await hoverUntilType(page, "input-map-tab", inputWarehouseMarkers(page), "Refinery");
      assertTooltipShape(refineryTooltipIn, "Refinery");

      const mineTooltipIn = await hoverUntilType(page, "input-map-tab", inputFixedMineMarker(page), "Mine");
      assertTooltipShape(mineTooltipIn, "Mine");
      expect(mineTooltipIn.trim().endsWith("(fixed)")).toBe(true);

      // ── Solve. ────────────────────────────────────────────────────────
      await solveAndWait(page);

      // ── Item 4 (Output map) — same two roles. ────────────────────────────
      const refineryTooltipOut = await hoverUntilType(page, "output-map-tab", outputWarehouseTriangleMarkers(page), "Refinery");
      assertTooltipShape(refineryTooltipOut, "Refinery");

      const mineTooltipOut = await hoverUntilType(page, "output-map-tab", outputMineStarMarkers(page), "Mine");
      assertTooltipShape(mineTooltipOut, "Mine");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// transport-coal — item 4 (supply "Mine" + demand "Station", both maps)
// ══════════════════════════════════════════════════════════════════════

test.describe("Workspace fixups 2 — transport-coal", () => {
  test("no Added Entities tab; hover a supply-side (Mine) and demand-side (Station) marker on both maps", async ({ page }) => {
    test.setTimeout(150_000);
    await registerAndGoHome(page, "wfx2-transport");
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
      await expectNoAddedEntitiesTab(page);
      // Item 1 light touch — Mines/Stations both carry the shared inline
      // add-section.
      await page.getByTestId("sidebar-input-mines").click();
      await expect(page.getByTestId("mines-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-add-mine-row")).toBeVisible();
      await page.getByTestId("sidebar-input-stations").click();
      await expect(page.getByTestId("stations-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-add-station-row")).toBeVisible();

      // ── Item 4 (Input map). ───────────────────────────────────────────
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const mineTooltipIn = await hoverUntilType(page, "input-map-tab", inputWarehouseMarkers(page), "Mine");
      assertTooltipShape(mineTooltipIn, "Mine");
      const stationTooltipIn = await hoverUntilType(page, "input-map-tab", inputCustomerMarkers(page), "Station");
      assertTooltipShape(stationTooltipIn, "Station");

      // ── Solve. ────────────────────────────────────────────────────────
      await solveAndWait(page);

      // ── Item 4 (Output map). ─────────────────────────────────────────
      const mineTooltipOut = await hoverUntilType(page, "output-map-tab", outputWarehouseTriangleMarkers(page), "Mine");
      assertTooltipShape(mineTooltipOut, "Mine");
      const stationTooltipOut = await hoverUntilType(page, "output-map-tab", outputCustomerMarkers(page), "Station");
      assertTooltipShape(stationTooltipOut, "Station");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// two-echelon-jade-us — items 1, 3, 4, 6, 7
// ══════════════════════════════════════════════════════════════════════

function jadeGroundTruthInputs() {
  // Mirrors workspace-fixups.spec.ts/jade-ch9-workspace-bundle.spec.ts's own
  // known-good ground truth: P=2, wh-11/wh-14 forced open — produces a real
  // feasible solved result serving every customer.
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

async function distinctFilterOptionLabels(page: Page, filterKey: string): Promise<string[]> {
  return page.locator(`[data-testid="select-filter-${filterKey}"] [data-testid^="option-filter-${filterKey}-"]`).allInnerTexts();
}

test.describe("Workspace fixups 2 — two-echelon-jade-us", () => {
  test("no Added Entities tab; Plants inline add + Save persists; Filter shares the toolbar row; plant hover both maps; Band filter range labels; free chip band editor", async ({ page }) => {
    test.setTimeout(240_000);
    await registerAndGoHome(page, "wfx2-jade");
    const id = await createScenario(page, "two-echelon-jade-us", jadeGroundTruthInputs(), "/chapter-9/jade");

    try {
      await expectNoAddedEntitiesTab(page);

      // ── Item 1 — Plants (JADE's own unique entity) inline add + Save
      // persists (real reload). ────────────────────────────────────────────
      await page.getByTestId("sidebar-input-plants").click();
      await expect(page.getByTestId("plants-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("added-plants-section")).toBeVisible();

      await page.getByTestId("button-add-plant-row").click();
      await page.getByTestId("input-new-plant-city").fill("Testburg");
      await page.getByTestId("input-new-plant-state").fill("ZZ");
      await page.getByTestId("input-new-plant-lat").fill("41.0");
      await page.getByTestId("input-new-plant-lng").fill("-80.0");
      await page.getByTestId("button-add-plant-confirm").click();

      const addedPlantRow = page.locator('[data-testid="added-plants-section"] [data-testid^="row-added-plant-"]');
      await expect(addedPlantRow).toHaveCount(1, { timeout: HEADER_TIMEOUT });
      await expect(addedPlantRow).toContainText("Testburg");

      await expect(page.getByTestId("button-save")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("text-unsaved-changes")).toHaveCount(0, { timeout: HEADER_TIMEOUT });

      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-plants").click();
      await expect(page.getByTestId("plants-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.locator('[data-testid="added-plants-section"] [data-testid^="row-added-plant-"]')).toHaveCount(1, { timeout: HEADER_TIMEOUT });

      const persisted = await page.request.get(`/api/scenarios/${id}`);
      const persistedJson = await persisted.json();
      expect((persistedJson.inputs.addedPlants as unknown[]).length).toBe(1);

      // ── Item 3 — Filter shares the toolbar row on a JADE input tab (25
      // warehouses > 10, enableFilters=true for JADE). ─────────────────────
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const toolbar = page.getByTestId("warehouses-tab-toolbar");
      await expect(toolbar).toBeVisible();
      const filterInToolbar = toolbar.getByTestId("button-filter-menu-trigger");
      await expect(filterInToolbar).toBeVisible({ timeout: HEADER_TIMEOUT });
      // Single row, not wrapped onto a second line — a real computed
      // bounding-box height check, not just DOM nesting.
      const toolbarBox = await toolbar.boundingBox();
      expect(toolbarBox).not.toBeNull();
      expect(toolbarBox!.height).toBeLessThan(40);

      // ── Item 4 (Input map) — a plant. ─────────────────────────────────
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const plantTooltipIn = await hoverUntilType(page, "input-map-tab", inputPlantMarkers(page), "Plant");
      assertTooltipShape(plantTooltipIn, "Plant");

      // ── Solve (ground-truth bands [200,400,800,1600]). ────────────────
      await solveAndWait(page);

      // ── Item 4 (Output map) — a plant. ────────────────────────────────
      const plantTooltipOut = await hoverUntilType(page, "output-map-tab", outputPlantMarkers(page), "Plant");
      assertTooltipShape(plantTooltipOut, "Plant");

      // ── Item 6 — Distance-Band filter range labels, on the still-live
      // (just-saved) ground-truth bands. Table CELLS stay "Band N"/
      // "Overflow"; only the FILTER options get the range format. Computed
      // deterministically from the known bands (no need to reproduce real
      // solved edge distances — every possible option is one of exactly
      // these 5 strings). ─────────────────────────────────────────────────
      await page.getByTestId("sidebar-output-customer-assignments").click();
      await expect(page.getByTestId("jade-assignments-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const filterTrigger = page.locator('[data-testid="jade-assignments-tab"]').getByTestId("button-filter-menu-trigger");
      await expect(filterTrigger).toBeVisible({ timeout: HEADER_TIMEOUT });
      await filterTrigger.click();
      await expect(page.getByTestId("filter-menu-popover")).toBeVisible();

      const bandOptions = await distinctFilterOptionLabels(page, "band");
      expect(bandOptions.length).toBeGreaterThan(0);
      const expectedPossible = new Set([
        "Band 1: 0 mi - 200 mi",
        "Band 2: 200 mi - 400 mi",
        "Band 3: 400 mi - 800 mi",
        "Band 4: 800 mi - 1600 mi",
        "Band 5: > 1600 mi",
      ]);
      for (const label of bandOptions) {
        expect(expectedPossible.has(label)).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("filter-menu-popover")).not.toBeVisible();

      // Table cells are unchanged — still bare "Band N"/"Overflow".
      const cellTexts = await page.locator('[data-testid^="cell-jadeassignment-band-"]').allInnerTexts();
      expect(cellTexts.length).toBeGreaterThan(0);
      for (const text of cellTexts) {
        expect(text.trim()).toMatch(/^(Band \d+|Overflow)$/);
      }

      // ── Item 7 — Run Optimizer shows the SAME free chip band editor as
      // Chapter 3 (not a fixed-4 JadeBandEditor): add a 5th band, Save +
      // solve with no error. ──────────────────────────────────────────────
      await page.getByTestId("button-run-optimizer").click();
      await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // The obsolete fixed-4-slot editor is gone entirely.
      await expect(page.locator('[data-testid^="jade-band-slot-"]')).toHaveCount(0);
      await expect(page.getByTestId("jade-band-error")).toHaveCount(0);

      // The shared chip editor renders the 4 existing bands.
      for (const b of [200, 400, 800, 1600]) {
        await expect(page.getByTestId(`solve-dialog-band-${b}`)).toBeVisible();
      }

      await page.getByTestId("solve-dialog-button-bands-plus").click();
      await page.getByTestId("solve-dialog-input-new-band").fill("2000");
      await page.getByTestId("solve-dialog-button-add-band-confirm").click();
      await expect(page.getByTestId("solve-dialog-band-2000")).toBeVisible();
      await expect(page.locator('[data-testid^="solve-dialog-band-"]')).toHaveCount(5);

      await expect(page.getByTestId("solve-dialog-error")).toHaveCount(0);
      await page.getByTestId("solve-dialog-solve").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });
      await expect(page.getByTestId("solve-dialog")).not.toBeVisible();
      await expect(page.getByTestId("solve-dialog-error")).toHaveCount(0);

      const persistedAfterFifthBand = await (await page.request.get(`/api/scenarios/${id}`)).json();
      expect(persistedAfterFifthBand.inputs.distanceBands).toContain(2000);
      expect((persistedAfterFifthBand.inputs.distanceBands as number[]).length).toBe(5);

      // ── Item 7 (continued) — remove bands down to one; the last "×" is
      // disabled so the count can never reach zero. ─────────────────────
      await page.getByTestId("button-run-optimizer").click();
      await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      for (const b of [2000, 1600, 800, 400]) {
        await page.getByTestId(`solve-dialog-button-remove-band-${b}`).click();
      }
      await expect(page.locator('[data-testid^="solve-dialog-band-"]')).toHaveCount(1);
      await expect(page.getByTestId("solve-dialog-band-200")).toBeVisible();
      await expect(page.getByTestId("solve-dialog-button-remove-band-200")).toBeDisabled();

      await page.getByTestId("solve-dialog-cancel").click();
      await expect(page.getByTestId("solve-dialog")).not.toBeVisible();
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
