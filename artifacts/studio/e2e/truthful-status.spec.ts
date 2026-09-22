/**
 * Browser E2E — QA gate for the SCND Correctness Option-B slice (task B5).
 *
 * B1-B4 built a truthful solve-outcome contract end to end: solve.py's
 * captured-CBC-log classifier (B1/B2) emits real `solutionStatus`/
 * `terminationReason`/`achievedGap` instead of a hardcoded "optimal";
 * OpenAPI/Zod carry it plus a legacy-unverified read-path guard (B3);
 * `quality.ts`'s `qualityStatement()` + `Studio.tsx`'s `classifyResultOutcome()`
 * render it as 7 distinct outcomes (B4).
 *
 * This file has two independent halves:
 *
 *  1. "backend contract" - proves, via a REAL browser driving a REAL solve
 *     through the Run-Optimizer dialog (not a mocked/unit call), that the
 *     API-level `solutionStatus`/`terminationReason`/`achievedGap`/`status`
 *     fields genuinely differ between a gap-limited feasible stop and a
 *     proven-optimal one. This is real, currently-passing coverage of B1-B3.
 *
 *  2. "Workspace UI rendering" - attempts the literal B5 DoD (a real user,
 *     looking at the live app, sees the distinction) and finds a REAL,
 *     CONFIRMED, still-open gap: every chapter route is `workspace: true`
 *     (chapters.ts / App.tsx's `Gate()`), so `Studio.tsx` - the only file
 *     B4 actually wired `classifyResultOutcome()`/`qualityStatement()` into
 *     - is dead code, unreachable from any route. The live Workspace app's
 *     ONLY quality-indicator text is `CostSummaryTab.tsx`'s "Quality" row
 *     (`data-testid="cost-summary-value-quality"`), which still renders
 *     `result.quality` verbatim - solve.py's raw, UNCHANGED-by-B1-B4 PuLP
 *     `cbc.lpStatus` string ("Optimal" whenever CBC returns a feasible
 *     incumbent, gap-limited or truly proven, no distinction possible; see
 *     cbc_termination.py's own module docstring, which names this exact
 *     conflation as the historical defect). Confirmed empirically against
 *     real local dev servers before this file was written: a Brazil
 *     P=5/cap=20M/gap=0.05 solve (solutionStatus="feasible",
 *     terminationReason="gap_limit", achievedGap=0.0019 - a genuine
 *     gap-limited stop per DEC-2026-09-21-01/test_truthful_status.py's own
 *     golden) still shows "Optimal" in the live Solution Summary tab -
 *     textually IDENTICAL to a genuinely proven solve. B4's own commit
 *     message asserted "Workspace's output tabs render no status/quality UI
 *     to update" - that premise is factually wrong; the UI exists, it is
 *     just still wired to the old field.
 *
 *     This second describe block is marked `test.fail()` (Playwright's
 *     "expected to fail" annotation, NOT `.skip()`): it runs for real every
 *     time, is reported as a pass while it fails for the documented reason
 *     above, and - critically - Playwright will flag it as an UNEXPECTED
 *     PASS the moment someone wires `qualityStatement()` (or equivalent)
 *     into `CostSummaryTab.tsx`, forcing the `test.fail()` marker to be
 *     removed rather than silently rotting. This is a deliberate choice NOT
 *     to weaken the assertions to match today's wrong behavior (this repo's
 *     "never quiet a failing test to make a gate green" rule) and NOT to
 *     hide the gap behind `.skip()` (which would report nothing at all).
 *     Fixing `CostSummaryTab.tsx` is out of scope for this QA task (frontend
 *     product code, not an e2e spec) - see the B5 QA report for the full
 *     write-up and recommended follow-up.
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

test.describe("B5 truthful-status QA — Workspace UI rendering (KNOWN GAP, tracked via test.fail)", () => {
  test("Solution Summary 'Quality' distinguishes a gap-limited feasible outcome from a proven-optimal one", async ({ page }) => {
    test.setTimeout(300_000);
    // KNOWN, CONFIRMED-LIVE GAP (not environmental flake, not a guess): B4
    // wired `classifyResultOutcome()`/`qualityStatement()` into `Studio.tsx`
    // only, which is unreachable in production (every chapter is
    // `workspace: true` in chapters.ts -> App.tsx's Gate() always renders
    // Workspace). Workspace's only quality-indicator text,
    // `CostSummaryTab.tsx`'s "Quality" row, still renders `result.quality`
    // (solve.py's raw PuLP `cbc.lpStatus`, unchanged since before B1) -
    // "Optimal" for BOTH a gap-limited and a proven solve, with zero
    // distinction. See this file's header comment + the B5 QA report for
    // the full write-up. Remove this `test.fail()` once CostSummaryTab.tsx
    // (or equivalent) is wired to the truthful `terminationReason`/
    // `achievedGap` fields already correctly carried by the API (proven by
    // the sibling describe block above) - at that point this test will
    // start passing for real.
    test.fail(true, "CostSummaryTab.tsx's Quality row still renders solve.py's raw PuLP status, not the truthful terminationReason/achievedGap B1-B4 built — see file header + B5 QA report");

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
