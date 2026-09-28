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
 *       - T4 item 7 (Bundle 6.1, T1, resolution #4): Input Map and Output
 *         Map legends both use the shared `map-legend` component and are
 *         content-fit (no more fixed 220px equal-width contract — Bundle
 *         6.1's T1 replaced the fixed-width legend with a content-fit
 *         `max-w` box; see bundle6.1-legend-distances.spec.ts for the
 *         full legend-ramp/Output-states coverage).
 *       - T1+T5 item 8: Landing hides the transport-coal/p-median-brazil
 *         (Chapter 5, retired) and two-echelon-gold-au (Chapter 10) cards
 *         and excludes them from Recent Solves and the stats line.
 *         delivery-teaching-us (also Chapter 5, Ch.5 modified) is a
 *         DIFFERENT model and is visible — see the "Chapter 5 ·" presence
 *         check below.
 *       - T6 item 9: the Landing hero cover image is ~96px (h-24).
 *   (b) Unauthenticated (`storageState: undefined`, mirroring
 *       bundle4-auth-landing.spec.ts — `Gate` redirects an authed session
 *       away from `/login`):
 *       - T6 items 11/13: Login's Register link text + email placeholder.
 *       - T6 item 10: DeveloperCredit footer copy.
 *       - T5 item 12: the auth labs strip shows the visible chapters
 *         (Chapter 3, Chapter 4, Chapter 5, Chapter 9).
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

/** delivery-teaching-us — Chapter 5 (modified), visible on Landing (unlike
 * transport-coal/p-median-brazil, the retired Chapter 5 models this file
 * otherwise keeps hidden). Toggle off (costAdjustEnabled: false) is the
 * case study's Scenario 1 — a real, fast (~4s) CBC solve. */
async function createDeliveryScenario(page: Page, name: string): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name,
      modelId: "delivery-teaching-us",
      inputs: {
        p: 3,
        distanceBands: [400, 800, 1200, 1600],
        gap: 0,
        timeLimitSec: 300,
        costAdjustEnabled: false,
        distanceThreshold: 800,
        costPerMile: 1,
        costPerMileOver: 10,
        laneCostOverrides: [],
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

  test("Input Map and Output Map legends both render via the shared map-legend component, content-fit (not a fixed 220px)", async ({ page }) => {
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
      // Bundle 6.1 (T1, resolution #4) — content-fit (`w-fit max-w-[260px]`),
      // not a fixed 220px box.
      await expect(inputLegend).toHaveClass(/max-w-\[260px\]/);
      const inputBox = await inputLegend.boundingBox();
      expect(inputBox).not.toBeNull();
      expect(inputBox!.width).toBeLessThanOrEqual(260);
      // Every swatch cell contains its SVG without overflowing it (the
      // literal DoD bundle6.1-legend-distances.spec.ts asserts in full for
      // every bucket/status — spot-checked here too since this file is the
      // one that originally caught the pre-T1 clipping/220px regression).
      const firstStatusCell = page.getByTestId("legend-status-active");
      await expect(firstStatusCell).toBeVisible();
      const cellBox = await firstStatusCell.boundingBox();
      const svgBox = await firstStatusCell.locator("svg").boundingBox();
      expect(cellBox).not.toBeNull();
      expect(svgBox).not.toBeNull();
      expect(svgBox!.width).toBeLessThanOrEqual(cellBox!.width + 0.5);
      expect(svgBox!.height).toBeLessThanOrEqual(cellBox!.height + 0.5);

      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // Bundle 6.1 (T1, resolution #4) — the Output legend is now the SAME
      // shared component (`data-testid="map-legend"`), not a class-only
      // selector scoped to output-map-tab's old bespoke inline legend.
      const outputLegend = page.locator('[data-testid="output-map-tab"] [data-testid="map-legend"]');
      await expect(outputLegend).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(outputLegend).toHaveClass(/max-w-\[260px\]/);
      const outputBox = await outputLegend.boundingBox();
      expect(outputBox).not.toBeNull();
      expect(outputBox!.width).toBeLessThanOrEqual(260);
    } finally {
      await page.request.delete(`/api/scenarios/${scenarioId}`);
    }
  });
});

test.describe("Bundle 6 — Landing (authenticated)", () => {
  test("hides the retired Ch5 cards (delivery-teaching-us visible), visible-only stats, hero cover ~96px", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "bundle6-landing");

    const pmedianId = await createPMedianScenario(page, `E2E Bundle6 Landing PM ${Date.now()}`, 3);
    await solveScenario(page, pmedianId);
    const transportId = await createTransportScenario(page, `E2E Bundle6 Landing Transport ${Date.now()}`);
    await solveScenario(page, transportId);
    const deliveryId = await createDeliveryScenario(page, `E2E Bundle6 Landing Delivery ${Date.now()}`);
    await solveScenario(page, deliveryId);

    try {
      await page.goto("/");
      await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });

      // T5 item 8 — no transport-coal/p-median-brazil (Chapter 5, retired)
      // card; Chapter 3, Chapter 4, and delivery-teaching-us (Chapter 5,
      // Ch.5 modified) are visible links. Chapter 9 (JADE) is visible but
      // ch4-lock makes it an inert "locked" wrapper, not a link. Chapter 10
      // stays hiddenFromLanding entirely (a different thing from locked) —
      // see bundle4-auth-landing.spec.ts's matching baseline assertions.
      await expect(page.getByTestId("link-/chapter-3")).toBeVisible();
      await expect(page.getByTestId("link-/chapter-4")).toBeVisible();
      await expect(page.getByTestId("link-/chapter-5/delivery")).toBeVisible();
      await expect(page.getByTestId("link-/chapter-9/jade")).toHaveCount(0);
      await expect(page.getByTestId("locked-/chapter-9/jade")).toHaveCount(1);
      for (const path of ["/chapter-10/gold-refinery", "/chapter-5/transport", "/chapter-5/brazil"]) {
        await expect(page.getByTestId(`link-${path}`)).toHaveCount(0);
      }

      // T1+T5 item 8 — stats line counts visible-only (the transport-coal
      // solve is excluded; Chapter 9 is visible but has no scenarios here).
      await expect(page.getByTestId("landing-stats-line")).toHaveText(
        "4 labs · 2 scenarios · 2 solved",
        { timeout: HEADER_TIMEOUT },
      );

      // The p-median-us AND delivery-teaching-us solves show in Recent
      // Solves; the transport-coal one (hiddenFromLanding) does not. This
      // is a PRESENCE check, not the old count-0 — the moment
      // delivery-teaching-us shipped visible, "Chapter 5 ·" started
      // appearing in Recent Solves for real.
      await expect(page.getByText(/Chapter 3 ·/)).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByText(/Chapter 5 ·/)).toBeVisible({ timeout: HEADER_TIMEOUT });

      // T6 item 9 — the hero cover image is h-24 (~96px).
      const coverImg = page.locator('header img[alt=""]');
      await expect(coverImg).toBeVisible();
      await expect(coverImg).toHaveClass(/h-24/);
    } finally {
      await page.request.delete(`/api/scenarios/${pmedianId}`);
      await page.request.delete(`/api/scenarios/${transportId}`);
      await page.request.delete(`/api/scenarios/${deliveryId}`);
    }
  });
});

test.describe("Bundle 6 — Login/auth copy (unauthenticated)", () => {
  // Mirrors bundle4-auth-landing.spec.ts's own unauthenticated block: `Gate`
  // redirects an authed session away from `/login`, so this must run with no
  // session at all.
  test.use({ storageState: undefined });

  test("/login shows the Register link, example.com placeholder, footer copy, and the visible-chapters labs strip", async ({ page }) => {
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

    // The labs strip shows the visible (non-hiddenFromLanding) chapters —
    // Chapter 3, Chapter 4, Chapter 5 (delivery-teaching-us), and Chapter 9
    // (JADE, visible though ch4-lock makes it inert on Landing). Chapter 10,
    // transport-coal, and p-median-brazil stay hiddenFromLanding, so none of
    // them appear here regardless of lock state — see
    // bundle4-auth-landing.spec.ts's matching assertion.
    await expect(page.getByTestId("auth-labs-strip")).toHaveText("Chapter 3Chapter 4Chapter 5Chapter 9");
  });
});
