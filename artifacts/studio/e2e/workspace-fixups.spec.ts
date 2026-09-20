/**
 * Browser E2E — Workspace fixups bundle (QA, Wave 4).
 *
 * Real-browser Playwright coverage for the five items in
 * `docs/superpowers/specs/2026-09-19-workspace-fixups-bundle-design.md` §7:
 *   1. Plant markers render as the factory icon (Input Map, Output Map, legend).
 *   2. A plant-bearing table shows plant id + City, State.
 *   3. Capability Matrix info line is single-line at desktop width; capacity
 *      readouts end in "Units".
 *   4. [Updated post workspace-fixups-2, item 1 — the "Added Entities" tab
 *      was REMOVED; adding an entity now happens inline inside each base
 *      entity tab again.] Placing an entity on the Input Map (in-place
 *      CreateEntityDialog) makes the row appear inline on the base tab's
 *      own "Added <entity>" section, Save persists it, and the CSV toolbar
 *      lives on that SAME base tab (there is no longer a separate tab to
 *      keep it off of).
 *   5. [Updated post workspace-fixups-2, item 6/7 — `bandRangeLabel` now
 *      reads "Band N: X mi - Y mi"/"Band N: > X mi" (was "≤ X mi"/"X–Y mi");
 *      JADE's fixed-4-slot `JadeBandEditor` was DELETED — JADE now uses the
 *      SAME free add/remove chip editor as every other model.] Distance-Band
 *      filters show live, unit-aware ranges (not the bare "Band N" cell
 *      label); editing bands via the Run Optimizer (SolveDialog) modal —
 *      which hosts the chip editor over the active tab WITHOUT unmounting
 *      it — re-ranges the filter options live (zero /solve calls), clears
 *      the stale band selection, and leaves an unrelated non-band filter
 *      untouched.
 *
 * Target: E2E_BASE_URL env var + a local dev proxy (vite's
 * API_PROXY_TARGET) — see CLAUDE.md's "Local dev DB"/"To run e2e locally"
 * recipe. Each test registers its own disposable account and deletes its
 * own scenario in a `finally` block.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

// Same rationale as jade-ch9-workspace-bundle.spec.ts: a plain `.click()`
// with no explicit action timeout defaults to the whole TEST timeout, so an
// action that can never become actionable burns the entire budget before a
// diagnosable error appears. A taller-than-default viewport keeps every
// FilterMenu/Popover fully on-screen (a low-on-page trigger can otherwise
// clip a Radix Popover's checkbox list out of the 720px-tall default).
test.use({ actionTimeout: 15_000 });
test.use({ viewport: { width: 1400, height: 1400 } });

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;

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

/** Tracks every request whose URL is a solve-trigger or solve-job-poll
 * endpoint — used to prove a band edit through the Run Optimizer dialog
 * fires ZERO solve network calls (item 5's "live re-range without solve"). */
function makeSolveCallTracker(page: Page) {
  const urls: string[] = [];
  page.on("request", req => {
    const url = req.url();
    if (/\/scenarios\/\d+\/solve(-jobs)?(\/|$|\?)/.test(url)) urls.push(url);
  });
  return { count: () => urls.length, urls };
}

// ── JADE (two-echelon-jade-us) helpers ──────────────────────────────────

/** Ground-truth JADE inputs (mirrors jade-two-echelon.spec.ts /
 * jade-ch9-workspace-bundle.spec.ts): P=2, wh-11/wh-14 forced open, bands
 * [200,400,800,1600]. Known-good — produces a real feasible solved result
 * serving every customer, which is all this task's checks need. */
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

async function createJadeScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E Workspace-Fixups JADE ${Date.now()}`,
      modelId: "two-echelon-jade-us",
      inputs: jadeGroundTruthInputs(),
    },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-9/jade?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

async function solveAndWait(page: Page): Promise<void> {
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });
  await expect(page.getByTestId("sidebar-output-customer-assignments")).toBeEnabled({ timeout: HEADER_TIMEOUT });
}

/** Locates the factory-marker `<polygon>` produced by `plantSquareSvg()`
 * (`fill="var(--map-plant)"`) within a given map surface (Input or Output
 * map). Scoped so it can never accidentally match a warehouse/customer
 * marker (those use different shapes/tokens entirely). */
function plantFactoryMarkers(page: Page, scopeTestId: string): Locator {
  return page.locator(`[data-testid="${scopeTestId}"] .leaflet-marker-pane svg polygon[fill="var(--map-plant)"]`);
}

/** Same factory-polygon check, scoped to a legend swatch instead of the map
 * marker pane — the legend renders the identical `plantSquareSvg()` string
 * via `dangerouslySetInnerHTML`. */
function plantFactoryLegendSwatch(page: Page, legendTestId: string): Locator {
  return page.locator(`[data-testid="${legendTestId}"] svg polygon[fill="var(--map-plant)"]`);
}

// Mirrors `lib/bands.ts`'s `bandRangeLabel` exactly (sort-first, same
// `<=`-boundary/overflow semantics, workspace-fixups-2 item 6's
// "Band N: X unit - Y unit" / "Band N: > X unit" format — was "≤ X mi"/
// "X–Y mi" before that bundle) — reimplemented locally rather than imported
// because Playwright's e2e runner does not share the app's Vite path-alias/
// module resolution. Same "recompute expected values from the real solved
// response, don't just assume the label" pattern jade-ch9-workspace-bundle.
// spec.ts already uses for its overflow-count math.
function bandRangeLabelLocal(distance: number, bands: number[], unit: string): string {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return "All distances";
  const idx = sorted.findIndex(b => distance <= b);
  if (idx === -1) return `Band ${sorted.length + 1}: > ${sorted[sorted.length - 1]} ${unit}`;
  if (idx === 0) return `Band 1: 0 ${unit} - ${sorted[0]} ${unit}`;
  return `Band ${idx + 1}: ${sorted[idx - 1]} ${unit} - ${sorted[idx]} ${unit}`;
}

/** Parses a `bandRangeLabel` string back into inclusive numeric bounds, for
 * verifying "filtering by a range selects the right rows" against the
 * table's own displayed Distance cells. A little slack either side absorbs
 * the table's own 1-decimal display rounding vs the raw classification
 * distance — this is a smoke-level cross-check, not a re-proof of the
 * boundary math itself (that's `bands.test.ts`'s job). */
function parseBandRangeBounds(label: string): { min: number; max: number } {
  const overflow = label.match(/^Band \d+: > ([\d.]+) /);
  if (overflow) return { min: Number(overflow[1]), max: Infinity };
  const range = label.match(/^Band \d+: ([\d.]+) \S+ - ([\d.]+) /);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  throw new Error(`Unrecognized band range label: ${label}`);
}

/** Clicks the first `select`-type FilterMenu option under a given
 * descriptor key and returns its label text + derived checkbox testid, so
 * the caller can later re-assert its checked state. */
async function selectFirstFilterOption(
  page: Page,
  filterKey: string,
): Promise<{ checkboxTestId: string; label: string }> {
  const optionLocator = page
    .locator(`[data-testid="select-filter-${filterKey}"] [data-testid^="option-filter-${filterKey}-"]`)
    .first();
  const testId = (await optionLocator.getAttribute("data-testid"))!;
  const label = (await optionLocator.innerText()).trim();
  const checkboxTestId = testId.replace("option-filter-", "checkbox-filter-");
  await page.getByTestId(checkboxTestId).click();
  return { checkboxTestId, label };
}

async function distinctFilterOptionLabels(page: Page, filterKey: string): Promise<string[]> {
  return page.locator(`[data-testid="select-filter-${filterKey}"] [data-testid^="option-filter-${filterKey}-"]`).allInnerTexts();
}

// ── p-median-us helpers (item 4's full add-on-map / Added Entities flow) ─

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

async function createPMedianScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E Workspace-Fixups PMedian ${Date.now()}`, modelId: "p-median-us", inputs: pMedianInputs() },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-3?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("sidebar-input-input-map").click();
  await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

function mapCanvas(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-container');
}

/** Same "far corner, clear of the dense marker field" empty-space offset
 * `input-map-v2.spec.ts` already established for this exact dataset. */
function emptyMapOffset(box: { width: number; height: number }): { x: number; y: number } {
  return { x: box.width * 0.94, y: box.height * 0.06 };
}

// ══════════════════════════════════════════════════════════════════════
// Items 1, 2, 3, 5 — JADE (two-echelon-jade-us)
// ══════════════════════════════════════════════════════════════════════

test.describe("Workspace fixups — JADE (plant icon, plant labels, Capability Matrix, live band filters)", () => {
  test("plant factory markers on Input/Output map + legend; Capability Matrix id+City,State/single-line/Units; band-range filter re-ranges live via Run Optimizer without unmounting the report", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page, "wfx-jade");
    const id = await createJadeScenario(page);
    const solveCalls = makeSolveCallTracker(page);

    try {
      // ── Item 4 sanity [updated post workspace-fixups-2, item 1 — the
      // "Added Entities" tab is gone; the inline "+ Add" affordance now
      // lives on each base entity tab again] (part of the ">=2 models" QA
      // requirement — the full add/persist flow is proven on p-median-us
      // below; here we only confirm the entry points exist for JADE
      // specifically, since it has a plant echelon no other model has). ──
      await expect(page.getByTestId("sidebar-input-added-entities")).toHaveCount(0);
      await page.getByTestId("sidebar-input-plants").click();
      await expect(page.getByTestId("plants-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-add-plant-row")).toBeVisible();
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-add-warehouse-row")).toBeVisible();
      await page.getByTestId("sidebar-input-customers").click();
      await expect(page.getByTestId("customers-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-add-customer-row")).toBeVisible();

      // ── Item 1 — Input Map: factory markers + legend swatch ────────────
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const inputPlantMarkers = plantFactoryMarkers(page, "input-map-tab");
      await expect(inputPlantMarkers.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await inputPlantMarkers.count()).toBeGreaterThan(0);
      await expect(page.getByTestId("legend-plant")).toBeVisible();
      await expect(plantFactoryLegendSwatch(page, "legend-plant")).toHaveCount(1);

      // ── Item 3 — Capability Matrix: id+City,State, single-line info,
      // "Units" suffix (checked before solving — an input-surface tab). ──
      await page.getByTestId("sidebar-input-capability-matrix").click();
      await expect(page.getByTestId("capability-matrix-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // Item 2 — plant id + City, State (plant-1 is Ashland, KY in the JADE
      // dataset). [Updated post workspace-fixups-2, item 2 (T11): the row
      // header now renders via the shared stacked `EntityIdCell` — City,
      // State on top, mono display-id below — REPLACING the old single-line
      // "plant-1 — Ashland, KY" dash format; check the two stacked spans
      // directly rather than the cell's flattened text (which concatenates
      // them with no separator).]
      const plantCell = page.getByTestId("text-capability-plant-plant-1");
      const plantCellSpans = plantCell.locator("span");
      await expect(plantCellSpans).toHaveCount(2);
      await expect(plantCellSpans.nth(0)).toHaveText(/^.+, [A-Z]{2}$/);
      await expect(plantCellSpans.nth(1)).toHaveText("plant-1");
      // Item 3a — single-line at desktop width: real computed CSS, not just
      // the presence of a class name, and confirmed with no `max-w-md`
      // constraint clipping it.
      const infoLine = page.getByTestId("text-capability-capacity-label");
      await expect(infoLine).toBeVisible();
      const whiteSpace = await infoLine.evaluate(el => getComputedStyle(el).whiteSpace);
      expect(whiteSpace).toBe("nowrap");
      const infoBox = await infoLine.boundingBox();
      expect(infoBox).not.toBeNull();
      expect(infoBox!.height).toBeLessThan(24); // one text line, not wrapped to 2+
      // Item 3b — capacity readouts end in "Units" (both an enabled and a
      // disabled cell).
      await expect(page.getByTestId("text-capability-capacity-plant-1-product-1")).toHaveText("210,000,000 Units");
      await expect(page.getByTestId("text-capability-capacity-plant-1-product-2")).toHaveText("0 Units");

      // ── Solve, so the Output Map and Customer Assignments have real data
      // to check items 1/5 against. ───────────────────────────────────────
      await solveAndWait(page);

      // ── Item 1 — Output Map: factory markers + legend swatch ───────────
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("checkbox-toggle-plants")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const outputPlantMarkers = plantFactoryMarkers(page, "output-map-tab");
      await expect(outputPlantMarkers.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await outputPlantMarkers.count()).toBeGreaterThan(0);
      await expect(page.getByTestId("legend-output-plant")).toBeVisible();
      await expect(plantFactoryLegendSwatch(page, "legend-output-plant")).toHaveCount(1);

      // ── Item 5 — Distance-Band filter on Customer Assignments ──────────
      await page.getByTestId("sidebar-output-customer-assignments").click();
      await expect(page.getByTestId("jade-assignments-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const filterTrigger = page.locator('[data-testid="jade-assignments-tab"]').getByTestId("button-filter-menu-trigger");
      await expect(filterTrigger).toBeVisible({ timeout: HEADER_TIMEOUT }); // >10 rows for this dataset (4 products x ~100 customers)
      await filterTrigger.click();
      await expect(page.getByTestId("filter-menu-popover")).toBeVisible();

      // Ranges, not bare "Band N" — the table CELL still reads "Band N"
      // (item 5's explicit "cells unchanged" scope), only the FILTER
      // options change. [Updated post workspace-fixups-2, item 6: the
      // range format now READS "Band N: X mi - Y mi" / "Band N: > X mi"
      // (was "≤ X mi" / "X–Y mi" / "> X mi") — every option intentionally
      // DOES start "Band \d+:" now, the opposite of the old assertion.]
      const originalBandOptions = await distinctFilterOptionLabels(page, "band");
      expect(originalBandOptions.length).toBeGreaterThan(0);
      for (const label of originalBandOptions) {
        expect(label).toMatch(/^Band \d+: (\d+(\.\d+)? \S+ - \d+(\.\d+)? \S+|> \d+(\.\d+)? \S+)$/);
      }

      // Select a non-band filter (Product) first, capture its solo count —
      // this is the "unrelated filter" whose survival across a band edit
      // item 5 requires.
      const { checkboxTestId: productCheckboxTestId, label: productLabel } = await selectFirstFilterOption(page, "product");
      const productOnlyCountText = (await page.getByTestId("text-filter-count").textContent())!.trim();
      const productOnlyCount = Number(productOnlyCountText.split(" of ")[0]);
      expect(productOnlyCount).toBeGreaterThan(0);

      // Now select a band range too (combined filter).
      const { label: bandLabelBefore } = await selectFirstFilterOption(page, "band");
      const combinedCountText = (await page.getByTestId("text-filter-count").textContent())!.trim();
      const combinedCount = Number(combinedCountText.split(" of ")[0]);
      expect(combinedCount).toBeLessThanOrEqual(productOnlyCount);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("filter-menu-popover")).not.toBeVisible();

      const solveCallsBeforeEdit = solveCalls.count();

      // Edit bands via the Run Optimizer (SolveDialog) modal — hosts the
      // SAME shared free add/remove chip band editor every other model uses
      // (workspace-fixups-2, item 7 deleted the old fixed-4-slot
      // `JadeBandEditor`) over the active tab WITHOUT unmounting it. Do NOT
      // navigate to the Optimization Parameters tab for this (that DOES
      // unmount the report and would produce a false "cleared").
      await page.getByTestId("button-run-optimizer").click();
      await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // Mount-preserving: the report tab underneath is still in the DOM
      // while the dialog is open (a real navigation/unmount would have torn
      // it — and its filter state — down).
      await expect(page.getByTestId("jade-assignments-tab")).toBeVisible();
      // The obsolete fixed-4-slot editor is gone entirely.
      await expect(page.locator('[data-testid^="jade-band-slot-"]')).toHaveCount(0);

      // Replace the ground-truth bands [200,400,800,1600] with
      // [150,450,900,1800] via the chip editor: add all 4 new bands first
      // (the "remove the last band" guard only blocks emptying to zero, so
      // adding-before-removing keeps every intermediate count > 1), then
      // remove the 4 old ones.
      const newBands = [150, 450, 900, 1800];
      for (const b of newBands) {
        await page.getByTestId("solve-dialog-button-bands-plus").click();
        await page.getByTestId("solve-dialog-input-new-band").fill(String(b));
        await page.getByTestId("solve-dialog-button-add-band-confirm").click();
        await expect(page.getByTestId(`solve-dialog-band-${b}`)).toBeVisible();
      }
      for (const b of [200, 400, 800, 1600]) {
        await page.getByTestId(`solve-dialog-button-remove-band-${b}`).click();
      }
      await expect(page.locator('[data-testid^="solve-dialog-band-"]')).toHaveCount(4);
      await expect(page.getByTestId("solve-dialog-error")).toHaveCount(0);

      // Close WITHOUT clicking Solve — proves the band edit itself never
      // fires a solve call, and the dialog can be dismissed mid-edit.
      await page.getByTestId("solve-dialog-cancel").click();
      await expect(page.getByTestId("solve-dialog")).not.toBeVisible();
      expect(solveCalls.count()).toBe(solveCallsBeforeEdit);

      // Re-open the filter menu: options re-ranged live, band filter
      // cleared, product filter survived.
      await filterTrigger.click();
      await expect(page.getByTestId("filter-menu-popover")).toBeVisible();

      const newBandOptions = await distinctFilterOptionLabels(page, "band");
      expect(newBandOptions.length).toBeGreaterThan(0);
      // Re-ranged: the new option set is not the same set as before (proves
      // the memo-deps fix — a frozen-at-first-render descriptor would show
      // the exact same list).
      expect([...newBandOptions].sort()).not.toEqual([...originalBandOptions].sort());
      for (const label of newBandOptions) {
        expect(label).toMatch(/^Band \d+: (\d+(\.\d+)? \S+ - \d+(\.\d+)? \S+|> \d+(\.\d+)? \S+)$/);
      }
      // The specific stale selection is gone from the new option set.
      expect(newBandOptions).not.toContain(bandLabelBefore);

      // Band filter cleared: no active-filter "Clear" affordance for that
      // column, and the count reverts to the product-only baseline (proves
      // the band restriction is gone, not just relabeled).
      await expect(page.getByTestId("button-clear-filter-band")).toHaveCount(0);
      const afterClearCountText = (await page.getByTestId("text-filter-count").textContent())!.trim();
      expect(Number(afterClearCountText.split(" of ")[0])).toBe(productOnlyCount);

      // Non-band filter survived untouched.
      await expect(page.getByTestId(productCheckboxTestId)).toBeChecked();
      await expect(page.getByTestId("button-clear-filter-product")).toBeVisible();

      // Clear the product filter so the next check (band-range correctness)
      // isn't accidentally starved to zero rows by an unrelated filter.
      await page.getByTestId(productCheckboxTestId).click();
      await expect(page.getByTestId(productCheckboxTestId)).not.toBeChecked();

      // Filtering by a range selects the right rows: pick the first
      // available (new) range, verify every page-1 row's own Distance cell
      // actually falls inside that range's numeric bounds.
      const { label: chosenRangeLabel } = await selectFirstFilterOption(page, "band");
      const chosenCountText = (await page.getByTestId("text-filter-count").textContent())!.trim();
      const chosenCount = Number(chosenCountText.split(" of ")[0]);
      expect(chosenCount).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("filter-menu-popover")).not.toBeVisible();

      const { min, max } = parseBandRangeBounds(chosenRangeLabel);
      const distanceCells = page.locator('[data-testid="jade-assignments-tab"] [data-testid^="cell-jadeassignment-distance-"]');
      const visibleCount = await distanceCells.count();
      expect(visibleCount).toBeGreaterThan(0);
      const slack = 0.5;
      for (let i = 0; i < visibleCount; i++) {
        const text = (await distanceCells.nth(i).innerText()).trim();
        const value = Number(text.split(" ")[0]);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(min - slack);
        expect(value).toBeLessThanOrEqual(max === Infinity ? value : max + slack);
      }
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Item 4 — p-median-us: full add-on-map -> inline Save flow
// [Updated post workspace-fixups-2, item 1 — the "Added Entities" tab
// (and its per-model sub-tabs) was REMOVED; the added row now appears
// inline on the base Warehouses tab's own "Added warehouses" section, the
// SAME tab that already owns the CSV toolbar (one tab per entity again).]
// ══════════════════════════════════════════════════════════════════════

test.describe("Workspace fixups — p-median-us (inline add-on-map -> Save flow)", () => {
  test("placing a warehouse on the Input Map surfaces it inline on the base Warehouses tab; Save persists it; the add-section and CSV toolbar share that one tab", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page, "wfx-pmedian");
    const id = await createPMedianScenario(page);

    try {
      // Place a warehouse on the map (right-click empty space -> "Add
      // warehouse here" -> Create), the established Input Map v2 flow.
      const canvas = mapCanvas(page);
      const box = (await canvas.boundingBox())!;
      await canvas.click({ position: emptyMapOffset(box), button: "right" });
      await expect(page.getByTestId("map-add-menu")).toBeVisible();
      await page.getByTestId("map-add-menu-wh").click();
      await expect(page.getByTestId("create-entity-dialog")).toBeVisible();
      const displayCode = (await page.getByTestId("create-entity-display-code").textContent())!.trim();
      await page.getByTestId("create-entity-submit").click();
      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible();

      // ── Item 4 [updated] — the new row appears INLINE on the base
      // Warehouses tab's own "Added warehouses" section (unsaved
      // localInputs draft) — there is no more separate Added Entities
      // tab/sidebar entry to navigate through. ───────────────────────────
      await expect(page.getByTestId("sidebar-input-added-entities")).toHaveCount(0);
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const addedSection = page.getByTestId("added-warehouses-section");
      await expect(addedSection).toBeVisible();
      const addedRow = addedSection.locator('[data-testid^="row-added-warehouse-"]');
      await expect(addedRow).toHaveCount(1, { timeout: HEADER_TIMEOUT });
      await expect(addedRow).toContainText(displayCode);

      // The inline add-section now shares the SAME tab as the base table
      // AND its CSV toolbar (workspace-fixups-2 item 1's "one tab per
      // entity again" DoD — was mutually exclusive with the old Added
      // Entities tab, which had none of these).
      await expect(page.getByTestId("warehouses-tab-toolbar")).toBeVisible();
      await expect(page.getByTestId("button-export-warehouses-csv")).toBeVisible();
      await expect(page.getByTestId("button-import-warehouses")).toBeVisible();
      await expect(page.getByTestId("button-add-warehouse-row")).toBeVisible();

      // ── Save persists it. ───────────────────────────────────────────────
      // `button-save`'s `disabled` also covers the mutation's `isPending`
      // window (true the instant it's clicked, before any response arrives)
      // — so waiting on `disabled` alone can't distinguish "still saving"
      // from "successfully saved". `text-unsaved-changes` renders purely off
      // `isDirty`, which only flips false in the mutation's `onSuccess`
      // (after the real response lands) — a more precise "save actually
      // completed" signal.
      await expect(page.getByTestId("button-save")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("text-unsaved-changes")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });

      // Reload for real FIRST — the row surviving a fresh mount (the app's
      // own TanStack Query fetch, not a raw one-shot request racing the
      // mutation's own onSuccess/commit ordering) is the strongest proof
      // it's genuinely server-persisted, not just an in-memory draft
      // artifact.
      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-warehouses").click();
      await expect(page.getByTestId("warehouses-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const reloadedSection = page.getByTestId("added-warehouses-section");
      await expect(reloadedSection.locator('[data-testid^="row-added-warehouse-"]')).toHaveCount(1, { timeout: HEADER_TIMEOUT });
      await expect(reloadedSection).toContainText(displayCode);

      // Redundant structural confirmation via the raw API, now safely after
      // a full reload (so there is no risk of racing the mutation's own
      // commit-visibility timing).
      const persisted = await page.request.get(`/api/scenarios/${id}`);
      const persistedJson = await persisted.json();
      const addedWarehouses = persistedJson.inputs.addedWarehouses as Array<{ id: string; displayCode?: string }>;
      expect(addedWarehouses).toHaveLength(1);
      expect(addedWarehouses[0].displayCode).toBe(displayCode);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
