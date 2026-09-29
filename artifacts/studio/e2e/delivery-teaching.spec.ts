/**
 * Browser E2E — Chapter 5 (modified) Delivery Company Teaching Example
 * (`delivery-teaching-us`), Task 13 (Task 5/6/9 rewrite: five input tabs,
 * `fixedGeography` map, editable Warehouses/Customers).
 *
 * Exercises the full delivery model through the Workspace UI against local
 * dev servers:
 *   1. Landing shows the Chapter 5 Delivery card; the two RETIRED Chapter 5
 *      models (transport-coal, p-median-brazil — both hiddenFromLanding)
 *      stay absent.
 *   2. Create a scenario → the tab rail shows exactly Input Map, Warehouses,
 *      Customers, Delivery Costs, Optimization Parameters (§14/Task 5 — the
 *      cost table is no longer this model's only editable surface; facility
 *      status and customer demand/exclusion are also editable, geometry
 *      stays fixed).
 *   3. The Input Map renders `fixedGeography`: no add/move/delete/Save
 *      affordance (geometry stays fixed — Task 6's inversion only lifted
 *      status/demand editing, not the map's own add/move/delete controls;
 *      the map's right-click action menu shows an Edit action only, proven
 *      by InputMapTab.deliveryFixedGeography.test.tsx at the unit layer).
 *   4. Solve (real CBC) → Scenario 1's golden: open {W1, W2, W60}, weighted
 *      avg distance 422.6 mi (the on-screen 1dp form), Service Stats 81.45%
 *      at the 800mi band.
 *   5. Click Adjust Cost Table → the three rate fields default to 800/1/10 →
 *      re-solve → open set flips to {W6, W43, W45}, 800mi coverage rises to
 *      97.19%.
 *   6. Toggle back off (reproduces Scenario 1 — deterministic CBC) → override
 *      the W60→C3 lane (Scenario 1's first positive-distance assignment,
 *      distance 317.5506mi, demand 7,773,000 units) to cost 0 → re-solve →
 *      the open set is UNCHANGED and the objective drops by EXACTLY that
 *      lane's base cost × demand — never a bare "objective moved" (a large
 *      enough override legitimately reroutes demand; this lane, already in
 *      the optimum, cannot be made cheaper by rerouting AWAY from it).
 *   7. Export Open Warehouses as CSV (city column populated) and Cost
 *      Summary as JSON (`weightedAvgDistance` at the 4dp envelope value,
 *      unchanged by the override per step 6).
 *   8. Warehouses tab: set DC W1 `inactive`, re-solve → W1 leaves the open
 *      set (mirrors solver/tests/test_delivery.py::
 *      test_inactive_keeps_a_warehouse_out; assignment count stays 313 —
 *      excluding a facility reroutes demand, it doesn't drop a customer).
 *   9. Customers tab: exclude customer C1, re-solve → assignment count
 *      drops from 313 to 312 (mirrors solver/tests/test_delivery.py::
 *      test_excluded_customer_is_absent_from_assignments_and_metrics).
 *
 * Every numeric assertion below is a KNOWN pytest golden
 * (solver/tests/test_delivery.py::test_scenario_1_golden /
 * test_scenario_2_golden / test_cost_override_does_not_move_distance_metrics /
 * test_inactive_keeps_a_warehouse_out /
 * test_excluded_customer_is_absent_from_assignments_and_metrics)
 * — pytest owns the precision proof; this spec proves the UI wiring drives
 * the same real solver to the same real numbers. "Toggle off" IS the case
 * study's $1/mile Scenario 1 (test_toggle_off_equals_unit_rate) — costs are
 * seeded equal to distances — so the W60→C3 lane's base cost equals its
 * distance (317.5506) without a separate cost lookup.
 *
 * This model solves in ~2-4s (measured; 33 candidate DCs × 313 customers),
 * nothing like max-coverage-us's ~170s — six real CBC solves here cost a
 * few seconds total, not minutes, so this spec does not chase max-coverage's
 * "one real solve" discipline: the six solves below (initial, toggle-on,
 * toggle-off, override, inactive-warehouse, excluded-customer) are each
 * load-bearing to the journey the plan describes, and re-deriving Scenario 1
 * without them would only replace a cheap real solve with a slower, less
 * faithful mock.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md's
 * "To run e2e locally" recipe and vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 60_000;

interface DeliveryResult {
  status: string;
  objective: number;
  edges: Array<{ fromId: string; toId: string; distance: number; flow: number }>;
  details: {
    objective?: string;
    assignments: Array<{ customerId: string; warehouseId: string; distanceMi: number; band: number }>;
  };
  metrics: {
    weightedAvgDistance?: number;
    bandCoverage?: Array<{ band: number; percent: number }>;
  };
}

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-delivery-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Scenario 1's config — the case study's toggle-off / $1-mile baseline
 * (test_delivery.py's BASE dict, mirrored 1:1 via deliveryInputsSchema's
 * field names). */
function baseInputs() {
  return {
    p: 3,
    distanceBands: [400, 800, 1200, 1600],
    gap: 0,
    timeLimitSec: 300,
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    laneCostOverrides: [],
  };
}

async function createDeliveryScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E Delivery ${Date.now()}`, modelId: "delivery-teaching-us", inputs: baseInputs() },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-5/delivery?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

async function getScenario(page: Page, id: string): Promise<{ solvedAt: string | null; result: DeliveryResult | null }> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  return { solvedAt: body.solvedAt ?? null, result: body.result ?? null };
}

/** Trigger a solve via the Run Optimizer dialog (auto-saves any dirty edit —
 * SolveDialog's own documented save-before-solve phase), then poll the
 * persisted scenario until `solvedAt` advances — same technique as
 * max-coverage.spec.ts's `solveViaUi`. */
async function solveViaUi(page: Page, id: string): Promise<DeliveryResult> {
  const before = (await getScenario(page, id)).solvedAt;
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });

  let fresh: DeliveryResult | null = null;
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

function openSet(result: DeliveryResult): Set<string> {
  return new Set(result.edges.map(e => e.fromId));
}

// Scenario 1's first positive-distance assignment (test_cost_override_does_
// not_move_distance_metrics's own precondition) — deterministic given a
// fixed dataset and a unique CBC optimum; verified against the live solver
// while writing this spec.
const OVERRIDE_LANE = { fromId: "W60", toId: "C3", distanceMi: 317.5506, demand: 7_773_000 };

test.describe("Chapter 5 (modified) — Delivery Company Teaching Example", () => {
  test("landing card, tab rail, read-only map, toggle-driven re-solve, cost-override invariance, exports", async ({ page }) => {
    test.setTimeout(180_000);

    // ── 1. Landing shows the Chapter 5 Delivery card; the retired Chapter 5
    // models stay absent ──────────────────────────────────────────────────
    await registerAndGoHome(page);
    await expect(page.getByTestId("landing-card-delivery-teaching-us")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("landing-card-transport-coal")).toHaveCount(0);
    await expect(page.getByTestId("landing-card-p-median-brazil")).toHaveCount(0);

    // ── 2. Create a scenario → exactly Input Map / Warehouses / Customers /
    // Delivery Costs / Optimization Parameters on the tab rail (§14/Task 5 —
    // was three tabs, now five) ───────────────────────────────────────────
    const id = await createDeliveryScenario(page);
    await expect(page.getByTestId("sidebar-input-input-map")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-input-warehouses")).toBeVisible();
    await expect(page.getByTestId("sidebar-input-customers")).toBeVisible();
    await expect(page.getByTestId("sidebar-input-deliveryCosts")).toBeVisible();
    await expect(page.getByTestId("sidebar-input-optimization-parameters")).toBeVisible();
    expect(await page.locator('[data-testid^="sidebar-input-"]').count()).toBe(5);

    // ── 3. Input Map renders fixedGeography: no add/move/delete/Save
    // affordance — geometry stays fixed even though status/demand editing
    // moved to the Warehouses/Customers tabs (Task 6's inversion) ─────────
    await page.getByTestId("sidebar-input-input-map").click();
    const inputMap = page.getByTestId("input-map-tab");
    await expect(inputMap).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(inputMap.getByTestId("button-input-map-place-wh")).toHaveCount(0);
    await expect(inputMap.getByTestId("button-input-map-place-cs")).toHaveCount(0);
    await expect(inputMap.getByTestId("button-save")).toHaveCount(0);

    // ── 4. Solve (real CBC) → Scenario 1 golden ──────────────────────────────
    const scenario1 = await solveViaUi(page, id);
    expect(openSet(scenario1)).toEqual(new Set(["W1", "W2", "W60"]));
    expect(scenario1.objective).toBeCloseTo(88_240_913_478.1, 0);

    await page.getByTestId("sidebar-output-cost-summary").click();
    await expect(page.getByTestId("cost-summary-value-weighted-avg-distance")).toContainText("422.6 mi", { timeout: HEADER_TIMEOUT });

    await page.getByTestId("sidebar-output-service-stats").click();
    await expect(page.getByTestId("service-stats-band-800")).toContainText("81.45%", { timeout: HEADER_TIMEOUT });

    // ── 5. Adjust Cost Table: fields default to 800/1/10, re-solve → flips
    // open set and raises 800mi coverage to 97.19% ───────────────────────────
    await page.getByTestId("sidebar-input-optimization-parameters").click();
    await page.getByTestId("button-adjust-cost-table").click();
    await expect(page.getByTestId("input-distance-threshold")).toHaveValue("800");
    await expect(page.getByTestId("input-cost-per-mile")).toHaveValue("1");
    await expect(page.getByTestId("input-cost-per-mile-over")).toHaveValue("10");

    const scenario2 = await solveViaUi(page, id);
    expect(openSet(scenario2)).toEqual(new Set(["W6", "W43", "W45"]));

    await page.getByTestId("sidebar-output-service-stats").click();
    await expect(page.getByTestId("service-stats-band-800")).toContainText("97.19%", { timeout: HEADER_TIMEOUT });

    // ── 6. Toggle back off (reproduces Scenario 1 — deterministic CBC) →
    // override the W60→C3 lane to cost 0 → re-solve → open set unchanged,
    // objective drops by EXACTLY that lane's base cost × demand ─────────────
    await page.getByTestId("sidebar-input-optimization-parameters").click();
    await page.getByTestId("button-adjust-cost-table").click();
    const scenario1Again = await solveViaUi(page, id);
    expect(openSet(scenario1Again)).toEqual(new Set(["W1", "W2", "W60"]));
    const lane = scenario1Again.details.assignments.find(
      a => a.warehouseId === OVERRIDE_LANE.fromId && a.customerId === OVERRIDE_LANE.toId,
    );
    expect(lane).toBeTruthy();
    expect(lane!.distanceMi).toBeCloseTo(OVERRIDE_LANE.distanceMi, 3);

    await page.getByTestId("sidebar-input-deliveryCosts").click();
    await expect(page.getByTestId("delivery-costs-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("input-filter-from").fill(OVERRIDE_LANE.fromId);
    await page.getByTestId("input-filter-to").fill(OVERRIDE_LANE.toId);
    const costInput = page.getByTestId(`input-deliverycost-${OVERRIDE_LANE.fromId}-${OVERRIDE_LANE.toId}`);
    await expect(costInput).toBeVisible({ timeout: HEADER_TIMEOUT });
    await costInput.fill("0");
    await costInput.press("Enter");
    await expect(page.getByTestId(`badge-deliverycost-overridden-${OVERRIDE_LANE.fromId}-${OVERRIDE_LANE.toId}`))
      .toBeVisible({ timeout: HEADER_TIMEOUT });

    const overridden = await solveViaUi(page, id);
    expect(openSet(overridden)).toEqual(openSet(scenario1Again));
    // "Toggle off" IS the $1/mile case (test_toggle_off_equals_unit_rate) —
    // the lane's base cost equals its distance, so the removed cost is
    // distance × demand.
    const expectedDrop = OVERRIDE_LANE.distanceMi * OVERRIDE_LANE.demand;
    expect(overridden.objective).toBeCloseTo(scenario1Again.objective - expectedDrop, 1);
    expect(overridden.metrics.weightedAvgDistance).toBeCloseTo(scenario1Again.metrics.weightedAvgDistance!, 4);

    // ── 7. Export Open Warehouses CSV (city column populated) and Cost
    // Summary JSON (weightedAvgDistance at the 4dp envelope value — unchanged
    // by the invariant override above) ───────────────────────────────────────
    const owCsv = await page.request.get(`/api/scenarios/${id}/export?entity=openWarehouses&format=csv`);
    expect(owCsv.status()).toBe(200);
    const owLines = (await owCsv.text()).trim().split("\n").slice(1); // drop header row
    expect(owLines.length).toBeGreaterThan(0);
    for (const line of owLines) {
      const city = line.split(",")[2];
      expect(city, `city column for row "${line}"`).toBeTruthy();
    }

    const csJson = await page.request.get(`/api/scenarios/${id}/export?entity=costSummary&format=json`);
    expect(csJson.status()).toBe(200);
    const csBody = await csJson.json();
    expect(csBody.rows[0].weightedAvgDistance).toBeCloseTo(422.5511, 3);

    // ── 8. Warehouses tab: setting candidate DC W1 inactive removes it from
    // the open set on re-solve (test_inactive_keeps_a_warehouse_out) —
    // demand reroutes to the remaining candidates, so every customer is
    // still assigned (assignment count stays 313) ─────────────────────────
    await page.getByTestId("sidebar-input-warehouses").click();
    const warehousesTab = page.getByTestId("warehouses-tab");
    await expect(warehousesTab).toBeVisible({ timeout: HEADER_TIMEOUT });
    await warehousesTab.getByTestId("button-wh-W1-inactive").click();

    const inactiveW1 = await solveViaUi(page, id);
    expect(openSet(inactiveW1).has("W1")).toBe(false);
    expect(inactiveW1.details.assignments.length).toBe(313);

    // ── 9. Customers tab: excluding city C1 drops the assignment count by
    // exactly one — 313 → 312
    // (test_excluded_customer_is_absent_from_assignments_and_metrics) —
    // independent of the warehouse override in step 8 above ───────────────
    await page.getByTestId("sidebar-input-customers").click();
    const customersTab = page.getByTestId("customers-tab");
    await expect(customersTab).toBeVisible({ timeout: HEADER_TIMEOUT });
    await customersTab.getByTestId("button-customer-C1-excluded").click();

    const excludedC1 = await solveViaUi(page, id);
    expect(excludedC1.details.assignments.length).toBe(312);

    await page.request.delete(`/api/scenarios/${id}`);
  });
});
