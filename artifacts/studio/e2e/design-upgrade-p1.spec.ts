/**
 * DU-1.5 — Phase 1 (Foundations) real-browser QA, all 8 chapters.
 *
 * jsdom cannot see CSS, so the band-stroke dash patterns, the token colours and
 * the 11px floor are only observable here. Results are SEEDED
 * (helpers/seedSolvedResult.ts + fixtures/solved/*.json, captured once by
 * scripts/capture-solved-results.ts): the real solver never runs in this spec.
 *
 * Per chapter: Output Map -> non-vacuity (lanes exist, fixture spans the stated
 * bands) -> every lane stroke is a band token, bands 1+ are dashed, band 0 and
 * overflow solid -> --band-0 is #6F952F -> legend dash samples -> no rendered
 * text under 11px -> Inactive/Excluded segments are not red (read-only: no Save).
 *
 * BAND COVERAGE IS A STATED SUBSET PER MODEL (BAND_EXPECT below). With the
 * default 4 boundaries only band indices 0..3 (+ overflow) exist, so the
 * band-4 dash can only be witnessed by a model with 5 boundaries; the dedicated
 * "five boundaries" test re-bands p-median-us to cover every dash 1..4.
 *
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignBandOrOverflow, OVERFLOW_BAND } from "@workspace/units";
import { test, expect, type Page } from "./fixtures";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS, SUPER_SAMPLE_PATH } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const HEADER_TIMEOUT = 10_000;
const here = path.dirname(fileURLToPath(import.meta.url));

type Edge = { fromId: string; toId: string; distance: number; leg?: string };
const loadFixture = (modelId: string) =>
  JSON.parse(fs.readFileSync(path.join(here, "fixtures/solved", `${modelId}.json`), "utf8")) as { edges: Edge[] };

/**
 * Band indices (OVERFLOW_BAND = overflow) that the committed fixture's edges
 * land in under the model's default distanceBands, measured from the fixtures
 * with the same assignBandOrOverflow the map uses. The spec asserts the fixture
 * equals this EXACTLY, so a re-captured fixture that loses a band fails loudly
 * instead of silently weakening the dash assertions. super-model has no stored
 * distanceBands; OutputMapTab applies DEFAULT_DISTANCE_BANDS (250/500/750) for
 * lane colouring, which is what is used here.
 */
const SUPER_DEFAULT_BANDS = [250, 500, 750];
const BAND_EXPECT: Record<string, number[]> = {
  "p-median-us": [0, 1, 2, 3],
  "max-coverage-us": [0, 1, 2], // nobody is served farther than 1800 mi: band 3 absent
  "transport-coal": [0, 1, 2], // 17 lanes, none beyond 1500
  "p-median-brazil": [0, 1, 2], // singleSource off; none beyond 2000
  "delivery-teaching-us": [0, 1, 2, 3],
  "two-echelon-gold-au": [1, 2], // 5 boundaries but only 11 lanes: bands 0, 3, 4 absent
  "two-echelon-jade-us": [0, 1, 2, 3, OVERFLOW_BAND], // incl. plant->warehouse overflow
  "super-model": [0, 1, 2, OVERFLOW_BAND], // default bands 250/500/750; no band 3
};

const INK = "rgb(24, 26, 21)"; // #181A15
const DANGER = "rgb(185, 28, 28)"; // #B91C1C
const BAND_HEX = ["#6F952F", "#597726", "#455C1D", "#314215", "#1B240B"];

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-du1-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenario(page: Page, modelId: string, inputs: Record<string, unknown>): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name: `E2E DU-1.5 ${modelId}`, modelId, inputs } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  if (modelId === "super-model") {
    const imp = await page.request.post(`/api/scenarios/${id}/network/import?mode=replace`, {
      data: JSON.parse(fs.readFileSync(SUPER_SAMPLE_PATH, "utf8")),
    });
    expect(imp.status(), await imp.text()).toBe(200);
  }
  return id;
}

async function openOutputMap(page: Page, chapterPath: string, id: string): Promise<void> {
  await page.goto(`${chapterPath}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("sidebar-output-output-map").click({ timeout: HEADER_TIMEOUT });
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await expect.poll(() => page.locator(".leaflet-route-pane path").count(), { timeout: 15_000 }).toBeGreaterThan(0);
}

type Lane = { stroke: string | null; dash: string | null; computedStroke: string };
async function readLanes(page: Page): Promise<Lane[]> {
  return page.locator(".leaflet-route-pane path").evaluateAll(els =>
    els.map(el => ({
      stroke: el.getAttribute("stroke"),
      dash: el.getAttribute("stroke-dasharray"),
      computedStroke: getComputedStyle(el).stroke,
    })),
  );
}

/** Visible text nodes rendered below 11px. Expected: []. */
async function textBelowFloor(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const own = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 11) bad.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.className}] ${size}px "${(el.textContent ?? "").trim().slice(0, 40)}"`);
    }
    return bad;
  });
}

const bandVar = (i: number) => (i === OVERFLOW_BAND ? "var(--band-overflow)" : `var(--band-${i})`);

test.describe("DU-1.5 — Phase 1 real-browser QA", () => {
  test.use({ actionTimeout: 15_000 });

  test("covers all 8 chapters, each with a committed fixture and a stated band expectation", () => {
    expect(CHAPTERS).toHaveLength(8);
    for (const c of CHAPTERS) {
      expect(fs.existsSync(path.join(here, "fixtures/solved", `${c.modelId}.json`)), c.modelId).toBe(true);
      expect(c.modelId in BAND_EXPECT, c.modelId).toBe(true);
      expect(c.modelId in SOLVED_MODEL_INPUTS, c.modelId).toBe(true);
    }
  });

  test("unauthenticated /login and /register render no text under 11px", async ({ page }) => {
    for (const route of ["/login", "/register"]) {
      await page.goto(route);
      await expect(page.locator("form").first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await textBelowFloor(page), route).toEqual([]);
    }
  });

  for (const chapter of CHAPTERS) {
    test(`${chapter.modelId} (${chapter.path}) — band ramp, dashes, tokens, 11px floor, neutral Inactive`, async ({ page }) => {
      test.setTimeout(120_000);
      const { modelId } = chapter;
      const inputs = SOLVED_MODEL_INPUTS[modelId];
      const bands = (inputs.distanceBands as number[] | undefined) ?? SUPER_DEFAULT_BANDS;
      const fixture = loadFixture(modelId);
      const expected = BAND_EXPECT[modelId];

      // ── 1. Non-vacuity: the fixture has edges, in exactly the stated bands ──
      expect(fixture.edges.length).toBeGreaterThan(0);
      const present = [...new Set(fixture.edges.map(e => assignBandOrOverflow(e.distance, bands)))].sort((a, b) => a - b);
      expect(present, `${modelId}: fixture band coverage drifted from BAND_EXPECT`).toEqual([...expected].sort((a, b) => a - b));

      await registerAndGoHome(page);
      // L1: the signed-in home page (Landing) carries inline font sizes DU-1.4 raised.
      expect(await textBelowFloor(page), "home page").toEqual([]);
      const id = await createScenario(page, modelId, inputs);
      try {
        await seedSolvedResult(page, id, fixture);
        await openOutputMap(page, chapter.path, id);
        const lanes = await readLanes(page);
        expect(lanes.length).toBeGreaterThan(0);

        // ── 2. Lane strokes ─────────────────────────────────────────────────
        const allowed = new Set([0, 1, 2, 3, 4].map(bandVar).concat("var(--band-overflow)"));
        for (const l of lanes) expect(allowed.has(l.stroke ?? ""), `unexpected lane stroke ${l.stroke}`).toBe(true);
        for (const l of lanes) {
          const dashed = l.stroke !== "var(--band-0)" && l.stroke !== "var(--band-overflow)";
          if (dashed) expect((l.dash ?? "").trim(), `${l.stroke} must be dashed`).not.toBe("");
          else expect((l.dash ?? "").trim(), `${l.stroke} must be solid`).toBe("");
        }
        // Rendered-DOM non-vacuity: every band the fixture claims is actually drawn.
        const drawn = new Set(lanes.map(l => l.stroke));
        for (const b of expected) expect(drawn.has(bandVar(b)), `no lane drawn in ${bandVar(b)}`).toBe(true);

        // ── 3. Token values ─────────────────────────────────────────────────
        const root = await page.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          return [0, 1, 2, 3, 4].map(i => cs.getPropertyValue(`--band-${i}`).trim().toUpperCase());
        });
        expect(root).toEqual(BAND_HEX);
        expect(root[0]).toBe("#6F952F");

        // ── 3b. Legend: a dash sample beside each swatch ────────────────────
        for (let i = 0; i < bands.length; i++) {
          await expect(page.getByTestId(`legend-band-${i}`)).toBeVisible();
          const sample = page.getByTestId(`legend-dash-${i}`);
          await expect(sample).toBeVisible();
          const dash = await sample.locator("line").getAttribute("stroke-dasharray");
          if (i === 0) expect(dash ?? "").toBe("");
          else expect((dash ?? "").trim()).not.toBe("");
        }
        await expect(page.getByTestId("legend-overflow-dash")).toBeVisible();
        expect((await page.getByTestId("legend-overflow-dash").locator("line").getAttribute("stroke-dasharray")) ?? "").toBe("");

        // ── 4. 11px floor on the Output Map view ────────────────────────────
        // Not covered by this detector: ::before/::after content and placeholder text
        // (minTextSize.test.ts covers those at source level).
        if (modelId === "p-median-us") {
          // M1: prove the detector can fail, here, in the repo — then remove the probe.
          await page.evaluate(() => {
            const s = document.createElement("span");
            s.setAttribute("data-testid", "du1-probe");
            s.style.fontSize = "10px";
            s.textContent = "probe";
            document.body.appendChild(s);
          });
          expect((await textBelowFloor(page)).some(l => l.includes("du1-probe")), "detector must flag a 10px probe").toBe(true);
          await page.evaluate(() => document.querySelector('[data-testid="du1-probe"]')?.remove());
        }
        expect(await textBelowFloor(page)).toEqual([]);

        // ── 5. Inactive / Excluded segments are not red (read-only: no Save) ─
        let checkedSegments = 0;
        // super-model's status controls are a different component (SuperEntityDialog.tsx, `super-*-status-*` testids): out of scope here.
        for (const entity of modelId === "super-model" ? [] : ["warehouses", "refineries", "customers"]) {
          const entry = page.getByTestId(`sidebar-input-${entity}`);
          if ((await entry.count()) === 0) continue;
          await entry.click({ timeout: HEADER_TIMEOUT });
          const seg = page.locator('[data-testid^="button-"]:is([data-testid$="-inactive"], [data-testid$="-excluded"])').first();
          await expect(seg).toBeVisible({ timeout: HEADER_TIMEOUT });
          await seg.click({ timeout: HEADER_TIMEOUT });
          // The segment has `transition-colors`: poll past the animation to the settled colour.
          const bgOf = () => seg.evaluate(el => getComputedStyle(el).backgroundColor);
          // `bg-foreground` is the --foreground text ink (not the #181A15 map-marker ink): compare to the body text colour.
          const foreground = await page.evaluate(() => getComputedStyle(document.body).color);
          await expect.poll(bgOf, { timeout: 5_000, message: `${entity} inactive segment should settle on foreground ink` }).toBe(foreground);
          const bg = await bgOf();
          expect(bg).not.toBe("rgb(220, 38, 38)");
          expect(bg).not.toBe("rgb(185, 28, 28)");
          expect(await textBelowFloor(page), `${entity} tab`).toEqual([]);
          checkedSegments++;
        }
        // transport-coal has no warehouse/customer status tab either.
        if (modelId !== "super-model" && modelId !== "transport-coal") expect(checkedSegments).toBeGreaterThan(0);
      } finally {
        await page.request.delete(`/api/scenarios/${id}`);
      }
    });
  }

  test("five boundaries (p-median-us re-banded): every dash 1..4 is drawn and every band has a legend dash", async ({ page }) => {
    test.setTimeout(90_000);
    const bands = [100, 200, 400, 800, 1600];
    const fixture = loadFixture("p-median-us");
    const present = new Set(fixture.edges.map(e => assignBandOrOverflow(e.distance, bands)));
    for (const b of [0, 1, 2, 3, 4]) expect(present.has(b), `fixture has no edge in band ${b} under ${bands}`).toBe(true);

    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us", { ...SOLVED_MODEL_INPUTS["p-median-us"], distanceBands: bands });
    try {
      await seedSolvedResult(page, id, fixture);
      await openOutputMap(page, "/chapter-3", id);
      const lanes = await readLanes(page);
      const dashByStroke = new Map(lanes.map(l => [l.stroke, l.dash ?? ""]));
      for (const b of [1, 2, 3, 4]) {
        expect(dashByStroke.has(`var(--band-${b})`), `no lane drawn in band ${b}`).toBe(true);
        expect(dashByStroke.get(`var(--band-${b})`)!.trim()).not.toBe("");
      }
      expect(dashByStroke.get("var(--band-0)") ?? "").toBe("");
      for (let i = 0; i < 5; i++) await expect(page.getByTestId(`legend-dash-${i}`)).toBeVisible();
      // Five distinct dash patterns across bands 1..4 (+ solid band 0): identity does not rest on colour alone.
      const patterns = [1, 2, 3, 4].map(b => dashByStroke.get(`var(--band-${b})`));
      expect(new Set(patterns).size).toBe(4);
      await page.screenshot({ path: test.info().outputPath("du1-five-bands-legend.png") });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  for (const modelId of ["two-echelon-jade-us", "two-echelon-gold-au", "super-model"]) {
    test(`${modelId} leg-colour mode: inbound lanes are ink, outbound lanes are #B91C1C`, async ({ page }) => {
      test.setTimeout(90_000);
      const chapter = CHAPTERS.find(c => c.modelId === modelId)!;
      await registerAndGoHome(page);
      const id = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId]);
      try {
        await seedSolvedResult(page, id, loadFixture(modelId));
        await openOutputMap(page, chapter.path, id);
        await page.getByTestId("checkbox-color-lanes-band").click({ timeout: HEADER_TIMEOUT });
        await expect.poll(async () => (await readLanes(page)).every(l => l.stroke === "var(--map-warehouse-open)" || l.stroke === "var(--danger)")).toBe(true);
        const lanes = await readLanes(page);
        const inbound = lanes.filter(l => l.stroke === "var(--map-warehouse-open)");
        const outbound = lanes.filter(l => l.stroke === "var(--danger)");
        expect(inbound.length, "inbound lanes drawn").toBeGreaterThan(0);
        expect(outbound.length, "outbound lanes drawn").toBeGreaterThan(0);
        for (const l of inbound) expect(l.computedStroke).toBe(INK);
        for (const l of outbound) expect(l.computedStroke).toBe(DANGER);
        for (const l of lanes) expect((l.dash ?? "").trim(), "leg mode is solid").toBe("");
        await page.screenshot({ path: test.info().outputPath(`du1-leg-colours-${modelId}.png`) });
      } finally {
        await page.request.delete(`/api/scenarios/${id}`);
      }
    });
  }

  test("a destructive toast's close button is visible on the red toast", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us", SOLVED_MODEL_INPUTS["p-median-us"]);
    try {
      await seedSolvedResult(page, id, loadFixture("p-median-us"));
      await page.route(`**/api/scenarios/${id}/export*`, route =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "stubbed export failure" }) }),
      );
      await page.goto(`/chapter-3?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-download-cost-summary").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-download-cost-summary-csv").click({ timeout: HEADER_TIMEOUT });

      const toast = page.locator("li.destructive").filter({ hasText: "Export failed" });
      await expect(toast).toBeVisible({ timeout: HEADER_TIMEOUT });
      await toast.hover(); // the close button is opacity-0 until hover/focus
      const close = toast.locator("[toast-close]");
      await expect(close).toBeVisible();
      await expect(close).toHaveCSS("opacity", "1");

      const px = await close.evaluate(el => {
        const li = el.closest("li")!;
        return { color: getComputedStyle(el).color, bg: getComputedStyle(li).backgroundColor };
      });
      const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [l1, l2] = [lum(rgb(px.color)), lum(rgb(px.bg))].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      expect(ratio, `close icon ${px.color} on toast ${px.bg}`).toBeGreaterThanOrEqual(3);
      await page.screenshot({ path: test.info().outputPath("du1-destructive-toast.png") });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
