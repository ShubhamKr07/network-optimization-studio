/**
 * Browser E2E — Chapter 4 Chen's Cosmetics (Service-Coverage facility location), Task C4.16.
 *
 * Exercises the full Chen model through the Workspace UI against local dev
 * servers:
 *   1. register a fresh account → create a Chen scenario (Chapter 4)
 *   2. COVERAGE solve → assert coverage ≈ 66.06 % and the three opened
 *      warehouses (wh-40 Guangzhou / wh-69 Jinan / wh-102 Nanjing)
 *   3. assert `km` present / `mi` absent on Chen distance surfaces
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
 * The Chen coverage/min-distance goldens are the sacred solver ground truth
 * (tests/test_chens.py): coverage `coveragePct ≈ 66.0639`, open
 * {wh-40, wh-69, wh-102}; min-distance objective ≈ 1.238e11 demand-km.
 *
 * Objectives / assignments for the delta+override steps are read straight off
 * the persisted result envelope via `page.request` (full precision), because
 * the Chen min-distance objective renders in the UI as a 2-sig-fig
 * `toExponential(2)` string — too coarse to detect a one-customer delta.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md's
 * "To run e2e locally" recipe and vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 120_000;

interface ChenResult {
  status: string;
  objective: number;
  edges: Array<{ fromId: string; toId: string; distance: number; flow: number }>;
  details: { objective?: string; coveragePct?: number; openWarehouseIds?: string[] };
  metrics: { weightedAvgDistance?: number; openFacilityIds?: string[] };
}

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-chens-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Default coverage-mode inputs = the coverage golden config
 * (p=3, high=600, max=5000, avgServiceDistCap=1000). */
function coverageInputs() {
  return {
    objective: "coverage",
    p: 3,
    highServiceDistKm: 600,
    maxDistKm: 5000,
    avgServiceDistCapKm: 1000,
    gap: 0,
    timeLimitSec: 120,
    capacityMode: "none",
    distanceBands: [600, 5000],
    warehouseOverrides: [],
    customerOverrides: [],
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
  };
}

async function createChenScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E Chen ${Date.now()}`, modelId: "chens-cosmetics-cn", inputs: coverageInputs() },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-4?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

async function getScenario(page: Page, id: string): Promise<{ solvedAt: string | null; result: ChenResult | null }> {
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
async function solveViaUi(page: Page, id: string): Promise<ChenResult> {
  const before = (await getScenario(page, id)).solvedAt;
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  // Output Map auto-opens on success (Workspace.tsx jobStatus effect) — a
  // cheap UI signal the job finished before we hit the server.
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });

  let fresh: ChenResult | null = null;
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

test.describe("Chapter 4 — Chen's Cosmetics service-coverage", () => {
  test("coverage + min-distance solves, demand delta, distance override, map add, import round-trips", async ({ page }) => {
    test.setTimeout(360_000);
    await registerAndGoHome(page);
    const id = await createChenScenario(page);

    try {
      // ── 0. Header shows Chen, not another model's title ──────────────────
      const summary = page.getByTestId("workspace-chapter-summary");
      await expect(summary).toContainText("Chapter 4");
      await expect(summary).not.toContainText(/AL's Athletics/i);
      await expect(summary).not.toContainText(/gold refinery/i);

      // ── 1. Coverage solve → golden coverage % + three opened warehouses ──
      const cov = await solveViaUi(page, id);
      expect(cov.details.objective).toBe("coverage");
      expect(cov.details.coveragePct).toBeCloseTo(66.0639, 2);
      expect(new Set(cov.details.openWarehouseIds)).toEqual(new Set(["wh-40", "wh-69", "wh-102"]));

      // Cost-summary UI shows the coverage % objective (formatChenObjective).
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("66.06 %", { timeout: HEADER_TIMEOUT });

      // Open Warehouses grid: exactly the three golden facilities.
      await page.getByTestId("sidebar-output-open-warehouses").click();
      await expect(page.getByTestId("open-warehouse-row-wh-40")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("open-warehouse-row-wh-69")).toBeVisible();
      await expect(page.getByTestId("open-warehouse-row-wh-102")).toBeVisible();
      expect(await page.locator('[data-testid^="open-warehouse-row-"]').count()).toBe(3);

      // The three opened facilities ARE Guangzhou / Jinan / Nanjing — proven
      // on the Warehouses input grid, which pairs each id with its city cell.
      await page.getByTestId("sidebar-input-warehouses").click();
      for (const [whId, city] of [["wh-40", "Guangzhou"], ["wh-69", "Jinan"], ["wh-102", "Nanjing"]] as const) {
        const row = page.getByRole("row").filter({ has: page.getByText(whId, { exact: true }) });
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

      // ── 3. Switch to min-distance → save → solve → demand-km objective ──
      await page.getByTestId("chen-objective-min_distance").click();
      await expect(page.getByTestId("chen-objective-min_distance")).toHaveAttribute("aria-pressed", "true");
      // Toggling seeds the min-distance-only coverage floor field.
      await expect(page.getByTestId("input-coverage-floor")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await saveViaHeader(page);

      const minDist = await solveViaUi(page, id);
      expect(minDist.details.objective).toBe("min_distance");
      // Sacred min-distance golden (tests/test_chens.py::test_min_distance_golden).
      expect(minDist.objective).toBeCloseTo(123834216789.27, -3);
      expect(new Set(minDist.details.openWarehouseIds)).toEqual(new Set(["wh-40", "wh-69", "wh-102"]));

      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("demand-km", { timeout: HEADER_TIMEOUT });

      // ── 4. Edit a customer's demand → re-solve → objective moves ────────
      await page.getByTestId("sidebar-input-customers").click();
      const demandInput = page.locator('[data-testid^="input-customer-demand-"]').first();
      await expect(demandInput).toBeVisible({ timeout: HEADER_TIMEOUT });
      const demandTestId = await demandInput.getAttribute("data-testid");
      const editedCustomerId = demandTestId!.replace("input-customer-demand-", "");
      const currentDemand = Number(await demandInput.inputValue()) || 0;
      await demandInput.fill(String(currentDemand + 100_000_000)); // large, served → moves the objective
      await saveViaHeader(page);

      const afterDemand = await solveViaUi(page, id);
      expect(afterDemand.objective).not.toBe(minDist.objective);

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
      await page.getByTestId("button-add-distance-confirm").click();
      await saveViaHeader(page);

      const afterOverride = await solveViaUi(page, id);
      const reassigned = afterOverride.edges.find(e => e.toId === targetCustomer);
      expect(reassigned).toBeDefined();
      expect(reassigned!.fromId).toBe(otherOpenWh);
      // The 1 km override drove the reassignment: the resulting edge distance
      // is far below any real China inter-city pair (tens–hundreds of km) —
      // the solver applies a ~1.17 circuity factor, so this is ~1.17, not 1.
      expect(reassigned!.distance).toBeLessThan(5);

      // ── 6. Input-Map add a warehouse → estimated km distances surface ───
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // Chen has ~330 dense markers over China — hide both layers first so the
      // placement click reliably lands on the map, not on an existing marker
      // (placement/pinMode is independent of the display toggles).
      await page.getByTestId("toggle-layer-warehouses").click();
      await page.getByTestId("toggle-layer-customers").click();
      await page.getByTestId("button-input-map-place-wh").click();
      const mapCanvas = page.locator('[data-testid="input-map-tab"] .leaflet-container');
      await expect(mapCanvas).toBeVisible({ timeout: HEADER_TIMEOUT });
      await mapCanvas.click({ position: { x: 260, y: 200 } });

      await expect(page.getByTestId("create-entity-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const newWhCode = (await page.getByTestId("create-entity-display-code").innerText()).trim();
      await page.getByTestId("create-entity-submit").click();
      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible({ timeout: HEADER_TIMEOUT });

      // Save lives in the Input Map's own Layers row (saveInLayersRow gate).
      const mapSave = page.locator('[data-testid="input-map-tab"] [data-testid="button-save"]');
      await expect(mapSave).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await mapSave.click();
      await expect(mapSave).toBeDisabled({ timeout: HEADER_TIMEOUT });

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
