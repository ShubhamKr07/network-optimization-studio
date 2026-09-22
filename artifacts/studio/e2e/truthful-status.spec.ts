/**
 * Browser E2E — QA gate for the SCND Correctness Option-B slice (tasks B5 +
 * B4.1).
 *
 * B1-B4 built a truthful solve-outcome contract end to end: solve.py's
 * captured-CBC-log classifier (B1/B2) emits real `solutionStatus`/
 * `terminationReason`/`achievedGap` instead of a hardcoded "optimal";
 * OpenAPI/Zod carry it plus a legacy-unverified read-path guard (B3);
 * `quality.ts`'s `qualityStatement()` + `@/lib/resultOutcome`'s
 * `classifyResultOutcome()` render it as 7 distinct outcomes (B4).
 *
 * This file has two independent halves:
 *
 *  1. "backend contract" - proves, via a REAL browser driving a REAL solve
 *     through the Run-Optimizer dialog (not a mocked/unit call), that the
 *     API-level `solutionStatus`/`terminationReason`/`achievedGap`/`status`
 *     fields genuinely differ between a gap-limited feasible stop and a
 *     proven-optimal one. This is real, currently-passing coverage of B1-B3.
 *
 *  2. "Workspace UI rendering" - the literal B5 DoD (a real user, looking at
 *     the live app, sees the distinction). B5's original QA pass found a
 *     REAL, CONFIRMED gap here: every chapter route is `workspace: true`
 *     (chapters.ts / App.tsx's `Gate()`), so B4's original
 *     `classifyResultOutcome()`/`qualityStatement()` wiring — built only
 *     into `Studio.tsx` — was dead code, unreachable from any route. The
 *     live Workspace app's ONLY quality-indicator text,
 *     `CostSummaryTab.tsx`'s "Quality" row
 *     (`data-testid="cost-summary-value-quality"`), still rendered
 *     `result.quality` verbatim — solve.py's raw PuLP `cbc.lpStatus` string
 *     ("Optimal" whenever CBC returns a feasible incumbent, gap-limited or
 *     truly proven, no distinction possible). B4.1 fixed this: the same
 *     `classifyResultOutcome()`/`qualityStatement()` logic was extracted to
 *     the shared `@/lib/resultOutcome` module and wired into
 *     `CostSummaryTab.tsx` (both the single-result "Quality" row and the
 *     compare-mode per-column "Quality" row) via a new `resultQualityText()`
 *     helper. This describe block's `test.fail()` marker has been removed —
 *     it now asserts the real, live, truthful distinction.
 *
 * Each test registers its own disposable account and cleans up its own
 * scenario(s) in a `finally` block, matching this repo's established e2e
 * convention (see chens-cosmetics.spec.ts / chen-bands-units-qa.spec.ts).
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 200_000;

interface ScenarioResult {
  status: string;
  solutionStatus: string | null;
  terminationReason: string | null;
  achievedGap: number | null;
  objective: number;
  quality: string;
}

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-truthfulstatus-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Exact `e2e_accuracy.py` Brazil BASE dict + P=5/cap=20M - the same real,
 * committed CBC gap-limited stop `test_truthful_status.py`'s
 * `TestGapStoppedSolve` golden proves at the solver layer directly
 * (solutionStatus="feasible", terminationReason="gap_limit", a real
 * achievedGap strictly between 0 and the requested 0.05). Deterministic,
 * not a flaky near-miss - this exact (p, capacity, gap) combination is
 * already the sacred test's own DEC-2026-09-21-01-corrected assertion. */
function brazilGapLimitedInputs() {
  return {
    p: 5,
    capacityMode: "uniform",
    uniformCapacity: 20_000_000,
    warehouseOverrides: [],
    customerOverrides: [],
    distanceBands: [500, 1000, 2000, 4000],
    gap: 0.05,
    timeLimitSec: 180,
    singleSource: false,
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
  };
}

/** p-median-us, P=3, gap=0 - matches `test_truthful_status.py`'s
 * `TestProvenSolve` golden exactly (solutionStatus="optimal",
 * terminationReason="optimality_proven", achievedGap=null). Small dataset,
 * gap=0 leaves CBC no tolerance to exploit, so it proves optimality fast
 * (well under a second of solver time - the "fast gap=0 model" B5 asks for). */
function provenPMedianInputs() {
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

async function createScenario(page: Page, modelId: string, chapterPath: string, inputs: unknown): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E truthful-status ${modelId} ${Date.now()}`, modelId, inputs },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`${chapterPath}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

async function getScenario(page: Page, id: string): Promise<{ solvedAt: string | null; result: ScenarioResult | null }> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  return resp.json();
}

/** Trigger a real solve via the Run Optimizer dialog (a real CBC subprocess,
 * not mocked), then poll until `solvedAt` advances past `before` - the same
 * precise-completion signal `chens-cosmetics.spec.ts`/
 * `chen-bands-units-qa.spec.ts` use. Deliberately does NOT assert
 * `result.status === "optimal"` (unlike those files' helpers) - the whole
 * point here is that a gap-limited Brazil solve truthfully reports
 * `status: "feasible"`, not `"optimal"`. */
async function solveViaUi(page: Page, id: string): Promise<ScenarioResult> {
  const before = (await getScenario(page, id)).solvedAt;
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });

  let fresh: ScenarioResult | null = null;
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
  return fresh!;
}

test.describe("B5 truthful-status QA — backend contract (real browser, real CBC solve)", () => {
  test("Brazil gap=0.05 (P=5, cap=20M) truthfully reports a gap-limited feasible stop; p-median-us gap=0 truthfully reports a proven optimum", async ({ page }) => {
    test.setTimeout(300_000);
    await registerAndGoHome(page);

    const brazilId = await createScenario(page, "p-median-brazil", "/chapter-5/brazil", brazilGapLimitedInputs());
    try {
      const brazil = await solveViaUi(page, brazilId);
      // The exact, verified-live-in-this-session defect the whole B-plan
      // exists to eliminate: the legacy `status` field must NEVER read
      // "optimal" for a stop CBC did not actually prove.
      expect(brazil.status).toBe("feasible");
      expect(brazil.status).not.toBe("optimal");
      expect(brazil.solutionStatus).toBe("feasible");
      expect(brazil.terminationReason).toBe("gap_limit");
      expect(brazil.achievedGap).not.toBeNull();
      expect(brazil.achievedGap as number).toBeGreaterThan(0);
      expect(brazil.achievedGap as number).toBeLessThan(0.05);
      expect(brazil.objective).toBeGreaterThan(0);
    } finally {
      await page.request.delete(`/api/scenarios/${brazilId}`);
    }

    const pmId = await createScenario(page, "p-median-us", "/chapter-3", provenPMedianInputs());
    try {
      const pm = await solveViaUi(page, pmId);
      expect(pm.status).toBe("optimal");
      expect(pm.solutionStatus).toBe("optimal");
      expect(pm.terminationReason).toBe("optimality_proven");
      expect(pm.achievedGap).toBeNull();
      expect(pm.objective).toBeGreaterThan(0);
    } finally {
      await page.request.delete(`/api/scenarios/${pmId}`);
    }
  });
});

test.describe("B4.1 truthful-status QA — Workspace UI rendering (live, fixed)", () => {
  test("Solution Summary 'Quality' distinguishes a gap-limited feasible outcome from a proven-optimal one", async ({ page }) => {
    test.setTimeout(300_000);

    await registerAndGoHome(page);

    const brazilId = await createScenario(page, "p-median-brazil", "/chapter-5/brazil", brazilGapLimitedInputs());
    let brazilQualityText: string;
    try {
      await solveViaUi(page, brazilId);
      await page.getByTestId("sidebar-output-cost-summary").click();
      const el = page.getByTestId("cost-summary-value-quality");
      await expect(el).toBeVisible({ timeout: HEADER_TIMEOUT });
      brazilQualityText = (await el.innerText()).trim();
    } finally {
      await page.request.delete(`/api/scenarios/${brazilId}`);
    }

    const pmId = await createScenario(page, "p-median-us", "/chapter-3", provenPMedianInputs());
    let pmQualityText: string;
    try {
      await solveViaUi(page, pmId);
      await page.getByTestId("sidebar-output-cost-summary").click();
      const el = page.getByTestId("cost-summary-value-quality");
      await expect(el).toBeVisible({ timeout: HEADER_TIMEOUT });
      pmQualityText = (await el.innerText()).trim();
    } finally {
      await page.request.delete(`/api/scenarios/${pmId}`);
    }

    // The literal B5 DoD: a within-gap/feasible outcome must read distinctly
    // from a proven-optimal one, and neither may claim "Optimal" verbatim
    // (today's unqualified, misleading text) for the gap-limited case.
    expect(brazilQualityText).not.toBe("Optimal");
    expect(brazilQualityText.toLowerCase()).toContain("feasible");
    expect(pmQualityText).toBe("Proven optimal");
    expect(brazilQualityText).not.toBe(pmQualityText);
  });
});
