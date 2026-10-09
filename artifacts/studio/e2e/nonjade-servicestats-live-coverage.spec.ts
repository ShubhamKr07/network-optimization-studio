/**
 * Browser E2E — Non-JADE ServiceStats live coverage QA (SSC-T1 task T2).
 *
 * Real-browser Playwright coverage for
 * `docs/superpowers/specs/2026-09-18-nonjade-servicestats-live-coverage-design.md`
 * §6 / `docs/superpowers/plans/2026-09-18-nonjade-servicestats-live-coverage.md`
 * task T2: post-solve, editing distance bands WITHOUT re-solving must
 * re-bucket the ServiceStats coverage bars LIVE (matching the Output Map's
 * already-live band lens).
 *
 * CH4O-12 (ch4-model-upgrade, Task 12) — check 3 below used to be a
 * RETIRED/commented-out NEGATIVE block: under the (now-deleted) two-step
 * workflow, a `highServiceDistMi` edit against an already-solved Chapter 4
 * scenario raised a freeze-confirm dialog that CLEARED the result on
 * accept, making "the bars didn't move" structurally unprovable (no stable
 * snapshot left to diff against). That workflow — and the freeze-confirm
 * dialog — is gone entirely (CH4O-2/CH4O-7). More importantly, the
 * NEGATIVE premise itself is now FALSE: `Workspace.tsx`'s own comment at
 * the `ServiceStatsTab` call site (search "Task 14 Step C") records that
 * the Chen carve-out was REMOVED — `presentationBands={activeBandLens}` is
 * wired for max-coverage-us exactly like its five siblings now ("Chen now
 * computes live like its five siblings, cumulative + overflow labels...
 * from the SAME dedicated band lens every other live-band surface on this
 * page reads"). So check 3 is rewritten here as a third POSITIVE case,
 * mirroring check 1's single-echelon shape (max-coverage-us has no `leg`
 * on its edges either) — not redirected to a weaker "band-chip edits don't
 * move it" claim, because the live-recompute property is simply real now.
 *
 * Three checks, all positive, all single/two-echelon shape-appropriate:
 *   1. `p-median-us` (single-echelon, no `leg` on edges) — coverage
 *      recomputed over ALL edges; an explicit `> maxBoundary` overflow row
 *      appears once bands are edited to force out-of-range flow, and the
 *      Output Map's route colors agree with the bars' band/overflow split.
 *   2. `two-echelon-gold-au` (two-echelon) — coverage recomputed over
 *      `refinery_to_customer` OUTBOUND edges only; the inbound
 *      `mine_to_refinery` edge is proven excluded by choosing a boundary
 *      that lands strictly between the two legs' real distances (all
 *      refinery→customer edges in-band, the mine→refinery edge alone
 *      overflow) — if the inbound leg leaked into the coverage calc, the
 *      bars would show nonzero overflow; they must show exactly 0%.
 *   3. `max-coverage-us` (Chapter 4, single-echelon, mi-canonical post
 *      CH4O-8) — same single-echelon shape as check 1: coverage recomputed
 *      LIVE over ALL edges on a band edit, no re-solve. CH4O-10 moved
 *      Chen's own coverage-%/covered-demand KPIs onto Solution Summary, so
 *      this check's ServiceStats assertions are band-graph-only (the
 *      generic cumulative-coverage-bar rows every distance-band model has)
 *      — never the Chen-specific KPIs, which this tab no longer renders at
 *      all.
 *
 * Every check also asserts ZERO `/solve` or `/solve-jobs` network calls
 * fire anywhere in the edit+navigate sequence — this is a pure client-side
 * recompute, never a re-solve.
 *
 * Target: E2E_BASE_URL env var, requires the local dev proxy — see
 * CLAUDE.md's "Local dev DB"/"To run e2e locally" recipe. `labs.spec.ts` is
 * excluded globally by playwright.config.ts.
 */
import { test, expect, type Page } from "./fixtures";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;

// ── Shared helpers (mirrors e2e/jade-ch9-workspace-bundle.spec.ts) ─────────

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
 * endpoint (`POST .../solve`, `GET .../solve-jobs/:jobId`) — used to prove a
 * band edit causes ZERO solve network calls. */
function makeSolveCallTracker(page: Page) {
  const urls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/\/scenarios\/\d+\/solve(-jobs)?(\/|$|\?)/.test(url)) urls.push(url);
  });
  return { count: () => urls.length, urls };
}

async function solveViaApi(page: Page, scenarioId: number): Promise<void> {
  const solveResp = await page.request.post(`/api/scenarios/${scenarioId}/solve`);
  expect(solveResp.status()).toBe(202);
  const { jobId } = await solveResp.json();
  let status = "queued";
  for (let i = 0; i < 120 && (status === "queued" || status === "running"); i++) {
    await page.waitForTimeout(500);
    const pollResp = await page.request.get(`/api/scenarios/${scenarioId}/solve-jobs/${jobId}`);
    status = (await pollResp.json()).status;
  }
  expect(status).toBe("succeeded");
}

interface ResultEdge {
  fromId: string;
  toId: string;
  distance: number;
  flow: number;
  leg?: string | null;
}
interface ScenarioResult {
  edges: ResultEdge[];
}

async function getScenarioResult(page: Page, id: number): Promise<ScenarioResult> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.result).not.toBeNull();
  return body.result as ScenarioResult;
}

/** Replaces the current chip-editor distance bands (p-median-us /
 * two-echelon-gold-au / max-coverage-us all use this shared chip editor —
 * only `two-echelon-jade-us` uses the fixed-4-slot JadeBandEditor) with a
 * fresh set: adds each of `newBands` one at a time via the "+ Add" flow
 * FIRST, then removes every chip in `currentBands` that isn't also a target
 * band (see the inline rationale below for why add-then-remove, not
 * remove-then-add). Caller must already be on the Optimization Parameters
 * tab. */
async function replaceBandsViaChipEditor(page: Page, currentBands: number[], newBands: number[]): Promise<void> {
  // Add the new band(s) FIRST, then remove the old ones. The chip editor
  // enforces a last-boundary guard (at least one band must always remain —
  // its remove button is `disabled`, not absent, once only one band is
  // left). Removing old bands first means the LAST old band's remove button
  // is visible-but-disabled, and a plain `isVisible()` guard doesn't catch
  // that: `.click()` on a disabled target has no explicit timeout, so it
  // silently inherits the whole remaining test budget and only surfaces (as
  // a confusing failure) wherever the test happens to hit its next await —
  // often an unrelated `finally`-block cleanup call. Adding first guarantees
  // band count is always >= 2 while removing old ones, so the guard never
  // engages during removal.
  //
  // A `newBands` value that already exists in `currentBands` (coincidence,
  // not the common case, but real for check 2 below — BOUNDARY=1000 is
  // chosen for its distance-range meaning and happens to already be one of
  // the model's default bands) must be handled explicitly: adding it is a
  // no-op (the chip already exists), and removing it during the "old bands"
  // cleanup would delete the very value this call is trying to establish.
  // Skip both sides of the overlap so the final set is exactly `newBands`.
  const currentSet = new Set(currentBands);
  const newSet = new Set(newBands);
  for (const b of newBands) {
    if (currentSet.has(b)) continue; // already present as an old band — no-op
    await page.getByTestId("button-bands-plus").click();
    await page.getByTestId("input-new-band").fill(String(b));
    await page.getByTestId("button-add-band-confirm").click();
  }
  for (const b of currentBands) {
    if (newSet.has(b)) continue; // also a target band — keep it, don't remove
    const chip = page.getByTestId(`button-remove-band-${b}`);
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
    }
  }
}

function parsePercent(text: string): number {
  const m = text.match(/(\d+)%/);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

// ── Check 1: p-median-us (single-echelon) ──────────────────────────────────

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
    data: { name: `E2E SSC-T1 PMedian ${Date.now()}`, modelId: "p-median-us", inputs: pMedianInputs() },
  });
  expect(resp.status()).toBe(201);
  return Number((await resp.json()).id);
}

test.describe("Non-JADE ServiceStats live coverage — p-median-us (single-echelon)", () => {
  test("band edit re-buckets bars live over ALL edges, adds overflow row, no solve call, map agrees", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page, "ssc-pmedian");
    const id = await createPMedianScenario(page);

    try {
      await solveViaApi(page, id);
      const solvedResult = await getScenarioResult(page, id);
      // Deterministic pre-check: with p=3 open facilities across 200
      // continental-US customers, some real assignment distance must
      // exceed a tiny 5-mi boundary (used below to force an explicit
      // overflow row). Coverage % is FLOW-weighted (computeCumulativeBand
      // Coverage sums each edge's `flow`/demand, not a plain edge count —
      // bands.ts's own doc comment), so the expected percentages below are
      // computed the same way, not by counting edges.
      const TINY_BOUNDARY = 5;
      const overflowEdges = solvedResult.edges.filter((e) => e.distance > TINY_BOUNDARY);
      const inBandEdges = solvedResult.edges.filter((e) => e.distance <= TINY_BOUNDARY);
      expect(overflowEdges.length).toBeGreaterThan(0);
      const totalFlow = solvedResult.edges.reduce((s, e) => s + e.flow, 0);
      const overflowFlow = overflowEdges.reduce((s, e) => s + e.flow, 0);
      const inBandFlow = inBandEdges.reduce((s, e) => s + e.flow, 0);
      const expectedOverflowCount = overflowEdges.length;
      const expectedInBandCount = inBandEdges.length;

      await page.goto(`/chapter-3?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const solveCalls = makeSolveCallTracker(page);

      // ── Baseline: Service Stats bars reflect the solved (default) bands,
      // no overflow row shown (all 4 default bands present, no -1 row is
      // asserted implicitly by the absence check below). ───────────────────
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.getByTestId("service-stats-band-200")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("service-stats-band--1")).toHaveCount(0);

      // ── Edit bands post-solve, WITHOUT saving/re-solving ────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("optimization-parameters-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await replaceBandsViaChipEditor(page, [200, 400, 800, 1600], [TINY_BOUNDARY]);
      // Genuinely unsaved — proves this is a live client-side lens, not a
      // silently-applied save.
      await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const callsBeforeCheck = solveCalls.count();

      // ── Service Stats: explicit overflow row appears, matches the
      // deterministic edge-level count computed above ────────────────────
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.getByTestId("service-stats-band-5")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const overflowRow = page.getByTestId("service-stats-band--1");
      await expect(overflowRow).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(overflowRow).toContainText(`> ${TINY_BOUNDARY} mi`);
      const overflowPct = parsePercent(await overflowRow.innerText());
      const inBandPct = parsePercent(await page.getByTestId("service-stats-band-5").innerText());
      const expectedOverflowPct = Math.round((overflowFlow * 100) / totalFlow);
      const expectedInBandPct = Math.round((inBandFlow * 100) / totalFlow);
      expect(overflowPct).toBe(expectedOverflowPct);
      expect(inBandPct).toBe(expectedInBandPct);
      expect(overflowPct).toBeGreaterThan(0);

      // ── Output Map: legend + route colors agree with the bars ───────────
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.locator('[data-testid^="legend-band-"]')).toHaveCount(1);
      await expect(page.getByTestId("legend-overflow-band")).toBeVisible();
      const routePaths = page.locator(".leaflet-route-pane path");
      await expect(routePaths.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await routePaths.count()).toBe(solvedResult.edges.length);
      const overflowPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-overflow)"]');
      const bandZeroPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-0)"]');
      await expect(overflowPaths).toHaveCount(expectedOverflowCount);
      await expect(bandZeroPaths).toHaveCount(expectedInBandCount);

      // ── Zero solve/solve-job network calls anywhere in this sequence ────
      expect(solveCalls.count()).toBe(callsBeforeCheck);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ── Check 2: two-echelon-gold-au (two-echelon) ──────────────────────────────

function twoEchelonInputs() {
  return {
    bomRatio: 1.1, // customer-adjacent (Cunnamulla) golden default
    refineryOverrides: [],
    customerOverrides: [],
    distanceBands: [500, 1000, 1500, 2000, 2600],
    gap: 0,
    timeLimitSec: 120,
  };
}

async function createTwoEchelonScenario(page: Page): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E SSC-T1 TwoEchelon ${Date.now()}`, modelId: "two-echelon-gold-au", inputs: twoEchelonInputs() },
  });
  expect(resp.status()).toBe(201);
  return Number((await resp.json()).id);
}

test.describe("Non-JADE ServiceStats live coverage — two-echelon-gold-au (outbound leg only)", () => {
  test("band edit re-buckets bars live over refinery_to_customer edges ONLY (mine_to_refinery excluded), no solve call, map agrees", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page, "ssc-twoechelon");
    const id = await createTwoEchelonScenario(page);

    try {
      await solveViaApi(page, id);
      const solvedResult = await getScenarioResult(page, id);

      const outboundEdges = solvedResult.edges.filter((e) => e.leg === "refinery_to_customer");
      const inboundEdges = solvedResult.edges.filter((e) => e.leg === "mine_to_refinery");
      expect(outboundEdges.length).toBeGreaterThan(0);
      expect(inboundEdges.length).toBe(1); // single-refinery-open binary

      // Ground-truth (dataset/distances.json, default BOM 1.1 -> Cunnamulla
      // opens): every refinery->customer distance is ~531-909 mi, the
      // single mine->refinery (Kalgoorlie->Cunnamulla) distance is
      // ~1464.5 mi. A boundary strictly between those two ranges makes
      // every outbound edge in-band and the one inbound edge overflow — if
      // ServiceStats wrongly included the inbound leg, the bars would show
      // nonzero overflow; the correct (outbound-only) behavior is exactly
      // 0% overflow.
      const BOUNDARY = 1000;
      expect(outboundEdges.every((e) => e.distance <= BOUNDARY)).toBe(true);
      expect(inboundEdges.every((e) => e.distance > BOUNDARY)).toBe(true);

      await page.goto(`/chapter-10/gold-refinery?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const solveCalls = makeSolveCallTracker(page);

      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("optimization-parameters-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await replaceBandsViaChipEditor(page, [500, 1000, 1500, 2000, 2600], [BOUNDARY]);
      await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const callsBeforeCheck = solveCalls.count();

      // ── Service Stats: 100% in-band, overflow row ABSENT ENTIRELY —
      // proves the inbound mine_to_refinery edge is excluded from the
      // coverage calc. `computeCumulativeBandCoverage` (lib/bands.ts)
      // deliberately omits the overflow row altogether when overflow flow
      // is exactly 0 ("Omits the overflow row entirely when there is
      // none... rather than emitting a spurious 0% row") — if the inbound
      // leg had leaked into the coverage calc, its distance (~1464.5 mi,
      // > BOUNDARY) would make overflow flow nonzero and the row WOULD
      // render. ────────────────────────────────────────────────────────
      await page.getByTestId("sidebar-output-service-stats").click();
      const bandRow = page.getByTestId(`service-stats-band-${BOUNDARY}`);
      await expect(bandRow).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(parsePercent(await bandRow.innerText())).toBe(100);
      await expect(page.getByTestId("service-stats-band--1")).toHaveCount(0);

      // ── Output Map agreement: the map draws BOTH legs (it has no
      // outbound-only filter — that's ServiceStats' own scoping choice), so
      // the 10 refinery->customer routes should be band-0 colored while the
      // 1 mine->refinery route is overflow-colored. This proves the bars'
      // "0% overflow" isn't a fluke: the map independently confirms the
      // outbound edges are genuinely in-band while the excluded inbound
      // edge genuinely is overflow. ─────────────────────────────────────
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("legend-overflow-band")).toBeVisible();
      const routePaths = page.locator(".leaflet-route-pane path");
      await expect(routePaths.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await routePaths.count()).toBe(solvedResult.edges.length);
      const overflowPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-overflow)"]');
      const bandZeroPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-0)"]');
      await expect(overflowPaths).toHaveCount(inboundEdges.length);
      await expect(bandZeroPaths).toHaveCount(outboundEdges.length);

      expect(solveCalls.count()).toBe(callsBeforeCheck);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ── Check 3: max-coverage-us (single-echelon, like p-median-us) ────────────
//
// CH4O-12 — this used to be a retired NEGATIVE block (see the file's own
// header comment for the full history). It is now a real POSITIVE check,
// structurally identical to check 1: max-coverage-us is single-echelon (no
// `leg` on its edges), and `Workspace.tsx` wires `presentationBands` for it
// exactly like every sibling model since the Chen carve-out was removed
// (Task 14 Step C). CH4O-10 moved Chen's own coverage-%/covered-demand/
// high-service-cutoff KPIs onto Solution Summary, so — per this file's own
// "band-graph-only" framing — this check's ServiceStats assertions touch
// only the generic cumulative-coverage-bar rows every distance-band model
// shares, never a Chen-specific KPI (there isn't one left on this tab to
// assert against).

function maxCoverageInputs() {
  // CH4O-8's round teaching defaults (test_max_coverage.py::BASE) — NO
  // `objective` key (CH4O-5: server-owned, 4xx if sent at all).
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

async function createMaxCoverageScenario(page: Page): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E SSC-T1 MaxCoverage ${Date.now()}`, modelId: "max-coverage-us", inputs: maxCoverageInputs() },
  });
  expect(resp.status()).toBe(201);
  return Number((await resp.json()).id);
}

test.describe("Non-JADE ServiceStats live coverage — max-coverage-us (single-echelon, like p-median-us)", () => {
  test("band edit re-buckets bars live over ALL edges, adds overflow row, no solve call, map agrees", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page, "ssc-maxcoverage");
    const id = await createMaxCoverageScenario(page);

    try {
      await solveViaApi(page, id);
      const solvedResult = await getScenarioResult(page, id);
      // Deterministic pre-check, same shape as check 1: with p=3 open
      // facilities {DAL, LA, PIT} (test_max_coverage.py::test_coverage_golden),
      // some real assignment distance must exceed a tiny 5-mi boundary.
      // Coverage % here is FLOW-weighted too (computeCumulativeBandCoverage
      // sums each edge's `flow`, not a plain edge count), so the expected
      // percentages below are computed the same way.
      const TINY_BOUNDARY = 5;
      const overflowEdges = solvedResult.edges.filter((e) => e.distance > TINY_BOUNDARY);
      const inBandEdges = solvedResult.edges.filter((e) => e.distance <= TINY_BOUNDARY);
      expect(overflowEdges.length).toBeGreaterThan(0);
      expect(inBandEdges.length).toBeGreaterThan(0);
      const totalFlow = solvedResult.edges.reduce((s, e) => s + e.flow, 0);
      const overflowFlow = overflowEdges.reduce((s, e) => s + e.flow, 0);
      const inBandFlow = inBandEdges.reduce((s, e) => s + e.flow, 0);
      const expectedOverflowCount = overflowEdges.length;
      const expectedInBandCount = inBandEdges.length;

      await page.goto(`/chapter-4?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const solveCalls = makeSolveCallTracker(page);

      // ── Baseline: Service Stats bars reflect the solved (default) bands,
      // no overflow row shown. ─────────────────────────────────────────
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.getByTestId("service-stats-band-450")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("service-stats-band--1")).toHaveCount(0);

      // ── Edit bands post-solve, WITHOUT saving/re-solving ────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("optimization-parameters-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await replaceBandsViaChipEditor(page, [450, 900, 1800, 3400], [TINY_BOUNDARY]);
      // Genuinely unsaved — proves this is a live client-side lens, not a
      // silently-applied save.
      await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const callsBeforeCheck = solveCalls.count();

      // ── Service Stats: explicit overflow row appears, matches the
      // deterministic edge-level count computed above. This is the generic
      // band-graph row set only — CH4O-10 moved Chen's coverage-%/
      // covered-demand/high-service-cutoff KPIs onto Solution Summary, and
      // this tab never renders them at all any more. ─────────────────────
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.getByTestId("service-stats-band-5")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const overflowRow = page.getByTestId("service-stats-band--1");
      await expect(overflowRow).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(overflowRow).toContainText(`> ${TINY_BOUNDARY} mi`);
      const overflowPct = parsePercent(await overflowRow.innerText());
      const inBandPct = parsePercent(await page.getByTestId("service-stats-band-5").innerText());
      const expectedOverflowPct = Math.round((overflowFlow * 100) / totalFlow);
      const expectedInBandPct = Math.round((inBandFlow * 100) / totalFlow);
      expect(overflowPct).toBe(expectedOverflowPct);
      expect(inBandPct).toBe(expectedInBandPct);
      expect(overflowPct).toBeGreaterThan(0);

      // ── Output Map: legend + route colors agree with the bars ───────────
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.locator('[data-testid^="legend-band-"]')).toHaveCount(1);
      await expect(page.getByTestId("legend-overflow-band")).toBeVisible();
      const routePaths = page.locator(".leaflet-route-pane path");
      await expect(routePaths.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await routePaths.count()).toBe(solvedResult.edges.length);
      const overflowPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-overflow)"]');
      const bandZeroPaths = page.locator('.leaflet-route-pane path[stroke="var(--band-0)"]');
      await expect(overflowPaths).toHaveCount(expectedOverflowCount);
      await expect(bandZeroPaths).toHaveCount(expectedInBandCount);

      // ── Zero solve/solve-job network calls anywhere in this sequence ────
      expect(solveCalls.count()).toBe(callsBeforeCheck);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
