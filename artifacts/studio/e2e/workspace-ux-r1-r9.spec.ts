/**
 * Browser E2E — Workspace UX (R1–R9) bundle, Task T7 (QA).
 *
 * Live verification of what only a real browser can prove: R3's "markers
 * actually paint" (computed style, jsdom can't resolve CSS custom
 * properties/relative-color-syntax the way real Chromium does), R2's
 * quintile bubble sizing across the real 200-row p-median-us dataset, R5's
 * `displayedInputs` snapshot end-to-end through a real solve, R7's
 * closed-warehouse hiding against a real solved result, R1's blue/green
 * distinction, R4's Save placement, R6+R8's compare (incl. a non-facility
 * model's capability-gated row omission), and R9's label/unit.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerAndGoHome(page: Page, tag: string): Promise<void> {
  const email = `e2e-r1r9-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenarioApi(page: Page, modelId: string, name: string, inputs: Record<string, unknown>): Promise<number> {
  const resp = await page.request.post("/api/scenarios", { data: { name, modelId, inputs } });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

/** Solves a scenario purely via the API (no UI) and polls to completion —
 * used for the compare tests' SECOND scenario, where the point under test
 * is the compare table, not the solve flow itself (already covered by the
 * main test's real Run-Optimizer-driven solve). */
async function solveViaApi(page: Page, id: number): Promise<void> {
  const solveResp = await page.request.post(`/api/scenarios/${id}/solve`);
  expect(solveResp.status()).toBe(202);
  const { jobId } = await solveResp.json();
  for (let i = 0; i < 60; i++) {
    const jobResp = await page.request.get(`/api/scenarios/${id}/solve-jobs/${jobId}`);
    const job = await jobResp.json();
    if (job.status === "succeeded") return;
    if (job.status === "failed") throw new Error(`solve job ${jobId} failed`);
    await page.waitForTimeout(500);
  }
  throw new Error(`solve job ${jobId} did not complete in time`);
}

async function gotoScenario(page: Page, path: string, id: number): Promise<void> {
  await page.goto(`${path}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
}

test.describe("Workspace UX bundle (R1-R9)", () => {
  test("p-median-us: R1 green/blue, R2 quintile sizing + dim-but-in-scale excluded, R3 markers paint, R4 Save-in-Layers, R5 solve-input bands + displayedInputs, R7 hides closed WHs, R9 label/unit, R6+R8 facility compare", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page, "pmedian");

    // ALN forced-open + p=1 -> the solver opens EXACTLY ALN (clean R7 check).
    // ATL inactive (dashed marker, R3). C121 (real highest-demand customer in
    // the base dataset) excluded (dim-but-in-scale, R2).
    const id = await createScenarioApi(page, "p-median-us", `E2E R1-R9 main ${Date.now()}`, {
      p: 1,
      distanceBands: [250, 500, 750],
      capacityMode: "none",
      uniformCapacity: null,
      warehouseOverrides: [
        { id: "ALN", status: "forced_open" },
        { id: "ATL", status: "inactive" },
      ],
      customerOverrides: [{ id: "C121", status: "excluded" }],
      gap: 0,
      timeLimitSec: 120,
    });
    await gotoScenario(page, "/chapter-3", id);

    // ── R4 — Save lives in the Input Map's own "Layers:" row ──────────────
    await page.getByTestId("sidebar-input-input-map").click();
    await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const layersRowSave = page.locator('[data-testid="pmedian-map-toolbar"] [data-testid="button-save"]');
    await expect(layersRowSave).toBeVisible();

    // ── R2/R1/R3 groundwork — reveal inactive (ATL, dashed) too ────────────
    await page.getByTestId("toggle-layer-show-inactive").click();
    await expect(page.locator(".leaflet-marker-pane .wh-marker").first()).toBeVisible({ timeout: HEADER_TIMEOUT });

    // R3 — mixed-status markers actually PAINT (computed style, real
    // Chromium resolving the --accent-*/--muted-foreground custom
    // properties). This is the whole R3 bug: before the fix, fill/stroke
    // silently fell back to invalid values (black fill / no stroke).
    const filledPolygon = page.locator(".wh-marker.status-forced_open polygon").first();
    await expect(filledPolygon).toHaveCount(1);
    const filledFill = await filledPolygon.evaluate(el => getComputedStyle(el).fill);
    expect(filledFill).not.toBe("none");
    expect(filledFill).not.toBe("rgb(0, 0, 0)"); // the old invalid-fill fallback

    const dashedPolygon = page.locator(".wh-marker.status-inactive polygon").first();
    await expect(dashedPolygon).toHaveCount(1);
    const dashedStroke = await dashedPolygon.evaluate(el => getComputedStyle(el).stroke);
    expect(dashedStroke).not.toBe("none");
    await expect(dashedPolygon).toHaveAttribute("stroke-dasharray", "4");

    const outlinePolygon = page.locator(".wh-marker.status-active polygon").first();
    await expect(outlinePolygon).toHaveCount(1);
    const outlineStroke = await outlinePolygon.evaluate(el => getComputedStyle(el).stroke);
    expect(outlineStroke).not.toBe("none");

    // ── R1 — customer bubbles are green, distinct from blue warehouse
    // triangles (both on the SAME p-median-us map) ──────────────────────────
    const customerFill = await page.locator(".cs-marker circle").first().evaluate(el => getComputedStyle(el).fill);
    expect(customerFill).not.toBe(filledFill);

    // ── R2 — quintile stepping across the real 200-customer dataset (widths
    // derived from EntityMarkers.tsx's iconSize, visible via the marker
    // icon's own bounding box) + the excluded customer (C121, the real
    // highest-demand row) is dim but sized in the TOP bucket, not shrunk ──
    const csMarkers = page.locator(".leaflet-marker-pane .cs-marker");
    const widths = new Set<number>();
    const count = await csMarkers.count();
    for (let i = 0; i < count; i++) {
      const box = await csMarkers.nth(i).boundingBox();
      if (box) widths.add(Math.round(box.width));
    }
    expect(widths.size).toBeGreaterThan(1); // stepped, not all-identical

    const excludedMarker = page.locator(".cs-marker.cs-excluded");
    await expect(excludedMarker).toHaveCount(1);
    const excludedBox = await excludedMarker.boundingBox();
    const maxWidth = Math.max(...widths);
    expect(excludedBox).not.toBeNull();
    expect(Math.round(excludedBox!.width)).toBe(maxWidth); // top quintile, in-scale

    // ── R5 — Run Optimizer bands are a persisted SOLVE INPUT ───────────────
    await page.getByTestId("button-run-optimizer").click();
    await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("solve-dialog-button-bands-plus").click();
    await page.getByTestId("solve-dialog-input-new-band").fill("1200");
    await page.getByTestId("solve-dialog-button-add-band-confirm").click();
    await expect(page.getByTestId("solve-dialog-band-1200")).toBeVisible();
    await page.getByTestId("solve-dialog-solve").click();
    // Real CBC solve — wait for the dialog to close (solve complete) rather
    // than a fixed sleep.
    await expect(page.getByTestId("solve-dialog")).not.toBeVisible({ timeout: 60_000 });

    // The solved bands (incl. the dialog-added 1200) persisted to
    // Optimization Parameters — same underlying field, R5's single source of
    // truth.
    await page.getByTestId("sidebar-input-optimization-parameters").click();
    await expect(page.getByTestId("button-remove-band-1200")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // R5's displayedInputs principle: draft-edit the bands AGAIN (add 2000)
    // WITHOUT saving/re-solving — the currently-displayed solve's OUTPUT
    // surfaces must not react to this.
    await page.getByTestId("button-bands-plus").click();
    await page.getByTestId("input-new-band").fill("2000");
    await page.getByTestId("button-add-band-confirm").click();
    await expect(page.getByTestId("button-remove-band-2000")).toBeVisible();

    await page.getByTestId("sidebar-output-service-stats").click();
    await expect(page.getByTestId("service-stats-band-1200")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("service-stats-band-2000")).toHaveCount(0); // the UNSAVED draft never reached this OUTPUT surface

    // ── R9 — corrected demand-weighted label + real unit ───────────────────
    await expect(page.getByText("Percent of demand served within the selected distance bands")).toBeVisible();
    await expect(page.getByTestId("service-stats-band-250")).toContainText("mi");

    // ── R7 — Output Map shows ONLY the opened warehouse (ALN); the closed
    // candidate (every other warehouse, including the inactive ATL) is
    // absent ──────────────────────────────────────────────────────────────
    await page.getByTestId("sidebar-output-output-map").click();
    await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.locator(".leaflet-marker-pane .leaflet-marker-icon")).toHaveCount(1, { timeout: HEADER_TIMEOUT });

    // ── R6+R8 — Solution Summary compare, facility-location rows present
    // for p-median-us (supportsP) ───────────────────────────────────────────
    const id2 = await createScenarioApi(page, "p-median-us", `E2E R1-R9 compare-2 ${Date.now()}`, {
      p: 2,
      distanceBands: [250, 500, 750],
      capacityMode: "none",
      uniformCapacity: null,
      warehouseOverrides: [],
      customerOverrides: [],
      gap: 0,
      timeLimitSec: 120,
    });
    await solveViaApi(page, id2);

    await gotoScenario(page, "/chapter-3", id);
    await page.getByTestId("sidebar-output-cost-summary").click();
    await expect(page.getByTestId("cost-summary-compare-toggles")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const toggle2 = page.locator(`[data-testid="cost-summary-compare-toggle-${id2}"] input[type="checkbox"]`);
    await toggle2.check();

    await expect(page.getByTestId("cost-summary-compare-table")).toBeVisible();
    await expect(page.getByTestId(`cost-summary-compare-column-${id}`)).toBeVisible();
    await expect(page.getByTestId(`cost-summary-compare-column-${id2}`)).toBeVisible();
    await expect(page.getByTestId(`cost-summary-compare-open-facilities-${id}`)).toBeVisible();
    await expect(page.getByTestId(`cost-summary-compare-open-facilities-${id2}`)).toBeVisible();
    await expect(page.getByTestId(`cost-summary-compare-utilization-${id}`)).toBeVisible();

    await page.request.delete(`/api/scenarios/${id}`);
    await page.request.delete(`/api/scenarios/${id2}`);
  });

  test("transport-coal: R6+R8 compare omits facility-location rows entirely for a non-facility-location model", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page, "transport");

    const inputs = {
      distanceBands: [500, 1000, 1500, 2000],
      gap: 0,
      timeLimitSec: 120,
      capacityFactor: 1.0,
      singleSource: false,
      capacityInactive: false,
    };
    const idA = await createScenarioApi(page, "transport-coal", `E2E R6R8 transport-A ${Date.now()}`, inputs);
    const idB = await createScenarioApi(page, "transport-coal", `E2E R6R8 transport-B ${Date.now()}`, inputs);
    await solveViaApi(page, idA);
    await solveViaApi(page, idB);

    try {
      await gotoScenario(page, "/chapter-5/transport", idA);
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-compare-toggles")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const toggleB = page.locator(`[data-testid="cost-summary-compare-toggle-${idB}"] input[type="checkbox"]`);
      await toggleB.check();

      await expect(page.getByTestId("cost-summary-compare-table")).toBeVisible();
      // Scalar rows (always shown) are present for both columns.
      await expect(page.getByTestId(`cost-summary-compare-objective-${idA}`)).toBeVisible();
      await expect(page.getByTestId(`cost-summary-compare-objective-${idB}`)).toBeVisible();
      // Facility-location rows are OMITTED ENTIRELY (not "N/A" cells) for
      // transport-coal — every mine is always "open", so there's no real
      // facility-location concept to report on.
      await expect(page.getByTestId(`cost-summary-compare-open-facilities-${idA}`)).toHaveCount(0);
      await expect(page.getByTestId(`cost-summary-compare-utilization-${idA}`)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/scenarios/${idA}`);
      await page.request.delete(`/api/scenarios/${idB}`);
    }
  });
});
