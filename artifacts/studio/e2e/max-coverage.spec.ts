/**
 * Browser E2E — Chapter 4 Al's Athletics Max Coverage (US service-level
 * facility location), Task C4.16 (originally written for the retired
 * China-dataset model; rewritten onto `max-coverage-us` per the
 * ch4-migration cutover — MIG-8).
 *
 * Exercises the full max-coverage model through the Workspace UI against
 * local dev servers:
 *   1. register a fresh account → create a max-coverage scenario (Chapter 4)
 *   2. COVERAGE solve → assert coverage ≈ 68.4192 % and the three opened
 *      warehouses (DAL Dallas / LA Los Angeles / PIT Pittsburgh)
 *   3. assert `km` present / `mi` absent on the model's distance surfaces
 *   4. switch to MIN_DISTANCE mode → solve → objective renders in demand-km
 *   5. edit a customer demand → re-solve → objective delta (server-verified)
 *   6. add a distance override (open-warehouse → customer @ 1 km) → re-solve →
 *      that customer's assignment flips to the overridden warehouse
 *   7. Input-Map add a warehouse → save → its estimated km distances surface
 *      in the Distances tab
 *   8. TWO distinct import flows, asserted separately:
 *      (a) the v1 `distances` CSV exports and re-imports UNCHANGED (round-trip
 *          identity — "No changes detected")
 *      (b) a `customers` CSV is exported, one demand edited, re-imported →
 *          exactly one change applies
 *
 * The max-coverage-us goldens are the sacred solver ground truth
 * (solver/tests/test_max_coverage.py): coverage `coveragePct == 68.4192`,
 * `coveredDemand == 53385024`, open `{DAL, LA, PIT}`; min-distance objective
 * ≈ 48714263031.75 demand-km (coverage floor seeded from the coverage
 * mode's covered demand, 53385024). Both objective modes open the SAME
 * three warehouses. MIG-6: this dataset's stored distances ARE the
 * effective distances — the solver applies no circuity factor, so a
 * distanceOverride's raw value survives unmodified into the reported edge
 * distance (unlike the retired China model, which applied a ~1.17 circuity
 * factor to estimated distances).
 *
 * Objectives / assignments for the delta+override steps are read straight off
 * the persisted result envelope via `page.request` (full precision), because
 * the min-distance objective renders in the UI as a 2-sig-fig
 * `toExponential(2)` string — too coarse to detect a one-customer delta.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md's
 * "To run e2e locally" recipe and vite.config.ts.
 */
import { test, expect, type Page } from "./fixtures";

const HEADER_TIMEOUT = 10_000;
// ch4-2s-9 — widened from 120_000: a real CBC solve of this 26-warehouse/
// 200-customer model was observed taking ~170s on a (contended) local run.
const SOLVE_TIMEOUT = 240_000;

interface MaxCoverageResult {
  status: string;
  objective: number;
  edges: Array<{ fromId: string; toId: string; distance: number; flow: number }>;
  details: { objective?: string; coveragePct?: number; openWarehouseIds?: string[] };
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

/** Default coverage-mode inputs = the coverage golden config
 * (p=3, high=700, max=5500, avgServiceDistCap=1000). */
function coverageInputs() {
  return {
    objective: "coverage",
    p: 3,
    highServiceDistKm: 700,
    maxDistKm: 5500,
    avgServiceDistCapKm: 1000,
    gap: 0,
    timeLimitSec: 120,
    capacityMode: "none",
    distanceBands: [700, 5500],
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

/** Trigger a solve via the Run Optimizer dialog (auto-saves any dirty edit),
 * then poll the persisted scenario until `solvedAt` advances past the value
 * captured before the click — a precise "the NEW result has landed" signal
 * that doesn't depend on the coarse UI objective string. Returns the fresh
 * result envelope. */
async function solveViaUi(page: Page, id: string): Promise<MaxCoverageResult> {
  const before = (await getScenario(page, id)).solvedAt;
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  // Output Map auto-opens on success (Workspace.tsx jobStatus effect) — a
  // cheap UI signal the job finished before we hit the server.
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });

  let fresh: MaxCoverageResult | null = null;
  await expect
    .poll(async () => {
      const s = await getScenario(page, id);
      if (s.result != null && s.solvedAt != null && s.solvedAt !== before) {
        fresh = s.result;
        return true;
      }
      return false;
    }, { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
    .toBe(true);
  // CH4UX-7 — the durable `solvedAt` poll above is unchanged (it was already
  // correct). This adds the failure-surface half: `solve-progress-overlay`
  // unmounts on success and PERSISTS as an error card on failure, so a solve
  // that ends in a failed job can no longer slip past as "some result
  // landed". It is the successor to the Solve dialog's deleted
  // `solve-dialog-error`.
  await expect(page.getByTestId("solve-progress-overlay")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
  expect(fresh).not.toBeNull();
  expect(fresh!.status).toBe("optimal");
  return fresh!;
}

async function saveViaHeader(page: Page): Promise<void> {
  const save = page.getByTestId("button-save").first();
  await expect(save).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await save.click();
  await expect(save).toBeDisabled({ timeout: HEADER_TIMEOUT });
}

/** ch4-2s-9 — CH4-16: every Step 1 field write funnels through a guard
 * that, once Step 1 is frozen (solved), intercepts with the freeze-confirm
 * dialog instead of landing in the draft. This test solves Step 1 in its
 * very first section, so EVERY later Step-1-field edit (demand, distance
 * override, added warehouse) hits an already-frozen Step 1. Confirming the
 * dialog PATCHes the pending edit immediately (the same edit `action`
 * attempted) AND drops both steps to 0 of 2 in that one request — so on
 * interception there is nothing left to `saveViaHeader`; the caller should
 * skip straight to its own re-solve. Returns whether the dialog
 * intercepted, so the caller knows whether an ordinary Save is still
 * needed. */
async function applyStep1Edit(page: Page, action: () => Promise<void>): Promise<boolean> {
  await action();
  const dialog = page.getByTestId("freeze-confirm-dialog");
  const intercepted = await dialog.isVisible({ timeout: 2_000 }).catch(() => false);
  if (intercepted) {
    await page.getByTestId("freeze-confirm-accept").click({ timeout: HEADER_TIMEOUT });
    await expect(dialog).toHaveCount(0, { timeout: HEADER_TIMEOUT });
  }
  return intercepted;
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
    // ch4-2s-9 — this test now performs 4 real solves (coverage, min-distance,
    // then a fresh coverage solve after each of the two confirm-and-clear
    // cycles sections 4/5 now go through); widened from 360_000 to give
    // headroom at the ~240_000 per-solve SOLVE_TIMEOUT observed locally.
    test.setTimeout(900_000);
    await registerAndGoHome(page);
    const id = await createMaxCoverageScenario(page);

    try {
      // ── 0. Header shows Chapter 4 / US service coverage copy, not another
      // model's title (gold-refinery) or the retired China copy ──────────
      const summary = page.getByTestId("workspace-chapter-summary");
      await expect(summary).toContainText("Chapter 4");
      await expect(summary).toContainText(/United States/i);
      await expect(summary).not.toContainText(/china/i);
      await expect(summary).not.toContainText(/gold refinery/i);

      // ── 1. Coverage solve → golden coverage % + three opened warehouses ──
      const cov = await solveViaUi(page, id);
      expect(cov.details.objective).toBe("coverage");
      expect(cov.details.coveragePct).toBeCloseTo(68.4192, 2);
      expect(new Set(cov.details.openWarehouseIds)).toEqual(new Set(["DAL", "LA", "PIT"]));

      // Cost-summary UI shows the coverage % objective (formatChenObjective).
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("68.42 %", { timeout: HEADER_TIMEOUT });

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

      // ── 2. Distance surfaces carry `km`, never `mi` ─────────────────────
      await page.getByTestId("sidebar-output-cost-summary").click();
      const wavg = page.getByTestId("cost-summary-value-weighted-avg-distance");
      await expect(wavg).toContainText("km", { timeout: HEADER_TIMEOUT });
      await expect(wavg).not.toContainText(/\bmi\b/);
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      const chenParams = page.getByTestId("chen-objective-section");
      await expect(chenParams).toContainText("High-service distance (km)", { timeout: HEADER_TIMEOUT });
      await expect(chenParams).toContainText("Max distance (km)");

      // ── 3. Step 1 is solved; Step 2 unlocks and runs from the seeded floor ──
      // The free objective toggle is gone (CH4-17): the step toggle is now the
      // only way to reach min-distance, and the floor is produced by Step 1's
      // achieved covered demand rather than typed.
      await expect(page.getByTestId("chen-objective-toggle")).toHaveCount(0);
      await expect(page.getByTestId("input-coverage-floor")).toHaveCount(0);
      await expect(page.getByTestId("text-steps-solved-counter")).toHaveText("1 of 2 solved");

      await page.getByTestId("step-toggle-2").click();
      await expect(page.getByTestId("step-toggle-2")).toHaveAttribute("aria-pressed", "true");

      // The floor is displayed, locked, and equal to Step 1's covered demand.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("step2-floor-value")).toContainText("53,385,024", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("step2-parameters")).toBeVisible();

      await expect(page.getByTestId("button-run-optimizer")).toHaveText("Solve Step 2");
      const minDist = await solveViaUi(page, id);
      expect(minDist.details.objective).toBe("min_distance");
      // Sacred min-distance golden (test_max_coverage.py::test_min_distance_golden).
      expect(minDist.objective).toBeCloseTo(48714263031.75, -3);
      expect(new Set(minDist.details.openWarehouseIds)).toEqual(new Set(["DAL", "LA", "PIT"]));

      await expect(page.getByTestId("text-steps-solved-counter")).toHaveText("2 of 2 solved");

      // Frame 3d — the comparison unlocks at 2 of 2 and renders from data the
      // scenario already carries.
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("demand-km", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("step-comparison")).toBeVisible();
      await expect(page.getByTestId("step-comparison-weightedAvgDistance-1")).toContainText("635.13 km");
      await expect(page.getByTestId("step-comparison-weightedAvgDistance-2")).toContainText("624.33 km");

      // ── 4a. A Step 1 edit raises confirm-and-clear and drops BOTH steps ──
      // CH4-2/CH4-16 — Step 1 has been frozen since section 1's solve, and
      // stays frozen through section 3 (steps.step1.solved is unaffected by
      // which step the toggle points at or by Step 2 solving too). Every
      // Step-1-field edit past this point (customer demand here, the
      // distance override in section 5, the added warehouse in section 6)
      // hits that freeze — dropping BOTH steps to 0 of 2 is the deliberate
      // extension over the deck's frame 6 (Step 2 only) that makes solve
      // targeting derivable from state alone. `applyStep1Edit` confirms the
      // dialog if it appears (which PATCHes this exact edit AND clears in
      // one request) — this first call is also the explicit proof that the
      // mechanism works, matching the plan's own Task 9 Step 3 case.
      await page.getByTestId("sidebar-input-customers").click();
      const demandInput = page.locator('[data-testid^="input-customer-demand-"]').first();
      await expect(demandInput).toBeVisible({ timeout: HEADER_TIMEOUT });
      const demandTestId = await demandInput.getAttribute("data-testid");
      const editedCustomerId = demandTestId!.replace("input-customer-demand-", "");
      const currentDemand = Number(await demandInput.inputValue()) || 0;
      const demandIntercepted = await applyStep1Edit(page, () =>
        demandInput.fill(String(currentDemand + 100_000_000)), // large, served → moves the objective
      );
      expect(demandIntercepted).toBe(true); // Step 1 IS frozen entering this section — prove it, not just tolerate it.
      await expect(page.getByTestId("text-steps-solved-counter")).toHaveText("0 of 2 solved");
      await expect(page.getByTestId("button-run-optimizer")).toHaveText("Solve Step 1");

      // ── 4b. Re-solve Step 1 (now unfrozen) → a fresh coverage result whose
      // objective differs from the ORIGINAL section-1 baseline (`cov`) —
      // NOT `minDist`, which is a different objective TYPE entirely
      // (demand-km, not covered-demand) and would make this comparison
      // vacuous. ─────────────────────────────────────────────────────────
      const afterDemand = await solveViaUi(page, id);
      expect(afterDemand.details.objective).toBe("coverage");
      expect(afterDemand.objective).not.toBe(cov.objective);

      // ── 5. Distance override reassigns a customer ───────────────────────
      // Pick a served customer and a DIFFERENT open warehouse; force that
      // pair to 1 km and confirm the customer flips to it on re-solve.
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
      // Step 1 was frozen again the instant section 4b solved — same guard,
      // same helper; the add-row form's own fields above are local draft
      // state until this confirm click, which is the actual guarded write.
      const overrideIntercepted = await applyStep1Edit(page, () =>
        page.getByTestId("button-add-distance-confirm").click(),
      );
      if (!overrideIntercepted) await saveViaHeader(page);

      const afterOverride = await solveViaUi(page, id);
      const reassigned = afterOverride.edges.find(e => e.toId === targetCustomer);
      expect(reassigned).toBeDefined();
      expect(reassigned!.fromId).toBe(otherOpenWh);
      // MIG-6: max-coverage-us applies NO circuity factor — the override's
      // raw value survives unmodified into the reported edge distance (unlike
      // the retired China model, which applied a ~1.17 circuity factor to
      // estimated distances). The 1 km override drove the reassignment, and
      // the resulting edge distance is exactly the override value.
      expect(reassigned!.distance).toBeCloseTo(1, 3);

      // ── 6. Input-Map add a warehouse → estimated km distances surface ───
      // Step 1 is frozen again (from section 5's solve). Sections 4/5
      // already prove the confirm-and-clear mechanism thoroughly on a form
      // field and a distances-tab row; routing the MAP add through it too
      // would entangle two independent concerns — the estimated-distance
      // preview is keyed off a "just added, not yet saved" watch
      // (`pendingEstimateWatches`) that the ordinary Input-Map Save flow
      // populates, and going through the freeze-confirm PATCH instead
      // persists the entity directly without ever registering that watch,
      // so no estimate materializes (confirmed empirically: the Distances
      // tab shows zero rows for the new code, not just no "estimated"
      // badge). Unfreeze first via the same mechanism sections 4/5 already
      // proved, so this section exercises the ORIGINAL, already-working
      // add-via-map-then-Save path untangled from the new guard.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("input-high-service-dist").fill("725");
      await page.getByTestId("input-max-dist").click();
      await expect(page.getByTestId("freeze-confirm-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("freeze-confirm-accept").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-steps-solved-counter")).toHaveText("0 of 2 solved", { timeout: HEADER_TIMEOUT });

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
      // Step 1 is unfrozen (just confirmed-and-cleared above), so this
      // lands as an ordinary dirty draft — `applyStep1Edit` still wraps it
      // defensively (harmless no-op when the guard doesn't intercept).
      const mapAddIntercepted = await applyStep1Edit(page, () => page.getByTestId("create-entity-submit").click());
      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible({ timeout: HEADER_TIMEOUT });

      // Save lives in the Input Map's own Layers row (saveInLayersRow gate)
      // — only relevant when the edit landed as an ordinary dirty draft
      // rather than already being PATCHed by the freeze-confirm above.
      if (!mapAddIntercepted) {
        const mapSave = page.locator('[data-testid="input-map-tab"] [data-testid="button-save"]');
        await expect(mapSave).toBeEnabled({ timeout: HEADER_TIMEOUT });
        await mapSave.click();
        await expect(mapSave).toBeDisabled({ timeout: HEADER_TIMEOUT });
      }

      // The added warehouse's estimated (km) distances now appear in the
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
