/**
 * DU-4.5 — Phase 4 (multi-echelon / multi-product) real-browser QA.
 *
 * jsdom cannot see the things Phase 4 promised: a saved inbound band set surviving a real reload, the
 * Output Map recolouring ONLY inbound lanes (computed SVG strokes), the legend's second section, a
 * browser-saved download whose band text equals the visible cell, keyboard/tap disclosure on a touch
 * viewport, and the server's v4 export envelopes. These are asserted here.
 *
 * REAL SOLVES, not seeded results, for the JADE / gold / p-median scenarios: the server exports read the
 * row's STORED result, which a client-side GET intercept cannot provide (DU-1.5's `seedSolvedResult` only
 * rewrites the browser's GET). The solves take ~0.5s each (solver cache); the CBC timing/accuracy
 * contract stays with pytest + e2e_accuracy.py. The ONE seeded scenario is the split-sourced customer
 * (JADE's solver is single-source per product; no solved result has one), declared below.
 *
 * EVERY CHECK MUST BE ABLE TO FAIL:
 *   - every loop/aggregate asserts its locator or row set is non-empty first;
 *   - every expected number is COMPUTED from the stored result's edges / assignments with
 *     `assignBandOrOverflow` + `bandsForLeg` (never typed in), and a "changed" claim is paired with a
 *     "was different before" claim (the inbound set is chosen so at least one inbound lane changes band,
 *     and the spec asserts that count > 0);
 *   - the stale claim has a CONTROL: a real input edit on the same scenario makes the API report
 *     `stale: true` and disables the Outputs group.
 *
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import { assignBandOrOverflow, bandRangeLabel, bandsForLeg, INBOUND_LEGS, OVERFLOW_BAND } from "@workspace/units";
import { test, expect, type Page } from "./fixtures";
import { downloadVia } from "./helpers/download";
import { readSolvedAt } from "./helpers/solvedAt";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const SOLVE_TIMEOUT = 60_000;
const chapterPath = (modelId: string) => CHAPTERS.find(c => c.modelId === modelId)!.path;

type Edge = { fromId: string; toId: string; distance: number; flow: number; leg?: string; productId?: string };
type Assignment = { customerId: string; warehouseId: string; productId: string; distanceMi: number; flow?: number };
type Result = { edges: Edge[]; details: { assignments?: Assignment[]; openWarehouseIds?: string[] } };
type Row = Record<string, unknown>;

// ── plumbing ────────────────────────────────────────────────────────────────
async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-du4-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Create + REAL solve through the API, waiting on solvedAt (captured BEFORE the trigger). */
async function createAndSolve(page: Page, modelId: string, inputs: Record<string, unknown>): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name: `E2E DU-4.5 ${modelId}`, modelId, inputs } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  const before = await readSolvedAt(page, id);
  expect(before, "a fresh scenario has no solvedAt").toBeNull();
  const solve = await page.request.post(`/api/scenarios/${id}/solve`, { data: {} });
  expect(solve.status(), await solve.text()).toBe(202);
  await expect.poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [300, 500, 1000] }).not.toBeNull();
  return id;
}

async function getScenario(page: Page, id: string): Promise<{ inputs: Row; result: Result; stale: boolean; solvedAt: string }> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  return resp.json();
}

async function openWorkspace(page: Page, modelId: string, id: string): Promise<void> {
  await page.goto(`${chapterPath(modelId)}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: 15_000 });
}

async function openTab(page: Page, sidebarId: string, tabId: string): Promise<void> {
  await page.getByTestId(sidebarId).click({ timeout: T });
  await expect(page.getByTestId(tabId)).toBeVisible({ timeout: T });
}

const openParams = (page: Page) => openTab(page, "sidebar-input-optimization-parameters", "optimization-parameters-tab");

async function exportJson(page: Page, id: string, entity: string, extra = ""): Promise<{ templateVersion: number; entity: string; unit?: string; rows: Row[] }> {
  const resp = await page.request.get(`/api/scenarios/${id}/export?entity=${entity}&format=json${extra}`);
  expect(resp.status(), await resp.text()).toBe(200);
  return resp.json();
}

/** Minimal RFC-4180 line parser (quoted cells may hold commas: "> 1,600 mi"). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── expectations computed from the stored result ───────────────────────────
const strokeFor = (idx: number) => (idx === OVERFLOW_BAND ? "var(--band-overflow)" : `var(--band-${idx})`);
const sortedStr = (xs: string[]) => [...xs].sort();
const num = (s: string) => Number(s.replace(/,/g, ""));

/** One lane per distinct (leg, from, to) -> its stroke under (customer-facing, inbound) band sets. */
function expectedLaneStrokes(edges: Edge[], distanceBands: number[], inboundDistanceBands: number[] | undefined): { inbound: string[]; outbound: string[] } {
  const lanes = new Map<string, Edge>();
  for (const e of edges) lanes.set(`${e.leg ?? ""}|${e.fromId}|${e.toId}`, e);
  const inbound: string[] = [];
  const outbound: string[] = [];
  for (const e of lanes.values()) {
    const bands = bandsForLeg(e.leg, { distanceBands, inboundDistanceBands });
    (INBOUND_LEGS.has(e.leg ?? "") ? inbound : outbound).push(strokeFor(assignBandOrOverflow(e.distance, bands)));
  }
  return { inbound: sortedStr(inbound), outbound: sortedStr(outbound) };
}

/** Exclusive inbound flow per band (key = band upper boundary, -1 = overflow), summed over inbound-leg edges. */
function expectedInboundFlows(edges: Edge[], bands: number[]): { byBand: Map<number, number>; total: number } {
  const sorted = [...bands].sort((a, b) => a - b);
  const byBand = new Map<number, number>();
  let total = 0;
  for (const e of edges) {
    if (!INBOUND_LEGS.has(e.leg ?? "")) continue;
    const idx = assignBandOrOverflow(e.distance, sorted);
    const key = idx === OVERFLOW_BAND ? -1 : sorted[idx];
    byBand.set(key, (byBand.get(key) ?? 0) + e.flow);
    total += e.flow;
  }
  return { byBand, total };
}

// ── Output Map lane reading ────────────────────────────────────────────────
async function openOutputMap(page: Page): Promise<void> {
  await openTab(page, "sidebar-output-output-map", "output-map-tab");
  await expect.poll(() => page.locator(".leaflet-route-pane path").count(), { timeout: 15_000 }).toBeGreaterThan(0);
}
const strokes = (page: Page) => page.locator(".leaflet-route-pane path").evaluateAll(els => els.map(el => el.getAttribute("stroke") ?? ""));

/** Per-lane [isInbound, band stroke] in DOM order: inbound/outbound from the leg-colour mode, band stroke from the band mode. */
async function readLaneClasses(page: Page): Promise<{ inbound: string[]; outbound: string[] }> {
  await page.getByTestId("segment-lane-colour-leg").click({ timeout: T });
  await expect(page.getByTestId("segment-lane-colour-leg")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await strokes(page)).every(s => s === "var(--map-warehouse-open)" || s === "var(--danger)")).toBe(true);
  const legMode = await strokes(page);
  await page.getByTestId("segment-lane-colour-band").click({ timeout: T });
  await expect(page.getByTestId("segment-lane-colour-band")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await strokes(page)).every(s => s.startsWith("var(--band-"))).toBe(true);
  const bandMode = await strokes(page);
  expect(bandMode.length, "lane count is stable across colour modes").toBe(legMode.length);
  const inbound: string[] = [];
  const outbound: string[] = [];
  legMode.forEach((s, i) => (s === "var(--map-warehouse-open)" ? inbound : outbound).push(bandMode[i]));
  return { inbound: sortedStr(inbound), outbound: sortedStr(outbound) };
}

// ── inbound editor helpers ─────────────────────────────────────────────────
const chipValues = async (page: Page, prefix: "inbound-band-" | "band-"): Promise<number[]> =>
  (await page.locator(`[data-testid^="${prefix}"]`).evaluateAll(els => els.map(e => e.getAttribute("data-testid")!)))
    .map(t => Number(t.slice(prefix.length)))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

async function editInbound(page: Page, add: number[], remove: number[]): Promise<void> {
  for (const v of add) {
    await page.getByTestId("inbound-button-bands-plus").click({ timeout: T });
    await page.getByTestId("inbound-input-new-band").fill(String(v), { timeout: T });
    await page.getByTestId("inbound-button-add-band-confirm").click({ timeout: T });
    await expect(page.getByTestId(`inbound-band-${v}`)).toBeVisible({ timeout: T });
  }
  for (const v of remove) {
    await page.getByTestId(`inbound-button-remove-band-${v}`).click({ timeout: T });
    await expect(page.getByTestId(`inbound-band-${v}`)).toHaveCount(0, { timeout: T });
  }
}

async function saveBands(page: Page): Promise<void> {
  await expect(page.getByTestId("button-save")).toBeEnabled({ timeout: T });
  await expect(page.getByTestId("button-save")).toHaveText(/Save bands/);
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes("/inbound-distance-bands") && r.request().method() === "PATCH", { timeout: T }),
    page.getByTestId("button-save").click({ timeout: T }),
  ]);
  expect(resp.status()).toBe(200);
  await expect(page.getByTestId("text-unsaved-changes")).toHaveCount(0, { timeout: T });
}

interface TwoEchelonCase {
  modelId: string;
  customerFacingLabel: RegExp;
  inboundLabel: RegExp;
  inputs: Record<string, unknown>;
  /** The saved inbound set the spec writes: chosen so inbound lanes land in different bands than the customer-facing set. */
  inboundSet: { add: number[]; remove: number[]; final: number[] };
  staleEdit: Record<string, unknown>;
}

const CASES: TwoEchelonCase[] = [
  {
    modelId: "two-echelon-jade-us",
    customerFacingLabel: /^Customer-facing lanes \(warehouse → customer\) \(mi\)$/,
    inboundLabel: /^Inbound lanes \(plant → warehouse\) \(mi\)$/,
    inputs: {
      p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120,
      warehouseOverrides: [{ id: "wh-11", status: "forced_open" }, { id: "wh-14", status: "forced_open" }],
    },
    inboundSet: { add: [1000, 2000], remove: [200, 400, 800, 1600], final: [1000, 2000] },
    staleEdit: { p: 3 },
  },
  {
    modelId: "two-echelon-gold-au",
    customerFacingLabel: /^Customer-facing lanes \(refinery → customer\) \(mi\)$/,
    inboundLabel: /^Inbound lanes \(mine → refinery\) \(mi\)$/,
    inputs: SOLVED_MODEL_INPUTS["two-echelon-gold-au"],
    inboundSet: { add: [], remove: [1500, 2000, 2600], final: [500, 1000] },
    staleEdit: { bomRatio: 1.2 },
  },
];

test.describe("DU-4.5 — Phase 4 real-browser QA", () => {
  test.use({ actionTimeout: 15_000 });

  for (const c of CASES) {
    test(`${c.modelId}: two band editors, saved inbound set drives lanes/legend/flows/exports, reset, stale control`, async ({ page }) => {
      test.setTimeout(240_000);
      const jade = c.modelId === "two-echelon-jade-us";
      await registerAndGoHome(page);
      const id = await createAndSolve(page, c.modelId, c.inputs);
      const customerBands = c.inputs.distanceBands as number[];
      try {
        const base = await getScenario(page, id);
        const edges = base.result.edges;
        expect(base.stale, "freshly solved scenario is not stale").toBe(false);
        expect(base.inputs.inboundDistanceBands, "key absent before any edit").toBeUndefined();
        const inboundEdges = edges.filter(e => INBOUND_LEGS.has(e.leg ?? ""));
        expect(inboundEdges.length, "the solved result has inbound lanes").toBeGreaterThan(0);
        expect(edges.length - inboundEdges.length, "and outbound lanes").toBeGreaterThan(0);

        await openWorkspace(page, c.modelId, id);

        await test.step("1. both editors, labelled, with the fallback hint while the key is absent", async () => {
          await openParams(page);
          await expect(page.getByText(c.customerFacingLabel)).toBeVisible({ timeout: T });
          await expect(page.getByText(c.inboundLabel)).toBeVisible({ timeout: T });
          await expect(page.getByText(/^Distance bands/)).toHaveCount(0); // the single-editor label is replaced, not duplicated
          await expect(page.getByTestId("inbound-bands-hint")).toHaveText("Using the customer-facing bands until you change these.");
          await expect(page.getByTestId("inbound-bands-reset")).toHaveCount(0);
          expect(await chipValues(page, "band-"), "customer-facing chips").toEqual(customerBands);
          expect(await chipValues(page, "inbound-band-"), "inbound chips mirror the customer-facing set while falling back").toEqual(customerBands);
          await expect(page.getByTestId("button-save")).toBeDisabled(); // showing the fallback copy is not a dirty edit
        });

        // Lane baseline before any inbound edit, and the per-class expectation under the fallback.
        let beforeInbound: string[] = [];
        await test.step("2. fallback: map lanes follow the customer-facing set, legend has ONE section", async () => {
          await openOutputMap(page);
          const lanes = await readLaneClasses(page);
          const exp = expectedLaneStrokes(edges, customerBands, undefined);
          expect(lanes.inbound).toEqual(exp.inbound);
          expect(lanes.outbound).toEqual(exp.outbound);
          beforeInbound = lanes.inbound;
          const legend = page.getByTestId("map-legend");
          await expect(legend).toContainText("Distance bands");
          await expect(legend).not.toContainText("Inbound lanes");
          await expect(page.locator('[data-testid^="legend-inbound-band-"]')).toHaveCount(0);
          await expect(page.locator('[data-testid^="legend-band-"]')).toHaveCount(customerBands.length);
        });

        if (jade) {
          await test.step("3. fallback: Flows Plant to Warehouse bands follow the customer-facing set", async () => {
            await openTab(page, "sidebar-output-flows", "jade-flows-tab");
            const cells = page.locator('[data-testid^="cell-jade-flow-pw-band-"]');
            await expect(cells.first()).toBeVisible({ timeout: T });
            const pairs = new Map<string, number>();
            for (const e of inboundEdges) pairs.set(`${e.fromId}|${e.toId}`, e.distance);
            expect(await cells.count()).toBe(pairs.size);
            const expected = [...pairs.values()].map(d => bandRangeLabel(assignBandOrOverflow(d, customerBands), customerBands, "mi"));
            expect(sortedStr((await cells.allInnerTexts()).map(s => s.trim()))).toEqual(sortedStr(expected));
          });
        }

        await test.step("4. edit the inbound set, save, nothing re-solves, reload persists", async () => {
          await openParams(page);
          await editInbound(page, c.inboundSet.add, c.inboundSet.remove);
          expect(await chipValues(page, "inbound-band-")).toEqual(c.inboundSet.final);
          expect(await chipValues(page, "band-"), "the customer-facing editor is untouched").toEqual(customerBands);
          await expect(page.getByTestId("inbound-bands-hint")).toHaveCount(0);
          await expect(page.getByTestId("inbound-bands-reset")).toBeVisible();
          await expect(page.getByTestId("text-unsaved-changes")).toBeVisible();
          await saveBands(page);

          const saved = await getScenario(page, id);
          expect(saved.inputs.inboundDistanceBands).toEqual(c.inboundSet.final);
          expect(saved.inputs.distanceBands, "customer-facing set untouched on the server").toEqual(customerBands);
          expect(saved.stale, "a reporting-only band save must NOT stale the result").toBe(false);
          expect(saved.solvedAt, "and must not re-solve").toBe(base.solvedAt);

          await page.reload();
          await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
          await openParams(page);
          await expect.poll(() => chipValues(page, "inbound-band-"), { timeout: T }).toEqual(c.inboundSet.final);
          await expect(page.getByTestId("inbound-bands-hint")).toHaveCount(0);
          await expect(page.getByTestId("inbound-bands-reset")).toBeVisible();
          expect(await chipValues(page, "band-")).toEqual(customerBands);
        });

        await test.step("5. not stale in the UI; ONLY inbound lanes recolour; legend has two sections", async () => {
          await openOutputMap(page);
          await expect(page.getByTestId("stale-output-banner")).toHaveCount(0);
          await expect(page.getByTestId("sidebar-output-output-map")).toBeEnabled();
          const lanes = await readLaneClasses(page);
          const exp = expectedLaneStrokes(edges, customerBands, c.inboundSet.final);
          expect(lanes.inbound, "inbound lanes follow the saved inbound set").toEqual(exp.inbound);
          expect(lanes.outbound, "outbound lanes are untouched").toEqual(exp.outbound);
          expect(lanes.outbound).toEqual(expectedLaneStrokes(edges, customerBands, undefined).outbound);
          expect(lanes.inbound, "non-vacuity: at least one inbound lane changed band").not.toEqual(beforeInbound);

          const legend = page.getByTestId("map-legend");
          await expect(legend).toContainText("Customer-facing lanes");
          await expect(legend).toContainText("Inbound lanes");
          await expect(page.locator('[data-testid^="legend-band-"]')).toHaveCount(customerBands.length);
          await expect(page.locator('[data-testid^="legend-inbound-band-"]')).toHaveCount(c.inboundSet.final.length);
          // The inbound section's range text comes from the inbound set (e.g. "≤ 1,000 mi").
          await expect(legend).toContainText(bandRangeLabel(0, c.inboundSet.final, "mi"));
          await expect(legend).toContainText(bandRangeLabel(OVERFLOW_BAND, c.inboundSet.final, "mi"));
        });

        if (jade) {
          await test.step("6. Flows Plant to Warehouse bands follow the inbound set; the browser-saved download equals the cell text", async () => {
            await openTab(page, "sidebar-output-flows", "jade-flows-tab");
            const bandCells = page.locator('[data-testid^="cell-jade-flow-pw-band-"]');
            await expect(bandCells.first()).toBeVisible({ timeout: T });
            const pairs = new Map<string, number>();
            for (const e of inboundEdges) pairs.set(`${e.fromId}|${e.toId}`, e.distance);
            expect(await bandCells.count()).toBe(pairs.size);
            const cellTexts = (await bandCells.allInnerTexts()).map(s => s.trim());
            const expected = [...pairs.values()].map(d => bandRangeLabel(assignBandOrOverflow(d, c.inboundSet.final), c.inboundSet.final, "mi"));
            expect(sortedStr(cellTexts)).toEqual(sortedStr(expected));
            const underCustomerSet = [...pairs.values()].map(d => bandRangeLabel(assignBandOrOverflow(d, customerBands), customerBands, "mi"));
            expect(sortedStr(cellTexts), "non-vacuity: differs from the customer-facing labelling").not.toEqual(sortedStr(underCustomerSet));

            const csv = await downloadVia(page, "button-download-jade-flows-pw", "button-download-jade-flows-pw-csv");
            const lines = csv.text.split("\n").filter(l => l.trim() !== "");
            expect(lines[0]).toBe("Plant,Warehouse,Distance (mi),Flow,Distance Band");
            const csvBands = lines.slice(1).map(l => parseCsvLine(l).at(-1)!);
            expect(csvBands).toHaveLength(cellTexts.length);
            // Same row order as the on-screen table: row i's file text equals row i's cell text.
            expect(csvBands).toEqual(cellTexts);
            for (const b of csvBands) expect(b).not.toMatch(/Band \d|Overflow/);
          });
        }

        await test.step("7. Service Stats inbound table: flows per band computed from edges, sum = total inbound flow", async () => {
          await openTab(page, "sidebar-output-service-stats", "service-stats-inbound");
          const exp = expectedInboundFlows(edges, c.inboundSet.final);
          const total = inboundEdges.reduce((s, e) => s + e.flow, 0);
          expect(exp.total).toBe(total);
          expect(total).toBeGreaterThan(0);
          const rows = page.locator('[data-testid^="service-stats-inbound-band-"]');
          const keys = (await rows.evaluateAll(els => els.map(e => e.getAttribute("data-testid")!))).map(t => Number(t.replace("service-stats-inbound-band-", "")));
          expect(keys.length, "inbound rows rendered").toBeGreaterThan(0);
          for (const [band, flow] of exp.byBand) {
            expect(keys, `row for band ${band}`).toContain(band);
            const cells = page.getByTestId(`service-stats-inbound-band-${band}`).locator("td");
            expect(num(await cells.nth(1).innerText())).toBe(flow);
          }
          let shown = 0;
          let pct = 0;
          for (const k of keys) {
            const cells = page.getByTestId(`service-stats-inbound-band-${k}`).locator("td");
            const flow = num(await cells.nth(1).innerText());
            expect(flow).toBe(exp.byBand.get(k) ?? 0);
            shown += flow;
            pct += num((await cells.nth(2).innerText()).replace("%", ""));
          }
          expect(shown, "table flows sum to the total inbound flow").toBe(total);
          expect(pct, "shares sum to 100").toBe(100);
          // Heading + band text come from the INBOUND set.
          await expect(page.getByTestId("service-stats-inbound")).toContainText("Inbound lanes");
          await expect(page.getByTestId("service-stats-inbound")).toContainText(bandRangeLabel(0, c.inboundSet.final, "mi"));
        });

        await test.step("8. server exports: range-text bands, v4 envelopes for JADE / v3 for gold, serviceStats v4 with the inbound section", async () => {
          const ss = await exportJson(page, id, "serviceStats");
          expect(ss.templateVersion).toBe(4);
          expect(ss.unit).toBe("mi");
          const outbound = ss.rows.filter(r => r.section === "outbound");
          const inbound = ss.rows.filter(r => r.section === "inbound");
          expect(outbound.length, "outbound section").toBeGreaterThan(0);
          expect(inbound.length, "inbound section (two-echelon)").toBeGreaterThan(0);
          for (const r of outbound) expect(r.flow).toBeNull();
          const exp = expectedInboundFlows(edges, c.inboundSet.final);
          for (const [band, flow] of exp.byBand) {
            const row = inbound.find(r => r.band === band);
            expect(row, `inbound export row for band ${band}`).toBeTruthy();
            expect(row!.flow).toBe(flow);
          }
          expect(inbound.reduce((s, r) => s + (r.flow as number), 0), "inbound export flows sum to the total").toBe(exp.total);
          expect(inbound.reduce((s, r) => s + (r.percent as number), 0)).toBe(100);
          const ssCsv = await page.request.get(`/api/scenarios/${id}/export?entity=serviceStats&format=csv`);
          expect((await ssCsv.text()).split("\n")[0]).toBe("template_version,section,band,distance_unit,percent,flow");

          const assignments = await exportJson(page, id, "assignments");
          const flows = await exportJson(page, id, "flows");
          if (jade) {
            expect(assignments.templateVersion).toBe(4);
            expect(flows.templateVersion).toBe(4);
            const detail = base.result.details.assignments!;
            expect(assignments.rows).toHaveLength(detail.length);
            expect(detail.length).toBeGreaterThan(0);
            for (const r of assignments.rows) {
              const a = detail.find(d => d.customerId === r.customerId && d.productId === r.productId)!;
              expect(a, `${r.customerId}/${r.productId}`).toBeTruthy();
              const want = bandRangeLabel(assignBandOrOverflow(a.distanceMi, customerBands), customerBands, "mi");
              expect(r.band).toBe(want);
              expect(r.band).not.toMatch(/Band \d|Overflow/);
            }
            const pw = flows.rows.filter(r => r.leg === "plant_to_warehouse");
            const wc = flows.rows.filter(r => r.leg === "warehouse_to_customer");
            expect(pw.length).toBeGreaterThan(0);
            expect(wc.length).toBeGreaterThan(0);
            for (const r of pw) {
              const e = inboundEdges.find(x => x.fromId === r.fromId && x.toId === r.toId)!;
              expect(r.band, `P->W ${r.fromId}->${r.toId} follows the INBOUND set`).toBe(bandRangeLabel(assignBandOrOverflow(e.distance, c.inboundSet.final), c.inboundSet.final, "mi"));
            }
            for (const r of wc) {
              const e = edges.find(x => x.leg === "warehouse_to_customer" && x.fromId === r.fromId && x.toId === r.toId)!;
              expect(r.band, `W->C ${r.fromId}->${r.toId} follows the customer-facing set`).toBe(bandRangeLabel(assignBandOrOverflow(e.distance, customerBands), customerBands, "mi"));
            }
            // km: boundaries are re-rendered in the requested unit, classification stays on the canonical distance.
            const km = await exportJson(page, id, "assignments", "&unit=km");
            expect(km.unit).toBe("km");
            expect(km.rows.length).toBeGreaterThan(0);
            for (const r of km.rows) expect(String(r.band)).toMatch(/ km$/);
            const csv = await page.request.get(`/api/scenarios/${id}/export?entity=assignments&format=csv`);
            const csvLines = (await csv.text()).split("\n").filter(l => l.trim() !== "");
            expect(csvLines[0]).toBe("template_version,product,customer,assigned_warehouse,distance,distance_unit,distance_band");
            expect(parseCsvLine(csvLines[1])[0]).toBe("4");
            expect(parseCsvLine(csvLines[1]).at(-1)).toMatch(/^(≤ |> )?[\d,.]+( mi|–[\d,.]+ mi)$/);
          } else {
            // gold keeps the generic v3 envelopes; its flows band is the numeric index into that LEG's set (Q7).
            expect(assignments.templateVersion).toBe(3);
            expect(flows.templateVersion).toBe(3);
            expect(flows.rows).toHaveLength(inboundEdges.length);
            for (const r of flows.rows) {
              const e = inboundEdges.find(x => x.fromId === r.fromId && x.toId === r.toId)!;
              expect(r.band, "mine->refinery band index is relative to the inbound set").toBe(assignBandOrOverflow(e.distance, c.inboundSet.final));
              expect(r.band).not.toBe(assignBandOrOverflow(e.distance, customerBands)); // non-vacuity: the sets disagree here
            }
          }
        });

        await test.step("9. reset: 'Use customer-facing bands' clears the key, persists, restores the hint; legend back to one section", async () => {
          await openParams(page);
          await page.getByTestId("inbound-bands-reset").click({ timeout: T });
          await expect(page.getByTestId("inbound-bands-hint")).toBeVisible({ timeout: T });
          expect(await chipValues(page, "inbound-band-")).toEqual(customerBands);
          await saveBands(page);
          const cleared = await getScenario(page, id);
          expect("inboundDistanceBands" in cleared.inputs, "the key is removed, not nulled or emptied").toBe(false);
          expect(cleared.stale).toBe(false);
          expect(cleared.solvedAt).toBe(base.solvedAt);
          await page.reload();
          await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
          await openParams(page);
          await expect(page.getByTestId("inbound-bands-hint")).toBeVisible({ timeout: T });
          await expect(page.getByTestId("inbound-bands-reset")).toHaveCount(0);
          await openOutputMap(page);
          const legend = page.getByTestId("map-legend");
          await expect(legend).not.toContainText("Inbound lanes");
          await expect(page.locator('[data-testid^="legend-inbound-band-"]')).toHaveCount(0);
          const lanes = await readLaneClasses(page);
          expect(lanes.inbound, "inbound lanes are back on the customer-facing set").toEqual(beforeInbound);
        });

        await test.step("10. an inbound set EQUAL to the customer-facing one is saved but the legend stays at one section", async () => {
          await openParams(page);
          await editInbound(page, [9999], []);
          await editInbound(page, [], [9999]); // lens is now an explicit array equal to the customer-facing set
          expect(await chipValues(page, "inbound-band-")).toEqual(customerBands);
          await saveBands(page);
          const eq = await getScenario(page, id);
          expect(eq.inputs.inboundDistanceBands, "the key IS written").toEqual(customerBands);
          await page.reload();
          await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
          await openParams(page);
          await expect(page.getByTestId("inbound-bands-reset")).toBeVisible({ timeout: T }); // key present, so no fallback hint
          await openOutputMap(page);
          await expect(page.getByTestId("map-legend")).not.toContainText("Inbound lanes");
          await expect(page.locator('[data-testid^="legend-inbound-band-"]')).toHaveCount(0);
        });

        await test.step("11. control: a real input edit DOES make the API report stale and greys the Outputs group", async () => {
          const cur = await getScenario(page, id);
          const patch = await page.request.patch(`/api/scenarios/${id}`, { data: { inputs: { ...cur.inputs, ...c.staleEdit } } });
          expect(patch.status(), await patch.text()).toBe(200);
          const after = await getScenario(page, id);
          expect(after.stale, "the stale probe can fire").toBe(true);
          await page.reload();
          await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
          // A stale scenario greys the Outputs group (Workspace.tsx hasFreshSolvedRun); a fresh one was clickable all along above.
          await expect(page.getByTestId("sidebar-output-output-map")).toBeDisabled({ timeout: T });
        });
      } finally {
        await page.request.delete(`/api/scenarios/${id}`);
      }
    });
  }

  test("p-median-us: ONE 'Distance bands' editor and no inbound UI or export section anywhere", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createAndSolve(page, "p-median-us", SOLVED_MODEL_INPUTS["p-median-us"]);
    try {
      await openWorkspace(page, "p-median-us", id);
      await openParams(page);
      await expect(page.getByText(/^Distance bands \(mi\)$/)).toHaveCount(1);
      await expect(page.getByText(/Customer-facing lanes|Inbound lanes/)).toHaveCount(0);
      expect(await page.locator('[data-testid*="inbound"]').count()).toBe(0);
      expect((await chipValues(page, "band-")).length, "the single editor has chips").toBeGreaterThan(0);

      await openOutputMap(page);
      const legend = page.getByTestId("map-legend");
      await expect(legend).toContainText("Distance bands");
      await expect(legend).not.toContainText("Inbound lanes");
      expect(await page.locator('[data-testid*="legend-inbound"]').count()).toBe(0);

      await page.getByTestId("sidebar-output-service-stats").click({ timeout: T });
      await expect(page.locator('[data-testid^="service-stats-band-"]').first()).toBeVisible({ timeout: T });
      await expect(page.getByTestId("service-stats-inbound")).toHaveCount(0);
      await expect(page.getByText("Inbound lanes")).toHaveCount(0);

      // The route and the export both refuse/omit the inbound concept for a single-echelon model.
      const route = await page.request.patch(`/api/scenarios/${id}/inbound-distance-bands`, { data: { inboundDistanceBands: [100, 200] } });
      expect(route.status(), "p-median schema strips the key").toBe(400);
      expect("inboundDistanceBands" in (await getScenario(page, id)).inputs).toBe(false);
      const ss = await exportJson(page, id, "serviceStats");
      expect(ss.templateVersion).toBe(4);
      expect(ss.rows.length).toBeGreaterThan(0);
      for (const r of ss.rows) {
        expect(r.section).toBe("outbound");
        expect(r.flow).toBeNull();
      }
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DU-4.4 — product repetition collapse (JADE)
// ═══════════════════════════════════════════════════════════════════════════
const JADE_INPUTS = CASES[0].inputs;

/**
 * Hand-authored variant (declared): the solved JADE result with ONE customer's product-2 re-pointed at the
 * other open warehouse (JADE's solver is single-source per product, so a split customer never occurs naturally).
 * Seeded over the browser's GET only; the stored row is the real solved one.
 */
async function splitScenario(page: Page): Promise<{ id: string; customerId: string; lines: number; moved: Assignment; otherWh: string; distinctCustomers: number }> {
  await registerAndGoHome(page);
  const id = await createAndSolve(page, "two-echelon-jade-us", JADE_INPUTS);
  const real = (await getScenario(page, id)).result;
  const split: Result = JSON.parse(JSON.stringify(real));
  const list = split.details.assignments!;
  const customerId = list[0].customerId;
  const rows = list.filter(a => a.customerId === customerId);
  expect(rows.length, "the chosen customer has several product lines").toBeGreaterThan(1);
  const moved = rows.find(r => r.productId === "product-2")!;
  expect(moved, "customer has a product-2 line").toBeTruthy();
  const otherWh = split.details.openWarehouseIds!.find(w => w !== moved.warehouseId)!;
  expect(otherWh).toBeTruthy();
  moved.warehouseId = otherWh;
  moved.distanceMi = Math.round(moved.distanceMi) + 137;
  await seedSolvedResult(page, id, split);
  return { id, customerId, lines: rows.length, moved, otherWh, distinctCustomers: new Set(list.map(a => a.customerId)).size };
}

async function openAssignments(page: Page, id: string): Promise<void> {
  await openWorkspace(page, "two-echelon-jade-us", id);
  await openTab(page, "sidebar-output-customer-assignments", "jade-assignments-tab");
}

test.describe("DU-4.5 — DU-4.4 collapse (desktop, keyboard)", () => {
  test.use({ actionTimeout: 15_000 });

  test("Customer Assignments: one row per customer; split customer expands by Enter/Space/click and lists each product", async ({ page }) => {
    test.setTimeout(120_000);
    const s = await splitScenario(page);
    try {
      await openAssignments(page, s.id);
      await expect(page.getByTestId("text-jadeassignments-count")).toHaveText(`${s.distinctCustomers} of ${s.distinctCustomers}`, { timeout: T });
      const rowCount = await page.locator('[data-testid^="row-jadeassignment-"]').count();
      expect(rowCount, "rows on page 1 (one per customer, not per product)").toBe(Math.min(50, s.distinctCustomers));

      // A non-split customer: warehouse shown, no disclosure button.
      const buttons = page.locator('[data-testid^="button-jadeassignment-split-"]');
      await expect(buttons).toHaveCount(1);
      const plainRow = page.locator('[data-testid^="row-jadeassignment-"]').filter({ hasNot: page.locator('[data-testid^="button-jadeassignment-split-"]') }).first();
      await expect(plainRow).toBeVisible();
      await expect(plainRow.locator('[data-testid^="cell-jadeassignment-warehouse-"]')).not.toHaveText("");

      const key = s.customerId;
      const btn = page.getByTestId(`button-jadeassignment-split-${key}`);
      await expect(btn).toHaveText("Split (2 warehouses)");
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId(`list-jadeassignment-lines-${key}`)).toHaveCount(0);
      await expect(page.getByTestId(`cell-jadeassignment-distance-${key}`)).toHaveText("—");
      await expect(page.getByTestId(`cell-jadeassignment-band-${key}`)).toHaveText("—");
      await expect(page.getByTestId(`cell-jadeassignment-products-${key}`)).toHaveText(String(s.lines));

      // Keyboard: Enter opens, Enter closes, Space opens.
      await btn.focus();
      await page.keyboard.press("Enter");
      await expect(btn).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(`[data-testid^="line-jadeassignment-${key}-"]`)).toHaveCount(s.lines);
      await page.keyboard.press("Enter");
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId(`list-jadeassignment-lines-${key}`)).toHaveCount(0);
      await page.keyboard.press("Space");
      await expect(btn).toHaveAttribute("aria-expanded", "true");
      // Click closes it again (and opens it for the line checks).
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "true");

      // Each product's own warehouse: the moved product names the OTHER warehouse, the rest do not.
      const movedLine = page.getByTestId(`line-jadeassignment-${key}-${s.moved.productId}`);
      const movedText = (await movedLine.innerText()).trim();
      expect(movedText).toContain("→");
      const warehouseOf = (t: string) => t.split("→")[1].split("·")[0].trim();
      const allLines = (await page.locator(`[data-testid^="line-jadeassignment-${key}-"]`).allInnerTexts()).map(t => t.trim());
      expect(allLines).toHaveLength(s.lines);
      const nonMoved = allLines.filter(t => t !== movedText);
      expect(nonMoved.length, "at least one other product line").toBeGreaterThan(0);
      for (const t of nonMoved) expect(warehouseOf(t), "unmoved product stays at its original warehouse").not.toBe(warehouseOf(movedText));
      // Export is unchanged: the server's flat product-level file still has one row per (product, customer).
      const exp = await exportJson(page, s.id, "assignments");
      expect(exp.rows.length).toBe((await getScenario(page, s.id)).result.details.assignments!.length);
      expect(exp.rows.length).toBeGreaterThan(s.distinctCustomers);
    } finally {
      await page.request.delete(`/api/scenarios/${s.id}`);
    }
  });

  test("Plant Production: disabled plant-products behind a switch; Utilization % computed from the row's own numbers; Capability Matrix prints capacity only on enabled cells", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createAndSolve(page, "two-echelon-jade-us", JADE_INPUTS);
    try {
      const { result } = await getScenario(page, id);
      await openWorkspace(page, "two-echelon-jade-us", id);

      // Capability Matrix first: it is the ground truth for which plant-products are enabled.
      await openTab(page, "sidebar-input-capability-matrix", "capability-matrix-tab");
      const boxes = page.locator('[data-testid^="checkbox-capability-"]');
      const nCells = await boxes.count();
      expect(nCells, "matrix cells").toBeGreaterThan(0);
      let enabled = 0;
      let disabled = 0;
      for (let i = 0; i < nCells; i++) {
        const box = boxes.nth(i);
        const tid = (await box.getAttribute("data-testid"))!.replace("checkbox-capability-", "");
        const isOn = (await box.getAttribute("aria-checked")) === "true" || (await box.getAttribute("data-state")) === "checked";
        const cap = page.getByTestId(`text-capability-capacity-${tid}`);
        if (isOn) { enabled++; await expect(cap, `${tid} enabled -> capacity shown`).toBeVisible(); }
        else { disabled++; await expect(cap, `${tid} disabled -> no capacity text`).toHaveCount(0); }
      }
      expect(enabled, "non-vacuity: some cells enabled").toBeGreaterThan(0);
      expect(disabled, "non-vacuity: some cells disabled").toBeGreaterThan(0);
      // Toggling a disabled cell on makes its capacity appear (then off again).
      const firstOff = (await boxes.evaluateAll(els => els.find(e => e.getAttribute("data-state") !== "checked")!.getAttribute("data-testid")!)).replace("checkbox-capability-", "");
      await page.getByTestId(`checkbox-capability-${firstOff}`).click();
      await expect(page.getByTestId(`text-capability-capacity-${firstOff}`)).toBeVisible({ timeout: T });
      await page.getByTestId(`checkbox-capability-${firstOff}`).click();
      await expect(page.getByTestId(`text-capability-capacity-${firstOff}`)).toHaveCount(0, { timeout: T });

      // Plant Production.
      await openTab(page, "sidebar-output-service-stats", "plant-production-section");
      const section = page.getByTestId("plant-production-section");
      const headers = await section.locator("thead th").allInnerTexts();
      expect(headers).toEqual(["Plant", "Product", "Actual production", "Enabled capacity", "Utilization %"]);
      expect(headers).not.toContain("Remaining capacity");
      const prodRows = page.locator('[data-testid^="row-plant-production-"]');
      await expect(prodRows).toHaveCount(enabled, { timeout: T }); // default hides exactly the disabled plant-products
      const sw = page.getByTestId("switch-show-disabled-plant-products");
      await expect(sw).toHaveAttribute("aria-checked", "false");
      const box = await sw.boundingBox();
      expect(Math.min(box!.width, box!.height) >= 20, "switch target is a real hit area").toBe(true);

      // Utilization = round(actual / capacity * 100) from the row's own cells, and actual from the result's inbound edges.
      const checked: string[] = [];
      for (let i = 0; i < enabled; i++) {
        const row = prodRows.nth(i);
        const cells = row.locator("td");
        const actual = num(await cells.nth(2).innerText());
        const cap = num(await cells.nth(3).innerText());
        const util = (await cells.nth(4).innerText()).trim();
        expect(cap, "enabled row has capacity").toBeGreaterThan(0);
        expect(util).toBe(`${Math.round((actual / cap) * 100)}%`);
        const rowId = (await row.getAttribute("data-testid"))!.replace("row-plant-production-", "");
        const [plantId, productId] = [rowId.split("-product-")[0], `product-${rowId.split("-product-")[1]}`];
        const fromEdges = result.edges.filter(e => e.leg === "plant_to_warehouse" && e.fromId === plantId && e.productId === productId).reduce((s, e) => s + e.flow, 0);
        expect(actual, `${rowId} actual production = sum of its inbound edges`).toBe(Math.round(fromEdges));
        checked.push(rowId);
      }
      expect(checked.length).toBe(enabled);

      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect(prodRows).toHaveCount(enabled + disabled, { timeout: T });
      let dashRows = 0;
      for (let i = 0; i < enabled + disabled; i++) {
        const cells = prodRows.nth(i).locator("td");
        if (num(await cells.nth(3).innerText()) === 0) {
          expect((await cells.nth(4).innerText()).trim()).toBe("—");
          dashRows++;
        }
      }
      expect(dashRows, "every revealed row had zero capacity and a dash").toBe(disabled);
      await sw.click();
      await expect(prodRows).toHaveCount(enabled, { timeout: T });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("DU-4.5 — DU-4.4 collapse (touch viewport)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 }, actionTimeout: 15_000 });

  test("a split customer expands and collapses with a tap", async ({ page }) => {
    test.setTimeout(120_000);
    const s = await splitScenario(page);
    try {
      await openAssignments(page, s.id);
      const key = s.customerId;
      const btn = page.getByTestId(`button-jadeassignment-split-${key}`);
      await expect(btn).toBeVisible({ timeout: T });
      const box = await btn.boundingBox();
      expect(box!.height, "tap target height").toBeGreaterThanOrEqual(24);
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await btn.tap({ timeout: T });
      await expect(btn).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(`[data-testid^="line-jadeassignment-${key}-"]`)).toHaveCount(s.lines);
      await btn.tap({ timeout: T });
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId(`list-jadeassignment-lines-${key}`)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/scenarios/${s.id}`);
    }
  });
});
