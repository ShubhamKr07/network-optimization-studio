/**
 * Browser E2E tests — each lab's user journey.
 *
 * Covers: registration/login, header labels, configure panel controls,
 * New-scenario button creating the correct problemType/pValue, and
 * BrazilMap vs NetworkMap rendering.
 *
 * Target: E2E_BASE_URL env var (defaults to the Replit deployment).
 * Run locally with: pnpm test:e2e
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

// ── auth helper ───────────────────────────────────────────────────────────────

/**
 * Register a fresh account (unique email per call) and land on Studio.
 * Uses a direct API call rather than the login form so per-lab setup stays
 * fast and focused on Studio behavior — the Login page itself gets its own
 * dedicated UI-driven test below.
 */
async function registerAndGoHome(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
  return email;
}

// ── nav helpers ───────────────────────────────────────────────────────────────

/** Returns the ?scenario= query param from the current URL. */
function scenarioId(page: Page): string | null {
  return new URL(page.url()).searchParams.get("scenario");
}

/**
 * Create a scenario of the given shape via the API (fast, avoids depending on
 * UI that doesn't exist yet — chapter-based lab switching lands in B1.1) and
 * navigate straight to it via the URL, which is how Studio has always read
 * the active scenario.
 */
async function createAndGoToScenario(
  page: Page,
  body: Record<string, unknown>,
  expectedHeader: RegExp,
): Promise<string> {
  const resp = await page.request.post("/api/scenarios", { data: body });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/?scenario=${id}`);
  await expect(page.getByText(expectedHeader)).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
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

// ── Login page ──────────────────────────────────────────────────────────────

test.describe("Login", () => {
  test("registering via the UI form lands on Studio", async ({ page }) => {
    const email = `e2e-ui-${Date.now()}@test.com`;
    await page.goto("/register");
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill("correcthorse1");
    await page.getByTestId("button-register").click();
    await expect(page.getByTestId("text-user-email")).toHaveText(email, { timeout: 8_000 });
  });

  test("unauthenticated visit redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/, { timeout: 8_000 });
  });
});

// ── Lab 1: Al's Athletics (P-Median) ─────────────────────────────────────────

test.describe("Lab 1 — Al's Athletics (P-Median)", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoHome(page);
    await createAndGoToScenario(
      page,
      {
        name: `E2E P-Median ${Date.now()}`,
        problemType: "p_median",
        pValue: 3,
        distanceBands: [200, 400, 800, 1600],
        solver: "cbc",
        gap: 0,
        timeLimitSec: 120,
        capacityMode: "uniform",
        uniformCapacity: null,
        warehouseStatuses: [],
      },
      /Al's Athletics · Model Lab/,
    );
  });

  test("header shows Al's Athletics · Model Lab", async ({ page }) => {
    await expect(page.getByText(/Al's Athletics · Model Lab/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("header subtitle shows p-median", async ({ page }) => {
    await expect(page.getByText(/Ch 3 · p-median/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("configure panel shows Warehouses to open (P)", async ({ page }) => {
    await expect(page.getByText("Warehouses to open (P)")).toBeVisible();
  });

  test("configure panel shows Warehouse status section", async ({ page }) => {
    await expect(page.getByText("Warehouse status", { exact: true })).toBeVisible();
  });

  test("configure panel does NOT show Mine capacity factor", async ({ page }) => {
    await expect(page.getByText("Mine capacity factor")).not.toBeVisible();
  });

  test("New button creates a p_median scenario with pValue 3", async ({ page }) => {
    await clickNewAndWait(page, `E2E P-Median New ${Date.now()}`);
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
    await registerAndGoHome(page);
    await createAndGoToScenario(
      page,
      {
        name: `E2E Transport ${Date.now()}`,
        problemType: "transport",
        pValue: 1,
        distanceBands: [500, 1000, 1500, 2000],
        solver: "cbc",
        gap: 0,
        timeLimitSec: 120,
        capacityFactor: 1.0,
        singleSource: false,
        capacityInactive: false,
      },
      /Coal Transport LP · Model Lab/,
    );
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
    await expect(page.getByText("Single-source", { exact: true })).toBeVisible();
  });

  test("configure panel shows Ignore capacity toggle", async ({ page }) => {
    await expect(page.getByText("Ignore capacity", { exact: true })).toBeVisible();
  });

  test("configure panel does NOT show Warehouse status section", async ({ page }) => {
    await expect(page.getByText("Warehouse status", { exact: true })).not.toBeVisible();
  });

  test("New button creates a transport scenario with pValue 1", async ({ page }) => {
    await clickNewAndWait(page, `E2E Transport New ${Date.now()}`);
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

test.describe("Lab 3 — Brazil Capacity", () => {
  let brazilId: string;

  test.beforeEach(async ({ page }) => {
    await registerAndGoHome(page);
    brazilId = await createAndGoToScenario(
      page,
      {
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
      /Brazil Capacity · Model Lab/,
    );
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
