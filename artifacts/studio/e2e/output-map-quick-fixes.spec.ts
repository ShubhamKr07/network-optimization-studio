/**
 * OMQ-4 — real-browser QA for the Output Map quick fixes (OMQ-1 bounds box, OMQ-2 lane tooltip
 * pane, OMQ-3 info popover / icon buttons / no open-sites caption), in LIGHT and DARK.
 *
 * Results are SEEDED (helpers/seedSolvedResult.ts + fixtures/solved/*.json, with the bound fields
 * overridden per case): the real solver never runs. Screenshots go to E2E_SHOTS_DIR when set.
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 *
 * Every check can fail: the optimal case compares the bounds box against the metric box's own text,
 * the PNG case diffs a capture with the box against one with it hidden, and the tooltip case asserts
 * it really found a lane (not a marker) before reading the pane.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Locator, type Page } from "./fixtures";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const loadFixture = (modelId: string) => JSON.parse(fs.readFileSync(path.join(here, "fixtures/solved", `${modelId}.json`), "utf8"));
const chapterPath = (modelId: string) => CHAPTERS.find(c => c.modelId === modelId)!.path;
const OUT = '[data-testid="output-map-tab"]';

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(t => localStorage.setItem("nos:theme-pref", t), theme);
}

async function register(page: Page): Promise<void> {
  const email = `e2e-omq4-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Creates a scenario, seeds `result` and opens its Output Map. Returns the scenario id for cleanup. */
async function openOutputMap(page: Page, modelId: string, result: Record<string, unknown>, opts: { lanes?: boolean } = {}): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name: `E2E OMQ-4 ${modelId}`, modelId, inputs: SOLVED_MODEL_INPUTS[modelId] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  await seedSolvedResult(page, id, result);
  await page.goto(`${chapterPath(modelId)}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  await page.getByTestId("sidebar-output-output-map").click({ timeout: T });
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: 15_000 });
  // Control: the page really is in the theme under test (a stored pref beats the OS scheme).
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  expect(dark, "html.dark matches the theme under test").toBe(await page.evaluate(() => localStorage.getItem("nos:theme-pref")) === "dark");
  if (opts.lanes !== false) await expect.poll(() => page.locator(".leaflet-route-pane path").count(), { timeout: 15_000 }).toBeGreaterThan(0);
  return id;
}

const cleanup = (page: Page, id: string | null) => (id ? page.request.delete(`/api/scenarios/${id}`).catch(() => {}) : Promise.resolve());

/** The metric box's Objective value, verbatim. */
const metricObjective = (page: Page): Locator =>
  page.getByTestId("output-map-metric-overlay").locator('span:text-is("Objective: ") + span');

/** First number in a formatted objective ("29.87B", "70.42%", "1,234") as a plain float. */
const firstNumber = (s: string): number => parseFloat((s.match(/[\d,]*\.?\d+/)?.[0] ?? "NaN").replace(/,/g, ""));

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`OMQ-4 Output Map quick fixes — ${theme}`, () => {
    test.use({ actionTimeout: 15_000 });

    test.beforeEach(async ({ page }) => {
      test.setTimeout(90_000);
      await setTheme(page, theme);
      await register(page);
    });

    test("bounds box on an optimal solve: Upper == Lower == the metric box Objective, gap 0.00% (proven optimal)", async ({ page }) => {
      let id: string | null = null;
      try {
        id = await openOutputMap(page, "p-median-us", loadFixture("p-median-us"));
        const objective = (await metricObjective(page).textContent())!.trim();
        expect(objective.length, "metric box shows an Objective").toBeGreaterThan(0);
        await expect(page.getByTestId("output-map-bound-upper")).toHaveText(objective);
        await expect(page.getByTestId("output-map-bound-lower")).toHaveText(objective);
        await expect(page.getByTestId("output-map-bound-gap")).toHaveText("0.00% (proven optimal)");
        await shot(page, `bounds-optimal-${theme}.png`);
      } finally { await cleanup(page, id); }
    });

    test("seeded feasible + achievedGap, minimise (p-median-us): Upper = objective, Lower = objective x (1 - gap), no 'proven optimal'", async ({ page }) => {
      let id: string | null = null;
      try {
        const base = loadFixture("p-median-us");
        id = await openOutputMap(page, "p-median-us", { ...base, status: "feasible", solutionStatus: "feasible", terminationReason: "time_limit", achievedGap: 0.05 });
        const objective = (await metricObjective(page).textContent())!.trim();
        const upper = (await page.getByTestId("output-map-bound-upper").textContent())!.trim();
        const lower = (await page.getByTestId("output-map-bound-lower").textContent())!.trim();
        expect(upper, "Upper = the metric box Objective").toBe(objective);
        expect(lower, "Lower differs from Upper (gap 5%)").not.toBe(upper);
        // Same formatter, same unit suffix: compare the leading numbers (the lower bound is 95% of the objective).
        const ratio = firstNumber(lower) / firstNumber(upper);
        expect(ratio, `Lower/Upper ${lower}/${upper}`).toBeGreaterThan(0.949);
        expect(ratio).toBeLessThan(0.951);
        const gap = page.getByTestId("output-map-bound-gap");
        await expect(gap).toHaveText("5.00%");
        await expect(gap).not.toContainText("proven optimal");
        await shot(page, `bounds-feasible-min-${theme}.png`);
      } finally { await cleanup(page, id); }
    });

    test("seeded feasible + achievedGap, maximise (max-coverage-us coverage): Lower = objective, Upper = objective x (1 + gap), never a covered-demand number", async ({ page }) => {
      let id: string | null = null;
      try {
        const base = loadFixture("max-coverage-us"); // objective 70.42 (%), solverIncumbentObjective 54,946,145 (covered demand)
        id = await openOutputMap(page, "max-coverage-us", { ...base, status: "feasible", solutionStatus: "feasible", terminationReason: "time_limit", achievedGap: 0.01 });
        const objective = (await metricObjective(page).textContent())!.trim();
        const lower = (await page.getByTestId("output-map-bound-lower").textContent())!.trim();
        const upper = (await page.getByTestId("output-map-bound-upper").textContent())!.trim();
        expect(lower, "maximise: Lower = the metric box Objective").toBe(objective);
        expect(firstNumber(lower)).toBeCloseTo(70.42, 2);
        expect(firstNumber(upper), `Upper ${upper} = 70.42 x 1.01`).toBeCloseTo(71.12, 2);
        for (const text of [lower, upper]) expect(text, "never a raw covered-demand number").not.toMatch(/54,?946,?145|\d{3},\d{3}/);
        const gap = page.getByTestId("output-map-bound-gap");
        await expect(gap).toHaveText("1.00%");
        await shot(page, `bounds-feasible-max-${theme}.png`);
      } finally { await cleanup(page, id); }
    });

    test("bounds box is absent on an infeasible result", async ({ page }) => {
      let id: string | null = null;
      try {
        // Control: the optimal result renders the box (so "absent" below is a real change, not a broken selector).
        id = await openOutputMap(page, "p-median-us", loadFixture("p-median-us"));
        await expect(page.getByTestId("output-map-bounds")).toBeVisible({ timeout: T });
        await cleanup(page, id); id = null;

        const base = loadFixture("p-median-us");
        id = await openOutputMap(page, "p-median-us", { ...base, status: "infeasible", solutionStatus: "infeasible", terminationReason: "infeasible", objective: 0, solverIncumbentObjective: null, edges: [], details: {}, metrics: {} }, { lanes: false });
        await expect(page.getByTestId("output-map-metric-overlay")).toBeVisible({ timeout: T });
        await expect(page.getByTestId("output-map-bounds")).toHaveCount(0);
      } finally { await cleanup(page, id); }
    });

    test("Download captures the bounds box: it lives inside the captured node, and the PNG differs from one taken without it", async ({ page }) => {
      let id: string | null = null;
      try {
        id = await openOutputMap(page, "p-median-us", loadFixture("p-median-us"));
        const box = page.getByTestId("output-map-bounds");
        await expect(box).toBeVisible({ timeout: T });

        // Inside the node: the grandparent (past the OMQ-5 overlay wrapper) holds the map, the metric box and the bounds box, and the box lies within it.
        const node = box.locator("xpath=../..");
        await expect(node.locator(".leaflet-container")).toHaveCount(1);
        await expect(node.getByTestId("output-map-metric-overlay")).toHaveCount(1);
        const [nb, bb] = [await node.boundingBox(), await box.boundingBox()];
        expect(nb && bb).toBeTruthy();
        expect(bb!.x).toBeGreaterThanOrEqual(nb!.x - 0.5);
        expect(bb!.y).toBeGreaterThanOrEqual(nb!.y - 0.5);
        expect(bb!.x + bb!.width).toBeLessThanOrEqual(nb!.x + nb!.width + 0.5);
        expect(bb!.y + bb!.height).toBeLessThanOrEqual(nb!.y + nb!.height + 0.5);

        const grab = async (): Promise<Buffer> => {
          const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("button-download-map-png").click({ timeout: T })]);
          const file = await dl.path();
          expect(file, "download has a local path").toBeTruthy();
          const buf = fs.readFileSync(file!);
          expect(buf.length, "downloaded PNG is non-empty").toBeGreaterThan(1000);
          expect(buf.subarray(0, 8).toString("hex"), "PNG signature").toBe("89504e470d0a1a0a");
          return buf;
        };
        const withBox = await grab();
        await page.addStyleTag({ content: '[data-testid="output-map-bounds"]{visibility:hidden !important}' });
        const without = await grab();

        // Diff the two exports inside the box's region (node-relative, scaled to PNG pixels).
        const region = { x: bb!.x - nb!.x, y: bb!.y - nb!.y, w: bb!.width, h: bb!.height, nodeW: nb!.width };
        const diff = await page.evaluate(async ([a, b, r]) => {
          const load = async (b64: string) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); return img; };
          const [ia, ib] = [await load(a as string), await load(b as string)];
          if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) return { sameSize: false, share: 0, scale: 0 };
          const rr = r as { x: number; y: number; w: number; h: number; nodeW: number };
          const scale = ia.naturalWidth / rr.nodeW;
          const px = (img: HTMLImageElement) => {
            const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0);
            return ctx.getImageData(Math.round(rr.x * scale), Math.round(rr.y * scale), Math.round(rr.w * scale), Math.round(rr.h * scale)).data;
          };
          const [da, db] = [px(ia), px(ib)];
          let differing = 0;
          for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) differing++;
          return { sameSize: true, share: differing / (da.length / 4), scale };
        }, [withBox.toString("base64"), without.toString("base64"), region] as const);
        expect(diff.sameSize, "both exports have the same dimensions").toBe(true);
        expect(diff.share, `share of pixels in the box region that differ with/without the box (scale ${diff.scale.toFixed(2)})`).toBeGreaterThan(0.3);
      } finally { await cleanup(page, id); }
    });

    test("lane hover tooltip lives in the tooltip pane (z 650), fully opaque", async ({ page }) => {
      let id: string | null = null;
      try {
        id = await openOutputMap(page, "p-median-us", loadFixture("p-median-us"));
        await page.mouse.move(2, 2);
        // Find a point on a lane that nothing else (marker, box) covers.
        const spot = await page.locator(`${OUT} .leaflet-route-pane path`).evaluateAll(paths => {
          const k = document.querySelector('[data-testid="output-map-tab"] .leaflet-container')!.getBoundingClientRect();
          for (const p of paths as unknown as SVGPathElement[]) {
            const len = p.getTotalLength();
            const m = p.getScreenCTM();
            if (!m) continue;
            for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
              const pt = p.getPointAtLength(len * f);
              const x = pt.x * m.a + pt.y * m.c + m.e, y = pt.x * m.b + pt.y * m.d + m.f;
              if (x < k.x + 60 || x > k.x + k.width - 60 || y < k.y + 130 || y > k.y + k.height - 60) continue;
              if (document.elementFromPoint(x, y) === p) return { x, y };
            }
          }
          return null;
        });
        expect(spot, "a reachable point on a lane").not.toBeNull();
        await page.mouse.move(spot!.x - 3, spot!.y - 3);
        await page.mouse.move(spot!.x, spot!.y, { steps: 4 });
        const tip = page.locator(`${OUT} .leaflet-tooltip`).last();
        await expect(tip).toBeVisible({ timeout: T });
        const info = await tip.evaluate(el => {
          const pane = el.parentElement!;
          const chain: Array<{ opacity: string; filter: string }> = [];
          for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
            const cs = getComputedStyle(n);
            chain.push({ opacity: cs.opacity, filter: cs.filter });
          }
          const cs = getComputedStyle(el);
          const card = (() => { const s = document.createElement("span"); s.style.backgroundColor = "hsl(var(--card))"; document.body.appendChild(s); const v = getComputedStyle(s).backgroundColor; s.remove(); return v; })();
          return { paneClass: pane.className, paneZ: getComputedStyle(pane).zIndex, bg: cs.backgroundColor, card, opacity: cs.opacity, chain, text: (el.textContent ?? "").trim() };
        });
        expect(info.text.length, "the tooltip has content").toBeGreaterThan(0);
        expect(info.paneClass, "lane tooltip is a child of the tooltip pane").toContain("leaflet-tooltip-pane");
        expect(info.paneZ).toBe("650");
        expect(info.bg, "background is the opaque --card colour (no alpha)").toBe(info.card);
        expect(info.bg).not.toMatch(/rgba|transparent/);
        expect(info.opacity).toBe("1");
        for (const c of info.chain) { expect(c.opacity, "no ancestor fades the tooltip").toBe("1"); expect(c.filter).toBe("none"); }
        await shot(page, `lane-tooltip-${theme}.png`);
      } finally { await cleanup(page, id); }
    });

    test("info button: mouse opens/closes, Enter opens, Escape closes and returns focus; icon buttons have names and work by keyboard; caption gone", async ({ page }) => {
      let id: string | null = null;
      try {
        id = await openOutputMap(page, "p-median-us", loadFixture("p-median-us"));
        const info = page.getByTestId("button-output-map-info");
        const summary = page.getByTestId("output-map-narrative-summary");
        await expect(info).toBeVisible({ timeout: T });
        await expect(summary).toHaveCount(0);

        // Accessible names, no visible text, caption absent.
        await expect(page.getByRole("button", { name: "About this result" })).toHaveCount(1);
        await expect(page.getByRole("button", { name: "Download PNG" })).toHaveCount(1);
        await expect(page.getByRole("button", { name: "Copy to clipboard" })).toHaveCount(1);
        for (const tid of ["button-output-map-info", "button-download-map-png", "button-copy-map-clipboard"]) {
          expect(((await page.getByTestId(tid).innerText()) ?? "").trim(), `${tid} is icon-only`).toBe("");
        }
        await expect(page.getByTestId("output-map-open-sites")).toHaveCount(0);
        await expect(page.getByText(/^Open warehouses:/)).toHaveCount(0);

        // Mouse open, then close by clicking the button again.
        await info.click({ timeout: T });
        await expect(summary).toBeVisible({ timeout: T });
        expect((await summary.textContent())!.trim().length).toBeGreaterThan(20);
        await shot(page, `info-popover-${theme}.png`);
        await info.click({ timeout: T });
        await expect(summary).toHaveCount(0);

        // Keyboard: Enter opens, Escape closes and focus is back on the button.
        await info.focus();
        await page.keyboard.press("Enter");
        await expect(summary).toBeVisible({ timeout: T });
        await page.keyboard.press("Escape");
        await expect(summary).toHaveCount(0);
        await expect(info).toBeFocused();

        // Download by keyboard (focus + Enter) really downloads a PNG.
        await page.getByTestId("button-download-map-png").focus();
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.keyboard.press("Enter")]);
        expect(dl.suggestedFilename()).toMatch(/\.png$/);

        // Copy by keyboard: toast confirms, and the clipboard holds a PNG (permission granted in-page via the browser context).
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.getByTestId("button-copy-map-clipboard").focus();
        await page.keyboard.press("Enter");
        await expect(page.getByText(/^Map copied to clipboard$/).first()).toBeVisible({ timeout: 30_000 });
        const type = await page.evaluate(async () => (await navigator.clipboard.read())[0].types.join(","));
        expect(type).toContain("image/png");
      } finally { await cleanup(page, id); }
    });

    test("phone width 390px: toggle row wraps, no horizontal page scroll, icon buttons reachable", async ({ page }) => {
      let id: string | null = null;
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        id = await openOutputMap(page, "p-median-us", loadFixture("p-median-us"));
        const row = page.getByTestId("output-map-toggles");
        await expect(row).toBeVisible({ timeout: T });
        expect(await row.evaluate(el => getComputedStyle(el).flexWrap)).toBe("wrap");
        // It really wrapped: the row's items sit on more than one line.
        const tops = await row.evaluate(el => [...el.children].map(c => Math.round(c.getBoundingClientRect().top)));
        expect(new Set(tops).size, `row children tops ${tops}`).toBeGreaterThan(1);
        const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bsw: document.body.scrollWidth }));
        expect(scroll.sw, "no horizontal page scroll (documentElement)").toBeLessThanOrEqual(scroll.cw);
        expect(scroll.bsw, "no horizontal page scroll (body)").toBeLessThanOrEqual(scroll.cw);

        for (const tid of ["button-output-map-info", "button-download-map-png", "button-copy-map-clipboard"]) {
          const b = page.getByTestId(tid);
          await b.scrollIntoViewIfNeeded();
          const r = (await b.boundingBox())!;
          expect(r, `${tid} has a box`).toBeTruthy();
          expect(r.x, `${tid} inside viewport (left)`).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width, `${tid} inside viewport (right)`).toBeLessThanOrEqual(390);
          expect(r.width).toBeGreaterThanOrEqual(32);
          expect(r.height).toBeGreaterThanOrEqual(32);
          // Reachable: the topmost element at its centre is the button itself.
          const hit = await b.evaluate(el => { const q = el.getBoundingClientRect(); const t = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return t === el || el.contains(t); });
          expect(hit, `${tid} is the topmost element at its centre`).toBe(true);
        }
        // And the popover opens at phone width without pushing the page sideways.
        await page.getByTestId("button-output-map-info").click({ timeout: T });
        await expect(page.getByTestId("output-map-narrative-summary")).toBeVisible({ timeout: T });
        const pr = (await page.getByTestId("output-map-narrative").boundingBox())!;
        expect(pr.x, "popover inside viewport (left)").toBeGreaterThanOrEqual(0);
        expect(pr.x + pr.width, "popover inside viewport (right)").toBeLessThanOrEqual(390);
        await shot(page, `phone-${theme}.png`);
        await expectBoxesDisjoint(page);
        await page.setViewportSize({ width: 1280, height: 900 });
        await expectBoxesDisjoint(page);
      } finally { await cleanup(page, id); }
    });
  });
}

async function expectBoxesDisjoint(page: Page) {
  const a = (await page.getByTestId("output-map-bounds").boundingBox())!;
  const b = (await page.getByTestId("output-map-metric-overlay").boundingBox())!;
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap, `bounds ${JSON.stringify(a)} vs metric ${JSON.stringify(b)} must not intersect`).toBe(false);
}
