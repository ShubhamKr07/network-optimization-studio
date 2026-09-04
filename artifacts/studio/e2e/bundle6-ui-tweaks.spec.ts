/**
 * Browser E2E — Bundle 6 (Workspace + Landing/auth UI tweaks).
 *
 * Two blocks, per docs/superpowers/plans/2026-09-04-bundle6-ui-tweaks.md's T7:
 *
 *   (a) Authenticated (registers a fresh account, seeds via the real API,
 *       same convention as tab-coverage.spec.ts/bundle4-auth-landing.spec.ts):
 *       - T2 item 1: default-to-last-solved scenario + one-shot Input Map
 *         seeding, and that closing the last open tab leaves none open
 *         (Input Map does not silently reopen).
 *       - T2 items 2/3/5: header no longer has the scenario dropdown/email/
 *         logout; chapter summary sits on the left; the result-history
 *         stepper renders once a result exists.
 *       - T3 item 4: Solution Summary compare drops the Aggregate
 *         utilization row and hyphenates city-state.
 *       - T4 item 7: Input Map and Output Map legends are equal-width.
 *       - T1+T5 item 8: Landing hides every Chapter 5/10 card and excludes
 *         them from Recent Solves and the stats line.
 *       - T6 item 9: the Landing hero cover image is ~96px (h-24).
 *   (b) Unauthenticated (`storageState: undefined`, mirroring
 *       bundle4-auth-landing.spec.ts — `Gate` redirects an authed session
 *       away from `/login`):
 *       - T6 items 11/13: Login's Register link text + email placeholder.
 *       - T6 item 10: DeveloperCredit footer copy.
 *       - T5 item 12: the auth labs strip shows only "Chapter 3".
 *
 * Deliberately NOT covered here: `labs.spec.ts` (known debt, stale
 * remote/pre-D0 shape — excluded from this run per CLAUDE.md and the plan's
 * resolution #1, not this spec's job).
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md and
 * vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerFreshAccount(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  return email;
}

async function createPMedianScenario(page: Page, name: string, p: number): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name,
      modelId: "p-median-us",
      inputs: {
        p,
        distanceBands: [200, 400, 800, 1600],
        capacityMode: "none",
        uniformCapacity: null,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0,
        timeLimitSec: 120,
      },
    },
  });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

async function createTransportScenario(page: Page, name: string): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name,
      modelId: "transport-coal",
      inputs: {
        distanceBands: [500, 1000, 1500, 2000],
        gap: 0,
        timeLimitSec: 120,
        capacityFactor: 1.0,
        singleSource: false,
        capacityInactive: false,
      },
    },
  });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

/** Solves a scenario for real via the async job API (enqueue + poll) — the
 * same contract the UI itself drives. */
async function solveScenario(page: Page, scenarioId: number): Promise<void> {
  const solveResp = await page.request.post(`/api/scenarios/${scenarioId}/solve`);
  expect(solveResp.status()).toBe(202);
  const { jobId } = await solveResp.json();

  let status = "queued";
  for (let i = 0; i < 60 && (status === "queued" || status === "running"); i++) {
    await page.waitForTimeout(500);
    const pollResp = await page.request.get(`/api/scenarios/${scenarioId}/solve-jobs/${jobId}`);
    expect(pollResp.status()).toBe(200);
    status = (await pollResp.json()).status;
  }
  expect(status).toBe("succeeded");
}

test.describe("Bundle 6 — Workspace (authenticated)", () => {
  test("last-solved default + one-shot Input Map seeding + header cleanup + tab-close doesn't reopen", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "bundle6-workspace");

    const scenarioAId = await createPMedianScenario(page, `E2E Bundle6 A ${Date.now()}`, 3);
    await solveScenario(page, scenarioAId);
    // Solved strictly after A, so B is the last-solved scenario.
    const scenarioBId = await createPMedianScenario(page, `E2E Bundle6 B ${Date.now()}`, 4);
    await solveScenario(page, scenarioBId);

    try {
      // No ?scenario= — Workspace must default to the last-solved scenario (B).
      await page.goto("/chapter-3");
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await expect(page.getByTestId(`sidebar-scenario-${scenarioBId}`)).toHaveAttribute("aria-current", "true");
      await expect(page.getByTestId(`sidebar-scenario-${scenarioAId}`)).toHaveAttribute("aria-current", "false");

      // T2 item 1 — Input Map is auto-opened and active on entry.
      // (raw workspaceTabId, per workspaceTabId("input", "input-map") —
      // TabBar's own testids are `tab-${id}`/`tab-close-${id}`, built from
      // this below, not from an already-prefixed value.)
      const inputMapTabId = "input:input-map";
      await expect(page.getByTestId(`tab-${inputMapTabId}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // T2 items 2/3 — header no longer has the scenario dropdown, user
      // email, or logout button; the chapter summary sits on the left.
      await expect(page.getByTestId("select-scenario-context")).toHaveCount(0);
      await expect(page.getByTestId("text-user-email")).toHaveCount(0);
      await expect(page.getByTestId("button-logout")).toHaveCount(0);
      await expect(page.getByTestId("workspace-chapter-summary")).toBeVisible();
      await expect(page.getByTestId("workspace-chapter-summary")).toContainText("Chapter 3");

      // T2 item 5 — the result-history stepper renders once a result exists
      // (B is solved, so its buttons are present, even if Back starts disabled).
      await expect(page.getByTestId("button-result-back")).toBeVisible();
      await expect(page.getByTestId("button-result-forward")).toBeVisible();

      // T2 item 1 (resolution #3) — closing the last open tab leaves none
      // open; the auto-seed guard is already tripped for this model, so
      // Input Map does NOT silently reopen.
      await page.getByTestId(`tab-close-${inputMapTabId}`).click();
      await expect(page.getByTestId("tab-bar-empty")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.waitForTimeout(1_000);
      await expect(page.getByTestId("tab-bar-empty")).toBeVisible();
      await expect(page.getByTestId(`tab-${inputMapTabId}`)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioAId}`);
      await page.request.delete(`/api/scenarios/${scenarioBId}`);
    }
  });

  test("Solution Summary compare drops Aggregate utilization and hyphenates city-state", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "bundle6-compare");

    const scenarioAId = await createPMedianScenario(page, `E2E Bundle6 Compare A ${Date.now()}`, 3);
    await solveScenario(page, scenarioAId);
    const scenarioBId = await createPMedianScenario(page, `E2E Bundle6 Compare B ${Date.now()}`, 4);
    await solveScenario(page, scenarioBId);

    try {
      await page.goto(`/chapter-3?scenario=${scenarioBId}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-compare-toggles")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // B is selected by default (the active scenario); add A to compare.
      await page.getByTestId(`cost-summary-compare-toggle-${scenarioAId}`).locator("input").check();
      await expect(page.getByTestId("cost-summary-compare-table")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // T3 item 4, step 2 — no Aggregate utilization row/cell anywhere.
      await expect(page.locator('[data-testid^="cost-summary-compare-utilization-"]')).toHaveCount(0);

      // T3 item 4, step 1 — open-facilities city cell reads "<City> - <State>".
      const cityCell = page.getByTestId(`cost-summary-compare-open-facilities-cities-${scenarioBId}`);
      await expect(cityCell).toBeVisible();
      await expect(cityCell).toHaveText(/[A-Za-z].* - [A-Z]{2}/);
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioAId}`);
      await page.request.delete(`/api/scenarios/${scenarioBId}`);
    }
  });

  test("Input Map and Output Map legends are equal-width (220px)", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "bundle6-legend");

    const scenarioId = await createPMedianScenario(page, `E2E Bundle6 Legend ${Date.now()}`, 3);
    await solveScenario(page, scenarioId);

    try {
      await page.goto(`/chapter-3?scenario=${scenarioId}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-input-input-map").click();
      const inputLegend = page.getByTestId("map-legend");
      await expect(inputLegend).toBeVisible({ timeout: HEADER_TIMEOUT });
      const inputBox = await inputLegend.boundingBox();
      expect(inputBox).not.toBeNull();

      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // NetworkMap's own (Output Map) legend has no data-testid of its own —
      // scoped by its unique position/width classes within output-map-tab.
      const outputLegend = page.locator('[data-testid="output-map-tab"] div.absolute.bottom-4.right-4');
      await expect(outputLegend).toBeVisible({ timeout: HEADER_TIMEOUT });
      const outputBox = await outputLegend.boundingBox();
      expect(outputBox).not.toBeNull();

      expect(Math.round(inputBox!.width)).toBe(220);
      expect(Math.round(outputBox!.width)).toBe(220);
      expect(Math.round(inputBox!.width)).toBe(Math.round(outputBox!.width));
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});

test.describe("Bundle 6 — Landing (authenticated)", () => {
  test("hides Ch5/Ch10 cards and solves, visible-only stats, hero cover ~96px", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "bundle6-landing");

    const pmedianId = await createPMedianScenario(page, `E2E Bundle6 Landing PM ${Date.now()}`, 3);
    await solveScenario(page, pmedianId);
    const transportId = await createTransportScenario(page, `E2E Bundle6 Landing Transport ${Date.now()}`);
    await solveScenario(page, transportId);

    try {
      await page.goto("/");
      await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });

      // T5 item 8 — no Ch5/Ch10 cards, only Chapter 3.
      await expect(page.getByTestId("link-/chapter-3")).toBeVisible();
      for (const path of ["/chapter-5/transport", "/chapter-5/brazil", "/chapter-10/gold-refinery"]) {
        await expect(page.getByTestId(`link-${path}`)).toHaveCount(0);
      }

      // T1+T5 item 8 — stats line counts visible-only (the transport-coal
      // solve is excluded).
      await expect(page.getByTestId("landing-stats-line")).toHaveText(
        "1 labs · 1 scenarios · 1 solved",
        { timeout: HEADER_TIMEOUT },
      );

      // The p-median-us solve shows in Recent Solves; the transport-coal one
      // does not.
      await expect(page.getByText(/Chapter 3 ·/)).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByText(/Chapter 5 ·/)).toHaveCount(0);

      // T6 item 9 — the hero cover image is h-24 (~96px).
      const coverImg = page.locator('header img[alt=""]');
      await expect(coverImg).toBeVisible();
      await expect(coverImg).toHaveClass(/h-24/);
    } finally {
      await page.request.delete(`/api/scenarios/${pmedianId}`);
      await page.request.delete(`/api/scenarios/${transportId}`);
    }
  });
});

test.describe("Bundle 6 — Login/auth copy (unauthenticated)", () => {
  // Mirrors bundle4-auth-landing.spec.ts's own unauthenticated block: `Gate`
  // redirects an authed session away from `/login`, so this must run with no
  // session at all.
  test.use({ storageState: undefined });

  test("/login shows the Register link, example.com placeholder, footer copy, and Chapter-3-only labs strip", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("auth-shell")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // T6 item 11 — register link text is exactly "Register".
    const registerLink = page.getByRole("link", { name: "Register", exact: true });
    await expect(registerLink).toBeVisible();
    await expect(page.getByText("Register with your course email")).toHaveCount(0);

    // T6 item 13 — email placeholder is you@example.com.
    await expect(page.getByTestId("input-email")).toHaveAttribute("placeholder", "you@example.com");

    // T6 item 10 — footer copy is "Reach out at".
    await expect(page.getByTestId("auth-credit")).toContainText("Reach out at");
    await expect(page.getByTestId("auth-credit")).not.toContainText("Reach me out at");

    // T5 item 12 — the labs strip shows only "Chapter 3".
    await expect(page.getByTestId("auth-labs-strip")).toHaveText("Chapter 3");
  });
});
