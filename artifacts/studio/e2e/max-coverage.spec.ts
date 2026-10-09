/**
 * Browser E2E — Chapter 4 Al's Athletics Max Coverage (US service-level
 * facility location), Task C4.16 (originally written for the retired
 * China-dataset model; rewritten onto `max-coverage-us` per the
 * ch4-migration cutover — MIG-8).
 *
 * CH4O-12 (ch4-model-upgrade, Task 12) — rewritten again for the SCN v0.3
 * single-form, miles-canonical Chapter 4: the two-step workflow (step
 * toggle, "Solve Step N" label, freeze-confirm dialog) is gone entirely
 * (CH4O-2/CH4O-7). `coverageFloorDemand` is a plain, always-editable
 * student-authored input and the server (and the UI, via the same
 * `deriveMaxCoverageObjective` rule) derives `objective` from it — floor 0
 * is "coverage", floor > 0 is "min_distance" (CH4O-5, §2.3). There is no
 * freeze/clear-on-edit mechanism left anywhere in this model: every edit is
 * an ordinary dirty draft, saved (if dirty) the instant Run Optimizer is
 * clicked, exactly like every other model.
 *
 * CH4O-8: this model is now MILES-canonical, with round teaching defaults
 * (p 3, highServiceDistMi 450, maxDistMi 3400, avgServiceDistCapMi 650) —
 * NOT conversions of the old km seeds. Every golden below is read off a
 * real `solve.py` invocation against those exact defaults
 * (`solver/tests/test_max_coverage.py::BASE`), never hand-converted.
 *
 * IMPORTANT — `objective` is now a SERVER-OWNED field (CH4O-5): a
 * scenario-create/update payload that includes an `objective` key at all
 * (even `null`) is rejected by `assertNoServerOwnedFields`
 * (`services/scenarioInputWrite.ts`). The old pre-migration fixture used to
 * send `objective: "coverage"` on create — that would now 4xx. This file's
 * `coverageInputs()` deliberately omits the field.
 *
 * Exercises the full max-coverage model through the Workspace UI against
 * local dev servers:
 *   1. register a fresh account → create a max-coverage scenario (Chapter 4)
 *   2. COVERAGE solve (floor 0) → assert coveragePct/coveredDemand/open set
 *      golden, and the derived-model line
 *   3. assert `mi` present / `km` absent on the model's distance surfaces,
 *      and that a Chen distance field (avg service distance cap) commits
 *      via blur and round-trips through the real backend
 *   4. edit the coverage floor to the achieved covered demand → MIN_DISTANCE
 *      mode is derived automatically → solve → objective/open-set golden,
 *      derived-model line flips to "Model 2"
 *   5. edit a customer demand (still min-distance mode) → re-solve →
 *      objective delta (server-verified)
 *   6. add a distance override (open-warehouse → customer @ 1 mi) →
 *      re-solve → that customer's assignment flips to the overridden
 *      warehouse
 *   7. Input-Map add a warehouse → save → its estimated mi distances
 *      surface in the Distances tab
 *   8. TWO distinct import flows, asserted separately:
 *      (a) the v1 `distances` CSV exports and re-imports UNCHANGED (round-trip
 *          identity — "No changes detected")
 *      (b) a `customers` CSV is exported, one demand edited, re-imported →
 *          exactly one change applies
 *
 * The max-coverage-us goldens are the sacred solver ground truth
 * (solver/tests/test_max_coverage.py): coverage `coveragePct == 70.42`,
 * `coveredDemand == 54946145`, open `{DAL, LA, PIT}`, `weightedAvgDistance
 * == 394.65`, longest served edge `1197`; min-distance (floor ==
 * 54946145) `objective == 30269639699.0`, `weightedAvgDistance == 387.94`,
 * same open set. §2.1: this dataset's stored distances ARE the effective
 * distances — the solver applies no circuity factor, so a
 * distanceOverride's raw value survives unmodified into the reported edge
 * distance.
 *
 * Objectives for the delta+override steps are read straight off the
 * persisted result envelope via `page.request` (full precision), because
 * the min-distance objective renders in the UI through `formatObjective`'s
 * locale-grouped integer — correct, but a step-by-step delta is still
 * clearer to verify against the raw number.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md's
 * "To run e2e locally" recipe and vite.config.ts.
 */
import { test, expect, type Page } from "./fixtures";
import { readSolvedAt } from "./helpers/solvedAt";

const HEADER_TIMEOUT = 10_000;
// ch4-2s-9 — widened from 120_000: a real CBC solve of this 26-warehouse/
// 200-customer model was observed taking ~170s on a (contended) local run.
const SOLVE_TIMEOUT = 240_000;

interface MaxCoverageResult {
  status: string;
  objective: number;
  edges: Array<{ fromId: string; toId: string; distance: number; flow: number }>;
  details: { objective?: string; coveragePct?: number; coveredDemand?: number; openWarehouseIds?: string[] };
  metrics: { weightedAvgDistance?: number; openFacilityIds?: string[] };
}

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-maxcov-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Default (floor-0 / coverage-mode) inputs = the coverage golden config
 * (p=3, high=450mi, max=3400mi, avgServiceDistCap=650mi) — CH4O-8's round
 * teaching defaults, read verbatim off `test_max_coverage.py::BASE`. NO
 * `objective` key: it is server-derived and a 4xx if sent at all
 * (CH4O-5, `assertNoServerOwnedFields`). */
function coverageInputs() {
  return {
    p: 3,
    highServiceDistMi: 450,
    maxDistMi: 3400,
    avgServiceDistCapMi: 650,
    coverageFloorDemand: 0,
    gap: 0,
    timeLimitSec: 120,
    capacityMode: "none",
    distanceBands: [450, 900, 1800, 3400],
    warehouseOverrides: [],
    customerOverrides: [],
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
  };
}

async function createMaxCoverageScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E MaxCoverage ${Date.now()}`, modelId: "max-coverage-us", inputs: coverageInputs() },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-4?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

async function getScenario(page: Page, id: string): Promise<{ solvedAt: string | null; result: MaxCoverageResult | null }> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  return { solvedAt: body.solvedAt ?? null, result: body.result ?? null };
}

/** Trigger a solve via the Run Optimizer dialog (auto-saves any dirty edit —
 * `Workspace.tsx`'s `handleSolve`), then wait on the shared `readSolvedAt`
 * completion signal (captured BEFORE the click, polled until it differs —
 * never "polls for non-null", since an already-solved scenario starts
 * non-null) before reading back the fresh result envelope. */
async function solveViaUi(page: Page, id: string): Promise<MaxCoverageResult> {
  const before = await readSolvedAt(page, id);
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  // Output Map auto-opens on success (Workspace.tsx jobStatus effect) — a
  // cheap UI signal the job finished before we hit the server.
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });

  await expect
    .poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
    .not.toBe(before);
  // CH4UX-7 — `solve-progress-overlay` unmounts on success and PERSISTS as
  // an error card on failure, so a solve that ends in a failed job can no
  // longer slip past as "some result landed".
  await expect(page.getByTestId("solve-progress-overlay")).toHaveCount(0, { timeout: HEADER_TIMEOUT });

  const after = await getScenario(page, id);
  expect(after.result).not.toBeNull();
  expect(after.result!.status).toBe("optimal");
  return after.result!;
}

async function saveViaHeader(page: Page): Promise<void> {
  const save = page.getByTestId("button-save").first();
  await expect(save).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await save.click();
  await expect(save).toBeDisabled({ timeout: HEADER_TIMEOUT });
}

/** Locates the row whose FIRST cell (the entity-id column) is exactly
 * `id` — never a bare text search, because this dataset's 2-letter
 * warehouse ids (e.g. "LA") collide with other warehouses' State-column
 * abbreviations (MSY's state is also "LA"), which would make a plain
 * `getByText(id, {exact:true})` match two rows and fail Playwright's
 * strict-mode single-element requirement. */
function rowByFirstCellId(page: Page, id: string) {
  return page.locator("table tbody tr").filter({
    has: page.locator("td:first-child", { hasText: new RegExp(`^${id}$`) }),
  });
}

test.describe("Chapter 4 — Al's Athletics Max Coverage", () => {
  test("coverage + min-distance solves, demand delta, distance override, map add, import round-trips", async ({ page }) => {
    // ch4-2s-9 — this test performs 4 real solves (coverage, min-distance,
    // demand-delta re-solve, distance-override re-solve); widened to give
    // headroom at the ~240_000 per-solve SOLVE_TIMEOUT observed locally.
    test.setTimeout(900_000);
    await registerAndGoHome(page);
    const id = await createMaxCoverageScenario(page);

    try {
      // ── 0. Header shows Chapter 4 / US service coverage copy, not another
      // model's title (gold-refinery) or the retired China copy. The
      // two-step workflow is gone entirely — no step toggle, no step
      // counter, no free objective toggle (CH4O-2/CH4O-7). ─────────────────
      const summary = page.getByTestId("workspace-chapter-summary");
      await expect(summary).toContainText("Chapter 4");
      await expect(summary).toContainText(/United States/i);
      await expect(summary).not.toContainText(/china/i);
      await expect(summary).not.toContainText(/gold refinery/i);
      await expect(page.getByTestId("step-toggle-2")).toHaveCount(0);
      await expect(page.getByTestId("text-steps-solved-counter")).toHaveCount(0);
      await expect(page.getByTestId("chen-objective-toggle")).toHaveCount(0);
      await expect(page.getByTestId("freeze-confirm-dialog")).toHaveCount(0);

      // ── 1. Coverage solve (floor 0) → golden coverage % + three opened
      // warehouses ─────────────────────────────────────────────────────────
      const cov = await solveViaUi(page, id);
      expect(cov.details.objective).toBe("coverage");
      expect(cov.details.coveragePct).toBeCloseTo(70.42, 2);
      expect(cov.details.coveredDemand).toBe(54946145);
      expect(new Set(cov.details.openWarehouseIds)).toEqual(new Set(["DAL", "LA", "PIT"]));
      expect(cov.metrics.weightedAvgDistance).toBeCloseTo(394.65, 1);
      expect(Math.max(...cov.edges.map(e => e.distance))).toBe(1197);

      // Cost-summary UI shows the coverage % objective (formatObjective).
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("70.42 %", { timeout: HEADER_TIMEOUT });

      // Open Warehouses grid: exactly the three golden facilities.
      await page.getByTestId("sidebar-output-open-warehouses").click();
      await expect(page.getByTestId("open-warehouse-row-DAL")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("open-warehouse-row-LA")).toBeVisible();
      await expect(page.getByTestId("open-warehouse-row-PIT")).toBeVisible();
      expect(await page.locator('[data-testid^="open-warehouse-row-"]').count()).toBe(3);

      // The three opened facilities ARE Dallas / Los Angeles / Pittsburgh —
      // proven on the Warehouses input grid, which pairs each id with its
      // city cell.
      await page.getByTestId("sidebar-input-warehouses").click();
      for (const [whId, city] of [["DAL", "Dallas"], ["LA", "Los Angeles"], ["PIT", "Pittsburgh"]] as const) {
        const row = rowByFirstCellId(page, whId);
        await expect(row).toContainText(city, { timeout: HEADER_TIMEOUT });
      }

      // ── 2. Distance surfaces carry `mi`, never `km` (CH4O-8 flipped the
      // canonical unit from km to mi) ──────────────────────────────────────
      await page.getByTestId("sidebar-output-cost-summary").click();
      // CH4O-10 moved Chen's coverage KPIs onto Solution Summary — this is
      // the "Avg distance to customers" row (showCoverageRows branch),
      // never the generic "Weighted avg. distance" label that a
      // non-coverage model would get.
      const avgDist = page.getByTestId("cost-summary-value-avg-distance-to-customers");
      await expect(avgDist).toContainText("mi", { timeout: HEADER_TIMEOUT });
      await expect(avgDist).not.toContainText(/\bkm\b/);
      await expect(page.getByTestId("cost-summary-high-service-cutoff")).toContainText("450");
      await expect(page.getByTestId("cost-summary-high-service-cutoff")).toContainText("mi");
      await expect(page.getByTestId("cost-summary-coverage-pct")).toContainText("70.42");

      await page.getByTestId("sidebar-input-optimization-parameters").click();
      const chenParams = page.getByTestId("chen-objective-section");
      await expect(chenParams).toContainText("High-service distance (mi)", { timeout: HEADER_TIMEOUT });
      await expect(chenParams).toContainText("Max distance (mi)");
      await expect(chenParams).toContainText("Avg service distance cap (mi)");
      await expect(chenParams).not.toContainText(/\(km\)/);

      // Coverage floor is a plain, always-editable input — never locked,
      // never a count-0 testid (the known-stale assumption this file
      // replaces: the old two-step workflow hid it until Step 1 solved).
      const floorInput = page.getByTestId("input-coverage-floor");
      await expect(floorInput).toBeVisible();
      await expect(floorInput).toBeEnabled();
      await expect(floorInput).toHaveValue("0");

      // Derived-model line (CH4O-7): floor 0 -> Model 1 (coverage).
      const derivedLine = page.getByTestId("derived-model-line");
      await expect(derivedLine).toContainText("Model 1", { timeout: HEADER_TIMEOUT });
      await expect(derivedLine).toContainText("maximize demand within 450 mi");
      await expect(derivedLine).toContainText("holding average distance at or under 650 mi");

      // ── 2b. A Chen distance field (avg service distance cap) is a
      // unit-aware DRAFT field (`useDistanceDraft`/`ChenDistanceInput`) —
      // `.fill()` alone never reaches its write path; it commits only on
      // blur (clicking a neighbouring field), never on Enter (which races
      // Radix). Round-trip it through a real value and back to its
      // original 650 so the golden solve below is undisturbed, proving
      // this works against the real backend (not just jsdom). ────────────
      const avgCapInput = page.getByTestId("input-avg-service-cap");
      await avgCapInput.fill("700");
      await page.getByTestId("input-high-service-dist").click(); // blur-commit via a neighbouring field
      await expect(avgCapInput).toHaveValue("700", { timeout: HEADER_TIMEOUT });
      await avgCapInput.fill("650");
      await page.getByTestId("input-high-service-dist").click();
      await expect(avgCapInput).toHaveValue("650", { timeout: HEADER_TIMEOUT });

      // ── 3. Edit the coverage floor to the achieved covered demand →
      // MIN_DISTANCE mode is derived automatically (CH4O-5, §2.3). The
      // derived-model line flips the INSTANT the floor is typed — a pure
      // client-side re-render off the current draft, no save/solve needed —
      // proving the mode derivation is live, not solve-dependent. ─────────
      await floorInput.fill(String(cov.details.coveredDemand));
      await expect(derivedLine).toContainText("Model 2", { timeout: HEADER_TIMEOUT });
      await expect(derivedLine).toContainText(
        `covering at least ${cov.details.coveredDemand!.toLocaleString()} demand within 450 mi`,
      );

      const minDist = await solveViaUi(page, id);
      expect(minDist.details.objective).toBe("min_distance");
      // Sacred min-distance golden (test_max_coverage.py::test_min_distance_golden).
      expect(minDist.objective).toBeCloseTo(30269639699.0, -3);
      expect(minDist.metrics.weightedAvgDistance).toBeCloseTo(387.94, 1);
      expect(new Set(minDist.details.openWarehouseIds)).toEqual(new Set(["DAL", "LA", "PIT"]));

      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("demand-mi", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-value-objective")).not.toContainText("%");

      // ── 4. Demand edit (still min-distance mode) → re-solve → objective
      // delta (server-verified). No freeze guard exists any more — every
      // edit is an ordinary dirty draft, auto-saved by `solveViaUi`. ───────
      await page.getByTestId("sidebar-input-customers").click();
      const demandInput = page.locator('[data-testid^="input-customer-demand-"]').first();
      await expect(demandInput).toBeVisible({ timeout: HEADER_TIMEOUT });
      const currentDemand = Number(await demandInput.inputValue()) || 0;
      await demandInput.fill(String(currentDemand + 100_000_000)); // large, served → moves the objective

      const afterDemand = await solveViaUi(page, id);
      expect(afterDemand.details.objective).toBe("min_distance");
      expect(afterDemand.objective).not.toBe(minDist.objective);

      // ── 5. Distance override reassigns a customer ───────────────────────
      // Pick a served customer and a DIFFERENT open warehouse; force that
      // pair to 1 mi and confirm the customer flips to it on re-solve.
      const seedEdge = afterDemand.edges[0];
      const targetCustomer = seedEdge.toId;
      const originWh = seedEdge.fromId;
      const otherOpenWh = afterDemand.details.openWarehouseIds!.find(w => w !== originWh)!;
      expect(otherOpenWh).toBeTruthy();

      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-add-distance-row").click();
      await page.getByTestId("input-new-distance-from").fill(otherOpenWh);
      await page.getByTestId("input-new-distance-to").fill(targetCustomer);
      await page.getByTestId("input-new-distance-value").fill("1");
      // `button-add-distance-confirm`'s own handler commits the value
      // draft synchronously before reading it (DistancesTab.tsx's
      // `handleAddRow`), so a plain click reaches the write path with no
      // separate blur required — this ADDS to the localInputs draft (does
      // NOT PATCH immediately), so an explicit Save is still needed.
      await page.getByTestId("button-add-distance-confirm").click();
      await saveViaHeader(page);

      const afterOverride = await solveViaUi(page, id);
      const reassigned = afterOverride.edges.find(e => e.toId === targetCustomer);
      expect(reassigned).toBeDefined();
      expect(reassigned!.fromId).toBe(otherOpenWh);
      // MIG-6: max-coverage-us applies NO circuity factor — the override's
      // raw value survives unmodified into the reported edge distance (no
      // unit conversion either, now that the model is mi-canonical). The
      // 1 mi override drove the reassignment, and the resulting edge
      // distance is exactly the override value.
      expect(reassigned!.distance).toBeCloseTo(1, 3);

      // ── 6. Input-Map add a warehouse → estimated mi distances surface ───
      // No freeze guard to work around any more — straight into Input Map,
      // add, Save.
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // 26 warehouses + 200 customers over the continental US — hide both
      // layers first so the placement click reliably lands on the map, not
      // on an existing marker (placement/pinMode is independent of the
      // display toggles).
      await page.getByTestId("toggle-layer-warehouses").click();
      await page.getByTestId("toggle-layer-customers").click();
      await page.getByTestId("button-input-map-place-wh").click();
      const mapCanvas = page.locator('[data-testid="input-map-tab"] .leaflet-container');
      await expect(mapCanvas).toBeVisible({ timeout: HEADER_TIMEOUT });
      await mapCanvas.click({ position: { x: 260, y: 200 } });

      await expect(page.getByTestId("create-entity-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const newWhCode = (await page.getByTestId("create-entity-display-code").innerText()).trim();
      await page.getByTestId("create-entity-submit").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible({ timeout: HEADER_TIMEOUT });

      // COSM-2 — this model's Save lives in the SHARED toolbar row
      // (`workspace-toolbar-row`), outside the Input Map tab, beside the
      // step toggle (now gone) — `saveInLayersRow` is only p-median-us/
      // p-median-brazil (Workspace.tsx:2331-2332), so max-coverage-us was
      // never in it.
      const mapSave = page.locator('[data-testid="workspace-toolbar-row"] [data-testid="button-save"]');
      await expect(mapSave).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await mapSave.click();
      await expect(mapSave).toBeDisabled({ timeout: HEADER_TIMEOUT });

      // The added warehouse's estimated (mi) distances now appear in the
      // Distances tab, filtered by its display code.
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("input-filter-from").fill(newWhCode);
      const estimatedBadges = page.locator('[data-testid^="badge-distance-estimated-"]');
      await expect(estimatedBadges.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await estimatedBadges.count()).toBeGreaterThan(0);
      await page.getByTestId("input-filter-from").fill("");

      // ── 7a. v1 `distances` CSV round-trip identity ──────────────────────
      const distExport = await page.request.get(`/api/scenarios/${id}/export?entity=distances&format=csv`);
      expect(distExport.status()).toBe(200);
      const distCsv = await distExport.text();
      expect(distCsv.split("\n")[0]).toContain("from_id");
      await page.getByTestId("button-import-distances").click();
      await page.getByTestId("input-import-file-distances").setInputFiles({
        name: "distances.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(distCsv),
      });
      await expect(
        page.getByText("No changes detected — file matches the scenario's current state."),
      ).toBeVisible({ timeout: 8_000 });
      await page.getByTestId("button-import-cancel").click();

      // ── 7b. `customers` CSV: edit one demand → exactly one change ────────
      const custExport = await page.request.get(`/api/scenarios/${id}/export?entity=customers&format=csv`);
      expect(custExport.status()).toBe(200);
      const custCsv = await custExport.text();
      const custLines = custCsv.trim().split("\n");
      const header = custLines[0].split(",");
      const demandCol = header.indexOf("demand");
      expect(demandCol).toBeGreaterThanOrEqual(0);
      const firstRow = custLines[1].split(",");
      firstRow[demandCol] = String((Number(firstRow[demandCol]) || 0) + 500);
      const editedCustCsv = [custLines[0], firstRow.join(","), ...custLines.slice(2)].join("\n");

      await page.getByTestId("sidebar-input-customers").click();
      await expect(page.getByTestId("customers-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-import-customers").click();
      await page.getByTestId("input-import-file-customers").setInputFiles({
        name: "customers.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(editedCustCsv),
      });
      await expect(page.getByText("Changes (1)")).toBeVisible({ timeout: 8_000 });
      await page.getByTestId("button-import-confirm").click();
      await expect(page.getByTestId("input-import-file-customers")).not.toBeVisible({ timeout: 8_000 });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
