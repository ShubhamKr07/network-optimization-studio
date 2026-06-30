/**
 * Browser E2E tests — each lab's user journey.
 *
 * Covers: login, lab navigation, header labels, configure panel controls,
 * New-scenario button creating the correct problemType/pValue, and
 * BrazilMap vs NetworkMap rendering.
 *
 * Target: E2E_BASE_URL env var (defaults to the Replit deployment).
 * Run locally with: pnpm test:e2e
 */
import { test, expect, type Page } from "@playwright/test";

// Generous timeout for header text that depends on setActiveQuest firing after
// the scenario fetch completes (especially when Replit is under load).
const HEADER_TIMEOUT = 10_000;

// ── auth helper ───────────────────────────────────────────────────────────────

/** Log in via the LoginPage email form (isLoggedIn lives in React state). */
async function loginAsGuest(page: Page, email = "e2e@test.com") {
  await page.goto("/");
  const form = page.locator("form");
  await expect(form).toBeVisible({ timeout: 8_000 });
  await page.locator("form input").fill(email);
  await page.locator("form button[type='submit']").click();
  await expect(form).not.toBeVisible({ timeout: 8_000 });
}

// ── nav helpers ───────────────────────────────────────────────────────────────

/**
 * Navigate to a quest lab via the "Map" nav rail → click the node title.
 * Waits until the Studio URL param appears AND the expected header label
 * is visible (so setActiveQuest has fired by the time beforeEach returns).
 */
async function goToLab(page: Page, nodeTitle: string, expectedHeader: RegExp) {
  // Wait for the scenarios list to refresh before clicking the node
  const scenariosFetch = page.waitForResponse(/\/api\/scenarios(?!\/)/, { timeout: 8_000 });
  await page.locator("nav button", { hasText: "Map" }).click();
  await scenariosFetch.catch(() => {}); // don't fail if already cached
  await expect(page.getByText(nodeTitle)).toBeVisible({ timeout: 6_000 });
  await page.getByText(nodeTitle).click();
  await expect(page).toHaveURL(/\/\?scenario=\d+/, { timeout: 8_000 });
  // Wait for the header so callers know the gamification state is ready
  await expect(page.getByText(expectedHeader)).toBeVisible({ timeout: HEADER_TIMEOUT });
}

/** Returns the ?scenario= query param from the current URL. */
function scenarioId(page: Page): string | null {
  return new URL(page.url()).searchParams.get("scenario");
}

/**
 * Open "New scenario" dialog, fill name, click Create, and wait for the URL
 * to navigate to a DIFFERENT scenario ID than the one we started on.
 */
async function clickNewAndWait(page: Page, name: string) {
  const oldId = scenarioId(page);
  await page.getByTestId("button-create-scenario").click();
  await expect(page.getByTestId("input-new-scenario-name")).toBeVisible();
  await page.getByTestId("input-new-scenario-name").fill(name);
  await page.getByTestId("button-create-confirm").click();
  // Wait for the URL to change to the newly created scenario
  await page.waitForURL(url => url.searchParams.get("scenario") !== oldId, { timeout: 8_000 });
}

// ── Lab 1: Al's Athletics (P-Median) ─────────────────────────────────────────

test.describe("Lab 1 — Al's Athletics (P-Median)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await goToLab(page, "Al's Athletics", /Al's Athletics · Model Lab/);
  });

  test("header shows Al's Athletics · Model Lab", async ({ page }) => {
    await expect(page.getByText(/Al's Athletics · Model Lab/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("header subtitle shows p-median", async ({ page }) => {
    // "Ch 3 · p-median" only appears in the header subtitle, not in the problem-type select
    await expect(page.getByText(/Ch 3 · p-median/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("configure panel shows Warehouses to open (P)", async ({ page }) => {
    await expect(page.getByText("Warehouses to open (P)")).toBeVisible();
  });

  test("configure panel shows Warehouse status section", async ({ page }) => {
    // exact:true avoids matching the constraint "C4 Honor warehouse status"
    await expect(page.getByText("Warehouse status", { exact: true })).toBeVisible();
  });

  test("configure panel does NOT show Mine capacity factor", async ({ page }) => {
    await expect(page.getByText("Mine capacity factor")).not.toBeVisible();
  });

  test("New button creates a p_median scenario with pValue 3", async ({ page }) => {
    await clickNewAndWait(page, `E2E P-Median ${Date.now()}`);
    const id = scenarioId(page);
    expect(id).not.toBeNull();
    const resp = await page.request.get(`/api/scenarios/${id}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.problemType).toBe("p_median");
    expect(body.pValue).toBe(3);
    await page.request.delete(`/api/scenarios/${id}`);
  });
});

// ── Lab 2: Coal Transport LP ──────────────────────────────────────────────────

test.describe("Lab 2 — Coal Transport LP", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await goToLab(page, "Coal Transport LP", /Coal Transport LP · Model Lab/);
  });

  test("header shows Coal Transport LP · Model Lab", async ({ page }) => {
    await expect(page.getByText(/Coal Transport LP · Model Lab/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("header subtitle shows coal mines", async ({ page }) => {
    await expect(page.getByText(/coal mines/i)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("configure panel shows Mine capacity factor slider", async ({ page }) => {
    await expect(page.getByText("Mine capacity factor")).toBeVisible();
  });

  test("configure panel shows Single-source toggle", async ({ page }) => {
    // exact:true avoids matching "C4 Single-source toggle (forces integer)" constraint text
    await expect(page.getByText("Single-source", { exact: true })).toBeVisible();
  });

  test("configure panel shows Ignore capacity toggle", async ({ page }) => {
    await expect(page.getByText("Ignore capacity", { exact: true })).toBeVisible();
  });

  test("configure panel does NOT show Warehouse status section", async ({ page }) => {
    await expect(page.getByText("Warehouse status", { exact: true })).not.toBeVisible();
  });

  test("New button creates a transport scenario with pValue 1", async ({ page }) => {
    await clickNewAndWait(page, `E2E Transport ${Date.now()}`);
    const id = scenarioId(page);
    expect(id).not.toBeNull();
    const resp = await page.request.get(`/api/scenarios/${id}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.problemType).toBe("transport");
    expect(body.pValue).toBe(1);
    await page.request.delete(`/api/scenarios/${id}`);
  });
});

// ── Lab 3: Brazil Capacity (capacitated_pmedian) ─────────────────────────────
//
// Brazil requires a capacitated_pmedian scenario to exist so the Studio
// renders BrazilMap and the Brazil configure panel.
// Strategy: create one via API, then navigate via QuestMap (which triggers
// a fresh useListScenarios fetch so the new scenario is available).

test.describe("Lab 3 — Brazil Capacity", () => {
  let brazilId: string;

  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);

    // Create a Brazil scenario while logged-in (session cookie is set)
    const resp = await page.request.post("/api/scenarios", {
      data: {
        name: `E2E Brazil seed ${Date.now()}`,
        problemType: "capacitated_pmedian",
        pValue: 5,
        distanceBands: [500, 1000, 2000, 4000],
        solver: "cbc",
        gap: 0,
        timeLimitSec: 120,
        capacityMode: "uniform",
        uniformCapacity: null,
        warehouseStatuses: [],
      },
    });
    expect(resp.status()).toBe(201);
    brazilId = String((await resp.json()).id);

    // Navigate to QuestMap and wait for the scenarios list to refetch
    // (so it includes our freshly created Brazil scenario)
    const scenariosFetch = page.waitForResponse(/\/api\/scenarios(?!\/)/, { timeout: 8_000 });
    await page.locator("nav button", { hasText: "Map" }).click();
    await scenariosFetch.catch(() => {});

    // Click "Brazil Capacity" — QuestMap finds our new capacitated_pmedian scenario
    await expect(page.getByText("Brazil Capacity")).toBeVisible({ timeout: 6_000 });
    await page.getByText("Brazil Capacity").click();
    await expect(page).toHaveURL(/\/\?scenario=\d+/, { timeout: 8_000 });
    await expect(page.getByText(/Brazil Capacity · Model Lab/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test.afterEach(async ({ page }) => {
    if (brazilId) {
      await page.request.delete(`/api/scenarios/${brazilId}`);
    }
  });

  test("header shows Brazil Capacity · Model Lab", async ({ page }) => {
    await expect(page.getByText(/Brazil Capacity · Model Lab/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("header subtitle shows capacitated p-median and Brazil", async ({ page }) => {
    await expect(page.getByText(/capacitated p-median.*Brazil/i)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("BrazilMap is rendered instead of NetworkMap", async ({ page }) => {
    await expect(page.getByTestId("brazil-map")).toBeVisible();
    await expect(page.getByTestId("network-map")).not.toBeVisible();
  });

  test("configure panel shows Single-source toggle", async ({ page }) => {
    await expect(page.getByText("Single-source", { exact: true })).toBeVisible();
  });

  test("configure panel shows Warehouses to open (P)", async ({ page }) => {
    await expect(page.getByText("Warehouses to open (P)")).toBeVisible();
  });

  test("configure panel does NOT show Warehouse status section", async ({ page }) => {
    await expect(page.getByText("Warehouse status", { exact: true })).not.toBeVisible();
  });

  test("configure panel does NOT show Mine capacity factor", async ({ page }) => {
    await expect(page.getByText("Mine capacity factor")).not.toBeVisible();
  });

  test("New button creates a capacitated_pmedian scenario with pValue 7", async ({ page }) => {
    await clickNewAndWait(page, `E2E Brazil New ${Date.now()}`);
    const newId = scenarioId(page);
    expect(newId).not.toBeNull();
    expect(newId).not.toBe(brazilId); // a NEW scenario, not the seed
    const resp = await page.request.get(`/api/scenarios/${newId}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.problemType).toBe("capacitated_pmedian");
    expect(body.pValue).toBe(7);
    await page.request.delete(`/api/scenarios/${newId}`);
  });
});
