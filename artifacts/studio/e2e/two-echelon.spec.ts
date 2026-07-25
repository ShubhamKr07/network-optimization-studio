/**
 * Browser E2E — Two-Echelon (Gold Refinery Siting) happy path.
 *
 * Exercises the full Chapter 10 model through the UI: create a scenario at the
 * default BOM ratio (1.1), solve it, verify Cunnamulla is selected (the
 * customer-adjacent refinery), clone it, sweep the BOM ratio to 2.0 via the
 * slider, re-solve, and verify the optimal refinery flips to Daggar Hills
 * (the mine-adjacent one). Then navigates to Compare, selects both
 * scenarios, and confirms the comparison surfaces a real diff — different
 * selected refineries.
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
 * BOM ratios; this test asserts the UI surfaces the same choice.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

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
 * Create a two-echelon scenario via the API (the UI also creates these from
 * the Studio's "New scenario" dialog with the same default inputs shape, but
 * creating via the API mirrors import.spec.ts's convention and keeps the
 * test focused on the solve/clone/compare UI surface). Default BOM = 1.1.
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
  // Header shows the lab title (two-echelon reuses the default "Model Lab"
  // title line) — wait for the scenario name to render as the active one.
  await expect(page.getByTestId("button-scenario-dropdown")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

/**
 * Trigger Solve and wait for the status badge to settle on "Solved ·
 * validated" (or the stale variant). Solve is async (G3.1) — the UI polls
 * the job and flips the badge once the result lands.
 */
async function solveAndWait(page: Page): Promise<void> {
  await page.getByTestId("button-solve").click();
  // Status badge passes through "Solving..." before settling. Wait for the
  // solved indicator with a generous timeout (CBC solve + async poll).
  await expect(page.getByTestId("status-badge")).toContainText(/Solved/, { timeout: 60_000 });
}

test.describe("Two-Echelon (Chapter 10)", () => {
  test("BOM sweep flips the selected refinery (Cunnamulla → Daggar Hills) and Compare surfaces the diff", async ({ page }) => {
    await registerAndGoHome(page);
    const id = await createTwoEchelonScenario(page);

    // ── 1. Solve at default BOM 1.1 → Cunnamulla ────────────────────────
    await solveAndWait(page);
    // The results panel subheader shows "<n> refinery selected" for the
    // two-echelon model. "Cunnamulla" appears in the page once solved
    // (utilization row, map marker, and the open-site label).
    await expect(page.getByText(/cunnamulla/i).first()).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByText(/refinery selected/)).toBeVisible();

    // ── 2. Clone → BOM 2.0 → re-solve → Daggar Hills ────────────────────
    await page.getByTestId("button-clone").click();
    // Cloning navigates to the new scenario; the dropdown label updates to
    // the cloned name. Wait for the clone to land and inherit BOM 1.1.
    await expect(page.getByTestId("text-bom-ratio")).toHaveText("1.1×", { timeout: HEADER_TIMEOUT });

    // Sweep the BOM slider to 2.0. The slider's step is 0.1 over [1.0, 3.0]
    // — keyboard-increment via the thumb is brittle, so set it via the
    // underlying input aria + re-read the display text. Dragging the Radix
    // Slider by percentage is the robust approach.
    const bomSlider = page.getByTestId("slider-bom-ratio");
    await bomSlider.scrollIntoViewIfNeeded();
    // Move the thumb to the far right (3.0) then nudge back down to 2.0 via
    // the displayed value. The Slider thumb is focusable; pressing ArrowRight
    // steps by 0.1, so from 1.1 we need 9 steps to reach 2.0.
    await bomSlider.locator("span[role='slider']").focus();
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(page.getByTestId("text-bom-ratio")).toHaveText("2.0×");

    // Persist the BOM change, then re-solve.
    await page.getByTestId("button-save").click();
    await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: 10_000 });
    await solveAndWait(page);

    // At BOM 2.0 the mine-adjacent Daggar Hills wins the flip point.
    await expect(page.getByText(/daggar\s*hills/i).first()).toBeVisible({ timeout: HEADER_TIMEOUT });

    // ── 3. Compare both scenarios → diff surfaces ───────────────────────
    await page.getByTestId("button-compare").click();
    await expect(page.getByRole("heading", { name: "Compare Scenarios" })).toBeVisible({ timeout: HEADER_TIMEOUT });

    // The model filter auto-selects two-echelon-gold-au (only model present
    // for this fresh account). Ensure both scenarios are checked.
    const checkboxes = page.locator("[data-testid^='checkbox-scenario-']");
    const count = await checkboxes.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Check any unchecked scenario so both are selected.
    for (let i = 0; i < count; i++) {
      const cb = checkboxes.nth(i);
      if (!(await cb.isChecked())) {
        await cb.check();
      }
    }

    // The output diff table must render. The two refineries differ between
    // the scenarios, so the "Open sites" row shows distinct refinery ids per
    // column — assert each name appears in its scenario's open-sites cell.
    await expect(page.locator("[data-testid^='output-open-sites-']").first()).toBeVisible({ timeout: HEADER_TIMEOUT });
    // At least one column shows cunnamulla and at least one shows
    // daggar-hills across the open-sites row.
    const openSitesRow = page.locator("tr:has(td[data-testid^='output-open-sites-'])");
    await expect(openSitesRow).toContainText(/cunnamulla/i);
    await expect(openSitesRow).toContainText(/daggar/i);

    // Cleanup both scenarios owned by this test user. The cloned scenario's
    // id is whatever the dropdown currently shows; fetch the list and delete
    // all two-echelon scenarios for cleanliness.
    const listResp = await page.request.get("/api/scenarios");
    if (listResp.ok()) {
      const list = (await listResp.json()) as Array<{ id: number; modelId: string }>;
      for (const s of list.filter((s) => s.modelId === "two-echelon-gold-au")) {
        await page.request.delete(`/api/scenarios/${s.id}`);
      }
    }
    void id; // referenced above for create + goto; kept for clarity
  });
});
