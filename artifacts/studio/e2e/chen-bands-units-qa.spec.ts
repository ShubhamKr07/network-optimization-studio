/**
 * Browser E2E — QA gate for the `chen-bands-units` bundle (Task 15).
 *
 * Written for the (now-retired) China-dataset model; rewritten onto
 * `max-coverage-us` per the ch4-migration cutover (MIG-8) — same
 * distance-band-editable shape, new id namespace + goldens.
 *
 * CH4O-12 (ch4-model-upgrade, Task 12) — rewritten again: CH4O-8 flipped
 * max-coverage-us from km-canonical to MI-canonical, so it is no longer the
 * app's one odd-canonical model contrasted against mi-canonical
 * `p-median-us` — EVERY model in this app is mi-canonical now (confirmed
 * across every model's manifest.json under solvers/). The cross-model unit-toggle test
 * below still proves the same properties (auto renders the canonical unit,
 * an explicit toggle away from it genuinely converts, auto is a true
 * no-op), just with the conversion DIRECTION flipped: `max-coverage-us`'s
 * "away from auto" toggle is now `km` (not `mi`), since mi is what auto
 * already shows.
 *
 * Also fixes two scenario-creation defects this file carried into the
 * current schema (`validation/inputs/maxCoverage.ts`, CH4O-5): `objective`
 * is now a SERVER-OWNED field — a create/update payload that includes it AT
 * ALL (even the correct value) is rejected by `assertNoServerOwnedFields`
 * — and `coverageFloorDemand` is unconditionally REQUIRED with no schema
 * default, so omitting it (as this file's fixture used to) 422s. Every
 * golden below involving `maxCoverageInputs()`'s own payload
 * (p=3, high=700mi, max=5500mi, avgCap=1000mi, floor=0) was re-read off a
 * real `solve.py` invocation against the current (post-CH4O-8) dataset —
 * never hand-converted from its km-world predecessor, because the dataset
 * itself was re-keyed in miles, not just relabeled.
 *
 * Exercises, in a real browser against local dev servers, the properties a
 * unit test cannot: unit-toggle round-trips, the "never a wrong-unit
 * render" placeholder discipline, the free band editor (add/remove/
 * overflow/live-recolor-without-re-solve), unit-aware distance-edit commit
 * correctness (no drift across repeated toggles, incomplete drafts never
 * commit), the result-history read-only/dirty-nav-prompt contract
 * (including a genuinely rejected Save), and the export-control gating
 * (unit= on the wire, input-exports disabled while browsing history).
 *
 * Each test registers its own disposable account and cleans up its own
 * scenario(s) in a `finally` block, matching this repo's established e2e
 * convention (see max-coverage.spec.ts).
 */
import { test, expect, type Page } from "./fixtures";
import { readSolvedAt } from "./helpers/solvedAt";

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
  const email = `e2e-maxcovqa-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

function maxCoverageInputs(overrides: Record<string, unknown> = {}) {
  return {
    // CH4O-5 — NO `objective` key: it is server-derived from
    // `coverageFloorDemand` and `assertNoServerOwnedFields` 4xxs a
    // create/update payload that sends it at all.
    p: 3,
    highServiceDistMi: 700,
    maxDistMi: 5500,
    avgServiceDistCapMi: 1000,
    // CH4O-5 — unconditionally required, no schema default. A floor of 0
    // IS coverage mode (the default this fixture always exercised).
    coverageFloorDemand: 0,
    gap: 0,
    timeLimitSec: 120,
    capacityMode: "none",
    distanceBands: [700, 5500],
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
    data: { name: `E2E MaxCovQA ${modelId} ${Date.now()}`, modelId, inputs },
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

/** Trigger a solve via the Run Optimizer dialog, then wait on the shared
 * `readSolvedAt` completion signal (captured BEFORE the click, polled until
 * it differs) — same precise-completion signal max-coverage.spec.ts uses. */
async function solveViaUi(page: Page, id: string): Promise<ScenarioResult> {
  const before = await readSolvedAt(page, id);
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });

  await expect
    .poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
    .not.toBe(before);
  // CH4UX-7 — `solve-progress-overlay` unmounts on success and PERSISTS as
  // an error card on failure, so a solve that ends in a failed job can no
  // longer slip past as "some result landed". It is the successor to the
  // Solve dialog's deleted `solve-dialog-error`.
  await expect(page.getByTestId("solve-progress-overlay")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
  const fresh = (await getScenario(page, id)).result;
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
  test("unit toggle converts every distance surface, persists across reload, auto is a no-op; max-coverage-us and p-median-us (both mi-canonical) both correct", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const chenId = await createScenario(page, "max-coverage-us", "/chapter-4", maxCoverageInputs());

    try {
      await solveViaUi(page, chenId);

      // Auto (default): max-coverage-us's canonical is mi (CH4O-8) — cost
      // summary shows mi, never km. CH4O-10 moved Chen's coverage KPIs onto
      // Solution Summary and renamed this row "Avg distance to customers"
      // (showCoverageRows is always true for max-coverage-us) — the generic
      // "Weighted avg. distance" testid below is what a NON-coverage model
      // gets instead (unaffected, see the p-median-us half below).
      await page.getByTestId("sidebar-output-cost-summary").click();
      const wavg = page.getByTestId("cost-summary-value-avg-distance-to-customers");
      await expect(wavg).toContainText("mi", { timeout: HEADER_TIMEOUT });
      const autoText = (await wavg.innerText()).trim();
      const autoValue = Number(autoText.replace(/[^0-9.]/g, ""));
      expect(autoValue).toBeGreaterThan(0);

      // Toggle to km — the SAME underlying canonical value now renders in
      // km, converted (not identical to the mi number, not "mi" mislabeled
      // as "km"). mi -> km MULTIPLIES by 1.609344 — the opposite direction
      // from the old km-canonical world, because mi is now canonical.
      await page.getByTestId("unit-toggle-km").click();
      await expect(page.getByTestId("unit-toggle-km")).toHaveAttribute("aria-pressed", "true");
      await expect(wavg).toContainText("km", { timeout: HEADER_TIMEOUT });
      const kmText = (await wavg.innerText()).trim();
      const kmValue = Number(kmText.replace(/[^0-9.]/g, ""));
      // Confirm the conversion actually happened (not just a relabeled
      // identical number).
      expect(kmValue).toBeGreaterThan(autoValue);
      expect(kmValue).toBeCloseTo(autoValue * 1.609344, 0);

      // Reload — the "km" preference persists (localStorage), the model
      // still shows its OWN canonical-derived km value, not a stale/guessed
      // one.
      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("unit-toggle-km")).toHaveAttribute("aria-pressed", "true", { timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-avg-distance-to-customers")).toContainText("km", { timeout: HEADER_TIMEOUT });

      // "auto" is a genuine no-op: switching back re-renders the model's own
      // canonical unit (mi for max-coverage-us), matching the very first
      // reading exactly.
      await page.getByTestId("unit-toggle-auto").click();
      await expect(page.getByTestId("unit-toggle-auto")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("cost-summary-value-avg-distance-to-customers")).toContainText("mi", { timeout: HEADER_TIMEOUT });
      const autoAgainText = (await page.getByTestId("cost-summary-value-avg-distance-to-customers").innerText()).trim();
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
      data: { name: `E2E MaxCovQA loading ${Date.now()}`, modelId: "max-coverage-us", inputs: maxCoverageInputs() },
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
      await expect(page.getByTestId("band-700")).toHaveCount(0);

      // Distances tab: the override input is disabled/empty while unresolved.
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const addBtn = page.getByTestId("button-add-distance-row");
      await addBtn.click();
      const valueInput = page.getByTestId("input-new-distance-value");
      await expect(valueInput).toBeDisabled();
      await expect(valueInput).toHaveValue("");

      // Once the manifest resolves (route delay elapses), the real mi-labeled
      // content replaces the placeholder — proving this was a genuine
      // load-then-resolve transition, not a permanently-broken editor.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      // ch4-fixes item 3 — widened from 6_000: under 4 workers with real CBC
      // solves in flight, the 3s injected route delay plus resolve-and-
      // re-render had no headroom at 6s (repeated gate failures; 3/3 clean
      // in isolation). The injected delay and the assertion itself are
      // unchanged — only the timeout budget grew.
      await expect(page.getByTestId("bands-unit-pending")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId("band-700")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByText("Distance bands (mi)")).toBeVisible();
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
    const id = await createScenario(page, "max-coverage-us", "/chapter-4", maxCoverageInputs());

    try {
      await solveViaUi(page, id);

      // Baseline: this spec's own payload bands [700, 5500] mi (not
      // `defaultInputsForModel`'s default — see `maxCoverageInputs()`
      // above). CH4O-8 re-keyed the dataset in miles (not a km->mi
      // conversion of the old numbers), so this payload now opens
      // {CMH, LBB, RNO} — NOT the {DAL, LA, PIT} the pre-CH4O-8 version of
      // this spec asserted — and the real solved max edge distance is
      // 1645 mi — well under 5500 — so nothing is overflow yet. (Measured
      // against actual solver output, not derived from nearest-open
      // reasoning: coverage mode maximizes covered demand under an
      // average-distance budget, not per-customer distance, so CBC is free
      // to assign a customer to any open warehouse, not necessarily its
      // nearest.)
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("checkbox-color-lanes-band")).toBeChecked({ timeout: HEADER_TIMEOUT });
      const overflowPathsBefore = page.locator('path.leaflet-interactive[stroke="var(--band-overflow)"]');
      await expect(overflowPathsBefore).toHaveCount(0);

      // ── Band editor: add, remove, last-boundary guard ───────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("band-700")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("band-5500")).toBeVisible();

      // Add a boundary well below the farthest edge (1645 mi) so several
      // routes fall beyond it once we remove the 5500 boundary. Verified
      // against real solver output for this exact payload (p=3, open
      // {CMH, LBB, RNO}): 1000 mi splits the 200 solved edges 7 over /
      // 193 under — a comfortably nonzero overflow bucket. (Coverage mode
      // maximizes covered demand under an average-distance budget, not
      // per-customer distance, so nearest-open reasoning does not
      // describe this assignment — the split above is measured, not
      // derived from "nearest open warehouse".)
      await page.getByTestId("button-bands-plus").click();
      await page.getByTestId("input-new-band").fill("1000");
      await page.getByTestId("button-add-band-confirm").click();
      await expect(page.getByTestId("band-1000")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("button-remove-band-5500").click();
      await expect(page.getByTestId("band-5500")).toHaveCount(0);
      // Bands now [700, 1000] — length 2, both removable.
      await expect(page.getByTestId("button-remove-band-700")).toBeEnabled();
      await expect(page.getByTestId("button-remove-band-1000")).toBeEnabled();

      // ── Live recolor WITHOUT saving or re-solving ───────────────────────
      // Still on Optimization Parameters — the lens is dirty but nothing has
      // been saved/solved yet. Switch straight to the Output Map: the
      // 1000 mi boundary must already recolor overflow lanes (>1000 mi),
      // proving this is a client-side reporting lens, not tied to a re-solve.
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("checkbox-color-lanes-band")).toBeChecked({ timeout: HEADER_TIMEOUT });
      const overflowPathsAfter = page.locator('path.leaflet-interactive[stroke="var(--band-overflow)"]');
      await expect(async () => {
        expect(await overflowPathsAfter.count()).toBeGreaterThan(0);
      }).toPass({ timeout: 8_000 });

      // Service Stats: an explicit overflow row (`band: -1`), with a "> X mi"
      // label — the sentinel itself is never run through the unit converter
      // (no "-0.62"-style nonsense possible: the label text has no "-" sign).
      await page.getByTestId("sidebar-output-service-stats").click();
      const overflowRow = page.getByTestId("service-stats-band--1");
      await expect(overflowRow).toBeVisible({ timeout: HEADER_TIMEOUT });
      const overflowLabel = (await overflowRow.innerText()).trim();
      expect(overflowLabel.startsWith(">")).toBe(true);
      expect(overflowLabel).not.toMatch(/-\d/); // no negative distance ever rendered

      // ── Non-integer boundary via unit toggle ────────────────────────────
      // CH4O-8 flipped the canonical unit to mi, so the "away from auto"
      // toggle that exercises a real conversion is now km (not mi).
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("unit-toggle-km").click();
      await page.getByTestId("button-bands-plus").click();
      await page.getByTestId("input-new-band").fill("150.25");
      await page.getByTestId("button-add-band-confirm").click();
      // fromDisplay(150.25, "km" -> "mi") = 150.25 / 1.609344 = 93.36102...,
      // roundForFile (4dp) = 93.361 — a genuinely non-integer canonical band.
      await expect(page.getByTestId("band-93.361")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("unit-toggle-auto").click();

      // ── Removal blocked at the last boundary ────────────────────────────
      await page.getByTestId("button-remove-band-700").click();
      await expect(page.getByTestId("band-700")).toHaveCount(0);
      await page.getByTestId("button-remove-band-1000").click();
      await expect(page.getByTestId("band-1000")).toHaveCount(0);
      // Exactly one boundary left (93.361) — its own remove button is
      // disabled, and clicking it (even forcibly) must not empty the array.
      await expect(page.getByTestId("button-remove-band-93.361")).toBeDisabled();
      await page.getByTestId("button-remove-band-93.361").click({ force: true });
      await expect(page.getByTestId("band-93.361")).toBeVisible();
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
    const id = await createScenario(page, "max-coverage-us", "/chapter-4", maxCoverageInputs());

    try {
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // ── Incomplete draft never commits ──────────────────────────────────
      await page.getByTestId("button-add-distance-row").click();
      await page.getByTestId("input-new-distance-from").fill("ALN");
      await page.getByTestId("input-new-distance-to").fill("C4");
      await page.getByTestId("input-new-distance-value").fill("5.");
      await page.getByTestId("button-add-distance-confirm").click();
      // Row was not added — the incomplete draft never reached `onCommit`, so
      // the add-row's value field (which has no anchor value to revert to)
      // reverts to blank rather than committing "5" or keeping "5." on screen.
      await expect(page.getByTestId("text-add-distance-error")).toContainText("Distance must be a positive number.", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("input-new-distance-value")).toHaveValue("");
      // ALN-C4 is a real base pair (solvers/max-coverage-us/dataset/distances.json
      // has "ALN,C4") — the merged base+override table always renders a base row
      // for it via `input-distance-${fromId}-${toId}`, regardless of whether an
      // override was ever committed, so `toHaveCount(0)` on the input itself is
      // never a valid "no override" check. The "Changed" badge only renders when
      // `isChangedRow` is true (a real committed-or-draft override exists), so
      // its absence is the correct proof the incomplete draft never committed.
      await expect(page.getByTestId("badge-distance-changed-ALN-C4")).toHaveCount(0);

      await page.getByTestId("input-new-distance-value").fill("5e");
      await page.getByTestId("button-add-distance-confirm").click();
      await expect(page.getByTestId("text-add-distance-error")).toContainText("Distance must be a positive number.");
      await expect(page.getByTestId("badge-distance-changed-ALN-C4")).toHaveCount(0);

      // ── Now commit a real value (mi, since unit=auto for max-coverage-us
      // post-CH4O-8 — the canonical unit flipped from km to mi) ──────────
      await page.getByTestId("input-new-distance-value").fill("500");
      await page.getByTestId("button-add-distance-confirm").click();
      // The merged base+override table is paginated (50/page) and this pair
      // may not land on page 1 — filter down to it (same pattern the
      // Distances tab's own filter fields exist for).
      await page.getByTestId("input-filter-from").fill("ALN");
      await page.getByTestId("input-filter-to").fill("C4");
      await expect(page.getByTestId("input-distance-ALN-C4")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("input-distance-ALN-C4")).toHaveValue("500");
      await saveViaHeader(page);

      const inputsResp = await page.request.get(`/api/scenarios/${id}`);
      const scenarioBody = await inputsResp.json();
      const savedOverride = (scenarioBody.inputs.distanceOverrides as Array<{ fromId: string; toId: string; distance: number }>).find(
        o => o.fromId === "ALN" && o.toId === "C4",
      );
      expect(savedOverride).toBeDefined();
      expect(savedOverride!.distance).toBe(500);

      // ── Toggle to km: displays the converted value. mi -> km MULTIPLIES
      // (the opposite direction from the old km-canonical world) ─────────
      await page.getByTestId("unit-toggle-km").click();
      const kmInput = page.getByTestId("input-distance-ALN-C4");
      // ch4-fixes item 2 — `inputValue()` does not auto-retry, so a React
      // re-render lagging under 4-worker load could still return the
      // pre-toggle string; assert with the auto-retrying `toHaveValue`
      // FIRST, then read once the value is confirmed settled.
      // ch4-fixes item 4 — the IDLE override cell is grouped at max 2 dp
      // (formatDistanceDisplay), not `roundForFile`'s 4 dp: 500*1.609344 =
      // 804.672 renders "804.67". Full precision is still there — it is
      // revealed on focus — so this asserts the DISPLAY contract at 2 dp and
      // the focused round-trip below still proves no precision was lost.
      await expect(kmInput).toHaveValue("804.67", { timeout: HEADER_TIMEOUT });
      const kmText1 = await kmInput.inputValue(); // still needed: reused below for equality checks
      expect(Number(kmText1.replace(/,/g, ""))).toBeCloseTo(500 * 1.609344, 1);

      // ── Repeated toggles introduce no drift ─────────────────────────────
      await page.getByTestId("unit-toggle-auto").click();
      await expect(kmInput).toHaveValue("500", { timeout: HEADER_TIMEOUT });
      await page.getByTestId("unit-toggle-km").click();
      // idempotent — not accumulating drift; dynamic expected value, so
      // assert directly against `kmText1` rather than a hardcoded literal.
      await expect(kmInput).toHaveValue(kmText1, { timeout: HEADER_TIMEOUT });
      await page.getByTestId("unit-toggle-mi").click();
      await expect(kmInput).toHaveValue("500", { timeout: HEADER_TIMEOUT }); // explicit "mi" button matches canonical too

      // ── Edit while displayed in km: confirm the stored CANONICAL value ──
      await page.getByTestId("unit-toggle-km").click();
      const overrideInput = page.getByTestId("input-distance-ALN-C4");
      // ch4-fixes item 4's "grouped" presentation swaps the idle 2-dp text
      // (`kmText1`, e.g. "804.67") for the full-precision raw value the
      // instant the field is focused (onFocus -> setFocused(true) ->
      // re-render). `.fill()` focuses the element as its first step, and if
      // it selects-and-replaces before that focus-triggered re-render has
      // committed, the new text lands next to (not over) the stale grouped
      // value instead of replacing it — e.g. "1000" + "804.67" both in the
      // field, which fails the draft's completeness grammar and silently
      // discards on blur. Click first and wait for the raw swap to actually
      // land before filling, so .fill() operates on a stable value.
      await overrideInput.click();
      await expect(overrideInput).not.toHaveValue(kmText1);
      await overrideInput.fill("1000");
      await overrideInput.blur();
      await saveViaHeader(page);

      const finalBody = await (await page.request.get(`/api/scenarios/${id}`)).json();
      const finalOverride = (finalBody.inputs.distanceOverrides as Array<{ fromId: string; toId: string; distance: number }>).find(
        o => o.fromId === "ALN" && o.toId === "C4",
      );
      expect(finalOverride).toBeDefined();
      // fromDisplay(1000, "km"->"mi") = 1000 / 1.609344
      expect(finalOverride!.distance).toBeCloseTo(1000 / 1.609344, 3);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("chen-bands-units QA — history read-only + dirty-nav prompt", () => {
  // ch4-2s-9 — moved from max-coverage-us to p-median-us, back when Task 8
  // (ch4-2s-8) hid the entire result-history stepper for max-coverage-us
  // under the (then-current) two-step workflow. CH4O-12 (ch4-model-upgrade)
  // note: that two-step workflow — and the `isMaxCoverage` stepper
  // carve-out — is gone entirely now (CH4O-2/CH4O-7 deleted the step
  // toggle; Task 2's fix commit `2b391b9` restored the result-history
  // stepper for max-coverage-us, same as every other model). This test is
  // NOT being moved back, though: it stays on p-median-us because the
  // mechanics under test (dirty-nav-prompt, ordinary-editor no-op while
  // historical, the band lens staying editable while historical) are
  // generic Workspace.tsx behavior that p-median-us already exercises
  // identically, and the SCN v0.3 plan's own Task 12 brief is explicit that
  // a NEW Chapter-4 stepper e2e assertion is out of scope here (it's
  // already pinned at unit level, `Workspace.test.tsx`). Also folds in (see
  // below) the "input exports disabled / result export still works via
  // runId while browsing history" assertions relocated from the test below,
  // which lost its own history-browsing half for the same (now-historical)
  // reason.
  test("ordinary editors no-op while browsing history, band lens stays editable, dirty-nav prompt: cancel/discard/reject-save/succeed, export gating while historical", async ({ page }) => {
    test.setTimeout(300_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us", "/chapter-3", pMedianInputs());

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
      // ch4-2s-9 — rewritten. The comment this replaced described a real
      // finding (a keystroke typed while browsing history visually "took"
      // even though nothing persisted) that predates a later "chen-bands-
      // units follow-up (QA defect)" fix: `CustomerTable`'s own `disabled`
      // prop (`CustomerTable.tsx`'s own doc comment names it explicitly) is
      // now wired to `isBrowsingHistoryNow` (Workspace.tsx passes
      // `disabled={isBrowsingHistoryNow}` into `CustomersTab`), which
      // disables the demand INPUT ELEMENT ITSELF while historical — so a
      // `.fill()` attempt here now hangs forever waiting for an element
      // that can never become "editable" (confirmed empirically: reliably
      // timed out at the test's outer budget with zero console/network
      // activity in between). The old visual-drift defect is now
      // structurally impossible, not just asserted-around — proving the
      // input is disabled IS the data-safety proof, no server round-trip
      // needed.
      const histDemand = page.locator('[data-testid^="input-customer-demand-"]').first();
      await expect(histDemand).toBeDisabled({ timeout: HEADER_TIMEOUT });

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

      // ── Relocated from the "unit= applies on the wire" test below (it lost
      // this half for the same reason this whole test moved models): input
      // exports are disabled while browsing a historical entry. ──────────
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("button-export-distances-csv")).toBeDisabled({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-export-distances-csv")).toHaveAttribute(
        "title",
        "Input exports reflect the current scenario",
      );

      // ch4-2s-9 — the ORIGINAL block here also clicked into the Solution
      // Summary OUTPUT tab and checked its result export still worked with
      // `runId`, while browsing history. That half is Chapter-4-specific
      // and does NOT relocate: at the time, `SidebarTree`'s
      // `keepOutputsClickable` was true ONLY for max-coverage-us (CH4-18).
      // CH4O-12 (ch4-model-upgrade) note: that carve-out is gone too —
      // Workspace.tsx no longer passes `keepOutputsClickable` for ANY
      // model (grep confirms zero occurrences), so max-coverage-us's
      // output sidebar is now `disabled` while browsing non-latest history
      // exactly like every other model, including p-median-us here.
      // Output sidebar entries are genuinely `disabled` while browsing a
      // non-latest entry (confirmed via trace replay: the click hung on a
      // real `disabled aria-disabled="true"` button, inheriting the whole
      // test budget since this pre-existing `.click()` carried no explicit
      // timeout). Result-export-while-historical for a NORMAL model would
      // need the output tab already open from before stepping back — out
      // of scope for this relocation; the input-export half above is the
      // part that's genuinely model-
      // agnostic and was the actual point of moving this block at all.
      //
      // Back to Optimization Parameters — the "step forward while dirty"
      // block below re-opens Customers itself and expects to be there.
      await page.getByTestId("sidebar-input-optimization-parameters").click();

      // ── Discard: step forward while dirty (re-dirty at latest, then discard) ──
      await page.getByTestId("button-result-forward").click();
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2", { timeout: HEADER_TIMEOUT });
      // Reopen Customers (active tab is Optimization Parameters from the
      // step above's explicit navigation back to it).
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
  // ch4-2s-9 — was two solves purely to create a second history entry to
  // step back into; that half moved to the (now p-median-us-targeting)
  // "ordinary editors no-op while browsing history..." test above, since
  // Task 8 (ch4-2s-8) hides `button-result-back`/`text-result-history-
  // position` outright for max-coverage-us (no stepper exists to step back
  // with) — see that test's own header comment. What's left here is
  // model-specific (`ALN`/`C4` are max-coverage-us's own dataset ids) and
  // needs no history at all: one solve, then unit=mi/km wire +
  // CSV-content assertions against the single latest entry. The unit=
  // query param and its CSV-content effect are independent of which unit
  // is canonical — this still passes unaffected by CH4O-8's km->mi
  // canonical flip.
  test("unit= applies on the wire, file content carries the right unit (max-coverage-us, mi-canonical)", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    // Seed one distance override so the CSV content-check below has a real
    // data row to inspect (an unoverridden scenario's "distances" export is
    // header-only — that's the correct product behavior, just not useful for
    // asserting per-row unit conversion).
    const id = await createScenario(
      page,
      "max-coverage-us",
      "/chapter-4",
      maxCoverageInputs({ distanceOverrides: [{ fromId: "ALN", toId: "C4", distance: 500 }] }),
    );

    try {
      await solveViaUi(page, id);

      // ── unit= applies on a real click ────────────────────────────────────
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
  test("max-coverage-us's default coverage solve reproduces the frozen golden exactly; a p-median-us solve still works", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const chenId = await createScenario(page, "max-coverage-us", "/chapter-4", maxCoverageInputs());
    try {
      const result = await solveViaUi(page, chenId);
      expect(result.details.objective).toBe("coverage");
      // CH4O-8 re-keyed the dataset in miles (this spec's payload — p=3,
      // high=700mi, max=5500mi, avgCap=1000mi, floor=0 — is NOT
      // `test_max_coverage.py::BASE`'s defaults, so this golden is its own,
      // re-read off a real `solve.py` invocation against the current
      // dataset: coveragePct 91.2819, coveredDemand 71223955, open
      // {CMH, LBB, RNO} — NOT the pre-CH4O-8 {DAL, LA, PIT}/68.4192%.
      expect(result.details.coveragePct).toBeCloseTo(91.2819, 3);
      expect(new Set(result.details.openWarehouseIds)).toEqual(new Set(["CMH", "LBB", "RNO"]));
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
