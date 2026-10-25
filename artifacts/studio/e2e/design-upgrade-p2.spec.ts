/**
 * DU-2.9 — Phase 2 (Product polish) real-browser QA, all 8 chapters.
 *
 * jsdom has no layout, so sticky headers, pinned pagers, 24px hit areas, computed
 * button styles, tooltip typography and the Landing footer's scroll behaviour are
 * only observable here. Results are SEEDED (helpers/seedSolvedResult.ts +
 * fixtures/solved/*.json from DU-1.5): the real solver never runs.
 *
 * EVERY CHECK MUST BE ABLE TO FAIL (PR2-12):
 *   - each detector/predicate loop asserts its locator/element set is non-empty
 *     first (or, where a check does not apply to a chapter, asserts the set is
 *     ABSENT and says why in the EXPECT table below);
 *   - each detector has an injected-probe case in the "detectors can fail" test.
 *
 * `bandLabelSource.test.ts` scans this file for a literal "Band <digit>", so the
 * probe text is built with ["Band", "9"].join(" ").
 *
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type Locator } from "./fixtures";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS, SUPER_SAMPLE_PATH } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const shot = async (target: Page | Locator, name: string) => {
  if (SHOTS) await target.screenshot({ path: path.join(SHOTS, name) });
};

const loadFixture = (modelId: string) => JSON.parse(fs.readFileSync(path.join(here, "fixtures/solved", `${modelId}.json`), "utf8"));

// ── Per-chapter expectations ────────────────────────────────────────────────
// `true` => the surface exists and is measured (count > 0 is asserted).
// `false` => the surface must be ABSENT (count === 0 is asserted); the reason is the comment.
type Expect = {
  /** a DataTable whose wrapper scrolls (>= 1 table taller than its capped wrapper) */
  sticky: boolean;
  /** EXACT set of sidebar entries whose DataTable shows a pager (detected structurally); each is measured pinned */
  pagers: string[];
  /** entries whose SECTIONED wrapper (base + added tables in ONE scroll area, both on the same page) is measured sticky */
  sectionedSticky: string[];
  /** the Output Map narrative paragraph is present (count 1) */
  narrative: boolean;
  /** the narrative prints FULL money (not compact chips) */
  narrativeFullMoney: boolean;
  /** which sidebar entry hosts the reference-matrix loading skeleton, if any */
  skeleton: { entry: string; testid: string; empty: string; routes: string[] } | null;
  /** the sidebar entry used for the "no skeleton" absence check when skeleton is null */
  noSkeletonEntry: string;
  wh: boolean;
  addedWh: boolean;
  customerBtn: boolean;
  superStatus: boolean;
  capCheckbox: boolean;
  /** p=3 => [1..5]; null => no P control */
  presets: number[] | null;
  distCells: boolean;
  moneyCells: boolean;
  chips: boolean;
  laneSegment: "leg" | "none";
};
const REF_ROUTES = ["**/api/**/reference-distances*", "**/api/**/reference-costs*"];
const EXPECT: Record<string, Expect> = {
  "p-median-us": {
    sticky: true, pagers: ["sidebar-input-customers", "sidebar-input-distances", "sidebar-output-customer-assignments"], sectionedSticky: ["sidebar-input-warehouses"], narrative: true, narrativeFullMoney: false,
    skeleton: { entry: "sidebar-input-distances", testid: "data-table-loading", empty: "distances-tab-empty", routes: REF_ROUTES },
    noSkeletonEntry: "", wh: true, addedWh: true, customerBtn: true, superStatus: false, capCheckbox: false,
    presets: [1, 2, 3, 4, 5], distCells: true, moneyCells: false, chips: false, laneSegment: "none",
  },
  "max-coverage-us": {
    sticky: true, pagers: ["sidebar-input-customers", "sidebar-input-distances", "sidebar-output-customer-assignments"], sectionedSticky: ["sidebar-input-warehouses"], narrative: true, narrativeFullMoney: false,
    skeleton: { entry: "sidebar-input-distances", testid: "data-table-loading", empty: "distances-tab-empty", routes: REF_ROUTES },
    noSkeletonEntry: "", wh: true, addedWh: true, customerBtn: true, superStatus: false, capCheckbox: false,
    presets: [1, 2, 3, 4, 5], distCells: true, moneyCells: false, chips: false, laneSegment: "none",
  },
  // transport-coal: mines/stations carry no status buttons (no inactive/excluded concept) and no P control.
  "transport-coal": {
    sticky: true, pagers: [], sectionedSticky: [], narrative: true, narrativeFullMoney: false, /* 15 stations + 4 mines: one page each */
    skeleton: null, noSkeletonEntry: "sidebar-input-laneCosts",
    wh: false, addedWh: false, customerBtn: false, superStatus: false, capCheckbox: false,
    presets: null, distCells: true, moneyCells: false, chips: false, laneSegment: "none",
  },
  "p-median-brazil": {
    sticky: true, pagers: [], sectionedSticky: ["sidebar-input-warehouses"], narrative: true, narrativeFullMoney: false, /* 25 regions (and 25 warehouses): one page */
    skeleton: null /* Brazil is not referenceCapable (manifest) */, noSkeletonEntry: "sidebar-input-distances",
    wh: true, addedWh: true, customerBtn: true, superStatus: false, capCheckbox: false,
    presets: [5, 6, 7, 8, 9], distCells: true, moneyCells: false, chips: false, laneSegment: "none",
  },
  "delivery-teaching-us": {
    sticky: true, pagers: ["sidebar-input-customers", "sidebar-input-deliveryCosts", "sidebar-output-customer-assignments"], sectionedSticky: [], narrative: true, narrativeFullMoney: false,
    skeleton: { entry: "sidebar-input-deliveryCosts", testid: "delivery-costs-tab-loading", empty: "delivery-costs-tab-empty", routes: REF_ROUTES },
    noSkeletonEntry: "", wh: true, addedWh: false /* delivery-teaching has no added-warehouse concept */, customerBtn: true, superStatus: false, capCheckbox: false,
    presets: [1, 2, 3, 4, 5], distCells: true, moneyCells: false, chips: false, laneSegment: "none",
  },
  "two-echelon-gold-au": {
    sticky: true /* the 10 customers' table is 442px tall in a 432px wrapper: scrolls ~10px */, pagers: [], sectionedSticky: [], narrative: true, narrativeFullMoney: false, /* 10 customers: one page */
    skeleton: null /* leg distances come from the dataset, not a reference route */, noSkeletonEntry: "sidebar-input-distances",
    wh: true /* refineries reuse button-wh-* */, addedWh: false /* no added refineries in the seeded inputs */, customerBtn: true,
    superStatus: false, capCheckbox: false,
    presets: null /* gold-au has no P control */, distCells: true, moneyCells: false, chips: false, laneSegment: "leg",
  },
  "two-echelon-jade-us": {
    sticky: true, pagers: ["sidebar-input-customers", "sidebar-input-distances", "sidebar-output-customer-assignments"], sectionedSticky: ["sidebar-input-warehouses"], narrative: true, narrativeFullMoney: false,
    skeleton: { entry: "sidebar-input-distances", testid: "data-table-loading", empty: "jade-distances-tab-empty", routes: REF_ROUTES },
    noSkeletonEntry: "", wh: true, addedWh: true, customerBtn: true, superStatus: false, capCheckbox: true,
    presets: [1, 2, 3, 4, 5], distCells: true, moneyCells: true, chips: true, laneSegment: "leg",
  },
  // super-model: tables are capped since DU-2.10 (sticky measured), pagers detected structurally (SuperTableTab's pager has no testid); status toggles are `super-*-status-*`.
  "super-model": {
    sticky: true, pagers: ["sidebar-input-customers", "sidebar-input-demand", "sidebar-input-distances"], sectionedSticky: [], narrative: true, narrativeFullMoney: true,
    skeleton: null /* Super distances are model rows, no reference route */, noSkeletonEntry: "sidebar-input-distances",
    wh: false, addedWh: false, customerBtn: false, superStatus: true, capCheckbox: false,
    presets: [1, 2, 3, 4] /* the sample sets p=2 */, distCells: false /* Miles column is an editable draft input, no rendered distance text in a table */, moneyCells: true, chips: false, laneSegment: "leg",
  },
};

// ── Pure predicates (also exercised by the probe test) ──────────────────────
const MONEY_RE = /^\$[\d,]+$/;
const CHIP_RE = /^\$[\d.]+[KMB]$/;
const DIST_RE = /^[\d,]+(\.\d{1,2})?( (mi|km))?$/;
const BAND_DIGIT_RE = /\bBand \d/;
const TOOLTIP_RE = /^(Warehouse|Customer|Plant|Mine|Station|Refinery) · [^,]+, \S+ · \S+/;

// ── In-page detectors (self-contained: serialised into the browser) ─────────
/** Visible text nodes matching /\bBand \d/. */
async function bandTextHits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hits: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? "").trim();
      if (!/\bBand \d/.test(t)) continue;
      const el = n.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      hits.push(t.slice(0, 60));
    }
    return hits;
  });
}

type Small = { testid: string | null; w: number; h: number };
/** Elements in `locator` whose box is under 24x24 (subpixel tolerance 0.01). */
async function undersized(locator: Locator): Promise<Small[]> {
  return locator.evaluateAll(els =>
    els
      .map(e => {
        const r = e.getBoundingClientRect();
        return { testid: e.getAttribute("data-testid"), w: r.width, h: r.height };
      })
      .filter(b => b.w < 23.99 || b.h < 23.99),
  );
}

/** One entry per table inside a scroll wrapper (sectioned wrappers hold several tables). */
type StickyTable = { scrolled: number; tableTop: number; thOffset: number; rowMoved: number; thCount: number };
/**
 * For EACH table in `container`, scroll so the table is mid-view (table top + 60px) and report how far its first th
 * is from the container's top edge, and how far its first body row moved. A table the wrapper cannot scroll that far
 * into (shorter than 120px, or clamped by the end of the wrapper before the table's top) is not measurable and is skipped.
 */
const stickyProbe = async (container: Element): Promise<StickyTable[]> => {
  const c = container as HTMLElement;
  const frame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const out: StickyTable[] = [];
  for (const t of Array.from(c.querySelectorAll("table"))) {
    const th = t.querySelector("thead th");
    const row = t.querySelector("tbody tr");
    if (!th || !row) continue;
    c.scrollTop = 0;
    await frame();
    const cTop = c.getBoundingClientRect().top + c.clientTop;
    const tableTop = t.getBoundingClientRect().top - cTop; // in unscrolled coordinates
    if (t.getBoundingClientRect().height < 120) continue;
    const rowBefore = row.getBoundingClientRect().top;
    c.scrollTop = Math.min(c.scrollHeight - c.clientHeight, Math.max(0, tableTop) + 60);
    await frame();
    if (c.scrollTop <= tableTop) continue; // clamped before the table's own top: its th has not scrolled yet
    out.push({
      scrolled: c.scrollTop,
      tableTop,
      thCount: t.querySelectorAll("thead th").length,
      thOffset: th.getBoundingClientRect().top - cTop,
      // the first body row really moved up by the scrolled distance: content scrolled, th did not
      rowMoved: rowBefore - row.getBoundingClientRect().top,
    });
  }
  c.scrollTop = 0;
  return out;
};
const stickyHolds = (rs: StickyTable[]) => rs.length > 0 && rs.every(r => r.scrolled > 0 && r.thCount > 0 && Math.abs(r.rowMoved - r.scrolled) <= 1 && Math.abs(r.thOffset) <= 1);

type PagerResult = { found: boolean; inside: boolean; gap: number; inViewport: boolean };
/** The pager is STRUCTURAL: the wrapper's last element child whose text reads "Prev Page N of M Next" (TablePager). */
const pagerProbe = (container: Element, args: { to: number }): Promise<PagerResult> =>
  new Promise(resolve => {
    const c = container as HTMLElement;
    const pager = c.lastElementChild as HTMLElement | null;
    const isPager = !!pager && /^Prev Page \d+ of \d+ Next$/.test((pager.innerText ?? "").replace(/\s+/g, " ").trim());
    c.scrollTop = Math.min(args.to, c.scrollHeight - c.clientHeight);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!isPager) return resolve({ found: false, inside: false, gap: 0, inViewport: false });
        const visibleBottom = c.getBoundingClientRect().top + c.clientTop + c.clientHeight;
        const p = pager!.getBoundingClientRect();
        resolve({ found: true, inside: c.contains(pager), gap: visibleBottom - p.bottom, inViewport: p.top >= 0 && p.bottom <= window.innerHeight });
      }),
    );
  });
const pagerPinned = (r: PagerResult) => r.found && r.inside && Math.abs(r.gap) <= 2 && r.inViewport;

/**
 * Tag the scroll wrapper of every table under `rootSel` (default: the whole page): the nearest overflow-auto/scroll
 * ancestor, one entry per wrapper (a sectioned DataTable has several tables in ONE wrapper).
 * `capped` = that wrapper really scrolls. `uncapped` = the wrapper cannot scroll but an OUTER ancestor does
 * (so sticky thead/pager are trapped in a wrapper that never moves).
 */
type TableScroll = { mark: string; capped: boolean; uncapped: boolean; testid: string; hasPager: boolean; tables: number };
const tagScrollers = (rootSel: string | null): TableScroll[] => {
  const root: ParentNode = rootSel ? document.querySelector(rootSel)! : document;
  const scrollerOf = (from: HTMLElement | null): HTMLElement | null => {
    let p = from;
    while (p && p !== document.body && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    return p && p !== document.body ? p : null;
  };
  const byWrap = new Map<HTMLElement, TableScroll>();
  let n = 0;
  for (const t of Array.from(root.querySelectorAll("table"))) {
    if (!t.querySelector("thead th")) continue;
    const r = t.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const wrap = scrollerOf(t.parentElement);
    if (!wrap) continue;
    const seen = byWrap.get(wrap);
    if (seen) continue;
    const capped = wrap.scrollHeight - wrap.clientHeight > 4;
    let outer = scrollerOf(wrap.parentElement);
    let outerScrolls = false;
    while (outer) {
      if (outer.scrollHeight - outer.clientHeight > 4) { outerScrolls = true; break; }
      outer = scrollerOf(outer.parentElement);
    }
    const mark = `qa-${n++}`;
    wrap.setAttribute("data-qa-scroll", mark);
    const last = wrap.lastElementChild as HTMLElement | null;
    const hasPager = !!last && /^Prev Page \d+ of \d+ Next$/.test((last.innerText ?? "").replace(/\s+/g, " ").trim());
    byWrap.set(wrap, { mark, capped, uncapped: !capped && outerScrolls && wrap.getBoundingClientRect().height > (outer?.clientHeight ?? 0) * 0.5, testid: wrap.getAttribute("data-testid") ?? "", hasPager, tables: wrap.querySelectorAll("table").length });
  }
  return Array.from(byWrap.values());
};
const tagTableScrollers = (page: Page): Promise<TableScroll[]> => page.evaluate(tagScrollers, null);

/** Computed paint of a button: is its background `--primary`, and its top border width. */
async function buttonPaint(page: Page, button: Locator): Promise<{ isPrimary: boolean; border: number; bg: string }> {
  const primary = await page.evaluate(() => {
    const p = document.createElement("div");
    p.style.backgroundColor = "hsl(var(--primary))"; // --primary is an HSL triplet
    document.body.appendChild(p);
    const c = getComputedStyle(p).backgroundColor;
    p.remove();
    return c;
  });
  const { bg, border } = await button.evaluate(el => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: parseFloat(cs.borderTopWidth) };
  });
  return { isPrimary: bg === primary, border, bg };
}

/** Scroll `scroller` by up to 200px and report how far the element matching `sel` (inside it) moved. */
const footerDelta = (scroller: Element, sel: string): Promise<{ delta: number; scrollable: number }> =>
  new Promise(resolve => {
    const s = scroller as HTMLElement;
    const el = s.querySelector(sel)!;
    s.scrollTop = 0;
    const before = el.getBoundingClientRect().top;
    s.scrollTop = Math.min(200, s.scrollHeight - s.clientHeight);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => resolve({ delta: before - el.getBoundingClientRect().top, scrollable: s.scrollHeight - s.clientHeight })),
    );
  });

async function leafTexts(page: Page, scopeSel: string, startsWith: string): Promise<string[]> {
  return page.evaluate(
    ({ scopeSel, startsWith }) => {
      const root = document.querySelector(scopeSel) ?? document.body;
      const out: string[] = [];
      for (const el of Array.from(root.querySelectorAll("*"))) {
        if (el.children.length) continue;
        const t = (el.textContent ?? "").trim();
        if (!t.startsWith(startsWith)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push(t);
      }
      return out;
    },
    { scopeSel, startsWith },
  );
}

/** Text of every cell under a column whose header matches /distance/i (not band/cost/rate). */
async function distanceCellTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const heads = Array.from(table.querySelectorAll("thead th"));
      const idx = heads.map((h, i) => (/distance/i.test(h.textContent ?? "") && !/band|cost|rate|override/i.test(h.textContent ?? "") ? i : -1)).filter(i => i >= 0);
      if (!idx.length) continue;
      for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        const cells = Array.from(row.children);
        for (const i of idx) {
          const c = cells[i];
          if (!c || c.querySelector("input,select")) continue; // editable cell: its value is a draft, not a rendered number
          const t = (c.textContent ?? "").trim();
          if (t) out.push(t);
        }
      }
    }
    return out;
  });
}

// ── Page plumbing ───────────────────────────────────────────────────────────
async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-du2-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
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

/** Wait for the active tab's text to stop changing (tables and maps hydrate asynchronously). */
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

async function openWorkspace(page: Page, chapterPath: string, id: string): Promise<void> {
  await page.goto(`${chapterPath}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  // Input Map seeds first (Workspace didSeedTabRef; WFX-RACE) — wait for it before any sidebar click.
  await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: 15_000 });
}

async function openEntry(page: Page, entryTestId: string): Promise<void> {
  await page.getByTestId(entryTestId).click({ timeout: T });
  await settle(page);
}

/** `Type · City, ST · ID` */
const tooltipRe = (type: string) => new RegExp(`^${type} · [^,]+, \\S+ · \\S+`);

/**
 * Hover candidates in turn until a tooltip that starts with `${type} ·` shows, then require its FULL shape. Tooltips of other kinds
 * (a route line `A → B`, an overlapping marker) are skipped, so a kind passes only on its OWN type word.
 */
async function hoverKind(page: Page, mapTestId: string, candidates: Locator, type: string): Promise<string> {
  const n = await candidates.count();
  expect(n, `${mapTestId}: ${type} candidates`).toBeGreaterThan(0);
  const seen: string[] = [];
  for (let i = 0; i < Math.min(n, 25); i++) {
    const el = candidates.nth(i);
    if (!(await el.boundingBox())) continue;
    await el.scrollIntoViewIfNeeded();
    await el.hover({ timeout: 5_000, force: true });
    const tip = page.locator(`[data-testid="${mapTestId}"] .leaflet-tooltip`).last();
    try {
      await expect(tip).toBeVisible({ timeout: 1_000 });
    } catch {
      continue;
    }
    const text = (await tip.innerText()).trim();
    seen.push(text);
    if (text.startsWith(`${type} ·`)) {
      expect(text, `${mapTestId}: ${type} tooltip shape`).toMatch(tooltipRe(type));
      return text;
    }
  }
  throw new Error(`${mapTestId}: no ${type} tooltip among ${Math.min(n, 25)} candidates; saw ${JSON.stringify(seen)}`);
}

/** Tooltip kinds per chapter, from EntityMarkers' own type labels (warehouseTypeLabel / customerTypeLabel). */
function tooltipKinds(modelId: string) {
  const wh = modelId === "transport-coal" ? "Mine" : modelId === "two-echelon-gold-au" ? "Refinery" : "Warehouse";
  const cs = modelId === "transport-coal" ? "Station" : "Customer";
  const hasPlants = modelId === "two-echelon-jade-us" || modelId === "super-model";
  return { wh, cs, hasPlants };
}

// ═══════════════════════════════════════════════════════════════════════════
test.describe("DU-2.9 — Phase 2 real-browser QA", () => {
  test.use({ actionTimeout: 15_000 });

  test("covers all 8 chapters, each with a fixture and an EXPECT row", () => {
    expect(CHAPTERS).toHaveLength(8);
    for (const c of CHAPTERS) {
      expect(fs.existsSync(path.join(here, "fixtures/solved", `${c.modelId}.json`)), c.modelId).toBe(true);
      expect(c.modelId in EXPECT, c.modelId).toBe(true);
      expect(c.modelId in SOLVED_MODEL_INPUTS, c.modelId).toBe(true);
    }
  });

  // ── PR2-12: every detector can fail ───────────────────────────────────────
  test("detectors can fail: each one flags an injected probe", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/login");
    await expect(page.locator("form").first()).toBeVisible({ timeout: T });

    // pure predicates
    expect(MONEY_RE.test("$1,234,567")).toBe(true);
    expect(MONEY_RE.test("$1,234.50")).toBe(false);
    expect(MONEY_RE.test("1234")).toBe(false);
    expect(CHIP_RE.test("$1.23B")).toBe(true);
    expect(CHIP_RE.test("$1,000K")).toBe(false);
    expect(CHIP_RE.test("$842K")).toBe(true);
    expect(DIST_RE.test("1,234.5 mi")).toBe(true);
    expect(DIST_RE.test("1.2345 mi")).toBe(false);
    expect(DIST_RE.test("12 miles")).toBe(false);
    expect(BAND_DIGIT_RE.test(["Band", "9"].join(" "))).toBe(true);
    expect(TOOLTIP_RE.test("Warehouse · Chicago, IL · WH-IL-CHI-01")).toBe(true);
    expect(TOOLTIP_RE.test("Warehouse · WH-IL-CHI-01 · Chicago, IL")).toBe(false); // the pre-DU-2.7 order

    // band text detector
    await page.evaluate(text => {
      const s = document.createElement("span");
      s.setAttribute("data-testid", "du2-band-probe");
      s.textContent = text;
      document.body.appendChild(s);
    }, ["Band", "9"].join(" "));
    expect((await bandTextHits(page)).length, "band detector must flag the probe").toBe(1);
    await page.evaluate(() => document.querySelector('[data-testid="du2-band-probe"]')?.remove());
    expect(await bandTextHits(page)).toEqual([]);

    // 24px target detector
    await page.evaluate(() => {
      for (const [id, px] of [["button-wh-probe-small", 10], ["button-wh-probe-ok", 24]] as const) {
        const b = document.createElement("button");
        b.setAttribute("data-testid", id);
        b.style.cssText = `display:block;width:${px}px;height:${px}px;padding:0;border:0`;
        document.body.appendChild(b);
      }
    });
    const small = await undersized(page.locator('[data-testid^="button-wh-probe-"]'));
    expect(small.map(s => s.testid)).toEqual(["button-wh-probe-small"]);
    await page.evaluate(() => document.querySelectorAll('[data-testid^="button-wh-probe-"]').forEach(e => e.remove()));

    // sticky / pager / footer detectors: a container with NON-sticky th, pager and footer
    await page.evaluate(() => {
      const c = document.createElement("div");
      c.setAttribute("data-testid", "du2-scroll-probe");
      c.style.cssText = "height:120px;overflow:auto;position:relative";
      let rows = "";
      for (let i = 0; i < 60; i++) rows += `<tr><td>row ${i}</td></tr>`;
      c.innerHTML = `<table><thead><tr><th>H</th></tr></thead><tbody>${rows}</tbody></table><div data-testid="du2-pager-probe">Prev Page 1 of 3 Next</div>`;
      document.body.prepend(c);
    });
    const sc = page.getByTestId("du2-scroll-probe");
    const probeSticky = await sc.evaluate(stickyProbe);
    expect(stickyHolds(probeSticky), `sticky detector must reject a non-sticky th: ${JSON.stringify(probeSticky)}`).toBe(false);
    const probePager = await sc.evaluate(pagerProbe, { to: 0 });
    expect(probePager.found, "pager detector must find a last-child 'Prev Page N of M Next' element").toBe(true);
    expect(pagerPinned(probePager), `pager detector must reject a non-pinned pager: ${JSON.stringify(probePager)}`).toBe(false);
    // ...and a pager made sticky is accepted, a table with sticky th is accepted
    await page.evaluate(() => {
      const c = document.querySelector('[data-testid="du2-scroll-probe"]') as HTMLElement;
      c.querySelectorAll("th").forEach(th => { (th as HTMLElement).style.cssText = "position:sticky;top:0;background:#fff"; });
      (c.lastElementChild as HTMLElement).style.cssText = "position:sticky;bottom:0;background:#fff";
    });
    const okSticky = await sc.evaluate(stickyProbe);
    expect(stickyHolds(okSticky), `sticky detector must accept a sticky th: ${JSON.stringify(okSticky)}`).toBe(true);
    const okPager = await sc.evaluate(pagerProbe, { to: 0 });
    expect(pagerPinned(okPager), `pager detector must accept a pinned pager: ${JSON.stringify(okPager)}`).toBe(true);
    // not-a-pager last child is not found
    await page.evaluate(() => { (document.querySelector('[data-testid="du2-scroll-probe"]')!.lastElementChild as HTMLElement).textContent = "footnote"; });
    expect((await sc.evaluate(pagerProbe, { to: 0 })).found, "pager detector must not accept arbitrary last-child text").toBe(false);

    // capped/uncapped classification (tagScrollers): an overflow:auto wrapper that cannot scroll inside a scrolling pane
    // is UNCAPPED; a max-height wrapper that really scrolls is CAPPED
    await page.evaluate(() => {
      const rows = (n: number) => Array.from({ length: n }, (_, i) => `<tr><td>r${i}</td></tr>`).join("");
      const root = document.createElement("div");
      root.setAttribute("data-testid", "du2-class-probe");
      root.innerHTML =
        `<div style="height:150px;overflow:auto"><div data-testid="p-uncapped" style="overflow:auto"><table><thead><tr><th>H</th></tr></thead><tbody>${rows(40)}</tbody></table></div></div>` +
        `<div style="height:150px;overflow:auto"><div data-testid="p-capped" style="max-height:100px;overflow:auto"><table><thead><tr><th>H</th></tr></thead><tbody>${rows(40)}</tbody></table></div></div>`;
      document.body.appendChild(root);
    });
    const classes = await page.evaluate(tagScrollers, '[data-testid="du2-class-probe"]');
    const byId = Object.fromEntries(classes.map(c => [c.testid, c]));
    expect(byId["p-uncapped"], "uncapped probe must be flagged uncapped").toMatchObject({ capped: false, uncapped: true });
    expect(byId["p-capped"], "capped probe must be classified capped").toMatchObject({ capped: true, uncapped: false });
    // footer-move detector: a sticky element does not move, a normal one does
    await page.evaluate(() => {
      const s = document.createElement("div");
      s.setAttribute("data-testid", "du2-scroller-probe");
      s.style.cssText = "height:50px;overflow:auto;position:relative";
      s.innerHTML = `<div style="height:400px"></div><div data-testid="du2-moving-probe" style="height:10px"></div><div data-testid="du2-pinned-probe" style="position:sticky;bottom:0;height:10px"></div>`;
      document.body.appendChild(s);
    });
    const scr = page.getByTestId("du2-scroller-probe");
    const pinned = await scr.evaluate(footerDelta, '[data-testid="du2-pinned-probe"]');
    const moved = await scr.evaluate(footerDelta, '[data-testid="du2-moving-probe"]');
    expect(pinned.scrollable).toBeGreaterThan(20);
    expect(Math.abs(pinned.delta), "a pinned element must register as NOT moving").toBeLessThan(1);
    expect(moved.delta, "a normal element must register as moving").toBeGreaterThan(50);

    // primary-vs-outline classifier
    await page.evaluate(() => {
      const mk = (id: string, css: string) => {
        const b = document.createElement("button");
        b.setAttribute("data-testid", id);
        b.style.cssText = css;
        b.textContent = id;
        document.body.appendChild(b);
      };
      mk("du2-primary-probe", "background-color:hsl(var(--primary));border:0");
      mk("du2-outline-probe", "background-color:transparent;border:1px solid #999");
    });
    const pp = await buttonPaint(page, page.getByTestId("du2-primary-probe"));
    const op = await buttonPaint(page, page.getByTestId("du2-outline-probe"));
    expect(pp.isPrimary, "classifier must call a --primary button primary").toBe(true);
    expect(op.isPrimary, "classifier must call an outline button non-primary").toBe(false);
    expect(op.border).toBeGreaterThanOrEqual(1);
    expect(pp.border).toBe(0);

    // header-box containment: an element overflowing the header's right edge is flagged
    const outside = await page.evaluate(() => {
      const h = document.createElement("div");
      h.style.cssText = "position:relative;width:100px;height:20px";
      const a = document.createElement("div");
      a.style.cssText = "position:absolute;left:80px;width:60px;height:10px";
      h.appendChild(a);
      document.body.appendChild(h);
      return a.getBoundingClientRect().right > h.getBoundingClientRect().right + 1;
    });
    expect(outside, "containment predicate must flag an overflowing child").toBe(true);
  });

  // ── Landing footer ────────────────────────────────────────────────────────
  test("Landing footer scrolls with the page (hero page)", async ({ page }) => {
    test.setTimeout(60_000);
    await registerAndGoHome(page);
    await page.setViewportSize({ width: 1280, height: 480 });
    const footer = page.getByTestId("homepage-credit-footer");
    await expect(footer).toBeVisible({ timeout: T });
    // The scroller is the footer's nearest scrolling ancestor (the hero <main>).
    const handle = await footer.evaluateHandle(el => {
      let p = el.parentElement;
      while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
      return p;
    });
    const scroller = handle.asElement();
    expect(scroller, "footer must have a scrolling ancestor").not.toBeNull();
    const r = await scroller!.evaluate(footerDelta, '[data-testid="homepage-credit-footer"]');
    expect(r.scrollable, "the page must be scrollable at 480px height or the check is vacuous").toBeGreaterThan(20);
    expect(r.delta, "footer top must change as the page scrolls").toBeGreaterThan(10);
    await shot(page, "landing-footer-scrolled.png");
    await scroller!.evaluate(el => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight; });
    await expect(footer).toBeInViewport({ timeout: T });
    await shot(page, "landing-footer-bottom.png");
    // Unauthenticated-style /login keeps its own footer; not part of this check.
  });

  // ── Per chapter ───────────────────────────────────────────────────────────
  for (const chapter of CHAPTERS) {
    test(`${chapter.modelId} (${chapter.path}) — header, tables, targets, labels, formatters, buttons, maps, presets`, async ({ page }) => {
      test.setTimeout(240_000);
      const { modelId } = chapter;
      const ex = EXPECT[modelId];
      const inputs: Record<string, unknown> = { ...SOLVED_MODEL_INPUTS[modelId] };
      if (ex.addedWh) inputs.addedWarehouses = [ADDED_WH];
      const fixture = loadFixture(modelId);

      await registerAndGoHome(page);
      const id = await createScenario(page, modelId, inputs, `E2E DU-2.9 ${modelId}`);
      const siblingId = await createScenario(page, modelId, SOLVED_MODEL_INPUTS[modelId], `E2E DU-2.9 sibling ${modelId}`);
      try {
        await seedSolvedResult(page, id, fixture);
        await seedSolvedResult(page, siblingId, fixture);
        await openWorkspace(page, chapter.path, id);

        const inputEntries = await page.locator('[data-testid^="sidebar-input-"]').evaluateAll(els => els.map(e => e.getAttribute("data-testid")!));
        const outputEntries = await page.locator('[data-testid^="sidebar-output-"]').evaluateAll(els => els.map(e => e.getAttribute("data-testid")!));
        expect(inputEntries.length, "sidebar input entries").toBeGreaterThan(0);
        expect(outputEntries.length, "sidebar output entries").toBeGreaterThan(0);

        // ── 1. Header: title === chapter.title, actions not truncated at 1024px ──
        await expect(page.getByTestId("workspace-chapter-title")).toHaveText(chapter.title, { timeout: T });
        await expect(page.getByTestId("workspace-chapter-subtitle")).toBeVisible();
        await page.setViewportSize({ width: 1024, height: 720 });
        const header = page.getByTestId("workspace-page").locator("header").first();
        await expect(header).toBeVisible();
        const runBtn = page.getByTestId("button-run-optimizer");
        await expect(runBtn).toBeVisible();
        const hb = (await header.boundingBox())!;
        const rb = (await runBtn.boundingBox())!;
        expect(rb.x + rb.width, "Run Optimizer right edge inside the header box").toBeLessThanOrEqual(hb.x + hb.width + 1);
        expect(rb.x, "Run Optimizer left edge inside the viewport").toBeGreaterThanOrEqual(0);
        expect(await runBtn.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "Run Optimizer label not clipped").toBe(true);
        await expect(page.getByTestId("workspace-chapter-title")).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 720 });

        // ── 2. Input Map: LayerCheckbox rows are >= 24px; tooltip shape; map controls ──
        const layerRows = page.locator('[data-testid="input-map-tab"] [role="checkbox"][data-testid^="toggle-layer-"]');
        expect(await layerRows.count(), "input-map LayerCheckbox rows").toBeGreaterThan(0);
        expect(await undersized(layerRows), "input-map LayerCheckbox rows").toEqual([]);
        expect(await undersized(layerRows.locator("span").first()), "LayerCheckbox box wrapper").toEqual([]);
        const kinds = tooltipKinds(modelId);
        const inMap = '[data-testid="input-map-tab"] .leaflet-marker-icon';
        await hoverKind(page, "input-map-tab", page.locator(`${inMap}.wh-marker`), kinds.wh);
        await hoverKind(page, "input-map-tab", page.locator(`${inMap}.cs-marker`), kinds.cs);
        if (kinds.hasPlants) await hoverKind(page, "input-map-tab", page.locator(`${inMap}.pl-marker`), "Plant");
        if (modelId === "p-median-us") await shot(page, "tooltip-input-map-p-median-us.png");

        // ── 3. Visit every input + output entry, accumulating measurements ──
        const acc = { sticky: 0, sectionedSticky: [] as string[], sectionedMeasured: {} as Record<string, number>, pagers: [] as string[], wh: 0, addedWh: 0, cust: 0, superStatus: 0, cap: 0, uncapped: [] as string[], bandHits: [] as string[], dist: [] as string[], unitDist: [] as string[], small: [] as string[] };
        const measureTables = async (entry: string) => {
          // sticky header (every table in the wrapper, sectioned wrappers hold several) + pinned pager (structural)
          const tables = await tagTableScrollers(page);
          for (const t of tables) {
            if (t.uncapped) acc.uncapped.push(`${entry} (${t.testid || "wrapper"})`);
            const wrap = page.locator(`[data-qa-scroll="${t.mark}"]`);
            if (t.capped) {
              const s = await wrap.evaluate(stickyProbe);
              expect(stickyHolds(s), `${entry}: every measurable th must stay at the container top (${t.tables} table(s)): ${JSON.stringify(s)}`).toBe(true);
              acc.sticky++;
              if (t.tables > 1) { acc.sectionedSticky.push(entry); acc.sectionedMeasured[entry] = s.length; }
              if (modelId === "p-median-us" && entry === "sidebar-input-customers") {
                await wrap.evaluate(el => { (el as HTMLElement).scrollTop = 300; });
                await shot(page, "customers-sectioned-mid-scroll-p-median-us.png");
              }
            }
            if (t.hasPager) {
              for (const scrollTo of [0, 300, 99999]) {
                const pr = await wrap.evaluate(pagerProbe, { to: scrollTo });
                expect(pagerPinned(pr), `${entry}: pager pinned at scrollTop=${scrollTo}: ${JSON.stringify(pr)}`).toBe(true);
              }
              acc.pagers.push(entry);
            }
          }
        };
        const inspect = async (entry: string) => {
          // band text (everywhere except the band EDITOR on Optimization Parameters, which edits boundaries)
          if (entry !== "sidebar-input-optimization-parameters") acc.bandHits.push(...(await bandTextHits(page)).map(h => `${entry}: ${h}`));
          // targets
          const sets: [keyof typeof acc, Locator][] = [
            ["wh", page.locator('[data-testid^="button-wh-"]')],
            ["addedWh", page.locator('[data-testid^="button-added-wh-"]')],
            ["cust", page.locator('[data-testid^="button-customer-"]')],
            ["superStatus", page.locator('[data-testid^="super-"][data-testid*="-status-"]')],
          ];
          for (const [key, loc] of sets) {
            const n = await loc.count();
            (acc[key] as number) += n;
            if (n) acc.small.push(...(await undersized(loc)).map(s => `${entry} ${s.testid} ${s.w}x${s.h}`));
          }
          const cap = page.locator('[data-testid^="checkbox-capability-"]');
          const capN = await cap.count();
          acc.cap += capN;
          if (capN) {
            acc.small.push(...(await undersized(cap.locator("xpath=ancestor::label[1]"))).map(s => `${entry} capability label ${s.w}x${s.h}`));
          }
          await measureTables(entry);
          // distance cells
          acc.dist.push(...(await distanceCellTexts(page)));
          acc.unitDist.push(...(await leafTexts(page, '[data-testid="tab-content-region"]', "")).filter(t => t.length <= 24 && /^[\d,.-]/.test(t) && / (mi|km)$/.test(t) && !/[≤>–]/.test(t)));
        };

        for (const entry of [...inputEntries, ...outputEntries]) {
          await openEntry(page, entry);
          await inspect(entry);
          if (modelId === "two-echelon-jade-us" && entry === "sidebar-output-customer-assignments") {
            // BandLabel cell row: a real row, swatch + dash + range text.
            const row = page.locator('[data-testid^="row-jadeassignment-"]').first();
            if ((await row.count()) > 0) await shot(row, "bandlabel-row-jade-assignments.png");
          }
        }

        // sticky / pager / targets / cells: stated presence or stated absence
        if (ex.sticky) expect(acc.sticky, "capped scrolling tables measured").toBeGreaterThan(0);
        else expect(acc.sticky, "no capped scrolling tables on this chapter").toBe(0);
        expect([...new Set(acc.pagers)].sort(), "entries with a (pinned) pager").toEqual([...ex.pagers].sort());
        expect([...new Set(acc.sectionedSticky)].sort(), "entries whose sectioned wrapper was measured sticky").toEqual([...ex.sectionedSticky].sort());
        // With these fixtures the added table's top sits below the wrapper's max scrollTop, so exactly ONE th (the base table's) is
        // measurable inside the shared scroller; per-section stacking is not verifiable here and is not claimed.
        for (const e of ex.sectionedSticky) expect(acc.sectionedMeasured[e], `${e}: measured tables in the sectioned wrapper`).toBe(1);
        for (const [flag, n, label] of [[ex.wh, acc.wh, "button-wh-*"], [ex.addedWh, acc.addedWh, "button-added-wh-*"], [ex.customerBtn, acc.cust, "button-customer-*"], [ex.superStatus, acc.superStatus, "super status buttons"], [ex.capCheckbox, acc.cap, "capability checkboxes"]] as const) {
          if (flag) expect(n, `${label} present`).toBeGreaterThan(0);
          else expect(n, `${label} absent on this chapter`).toBe(0);
        }
        expect(acc.small, "every hit area >= 24x24").toEqual([]);
        expect(acc.bandHits, "no visible band-index text").toEqual([]);
        // Output tables inside a wrapper that never scrolls: their sticky thead/pager cannot stick.
        expect(acc.uncapped, "tables whose scroll wrapper cannot scroll while an outer pane does (sticky thead/pager inert)").toEqual([]);
        if (ex.distCells) {
          expect(acc.dist.length, "distance cells measured").toBeGreaterThan(0);
          expect(acc.dist.filter(t => !DIST_RE.test(t)), "distance cell shape").toEqual([]);
        }

        expect(acc.unitDist.length, "unit-suffixed distance texts measured").toBeGreaterThan(0);
        expect(acc.unitDist.filter(t => !DIST_RE.test(t)), "unit-suffixed distance shape").toEqual([]);

        // ── 4. Formatters on the Solution Summary + narrative ──
        await openEntry(page, "sidebar-output-cost-summary");
        // presence anchor: the Solution Summary really rendered its objective before any absence is asserted
        await expect(page.getByTestId("cost-summary-value-objective")).toBeVisible({ timeout: T });
        const money = await leafTexts(page, '[data-testid="tab-content-region"]', "$");
        const cellMoney = money.filter(t => /^\$[\d,.]+$/.test(t));
        if (ex.moneyCells) {
          expect(cellMoney.length, "money cells measured").toBeGreaterThan(0);
          expect(cellMoney.filter(t => !MONEY_RE.test(t)), "money cell shape").toEqual([]);
        } else {
          // distance-objective chapters print no currency amounts in the Solution Summary
          expect(cellMoney, "no money cells on a distance-objective chapter").toEqual([]);
        }

        // ── 5. Output Map: legend range text, lane-colour control, narrative chips, tooltip ──
        await openEntry(page, "sidebar-output-output-map");
        await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: T });
        const legendSwatches = page.locator('[data-testid^="legend-band-"]');
        expect(await legendSwatches.count(), "legend rows").toBeGreaterThan(0);
        const legendTexts = (await legendSwatches.locator("xpath=../following-sibling::span[1]").allInnerTexts()).map(t => t.trim());
        expect(legendTexts.length, "legend range texts").toBe(await legendSwatches.count());
        for (const t of legendTexts) expect(t, "legend row reads a range").toMatch(/^(≤ [\d,.]+ (mi|km)|[\d,.]+–[\d,.]+ (mi|km)|> [\d,.]+ (mi|km)|All distances)$/);
        // The Output Map does not use LayerCheckbox (mapControls.tsx): that set is ABSENT here. Its layer toggles are
        // Radix Checkbox + Label pairs (`checkbox-toggle-*`), wrapped in h-6 w-6 labels since DU-2.10, so the label hit area is asserted.
        expect(await page.locator('[data-testid="output-map-tab"] div[role="checkbox"]').count(), "output map has no LayerCheckbox rows").toBe(0);
        const bareToggles = page.locator('[data-testid^="checkbox-toggle-"]');
        expect(await bareToggles.count(), "output-map layer toggles").toBeGreaterThan(0);
        expect(await undersized(bareToggles.locator("xpath=ancestor::label[1]")), "output-map toggle hit areas").toEqual([]);
        const seg = page.getByTestId("segmented-lane-colour");
        await expect(seg).toBeVisible({ timeout: T });
        await expect(page.getByTestId("segment-lane-colour-band")).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId(`segment-lane-colour-${ex.laneSegment}`)).toBeVisible();
        await expect(page.getByTestId(`segment-lane-colour-${ex.laneSegment === "leg" ? "none" : "leg"}`)).toHaveCount(0);
        if (modelId === "two-echelon-jade-us") await shot(seg, "lane-colour-control-jade.png");
        const narrative = page.getByTestId("output-map-narrative-summary");
        if (ex.narrative) await expect(narrative, "narrative paragraph present").toHaveCount(1, { timeout: T });
        else await expect(narrative).toHaveCount(0);
        const narrativeText = ex.narrative ? await narrative.innerText() : "";
        if (ex.chips) {
          const tokens = narrativeText.match(/\$[\d.,]+[KMB]/g) ?? [];
          expect(tokens.length, "compact money chips in the narrative").toBeGreaterThan(0);
          expect(tokens.filter(t => !CHIP_RE.test(t)), "chip shape").toEqual([]);
        } else if (ex.narrativeFullMoney) {
          // super prints FULL money in its narrative
          const tokens = narrativeText.match(/\$[\d,]+(?:\.\d+)?/g) ?? [];
          expect(tokens.length, "full money tokens in the narrative").toBeGreaterThan(0);
          expect(tokens.filter(t => !MONEY_RE.test(t)), "full money shape").toEqual([]);
        } else {
          // distance-objective narratives carry no money at all
          expect(narrativeText.match(/\$[\d.,]+[KMB]?/g) ?? [], "no money in a distance narrative").toEqual([]);
        }
        const outPane = '[data-testid="output-map-tab"] .leaflet-marker-pane .leaflet-marker-icon';
        // transport-coal's sites are not triangles (mines/stations use their own icons): all site icons are candidates and only a `Mine ·` tooltip counts.
        const whOut = modelId === "transport-coal" ? page.locator(outPane) : page.locator(`${outPane}:has(svg polygon[points="12,2 22,20 2,20"])`);
        await hoverKind(page, "output-map-tab", whOut, kinds.wh);
        if (kinds.hasPlants) await hoverKind(page, "output-map-tab", page.locator(`${outPane}:has(svg polygon[fill="var(--map-plant)"])`), "Plant");
        // customers are overlay circle paths shared with the route lines: route tooltips are skipped, a customer one must match.
        await hoverKind(page, "output-map-tab", page.locator('[data-testid="output-map-tab"] .leaflet-overlay-pane path.leaflet-interactive'), kinds.cs);
        if (modelId === "p-median-us") await shot(page, "tooltip-output-map-p-median-us.png");
        // map details card: name + ID are separate nodes, no City row
        expect(await bandTextHits(page)).toEqual([]);

        // ── 6. Parameters: helper text, P presets, Solve dialog helper text ──
        await openEntry(page, "sidebar-input-optimization-parameters");
        await expect(page.getByTestId("text-help-gap")).toBeVisible({ timeout: T });
        await expect(page.getByTestId("text-help-time-limit")).toBeVisible();
        const presets = page.locator('[data-testid^="button-p-quick-"]');
        if (ex.presets) {
          const got = (await presets.evaluateAll(els => els.map(e => Number((e.getAttribute("data-testid") ?? "").replace("button-p-quick-", "")))));
          expect(got.length, "P preset buttons").toBeGreaterThan(0);
          expect(got).toEqual(ex.presets);
          expect(await undersized(presets), "P preset hit areas").toEqual([]);
        } else {
          expect(await presets.evaluateAll(els => els.map(e => e.getAttribute("data-testid"))), "no P control on this chapter").toEqual([]);
        }
        // computed paint: the tab's own Solve is outline
        const tabSolve = page.getByTestId("button-tab-solve");
        await expect(tabSolve).toBeVisible({ timeout: T });
        const ts = await buttonPaint(page, tabSolve);
        expect(ts.isPrimary, `button-tab-solve bg ${ts.bg}`).toBe(false);
        expect(ts.border).toBeGreaterThanOrEqual(1);
        const rp = await buttonPaint(page, page.getByTestId("button-run-optimizer"));
        expect(rp.isPrimary, `button-run-optimizer bg ${rp.bg}`).toBe(true);
        // Solve dialog helper text (prefixed testids)
        await page.getByTestId("button-run-optimizer").click({ timeout: T });
        await expect(page.getByTestId("solve-dialog-text-help-gap")).toBeVisible({ timeout: T });
        await expect(page.getByTestId("solve-dialog-text-help-time-limit")).toBeVisible();
        await page.getByTestId("solve-dialog-cancel").click({ timeout: T });
        await expect(page.getByTestId("solve-dialog-text-help-gap")).toHaveCount(0, { timeout: T });

        // ── 7. Compare toggle is outline (needs a same-model sibling) ──
        await openEntry(page, "sidebar-output-cost-summary");
        const cmp = page.getByTestId("button-toggle-compare");
        await expect(cmp).toBeVisible({ timeout: T });
        const cp = await buttonPaint(page, cmp);
        expect(cp.isPrimary, `button-toggle-compare bg ${cp.bg}`).toBe(false);
        expect(cp.border).toBeGreaterThanOrEqual(1);

        // ── 8. Loading skeleton (delayed reference routes) ──
        let delayed = 0;
        for (const pattern of REF_ROUTES) {
          await page.route(pattern, async route => {
            delayed++;
            await new Promise(r => setTimeout(r, 2_500));
            await route.fallback();
          });
        }
        await page.reload();
        await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: 15_000 });
        if (ex.skeleton) {
          await page.getByTestId(ex.skeleton.entry).click({ timeout: T });
          const sk = page.getByTestId(ex.skeleton.testid);
          await expect(sk, "skeleton visible while the reference matrix loads").toBeVisible({ timeout: 2_000 });
          expect(await page.getByTestId(ex.skeleton.empty).count(), "empty-state copy absent while loading").toBe(0);
          await expect(sk).toHaveCount(0, { timeout: 20_000 });
          expect(delayed, "the delayed route was actually hit").toBeGreaterThan(0);
        } else {
          // this chapter's distance surface has no reference route: no skeleton may appear
          await page.getByTestId(ex.noSkeletonEntry).click({ timeout: T });
          await settle(page);
          expect(await page.locator('[data-testid="data-table-loading"], [data-testid$="-tab-loading"]').count(), "no skeleton on a chapter without a reference matrix").toBe(0);
          expect(delayed, "no reference request is made on this chapter").toBe(0);
        }
        await page.unroute(REF_ROUTES[0]);
        await page.unroute(REF_ROUTES[1]);

        // ── 9. Stale banner CTA is outline ──
        // The Output Map entry is disabled while a scenario is stale, so the banner is only reachable by a
        // fresh -> stale TRANSITION while the Output Map is open: open it fresh, flip the stubbed GET to
        // stale:true, and make React Query refetch via a visibilitychange (window-focus refetch).
        let staleNow = false;
        await page.route(`**/api/scenarios/${id}`, async route => {
          if (route.request().method() !== "GET") return route.fallback();
          const response = await route.fetch();
          const body = await response.json();
          await route.fulfill({ response, json: { ...body, result: fixture, stale: staleNow, solvedAt: new Date().toISOString() } });
        });
        await page.reload();
        await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: 15_000 });
        await page.getByTestId("sidebar-output-output-map").click({ timeout: T });
        await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: T });
        staleNow = true;
        await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
        const banner = page.getByTestId("button-stale-banner-run-optimizer");
        await expect(banner).toBeVisible({ timeout: 15_000 });
        const bp = await buttonPaint(page, banner);
        expect(bp.isPrimary, `stale banner CTA bg ${bp.bg}`).toBe(false);
        expect(bp.border).toBeGreaterThanOrEqual(1);
        expect(await bandTextHits(page)).toEqual([]);

        // ── 10. Screenshots for the JADE flows header (mid-scroll) ──
        if (modelId === "two-echelon-jade-us") {
          await page.unroute(`**/api/scenarios/${id}`);
          await seedSolvedResult(page, id, fixture);
          await page.reload();
          await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: 15_000 });
          await openEntry(page, "sidebar-input-distances");
          const wrap = page.locator('[data-testid="jade-distances-tab"] [class*="max-h-"]').first();
          if ((await wrap.count()) > 0) {
            await wrap.evaluate(el => { (el as HTMLElement).scrollTop = 400; });
            await shot(page, "sticky-header-jade-distances-mid-scroll.png");
          }
          for (const entry of ["sidebar-output-customer-assignments", "sidebar-output-flows"]) {
            await openEntry(page, entry);
            const capped = (await tagTableScrollers(page)).filter(t => t.capped);
            expect(capped.length, `${entry}: capped table for the mid-scroll screenshot`).toBeGreaterThan(0);
            const w = page.locator(`[data-qa-scroll="${capped[0].mark}"]`);
            await w.evaluate(el => { (el as HTMLElement).scrollTop = 300; });
            await shot(page, `${entry.replace("sidebar-output-", "")}-mid-scroll-jade.png`);
          }
        }
      } finally {
        await page.request.delete(`/api/scenarios/${id}`);
        await page.request.delete(`/api/scenarios/${siblingId}`);
      }
    });
  }
});
