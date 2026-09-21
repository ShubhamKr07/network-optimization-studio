/**
 * Browser E2E — QA gate for the `chen-bands-units` bundle (Task 15).
 *
 * Exercises, in a real browser against local dev servers, the properties a
 * unit test cannot: unit-toggle round-trips, the "never a wrong-unit
 * render" placeholder discipline, Chen's free band editor (add/remove/
 * overflow/live-recolor-without-re-solve), unit-aware distance-edit commit
 * correctness (no drift across repeated toggles, incomplete drafts never
 * commit), the result-history read-only/dirty-nav-prompt contract
 * (including a genuinely rejected Save), and the export-control gating
 * (unit= on the wire, input-exports disabled while browsing history).
 *
 * Each test registers its own disposable account and cleans up its own
 * scenario(s) in a `finally` block, matching this repo's established e2e
 * convention (see chens-cosmetics.spec.ts).
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 120_000;

interface ScenarioResult {
  status: string;
  objective: number;
  edges: Array<{ fromId: string; toId: string; distance: number; flow: number }>;
  details: { objective?: string; coveragePct?: number; openWarehouseIds?: string[] };
  metrics: { weightedAvgDistance?: number };
}

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-chenqa-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

function chenCoverageInputs(overrides: Record<string, unknown> = {}) {
  return {
    objective: "coverage",
    p: 3,
    highServiceDistKm: 600,
    maxDistKm: 5000,
    avgServiceDistCapKm: 1000,
    gap: 0,
    timeLimitSec: 120,
    capacityMode: "none",
    distanceBands: [600, 5000],
    warehouseOverrides: [],
    customerOverrides: [],
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
    ...overrides,
  };
}

function pMedianInputs() {
  return {
    p: 3,
    distanceBands: [200, 400, 800, 1600],
    capacityMode: "none",
    uniformCapacity: null,
    warehouseOverrides: [],
    customerOverrides: [],
    gap: 0,
    timeLimitSec: 120,
  };
}

async function createScenario(page: Page, modelId: string, chapterPath: string, inputs: unknown): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E ChenQA ${modelId} ${Date.now()}`, modelId, inputs },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`${chapterPath}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

async function getScenario(page: Page, id: string): Promise<{ solvedAt: string | null; result: ScenarioResult | null; resultRunId: number | null }> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  return resp.json();
}

/** Trigger a solve via the Run Optimizer dialog, then poll until `solvedAt`
 * advances past `before` — same precise-completion signal chens-cosmetics.spec.ts
 * uses. */
async function solveViaUi(page: Page, id: string): Promise<ScenarioResult> {
  const before = (await getScenario(page, id)).solvedAt;
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });

  let fresh: ScenarioResult | null = null;
  await expect
    .poll(async () => {
      const s = await getScenario(page, id);
      if (s.result != null && s.solvedAt != null && s.solvedAt !== before) {
        fresh = s.result;
        return true;
      }
      return false;
    }, { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
    .toBe(true);
  expect(fresh).not.toBeNull();
  expect(fresh!.status).toBe("optimal");
  return fresh!;
}

async function saveViaHeader(page: Page): Promise<void> {
  const save = page.getByTestId("button-save").first();
  await expect(save).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await save.click();
  await expect(save).toBeDisabled({ timeout: HEADER_TIMEOUT });
}

test.describe("chen-bands-units QA — unit toggle + no-wrong-unit-render", () => {
  test("unit toggle converts every distance surface, persists across reload, auto is a no-op; Chen (km) and p-median-us (mi) both correct", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const chenId = await createScenario(page, "chens-cosmetics-cn", "/chapter-4", chenCoverageInputs());

    try {
      await solveViaUi(page, chenId);

      // Auto (default): Chen's canonical is km — cost summary shows km, never mi.
      await page.getByTestId("sidebar-output-cost-summary").click();
      const wavg = page.getByTestId("cost-summary-value-weighted-avg-distance");
      await expect(wavg).toContainText("km", { timeout: HEADER_TIMEOUT });
      const autoText = (await wavg.innerText()).trim();
      const autoValue = Number(autoText.replace(/[^0-9.]/g, ""));
      expect(autoValue).toBeGreaterThan(0);

      // Toggle to mi — the SAME underlying canonical value now renders in mi,
      // converted (not identical to the km number, not "km" mislabeled as "mi").
      await page.getByTestId("unit-toggle-mi").click();
      await expect(page.getByTestId("unit-toggle-mi")).toHaveAttribute("aria-pressed", "true");
      await expect(wavg).toContainText("mi", { timeout: HEADER_TIMEOUT });
      const miText = (await wavg.innerText()).trim();
      const miValue = Number(miText.replace(/[^0-9.]/g, ""));
      // km -> mi divides by 1.609344 — confirm the conversion actually happened
      // (not just a relabeled identical number).
      expect(miValue).toBeLessThan(autoValue);
      expect(miValue).toBeCloseTo(autoValue / 1.609344, 0);

      // Reload — the "mi" preference persists (localStorage), Chen still shows
      // its OWN canonical-derived mi value, not a stale/guessed one.
      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("unit-toggle-mi")).toHaveAttribute("aria-pressed", "true", { timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-weighted-avg-distance")).toContainText("mi", { timeout: HEADER_TIMEOUT });

      // "auto" is a genuine no-op: switching back re-renders the model's own
      // canonical unit (km for Chen), matching the very first reading exactly.
      await page.getByTestId("unit-toggle-auto").click();
      await expect(page.getByTestId("unit-toggle-auto")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("cost-summary-value-weighted-avg-distance")).toContainText("km", { timeout: HEADER_TIMEOUT });
      const autoAgainText = (await page.getByTestId("cost-summary-value-weighted-avg-distance").innerText()).trim();
      expect(autoAgainText).toBe(autoText);
    } finally {
      await page.request.delete(`/api/scenarios/${chenId}`);
    }

    // Cross-model: p-median-us is mi-canonical. The SAME global "mi" toggle
    // preference must not force a wrong conversion on an already-mi model —
    // "auto"/"mi" must render identically for a model whose canonical unit IS mi.
    const pmId = await createScenario(page, "p-median-us", "/chapter-3", pMedianInputs());
    try {
      await page.getByTestId("unit-toggle-auto").click();
      await solveViaUi(page, pmId);
      await page.getByTestId("sidebar-output-cost-summary").click();
      const pmAuto = (await page.getByTestId("cost-summary-value-weighted-avg-distance").innerText()).trim();
      expect(pmAuto).toContain("mi");

      await page.getByTestId("unit-toggle-mi").click();
      const pmMi = (await page.getByTestId("cost-summary-value-weighted-avg-distance").innerText()).trim();
      expect(pmMi).toBe(pmAuto); // auto === mi for an already-mi-canonical model
    } finally {
      await page.request.delete(`/api/scenarios/${pmId}`);
    }
  });

  test("no distance ever renders under a guessed unit while the model manifest is still loading", async ({ page }) => {
    test.setTimeout(60_000);
    await registerAndGoHome(page);
    // Register + go home already primed one /api/models fetch (Landing may
    // fetch it) — create the scenario via a plain API call (no navigation)
    // so the NEXT navigation below is genuinely the first time this page
    // instance requests /api/models for the Workspace mount. React Query's
    // cache is per-QueryClient-instance (recreated on a full page load), so
    // a fresh `page.goto` still re-fetches regardless of Landing's own
    // earlier fetch — the important thing is the route delay is installed
    // BEFORE that navigation.
    const createResp = await page.request.post("/api/scenarios", {
      data: { name: `E2E ChenQA loading ${Date.now()}`, modelId: "chens-cosmetics-cn", inputs: chenCoverageInputs() },
    });
    expect(createResp.status()).toBe(201);
    const chenId = String((await createResp.json()).id);

    try {
      // Delay /api/models so the manifest genuinely has not resolved by the
      // time the page first paints — the real "unresolved canonical unit"
      // window this bundle's whole "no fallback unit" contract exists for.
      await page.route("**/api/models", async route => {
        await new Promise(r => setTimeout(r, 3000));
        await route.continue();
      });

      await page.goto(`/chapter-4?scenario=${chenId}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Optimization Parameters: the band editor must show the disabled
      // "Loading distance unit…" placeholder, never a bare "Distance bands
      // (mi)" guess.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("bands-unit-pending")).toBeVisible({ timeout: 2_000 });
      await expect(page.getByTestId("button-bands-plus")).toBeDisabled();
      // No band chip (which would show a converted mi number) is present yet.
      await expect(page.getByTestId("band-600")).toHaveCount(0);

      // Distances tab: the override input is disabled/empty while unresolved.
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const addBtn = page.getByTestId("button-add-distance-row");
      await addBtn.click();
      const valueInput = page.getByTestId("input-new-distance-value");
      await expect(valueInput).toBeDisabled();
      await expect(valueInput).toHaveValue("");

      // Once the manifest resolves (route delay elapses), the real km-labeled
      // content replaces the placeholder — proving this was a genuine
      // load-then-resolve transition, not a permanently-broken editor.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("bands-unit-pending")).toHaveCount(0, { timeout: 6_000 });
      await expect(page.getByTestId("band-600")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByText("Distance bands (km)")).toBeVisible();
    } finally {
      await page.unroute("**/api/models");
      await page.request.delete(`/api/scenarios/${chenId}`);
    }
  });
});

test.describe("chen-bands-units QA — free band editor, overflow bucket, live recolor", () => {
  test("add/remove bands, last-boundary guard, non-integer boundary accepted, live recolor with no re-solve, overflow bucket rendered and never unit-converted", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "chens-cosmetics-cn", "/chapter-4", chenCoverageInputs());

    try {
      await solveViaUi(page, id);

      // Baseline: default bands [600, 5000] km. The real max edge distance in
      // this dataset (~4178 km) is under 5000, so nothing is overflow yet.
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("checkbox-color-lanes-band")).toBeChecked({ timeout: HEADER_TIMEOUT });
      const overflowPathsBefore = page.locator('path.leaflet-interactive[stroke="var(--band-overflow)"]');
      await expect(overflowPathsBefore).toHaveCount(0);

      // ── Band editor: add, remove, last-boundary guard ───────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("band-600")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("band-5000")).toBeVisible();

      // Add a boundary well below the farthest edge (~4178 km) so several
      // routes fall beyond it once we remove the 5000 boundary.
      await page.getByTestId("button-bands-plus").click();
      await page.getByTestId("input-new-band").fill("2000");
      await page.getByTestId("button-add-band-confirm").click();
      await expect(page.getByTestId("band-2000")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("button-remove-band-5000").click();
      await expect(page.getByTestId("band-5000")).toHaveCount(0);
      // Bands now [600, 2000] — length 2, both removable.
      await expect(page.getByTestId("button-remove-band-600")).toBeEnabled();
      await expect(page.getByTestId("button-remove-band-2000")).toBeEnabled();

      // ── Live recolor WITHOUT saving or re-solving ───────────────────────
      // Still on Optimization Parameters — the lens is dirty but nothing has
      // been saved/solved yet. Switch straight to the Output Map: the
      // 2000 km boundary must already recolor overflow lanes (>2000 km),
      // proving this is a client-side reporting lens, not tied to a re-solve.
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("checkbox-color-lanes-band")).toBeChecked({ timeout: HEADER_TIMEOUT });
      const overflowPathsAfter = page.locator('path.leaflet-interactive[stroke="var(--band-overflow)"]');
      await expect(async () => {
        expect(await overflowPathsAfter.count()).toBeGreaterThan(0);
      }).toPass({ timeout: 8_000 });

      // Service Stats: an explicit overflow row (`band: -1`), with a "> X km"
      // label — the sentinel itself is never run through the unit converter
      // (no "-0.62"-style nonsense possible: the label text has no "-" sign).
      await page.getByTestId("sidebar-output-service-stats").click();
      const overflowRow = page.getByTestId("service-stats-band--1");
      await expect(overflowRow).toBeVisible({ timeout: HEADER_TIMEOUT });
      const overflowLabel = (await overflowRow.innerText()).trim();
      expect(overflowLabel.startsWith(">")).toBe(true);
      expect(overflowLabel).not.toMatch(/-\d/); // no negative distance ever rendered

      // ── Non-integer boundary via unit toggle ────────────────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("unit-toggle-mi").click();
      await page.getByTestId("button-bands-plus").click();
      await page.getByTestId("input-new-band").fill("150.25");
      await page.getByTestId("button-add-band-confirm").click();
      // fromDisplay(150.25, "mi" -> "km") = 150.25 * 1.609344 = 241.803936,
      // roundForFile (4dp) = 241.8039 — a genuinely non-integer canonical band.
      await expect(page.getByTestId("band-241.8039")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("unit-toggle-auto").click();

      // ── Removal blocked at the last boundary ────────────────────────────
      await page.getByTestId("button-remove-band-600").click();
      await expect(page.getByTestId("band-600")).toHaveCount(0);
      await page.getByTestId("button-remove-band-2000").click();
      await expect(page.getByTestId("band-2000")).toHaveCount(0);
      // Exactly one boundary left (241.8039) — its own remove button is
      // disabled, and clicking it (even forcibly) must not empty the array.
      await expect(page.getByTestId("button-remove-band-241.8039")).toBeDisabled();
      await page.getByTestId("button-remove-band-241.8039").click({ force: true });
      await expect(page.getByTestId("band-241.8039")).toBeVisible();
      await expect(page.getByTestId("distance-bands-empty")).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("chen-bands-units QA — distance-edit commit correctness", () => {
  test("unit-aware commit stores the correct canonical value, repeated toggles introduce no drift, an incomplete draft never commits", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "chens-cosmetics-cn", "/chapter-4", chenCoverageInputs());

    try {
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // ── Incomplete draft never commits ──────────────────────────────────
      await page.getByTestId("button-add-distance-row").click();
      await page.getByTestId("input-new-distance-from").fill("wh-40");
      await page.getByTestId("input-new-distance-to").fill("cs-4");
      await page.getByTestId("input-new-distance-value").fill("5.");
      await page.getByTestId("button-add-distance-confirm").click();
      // Row was not added — the incomplete draft never reached `onCommit`, so
      // the add-row's value field (which has no anchor value to revert to)
      // reverts to blank rather than committing "5" or keeping "5." on screen.
      await expect(page.getByTestId("text-add-distance-error")).toContainText("Distance must be a positive number.", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("input-new-distance-value")).toHaveValue("");
      await expect(page.getByTestId("input-distance-wh-40-cs-4")).toHaveCount(0);

      await page.getByTestId("input-new-distance-value").fill("5e");
      await page.getByTestId("button-add-distance-confirm").click();
      await expect(page.getByTestId("text-add-distance-error")).toContainText("Distance must be a positive number.");
      await expect(page.getByTestId("input-distance-wh-40-cs-4")).toHaveCount(0);

      // ── Now commit a real value (km, since unit=auto for Chen) ──────────
      await page.getByTestId("input-new-distance-value").fill("500");
      await page.getByTestId("button-add-distance-confirm").click();
      // The merged base+override table is paginated (50/page) and this pair
      // may not land on page 1 — filter down to it (same pattern the
      // Distances tab's own filter fields exist for).
      await page.getByTestId("input-filter-from").fill("wh-40");
      await page.getByTestId("input-filter-to").fill("cs-4");
      await expect(page.getByTestId("input-distance-wh-40-cs-4")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("input-distance-wh-40-cs-4")).toHaveValue("500");
      await saveViaHeader(page);

      const inputsResp = await page.request.get(`/api/scenarios/${id}`);
      const scenarioBody = await inputsResp.json();
      const savedOverride = (scenarioBody.inputs.distanceOverrides as Array<{ fromId: string; toId: string; distance: number }>).find(
        o => o.fromId === "wh-40" && o.toId === "cs-4",
      );
      expect(savedOverride).toBeDefined();
      expect(savedOverride!.distance).toBe(500);

      // ── Toggle to mi: displays the converted value ──────────────────────
      await page.getByTestId("unit-toggle-mi").click();
      const miText1 = await page.getByTestId("input-distance-wh-40-cs-4").inputValue();
      // roundForFile(toDisplay(500, "km"->"mi")) = round(500/1.609344, 4dp)
      expect(Number(miText1)).toBeCloseTo(500 / 1.609344, 3);

      // ── Repeated toggles introduce no drift ─────────────────────────────
      await page.getByTestId("unit-toggle-auto").click();
      const kmText2 = await page.getByTestId("input-distance-wh-40-cs-4").inputValue();
      expect(kmText2).toBe("500");
      await page.getByTestId("unit-toggle-mi").click();
      const miText2 = await page.getByTestId("input-distance-wh-40-cs-4").inputValue();
      expect(miText2).toBe(miText1); // idempotent — not accumulating drift
      await page.getByTestId("unit-toggle-km").click();
      const kmText3 = await page.getByTestId("input-distance-wh-40-cs-4").inputValue();
      expect(kmText3).toBe("500");

      // ── Edit while displayed in mi: confirm the stored CANONICAL value ──
      await page.getByTestId("unit-toggle-mi").click();
      const overrideInput = page.getByTestId("input-distance-wh-40-cs-4");
      await overrideInput.fill("310.6034");
      await overrideInput.blur();
      await saveViaHeader(page);

      const finalBody = await (await page.request.get(`/api/scenarios/${id}`)).json();
      const finalOverride = (finalBody.inputs.distanceOverrides as Array<{ fromId: string; toId: string; distance: number }>).find(
        o => o.fromId === "wh-40" && o.toId === "cs-4",
      );
      expect(finalOverride).toBeDefined();
      // fromDisplay(310.6034, "mi"->"km") = 310.6034 * 1.609344
      expect(finalOverride!.distance).toBeCloseTo(310.6034 * 1.609344, 3);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("chen-bands-units QA — history read-only + dirty-nav prompt", () => {
  test("ordinary editors no-op while browsing history, band lens stays editable, dirty-nav prompt: cancel/discard/reject-save/succeed", async ({ page }) => {
    test.setTimeout(300_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "chens-cosmetics-cn", "/chapter-4", chenCoverageInputs());

    try {
      // Two solves -> two history entries.
      await solveViaUi(page, id);
      // Trivial ordinary edit + re-solve so history has a genuinely distinct 2nd entry.
      await page.getByTestId("sidebar-input-customers").click();
      const demandInput = page.locator('[data-testid^="input-customer-demand-"]').first();
      await expect(demandInput).toBeVisible({ timeout: HEADER_TIMEOUT });
      const original = Number(await demandInput.inputValue()) || 0;
      await demandInput.fill(String(original + 1000));
      await saveViaHeader(page);
      await solveViaUi(page, id);

      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2", { timeout: HEADER_TIMEOUT });

      // A successful solve auto-switches the active tab to Output Map
      // (Workspace.tsx's jobStatus effect) — reopen Customers before reading it.
      await page.getByTestId("sidebar-input-customers").click();
      await expect(page.locator('[data-testid^="input-customer-demand-"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });

      // ── Create an ordinary dirty edit at the LATEST entry ───────────────
      const demandInput2 = page.locator('[data-testid^="input-customer-demand-"]').first();
      const demand2TestId = (await demandInput2.getAttribute("data-testid"))!;
      const dirtyCustomerId = demand2TestId.replace("input-customer-demand-", "");
      const beforeDirtyValue = await demandInput2.inputValue();
      await demandInput2.fill(String(Number(beforeDirtyValue) + 500));

      // ── Step back -> dirty-nav prompt intercepts navigation ─────────────
      await page.getByTestId("button-result-back").click();
      await expect(page.getByTestId("dirty-nav-prompt")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // Index/draft untouched while the prompt is merely open.
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2");

      // ── Cancel: leaves index AND draft completely untouched ─────────────
      await page.getByTestId("dirty-nav-cancel").click();
      await expect(page.getByTestId("dirty-nav-prompt")).toHaveCount(0);
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2");
      await expect(page.locator('[data-testid^="input-customer-demand-"]').first()).toHaveValue(String(Number(beforeDirtyValue) + 500));

      // ── Reject Save: intercept the whole-input PATCH to fail ────────────
      await page.getByTestId("button-result-back").click();
      await expect(page.getByTestId("dirty-nav-prompt")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.route(`**/api/scenarios/${id}`, async route => {
        if (route.request().method() === "PATCH") {
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated failure" }) });
        } else {
          await route.continue();
        }
      });
      await page.getByTestId("dirty-nav-save").click();
      await expect(page.getByTestId("save-error")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // A rejected Save leaves BOTH the index and the draft exactly as they were.
      await expect(page.getByTestId("dirty-nav-prompt")).toBeVisible();
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2");
      await page.unroute(`**/api/scenarios/${id}`);
      // Confirm server-side truly unaffected by the rejected attempt: the
      // dirty customer's PERSISTED demand override must NOT reflect the
      // +500 edit that failed to save (either absent, or still whatever it
      // was before this dirty edit — never the rejected value).
      const serverBodyAfterReject = await (await page.request.get(`/api/scenarios/${id}`)).json();
      const persistedOverride = (serverBodyAfterReject.inputs.customerOverrides as Array<{ id: string; demand?: number }>).find(
        o => o.id === dirtyCustomerId,
      );
      const rejectedValue = Number(beforeDirtyValue) + 500;
      expect(persistedOverride?.demand).not.toBe(rejectedValue);

      // ── Real Save now succeeds -> navigation proceeds ───────────────────
      await page.getByTestId("dirty-nav-save").click();
      await expect(page.getByTestId("dirty-nav-prompt")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-result-history-position")).toHaveText("1/2", { timeout: HEADER_TIMEOUT });

      // ── Now at an OLDER (historical) entry: ordinary editors no-op ──────
      // NOTE (real finding, not asserted as a defect here — see the final
      // report): `CustomerTable`/`WarehouseTable` keep their own per-cell
      // local `drafts` state (component-local, keyed by id, populated on
      // every keystroke) with no reset tied to `isBrowsingHistoryNow` — so
      // the input VISUALLY keeps whatever was typed rather than reverting,
      // even though `updateInputsField`'s guard correctly no-ops the
      // underlying `localInputs` write. This test asserts the DATA-SAFETY
      // half (Save never enables from this keystroke; the server-persisted
      // value is untouched), not the visual-revert half.
      const histDemandTestId = (await page.locator('[data-testid^="input-customer-demand-"]').first().getAttribute("data-testid"))!;
      const histDemandCustomerId = histDemandTestId.replace("input-customer-demand-", "");
      const histDemand = page.getByTestId(histDemandTestId);
      await histDemand.fill("999999999");
      await histDemand.blur();
      await page.waitForTimeout(300);
      // The guarded no-op means this edit never became a real (ordinary)
      // dirty draft — Save must NOT be enabled purely from this keystroke
      // (it may still read "Save bands" and be enabled from the earlier
      // lens save's already-clean state, or disabled entirely).
      const saveAfterStrayEdit = page.getByTestId("button-save").first();
      const strayEditSaveLabel = (await saveAfterStrayEdit.innerText()).trim();
      if (strayEditSaveLabel === "Save") {
        await expect(saveAfterStrayEdit).toBeDisabled();
      }
      // Confirm no data corruption directly against the server: the stray
      // "999999999" must never appear in the persisted customerOverrides,
      // regardless of what the (unreverted) input visually shows.
      const serverBodyAfterStrayEdit = await (await page.request.get(`/api/scenarios/${id}`)).json();
      const strayPersisted = (serverBodyAfterStrayEdit.inputs.customerOverrides as Array<{ id: string; demand?: number }>).find(
        o => o.id === histDemandCustomerId,
      );
      expect(strayPersisted?.demand).not.toBe(999999999);

      // ── Band lens STAYS editable while browsing history ─────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("button-bands-plus")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-bands-plus").click();
      await page.getByTestId("input-new-band").fill("3000");
      await page.getByTestId("button-add-band-confirm").click();
      await expect(page.getByTestId("band-3000")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // Save label switches to "Save bands" (field-scoped write) while historical.
      const saveBtn = page.getByTestId("button-save").first();
      await expect(saveBtn).toHaveText("Save bands", { timeout: HEADER_TIMEOUT });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();
      await expect(saveBtn).toBeDisabled({ timeout: HEADER_TIMEOUT });

      // ── Discard: step forward while dirty (re-dirty at latest, then discard) ──
      await page.getByTestId("button-result-forward").click();
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2", { timeout: HEADER_TIMEOUT });
      // Optimization Parameters is still the active tab from the band-editing
      // step above — reopen Customers.
      await page.getByTestId("sidebar-input-customers").click();
      const latestDemand2 = page.locator('[data-testid^="input-customer-demand-"]').first();
      const latestDemandTestId = (await latestDemand2.getAttribute("data-testid"))!;
      const latestDemandCustomerId = latestDemandTestId.replace("input-customer-demand-", "");
      const savedLatestValue = await latestDemand2.inputValue();
      await latestDemand2.fill(String(Number(savedLatestValue) + 42));
      await page.getByTestId("button-result-back").click();
      await expect(page.getByTestId("dirty-nav-prompt")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("dirty-nav-discard").click();
      await expect(page.getByTestId("dirty-nav-prompt")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-result-history-position")).toHaveText("1/2", { timeout: HEADER_TIMEOUT });
      // Data-safety proof: the discarded "+42" edit was never sent to the
      // server (Discard only ever reverts `localInputs`/`savedInputsRef`
      // client-side and then navigates — it never PATCHes).
      const serverBodyAfterDiscard = await (await page.request.get(`/api/scenarios/${id}`)).json();
      const persistedAfterDiscard = (serverBodyAfterDiscard.inputs.customerOverrides as Array<{ id: string; demand?: number }>).find(
        o => o.id === latestDemandCustomerId,
      );
      expect(persistedAfterDiscard?.demand).not.toBe(Number(savedLatestValue) + 42);
      // NOTE (same real finding as above, not asserted as a defect here):
      // `CustomerTable`'s own local `drafts[id]` state is never reset by
      // Discard reverting `localInputs` out from under it (no effect ties
      // the draft to the overrides prop's identity) — stepping forward again
      // and re-reading this exact input would still visually show the
      // discarded "+42" value even though the server was never touched by
      // it. Not asserted here; see the final report.
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("chen-bands-units QA — export controls", () => {
  test("unit= applies on the wire, input exports disabled while browsing history, result export from a historical entry still works, file content carries the right unit", async ({ page }) => {
    test.setTimeout(240_000);
    await registerAndGoHome(page);
    // Seed one distance override so the CSV content-check below has a real
    // data row to inspect (an unoverridden scenario's "distances" export is
    // header-only — that's the correct product behavior, just not useful for
    // asserting per-row unit conversion).
    const id = await createScenario(
      page,
      "chens-cosmetics-cn",
      "/chapter-4",
      chenCoverageInputs({ distanceOverrides: [{ fromId: "wh-40", toId: "cs-4", distance: 500 }] }),
    );

    try {
      await solveViaUi(page, id);
      await page.getByTestId("sidebar-input-customers").click();
      const demandInput = page.locator('[data-testid^="input-customer-demand-"]').first();
      const original = Number(await demandInput.inputValue()) || 0;
      await demandInput.fill(String(original + 1000));
      await saveViaHeader(page);
      await solveViaUi(page, id);
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2", { timeout: HEADER_TIMEOUT });

      // ── unit= applies on a real click, at the latest entry ──────────────
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-export-distances-csv")).toBeEnabled();

      await page.getByTestId("unit-toggle-mi").click();
      const [reqMi] = await Promise.all([
        page.waitForRequest(req => req.url().includes("/export") && req.method() === "GET"),
        page.getByTestId("button-export-distances-csv").click(),
      ]);
      expect(reqMi.url()).toContain("unit=mi");

      await page.getByTestId("unit-toggle-km").click();
      const [reqKm] = await Promise.all([
        page.waitForRequest(req => req.url().includes("/export") && req.method() === "GET"),
        page.getByTestId("button-export-distances-csv").click(),
      ]);
      expect(reqKm.url()).toContain("unit=km");

      // ── Step back into history: input exports disabled, result exports still work ──
      await page.getByTestId("button-result-back").click();
      await expect(page.getByTestId("text-result-history-position")).toHaveText("1/2", { timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("button-export-distances-csv")).toBeDisabled({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-export-distances-csv")).toHaveAttribute(
        "title",
        "Input exports reflect the current scenario",
      );

      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("button-download-cost-summary-csv")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      const [reqHistorical] = await Promise.all([
        page.waitForRequest(req => req.url().includes("/export") && req.method() === "GET"),
        page.getByTestId("button-download-cost-summary-csv").click(),
      ]);
      expect(reqHistorical.url()).toMatch(/runId=\d+/);

      // ── File content carries the right unit label + converted values ───
      const distExportKm = await page.request.get(`/api/scenarios/${id}/export?entity=distances&format=csv&unit=km`);
      const csvKm = await distExportKm.text();
      const lineKm = csvKm.trim().split("\n")[1];
      expect(lineKm).toMatch(/,km,/);

      const distExportMi = await page.request.get(`/api/scenarios/${id}/export?entity=distances&format=csv&unit=mi`);
      const csvMi = await distExportMi.text();
      const lineMi = csvMi.trim().split("\n")[1];
      expect(lineMi).toMatch(/,mi,/);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("chen-bands-units QA — frozen golden + cross-model solve", () => {
  test("Chen's default coverage solve reproduces the frozen golden exactly; a p-median-us solve still works", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const chenId = await createScenario(page, "chens-cosmetics-cn", "/chapter-4", chenCoverageInputs());
    try {
      const result = await solveViaUi(page, chenId);
      expect(result.details.objective).toBe("coverage");
      expect(result.details.coveragePct).toBeCloseTo(66.0639, 3);
      expect(new Set(result.details.openWarehouseIds)).toEqual(new Set(["wh-40", "wh-69", "wh-102"]));
    } finally {
      await page.request.delete(`/api/scenarios/${chenId}`);
    }

    const pmId = await createScenario(page, "p-median-us", "/chapter-3", pMedianInputs());
    try {
      const result = await solveViaUi(page, pmId);
      expect(result.status).toBe("optimal");
      expect(result.objective).toBeGreaterThan(0);
    } finally {
      await page.request.delete(`/api/scenarios/${pmId}`);
    }
  });
});
