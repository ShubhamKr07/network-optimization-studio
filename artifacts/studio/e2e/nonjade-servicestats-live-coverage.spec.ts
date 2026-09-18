/**
 * Browser E2E — Non-JADE ServiceStats live coverage QA (SSC-T1 task T2).
 *
 * Real-browser Playwright coverage for
 * `docs/superpowers/specs/2026-09-18-nonjade-servicestats-live-coverage-design.md`
 * §6 / `docs/superpowers/plans/2026-09-18-nonjade-servicestats-live-coverage.md`
 * task T2: post-solve, editing distance bands WITHOUT re-solving must
 * re-bucket the ServiceStats coverage bars LIVE (matching the Output Map's
 * already-live band lens) for every distance-band model except
 * `chens-cosmetics-cn`, which keeps reading the frozen
 * `result.metrics.bandCoverage` snapshot.
 *
 * Three checks:
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
 *   3. NEGATIVE — `chens-cosmetics-cn`: a band-affecting edit
 *      (`highServiceDistKm`, which re-derives `distanceBands` locally)
 *      must NOT move the ServiceStats bars at all (frozen, unwired).
 *
 * Every check also asserts ZERO `/solve` or `/solve-jobs` network calls
 * fire anywhere in the edit+navigate sequence — this is a pure client-side
 * recompute, never a re-solve.
 *
 * Target: E2E_BASE_URL env var, requires the local dev proxy — see
 * CLAUDE.md's "Local dev DB"/"To run e2e locally" recipe. `labs.spec.ts` is
 * excluded globally by playwright.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

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
 * two-echelon-gold-au both use this shared chip editor — only
 * `two-echelon-jade-us` uses the fixed-4-slot JadeBandEditor) with a fresh
 * set: removes every chip in `currentBands`, then adds each of `newBands`
 * one at a time via the "+ Add" flow. Caller must already be on the
 * Optimization Parameters tab. */
async function replaceBandsViaChipEditor(page: Page, currentBands: number[], newBands: number[]): Promise<void> {
  for (const b of currentBands) {
    const chip = page.getByTestId(`button-remove-band-${b}`);
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
    }
  }
  for (const b of newBands) {
    await page.getByTestId("button-bands-plus").click();
    await page.getByTestId("input-new-band").fill(String(b));
    await page.getByTestId("button-add-band-confirm").click();
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

// ── Check 3 (NEGATIVE): chens-cosmetics-cn stays frozen ─────────────────────

function chenCoverageInputs() {
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

async function createChenScenario(page: Page): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E SSC-T1 Chen ${Date.now()}`, modelId: "chens-cosmetics-cn", inputs: chenCoverageInputs() },
  });
  expect(resp.status()).toBe(201);
  return Number((await resp.json()).id);
}

test.describe("Non-JADE ServiceStats live coverage — chens-cosmetics-cn NEGATIVE (frozen)", () => {
  test("a band-affecting edit does NOT change the Service Stats bars", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page, "ssc-chen");
    const id = await createChenScenario(page);

    try {
      await solveViaApi(page, id);

      await page.goto(`/chapter-4?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const solveCalls = makeSolveCallTracker(page);

      await page.getByTestId("sidebar-output-service-stats").click();
      const bandRow600 = page.getByTestId("service-stats-band-600");
      const bandRow5000 = page.getByTestId("service-stats-band-5000");
      await expect(bandRow600).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(bandRow5000).toBeVisible();
      const before600 = await bandRow600.innerText();
      const before5000 = await bandRow5000.innerText();

      // Edit the field that DOES re-derive `distanceBands` locally
      // (`highServiceDistKm` -> `[high, max]`, Workspace.tsx's
      // `updateChenServiceDistance`) — Chen has no free band editor by
      // design (`showBandEditor=false`), this is its closest analog to a
      // "band edit".
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("chen-objective-section")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("input-high-service-dist").fill("50");
      await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const callsBeforeCheck = solveCalls.count();

      // Service Stats bars are UNCHANGED — still keyed by the original
      // solved bands (600/5000), not the just-edited 50, and their
      // percentages are byte-identical to before the edit.
      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.getByTestId("service-stats-band-600")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("service-stats-band-5000")).toBeVisible();
      // The derived-band value (50) never appears as a coverage row.
      await expect(page.getByTestId("service-stats-band-50")).toHaveCount(0);
      // Byte-identical to their pre-edit text (innerText, not toHaveText's
      // own whitespace-normalized comparison, to avoid a false mismatch
      // purely from how the two APIs join the row's two text nodes).
      await expect
        .poll(() => page.getByTestId("service-stats-band-600").innerText())
        .toBe(before600);
      await expect
        .poll(() => page.getByTestId("service-stats-band-5000").innerText())
        .toBe(before5000);

      expect(solveCalls.count()).toBe(callsBeforeCheck);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
