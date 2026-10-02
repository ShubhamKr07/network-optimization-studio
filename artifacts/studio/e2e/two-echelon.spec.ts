/**
 * Browser E2E — Two-Echelon (Gold Refinery Siting) happy path.
 *
 * Exercises the full Chapter 10 model through the current Workspace UI
 * (Studio/the header scenario dropdown/the dedicated /compare page were all
 * removed by Bundle 6 — see this file's own rot-repair note below): create a
 * scenario at the default BOM ratio (1.1), solve it, verify Cunnamulla is
 * selected (the customer-adjacent refinery), clone it, sweep the BOM ratio
 * to 2.0 via the Optimization Parameters slider, re-solve, and verify the
 * optimal refinery flips to Daggar Hills (the mine-adjacent one). Then
 * compares both scenarios via Solution Summary's inline compare toggles
 * (the current, in-tab replacement for the old dedicated Compare page) and
 * confirms it surfaces a real diff — different open refineries.
 *
 * [e2e-rot repair] Bundle 6 retired Studio.tsx (every chapter route now
 * renders Workspace.tsx), removed the header `button-scenario-dropdown`
 * (scenario switching is sidebar-only now — `button-clone-scenario-<id>`
 * etc.), and folded Compare INTO Solution Summary (CostSummaryTab.tsx's
 * `cost-summary-compare-toggle-<id>` checkboxes — there is no more
 * standalone `/compare` route or `button-compare`/`checkbox-scenario-*`).
 * This is a flow rewrite onto the current Workspace surface, not a
 * selector-only fix.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md and
 * vite.config.ts. Run order: api-server (`DATABASE_URL=... PORT=3001 pnpm
 * --filter api-server run dev`), then studio
 * (`API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`),
 * then `E2E_BASE_URL=http://localhost:<studio-port> npx playwright test
 * two-echelon` from `artifacts/studio`.
 *
 * The flip point (1.1 → Cunnamulla, 2.0 → Daggar Hills) is verified
 * independently by e2e_accuracy-style runs of solve_two_echelon at the two
 * BOM ratios; this test asserts the UI surfaces the same choice. Both
 * solves go through the real CBC solver via the UI's own Run Optimizer flow
 * (not seeded) — the flip itself is the thing under test, so a seeded
 * result would prove nothing about whether the UI is wired to the right
 * solve outcome.
 */
import { test, expect, type Page } from "./fixtures";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 60_000;

/**
 * Register a brand-new test user (unique email) and land on the home page.
 * Cookie auth is set on register (same as import.spec.ts's convention).
 */
async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-twoechelon-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/**
 * Create a two-echelon scenario via the API (the Workspace sidebar's own
 * "Create new scenario" dialog does the same with equivalent default
 * inputs — creating via the API mirrors the rest of this repo's e2e
 * convention and keeps the test focused on the solve/clone/compare UI
 * surface). Default BOM = 1.1.
 */
async function createTwoEchelonScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E Two-Echelon ${Date.now()}`,
      modelId: "two-echelon-gold-au",
      inputs: {
        bomRatio: 1.1,
        refineryOverrides: [],
        customerOverrides: [],
        distanceBands: [500, 1000, 1500, 2000, 2600],
        gap: 0,
        timeLimitSec: 120,
      },
    },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-10/gold-refinery?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

/**
 * Trigger a real solve via the Run Optimizer dialog (button-run-optimizer →
 * solve-dialog-solve) and wait for the Output Map / Outputs sidebar to
 * ungate — the current async-solve (G3.1) UI contract every other spec in
 * this suite already uses (see workspace-fixups.spec.ts's own
 * solveAndWait).
 */
async function solveAndWait(page: Page): Promise<void> {
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });
  await expect(page.getByTestId("sidebar-output-open-warehouses")).toBeEnabled({ timeout: HEADER_TIMEOUT });
}

/** Extracts the `?scenario=<id>` query param Workspace.tsx navigates to
 * after a create/clone mutation's onSuccess (see pages/Workspace.tsx's
 * handleCloneScenario — `navigate(\`?scenario=${cloned.id}\`)`). */
function scenarioIdFromUrl(url: string): string {
  const match = new URL(url).searchParams.get("scenario");
  if (!match) throw new Error(`no ?scenario= param in URL: ${url}`);
  return match;
}

test.describe("Two-Echelon (Chapter 10)", () => {
  test("BOM sweep flips the selected refinery (Cunnamulla → Daggar Hills) and Solution Summary compare surfaces the diff", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const originalId = await createTwoEchelonScenario(page);

    try {
      // ── 1. Solve at default BOM 1.1 → Cunnamulla ────────────────────────
      await solveAndWait(page);
      await page.getByTestId("sidebar-output-open-warehouses").click();
      await expect(page.getByText(/cunnamulla/i).first()).toBeVisible({ timeout: HEADER_TIMEOUT });

      // ── 2. Clone → BOM 2.0 → re-solve → Daggar Hills ────────────────────
      // Sidebar-only scenario ops now (button-scenario-dropdown is gone) —
      // clone via the scenario list's own per-row button. The URL already
      // carries `?scenario=<originalId>` BEFORE this click (this page is
      // the original scenario), so a bare "/[?&]scenario=\d+/" match
      // resolves trivially against the UNCHANGED url under load, before the
      // clone mutation's onSuccess navigate() ever fires — assert the id
      // specifically DIFFERS from originalId, so this genuinely waits for
      // the real navigation.
      await page.getByTestId(`button-clone-scenario-${originalId}`).click();
      await expect(page).toHaveURL(new RegExp(`[?&]scenario=(?!${originalId}\\b)\\d+`), { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const cloneId = scenarioIdFromUrl(page.url());
      expect(cloneId).not.toBe(originalId);

      // Clone inherits BOM 1.1 — Optimization Parameters tab hosts the BOM
      // slider now (there's no separate results-panel readout).
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("optimization-parameters-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-bom-ratio")).toHaveText("1.10×", { timeout: HEADER_TIMEOUT });

      // Sweep the BOM slider to 2.0. min=1.05, step=0.05 (OptimizationParametersTab.tsx)
      // — from 1.10 that's 18 ArrowRight presses to reach the 2.00 max.
      // Dragging the Radix Slider by percentage is brittle across
      // viewports; keyboard-increment off the focused thumb is robust and
      // deterministic (onValueChange rounds to the nearest 0.05 step).
      const bomSlider = page.getByTestId("slider-bom-ratio");
      await bomSlider.scrollIntoViewIfNeeded();
      await bomSlider.locator("span[role='slider']").focus();
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press("ArrowRight");
      }
      await expect(page.getByTestId("text-bom-ratio")).toHaveText("2.00×");

      // Persist the BOM change, then re-solve.
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });
      await solveAndWait(page);

      // At BOM 2.0 the mine-adjacent Daggar Hills wins the flip point.
      await page.getByTestId("sidebar-output-open-warehouses").click();
      await expect(page.getByText(/daggar\s*hills/i).first()).toBeVisible({ timeout: HEADER_TIMEOUT });

      // ── 3. Compare both scenarios via Solution Summary's inline compare
      // toggles (the current in-tab replacement for the old /compare page —
      // Bundle 6 removed the standalone route entirely). ──────────────────
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-compare-toggles")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // Default selection is just the CURRENT scenario (the clone, BOM 2.0)
      // — check the original (BOM 1.1) scenario's own toggle to enter
      // compare mode (>=2 selected).
      const originalToggle = page.getByTestId(`cost-summary-compare-toggle-${originalId}`);
      await originalToggle.locator("input[type='checkbox']").check();
      await expect(page.getByTestId("cost-summary-compare-table")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // The two refineries differ between the scenarios — the open-facility
      // city-list cells show distinct refinery cities per column (T5 (B5),
      // gated on supportsFacilityStatus — true for two-echelon-gold-au).
      const openFacilitiesRow = page.locator('tr:has([data-testid^="cost-summary-compare-open-facilities-cities-"])');
      await expect(openFacilitiesRow).toContainText(/cunnamulla/i);
      await expect(openFacilitiesRow).toContainText(/daggar/i);
    } finally {
      // Cleanup both scenarios owned by this test user.
      const listResp = await page.request.get("/api/scenarios");
      if (listResp.ok()) {
        const list = (await listResp.json()) as Array<{ id: number; modelId: string }>;
        for (const s of list.filter((s) => s.modelId === "two-echelon-gold-au")) {
          await page.request.delete(`/api/scenarios/${s.id}`);
        }
      }
    }
  });
});
