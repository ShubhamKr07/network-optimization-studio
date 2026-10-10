/**
 * CH4OS (spec 2026-10-10 §9 E2E) — floor 0 → choose each objective → solve, and
 * floor above max → alert. Solver results are SEEDED (e2e convention: real CBC
 * timing belongs to pytest): POST /solve and the job poll are stubbed, and the
 * scenario GET is answered with the real row plus a seeded envelope. Every
 * WRITE (the save-before-solve PATCH) goes to the real API, so the stored
 * `objective` asserted below is real server behaviour, read back through
 * `page.request` (which page.route does not intercept).
 */
import { test, expect, type Page } from "./fixtures";
import { maxCoverageInputs } from "./helpers/maxCoverageInputs";

const HEADER_TIMEOUT = 10_000;
const HINT = "Choose an objective — Max coverage or Min distance — before solving.";
const JOB_ID = 424242;

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-ch4os-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function storedObjective(page: Page, id: string): Promise<unknown> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  return (await resp.json()).inputs.objective;
}

const model1 = { openWarehouseIds: ["DAL", "LA", "PIT"], coveredDemand: 54946145, coveragePct: 70.42, weightedAvgDistance: 394.65, optimal: true };
const evidence = { solutionStatus: "optimal", terminationReason: "optimality_proven", achievedGap: 0, solverIncumbentObjective: null, solverBestBound: null };
function network(objective: number, avg: number, open: string[], mode: string, covered: number, pct: number) {
  return {
    status: "optimal", ...evidence, objective, runTimeSec: 1.0, quality: "Optimal", edges: [],
    metrics: { openFacilityIds: open, weightedAvgDistance: avg, utilizationByNode: [], bandCoverage: [{ band: 450, percent: pct }, { band: 3400, percent: 100 }] },
    details: { objective: mode, p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, coverageFloorDemand: 0,
               openWarehouseIds: open, coveragePct: pct, coveredDemand: covered, uncoveredPct: 100 - pct, assignments: [] },
    solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  };
}
const SEEDED_MODEL1 = network(70.42, 394.65, ["DAL", "LA", "PIT"], "coverage", 54946145, 70.42);
const SEEDED_MODEL2 = network(29873735731, 382.87, ["BAL", "DAL", "LA"], "min_distance", 52346880, 67.0887);
const SEEDED_TOO_HIGH = {
  status: "infeasible", solutionStatus: "infeasible", terminationReason: "infeasible", achievedGap: null,
  solverIncumbentObjective: null, solverBestBound: null, objective: 0, runTimeSec: 1.0, quality: "infeasible", edges: [],
  metrics: { utilizationByNode: [], bandCoverage: [], weightedAvgDistance: 0 },
  details: { openWarehouseIds: [], assignments: [], objective: "min_distance", coverageFloorDemand: 500100100, maxCoverableDemand: 54946145, model1 },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: "Coverage floor 500100100 exceeds the maximum coverable demand 54946145 (Model 1). Lower the floor to at most 54946145.",
};

async function installSolveStubs(page: Page, id: string, state: { seeded: Record<string, unknown> | null }) {
  await page.route(`**/api/scenarios/${id}/solve`, async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobId: JOB_ID }) });
  });
  await page.route(`**/api/scenarios/${id}/solve-jobs/*`, route => {
    const now = Date.now();
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        id: JOB_ID, status: "succeeded", error: null, errorCode: null, errorMessage: null, resultSummary: null,
        queuedAt: new Date(now - 2_000).toISOString(), startedAt: new Date(now - 1_500).toISOString(), finishedAt: new Date(now).toISOString(),
      }),
    });
  });
  await page.route(`**/api/scenarios/${id}`, async route => {
    if (route.request().method() !== "GET" || state.seeded == null) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, result: state.seeded, stale: false, solvedAt: new Date().toISOString() } });
  });
}

async function solveSeeded(page: Page): Promise<void> {
  const run = page.getByTestId("button-run-optimizer");
  await expect(run).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await run.click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click({ timeout: HEADER_TIMEOUT });
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("solve-progress-overlay")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
}

test.describe("Chapter 4 — objective selector and sequential solve (CH4OS, seeded)", () => {
  test("floor 0: choose each objective and solve; floor above max: alert", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const create = await page.request.post("/api/scenarios", {
      data: { name: `E2E CH4OS ${Date.now()}`, modelId: "max-coverage-us", inputs: maxCoverageInputs({ objective: undefined }) },
    });
    expect(create.status()).toBe(201);
    const id = String((await create.json()).id);
    const state: { seeded: Record<string, unknown> | null } = { seeded: null };

    try {
      expect(await storedObjective(page, id)).toBeUndefined();   // stored ABSENT (spec §3)
      await installSolveStubs(page, id, state);
      await page.goto(`/chapter-4?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-optimization-parameters").click();

      // ── Unchosen: nothing selected, Solve blocked from the local draft ──
      await expect(page.getByTestId("objective-select")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("objective-coverage")).not.toBeChecked({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("objective-min-distance")).not.toBeChecked({ timeout: HEADER_TIMEOUT });
      const line = page.getByTestId("derived-model-line");
      await expect(line).toHaveText("Choose an objective to solve.", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-run-optimizer")).toBeDisabled();
      await expect(page.getByTestId("button-run-optimizer")).toHaveAttribute("title", HINT);

      // ── Max coverage (Model 1) ──────────────────────────────────────────
      await page.getByTestId("objective-coverage").check();
      await expect(line).toHaveText("Model 1 — maximize demand within 450 mi, holding average distance at or under 650 mi", { timeout: HEADER_TIMEOUT });
      state.seeded = SEEDED_MODEL1;
      await solveSeeded(page);
      expect(await storedObjective(page, id)).toBe("coverage");     // save-before-solve hit the real API
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("70.42 %", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-max-coverable-demand")).toHaveCount(0);

      // ── Min distance (Model 2) ──────────────────────────────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("objective-min-distance").check();
      await expect(line).toHaveText("Model 2 — minimize average distance, holding average distance at or under 650 mi", { timeout: HEADER_TIMEOUT });
      state.seeded = SEEDED_MODEL2;
      await solveSeeded(page);
      expect(await storedObjective(page, id)).toBe("min_distance");
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("demand-mi", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-coverage-pct")).toContainText("67.09 %");

      // ── Floor above Model 1's max → sequential → floor-exceeds-max alert ─
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("input-coverage-floor").fill("500100100");
      await expect(page.getByTestId("objective-select")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(line).toHaveText(
        "Model 1, then Model 2 — find the maximum demand coverable within 450 mi, then minimize average distance covering at least 500,100,100, holding average distance at or under 650 mi",
        { timeout: HEADER_TIMEOUT },
      );
      state.seeded = SEEDED_TOO_HIGH;
      await solveSeeded(page);
      expect(await storedObjective(page, id)).toBe("min_distance");  // server normalises a positive floor
      const mapAlert = page.getByTestId("floor-exceeds-max-alert");
      await expect(mapAlert).toContainText("Coverage floor 500,100,100 exceeds the maximum coverable demand 54,946,145.", { timeout: HEADER_TIMEOUT });
      await expect(mapAlert).toContainText("Lower the floor to at most 54,946,145.");
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("floor-exceeds-max-alert")).toContainText("sites DAL, LA, PIT", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-value-objective")).toHaveText("No incumbent");
      await expect(page.getByTestId("cost-summary-max-coverable-demand")).toHaveText("54,946,145");
      await expect(page.getByTestId("cost-summary-value-avg-distance-to-customers")).toHaveText("—");

      // ── Floor back to 0: Solve gates on the LOCAL draft, not the saved row ─
      // The saved objective is still "min_distance" (server-normalised above),
      // yet the zero-floor draft has no choice made, so Solve is blocked.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("input-coverage-floor").fill("0");
      await expect(page.getByTestId("objective-select")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("objective-coverage")).not.toBeChecked({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("objective-min-distance")).not.toBeChecked({ timeout: HEADER_TIMEOUT });
      await expect(line).toHaveText("Choose an objective to solve.", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-run-optimizer")).toBeDisabled({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-run-optimizer")).toHaveAttribute("title", HINT);
      expect(await storedObjective(page, id)).toBe("min_distance");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
