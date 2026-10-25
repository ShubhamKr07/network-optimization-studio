/**
 * DU-3.5 — Phase 3 (map interactions) real-browser QA, including a TOUCH viewport.
 *
 * jsdom has no layout, no pointer/touch pipeline and no CSS cascade, so the things Phase 3
 * promised are only observable here: a tap reaching the same actions as a right-click, the
 * selection ring's computed stroke, the card's clearance from the marker's real box, lane
 * `stroke-opacity` on both legs, the popup/tooltip/legend interplay and the ⓘ popover.
 * Results are SEEDED (helpers/seedSolvedResult.ts + fixtures/solved/*.json): the real solver
 * never runs.
 *
 * EVERY CHECK MUST BE ABLE TO FAIL:
 *   - each loop asserts its locator set is non-empty first;
 *   - each pure detector has an injected-probe case in "detectors can fail";
 *   - each "X is absent / dimmed" assertion is paired with a state where X is present / not dimmed.
 *
 * Hand-authored shapes (declared, not hidden): the split-sourced customer (JADE's solver is
 * single-source, so no solved fixture has one) is a copy of the solved JADE fixture with ONE
 * customer's second product re-pointed at another open warehouse; the legacy-unverified result is the
 * solved fixture with `solutionStatus` nulled (the shape the api-server read-path guard stamps).
 *
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type Locator } from "./fixtures";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS, SUPER_SAMPLE_PATH } from "./helpers/solvedModelInputs";
import { makeReachable, reachableIndices, topmostMarker } from "./helpers/topmostMarker";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const shot = async (target: Page | Locator, name: string) => {
  if (SHOTS) await target.screenshot({ path: path.join(SHOTS, name) });
};

const loadFixture = (modelId: string) => JSON.parse(fs.readFileSync(path.join(here, "fixtures/solved", `${modelId}.json`), "utf8"));
const chapterPath = (modelId: string) => CHAPTERS.find(c => c.modelId === modelId)!.path;

// ── Pure detectors (exercised by the probe test) ────────────────────────────
/** The hint must be exactly "Right-click for " + the visible action labels (ellipsis stripped), in order. */
function hintMatches(footer: string, buttonLabels: string[]): boolean {
  return footer.trim() === `Right-click for ${buttonLabels.map(l => l.replace("…", "").trim()).join(" · ")}`;
}
/** Gap between two boxes: negative when they overlap on both axes. */
function boxGap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const gx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(gx, gy);
}
const KEEP_OUT = 24;
const KEEP_OUT_TOL = 0.75; // sub-pixel rounding of two boundingBox() reads

// ── Page plumbing ───────────────────────────────────────────────────────────
async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-du3-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenario(page: Page, modelId: string, inputs: Record<string, unknown>, name: string): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name, modelId, inputs } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  if (modelId === "super-model") {
    const imp = await page.request.post(`/api/scenarios/${id}/network/import?mode=replace`, { data: JSON.parse(fs.readFileSync(SUPER_SAMPLE_PATH, "utf8")) });
    expect(imp.status(), await imp.text()).toBe(200);
  }
  return id;
}

const ADDED_WH = { id: "ADDED-1", city: "Testburg", state: "ZZ", lat: 40.0, lng: -100.0, status: "active" };

async function settle(page: Page): Promise<void> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const len = await page.evaluate(() => document.body.innerText.length);
        const stable = len === last;
        last = len;
        return stable;
      },
      { timeout: 15_000, intervals: [300, 300, 300, 300] },
    )
    .toBe(true);
}

async function openWorkspace(page: Page, modelId: string, id: string): Promise<void> {
  await page.goto(`${chapterPath(modelId)}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: 15_000 });
}

async function openEntry(page: Page, entryTestId: string): Promise<void> {
  await page.getByTestId(entryTestId).click({ timeout: T });
  await settle(page);
}

// ── Input Map helpers ───────────────────────────────────────────────────────
const IN_MAP = '[data-testid="input-map-tab"]';
const markersOf = (page: Page, cls: string) => page.locator(`${IN_MAP} .leaflet-marker-icon.${cls}`);
const card = (page: Page) => page.getByTestId("map-details-card");

/** Marker icons that carry the selection ring, with the ring circle's COMPUTED stroke. */
async function ringedMarkers(page: Page): Promise<{ cls: string; stroke: string }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="input-map-tab"] .leaflet-marker-icon')).flatMap(el => {
      const c = el.querySelector('circle[stroke="var(--map-ring-select)"]');
      return c ? [{ cls: (el as HTMLElement).className, stroke: getComputedStyle(c).stroke }] : [];
    }),
  );
}
const RING_STROKE = "rgb(252, 211, 77)"; // --map-ring-select #FCD34D

async function actionKeys(page: Page): Promise<string[]> {
  return card(page).locator('[data-testid^="map-details-action-"]').evaluateAll(els => els.map(e => e.getAttribute("data-testid")!.replace("map-details-action-", "")));
}
async function actionLabels(page: Page): Promise<string[]> {
  return card(page).locator('[data-testid^="map-details-action-"]').evaluateAll(els => els.map(e => (e.textContent ?? "").trim()));
}

/** Select the card for a marker with a tap (touch) or click. */
async function select(marker: Locator, how: "tap" | "click"): Promise<void> {
  if (how === "tap") await marker.tap({ timeout: T });
  else await marker.click({ timeout: T });
}

/** The index (within `.wh-marker`) of the ADDED warehouse: it is the last one rendered; proven by its card naming Testburg. */
async function selectAddedWarehouse(page: Page, how: "tap" | "click"): Promise<Locator> {
  const whs = markersOf(page, "wh-marker");
  expect(await whs.count(), "warehouse markers").toBeGreaterThan(1);
  const added = whs.last();
  await makeReachable(page, added);
  await select(added, how);
  await expect(card(page)).toBeVisible({ timeout: T });
  await expect(page.getByTestId("map-details-name")).toContainText("Testburg");
  return added;
}

async function pickScenarioWithAdded(page: Page, modelId: string): Promise<string> {
  const inputs: Record<string, unknown> = { ...SOLVED_MODEL_INPUTS[modelId], addedWarehouses: [ADDED_WH] };
  return createScenario(page, modelId, inputs, `E2E DU-3.5 ${modelId}`);
}

/** Zoom in with the map's own +/- control (the bounded map only pans once zoomed in). */
async function zoomControl(page: Page, how: "tap" | "click", times: number): Promise<void> {
  const btn = page.locator(`${IN_MAP} .leaflet-control-zoom-in`);
  expect(await btn.count(), "zoom-in control").toBe(1);
  for (let i = 0; i < times; i++) {
    if (how === "tap") await btn.tap({ timeout: T });
    else await btn.click({ timeout: T });
    await page.waitForTimeout(400);
  }
}

/** A point on empty map (tile/container, not a marker, not under the card), in page coordinates. */
async function emptyMapSpot(page: Page, avoid: Box): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(({ c }) => {
    const k = document.querySelector('[data-testid="input-map-tab"] .leaflet-container')!.getBoundingClientRect();
    for (let fy = 0.1; fy < 0.95; fy += 0.08) {
      for (let fx = 0.1; fx < 0.95; fx += 0.08) {
        const x = k.x + k.width * fx, y = k.y + k.height * fy;
        if (x > c.x - 10 && x < c.x + c.width + 10 && y > c.y - 10 && y < c.y + c.height + 10) continue;
        const el = document.elementFromPoint(x, y);
        if (el && (el.classList.contains("leaflet-container") || el.tagName === "IMG" || el.classList.contains("leaflet-tile"))) return { x, y };
      }
    }
    return null;
  }, { c: avoid });
  expect(spot, "an empty map point to drag from").not.toBeNull();
  return spot!;
}

/**
 * Select a marker, pan with `drag`, and require the card to have moved WITH the marker (same offset),
 * still >= 24px clear. Tries two directions because the map is bounded.
 */
async function expectCardFollowsPan(page: Page, marker: Locator, how: "tap" | "click", drag: (from: { x: number; y: number }, to: { x: number; y: number }) => Promise<void>): Promise<void> {
  await select(marker, how);
  await expect(card(page)).toBeVisible({ timeout: T });
  const before = await geometry(page);
  const spot = await emptyMapSpot(page, before.card);
  let moved = 0;
  for (const [dx, dy] of [[-90, -60], [90, 60]]) {
    await drag(spot, { x: spot.x + dx, y: spot.y + dy });
    await expect(card(page), "the card must survive the pan").toBeVisible({ timeout: 3_000 });
    const after = await geometry(page);
    moved = Math.abs(after.marker.x - before.marker.x) + Math.abs(after.marker.y - before.marker.y);
    if (moved > 20) {
      const cardMoved = Math.abs(after.card.x - before.card.x) + Math.abs(after.card.y - before.card.y);
      expect(cardMoved, "the card moved (it did not stay where the marker left)").toBeGreaterThan(5);
      // Attached = still keeping exactly the 24px clearance (not drifted away, not on top of the marker). The
      // card may legitimately FLIP sides as the marker nears an edge, so the offset itself is not compared.
      const gap = boxGap(after.card, after.marker);
      expect(gap).toBeGreaterThanOrEqual(KEEP_OUT - KEEP_OUT_TOL);
      expect(gap, "card is still attached to (near) the marker").toBeLessThanOrEqual(KEEP_OUT + 12);
      break;
    }
  }
  expect(moved, "the pan really moved the marker (else the attachment check is vacuous)").toBeGreaterThan(20);
}

// ═══════════════════════════════════════════════════════════════════════════
test.describe("DU-3.5 detectors can fail (injected probes)", () => {
  test("hintMatches / boxGap reject wrong inputs and accept right ones", async () => {
    expect(hintMatches("Right-click for Edit · Copy", ["Edit…", "Copy"])).toBe(true);
    expect(hintMatches("Right-click for Edit · Copy", ["Edit…", "Move", "Copy"])).toBe(false);
    expect(hintMatches("Right-click for Edit", ["Edit…", "Copy"])).toBe(false);
    expect(hintMatches("Right-click for Copy · Edit", ["Edit…", "Copy"])).toBe(false);
    expect(boxGap({ x: 0, y: 0, width: 10, height: 10 }, { x: 40, y: 0, width: 10, height: 10 })).toBe(30);
    expect(boxGap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBeLessThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TOUCH PARITY — a tablet, tap only; no right-click anywhere in this block.
// ═══════════════════════════════════════════════════════════════════════════
test.describe("DU-3.5 touch parity (820x1180, hasTouch, isMobile)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } });

  test("p-median-us: tap a BASE warehouse -> Edit + Copy only; tap an ADDED one -> all four; Move arms the move; ring + hint + close", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await pickScenarioWithAdded(page, "p-median-us");
    try {
      await openWorkspace(page, "p-median-us", id);
      expect(await ringedMarkers(page), "no ring before any selection").toEqual([]);

      // BASE warehouse: the first reachable non-added one.
      const whs = markersOf(page, "wh-marker");
      const n = await whs.count();
      expect(n, "warehouse markers").toBeGreaterThan(1);
      const reach = (await reachableIndices(whs)).filter(i => i !== n - 1);
      expect(reach.length, "reachable base warehouses").toBeGreaterThan(0);
      const base = whs.nth(reach[0]);
      await base.tap({ timeout: T });
      await expect(card(page)).toBeVisible({ timeout: T });
      expect(await actionKeys(page), "base warehouse actions").toEqual(["edit", "copy"]);
      const baseLabels = await actionLabels(page);
      expect(baseLabels.length).toBe(2);
      expect(hintMatches(await page.getByTestId("map-details-footer").innerText(), baseLabels)).toBe(true);
      // Only the selected marker's icon carries the ring, with the token's real colour.
      const rings = await ringedMarkers(page);
      expect(rings.length, "exactly one ringed marker").toBe(1);
      expect(rings[0].cls).toContain("wh-marker");
      expect(rings[0].stroke).toBe(RING_STROKE);
      await shot(page, "01-tablet-card-base-warehouse.png");

      // Close button hides the card (and the ring).
      await page.getByTestId("map-details-close").tap({ timeout: T });
      await expect(card(page)).toHaveCount(0);
      expect(await ringedMarkers(page), "ring cleared on close").toEqual([]);

      // ADDED warehouse: four actions, hint lists all four, Move arms.
      await selectAddedWarehouse(page, "tap");
      expect(await actionKeys(page), "added warehouse actions").toEqual(["edit", "move", "copy", "delete"]);
      const addedLabels = await actionLabels(page);
      expect(hintMatches(await page.getByTestId("map-details-footer").innerText(), addedLabels)).toBe(true);
      const ringedAdded = await ringedMarkers(page);
      expect(ringedAdded.length).toBe(1);
      expect(ringedAdded[0].stroke).toBe(RING_STROKE);
      await shot(page, "02-tablet-card-added-warehouse-ring.png");
      await expect(page.getByTestId("armed-status-bar")).toHaveCount(0);
      await page.getByTestId("map-details-action-move").tap({ timeout: T });
      await expect(page.getByTestId("armed-status-bar")).toBeVisible({ timeout: T });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("delivery-teaching-us (fixed geography): tap a warehouse -> Edit only, hint says so", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "delivery-teaching-us", SOLVED_MODEL_INPUTS["delivery-teaching-us"], "E2E DU-3.5 delivery");
    try {
      await openWorkspace(page, "delivery-teaching-us", id);
      const { marker } = await topmostMarker(page, markersOf(page, "wh-marker"));
      await marker.tap({ timeout: T });
      await expect(card(page)).toBeVisible({ timeout: T });
      expect(await actionKeys(page), "delivery actions").toEqual(["edit"]);
      const labels = await actionLabels(page);
      expect(hintMatches(await page.getByTestId("map-details-footer").innerText(), labels)).toBe(true);
      expect(await page.getByTestId("map-details-footer").innerText()).toBe("Right-click for Edit");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("super-model: a tap on a warehouse opens the details card (it was a no-op before Phase 3)", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "super-model", SOLVED_MODEL_INPUTS["super-model"], "E2E DU-3.5 super");
    try {
      await openWorkspace(page, "super-model", id);
      await expect(card(page)).toHaveCount(0);
      const pins = page.locator(`${IN_MAP} .leaflet-marker-icon`);
      expect(await pins.count(), "super markers").toBeGreaterThan(0);
      const { marker } = await topmostMarker(page, pins);
      await marker.tap({ timeout: T });
      await expect(card(page)).toBeVisible({ timeout: T });
      expect((await actionKeys(page)).length, "super card has action buttons").toBeGreaterThan(0);
      const rings = await ringedMarkers(page);
      expect(rings.length, "super: one ringed marker").toBe(1);
      await shot(page, "03-tablet-super-card.png");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("pan by touch drag: the card stays attached to the selected marker", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us", SOLVED_MODEL_INPUTS["p-median-us"], "E2E DU-3.5 touch pan");
    try {
      await openWorkspace(page, "p-median-us", id);
      await zoomControl(page, "tap", 2);
      const { marker } = await topmostMarker(page, markersOf(page, "wh-marker"));
      const cdp = await page.context().newCDPSession(page);
      const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
        for (let i = 1; i <= 8; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }] });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(300);
      };
      await expectCardFollowsPan(page, marker, "tap", drag);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("Unverified (Quality row): a TAP on ⓘ opens the popover", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await openLegacyCostSummary(page);
    try {
      await expect(page.getByTestId("popover-unverified")).toHaveCount(0);
      await page.getByTestId("button-unverified-info").tap({ timeout: T });
      await expect(page.getByTestId("popover-unverified")).toBeVisible({ timeout: T });
      await expect(page.getByTestId("popover-unverified")).toContainText(UNVERIFIED_TEXT);
      await page.waitForTimeout(500); // let the popover finish its fade-in before the picture
      await shot(page, "08-unverified-popover-tablet.png");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("Landing history row: tapping ⓘ opens the popover and does NOT navigate; tapping the row itself does", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us", SOLVED_MODEL_INPUTS["p-median-us"], "E2E DU-3.5 landing row");
    try {
      const entry = { id: 9001, scenarioId: Number(id), scenarioName: "E2E DU-3.5 landing row", modelId: "p-median-us", status: "succeeded", objective: 1234, objectiveMode: null, weightedAvgDistance: 321, distanceUnit: "mi", errorCode: null, errorMessage: null, runTimeSec: 1.2, legacyUnverified: true, queuedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
      await page.route("**/api/solve-history*", route => route.fulfill({ json: [entry] }));
      await page.goto("/");
      const row = page.getByTestId("link-solve-history-9001");
      await expect(row).toBeVisible({ timeout: T });
      await expect(page.getByTestId("badge-legacy-unverified-9001")).toBeVisible();
      const info = row.getByTestId("button-unverified-info");
      expect(await info.count(), "ⓘ inside the history row").toBe(1);
      await info.tap({ timeout: T });
      await expect(page.getByTestId("popover-unverified")).toBeVisible({ timeout: T });
      await page.waitForTimeout(800); // a wrong navigation would have happened by now
      expect(new URL(page.url()).pathname, "tapping ⓘ must not follow the row's link").toBe("/");
      // Non-vacuity: the row IS a working link — tapping its title navigates to the chapter.
      await page.keyboard.press("Escape");
      await row.getByText("E2E DU-3.5 landing row").tap({ timeout: T });
      await expect(page).toHaveURL(new RegExp(`${chapterPath("p-median-us")}\\?scenario=${id}`), { timeout: T });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DESKTOP INPUT MAP — keyboard, hint, ring, placement, pan, close
// ═══════════════════════════════════════════════════════════════════════════
const RINGED = `${IN_MAP} .leaflet-marker-icon:has(circle[stroke="var(--map-ring-select)"])`;

/** Box of the (single) ringed marker and of the map container, read together. */
async function geometry(page: Page): Promise<{ card: Box; marker: Box; container: Box }> {
  const ringed = page.locator(RINGED);
  await expect(ringed, "exactly one ringed marker while a card is open").toHaveCount(1, { timeout: T });
  const [c, m, k] = await Promise.all([card(page).boundingBox(), ringed.boundingBox(), page.locator(`${IN_MAP} .leaflet-container`).boundingBox()]);
  expect(c && m && k, "card, ringed marker and container all have boxes").toBeTruthy();
  return { card: c!, marker: m!, container: k! };
}
type Box = { x: number; y: number; width: number; height: number };
const inside = (inner: Box, outer: Box) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

test.describe("DU-3.5 Input Map on desktop (mouse + keyboard)", () => {
  test("hint truth + ring + close: base, added (click) — footer equals 'Right-click for' + the visible action labels", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await pickScenarioWithAdded(page, "p-median-us");
    try {
      await openWorkspace(page, "p-median-us", id);
      const whs = markersOf(page, "wh-marker");
      const n = await whs.count();
      const reach = (await reachableIndices(whs)).filter(i => i !== n - 1);
      expect(reach.length, "reachable base warehouses").toBeGreaterThan(0);

      await whs.nth(reach[0]).click({ timeout: T });
      await expect(card(page)).toBeVisible({ timeout: T });
      const baseLabels = await actionLabels(page);
      expect(baseLabels.length, "base action buttons").toBe(2);
      expect(hintMatches(await page.getByTestId("map-details-footer").innerText(), baseLabels)).toBe(true);
      // A wrong hint WOULD be caught: the same footer against the added entity's labels does not match.
      expect(hintMatches(await page.getByTestId("map-details-footer").innerText(), ["Edit…", "Move", "Copy", "Delete"])).toBe(false);

      // Selecting another marker moves the ring (never two).
      await page.getByTestId("map-details-close").click({ timeout: T });
      await expect(card(page)).toHaveCount(0);
      await selectAddedWarehouse(page, "click");
      const addedLabels = await actionLabels(page);
      expect(addedLabels.length, "added action buttons").toBe(4);
      expect(hintMatches(await page.getByTestId("map-details-footer").innerText(), addedLabels)).toBe(true);
      const rings = await ringedMarkers(page);
      expect(rings.length).toBe(1);
      expect(rings[0].stroke).toBe(RING_STROKE);
      // Customers get the ring too (and only they, then).
      await page.getByTestId("map-details-close").click({ timeout: T });
      const css = markersOf(page, "cs-marker");
      const csReach = await reachableIndices(css);
      expect(csReach.length, "reachable customers").toBeGreaterThan(0);
      await css.nth(csReach[0]).click({ timeout: T });
      await expect(card(page)).toBeVisible({ timeout: T });
      const csRings = await ringedMarkers(page);
      expect(csRings.length).toBe(1);
      expect(csRings[0].cls).toContain("cs-marker");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("keyboard: with the card open, Tab reaches Edit and Enter opens the edit dialog; Escape closes the card and returns focus", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await pickScenarioWithAdded(page, "p-median-us");
    try {
      await openWorkspace(page, "p-median-us", id);
      const whs = markersOf(page, "wh-marker");
      const n = await whs.count();
      const reach = (await reachableIndices(whs)).filter(i => i !== n - 1);
      expect(reach.length).toBeGreaterThan(0);
      const marker = whs.nth(reach[0]);

      // Escape path: the card closes and focus goes back to where it was when the card opened (the marker just clicked).
      await marker.click({ timeout: T });
      await expect(card(page)).toBeVisible({ timeout: T });
      await expect(card(page), "the card takes focus when it opens").toBeFocused();
      await page.keyboard.press("Escape");
      await expect(card(page)).toHaveCount(0);
      await expect(marker, "focus returns to the marker the card was opened from").toBeFocused();

      // Tab path: reach Edit within the card's tab order and activate it with Enter.
      await marker.click({ timeout: T });
      await expect(card(page)).toBeVisible({ timeout: T });
      let reached = false;
      const seen: string[] = [];
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press("Tab");
        const tid = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "");
        seen.push(tid);
        reached = tid === "map-details-action-edit";
      }
      expect(reached, `Tab never reached map-details-action-edit; saw ${JSON.stringify(seen)}`).toBe(true);
      expect(seen[0], "the Close button precedes the actions in tab order").toBe("map-details-close");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("edit-warehouse-dialog")).toBeVisible({ timeout: T });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("keyboard: a marker focused by keyboard opens the card on Enter, and Tab then reaches Edit", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await pickScenarioWithAdded(page, "p-median-us");
    try {
      await openWorkspace(page, "p-median-us", id);
      const whs = markersOf(page, "wh-marker");
      const n = await whs.count();
      const reach = (await reachableIndices(whs)).filter(i => i !== n - 1);
      expect(reach.length).toBeGreaterThan(0);
      const marker = whs.nth(reach[0]);
      await marker.focus(); // role=button, tabindex=0: what Tab lands on
      await expect(marker).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(card(page)).toBeVisible({ timeout: T });
      await expect(card(page), "the card takes focus when it opens").toBeFocused();
      let reached = false;
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "map-details-action-edit";
      }
      expect(reached, "Tab reaches map-details-action-edit").toBe(true);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("placement: the card keeps >= 24px clear of the selected marker's real box near every edge and for the largest demand bubble", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us", SOLVED_MODEL_INPUTS["p-median-us"], "E2E DU-3.5 placement");
    try {
      await openWorkspace(page, "p-median-us", id);
      await page.getByTestId("toggle-layer-size-by-demand").click({ timeout: T });
      const pins = page.locator(`${IN_MAP} .leaflet-marker-icon.wh-marker, ${IN_MAP} .leaflet-marker-icon.cs-marker`);
      const reach = await reachableIndices(pins);
      expect(reach.length, "reachable markers").toBeGreaterThan(5);

      const info = await pins.evaluateAll((els, idxs) => {
        const k = document.querySelector('[data-testid="input-map-tab"] .leaflet-container')!.getBoundingClientRect();
        return idxs.map(i => {
          const r = els[i].getBoundingClientRect();
          return { i, cx: r.x + r.width / 2 - k.x, cy: r.y + r.height / 2 - k.y, w: r.width, isCs: (els[i] as HTMLElement).className.includes("cs-marker"), kw: k.width, kh: k.height };
        });
      }, reach);
      const by = <K extends "cx" | "cy" | "w">(key: K, dir: 1 | -1, only?: (m: (typeof info)[number]) => boolean) =>
        info.filter(m => (only ? only(m) : true)).reduce((a, b) => (dir * (b[key] - a[key]) > 0 ? b : a));
      const left = by("cx", -1), right = by("cx", 1), top = by("cy", -1), bottom = by("cy", 1);
      const biggest = by("w", 1, m => m.isCs);
      const smallestCs = by("w", -1, m => m.isCs);
      expect(biggest.w, "size-by-demand must produce differently sized bubbles").toBeGreaterThan(smallestCs.w + 4);
      // "Near an edge" is only meaningful if the chosen marker really is near it.
      const kw = info[0].kw, kh = info[0].kh;
      expect(left.cx, "left-most marker within 35% of the left edge").toBeLessThan(kw * 0.35);
      expect(kw - right.cx, "right-most marker within 35% of the right edge").toBeLessThan(kw * 0.35);
      expect(top.cy, "top-most marker within 45% of the top edge").toBeLessThan(kh * 0.45);
      expect(kh - bottom.cy, "bottom-most marker within 45% of the bottom edge").toBeLessThan(kh * 0.45);

      const cases = [["left", left], ["right", right], ["top", top], ["bottom", bottom], ["largest-demand-bubble", biggest]] as const;
      for (const [name, m] of cases) {
        // click through the page (not the locator) so a card from the previous case never intercepts
        if (await card(page).count()) await page.getByTestId("map-details-close").click({ timeout: T });
        await expect(card(page)).toHaveCount(0);
        await pins.nth(m.i).click({ timeout: T });
        await expect(card(page)).toBeVisible({ timeout: T });
        const g = await geometry(page);
        const gap = boxGap(g.card, g.marker);
        expect(gap, `${name}: card clears the selected marker box by >= ${KEEP_OUT}px (marker ${g.marker.width.toFixed(0)}px)`).toBeGreaterThanOrEqual(KEEP_OUT - KEEP_OUT_TOL);
        expect(inside(g.card, g.container), `${name}: card stays inside the map`).toBe(true);
        if (name === "largest-demand-bubble") expect(g.marker.width, "the largest bubble is really big").toBeGreaterThanOrEqual(biggest.w - 0.5);
        if (name === "right") await shot(page, "04-card-right-edge-flipped.png");
      }

    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("pan by mouse drag: the card stays attached to the selected marker (DU-3.2 decision: re-anchor, not dismiss)", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us", SOLVED_MODEL_INPUTS["p-median-us"], "E2E DU-3.5 mouse pan");
    try {
      await openWorkspace(page, "p-median-us", id);
      await zoomControl(page, "click", 2);
      const { marker } = await topmostMarker(page, markersOf(page, "wh-marker"));
      await expectCardFollowsPan(page, marker, "click", async (from, to) => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
      });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ── "Unverified" ────────────────────────────────────────────────────────────
/** Number of elements at/under `locator` that carry a native `title` attribute. */
const titledWithin = (locator: Locator) => locator.evaluate(el => (el.hasAttribute("title") ? 1 : 0) + el.querySelectorAll("[title]").length);
const legacyResult = () => ({ ...loadFixture("p-median-us"), solutionStatus: null }); // the shape the api-server read-path guard stamps on a pre-B2 row
const UNVERIFIED_TEXT = "Solved before solution quality was recorded";

async function openLegacyCostSummary(page: Page): Promise<string> {
  const id = await createScenario(page, "p-median-us", SOLVED_MODEL_INPUTS["p-median-us"], "E2E DU-3.5 unverified");
  await seedSolvedResult(page, id, legacyResult());
  await openWorkspace(page, "p-median-us", id);
  await openEntry(page, "sidebar-output-cost-summary");
  const quality = page.getByTestId("cost-summary-value-quality");
  await expect(quality).toContainText("Unverified", { timeout: T });
  return id;
}

test.describe("DU-3.5 Unverified (desktop: keyboard)", () => {
  test("the word has no native title; the ⓘ is reached by Tab, Enter opens the popover, Escape closes it and returns focus", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await openLegacyCostSummary(page);
    try {
      const quality = page.getByTestId("cost-summary-value-quality");
      // Detector can fail: inject a title and it must be counted.
      expect(await titledWithin(quality), "no native title anywhere in the Quality cell").toBe(0);
      await quality.evaluate(el => el.setAttribute("title", "probe"));
      expect(await titledWithin(quality), "probe: an injected title IS detected").toBe(1);
      await quality.evaluate(el => el.removeAttribute("title"));

      const info = page.getByTestId("button-unverified-info");
      await expect(info).toHaveCount(1);
      const box = (await info.boundingBox())!;
      expect(box.width, "ⓘ hit area >= 24px").toBeGreaterThanOrEqual(23.99);
      expect(box.height).toBeGreaterThanOrEqual(23.99);
      await expect(page.getByTestId("popover-unverified")).toHaveCount(0);

      await page.getByTestId("cost-summary-value-runtime").click({ timeout: T }); // start the Tab sequence just before the ⓘ
      let reached = false;
      const seen: string[] = [];
      for (let i = 0; i < 12 && !reached; i++) {
        await page.keyboard.press("Tab");
        const tid = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "");
        seen.push(tid);
        reached = tid === "button-unverified-info";
      }
      expect(reached, `Tab never reached the ⓘ; saw ${JSON.stringify(seen)}`).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("popover-unverified")).toBeVisible({ timeout: T });
      await expect(page.getByTestId("popover-unverified")).toContainText(UNVERIFIED_TEXT);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("popover-unverified")).toHaveCount(0);
      await expect(info, "focus returns to the ⓘ").toBeFocused();
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT MAP — both-leg filter, filter-aware narrative, popup/tooltip/legend
// ═══════════════════════════════════════════════════════════════════════════
const OUT = '[data-testid="output-map-tab"]';
const INBOUND_LEGS = new Set(["plant_to_warehouse", "mine_to_refinery"]);
type Edge = { leg?: string | null; fromId: string; toId: string; flow: number; distance: number; productId?: string };
type Fixture = { edges: Edge[]; details: { openWarehouseIds: string[]; assignments?: Array<{ customerId: string; warehouseId: string; productId: string; distanceMi: number; flow: number }> } & Record<string, unknown> } & Record<string, unknown>;

/**
 * What the map SHOULD draw, computed from the solved fixture alone (no product code):
 * lanes are the distinct (leg, from, to); a warehouse keeps its outbound lanes + the inbound lanes into it;
 * a customer keeps its own lanes + the inbound lanes into every warehouse serving it (Q3).
 */
function laneOracle(fixture: Fixture, sel: { warehouse: string } | { customer: string }) {
  const lanes = new Map<string, { inbound: boolean; from: string; to: string }>();
  for (const e of fixture.edges) lanes.set(`${e.leg ?? ""}|${e.fromId}|${e.toId}`, { inbound: INBOUND_LEGS.has(e.leg ?? ""), from: e.fromId, to: e.toId });
  const serving = "warehouse" in sel ? new Set([sel.warehouse]) : new Set(fixture.edges.filter(e => !INBOUND_LEGS.has(e.leg ?? "") && e.toId === sel.customer).map(e => e.fromId));
  let bright = 0, dim = 0, dimInbound = 0;
  const touched = new Set<string>();
  for (const l of lanes.values()) {
    const hit = l.inbound ? serving.has(l.to) : "warehouse" in sel ? l.from === sel.warehouse : l.to === sel.customer;
    if (hit) { bright++; touched.add(l.from); touched.add(l.to); } else { dim++; if (l.inbound) dimInbound++; }
  }
  return { total: lanes.size, bright, dim, dimInbound, touched, serving };
}

async function laneOpacities(page: Page): Promise<number[]> {
  return page.locator(`${OUT} .leaflet-route-pane path`).evaluateAll(els => els.map(e => parseFloat(getComputedStyle(e).strokeOpacity)));
}
type Icon = { kind: "wh" | "mine" | "plant" | "other"; opacity: number; ringed: boolean; x: number; y: number; reachable: boolean };
async function iconStates(page: Page): Promise<Icon[]> {
  return page.locator(`${OUT} .leaflet-marker-icon`).evaluateAll(els =>
    els.map(el => {
      const svg = el.querySelector("svg")!;
      const kind = svg.querySelector('polygon[points="12,2 22,20 2,20"]') ? "wh" : svg.querySelector('path[d^="M12 2L14.2"]') ? "mine" : svg.querySelector('polygon[fill="var(--map-plant)"]') ? "plant" : "other";
      const r = el.getBoundingClientRect();
      // A pointer-reachable point on the icon: centre first, then a grid across its box (a plant icon can cover part of a warehouse icon).
      let x = r.x + r.width / 2, y = r.y + r.height / 2, reachable = false;
      outer: for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.75], [0.25, 0.75], [0.75, 0.75], [0.5, 0.25], [0.25, 0.5], [0.75, 0.5], [0.15, 0.85], [0.85, 0.85]]) {
        const px = r.x + r.width * fx, py = r.y + r.height * fy;
        const hit = document.elementFromPoint(px, py);
        if (hit && el.contains(hit)) { x = px; y = py; reachable = true; break outer; }
      }
      return { kind, opacity: parseFloat(getComputedStyle(svg).opacity), ringed: !!svg.querySelector('circle[stroke="var(--map-ring-select)"]'), x, y, reachable } as Icon;
    }),
  );
}
type Circle = { idx: number; x: number; y: number };
/**
 * The reachable circle whose popup has the most room above it: the lowest circle in the middle 60% of the map's
 * width (a popup opens ABOVE its customer and autoPan is off, so a high circle's popup is clipped by the map).
 */
async function popupCircle(page: Page, cs: Circle[]): Promise<Circle> {
  const k = (await page.locator(`${OUT} .leaflet-container`).boundingBox())!;
  const mid = cs.filter(c => c.x > k.x + k.width * 0.2 && c.x < k.x + k.width * 0.8 && c.y < k.y + k.height - 12);
  expect(mid.length, "reachable circles in the middle of the map").toBeGreaterThan(0);
  return mid.reduce((a, b) => (b.y > a.y ? b : a));
}
/** Customer circles (SVG paths in the overlay pane, dataset order) that a pointer reaches. */
async function reachableCircles(page: Page): Promise<{ all: number; reachable: Circle[] }> {
  return page.locator(`${OUT} .leaflet-overlay-pane path.leaflet-interactive`).evaluateAll(els => ({
    all: els.length,
    reachable: els.flatMap((el, idx) => {
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return hit === el && x > 0 && y > 0 && x < window.innerWidth && y < window.innerHeight ? [{ idx, x, y }] : [];
    }),
  }));
}
/** Hover first (a real pointer arrives before it presses; the tooltip opens and may re-render the marker), then click. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(250);
  await page.mouse.click(x, y);
}
/** Click empty map (tile/container, not a marker, lane or popup) to deselect. */
async function clickOutputBackground(page: Page): Promise<void> {
  const spot = await page.evaluate(() => {
    const k = document.querySelector('[data-testid="output-map-tab"] .leaflet-container')!.getBoundingClientRect();
    for (let fy = 0.5; fy < 0.97; fy += 0.07) {
      for (let fx = 0.05; fx < 0.5; fx += 0.07) {
        const x = k.x + k.width * fx, y = k.y + k.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el && (el.classList.contains("leaflet-container") || el.classList.contains("leaflet-tile"))) return { x, y };
      }
    }
    return null;
  });
  expect(spot, "an empty map point to click").not.toBeNull();
  await clickAt(page, spot!.x, spot!.y);
}
const narrativeText = (page: Page) => page.getByTestId("output-map-narrative-summary").innerText();
const legendOpacity = (page: Page) => page.locator(`${OUT} [data-testid="map-legend"]`).evaluate(el => parseFloat(getComputedStyle(el).opacity));
const visibleTooltips = (page: Page) =>
  page.locator(`${OUT} .leaflet-tooltip`).evaluateAll(els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).opacity !== "0"; }).map(e => (e as HTMLElement).innerText.trim()));

async function datasetFor(page: Page, modelId: string): Promise<{ customers: Array<{ id: string; city: string; state: string }>; warehouses: Array<{ id: string; city: string; state: string }>; products?: Array<{ id: string; name: string }> }> {
  const r = await page.request.get(`/api/dataset?modelId=${modelId}`);
  expect(r.status()).toBe(200);
  return r.json();
}

async function openOutputMap(page: Page, modelId: string, id: string, fixture: unknown): Promise<void> {
  await seedSolvedResult(page, id, fixture);
  await openWorkspace(page, modelId, id);
  await openEntry(page, "sidebar-output-output-map");
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: T });
  await expect.poll(() => page.locator(`${OUT} .leaflet-route-pane path`).count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await settle(page);
}

/**
 * Hover every pointer-reachable open-warehouse icon and read "<Type> · City, ST · CODE · N customers".
 * `total` counts ALL open-warehouse icons: a warehouse can sit under a coincident plant icon and be reachable only
 * after zooming (JADE: Baltimore), so it is reported, not silently skipped.
 */
async function readWarehouses(page: Page): Promise<{ total: number; reached: { x: number; y: number; n: number; name: string }[] }> {
  const whs = (await iconStates(page)).filter(i => i.kind === "wh");
  expect(whs.length, "open warehouse icons on the Output Map").toBeGreaterThan(0);
  const out: { x: number; y: number; n: number; name: string }[] = [];
  for (const w of whs.filter(i => i.reachable)) {
    await page.mouse.move(w.x, w.y);
    const tip = page.locator(`${OUT} .leaflet-tooltip`).last();
    await expect(tip).toBeVisible({ timeout: 3_000 });
    const text = (await tip.innerText()).trim();
    const m = text.match(/(\d+) customers?/);
    expect(m, `warehouse tooltip "${text}" carries a customer count`).not.toBeNull();
    out.push({ x: w.x, y: w.y, n: Number(m![1]), name: text.split(" · ")[1] });
  }
  await page.mouse.move(2, 2);
  return { total: whs.length, reached: out };
}

/**
 * Hand-authored variant (declared in the header): in the solved JADE/Super fixtures every plant feeds every open
 * warehouse, so "dims unconnected plants" could never fire. Drop the LAST plant's inbound edges to every warehouse
 * but its first, so selecting any other warehouse leaves that plant unconnected.
 */
function withUnconnectedPlant(fixture: Fixture): Fixture {
  const v: Fixture = JSON.parse(JSON.stringify(fixture));
  const inbound = v.edges.filter(e => INBOUND_LEGS.has(e.leg ?? ""));
  const plant = inbound[inbound.length - 1].fromId;
  const keep = inbound.find(e => e.fromId === plant)!.toId;
  v.edges = v.edges.filter(e => !(INBOUND_LEGS.has(e.leg ?? "") && e.fromId === plant && e.toId !== keep));
  return v;
}

/**
 * Click each open warehouse in turn and check, against the fixture oracle: lane opacity on EVERY lane (both legs),
 * source-icon dimming, the single selection ring, and the narrative; then re-click and require full restoration.
 */
async function expectWarehouseFilter(page: Page, fixture: Fixture, opts: { shotName?: string; expectDimmedLanes: boolean; moneyNarrative: boolean; expectUnconnectedPlants: boolean }): Promise<void> {
  const total = laneOracle(fixture, { warehouse: fixture.details.openWarehouseIds[0] }).total;
  const base = await laneOpacities(page);
  expect(base.length, "drawn lanes == distinct fixture lanes (anchors the oracle)").toBe(total);
  expect(base.every(o => o === 0.75), `no selection: every lane 0.75, saw ${JSON.stringify([...new Set(base)])}`).toBe(true);
  const icons0 = await iconStates(page);
  const sources0 = icons0.filter(i => i.kind === "plant" || i.kind === "mine");
  expect(sources0.length, "source icons (plants/mine) on the map").toBeGreaterThan(0);
  expect(icons0.every(i => i.opacity === 1), "no selection: no icon is dimmed").toBe(true);
  const narrative0 = await narrativeText(page);
  // The "no $" check can only fail if the unselected narrative states money; a distance-objective model (gold) does not.
  if (opts.moneyNarrative) expect(narrative0, "narrative states money before a selection (so 'no $' after is meaningful)").toContain("$");
  else expect(narrative0, "distance-objective narrative: no money to begin with").not.toContain("$");

  const { total: whTotal, reached: whs } = await readWarehouses(page);
  const openIds = fixture.details.openWarehouseIds;
  expect(whTotal, "one icon per open warehouse").toBe(openIds.length);
  expect(whs.length, "at least one open warehouse is reachable; at least two when the model has several").toBeGreaterThanOrEqual(Math.min(2, openIds.length));
  const outCount = (id: string) => fixture.edges.filter(e => e.fromId === id).length;
  expect(new Set(openIds.map(outCount)).size, "customer counts distinguish the open warehouses").toBe(openIds.length);
  const plantCount = sources0.filter(i => i.kind === "plant").length;

  let unconnectedPlantsSeen = 0;
  for (const w of whs) {
    const id = openIds.find(o => outCount(o) === w.n)!;
    expect(id, `warehouse "${w.name}" (${w.n} customers) maps to a fixture id`).toBeTruthy();
    const o = laneOracle(fixture, { warehouse: id });
    if (opts.expectDimmedLanes) {
      expect(o.dim, `${w.name}: oracle expects dimmed lanes`).toBeGreaterThan(0);
      expect(o.dimInbound, `${w.name}: oracle expects dimmed INBOUND lanes (the second leg)`).toBeGreaterThan(0);
    } else {
      expect(o.dim, `${w.name}: the model builds one site, so every lane is connected`).toBe(0);
    }

    await clickAt(page, w.x, w.y);
    await expect.poll(async () => (await iconStates(page)).filter(i => i.ringed).length, { timeout: T, message: `${w.name}: selection ring appears` }).toBe(1);
    const lanes = await laneOpacities(page);
    expect(lanes.length).toBe(total);
    expect(lanes.every(l => l === 0.75 || l === 0.1), `only 0.75 / 0.1 lane opacities, saw ${JSON.stringify([...new Set(lanes)])}`).toBe(true);
    expect(lanes.filter(l => l === 0.75).length, `${w.name}: connected lanes stay 0.75`).toBe(o.bright);
    expect(lanes.filter(l => l === 0.1).length, `${w.name}: unconnected lanes (both legs) dim to 0.1`).toBe(o.dim);

    const icons = await iconStates(page);
    const ring = icons.filter(i => i.ringed);
    expect(ring.length).toBe(1);
    expect(ring[0].kind).toBe("wh");
    expect(icons.filter(i => i.kind === "wh" && i.opacity < 0.5).length, `${w.name}: the other open warehouses dim`).toBe(whTotal - 1);
    const feedingPlants = new Set(fixture.edges.filter(e => INBOUND_LEGS.has(e.leg ?? "") && e.toId === id).map(e => e.fromId)).size;
    if (plantCount > 0) {
      unconnectedPlantsSeen += plantCount - feedingPlants;
      expect(icons.filter(i => i.kind === "plant" && i.opacity < 0.5).length, `${w.name}: plants that feed no lane into it dim`).toBe(plantCount - feedingPlants);
    }
    expect(icons.filter(i => i.kind === "mine" && i.opacity < 0.5).length, "a mine feeding the selection stays bright").toBe(0);
    const narrative = await narrativeText(page);
    expect(narrative, `${w.name}: the narrative follows the selected warehouse`).toContain(w.name);
    expect(narrative, `${w.name}: no cost figure for a single warehouse`).not.toContain("$");
    if (opts.shotName && w === whs[0]) { await page.mouse.move(2, 2); await shot(page.locator(OUT), opts.shotName); }

    // Deselect with a map-background click (the first-press re-click case has its own test below), then require full restoration.
    await clickOutputBackground(page);
    await expect.poll(async () => (await iconStates(page)).filter(i => i.ringed).length, { timeout: T }).toBe(0);
    const restored = await laneOpacities(page);
    expect(restored.every(l => l === 0.75), `${w.name}: deselecting restores every lane`).toBe(true);
    expect((await iconStates(page)).every(i => i.opacity === 1), `${w.name}: deselecting restores every icon`).toBe(true);
    expect(await narrativeText(page), `${w.name}: deselecting restores the narrative`).toBe(narrative0);
  }
  if (opts.expectUnconnectedPlants) expect(unconnectedPlantsSeen, "plant dimming was exercised on at least one unconnected plant").toBeGreaterThan(0);
}

test.describe("DU-3.5 Output Map filter, popup, legend (desktop)", () => {
  // Tall enough that a JADE popup (~400px, opens above its customer, autoPan off) fits for a low customer.
  test.use({ viewport: { width: 1280, height: 1100 } });

  test("gold (one open refinery): selecting it dims nothing (every lane is connected), rings it, and the narrative names it with no $; selecting a CUSTOMER dims the other customers' lanes but keeps the mine->refinery lane", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const modelId = "two-echelon-gold-au";
    const fixture = loadFixture(modelId) as Fixture;
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 gold");
    try {
      await openOutputMap(page, modelId, id, fixture);
      await expectWarehouseFilter(page, fixture, { expectDimmedLanes: false, moneyNarrative: false, expectUnconnectedPlants: false });

      // Customer selection: bright = its own lane + the inbound lane into the serving refinery; everything else 0.1.
      const ds = await datasetFor(page, modelId);
      const { all, reachable } = await reachableCircles(page);
      expect(all, "customer circles == dataset customers (index -> id mapping holds)").toBe(ds.customers.length);
      expect(reachable.length, "reachable customer circles").toBeGreaterThan(0);
      const c = await popupCircle(page, reachable);
      const o = laneOracle(fixture, { customer: ds.customers[c.idx].id });
      expect(o.dim, "oracle: other customers' lanes dim").toBeGreaterThan(0);
      expect(o.bright, "oracle: own lane + mine->refinery lane").toBe(2);
      await clickAt(page, c.x, c.y);
      await expect(page.locator(".leaflet-popup")).toBeVisible({ timeout: T });
      await expect.poll(async () => (await laneOpacities(page)).filter(l => l === 0.1).length, { timeout: T }).toBe(o.dim);
      const lanes = await laneOpacities(page);
      expect(lanes.filter(l => l === 1).length, "customer selection draws its lanes at full opacity").toBe(o.bright);
      expect((await iconStates(page)).filter(i => i.kind === "mine").every(i => i.opacity === 1), "the mine feeds the selected customer's refinery: stays bright").toBe(true);
      await clickOutputBackground(page);
      await expect.poll(async () => (await laneOpacities(page)).every(l => l === 0.75), { timeout: T }).toBe(true);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("JADE: clicking each open warehouse dims every unconnected lane on BOTH legs + unconnected plants; narrative names it, no $; re-click restores", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const modelId = "two-echelon-jade-us";
    const fixture = withUnconnectedPlant(loadFixture(modelId) as Fixture);
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 jade filter");
    try {
      await openOutputMap(page, modelId, id, fixture);
      await expectWarehouseFilter(page, fixture, { expectDimmedLanes: true, moneyNarrative: true, expectUnconnectedPlants: true, shotName: "05-jade-filter-dimmed-both-legs.png" });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("Super: clicking each open warehouse dims every unconnected lane on both legs + unconnected plants; narrative names it, no $; re-click restores", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const modelId = "super-model";
    const fixture = withUnconnectedPlant(loadFixture(modelId) as Fixture);
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 super filter");
    try {
      await openOutputMap(page, modelId, id, fixture);
      await expectWarehouseFilter(page, fixture, { expectDimmedLanes: true, moneyNarrative: true, expectUnconnectedPlants: true });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("popup hygiene: no tooltip for the popup's own customer; legend fades while a tooltip/popup is open and returns to 1; JADE popup lists each product with its warehouse and sources", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const modelId = "two-echelon-jade-us";
    const fixture = loadFixture(modelId) as Fixture;
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 jade popup");
    try {
      await openOutputMap(page, modelId, id, fixture);
      const ds = await datasetFor(page, modelId);
      const { all, reachable } = await reachableCircles(page);
      expect(all).toBe(ds.customers.length);
      expect(reachable.length, "reachable customer circles").toBeGreaterThan(0);
      const c = await popupCircle(page, reachable);
      const cust = ds.customers[c.idx];

      // Legend is fully visible at rest.
      await page.mouse.move(2, 2);
      await expect.poll(() => legendOpacity(page), { timeout: T }).toBe(1);

      // Hover: the customer's tooltip shows (precondition) and the legend fades.
      await page.mouse.move(c.x, c.y);
      await expect.poll(async () => (await visibleTooltips(page)).filter(t => t.startsWith("Customer ·")).length, { timeout: T, message: "hover shows the customer tooltip" }).toBe(1);
      await expect.poll(() => legendOpacity(page), { timeout: T, message: "legend fades while a tooltip is open" }).toBeLessThanOrEqual(0.2);
      await shot(page.locator(OUT), "06-legend-faded-under-tooltip.png");

      // Click: the popup opens and the customer's OWN tooltip is gone.
      await clickAt(page, c.x, c.y);
      const popup = page.locator(".leaflet-popup");
      await expect(popup).toBeVisible({ timeout: T });
      await page.waitForTimeout(500);
      expect((await visibleTooltips(page)).filter(t => t.startsWith("Customer ·")), "no tooltip for the popup's own customer").toEqual([]);
      await expect.poll(() => legendOpacity(page), { timeout: T, message: "legend stays faded while the popup is open" }).toBeLessThanOrEqual(0.2);

      // JADE popup: header city, one row per product with its warehouse and each feeding source, from the fixture.
      const text = (await popup.locator(".leaflet-popup-content").innerText()).replace(/\s+/g, " ");
      expect(text).toContain(`${cust.city}, ${cust.state}`);
      const rows = fixture.details.assignments!.filter(a => a.customerId === cust.id);
      expect(rows.length, "fixture rows for this customer").toBeGreaterThan(1);
      const whName = (wid: string) => { const w = ds.warehouses.find(x => x.id === wid)!; return `${w.city}, ${w.state}`; };
      expect((text.match(/ via /g) ?? []).length, "one 'via' row per product").toBe(rows.length);
      let expectedSources = 0;
      for (const r of rows) {
        // The product label (name OR raw id — see the dedicated names test) followed by its own warehouse.
        const pname = ds.products!.find(p => p.id === r.productId)!.name;
        expect(text, `row for ${r.productId}`).toMatch(new RegExp(`(?:${pname}|${r.productId}) via ${whName(r.warehouseId)}`));
        expectedSources += fixture.edges.filter(e => e.productId === r.productId && e.toId === r.warehouseId && INBOUND_LEGS.has(e.leg ?? "")).length;
      }
      expect(expectedSources, "oracle: the popup has feeding-source lines to check").toBeGreaterThan(0);
      expect((text.match(/from [^:]+: [\d,]+ \(/g) ?? []).length, "one 'from <source>: flow (distance)' line per feeding inbound edge").toBe(expectedSources);

      // Close the popup: the tooltip is allowed again on a fresh hover, and the legend returns to 1.
      await popup.locator(".leaflet-popup-close-button").click({ timeout: T });
      await expect(popup).toHaveCount(0);
      await page.mouse.move(2, 2);
      await expect.poll(() => legendOpacity(page), { timeout: T, message: "legend returns to full opacity" }).toBe(1);
      await page.mouse.move(c.x, c.y);
      await expect.poll(async () => (await visibleTooltips(page)).filter(t => t.startsWith("Customer ·")).length, { timeout: T, message: "tooltip is back after the popup closes" }).toBe(1);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("split sourcing: a customer served by two warehouses shows 'Split across 2 warehouses', no single Distance line, each product with its own warehouse; selecting it keeps inbound lanes into BOTH", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const modelId = "two-echelon-jade-us";
    const base = loadFixture(modelId) as Fixture;
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 split");
    try {
      // Pass 1 (unsplit) just to learn which customer circle a pointer reaches.
      await openOutputMap(page, modelId, id, base);
      const ds = await datasetFor(page, modelId);
      const { reachable } = await reachableCircles(page);
      expect(reachable.length).toBeGreaterThan(0);
      const c = await popupCircle(page, reachable);
      const cust = ds.customers[c.idx];

      // Hand-authored variant (declared in the header): re-point this customer's product-2 at another open warehouse.
      const split: Fixture = JSON.parse(JSON.stringify(base));
      const rows = split.details.assignments!.filter(a => a.customerId === cust.id);
      const w1 = rows[0].warehouseId;
      const w2 = split.details.openWarehouseIds.find(w => w !== w1)!;
      const moved = rows.find(r => r.productId === "product-2")!;
      moved.warehouseId = w2;
      const orig = split.edges.find(e => e.toId === cust.id && !INBOUND_LEGS.has(e.leg ?? ""))!;
      split.edges.push({ ...orig, fromId: w2, flow: moved.flow, distance: moved.distanceMi });
      orig.flow = orig.flow - moved.flow;
      expect(orig.flow, "the original lane keeps some flow").toBeGreaterThan(0);

      await page.unroute(`**/api/scenarios/${id}`);
      await seedSolvedResult(page, id, split);
      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
      await openEntry(page, "sidebar-output-output-map");
      await expect.poll(() => page.locator(`${OUT} .leaflet-route-pane path`).count(), { timeout: 15_000 }).toBe(laneOracle(split, { customer: cust.id }).total);
      await settle(page);
      const again = (await reachableCircles(page)).reachable.find(r => r.idx === c.idx);
      expect(again, "the same customer circle is still reachable after reload").toBeTruthy();

      await clickAt(page, again!.x, again!.y);
      const popup = page.locator(".leaflet-popup");
      await expect(popup).toBeVisible({ timeout: T });
      const text = (await popup.locator(".leaflet-popup-content").innerText()).replace(/\s+/g, " ");
      const whName = (wid: string) => { const w = ds.warehouses.find(x => x.id === wid)!; return `${w.city}, ${w.state}`; };
      expect(text).toContain("Split across 2 warehouses");
      expect(text, "a split customer has no single Distance line").not.toContain("Distance:");
      expect(text).toMatch(new RegExp(`(?:Product Family 2|product-2) via ${whName(w2)}`));
      const other = rows.find(r => r.productId !== "product-2")!;
      expect(text).toMatch(new RegExp(`(?:${ds.products!.find(p => p.id === other.productId)!.name}|${other.productId}) via ${whName(w1)}`));
      await shot(page.locator(OUT), "07-split-sourced-popup.png");

      const o = laneOracle(split, { customer: cust.id });
      expect(o.serving.size, "oracle: two serving warehouses").toBe(2);
      await expect.poll(async () => (await laneOpacities(page)).filter(l => l === 1).length, { timeout: T }).toBe(o.bright);
      const lanes = await laneOpacities(page);
      expect(lanes.filter(l => l === 0.1).length, "every other lane (both legs) dims").toBe(o.dim);
      const inboundIntoBoth = split.edges.filter(e => INBOUND_LEGS.has(e.leg ?? "") && o.serving.has(e.toId));
      expect(new Set(inboundIntoBoth.map(e => e.toId)).size, "inbound lanes into BOTH serving warehouses exist to stay bright").toBe(2);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("popup product rows show the product NAME (dataset.products), not the raw id", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const modelId = "two-echelon-jade-us";
    const fixture = loadFixture(modelId) as Fixture;
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 jade names");
    try {
      await openOutputMap(page, modelId, id, fixture);
      const ds = await datasetFor(page, modelId);
      expect(ds.products!.length, "the dataset names its products").toBeGreaterThan(0);
      const { reachable } = await reachableCircles(page);
      expect(reachable.length).toBeGreaterThan(0);
      const pc = await popupCircle(page, reachable);
      await clickAt(page, pc.x, pc.y);
      const popup = page.locator(".leaflet-popup");
      await expect(popup).toBeVisible({ timeout: T });
      const text = (await popup.locator(".leaflet-popup-content").innerText()).replace(/\s+/g, " ");
      expect(text, "a product row is shown").toContain(" via ");
      for (const p of ds.products!) expect(text, `no raw id "${p.id}" in the popup`).not.toMatch(new RegExp(`\\b${p.id} via`));
      expect(text).toMatch(/Product Family \d via /);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("re-pressing the selected warehouse deselects it on the FIRST press", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const modelId = "two-echelon-gold-au";
    const fixture = loadFixture(modelId) as Fixture;
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 reclick");
    try {
      await openOutputMap(page, modelId, id, fixture);
      const wh = (await iconStates(page)).filter(i => i.kind === "wh" && i.reachable)[0];
      expect(wh, "a reachable open refinery").toBeTruthy();
      await clickAt(page, wh.x, wh.y);
      await expect.poll(async () => (await iconStates(page)).filter(i => i.ringed).length, { timeout: T }).toBe(1);
      await page.waitForTimeout(1000); // let the narrative-driven layout shift settle
      const now = (await iconStates(page)).find(i => i.ringed)!;
      await clickAt(page, now.x, now.y); // ONE press, with a hover before it, exactly like a user
      await expect.poll(async () => (await iconStates(page)).filter(i => i.ringed).length, { timeout: 3_000, message: "one press on the selected warehouse deselects it" }).toBe(0);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("DU-3.5 JADE popup fits in a laptop-height map (1280x720)", () => {
  test("the per-product popup stays inside the map for a customer near the map's vertical centre (header + close button visible)", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const modelId = "two-echelon-jade-us";
    const fixture = loadFixture(modelId) as Fixture;
    const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], "E2E DU-3.5 popup fit");
    try {
      await openOutputMap(page, modelId, id, fixture);
      const k = (await page.locator(`${OUT} .leaflet-container`).boundingBox())!;
      const { reachable } = await reachableCircles(page);
      const centre = reachable
        .filter(c => c.x > k.x + k.width * 0.25 && c.x < k.x + k.width * 0.75)
        .reduce((a, b) => (Math.abs(b.y - (k.y + k.height / 2)) < Math.abs(a.y - (k.y + k.height / 2)) ? b : a));
      await clickAt(page, centre.x, centre.y);
      const popup = page.locator(".leaflet-popup");
      await expect(popup).toBeVisible({ timeout: T });
      const pb = (await popup.boundingBox())!;
      await shot(page, "09-jade-popup-clipped-at-720p.png");
      expect(pb.y, `popup top (${pb.y.toFixed(0)}) must not be above the map's top (${k.y.toFixed(0)}): its header and close button would be clipped`).toBeGreaterThanOrEqual(k.y - 1);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
