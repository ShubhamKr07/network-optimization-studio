/**
 * DU-5.4 — Phase 5 (dark mode) real-browser QA.
 *
 * jsdom has no CSS cascade, no layout and no pixels, so the things Phase 5 promised are only
 * observable here: the OS-driven default, the control and its persistence, the no-flash script,
 * the tile filter and what a real tile renders as under it, lane/legend/marker/popup/tooltip/control
 * colours on a dark map, the exported PNG, and every chapter in both themes. Results are SEEDED
 * (helpers/seedSolvedResult.ts + fixtures/solved/*.json): the real solver never runs.
 *
 * Real OpenStreetMap tiles are fetched from tile.openstreetmap.org. When they cannot load the
 * pixel-based assertions are SKIPPED WITH AN ANNOTATION (never faked) and the filter string and the
 * container background are still asserted.
 *
 * EVERY CHECK MUST BE ABLE TO FAIL: loops assert their set is non-empty first, and the light run of
 * the same assertion is the control for "dark did something".
 *
 * Set E2E_SHOTS_DIR to save the full-page screenshots (one per chapter per theme per tab).
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";
import { test, expect, type Page } from "./fixtures";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS, SUPER_SAMPLE_PATH } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const TILE_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)";
const DARK_TILE_RGB: Rgb = [0x1c, 0x19, 0x15];

type Rgb = [number, number, number];
const loadFixture = (modelId: string) => JSON.parse(fs.readFileSync(path.join(here, "fixtures/solved", `${modelId}.json`), "utf8"));
const chapterPath = (modelId: string) => CHAPTERS.find(c => c.modelId === modelId)!.path;

// ── colour maths (WCAG relative luminance / contrast) ───────────────────────
const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const parseRgb = (s: string): Rgb => {
  const m = s.match(/[\d.]+/g);
  if (!m || m.length < 3) throw new Error(`not an rgb(a) colour: "${s}"`);
  return [Math.round(+m[0]), Math.round(+m[1]), Math.round(+m[2])];
};
const rgbStr = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

// ── page plumbing ───────────────────────────────────────────────────────────
async function register(page: Page): Promise<string> {
  const email = `e2e-du5-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  return email;
}
async function registerAndGoHome(page: Page): Promise<string> {
  const email = await register(page);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
  return email;
}
async function createScenario(page: Page, modelId: string, name = `E2E DU-5.4 ${modelId}`): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name, modelId, inputs: SOLVED_MODEL_INPUTS[modelId] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  if (modelId === "super-model") {
    const imp = await page.request.post(`/api/scenarios/${id}/network/import?mode=replace`, { data: JSON.parse(fs.readFileSync(SUPER_SAMPLE_PATH, "utf8")) });
    expect(imp.status(), await imp.text()).toBe(200);
  }
  return id;
}
async function openWorkspace(page: Page, modelId: string, id: string, entry = "sidebar-input-input-map", tab = "input-map-tab"): Promise<void> {
  await page.goto(`${chapterPath(modelId)}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  if (entry !== "sidebar-input-input-map") await page.getByTestId(entry).click({ timeout: T });
  await expect(page.getByTestId(tab)).toBeVisible({ timeout: 15_000 });
}
async function openOutputMap(page: Page, modelId: string, id: string): Promise<void> {
  await seedSolvedResult(page, id, loadFixture(modelId));
  await openWorkspace(page, modelId, id, "sidebar-output-output-map", "output-map-tab");
  await expect.poll(() => page.locator(".leaflet-route-pane path").count(), { timeout: 15_000 }).toBeGreaterThan(0);
}
const scheme = (page: Page, s: "light" | "dark") => page.emulateMedia({ colorScheme: s });
const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("dark"));
async function expectTheme(page: Page, dark: boolean, msg = ""): Promise<void> {
  await expect.poll(() => isDark(page), { timeout: T, message: msg || `html.dark should be ${dark}` }).toBe(dark);
}
/** Computed colour of an arbitrary CSS colour expression, via a probe element. */
async function resolveColor(page: Page, expr: string, prop: "color" | "backgroundColor" = "color"): Promise<Rgb> {
  const s = await page.evaluate(([e, p]) => {
    const el = document.createElement("span");
    (el.style as unknown as Record<string, string>)[p] = e;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[p as "color"];
    el.remove();
    return v;
  }, [expr, prop] as const);
  return parseRgb(s);
}
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}
async function settle(page: Page): Promise<void> {
  let last = -1;
  await expect.poll(async () => { const len = await page.evaluate(() => document.body.innerText.length); const ok = len === last; last = len; return ok; }, { timeout: 15_000, intervals: [300, 300, 300, 300] }).toBe(true);
}

/** Wait for the clicked tab's own content (its `<x>-tab`/`cost-summary-bar` testid when it has one, else the body text changing). */
async function waitForTab(page: Page, entry: string, before: string | null): Promise<void> {
  const tail = entry.replace(/^sidebar-(input|output)-/, "");
  const candidates = [`${tail}-tab`, `${tail.replace(/-/g, "")}-tab`, `${tail.replace(/^output-/, "")}-tab`, tail === "cost-summary" ? "cost-summary-bar" : ""].filter(Boolean);
  let named: string | null = null;
  for (const c of candidates) if (await page.getByTestId(c).count() > 0) { named = c; break; }
  if (named) await expect(page.getByTestId(named)).toBeVisible({ timeout: T });
  else if (before !== null) await expect.poll(() => page.evaluate(() => document.body.innerText), { timeout: T, message: `${entry}: body text should change after opening the tab` }).not.toBe(before);
  await expect(page.getByTestId(entry)).toBeVisible({ timeout: T });
}

// ── pixel sampling (decoded in the browser: no PNG dependency) ──────────────
type Palette = { total: number; top: Array<{ rgb: Rgb; share: number }> };
async function paletteOf(page: Page, png: Buffer): Promise<Palette> {
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) ?? 0) + 1); }
    const total = d.length / 4;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => ({ rgb: [k >> 16, (k >> 8) & 255, k & 255] as Rgb, share: n / total }));
    return { total, top };
  }, png.toString("base64"));
}
const near = (a: Rgb, b: Rgb, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const NO_TILES_OK = process.env.E2E_ALLOW_NO_TILES === "1";
async function tilesLoaded(page: Page, scope: string): Promise<boolean> {
  try {
    await expect.poll(() => page.locator(`${scope} .leaflet-tile-loaded`).count(), { timeout: 20_000 }).toBeGreaterThan(2);
    await page.waitForTimeout(800); // tile fade-in
    return true;
  } catch { return false; }
}
/** Fraction of pixels within `tol` per channel of `c`, over the WHOLE image (not just the top colours). */
async function pixelShareNear(page: Page, png: Buffer, c: Rgb, tol: number): Promise<number> {
  return page.evaluate(async ([b64, c, tol]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d")!; ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - c[0]) <= tol && Math.abs(d[i + 1] - c[1]) <= tol && Math.abs(d[i + 2] - c[2]) <= tol) n++;
    return n / (d.length / 4);
  }, [png.toString("base64"), c, tol] as const);
}
const shareNear = (pal: Palette, c: Rgb, tol: number) => pal.top.filter(p => near(p.rgb, c, tol)).reduce((a, p) => a + p.share, 0);

const DARK_WATER_RGB: Rgb = [0x1c, 0x3d, 0x47];
/**
 * Pixel-sample the map container. OSM tiles are a NETWORK dependency (tile.openstreetmap.org): when they do
 * not load this FAILS, unless E2E_ALLOW_NO_TILES=1, which turns it into a visible test.skip.
 *
 * The dark container background (#1C1915) is the SAME colour as filtered OSM land, so a tile-less map would
 * sample as "land". To prove the sample is tile-derived the container background is temporarily forced to
 * magenta for the screenshot and the magenta share must stay under 1% (tiles cover the view).
 * `land` = the most frequent sampled colour within 3/channel of the measured DARK_TILE, else the modal
 * colour (which then fails the "~ DARK_TILE" assertion). `water` = most frequent colour near the measured
 * dark water, or null. `landShare` = share of pixels near DARK_TILE.
 */
async function sampleLand(page: Page, scope: string): Promise<{ land: Rgb; water: Rgb | null; palette: Palette; landShare: number }> {
  if (!(await tilesLoaded(page, scope))) {
    test.skip(NO_TILES_OK, `OSM tiles did not load (no network to tile.openstreetmap.org); E2E_ALLOW_NO_TILES=1`);
    throw new Error("OSM tiles did not load: this spec needs network access to tile.openstreetmap.org (set E2E_ALLOW_NO_TILES=1 to skip the pixel tests)");
  }
  const style = await page.addStyleTag({ content: ".leaflet-container { background: #ff00ff !important; }" });
  let png: Buffer;
  try { png = await page.locator(`${scope} .leaflet-container`).first().screenshot(); }
  finally { await style.evaluate(e => (e as Element).remove()); }
  const palette = await paletteOf(page, png);
  const magenta = shareNear(palette, [255, 0, 255], 3);
  expect(magenta, `magenta container background showing through = ${(magenta * 100).toFixed(2)}% (must be < 1%: tiles cover the view)`).toBeLessThan(0.01);
  const land = palette.top.find(p => near(p.rgb, DARK_TILE_RGB, 3))?.rgb ?? palette.top[0].rgb;
  const water = palette.top.find(p => near(p.rgb, DARK_WATER_RGB, 6))?.rgb ?? null;
  return { land, water, palette, landShare: shareNear(palette, DARK_TILE_RGB, 3) };
}

type MapCss = { filter: string; containerBg: string; tilePaneCount: number };
const mapCss = (page: Page, scope: string): Promise<MapCss> => page.evaluate(s => {
  const root = document.querySelector(s)!;
  const pane = root.querySelector(".leaflet-tile-pane")!;
  const c = root.querySelector(".leaflet-container")!;
  return { filter: getComputedStyle(pane).filter, containerBg: getComputedStyle(c).backgroundColor, tilePaneCount: root.querySelectorAll(".leaflet-tile-pane").length };
}, scope);

type Lane = { stroke: string | null; dash: string | null; computed: string };
const readLanes = (page: Page): Promise<Lane[]> =>
  page.locator(".leaflet-route-pane path").evaluateAll(els => els.map(el => ({ stroke: el.getAttribute("stroke"), dash: el.getAttribute("stroke-dasharray"), computed: getComputedStyle(el).stroke })));

// ── legibility scan: visible text vs its effective opaque background ────────
type Finding = { text: string; fg: string; bg: string; ratio: number; where: string };
type Allowed = { text: string; ratio: number; why: string };
/**
 * `min` is the text threshold (4.5:1 for the dark scans). Only text whose computed colour equals the resolved
 * --destructive (Q3 known exception) or --text-faint (decorative-only, plan Q2) may fall to 3:1; those hits
 * are returned in `allowed` and each is asserted >= 3 by the scan itself (anything lower is a finding).
 */
async function legibilityScan(page: Page, skipSelector = ".leaflet-container", min = 4.5): Promise<{ checked: number; findings: Finding[]; allowed: Allowed[]; whiteSurfaces: string[] }> {
  return page.evaluate(([skip, min]) => {
    const cvs = document.createElement("canvas"); cvs.width = cvs.height = 1;
    const ctx = cvs.getContext("2d", { willReadFrequently: true })!;
    const toRgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "rgba(0,0,0,0)"; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const L = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const over = (top: number[], bot: number[]) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
    const effBg = (el: Element): number[] | null => {
      const layers: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== "none") return null; // gradient/image: not measurable here
        const c = toRgba(cs.backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] === 1) break;
      }
      let acc: number[] = toRgba(getComputedStyle(document.body).backgroundColor);
      acc[3] = 1;
      for (const l of layers.reverse()) acc = over(l, acc);
      return acc;
    };
    const resolved = (expr: string) => { const e = document.createElement("span"); e.style.color = expr; document.body.appendChild(e); const c = toRgba(getComputedStyle(e).color); e.remove(); return c; };
    const sameRgb = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    const exceptions: Array<[string, number[]]> = [["Q3 --destructive", resolved("hsl(var(--destructive))")], ["--text-faint", resolved("var(--text-faint)")]];
    const allowed: Allowed[] = [];
    const findings: Finding[] = [];
    const whiteSurfaces: string[] = [];
    let checked = 0;
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent ?? "").trim()) continue;
      seen.add(el);
      if (el.closest(skip) || el.closest("script,style,svg")) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
      let op = 1; for (let e: Element | null = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
      if (op < 0.5) continue; // faded/disabled affordances are judged by the disabled-control check
      const bg = effBg(el); if (!bg) continue;
      const fgRaw = toRgba(cs.color); const fg = over(fgRaw, bg);
      const ratio = (Math.max(L(fg), L(bg)) + 0.05) / (Math.min(L(fg), L(bg)) + 0.05);
      checked++;
      const why = ratio >= 3 && ratio < min ? exceptions.find(([, c]) => sameRgb(c, fgRaw))?.[0] : undefined;
      if (why) allowed.push({ text: (n.textContent ?? "").trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, why });
      else if (ratio < min) findings.push({ text: (n.textContent ?? "").trim().slice(0, 40), fg: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`, ratio: Math.round(ratio * 100) / 100, where: `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.className.toString().slice(0, 50)}]` });
    }
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el.closest(skip) || el.closest("svg")) continue;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (r.width * r.height < 400 || cs.visibility === "hidden") continue;
      if (cs.backgroundColor === "rgb(255, 255, 255)") whiteSurfaces.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.className.toString().slice(0, 60)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return { checked, findings, allowed, whiteSurfaces };
  }, [skipSelector, min] as const);
}

test.describe("DU-5.4 — Phase 5 real-browser QA (dark mode)", () => {
  test.use({ actionTimeout: 15_000 });

  // ═════════════════════════════════════════════════════════════════════════
  test("system default: no stored pref follows prefers-color-scheme; body background is the --background token", async ({ page }) => {
    await scheme(page, "dark");
    await page.goto("/login");
    await expect(page.locator("form").first()).toBeVisible({ timeout: T });
    await expectTheme(page, true);
    expect(await page.evaluate(() => localStorage.getItem("nos:theme-pref")), "no pref stored: this is the default path").toBeNull();
    const darkBg = await bodyBg(page);
    const probeDark = rgbStr(await resolveColor(page, "hsl(var(--background))", "backgroundColor"));
    expect(darkBg, "dark body = hsl(var(--background))").toBe(probeDark);
    expect(darkBg, "the dark background is the approved #171914 render").toBe("rgb(23, 25, 20)");

    await scheme(page, "light");
    await page.reload();
    await expectTheme(page, false);
    const lightBg = await bodyBg(page);
    expect(lightBg).toBe(rgbStr(await resolveColor(page, "hsl(var(--background))", "backgroundColor")));
    expect(lightBg, "control: the two themes really differ").not.toBe(darkBg);
  });

  // ═════════════════════════════════════════════════════════════════════════
  test("toggle: Workspace header only; Dark survives reload; Light overrides OS-dark; System follows a mid-session OS change", async ({ page }) => {
    test.setTimeout(120_000);
    await scheme(page, "dark");
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us");
    try {
      await openWorkspace(page, "p-median-us", id);
      const toggle = page.getByTestId("theme-toggle");
      await expect(toggle).toBeVisible({ timeout: T });
      await expect(page.getByTestId("theme-toggle-system")).toHaveAttribute("aria-pressed", "true");
      await expectTheme(page, true, "default system + OS dark");

      await page.getByTestId("theme-toggle-light").click();
      await expectTheme(page, false, "Light overrides OS-dark");
      await page.reload();
      await expect(page.getByTestId("theme-toggle-light")).toHaveAttribute("aria-pressed", "true", { timeout: T });
      await expectTheme(page, false, "Light survives reload while the OS is dark");

      await page.getByTestId("theme-toggle-dark").click();
      await expectTheme(page, true);
      await scheme(page, "light"); // OS goes light; explicit Dark must NOT follow
      await page.reload();
      await expect(page.getByTestId("theme-toggle-dark")).toHaveAttribute("aria-pressed", "true", { timeout: T });
      await expectTheme(page, true, "Dark survives reload while the OS is light");
      expect(await page.evaluate(() => localStorage.getItem("nos:theme-pref"))).toBe("dark");

      await page.getByTestId("theme-toggle-system").click();
      await expectTheme(page, false, "System + OS light");
      await scheme(page, "dark"); // mid-session OS change, no reload
      await expectTheme(page, true, "System follows a mid-session OS change");
      await scheme(page, "light");
      await expectTheme(page, false, "…and back");

      // Absent everywhere else (Q6): Landing, not-found, login, register, forgot-password.
      await page.getByTestId("button-page-back").click();
      await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
      await expect(page.getByTestId("theme-toggle")).toHaveCount(0);
      await page.goto("/definitely-not-a-route");
      await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
      await expect(page.getByTestId("theme-toggle")).toHaveCount(0);
      await page.getByTestId("button-logout").click();
      for (const route of ["/login", "/register", "/forgot-password"]) {
        await page.goto(route);
        await expect(page.locator("form").first()).toBeVisible({ timeout: T });
        await expect(page.getByTestId("theme-toggle"), route).toHaveCount(0);
      }
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  for (const choice of ["dark", "light"] as const) {
    test(`works across pages: ${choice} chosen in a Workspace applies on Landing, a re-login, login and register${choice === "light" ? " (OS emulated dark)" : ""}`, async ({ page }) => {
      test.setTimeout(120_000);
      const want = choice === "dark";
      await scheme(page, choice === "dark" ? "light" : "dark"); // the OS says the opposite of the choice
      const email = await registerAndGoHome(page);
      const id = await createScenario(page, "p-median-us");
      try {
        await openWorkspace(page, "p-median-us", id);
        await page.getByTestId(`theme-toggle-${choice}`).click();
        await expectTheme(page, want);
        const wsBg = await bodyBg(page);

        await page.getByTestId("button-page-back").click(); // SPA navigation to Landing
        await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
        await expectTheme(page, want, "Landing after SPA back");
        await page.reload();
        await expectTheme(page, want, "Landing after a hard load");

        // Cost Summary is where scenarios are compared (the standalone Compare page was removed in Phase 3.2).
        await seedSolvedResult(page, id, loadFixture("p-median-us"));
        await openWorkspace(page, "p-median-us", id, "sidebar-output-cost-summary", "cost-summary-bar");
        await expectTheme(page, want, "Cost Summary");

        await page.goto("/");
        await page.getByTestId("button-logout").click();
        await expect(page).toHaveURL(/\/login/, { timeout: T });
        await expectTheme(page, want, "login page after logout");
        await page.goto("/register");
        await expectTheme(page, want, "register page");
        await page.goto("/login");
        await page.getByTestId("input-email").fill(email);
        await page.getByTestId("input-password").fill("correcthorse1");
        await page.getByTestId("button-login").click();
        await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
        await expectTheme(page, want, "Landing after logging in again");
        // Non-vacuity: dark and light backgrounds differ, so "applies" is observable.
        expect(await bodyBg(page)).toBe(wsBg);
        expect(await bodyBg(page)).toBe(rgbStr(await resolveColor(page, "hsl(var(--background))", "backgroundColor")));
          expect(await bodyBg(page), want ? "dark bg is not white" : "light bg is not the dark ink").not.toBe(want ? "rgb(255, 255, 255)" : "rgb(23, 25, 20)");
      } finally {
        await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  test("no storage: a context whose localStorage throws still renders and still switches in-session", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context: BrowserContext = await browser.newContext({ baseURL, colorScheme: "dark", storageState: undefined });
    await context.addInitScript(() => {
      const boom = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.getItem = boom;
      Storage.prototype.setItem = boom;
      Storage.prototype.removeItem = boom;
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto("/login");
      await expect(page.locator("form").first()).toBeVisible({ timeout: T });
      await expectTheme(page, true, "OS dark with storage blocked");
      expect(await page.evaluate(() => { try { localStorage.getItem("x"); return "ok"; } catch { return "throws"; } }), "non-vacuity: storage really throws").toBe("throws");

      const resp = await page.request.post("/api/auth/register", { data: { email: `e2e-du5-nostore-${Date.now()}@test.com`, password: "correcthorse1" } });
      expect(resp.status()).toBe(201);
      const create = await page.request.post("/api/scenarios", { data: { name: "nostore", modelId: "p-median-us", inputs: SOLVED_MODEL_INPUTS["p-median-us"] } });
      const id = String((await create.json()).id);
      await page.goto(`${chapterPath("p-median-us")}?scenario=${id}`);
      await expect(page.getByTestId("theme-toggle")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("theme-toggle-light").click();
      await expectTheme(page, false, "switches to Light in-session without storage");
      await page.getByTestId("theme-toggle-dark").click();
      await expectTheme(page, true, "switches back to Dark in-session");
      await page.request.delete(`/api/scenarios/${id}`);
      expect(errors, "no uncaught page error with storage blocked").toEqual([]);
    } finally {
      await context.close();
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  test("no flash: html.dark is set at DOMContentLoaded by index.html's script, with the React bundle blocked", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__dcl = null;
      document.addEventListener("DOMContentLoaded", () => { (window as unknown as Record<string, unknown>).__dcl = document.documentElement.classList.contains("dark"); });
    });
    // Block the app entry so ONLY the inline script can have set the class.
    let blocked = 0;
    await page.route(/\/src\/main\.tsx/, route => { blocked++; return route.abort(); });
    await scheme(page, "dark");
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__dcl), { timeout: T }).not.toBeNull();
    expect(blocked, "non-vacuity: the app entry request was really blocked").toBeGreaterThan(0);
    expect(await page.evaluate(() => document.getElementById("root")?.childElementCount ?? -1), "React never rendered").toBe(0);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__dcl), "dark at DOMContentLoaded, OS dark, nothing stored").toBe(true);

    // Controls: OS light -> not dark; stored light + OS dark -> not dark; stored dark + OS light -> dark.
    await scheme(page, "light");
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    expect(await isDark(page), "OS light").toBe(false);
    await scheme(page, "dark");
    await page.evaluate(() => localStorage.setItem("nos:theme-pref", "light"));
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    expect(await isDark(page), "stored light beats OS dark").toBe(false);
    await scheme(page, "light");
    await page.evaluate(() => localStorage.setItem("nos:theme-pref", "dark"));
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    expect(await isDark(page), "stored dark beats OS light").toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // DARK MAPS
  // ═════════════════════════════════════════════════════════════════════════
  const OUT = '[data-testid="output-map-tab"]';
  const IN = '[data-testid="input-map-tab"]';

  for (const modelId of ["p-median-us", "two-echelon-jade-us"]) {
    test(`dark Output Map (${modelId}): tile filter, sampled land pixel, band/marker >= 3:1 on the SAMPLED pixel, lane stroke + dash, legend, markers`, async ({ page }, testInfo) => {
      test.setTimeout(150_000);
      await scheme(page, "light");
      await registerAndGoHome(page);
      const id = await createScenario(page, modelId);
      try {
        await openOutputMap(page, modelId, id);
        await settle(page);

        // ── light run: the control ──
        await expectTheme(page, false);
        const lightCss = await mapCss(page, OUT);
        expect(lightCss.filter, "light: no tile filter").toBe("none");
        expect(lightCss.tilePaneCount).toBe(1);
        const lightLanes = await readLanes(page);
        expect(lightLanes.length, "lanes exist").toBeGreaterThan(0);
        const TOKENS = ["--map-warehouse-open", "--map-customer", "--map-plant", "--band-0", "--band-1", "--band-2", "--band-3", "--band-4"];
        const lightTok: Record<string, string> = {};
        for (const t of TOKENS) lightTok[t] = rgbStr(await resolveColor(page, `var(${t})`));
        const lightLegendBg = await page.getByTestId("map-legend").evaluate(el => getComputedStyle(el).backgroundColor);
        expect(lightLegendBg, "light legend card is white").toBe("rgb(255, 255, 255)");

        // ── dark ──
        await scheme(page, "dark");
        await expectTheme(page, true);
        await settle(page);
        const css = await mapCss(page, OUT);
        expect(css.filter).toBe(TILE_FILTER);
        expect(css.containerBg, "container background before tiles load").toBe(rgbStr(DARK_TILE_RGB));
        for (const t of TOKENS) {
          const dark = rgbStr(await resolveColor(page, `var(${t})`));
          if (t === "--map-plant" || t === "--map-customer") expect(dark, `${t} is deliberately unchanged (plan Q2)`).toBe(lightTok[t]);
          else expect(dark, `${t} has a dark value that differs from light ${lightTok[t]}`).not.toBe(lightTok[t]);
        }

        const lanes = await readLanes(page);
        expect(lanes.length, "same lane count in both themes").toBe(lightLanes.length);
        const bandVars = new Map<string, Rgb>();
        for (const l of lanes) {
          expect(l.stroke, "lane stroke is a band token").toMatch(/^var\(--band-(\d|overflow)\)$/);
          if (!bandVars.has(l.stroke!)) bandVars.set(l.stroke!, await resolveColor(page, l.stroke!));
        }
        expect(bandVars.size, "more than one band is drawn").toBeGreaterThan(1);
        lanes.forEach((l, i) => {
          expect(l.computed, `lane ${i} computed stroke = its dark band token`).toBe(rgbStr(bandVars.get(l.stroke!)!));
          expect(l.dash, `lane ${i} dasharray unchanged from light`).toBe(lightLanes[i].dash);
          expect(l.stroke, `lane ${i} band unchanged from light`).toBe(lightLanes[i].stroke);
        });
        const lightStroke = lightLanes.find(l => l.stroke === "var(--band-1)") ?? lightLanes[0];
        expect(lightStroke.computed, "control: a lane's stroke colour really changed between themes").not.toBe(lanes[lightLanes.indexOf(lightStroke)].computed);

        // legend swatches
        const nBands = await page.locator('[data-testid^="legend-band-"]').count();
        expect(nBands, "legend band swatches").toBeGreaterThan(0);
        for (let i = 0; i < nBands; i++) {
          const sw = await page.getByTestId(`legend-band-${i}`).evaluate(el => getComputedStyle(el).backgroundColor);
          expect(sw, `legend swatch ${i}`).toBe(rgbStr(await resolveColor(page, `var(--band-${i})`)));
        }
        const legend = await page.getByTestId("map-legend").evaluate(el => getComputedStyle(el).backgroundColor);
        expect(legend, "legend card = --card").toBe(rgbStr(await resolveColor(page, "hsl(var(--card))", "backgroundColor")));
        expect(legend).not.toBe(lightLegendBg);

        // markers compute to dark --map-* tokens
        const fills = await page.evaluate(sel => {
          const q = (s: string) => Array.from(document.querySelectorAll(`${sel} ${s}`));
          return {
            wh: q(".leaflet-marker-icon svg polygon").map(e => ({ fill: e.getAttribute("fill"), cf: getComputedStyle(e).fill, cs: getComputedStyle(e).stroke })),
            pl: q(".leaflet-marker-icon svg rect").map(e => ({ fill: e.getAttribute("fill"), cf: getComputedStyle(e).fill })),
            cu: q(".leaflet-overlay-pane path.leaflet-interactive").map(e => ({ fill: e.getAttribute("fill"), cf: getComputedStyle(e).fill, cs: getComputedStyle(e).stroke, ss: e.getAttribute("stroke") })),
          };
        }, OUT);
        expect(fills.wh.length, "warehouse markers").toBeGreaterThan(0);
        const checkFill = async (label: string, list: Array<{ fill: string | null; cf: string }>) => {
          const withVar = list.filter(f => f.fill?.startsWith("var(--map-"));
          expect(withVar.length, `${label}: token-filled shapes`).toBeGreaterThan(0);
          for (const f of withVar) expect(f.cf, `${label} ${f.fill}`).toBe(rgbStr(await resolveColor(page, f.fill!)));
        };
        await checkFill("warehouse", fills.wh);
        await checkFill("customer", fills.cu.filter(c => c.ss?.startsWith("var(--map-customer")));
        if (modelId === "two-echelon-jade-us") await checkFill("plant", fills.wh.filter(f => f.fill === "var(--map-plant)"));

        // sampled land pixel (tile-derived: magenta-container proof inside sampleLand)
        const sample = await sampleLand(page, OUT);
        {
          const { land, palette } = sample;
          expect(sample.water, `${modelId}: sampled dark water ${rgbStr(DARK_WATER_RGB)} is present, so the sample is provably tile-derived`).not.toBeNull();
          testInfo.annotations.push({ type: "sampled-land", description: `${modelId}: land ${rgbStr(land)} share ${(sample.landShare * 100).toFixed(1)}%; water ${rgbStr(sample.water!)}; next: ${palette.top.slice(1, 4).map(p => rgbStr(p.rgb)).join(" ")}` });
          expect(lum(land), `sampled land ${rgbStr(land)} luminance < 0.05`).toBeLessThan(0.05);
          expect(near(land, DARK_TILE_RGB, 3), `sampled land ${rgbStr(land)} ~ the measured DARK_TILE #1C1915`).toBe(true);
          for (const [name, rgb] of bandVars) expect(contrast(rgb, land), `${name} vs sampled land`).toBeGreaterThanOrEqual(3);
          const markerTokens = ["--map-warehouse-open", "--map-customer", ...(modelId === "two-echelon-jade-us" ? ["--map-plant"] : [])];
          for (const t of markerTokens) expect(contrast(await resolveColor(page, `var(${t})`), land), `${t} vs sampled land`).toBeGreaterThanOrEqual(3);
        }
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator(OUT).screenshot({ path: path.join(SHOTS, `map-output-${modelId}-dark.png`) }); }
      } finally {
        await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
      }
    });
  }

  test("dark Output Map chrome: popup + close button, tooltip + arrow, attribution (p-median-us)", async ({ page }) => {
    test.setTimeout(150_000);
    await scheme(page, "dark");
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us");
    try {
      await openOutputMap(page, "p-median-us", id);
      const card = await resolveColor(page, "hsl(var(--card))", "backgroundColor");
      const cardFg = await resolveColor(page, "hsl(var(--card-foreground))");
      const muted = await resolveColor(page, "hsl(var(--muted-foreground))");

      // attribution
      const attr = page.locator(`${OUT} .leaflet-control-attribution`);
      await expect(attr).toBeVisible({ timeout: T });
      const a = await attr.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, link: getComputedStyle(el.querySelector("a")!).color }));
      expect(parseRgb(a.fg)).toEqual(muted);
      expect(parseRgb(a.link), "attribution link = --link").toEqual(await resolveColor(page, "var(--link)"));
      expect(a.bg, "attribution background is translucent --card (alpha .8)").toMatch(/rgba\(.*0\.8\)/);
      expect(parseRgb(a.bg)).toEqual(card);

      // tooltip + arrow (hover a warehouse marker)
      const wh = page.locator(`${OUT} .leaflet-marker-icon`).first();
      await wh.scrollIntoViewIfNeeded();
      await wh.hover({ force: true, timeout: T });
      const tip = page.locator(`${OUT} .leaflet-tooltip`).last();
      await expect(tip).toBeVisible({ timeout: T });
      const t = await tip.evaluate(el => {
        const cs = getComputedStyle(el); const b = getComputedStyle(el, "::before");
        return { bg: cs.backgroundColor, fg: cs.color, cls: el.className, top: b.borderTopColor, bottom: b.borderBottomColor, left: b.borderLeftColor, right: b.borderRightColor };
      });
      expect(parseRgb(t.bg), "tooltip bg = --card").toEqual(card);
      expect(contrast(parseRgb(t.fg), parseRgb(t.bg)), "tooltip text legible").toBeGreaterThanOrEqual(4.5);
      const dir = (["top", "bottom", "left", "right"] as const).find(d => t.cls.includes(`leaflet-tooltip-${d}`))!;
      expect(dir, "tooltip direction class").toBeTruthy();
      expect(parseRgb(t[dir]), `tooltip arrow (${dir}) = --card`).toEqual(card);
      await shot(page, "map-tooltip-dark.png");

      // popup + close button (click a reachable customer circle)
      await page.mouse.move(2, 2);
      const spot = await page.locator(`${OUT} .leaflet-overlay-pane path.leaflet-interactive`).evaluateAll(els => {
        const k = document.querySelector('[data-testid="output-map-tab"] .leaflet-container')!.getBoundingClientRect();
        for (const el of els) {
          const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
          if (x > k.x + k.width * 0.2 && x < k.x + k.width * 0.6 && y > k.y + 160 && y < k.y + k.height - 40 && document.elementFromPoint(x, y) === el) return { x, y };
        }
        return null;
      });
      expect(spot, "a reachable customer circle to click").not.toBeNull();
      await page.mouse.click(spot!.x, spot!.y);
      const popup = page.locator(".leaflet-popup");
      await expect(popup).toBeVisible({ timeout: T });
      const p = await popup.evaluate(el => {
        const w = el.querySelector(".leaflet-popup-content-wrapper")!, tipEl = el.querySelector(".leaflet-popup-tip")!, c = el.querySelector(".leaflet-popup-close-button")!, content = el.querySelector(".leaflet-popup-content")!;
        return { wb: getComputedStyle(w).backgroundColor, wf: getComputedStyle(w).color, tb: getComputedStyle(tipEl).backgroundColor, cc: getComputedStyle(c).color, ct: getComputedStyle(content).color, text: (content.textContent ?? "").trim().slice(0, 60) };
      });
      expect(p.text.length, "popup has content").toBeGreaterThan(0);
      expect(parseRgb(p.wb), "popup wrapper = --card").toEqual(card);
      expect(parseRgb(p.tb), "popup tip = --card").toEqual(card);
      expect(parseRgb(p.cc), "close button = --muted-foreground").toEqual(muted);
      expect(contrast(parseRgb(p.cc), card), "close button legible").toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseRgb(p.ct), card), "popup text legible").toBeGreaterThanOrEqual(4.5);
      expect(parseRgb(p.wf)).toEqual(cardFg);
      await shot(page, "map-popup-dark.png");
      await popup.locator(".leaflet-popup-close-button").hover();
      const hov = await popup.locator(".leaflet-popup-close-button").evaluate(el => getComputedStyle(el).color);
      expect(parseRgb(hov), "close button hover = --foreground").toEqual(await resolveColor(page, "hsl(var(--foreground))"));
      await popup.locator(".leaflet-popup-close-button").click({ timeout: T });
      await expect(popup).toHaveCount(0);

      // light control for the same chrome
      await scheme(page, "light");
      await expectTheme(page, false);
      const lightAttr = await attr.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(parseRgb(lightAttr), "light attribution is leaflet's own white-ish").not.toEqual(card);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
    }
  });

  for (const modelId of ["p-median-us", "super-model"]) {
    test(`dark Input Map (${modelId}): tile filter, zoom buttons, attribution, markers, sampled land`, async ({ page }, testInfo) => {
      test.setTimeout(150_000);
      await scheme(page, "light");
      await registerAndGoHome(page);
      const id = await createScenario(page, modelId);
      try {
        await openWorkspace(page, modelId, id);
        await settle(page);
        expect((await mapCss(page, IN)).filter, "light: none").toBe("none");
        const lightZoom = await page.locator(`${IN} .leaflet-control-zoom-in`).evaluate(el => getComputedStyle(el).backgroundColor);
        expect(lightZoom, "light zoom button is leaflet white").toBe("rgb(255, 255, 255)");

        await scheme(page, "dark");
        await expectTheme(page, true);
        const css = await mapCss(page, IN);
        expect(css.filter).toBe(TILE_FILTER);
        expect(css.containerBg).toBe(rgbStr(DARK_TILE_RGB));
        const card = await resolveColor(page, "hsl(var(--card))", "backgroundColor");
        const zin = page.locator(`${IN} .leaflet-control-zoom-in`);
        await expect(zin).toBeVisible({ timeout: T });
        for (const sel of [".leaflet-control-zoom-in", ".leaflet-control-zoom-out"]) {
          const z = await page.locator(`${IN} ${sel}`).evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, bd: getComputedStyle(el).borderBottomColor }));
          expect(parseRgb(z.bg), `${sel} bg = --card`).toEqual(card);
          expect(contrast(parseRgb(z.fg), card), `${sel} glyph legible`).toBeGreaterThanOrEqual(4.5);
        }
        expect(parseRgb(await page.locator(`${IN} .leaflet-control-attribution`).evaluate(el => getComputedStyle(el).backgroundColor))).toEqual(card);

        const markers = await page.evaluate(sel => Array.from(document.querySelectorAll(`${sel} .leaflet-marker-icon svg [fill^="var(--map-"], ${sel} .leaflet-overlay-pane path[fill^="var(--map-"]`)).map(e => ({ fill: e.getAttribute("fill")!, cf: getComputedStyle(e).fill })), IN);
        expect(markers.length, "token-filled input-map shapes").toBeGreaterThan(0);
        const seen = new Set<string>();
        for (const m of markers) {
          if (seen.has(m.fill)) continue; seen.add(m.fill);
          expect(m.cf, m.fill).toBe(rgbStr(await resolveColor(page, m.fill)));
        }
        const sample = await sampleLand(page, IN);
        expect(lum(sample.land), `${modelId} input map sampled land ${rgbStr(sample.land)}`).toBeLessThan(0.05);
        for (const m of seen) {
          const c = await resolveColor(page, m);
          if (/map-(warehouse|customer|plant|highlight)/.test(m)) expect(contrast(c, sample.land), `${m} vs sampled land`).toBeGreaterThanOrEqual(3);
        }
        testInfo.annotations.push({ type: "sampled-land", description: `input ${modelId}: ${rgbStr(sample.land)} share ${(sample.landShare * 100).toFixed(1)}%` });
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator(IN).screenshot({ path: path.join(SHOTS, `map-input-${modelId}-dark.png`) }); }
      } finally {
        await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
      }
    });
  }

  test("Q10 on a dark map: the Move (#2563eb) and Copy (#059669) ghost circles and the Gold fixed-mine pin are visible against the sampled tile", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await scheme(page, "dark");
    await registerAndGoHome(page);
    // p-median-us with ONE added warehouse (only added entities offer Move).
    const create = await page.request.post("/api/scenarios", { data: { name: "E2E DU-5.4 ghost", modelId: "p-median-us", inputs: { ...SOLVED_MODEL_INPUTS["p-median-us"], addedWarehouses: [{ id: "ADDED-1", city: "Testburg", state: "ZZ", lat: 40.0, lng: -100.0, status: "active" }] } } });
    expect(create.status()).toBe(201);
    const id = String((await create.json()).id);
    let goldId = "";
    try {
      await openWorkspace(page, "p-median-us", id);
      const landSample = await sampleLand(page, IN);
      const land = landSample.land;
      const water = landSample.water;
      testInfo.annotations.push({ type: "q10-ground", description: `sampled land ${rgbStr(land)}; sampled water ${water ? rgbStr(water) : "none in view"}` });
      const added = page.locator(`${IN} .leaflet-marker-icon.wh-marker`).last();
      await added.scrollIntoViewIfNeeded();
      await added.click({ force: true, timeout: T });
      const kinds: Array<["move" | "copy", string]> = [["move", "rgb(37, 99, 235)"], ["copy", "rgb(5, 150, 105)"]];
      for (const [kind, stroke] of kinds) {
        await expect(page.getByTestId("map-details-card")).toBeVisible({ timeout: T });
        await page.getByTestId(`map-details-action-${kind}`).click({ timeout: T });
        await expect(page.getByTestId("armed-status-bar")).toBeVisible({ timeout: T });
        const k = (await page.locator(`${IN} .leaflet-container`).boundingBox())!;
        await page.mouse.move(k.x + k.width * 0.35, k.y + k.height * 0.4);
        await page.mouse.move(k.x + k.width * 0.36, k.y + k.height * 0.41);
        const ghost = page.locator(`${IN} .leaflet-overlay-pane path[stroke-dasharray="4"]`);
        await expect(ghost, `${kind} ghost circle drawn`).toHaveCount(1, { timeout: T });
        const g = await ghost.evaluate(el => { const r = el.getBoundingClientRect(); return { stroke: getComputedStyle(el).stroke, w: r.width, h: r.height, fo: getComputedStyle(el).fillOpacity, so: getComputedStyle(el).strokeOpacity }; });
        expect(g.stroke, `${kind} ghost stroke`).toBe(stroke);
        expect(g.w, `${kind} ghost has size`).toBeGreaterThan(8);
        expect(+g.so, `${kind} ghost stroke fully opaque`).toBe(1);
        {
          const onLand = contrast(parseRgb(g.stroke), land);
          testInfo.annotations.push({ type: "q10-contrast", description: `${kind} ghost ${g.stroke}: ${onLand.toFixed(2)}:1 vs sampled land${water ? `, ${contrast(parseRgb(g.stroke), water).toFixed(2)}:1 vs sampled water (observation only, user decision)` : ""}` });
          expect(onLand, `${kind} ghost stroke vs sampled land`).toBeGreaterThanOrEqual(3);
        }
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `q10-ghost-${kind}-dark.png`), clip: { x: Math.max(0, k.x + k.width * 0.36 - 80), y: Math.max(0, k.y + k.height * 0.41 - 80), width: 160, height: 160 } }); }
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("armed-status-bar")).toHaveCount(0, { timeout: T });
        if (kind === "move") { await added.click({ force: true, timeout: T }); }
      }

      // Gold fixed mine pin
      goldId = await createScenario(page, "two-echelon-gold-au", "E2E DU-5.4 gold");
      await openWorkspace(page, "two-echelon-gold-au", goldId);
      await settle(page);
      const pin = page.locator(`${IN} img.leaflet-marker-icon`).first();
      await expect(pin, "the Gold fixed mine is Leaflet's default PNG pin").toBeVisible({ timeout: T });
      await pin.scrollIntoViewIfNeeded();
      const box = (await pin.boundingBox())!;
      expect(box.width).toBeGreaterThan(10);
      expect(await pin.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0), "the pin image actually decoded").toBe(true);
      const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
      const pal = await paletteOf(page, png);
      const blue = shareNear(pal, [46, 133, 203], 12);
      const white = pal.top.filter(p => p.rgb.every(c => c > 240)).reduce((a, p) => a + p.share, 0);
      testInfo.annotations.push({ type: "gold-pin", description: `pin clip: Leaflet blue rgb(46,133,203)+-12 ${(blue * 100).toFixed(1)}%, near-white ${(white * 100).toFixed(1)}%; top ${pal.top.slice(0, 4).map(p => `${rgbStr(p.rgb)}@${(p.share * 100).toFixed(0)}%`).join(" ")}` });
      expect(blue, "the pin body (Leaflet marker blue) is rendered").toBeGreaterThan(0);
      expect(white, "the pin's white outline/dot is rendered (> 2%)").toBeGreaterThan(0.02);
      expect(contrast([46, 133, 203], (await sampleLand(page, IN)).land), "pin blue vs sampled dark land").toBeGreaterThanOrEqual(3);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "q10-gold-mine-pin-dark.png"), clip: { x: Math.max(0, box.x - 100), y: Math.max(0, box.y - 100), width: 220, height: 220 } }); }
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
      if (goldId) await page.request.delete(`/api/scenarios/${goldId}`).catch(() => {});
    }
  });

  test("dark 'Download PNG' / 'Copy to clipboard': the exported map keeps the dark tile and the dark marker colours", async ({ page, context }, testInfo) => {
    test.setTimeout(150_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await scheme(page, "dark");
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us");
    try {
      await openOutputMap(page, "p-median-us", id);
      const live = await sampleLand(page, OUT);
      expect(live.landShare, "live map has a real share of dark land to compare the export against").toBeGreaterThan(0.1);
      const exportChecks = async (label: string, buf: Buffer) => {
        const pal = await paletteOf(page, buf);
        const exportShare = shareNear(pal, DARK_TILE_RGB, 3);
        testInfo.annotations.push({ type: `export-${label}`, description: `#1C1915 share ${(exportShare * 100).toFixed(1)}% (live ${(live.landShare * 100).toFixed(1)}%); dominant ${rgbStr(pal.top[0].rgb)}; top ${pal.top.slice(0, 4).map(p => rgbStr(p.rgb)).join(" ")}` });
        expect(Math.abs(exportShare - live.landShare), `${label}: export #1C1915 share ${(exportShare * 100).toFixed(1)}% within 15 points of live ${(live.landShare * 100).toFixed(1)}%`).toBeLessThanOrEqual(0.15);
        expect(lum(pal.top[0].rgb), `${label}: dominant colour dark`).toBeLessThan(0.05);
        expect(near(pal.top[0].rgb, DARK_TILE_RGB, 3), `${label}: dominant ~ #1C1915`).toBe(true);
        // Open warehouse triangle: solid --map-warehouse-open. Customer dot: --map-customer at fill-opacity 0.8 over the
        // dark land (NetworkMap), so the rendered fill is that blend; its stroke is --map-customer-stroke.
        const wh = await resolveColor(page, "var(--map-warehouse-open)");
        const cu = await resolveColor(page, "var(--map-customer)");
        const cuStroke = await resolveColor(page, "var(--map-customer-stroke)");
        const blend = cu.map((v, i) => Math.round(v * 0.8 + DARK_TILE_RGB[i] * 0.2)) as Rgb;
        expect(await pixelShareNear(page, buf, wh, 8), `${label}: export contains --map-warehouse-open ${rgbStr(wh)}`).toBeGreaterThan(0);
        const blendShare = await pixelShareNear(page, buf, blend, 12), strokeShare = await pixelShareNear(page, buf, cuStroke, 12);
        testInfo.annotations.push({ type: `export-${label}-customer`, description: `customer fill blend ${rgbStr(blend)} ${(blendShare * 100).toFixed(3)}%, stroke ${rgbStr(cuStroke)} ${(strokeShare * 100).toFixed(3)}%` });
        expect(blendShare, `${label}: export contains the --map-customer fill (0.8 over land) ${rgbStr(blend)}`).toBeGreaterThan(0);
        expect(strokeShare, `${label}: export contains --map-customer-stroke ${rgbStr(cuStroke)}`).toBeGreaterThan(0);
      };

      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("button-download-map-png").click({ timeout: T })]);
      const file = await download.path();
      expect(file, "download has a local path").toBeTruthy();
      const png = fs.readFileSync(file!);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, "export-map-dark-download.png"), png); }
      await exportChecks("download", png);

      // Copy path (clipboard permission granted): read the PNG back out of the clipboard.
      await page.getByTestId("button-copy-map-clipboard").click({ timeout: T });
      await expect(page.getByText(/^Map copied to clipboard$/).first()).toBeVisible({ timeout: 30_000 });
      const clip = await page.evaluate(async () => {
        try {
          const items = await navigator.clipboard.read();
          const blob = await items[0].getType("image/png");
          const buf = new Uint8Array(await blob.arrayBuffer());
          let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          return btoa(s);
        } catch (e) { return `ERR:${(e as Error).message}`; }
      });
      expect(clip.startsWith("ERR:"), `clipboard read must succeed (permission granted): ${clip.slice(0, 80)}`).toBe(false);
      const cbuf = Buffer.from(clip, "base64");
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, "export-map-dark-clipboard.png"), cbuf);
      await exportChecks("clipboard", cbuf);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ALL 8 CHAPTERS x BOTH THEMES
  // ═════════════════════════════════════════════════════════════════════════
  test("detectors can fail: the legibility scan and the pixel sampler flag injected defects", async ({ page }) => {
    await scheme(page, "dark");
    await page.goto("/login");
    await expect(page.locator("form").first()).toBeVisible({ timeout: T });
    await expectTheme(page, true);
    const clean = await legibilityScan(page);
    expect(clean.findings).toEqual([]);
    expect(clean.whiteSurfaces).toEqual([]);
    await page.evaluate(() => {
      const bad = document.createElement("div");
      bad.id = "probe-white"; bad.textContent = "probe text";
      bad.style.cssText = "position:fixed;top:0;left:0;width:200px;height:60px;background:#fff;color:#eee";
      document.body.appendChild(bad);
    });
    const probed = await legibilityScan(page);
    expect(probed.whiteSurfaces.some(w => w.includes("probe-white") || w.startsWith("div")), "a white surface is reported").toBe(true);
    expect(probed.findings.some(f => f.text === "probe text"), "light text on white is reported").toBe(true);
    await page.evaluate(() => { document.getElementById("probe-white")!.remove(); const m = document.createElement("div"); m.id = "probe-mid"; m.textContent = "probe mid"; m.style.cssText = "position:fixed;top:0;left:0;background:#171914;color:#6b6f63;padding:8px"; document.body.appendChild(m); });
    const mid = await legibilityScan(page);
    expect(mid.findings.some(f => f.text === "probe mid" && f.ratio >= 3 && f.ratio < 4.5), "text between 3:1 and 4.5:1 is a finding unless --destructive/--text-faint").toBe(true);
    // pixel sampler: a 2x2 PNG of a known colour comes back as that colour
    const px = await page.evaluate(async () => { const c = document.createElement("canvas"); c.width = c.height = 2; const x = c.getContext("2d")!; x.fillStyle = "#1c1915"; x.fillRect(0, 0, 2, 2); return c.toDataURL("image/png").split(",")[1]; });
    expect((await paletteOf(page, Buffer.from(px, "base64"))).top[0].rgb).toEqual(DARK_TILE_RGB);
  });

  test("covers all 8 chapters", () => {
    expect(CHAPTERS).toHaveLength(8);
    for (const c of CHAPTERS) {
      expect(fs.existsSync(path.join(here, "fixtures/solved", `${c.modelId}.json`)), c.modelId).toBe(true);
      expect(c.modelId in SOLVED_MODEL_INPUTS, c.modelId).toBe(true);
    }
  });

  test("Landing, login, register in both themes: legible, no white surfaces in dark; screenshots", async ({ page }) => {
    test.setTimeout(120_000);
    await scheme(page, "light");
    for (const route of ["/login", "/register"]) {
      await page.goto(route);
      await expect(page.locator("form").first()).toBeVisible({ timeout: T });
      await shot(page, `page-${route.slice(1)}-light.png`);
      await scheme(page, "dark");
      await expectTheme(page, true);
      await settle(page);
      await shot(page, `page-${route.slice(1)}-dark.png`);
      const scan = await legibilityScan(page);
      expect(scan.checked, `${route}: text nodes measured`).toBeGreaterThan(5);
      expect(scan.findings, `${route}: text under 3:1 on its background`).toEqual([]);
      expect(scan.whiteSurfaces, `${route}: opaque white surfaces in dark`).toEqual([]);
      await scheme(page, "light");
    }
    await registerAndGoHome(page);
    await shot(page, "page-landing-light.png");
    await scheme(page, "dark");
    await expectTheme(page, true);
    await settle(page);
    await shot(page, "page-landing-dark.png");
    const scan = await legibilityScan(page);
    expect(scan.checked, "landing: text nodes measured").toBeGreaterThan(5);
    expect(scan.findings, "landing: text under 3:1").toEqual([]);
    expect(scan.whiteSurfaces, "landing: white surfaces in dark").toEqual([]);
    // Q8: the ink header band stays ink in BOTH themes.
    const band = page.locator(".scnd-band").first();
    const darkBand = await band.evaluate(el => getComputedStyle(el).backgroundColor);
    await scheme(page, "light");
    await expectTheme(page, false);
    expect(await band.evaluate(el => getComputedStyle(el).backgroundColor), "Q8: band ink in light").toBe(darkBand);
    expect(darkBand).toBe("rgb(24, 26, 21)");
  });

  for (const chapter of CHAPTERS) {
    test(`${chapter.modelId}: every tab in light and dark — legible, no white surfaces in dark, BandLabel swatches on the dark ramp; screenshots`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const { modelId } = chapter;
      await scheme(page, "light");
      await registerAndGoHome(page);
      const id = await createScenario(page, modelId);
      try {
        await seedSolvedResult(page, id, loadFixture(modelId));
        await openWorkspace(page, modelId, id);
        await expect(page.getByTestId("sidebar-output-output-map")).toBeEnabled({ timeout: T });
        const entries = await page.locator('[data-testid^="sidebar-input-"], [data-testid^="sidebar-output-"]').evaluateAll(els => els.map(e => e.getAttribute("data-testid")!).filter(t => !/sidebar-(input|output)-$/.test(t)));
        expect(entries.length, "sidebar entries").toBeGreaterThan(4);
        const inputEntries = entries.filter(e => e.startsWith("sidebar-input-"));
        const table = inputEntries.find(e => !/input-map|optimization-parameters/.test(e));
        expect(table, "a table input tab").toBeTruthy();
        const swatches: string[] = [];
        const tabsWithSwatches: string[] = [];
        const allowedHits: string[] = [];
        let scanned = 0;
        const allFindings: string[] = [];
        const allWhite: string[] = [];

        for (const entry of entries) {
          const slug = entry.replace("sidebar-", "");
          await scheme(page, "light");
          await expectTheme(page, false);
          const before = await page.evaluate(() => document.body.innerText);
          await page.getByTestId(entry).click({ timeout: T });
          await waitForTab(page, entry, before);
          await settle(page);
          const lightSw = await page.evaluate(() => Array.from(document.querySelectorAll("[data-band-swatch]")).map(e => getComputedStyle(e).backgroundColor));
          if (entry === "sidebar-input-input-map" || entry === "sidebar-output-output-map" || entry === table || entry === "sidebar-input-optimization-parameters" || entry === "sidebar-output-cost-summary") await shot(page, `chapter-${modelId}-${slug}-light.png`);

          await scheme(page, "dark");
          await expectTheme(page, true);
          await settle(page);
          if (entry === "sidebar-input-input-map" || entry === "sidebar-output-output-map" || entry === table || entry === "sidebar-input-optimization-parameters" || entry === "sidebar-output-cost-summary") await shot(page, `chapter-${modelId}-${slug}-dark.png`);
          await waitForTab(page, entry, null);
          const sw = await page.evaluate(() => Array.from(document.querySelectorAll("[data-band-swatch]")).map(e => getComputedStyle(e).backgroundColor));
          const darkRamp = await Promise.all([0, 1, 2, 3, 4].map(i => resolveColor(page, `var(--band-${i})`))).then(a => a.map(rgbStr));
          expect(darkRamp[0], "non-vacuity: the dark ramp differs from the light --band-0 (#6F952F)").not.toBe("rgb(111, 149, 47)");
          for (const s of sw) { expect([...darkRamp, "rgb(167, 139, 250)"], `${slug}: BandLabel swatch ${s} is a dark-ramp value`).toContain(s); swatches.push(s); }
          // BandLabel is used by ServiceStatsTab (every model that has the tab) and by JADE's Flows + Assignments tabs only (grep: components/BandLabel importers).
          if (/-service-stats$/.test(entry) || (modelId === "two-echelon-jade-us" && /-(flows|customer-assignments)$/.test(entry))) expect(sw.length, `${slug}: this tab renders BandLabel swatches`).toBeGreaterThan(0);
          if (sw.length) { expect(sw, `${slug}: control — swatches differ light vs dark`).not.toEqual(lightSw); tabsWithSwatches.push(`${slug}(${sw.length})`); }
          const scan = await legibilityScan(page);
          scanned += scan.checked;
          allFindings.push(...scan.findings.map(f => `${slug}: ${JSON.stringify(f)}`));
          allowedHits.push(...scan.allowed.map(a => `${slug}: ${a.why} ${a.ratio}:1 "${a.text}"`));
          allWhite.push(...scan.whiteSurfaces.map(w => `${slug}: ${w}`));
          // body background is the dark token on every tab
          expect(await bodyBg(page)).toBe("rgb(23, 25, 20)");
        }
        testInfo.annotations.push({ type: "scan", description: `${modelId}: ${entries.length} tabs, ${scanned} text nodes measured, ${swatches.length} BandLabel swatches; tabs carrying swatches: ${tabsWithSwatches.join(", ") || "none"}; allow-listed 3:1 hits: ${allowedHits.length}${allowedHits.length ? " (" + [...new Set(allowedHits)].slice(0, 6).join(" | ") + ")" : ""}` });
        expect(scanned, "text was actually measured").toBeGreaterThan(100);
        expect(allFindings, "text under 4.5:1 (3:1 for --destructive / --text-faint only) against its effective background in dark").toEqual([]);
        expect(allWhite, "opaque white surfaces left in dark").toEqual([]);
        // Cost Summary: the in-Workspace compare toggle exists and is dark.
        await page.getByTestId("sidebar-output-cost-summary").click({ timeout: T });
        await expect(page.getByTestId("cost-summary-bar")).toBeVisible({ timeout: T });
      } finally {
        await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
      }
    });
  }

  test("BandLabel swatches appear somewhere in the app (non-vacuity for the per-chapter swatch check)", async ({ page }) => {
    test.setTimeout(120_000);
    await scheme(page, "dark");
    await registerAndGoHome(page);
    const id = await createScenario(page, "two-echelon-jade-us");
    try {
      await seedSolvedResult(page, id, loadFixture("two-echelon-jade-us"));
      await openWorkspace(page, "two-echelon-jade-us", id, "sidebar-output-service-stats", "service-stats-tab").catch(() => {});
      await settle(page);
      expect(await page.locator("[data-band-swatch]").count(), "JADE Service Stats renders BandLabel swatches").toBeGreaterThan(0);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Q9 + shared controls
  // ═════════════════════════════════════════════════════════════════════════
  test("Q9 + shared controls in dark: Alert, destructive fill, disabled control, focus ring are legible; unused shadcn pieces are reported", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await scheme(page, "dark");
    await page.goto("/login");
    await expect(page.locator("form").first()).toBeVisible({ timeout: T });
    await expectTheme(page, true);

    // Alert (Q9: `dark:border-destructive`): trigger the real login error.
    await page.getByTestId("input-email").fill("nobody@example.com");
    await page.getByTestId("input-password").fill("wrong-password-1");
    await page.getByTestId("button-login").click();
    const alert = page.getByTestId("alert-login-error");
    await expect(alert).toBeVisible({ timeout: T });
    const al = await alert.evaluate(el => { const cs = getComputedStyle(el); const d = el.querySelector("[data-slot='alert-description'], div") as HTMLElement; return { bg: cs.backgroundColor, bd: cs.borderTopColor, fg: cs.color, dfg: getComputedStyle(d ?? el).color }; });
    const destructive = await resolveColor(page, "hsl(var(--destructive))");
    expect(parseRgb(al.bd), "dark:border-destructive is live (full-strength destructive border)").toEqual(destructive);
    const bg = parseRgb(await bodyBg(page));
    expect(contrast(parseRgb(al.fg), bg), "alert title text vs page (Q3 known exception: >= 3:1)").toBeGreaterThanOrEqual(3);
    testInfo.annotations.push({ type: "q3", description: `destructive text on dark bg = ${contrast(destructive, bg).toFixed(2)}:1 (documented 3.7:1 exception)` });
    await shot(page, "q9-alert-login-error-dark.png");

    // Destructive fill + its foreground (no live destructive <Button>: measured through the real utility classes)
    const fill = await page.evaluate(() => { const b = document.createElement("button"); b.className = "bg-destructive text-destructive-foreground"; document.body.appendChild(b); const cs = getComputedStyle(b); const r = { bg: cs.backgroundColor, fg: cs.color }; b.remove(); return r; });
    expect(contrast(parseRgb(fill.fg), parseRgb(fill.bg)), "destructive fill + foreground").toBeGreaterThanOrEqual(4.5);

    // Disabled control: the submit button while a request is pending is hard to hold; use the workspace's disabled Outputs entry instead (below). Here: a disabled primary Button utility probe.
    const dis = await page.evaluate(() => { const b = document.createElement("button"); b.disabled = true; b.className = "bg-primary text-primary-foreground disabled:opacity-50"; b.textContent = "x"; document.body.appendChild(b); const cs = getComputedStyle(b); const r = { op: cs.opacity, bg: cs.backgroundColor, fg: cs.color }; b.remove(); return r; });
    expect(+dis.op, "disabled control is visibly dimmed but not erased").toBeGreaterThan(0.3);
    expect(+dis.op).toBeLessThan(1);

    // Focus ring: Tab onto the email field and read the real ring.
    await page.getByTestId("input-email").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const ring = await page.getByTestId("input-email").evaluate(el => { const cs = getComputedStyle(el); return { shadow: cs.boxShadow, outline: cs.outlineColor, outlineStyle: cs.outlineStyle, bc: cs.borderTopColor }; });
    const ringRgb = await resolveColor(page, "hsl(var(--ring))");
    const channels = (c: string): Rgb[] => [...c.matchAll(/rgba?\(\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/g)].map(m => [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] as Rgb);
    const inShadow = channels(ring.shadow).some(c => near(c, ringRgb, 2));
    const outlineIsRing = ring.outlineStyle !== "none" && near(parseRgb(ring.outline), ringRgb, 2);
    expect(inShadow || outlineIsRing, `focus ring colour (dark --ring ${rgbStr(ringRgb)}) appears in box-shadow or outline-color: ${JSON.stringify(ring)}`).toBe(true);
    expect(contrast(ringRgb, bg), "focus ring colour vs dark page").toBeGreaterThanOrEqual(3);

    // Q9 reality check: which of the four shadcn pieces are rendered by the app at all?
    const src = path.resolve(here, "../src");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === "__tests__" || e.name === "ui" ? [] : walk(path.join(d, e.name))) : /\.tsx$/.test(e.name) ? [path.join(d, e.name)] : []);
    const files = walk(src);
    expect(files.length, "non-vacuity: source walk").toBeGreaterThan(50);
    const usage: Record<string, boolean> = {};
    for (const [name, re] of [["alert", /ui\/alert["']/], ["input-group", /ui\/input-group["']/], ["field", /ui\/field["']/], ["kbd", /ui\/kbd["']/]] as const) usage[name] = files.some(f => re.test(fs.readFileSync(f, "utf8")));
    testInfo.annotations.push({ type: "q9-usage", description: `rendered by the app (outside components/ui and tests): ${JSON.stringify(usage)}` });
    expect(usage.alert, "alert is live (checked above)").toBe(true);
  });

  test("disabled Outputs entries (no solved run) stay legible in dark", async ({ page }) => {
    test.setTimeout(90_000);
    await scheme(page, "dark");
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us");
    try {
      await openWorkspace(page, "p-median-us", id);
      const out = page.getByTestId("sidebar-output-output-map");
      await expect(out).toBeDisabled({ timeout: T });
      const c = await out.evaluate(el => { let op = 1; for (let e: Element | null = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity; return { fg: getComputedStyle(el).color, bg: getComputedStyle(document.querySelector('[data-testid="sidebar-tree"]')!).backgroundColor, op }; });
      expect(c.op, "disabled entry is dimmed, not invisible").toBeGreaterThan(0.3);
      expect(parseRgb(c.fg), "disabled entry text is not pure background").not.toEqual(parseRgb(c.bg));
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
    }
  });

  test("real in-chapter danger status + its action: the sidebar delete-scenario confirm is legible in dark (cancelled, nothing deleted)", async ({ page }) => {
    test.setTimeout(90_000);
    await scheme(page, "dark");
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us");
    try {
      await openWorkspace(page, "p-median-us", id);
      await page.getByTestId(`button-delete-scenario-${id}`).click({ force: true, timeout: T });
      const row = page.getByTestId(`sidebar-scenario-confirm-delete-${id}`);
      await expect(row).toBeVisible({ timeout: T });
      const m = await row.evaluate((el, cid) => ({
        bg: getComputedStyle(el).backgroundColor,
        msg: getComputedStyle(el.querySelector("span")!).color,
        del: getComputedStyle(document.querySelector(`[data-testid="button-confirm-delete-${cid}"]`)!).color,
      }), id);
      const bg = parseRgb(m.bg);
      expect(bg, "danger status background = --danger-bg").toEqual(await resolveColor(page, "var(--danger-bg)", "backgroundColor"));
      expect(parseRgb(m.msg), "message colour = --danger").toEqual(await resolveColor(page, "var(--danger)"));
      expect(contrast(parseRgb(m.msg), bg), "danger message on danger-bg").toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseRgb(m.del), bg), "the destructive Delete action on danger-bg").toBeGreaterThanOrEqual(4.5);
      await shot(page, "status-danger-delete-confirm-dark.png");
      await page.getByTestId(`button-cancel-delete-${id}`).click({ timeout: T });
      await expect(row).toHaveCount(0);
      expect((await page.request.get(`/api/scenarios/${id}`)).status(), "the scenario still exists: nothing was deleted").toBe(200);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  test("light unchanged: bg-card is white, primary text is #48611E, tile pane has no filter, container is leaflet's own", async ({ page }) => {
    test.setTimeout(150_000);
    await scheme(page, "light");
    await registerAndGoHome(page);
    const id = await createScenario(page, "p-median-us");
    try {
      await openOutputMap(page, "p-median-us", id);
      await expectTheme(page, false);
      const sw = await page.evaluate(() => {
        const mk = (cls: string) => { const e = document.createElement("div"); e.className = cls; e.textContent = "x"; document.body.appendChild(e); const cs = getComputedStyle(e); const r = { bg: cs.backgroundColor, fg: cs.color }; e.remove(); return r; };
        const t = document.createElement("span"); t.style.color = "var(--text-primary)"; document.body.appendChild(t);
        const primaryText = { fg: getComputedStyle(t).color }; t.remove();
        return { card: mk("bg-card"), primaryText, primary: mk("bg-primary text-primary-foreground") };
      });
      expect(sw.card.bg, "bg-card").toBe("rgb(255, 255, 255)");
      expect(sw.primaryText.fg, "text-primary token").toBe("rgb(72, 97, 30)");
      expect(sw.primary.fg, "text on primary fill is white").toBe("rgb(255, 255, 255)");
      expect(rgbStr(await resolveColor(page, "var(--map-highlight)"))).toBe("rgb(72, 97, 30)");
      expect((await mapCss(page, OUT)).filter).toBe("none");
      const lightBand = await page.getByTestId("legend-band-0").evaluate(el => getComputedStyle(el).backgroundColor);
      expect(lightBand, "light --band-0 stays #6F952F").toBe("rgb(111, 149, 47)");
      expect(await bodyBg(page), "light --background (60 20% 99%, untouched by Phase 5) = #FDFDFC").toBe("rgb(253, 253, 252)");
      const scan = await legibilityScan(page, ".leaflet-container", 3);
      expect(scan.findings, "light: legible (3:1; the 4.5:1 bar is the dark scans' job)").toEqual([]);
      // The real UnitToggle's inactive segment is the white card in light.
      const seg = await page.getByTestId("unit-toggle-mi").evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, pressed: el.getAttribute("aria-pressed") }));
      const inactive = await page.locator('[data-testid^="unit-toggle-"][aria-pressed="false"]').first().evaluate(el => getComputedStyle(el).backgroundColor);
      expect(inactive, "light inactive unit segment = bg-card white").toBe("rgb(255, 255, 255)");
      expect(seg.pressed).not.toBeNull();
    } finally {
      await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
    }
  });
});
