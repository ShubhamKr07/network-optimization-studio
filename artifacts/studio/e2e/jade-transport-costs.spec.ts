/**
 * Browser E2E — Chapter 9 (JADE) editable transportation costs.
 *
 * Spec: docs/superpowers/specs/2026-10-02-ch9-transport-costs-design.md §6.
 * Plan: docs/superpowers/plans/2026-10-02-ch9-transport-costs.md Task 10.
 *
 * The journey the unit tests cannot cover: a real solve at the defaults, the
 * Distances tab's $/ton and min-charge columns re-deriving LIVE from an
 * uncommitted rate draft (0.07 -> 0.14 exactly doubles an inbound lane's
 * cost), a rate edit committed by BLUR, Save, the stale signal, a second
 * solve, and a Compare view rendering two non-stale scenarios' own rate/min
 * rows side by side. The PROVENANCE contract — that each column's rates come
 * from its own result.metrics.transportRates rather than from live inputs —
 * is a unit-test claim (CostSummaryTab.test.tsx covers a stale/legacy column
 * specifically to force that distinction); this browser journey only ever
 * exercises two NON-stale scenarios, where inputs.transportCosts and
 * result.metrics.transportRates necessarily agree, so it cannot by itself
 * prove which source is being read.
 *
 * Target: E2E_BASE_URL, requires the local dev proxy (CLAUDE.md's recipe).
 */
import { test, expect, type Page } from "./fixtures";
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

    // Derived columns on the Distances tab, before any edit. plant-1/wh-11's
    // base distance (1972.6675 mi, ground-truth dataset) x the default
    // inbound rate (0.07) is $138.09/ton, well above the $10 minimum, so
    // this lane's $/ton reflects the RATE and carries no "min" badge.
    await page.getByTestId("sidebar-input-distances").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("jade-distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const inboundLaneCost = page.getByTestId("cell-jadedistance-cost-plant_to_warehouse-plant-1-wh-11");
    await expect(inboundLaneCost).toHaveText("138.09", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("badge-jadedistance-min-plant_to_warehouse-plant-1-wh-11")).toHaveCount(0);

    // A ~0-mile lane (wh-14 -> customer-14) always pays the $10 minimum
    // regardless of rate — the one fixture this journey can use to show the
    // "min" badge actually rendering. Scoped via the From/To filter so the
    // row is guaranteed on page 1 of JadeDistancesTab's pagination.
    await page.getByTestId("button-filter-menu-trigger").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("input-filter-to")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("input-filter-to").fill("customer-14");
    await expect(page.getByTestId("cell-jadedistance-cost-warehouse_to_customer-wh-14-customer-14"))
      .toHaveText("10.00", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("badge-jadedistance-min-warehouse_to_customer-wh-14-customer-14"))
      .toBeVisible({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("input-filter-to").fill("");
    await page.keyboard.press("Escape");

    // Edit the inbound rate and commit by BLUR (not Enter — Enter races any
    // dialog that steals focus; a blur onto a stable neighbour does not).
    await page.getByTestId("sidebar-input-transportCosts").click({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("input-transport-ic-rate").fill("0.14");
    await page.getByTestId("input-transport-ob-rate").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // The Distances tab's $/ton column re-derives LIVE from the uncommitted
    // draft rate (JadeDistancesTab receives `transportCosts` from
    // Workspace's localInputs, not a saved snapshot) — this re-derivation is
    // the one effect only a browser test sees end to end; the derivation
    // function itself (laneCostPerTon) is already covered in isolation by
    // transportCostsBounds.test.ts. 0.07 -> 0.14 exactly doubles this
    // inbound lane's cost, well before Save or a re-solve.
    await page.getByTestId("sidebar-input-distances").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("jade-distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(inboundLaneCost).toHaveText("276.17", { timeout: HEADER_TIMEOUT });
    await page.getByTestId("sidebar-input-transportCosts").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("transport-costs-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

    await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
    // Workspace.tsx has no chip-stale (that's Studio.tsx-only, never mounted
    // here). SidebarTree disables every Outputs *sidebar* entry the instant
    // the scenario goes stale (hasSolvedRun is wired to hasFreshSolvedRun =
    // result != null && !stale, Workspace.tsx:4574/1531) — that disablement
    // itself is one reachable, truthful stale signal from here.
    // COSM-1 — the sidebar disablement is now the ONLY stale signal. The
    // open-tab strip that used to offer a second, still-clickable route back
    // to a stale Cost Summary (and its StaleOutputBanner) was removed by this
    // bundle; stale outputs are deliberately unreachable until a re-solve.
    await expect(page.getByTestId("sidebar-output-cost-summary")).toBeDisabled({ timeout: HEADER_TIMEOUT });

    await solve(page, baseline);
    await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-rate-ic")).toContainText("0.14", { timeout: HEADER_TIMEOUT });
    // Exact/anchored, not toContainText("10") — that also matches "100",
    // "210", "$10.50". icMinTrans/obMinTrans are untouched defaults (only
    // the two rate fields were edited), so the cell text is exactly "10".
    await expect(page.getByTestId("cost-summary-min-ic")).toHaveText(/^10$/, { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-rate-ob")).toContainText("0.12", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-min-ob")).toHaveText(/^10$/, { timeout: HEADER_TIMEOUT });
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
    // Exact/anchored — see the single-scenario check above for why
    // toContainText("10") is too loose here.
    await expect(page.getByTestId(`cost-summary-compare-min-ic-${baseline}`))
      .toHaveText(/^10$/, { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-rate-ob-${baseline}`))
      .toContainText("0.12", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-min-ob-${baseline}`))
      .toHaveText(/^10$/, { timeout: HEADER_TIMEOUT });
  });
});
