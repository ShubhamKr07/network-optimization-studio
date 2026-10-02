/**
 * Browser E2E — Chapter 9 (JADE) editable transportation costs.
 *
 * Spec: docs/superpowers/specs/2026-10-02-ch9-transport-costs-design.md §6.
 * Plan: docs/superpowers/plans/2026-10-02-ch9-transport-costs.md Task 10.
 *
 * The journey the unit tests cannot cover: a real solve at the defaults, a
 * rate edit committed by BLUR, Save, the stale badge, a second solve, and a
 * Compare view where each column carries its own solved-at rates.
 *
 * Target: E2E_BASE_URL, requires the local dev proxy (CLAUDE.md's recipe).
 */
import { test, expect, type Page } from "@playwright/test";
import { skipIfJadeLocked } from "./helpers/modelLock";
import { readSolvedAt } from "./helpers/solvedAt";

test.use({ actionTimeout: 15_000 });
test.use({ viewport: { width: 1400, height: 1400 } });

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;

function jadeInputs() {
  return {
    p: 2,
    distanceBands: [200, 400, 800, 1600],
    gap: 0,
    timeLimitSec: 120,
    warehouseOverrides: [
      { id: "wh-11", status: "forced_open" },
      { id: "wh-14", status: "forced_open" },
    ],
  };
}

async function registerAndGoHome(page: Page, slug: string): Promise<void> {
  const email = `e2e-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenario(page: Page, name: string): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `${name} ${Date.now()}`, modelId: "two-echelon-jade-us", inputs: jadeInputs() },
  });
  expect(resp.status()).toBe(201);
  return Number((await resp.json()).id);
}

async function solve(page: Page, id: number): Promise<void> {
  const before = await readSolvedAt(page, id);
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect
    .poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
    .not.toBe(before);
}

test.describe("Chapter 9 — editable transportation costs", () => {
  test("edit a rate, save, re-solve, and compare the two results' solved-at rates", async ({ page }) => {
    test.setTimeout(240_000);
    await registerAndGoHome(page, "ch9-tc");
    await skipIfJadeLocked(page);

    const baseline = await createScenario(page, "E2E TC baseline");
    await page.goto(`/chapter-9/jade?scenario=${baseline}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await solve(page, baseline);

    const objectiveAtDefaults = await page.getByTestId("cost-summary-value-objective").innerText()
      .catch(async () => {
        await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
        return page.getByTestId("cost-summary-value-objective").innerText();
      });

    // The tab exists and seeds from the textbook values.
    await page.getByTestId("sidebar-input-transportCosts").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("transport-costs-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");

    // Derived columns on the Distances tab, before any edit.
    await page.getByTestId("sidebar-input-distances").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("jade-distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // Edit the inbound rate and commit by BLUR (not Enter — Enter races any
    // dialog that steals focus; a blur onto a stable neighbour does not).
    await page.getByTestId("sidebar-input-transportCosts").click({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("input-transport-ic-rate").fill("0.14");
    await page.getByTestId("input-transport-ob-rate").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

    await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
    // Workspace.tsx has no chip-stale (that's Studio.tsx-only, never mounted
    // here) and stale-output-banner only renders while an output tab is
    // ALREADY the active one (StaleOutputBanner's own comment) — reaching it
    // from here would require navigating to an Outputs entry, but
    // SidebarTree disables every Outputs entry the instant the scenario goes
    // stale (hasSolvedRun is wired to hasFreshSolvedRun = result != null &&
    // !stale, Workspace.tsx:4574/1531), so the real, reachable stale signal
    // from the Transportation Costs tab is that disablement itself.
    await expect(page.getByTestId("sidebar-output-cost-summary")).toBeDisabled({ timeout: HEADER_TIMEOUT });

    await solve(page, baseline);
    await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-rate-ic")).toContainText("0.14", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-min-ic")).toContainText("10", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-rate-ob")).toContainText("0.12", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-min-ob")).toContainText("10", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-value-objective")).not.toHaveText(objectiveAtDefaults);

    // A second scenario at the defaults, then Compare.
    const sibling = await createScenario(page, "E2E TC sibling");
    await page.goto(`/chapter-9/jade?scenario=${sibling}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await solve(page, sibling);
    await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
    await page.getByTestId(`cost-summary-compare-toggle-${baseline}`).locator("input").check({ timeout: HEADER_TIMEOUT });

    await expect(page.getByTestId(`cost-summary-compare-rate-ic-${baseline}`))
      .toContainText("0.14", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-rate-ic-${sibling}`))
      .toContainText("0.07", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-min-ic-${baseline}`))
      .toContainText("10", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-rate-ob-${baseline}`))
      .toContainText("0.12", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-min-ob-${baseline}`))
      .toContainText("10", { timeout: HEADER_TIMEOUT });
  });
});
