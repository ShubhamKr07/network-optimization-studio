/**
 * Browser E2E tests — each lab's user journey.
 *
 * Covers: header labels, configure panel, New-scenario dialog, correct
 * problemType creation, and solver-specific UI per lab.
 *
 * Requires the app to be running at E2E_BASE_URL (or the default Replit URL).
 * Auth setup is handled by global.setup.ts via stored session.
 */
import { test, expect, type Page } from "@playwright/test";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Returns the first scenario URL param from the current URL, or null. */
function scenarioId(page: Page): string | null {
  return new URL(page.url()).searchParams.get("scenario");
}

/**
 * Open the "New scenario" dialog, fill in the name, and click Create.
 * Returns without waiting for the POST to complete.
 */
async function createScenario(page: Page, name: string) {
  // Header "New" button (data-testid=button-create-scenario)
  await page.getByTestId("button-create-scenario").click();
  await expect(page.getByTestId("input-new-scenario-name")).toBeVisible();
  await page.getByTestId("input-new-scenario-name").fill(name);
  await page.getByTestId("button-create-confirm").click();
}

/** Navigate to the QuestMap and click a node by its display title. */
async function goToLab(page: Page, nodeTitle: string) {
  // The ArcadiaShell has a "Network" / quest-map navigation link
  await page.getByText("Network").click();
  await expect(page.getByText(nodeTitle)).toBeVisible();
  await page.getByText(nodeTitle).click();
  // Should land in the Studio (/?scenario=...)
  await expect(page).toHaveURL(/\/\?scenario=/);
}

// ── Lab 1: Al's Athletics (P-Median) ─────────────────────────────────────────

test.describe("Lab 1 — Al's Athletics (P-Median)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToLab(page, "Al's Athletics");
  });

  test("header shows Al's Athletics · Model Lab", async ({ page }) => {
    await expect(page.getByText(/Al's Athletics · Model Lab/)).toBeVisible();
  });

  test("header subtitle shows p-median", async ({ page }) => {
    await expect(page.getByText(/p-median/i)).toBeVisible();
  });

  test("configure panel shows Warehouses to open (P)", async ({ page }) => {
    await expect(page.getByText("Warehouses to open (P)")).toBeVisible();
  });

  test("configure panel shows Warehouse status section", async ({ page }) => {
    await expect(page.getByText("Warehouse status")).toBeVisible();
  });

  test("configure panel does NOT show Mine capacity factor", async ({ page }) => {
    await expect(page.getByText("Mine capacity factor")).not.toBeVisible();
  });

  test("NetworkMap is rendered (not BrazilMap)", async ({ page }) => {
    await expect(page.getByTestId("network-map")).toBeVisible();
    await expect(page.getByTestId("brazil-map")).not.toBeVisible();
  });

  test("New button creates a p_median scenario", async ({ page }) => {
    const id = scenarioId(page);
    await createScenario(page, `E2E P-Median ${Date.now()}`);
    // URL updates to the new scenario ID, which differs from the old one
    await expect(page).toHaveURL(/\/\?scenario=\d+/);
    const newId = scenarioId(page);
    expect(newId).not.toBeNull();
    // Verify via API that the created scenario is p_median
    const resp = await page.request.get(`/api/scenarios/${newId}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.problemType).toBe("p_median");
    // Cleanup
    await page.request.delete(`/api/scenarios/${newId}`);
  });
});

// ── Lab 2: Coal Transport LP ──────────────────────────────────────────────────

test.describe("Lab 2 — Coal Transport LP", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToLab(page, "Coal Transport LP");
  });

  test("header shows Coal Transport LP · Model Lab", async ({ page }) => {
    await expect(page.getByText(/Coal Transport LP · Model Lab/)).toBeVisible();
  });

  test("header subtitle shows transport LP and coal mines", async ({ page }) => {
    await expect(page.getByText(/coal mines/i)).toBeVisible();
  });

  test("configure panel shows Mine capacity factor slider", async ({ page }) => {
    await expect(page.getByText("Mine capacity factor")).toBeVisible();
  });

  test("configure panel shows Single-source toggle", async ({ page }) => {
    await expect(page.getByText("Single-source")).toBeVisible();
  });

  test("configure panel shows Ignore capacity toggle", async ({ page }) => {
    await expect(page.getByText("Ignore capacity")).toBeVisible();
  });

  test("configure panel does NOT show Warehouse status", async ({ page }) => {
    await expect(page.getByText("Warehouse status")).not.toBeVisible();
  });

  test("New button creates a transport scenario", async ({ page }) => {
    await createScenario(page, `E2E Transport ${Date.now()}`);
    await expect(page).toHaveURL(/\/\?scenario=\d+/);
    const newId = scenarioId(page);
    expect(newId).not.toBeNull();
    const resp = await page.request.get(`/api/scenarios/${newId}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.problemType).toBe("transport");
    await page.request.delete(`/api/scenarios/${newId}`);
  });
});

// ── Lab 3: Brazil Capacity (Capacitated P-Median) ────────────────────────────

test.describe("Lab 3 — Brazil Capacity (capacitated_pmedian)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToLab(page, "Brazil Capacity");
  });

  test("header shows Brazil Capacity · Model Lab", async ({ page }) => {
    await expect(page.getByText(/Brazil Capacity · Model Lab/)).toBeVisible();
  });

  test("header subtitle shows capacitated p-median and Brazil", async ({ page }) => {
    await expect(page.getByText(/capacitated p-median.*Brazil/i)).toBeVisible();
  });

  test("BrazilMap is rendered instead of NetworkMap", async ({ page }) => {
    await expect(page.getByTestId("brazil-map")).toBeVisible();
    await expect(page.getByTestId("network-map")).not.toBeVisible();
  });

  test("configure panel shows Single-source toggle", async ({ page }) => {
    await expect(page.getByText("Single-source")).toBeVisible();
  });

  test("configure panel shows Warehouses to open (P)", async ({ page }) => {
    await expect(page.getByText("Warehouses to open (P)")).toBeVisible();
  });

  test("configure panel does NOT show Warehouse status", async ({ page }) => {
    await expect(page.getByText("Warehouse status")).not.toBeVisible();
  });

  test("configure panel does NOT show Mine capacity factor", async ({ page }) => {
    await expect(page.getByText("Mine capacity factor")).not.toBeVisible();
  });

  test("New button creates a capacitated_pmedian scenario", async ({ page }) => {
    await createScenario(page, `E2E Brazil ${Date.now()}`);
    await expect(page).toHaveURL(/\/\?scenario=\d+/);
    const newId = scenarioId(page);
    expect(newId).not.toBeNull();
    const resp = await page.request.get(`/api/scenarios/${newId}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.problemType).toBe("capacitated_pmedian");
    await page.request.delete(`/api/scenarios/${newId}`);
  });
});

// ── Cross-lab: New-button sends correct pValue defaults ───────────────────────

test.describe("New-button defaults per lab", () => {
  async function createAndFetch(page: Page, labTitle: string, expectedProblemType: string, expectedPValue: number) {
    await page.goto("/");
    await goToLab(page, labTitle);
    await createScenario(page, `Defaults check ${Date.now()}`);
    await expect(page).toHaveURL(/\/\?scenario=\d+/);
    const id = scenarioId(page);
    const resp = await page.request.get(`/api/scenarios/${id}`);
    const body = await resp.json();
    expect(body.problemType).toBe(expectedProblemType);
    expect(body.pValue).toBe(expectedPValue);
    await page.request.delete(`/api/scenarios/${id}`);
  }

  test("Al's Athletics defaults: p_median, pValue=3", async ({ page }) => {
    await createAndFetch(page, "Al's Athletics", "p_median", 3);
  });

  test("Coal Transport LP defaults: transport, pValue=1", async ({ page }) => {
    await createAndFetch(page, "Coal Transport LP", "transport", 1);
  });

  test("Brazil Capacity defaults: capacitated_pmedian, pValue=7", async ({ page }) => {
    await createAndFetch(page, "Brazil Capacity", "capacitated_pmedian", 7);
  });
});
