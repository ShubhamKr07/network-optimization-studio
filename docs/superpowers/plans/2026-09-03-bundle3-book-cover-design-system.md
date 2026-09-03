# Bundle 3 — Book-cover design system Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is executed by the **agent team**
> (frontend-engineer implementers + independent reviewer per task), the standing NOS execution model.
> Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-09-03-bundle3-book-cover-design-system-design.md` (rev 2).

**Goal:** Reskin all live surfaces (Landing, auth, Workspace) to the textbook-cover brand — paper/leaf-green/dark-band, Source Serif 4 + IBM Plex Sans/Mono, print radii + hairlines — by retargeting shadcn tokens at global `:root`, adding band/kicker markup, and close-matching the 6 studio components. Presentation only.

**Architecture:** One `index.css` foundation (Wave 1) that every later task consumes; band/chrome markup (Wave 2); studio-component close-match + mono-numbers + map palette (Wave 3). No behavior/contract/API/DB/solver change.

**Tech Stack:** React + Vite + Tailwind v4 (`@theme inline`) + shadcn/Radix, `artifacts/studio/src`.

## Global Constraints (bind every task, verbatim from spec)

- **Presentation only.** No behavior/contract/API/DB/solver change. No Python touched → `e2e_accuracy.py` not re-run.
- **Light theme only.** No dark-mode work on live surfaces.
- **Preserve every `data-testid`, `aria-*`, role, DOM structure, focus/keyboard behavior.** Close-match = class/token/inline-style changes only; never restructure a component or remove a test id.
- **Reference components (`docs/design-system/components/**`) are a visual spec, never imported.**
- **No per-model style branching on `modelId === "..."`** — capability/`chapters.ts`-driven only.
- **Fonts:** Source Serif 4 (display/headings/serif), IBM Plex Sans (UI/body), IBM Plex Mono (every number/stat/chip/kicker). All three serif-family vars set.
- **Copy additive-only.** Existing copy unchanged incl. Landing body `<h1>Labs</h1>`; the only additions are the band hero "Network Design Labs", the kicker "OPTIMIZATION STUDIO BY PROF. MICHAEL WATSON", and the auth author string. Footer "© Developed by hx1" unchanged.
- **`Studio.tsx` / `.studio-lab` / `--arc-*` are dead — do NOT touch** (all chapters `workspace: true`). Exception: `ObjectiveBar.tsx` (a live component that still reads `--arc-*`) is rewritten in T7.
- **Token-representation rule:** a var is EITHER an `H S% L%` triple (only via `hsl(var(--x))`, safe for `@theme`) OR a complete hex color (bare `var(--x)`). Never mix.
- **Final bundle gate** (run once at end, even though no backend/solver changed):
  ```bash
  pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
    && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
  ```

## Agent-team execution shape

Two-lane concurrency is moot here — every task is in `artifacts/studio`. So serialize on the shared
files and parallelize only file-disjoint tasks:

- **`index.css` is written by T1 ONLY.** Everything else consumes its tokens/utilities. No other task edits `index.css`.
- **Wave 1** (T1 → T2) must land before any Wave-2/3 task starts (they consume utilities/tokens).
- **Wave 2** (T3, T4, T5, T6) are file-disjoint → parallelizable after T1.
- **Wave 3** (T7, T8, T9, T10, T11): T7/T8/T10 are file-disjoint (different components) → parallelizable; **T9 (mono-numbers) touches many files that T7/T8/T10 also touch → run T9 LAST, after T7/T8/T10 merge**, to avoid collisions; T11 (Playwright) after all.
- Per task: `pnpm run typecheck && pnpm --filter studio test` green before commit. Controller re-runs the gate on the merged state. One task = one commit, message `[bundle3-Tn] <summary>`.

## File Structure

- `artifacts/studio/src/index.css` — T1 (foundation: tokens, fonts, radii, shadows, utilities).
- `artifacts/studio/src/__tests__/designTokens.contract.test.ts` — T2 (NEW, source-contract).
- `artifacts/studio/src/components/AppShell.tsx` (+ `AppShell.test.tsx` if present), `pages/Landing.tsx`, `pages/not-found.tsx` — T3.
- `artifacts/studio/src/pages/auth/{Login,Register}.tsx` — T4.
- `artifacts/studio/src/components/AppFooter.tsx` — T5.
- `artifacts/studio/src/pages/Workspace.tsx` (header region only, ~L2287) — T6.
- `artifacts/studio/src/components/ObjectiveBar.tsx` — T7.
- `artifacts/studio/src/components/workspace/{SidebarTree,TabBar,StaleOutputBanner}.tsx`, `components/ConstraintChips.tsx`, `components/workspace/map/MapLegend.tsx` — T8.
- Mono-numbers targets (T9 — enumerated below).
- `components/NetworkMap.tsx`, `components/workspace/map/EntityMarkers.tsx`, `lib/bandPalette.ts` (+ `__tests__/bandPalette.test.ts`) — T10.
- `artifacts/studio/e2e/design-system.spec.ts` — T11 (NEW, Playwright).

---

## Wave 1 — Foundations

### Task 1: index.css — tokens, fonts, radii, shadows, utilities

**Files:** Modify `artifacts/studio/src/index.css`.

**Interfaces produced (consumed by all later tasks):**
- Utility classes `.scnd-band`, `.scnd-kicker`, `.scnd-display`.
- Global `:root` book-cover palette (shadcn vars) + additive tokens (`--green-*`, `--ink-*`, `--text-*`, `--surface-band*`, `--map-*`, `--band-0..4`, status, `--line-strong`, `--focus-ring`).
- Retargeted Tailwind theme vars: radii `--radius-sm/md/lg/xl = 3/4/6/6px`, shadows in `@theme`.

- [ ] **Step 1: Swap the font `@import`** (line 1). Replace the current Space Grotesk/Inter/JetBrains/Barlow import with:
```css
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
```
Leave the `leaflet`, `tailwindcss`, `tw-animate-css` imports and the `.leaflet-container{z-index:0}` block unchanged.

- [ ] **Step 2: Retarget the `:root` LIGHT block** (starts `/* LIGHT MODE */ :root {` ~L301). Change these exact values (old → new). Leave `--button-outline`, `--badge-outline`, `--opaque-button-border-intensity`, `--elevate-1/2`, the derived `*-border` fallbacks, `--accent-300/600/700`, `--demand*`, `--tracking-normal`, `--spacing` unchanged:
```
--background: 0 0% 100%          →  60 20% 99%
--foreground: 222 84% 12%        →  84 11% 9%
--border: 214 32% 91%            →  72 16% 87%
--card: 0 0% 100%                →  0 0% 100%      (unchanged)
--card-foreground: 222 84% 12%   →  84 11% 9%
--card-border: 214 32% 91%       →  72 16% 87%
--sidebar: 0 0% 100%             →  0 0% 100%      (unchanged)
--sidebar-foreground: 222 84% 12%→  84 11% 9%
--sidebar-border: 214 32% 91%    →  72 16% 87%
--sidebar-primary: 218 70% 52%   →  82 52% 33%
--sidebar-primary-foreground     →  0 0% 100%      (unchanged)
--sidebar-accent: 210 40% 96%    →  79 44% 50%
--sidebar-accent-foreground: 222 84% 12% → 0 0% 100%
--sidebar-ring: 218 70% 52%      →  81 50% 43%
--popover: 0 0% 100%             →  0 0% 100%      (unchanged)
--popover-foreground: 222 84% 12%→  84 11% 9%
--popover-border: 214 32% 91%    →  72 16% 87%
--primary: 218 70% 52%           →  82 52% 33%
--primary-foreground             →  0 0% 100%      (unchanged)
--secondary: 210 40% 96%         →  75 40% 95%
--secondary-foreground: 222 84% 12% → 84 11% 9%
--muted: 210 40% 98%             →  72 22% 95%
--muted-foreground: 215 16% 47%  →  82 6% 35%
--accent: 210 40% 96%            →  79 44% 50%
--accent-foreground: 222 84% 12% →  0 0% 100%
--destructive: 0 72% 51%         →  0 72% 51%      (unchanged)
--destructive-foreground         →  0 0% 100%      (unchanged)
--input: 214 32% 91%             →  72 16% 87%
--ring: 218 70% 52%              →  81 50% 43%
```

- [ ] **Step 3: Replace the status + band-0..3 + chart + font + radius + shadow lines** in `:root` (the block `--success` through `--radius`/`--shadow-*`). New values:
```css
  /* status (full sets) */
  --success: #16A34A; --success-bg: #F0FDF4; --success-border: #86EFAC;
  --warning: #B45309; --warning-bg: #FFFBEB; --warning-border: #FCD34D;
  --danger: #DC2626;  --danger-bg: #FEF2F2;  --danger-border: #FCA5A5;
  --utilization: #7DA436;

  /* five-color distance bands (0=nearest .. 4=farthest) */
  --band-0: #16A34A; --band-1: #84CC16; --band-2: #F59E0B; --band-3: #EF4444; --band-4: #DC2626;

  /* charts: 1..5 HSL (@theme-mapped); grid/axis hex (not mapped) */
  --chart-1: 82 52% 33%; --chart-2: 83 8% 20%; --chart-3: 79 44% 62%;
  --chart-4: 26 90% 37%; --chart-5: 81 6% 51%;
  --chart-grid: #E2E4DA; --chart-axis-label: #5B5F54;

  /* green + ink scales */
  --green-050: #F4F7EB; --green-100: #E7EED4; --green-200: #CDDCA6; --green-300: #AFC975;
  --green-400: #93B747; --green-500: #7DA436; --green-600: #5F7F28; --green-700: #48611E; --green-800: #324414;
  --ink-900: #181A15; --ink-800: #23261F; --ink-700: #33362E; --ink-500: #5B5F54; --ink-400: #83887A; --ink-300: #ADB1A4;

  /* raw text (avoid hsl() wrap in utilities/inline styles) */
  --text-body: #181A15; --text-muted: #5B5F54; --text-faint: #83887A; --text-brand: #5F7F28;

  /* band motif + surfaces + structural */
  --surface-band: #181A15; --surface-band-fg: #FCFCFA; --surface-selected: #F4F7EB; --surface-sunken: #F5F6F1;
  --line: #E2E4DA; --line-strong: #C9CCBD;
  --primary-hover: #48611E; --primary-active: #324414; --link: #48611E; --link-hover: #324414; --focus-ring: #7DA436;

  /* map entities + interaction-state rings (functional affordance values kept) */
  --map-warehouse: #181A15; --map-warehouse-open: #5F7F28; --map-customer: #93B747;
  --map-customer-stroke: #48611E; --map-flow: #7DA436; --map-inactive: #ADB1A4;
  --map-ring-forced-open: #2D6CDF; --map-ring-select: #FCD34D; --map-ring-multiselect: #7C3AED;
  --map-default-stroke: #83887A;

  /* fonts (all three serif vars → Source Serif 4) */
  --app-font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --app-font-serif: 'Source Serif 4', Georgia, serif;
  --app-font-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --app-font-heading: 'Source Serif 4', Georgia, serif;
  --app-font-display: 'Source Serif 4', Georgia, serif;
  --radius: 4px;
```
DELETE the old `--band-3: #EF4444` line's absence of `--band-4` (add `--band-4`), the `--chart-1..5: red` lines, and the entire `--shadow-2xs/xs/sm/shadow/md/lg/xl/2xl` placeholder block in `:root` (moved to `@theme`, Step 5). Keep `--tracking-normal`/`--spacing` and the derived-border/`--accent-*`/`--demand-*` blocks.

- [ ] **Step 4: `.dark` block** — remove its transparent `--shadow-*` placeholder lines too (dead; shadows now come from `@theme`). Leave the rest of `.dark` untouched (dead surface).

- [ ] **Step 5: Add radii + shadows to `@theme inline`.** In the existing `@theme inline {…}` block, replace the four `--radius-*` calc lines with pinned values, and add the shadow namespace:
```css
  --radius-sm: 3px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --radius-xl: 6px;

  --shadow-sm: 0 1px 2px rgba(24,26,21,.06);
  --shadow: 0 1px 2px rgba(24,26,21,.06);
  --shadow-md: 0 2px 8px rgba(24,26,21,.10);
  --shadow-lg: 0 8px 30px rgba(24,26,21,.18);
  --shadow-xl: 0 8px 30px rgba(24,26,21,.18);
```

- [ ] **Step 6: Retire `.scn-theme`.** Replace the entire `.scn-theme { … }` rule body (the Phase 3.1 override block) with an empty no-op comment `/* .scn-theme retired (Bundle 3): book-cover theme lives at :root now; class left on Workspace.tsx as a harmless no-op */ .scn-theme {}`. Leave `.studio-lab` and the `--arc-*` block untouched (dead Studio.tsx + T7's ObjectiveBar until rewritten).

- [ ] **Step 7: Add the three utility classes** at the end of `index.css`:
```css
@layer components {
  .scnd-band { background: var(--surface-band); color: var(--surface-band-fg); border-bottom: 2px solid var(--green-400); }
  .scnd-kicker { font-family: var(--app-font-mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); }
  .scnd-display { font-family: var(--app-font-display); }
}
```

- [ ] **Step 8: Build + smoke.** Run `pnpm --filter studio test` — expect some class/snapshot churn in later-task files but T1 itself should not break behavioral tests. Run `pnpm --filter studio run build` to confirm the CSS compiles (catches an invalid `@theme`/token). Fix any red.

- [ ] **Step 9: Commit** — `[bundle3-T1] index.css book-cover foundation (tokens/fonts/radii/shadows/utilities)`.

### Task 2: design-token source-contract test

**Files:** Create `artifacts/studio/src/__tests__/designTokens.contract.test.ts`.

**Interfaces consumed:** reads `index.css` from disk (source-contract, NOT jsdom computed style).

- [ ] **Step 1: Write the test.** Read `index.css` as text; assert token *shape* (the representation rule):
```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8");

function value(name: string): string {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : "";
}
const HSL_TRIPLE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;
const HEX = /^#[0-9A-Fa-f]{3,8}$/;

describe("design tokens — representation contract", () => {
  it("shadcn/@theme-mapped tokens are HSL triples (never hex/red)", () => {
    for (const n of ["background","foreground","primary","muted-foreground","accent","border","ring",
                     "chart-1","chart-2","chart-3","chart-4","chart-5"]) {
      expect(value(n), n).toMatch(HSL_TRIPLE);
    }
  });
  it("raw complete-color tokens are hex", () => {
    for (const n of ["green-600","ink-900","text-muted","surface-band","band-0","band-4",
                     "map-flow","chart-grid","map-ring-select"]) {
      expect(value(n), n).toMatch(HEX);
    }
  });
  it("no leftover `red` chart placeholder and band scale is 5-wide", () => {
    expect(css).not.toMatch(/--chart-[1-5]\s*:\s*red/);
    expect(value("band-4")).toBeTruthy();
  });
  it("radii are pinned to the 3/4/6 print scale (no calc)", () => {
    expect(value("radius-sm")).toBe("3px");
    expect(value("radius-lg")).toBe("6px");
    expect(value("radius-xl")).toBe("6px");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter studio test src/__tests__/designTokens.contract.test.ts` — expect PASS (T1 already landed). If a token is the wrong shape, fix it in `index.css` (this is exactly the class of bug the test exists to catch).
- [ ] **Step 3: Commit** — `[bundle3-T2] design-token source-contract test`.

---

## Wave 2 — Band motif + chrome (parallel after T1)

### Task 3: AppShell band hero + Landing + NotFound

**Files:** Modify `components/AppShell.tsx`, `pages/Landing.tsx`, `pages/not-found.tsx`; update `AppShell.test.tsx` / `Landing.test.tsx` if present.

**Interfaces:** `AppShell` gains `heroTitle?: string`. Consumes `.scnd-band`/`.scnd-kicker`/`.scnd-display` (T1).

- [ ] **Step 1 (test first):** In `AppShell.test.tsx` (create if absent), assert: renders `data-testid="text-user-email"` + logout button (unchanged behavior); when `heroTitle="Network Design Labs"` is passed, that text renders; the header carries the `.scnd-band` class. Run → fails.
- [ ] **Step 2:** `AppShell.tsx` — restyle the `<header>` (L35) from `bg-background` to `className="scnd-band …"`; keep `h-12`→ allow taller (e.g. `py-3`) for the hero; render kicker `<div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>` + (if `heroTitle`) `<div className="scnd-display" style={{color:"var(--green-400)"}}>{heroTitle}</div>`; keep `{userEmail}` (testid intact) + logout button on the right, recolored for the band (`text-[color:var(--ink-300)]`/ghost). Add `heroTitle?: string` to props.
- [ ] **Step 3:** `pages/Landing.tsx` — pass nothing new itself; Landing's parent `App.tsx` renders `<AppShell>` — **update `App.tsx:39/46`** so the `/` route passes `heroTitle="Network Design Labs"` (add an optional param to `authedOnly` or wrap Landing's AppShell explicitly). Keep the body `<h1>Labs</h1>` but render it `.scnd-display`; chapter-card `c.chapter` → `.scnd-kicker`; `CardTitle` serif; the recent-solves status badge → status tokens (`text-[color:var(--success)]` etc.); recent-solves stat spans get `font-mono` (also covered by T9 — idempotent).
- [ ] **Step 4:** `pages/not-found.tsx` — no `heroTitle` (its AppShell shows kicker + small serif wordmark only); confirm it renders under AppShell unchanged.
- [ ] **Step 5:** Run `pnpm --filter studio test` (AppShell/Landing/App tests) → green; update any snapshot/class assertion that is purely cosmetic. `typecheck`.
- [ ] **Step 6: Commit** — `[bundle3-T3] AppShell band hero + Landing/NotFound`.

### Task 4: Auth pages band

**Files:** Modify `pages/auth/Login.tsx`, `pages/auth/Register.tsx`.

- [ ] **Step 1 (test):** existing `Login`/`Register` tests must stay green (testids `input-email`/`input-password`/`button-login` unchanged). Add one assertion that a `.scnd-band` (or kicker) element renders on the auth page.
- [ ] **Step 2:** Wrap the card with a `.scnd-band` title strip (or a band header above the centered card): serif "SCND Optimization Studio" + `.scnd-kicker` "By Prof. Michael Watson". Keep the form, `AppFooter`, all testids. Register mirrors Login.
- [ ] **Step 3:** test + typecheck green. **Commit** — `[bundle3-T4] auth pages band`.

### Task 5: AppFooter restyle

**Files:** Modify `components/AppFooter.tsx`.

- [ ] **Step 1 (test):** `AppFooter` test (create/extend) — copy "© Developed by hx1" unchanged, `data-testid="app-footer"`, `FOOTER_H` export unchanged.
- [ ] **Step 2:** restyle to paper/muted print footer — `border-t` hairline (`border-[color:var(--line)]`), `text-[color:var(--text-faint)]`, mono (`font-mono`), keep `height: FOOTER_H`.
- [ ] **Step 3:** test + typecheck. **Commit** — `[bundle3-T5] AppFooter print restyle`.

### Task 6: Workspace header band

**Files:** Modify `pages/Workspace.tsx` (header region only, ~L2287–L2340; the 3-track grid).

- [ ] **Step 1 (test):** `Workspace.test.tsx` — all header testids (`button-page-back`, `select-scenario-context`, the summary, account/logout, stepper, Save/Run) stay present; grid + `<md` stacking preserved. Add one assertion the header carries `.scnd-band`.
- [ ] **Step 2:** change `<header className="border-b flex-shrink-0 bg-background">` → `className="scnd-band flex-shrink-0"`; recolor the back arrow, `Scenario:` label, `<select>`, centered "Chapter N · description" summary, and account zone to band-fg (`text-[color:var(--surface-band-fg)]` / `--ink-300` for muted); the center summary chapter uses `.scnd-kicker` + serif description. Keep the grid `grid-cols-[auto_1fr_auto]`, `min-h-14`, all testids, all handlers.
- [ ] **Step 3:** test + typecheck green; update cosmetic assertions. **Commit** — `[bundle3-T6] Workspace header band`.

---

## Wave 3 — Studio components close-match + mono-numbers + map palette

### Task 7: ObjectiveBar rewrite (off `--arc-*`)

**Files:** Modify `components/ObjectiveBar.tsx`.

- [ ] **Step 1 (test):** extend/confirm `ObjectiveBar.test.tsx` — same props/render (chapter label, title, description, stat pills when `result`, "Not yet solved" otherwise); stats are `font-mono`. No `--arc-*` string remains (assert via a source check or a computed-class check).
- [ ] **Step 2:** rewrite the inline styles: container → white/paper card (`background: var(--surface-card, #fff)`, `border: 1px solid var(--line)`, `--shadow-sm`, `--radius-md`); kicker `var(--text-muted)` mono; title `var(--app-font-display)` `var(--text-body)`; description `var(--text-muted)`; `StatPill` → mono, `var(--text-muted)`, `1px solid var(--line)`. Replace every `--arc-*` with book-cover tokens. Props/DOM unchanged.
- [ ] **Step 3:** `grep -n 'arc-' components/ObjectiveBar.tsx` → zero. test + typecheck green. **Commit** — `[bundle3-T7] ObjectiveBar book-cover rewrite`.

### Task 8: Close-match the 5 other studio components

**Files:** Modify `components/workspace/SidebarTree.tsx`, `components/workspace/TabBar.tsx`, `components/workspace/StaleOutputBanner.tsx`, `components/ConstraintChips.tsx`, `components/workspace/map/MapLegend.tsx`.

- [ ] **Step 1 (tests first):** for each, keep all existing tests green; add/adjust the specific cosmetic assertion noted below. DOM/roles/testids frozen.
- [ ] **Step 2 — SidebarTree:** `rowClass(active)` — active state → `bg-[color:var(--surface-selected)] text-[color:var(--text-brand)] border-l-2 border-[color:var(--green-500)] font-medium` (replacing `bg-muted font-medium text-foreground`); `SidebarSection` header → add `font-mono` (kicker) to the existing `text-[10px] uppercase tracking-wide`.
- [ ] **Step 3 — TabBar:** active tab → `bg-background` + a 2px green bottom rule (`border-b-2 border-[color:var(--green-500)]`) instead of just `font-medium`; keep `role=tablist/tab`, testids.
- [ ] **Step 4 — StaleOutputBanner:** amber triangle kept; recolor text to tokens (`text-[color:var(--text-body)]`/`--text-muted`), status-statement tone unchanged.
- [ ] **Step 5 — ConstraintChips:** chips already `font-mono`; reconcile the stale `Badge` amber classes to status tokens (`text-[color:var(--warning)] border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]`); chip border/hover to `--line`/`--primary`.
- [ ] **Step 6 — MapLegend (input-map legend only):** move its entity/status/demand swatch colors to the map-entity tokens (`--map-warehouse`, `--map-warehouse-open`, `--map-customer`, `--map-inactive`, `--demand-*`). **Do NOT** add band swatches here (those live in NetworkMap's output legend, T10).
- [ ] **Step 7:** `pnpm --filter studio test` green (update cosmetic assertions); typecheck. **Commit** — `[bundle3-T8] close-match 5 studio components`.

### Task 10: Map palette → tokens (run before T9)

**Files:** Modify `components/NetworkMap.tsx`, `components/workspace/map/EntityMarkers.tsx`, `lib/bandPalette.ts`, `__tests__/bandPalette.test.ts`.

> Ordered before T9 in text but file-disjoint from T7/T8 → parallel with them; must merge before T9.

- [ ] **Step 1 (test):** `bandPalette.test.ts` — update expected `BAND_COLORS` to the 5 `--band-*` values (unchanged hex actually: `#16A34A #84CC16 #F59E0B #EF4444 #DC2626`) — confirm still 5 entries, index semantics intact. NetworkMap: reuse the `e2e/workspace-ux-r1-r9.spec.ts` `getComputedStyle` precedent only at T11; here assert via the existing NetworkMap RTL tests that markers still render.
- [ ] **Step 2 — bandPalette.ts:** keep `BAND_COLORS` values (already match `--band-0..4`); add a comment tying them to the tokens. (No visual change — this is the alignment point of record.)
- [ ] **Step 3 — NetworkMap.tsx:** replace the hardcoded hexes in BOTH icon factories (`createTriangleIcon` + sibling, L34–L58 and L92–L116) and the built-in legend/marker SVGs (L446-447 leg colors, L498/509/514 default+multiselect, L593/600/606/607 legend icons, tooltip L176-188 grays) with the tokens: default stroke `#64748B`/`#94A3B8` → `var(--map-default-stroke)`; open `#16A34A`/`#15803D` → `var(--map-warehouse-open)` (+ a highlighted step); inactive `#DC2626` → keep `var(--danger)`; forced-open ring `#2D6CDF` → `var(--map-ring-forced-open)`; single-select `#FCD34D` → `var(--map-ring-select)`; multi-select `#7C3AED` → `var(--map-ring-multiselect)`; leg colors → `var(--map-warehouse-open)` / `var(--danger)`; tooltip grays → `var(--line)`/`var(--text-body)`/`var(--text-muted)`. **Note (confirmed, no landmine):** `var(--map-*)` in the SVG `stroke`/`fill` strings resolves directly — both `NetworkMap.tsx` (L72/L133) and `EntityMarkers.tsx` (L81/L91) build icons via `L.divIcon({html})`, i.e. in-document DOM SVG that inherits `:root` custom properties, NOT `data:` URIs. The only asset icon is stock Leaflet's default pin (`NetworkMap.tsx:22`), which we do not recolor. No literal-hex fallback needed.
- [ ] **Step 4 — EntityMarkers.tsx:** align marker/bubble/flow colors to `--map-*` tokens (supply/demand already use `--accent-*`/`--demand-*`; reconcile any literal hex to tokens).
- [ ] **Step 5:** test + typecheck green. **Commit** — `[bundle3-T10] map palette → book-cover tokens`.

### Task 9: Mono-numbers pass (run LAST, after T7/T8/T10 merge)

**Files (exhaustive, from `grep toLocaleString|toFixed|toExponential` + `type="number"`, excluding dead `pages/Studio.tsx`, recharts-internal `ui/chart.tsx`, unused `ui/calendar.tsx`, and `BrazilMap.tsx`/already-mono):**
Formatters — `components/NetworkMap.tsx`* , `components/ObjectiveBar.tsx`* , `components/workspace/map/{MapActionMenu,MapDetailsCard,MapLegend}.tsx`, `components/workspace/SolveDialog.tsx`, `components/workspace/tabs/{AssignmentsTab,CostSummaryTab,CustomersTab,FlowsTab,MinesTab,OpenWarehousesTab,OptimizationParametersTab,OutputMapTab,StationsTab,WarehousesTab}.tsx`, `pages/Landing.tsx`*, `components/tables/{CustomerTable,MineTable,StationTable,WarehouseTable}.tsx`.
Numeric inputs (`type="number"` → also mono) — `components/MapBulkEditToolbar.tsx`, `components/workspace/SolveDialog.tsx`, `components/workspace/tabs/{LaneCostsTab,LegDistancesTab,OptimizationParametersTab,WarehousesTab,MinesTab,CustomersTab,DistancesTab,StationsTab}.tsx`, `components/workspace/map/dialogs/{EditWarehouseDialog,EditCustomerDialog,CreateEntityDialog}.tsx`, `components/tables/{CustomerTable,MineTable,StationTable,WarehouseTable}.tsx`.
(*already handled in T3/T7/T10 — re-verify only, don't double-edit.)

**Rule:** every rendered number and every numeric `<input>` value gets `font-mono` (Tailwind class, or `style={{fontFamily:"var(--app-font-mono)"}}` for inline-styled spots). Prose/labels stay sans. Kickers already mono via `.scnd-kicker`.

- [ ] **Step 1 (test):** pick 3 representative surfaces (a table numeric cell, a numeric input, the CostSummary stat) and assert the numeric element carries `font-mono` in RTL. Run → fails where not yet applied.
- [ ] **Step 2:** apply `font-mono` to the numeric render/input in each enumerated file. Where a file already has partial mono (tables, ConstraintChips), only fill gaps — grep each file for the formatter/`type="number"` and confirm the enclosing element is mono.
- [ ] **Step 3:** `pnpm --filter studio test` green; typecheck. **Commit** — `[bundle3-T9] mono-numbers pass (enumerated surfaces)`.

### Task 11: Playwright computed-style smoke

**Files:** Create `artifacts/studio/e2e/design-system.spec.ts`.

- [ ] **Step 1:** mirror the existing `e2e/workspace-ux-r1-r9.spec.ts` setup (dev-proxy, disposable account). Assert via real-browser `getComputedStyle`: Landing AppShell header background ≈ ink `#181A15`; a primary button color ≈ green-600; a `Card` `borderRadius` = `6px` (not 8); a `.shadow` element has a non-`none` boxShadow; a band-colored route/legend swatch resolves to a `--band-*` value. Also assert the band hero title "Network Design Labs" is visible and body "Labs" still present.
- [ ] **Step 2:** run locally per the repo's e2e instructions (start api-server + studio with `API_PROXY_TARGET`, then `npx playwright test design-system.spec.ts`). If the env can't run e2e in the execution sandbox, mark the spec written-but-not-run and flag for the live-verify step (same convention as prior bundles).
- [ ] **Step 3: Commit** — `[bundle3-T11] design-system Playwright smoke`.

---

## Final gate + live verify (controller)

- [ ] Run the full canonical gate on the merged branch:
```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
  (Solver pytest expected unaffected — no Python touched; run it per the gate contract anyway. `e2e_accuracy.py`/`e2e_journey.py` not run.)
- [ ] **Live-verify** in a real browser (local dev, disposable account, purged after) across ≥2 models (p-median-us + one other): Landing dark band + green serif "Network Design Labs" + body "Labs"; auth band; Workspace band header; sidebar green left-rule active row; mono stats everywhere; band-colored routes + legend using the 5-color scale; map single/multi-select rings still distinguishable; 6px card radii; hairlines. Screenshot-check contrast (green-on-white, band-fg-on-band).
- [ ] Update `CLAUDE.md` v0.3 progress with the Bundle 3 outcome.
- [ ] Finish per `superpowers:finishing-a-development-branch` (merge to local main, push, deploy both Render services, prod-smoke).

## Self-review (run before dispatch — the discipline the post-mortems named)

1. **Every code reference has a receipt.** All file paths/line refs above came from grep/read this session (map colors L34–L607, mono surfaces from the formatter/`type=number` greps, `AppShell.tsx:35`, `App.tsx:39`, `bandPalette.ts`). ✓
2. **Every mechanism verified, not assumed.** Shadows via `@theme` (confirmed `@theme` has no shadow keys today); radii pinned (confirmed calc math); `--app-font-serif` set (confirmed `@theme` maps `font-serif` through it); contract test reads source not jsdom (confirmed studio vitest = jsdom). ✓
3. **Exhaustive lists, not samples.** Mono-numbers = the full grep output; map colors = every hardcoded hex in the three files. ✓
4. **Constraint cross-read.** Copy rule (additive) consistent across Global Constraints / T3 / T5; "no `modelId===`" honored (T10 uses tokens, not model branches); testids frozen asserted per task. ✓
5. **The one open risk was closed, not deferred:** T10's `var()`-in-SVG question — verified both map components use `L.divIcon({html})` (in-document), so `var()` resolves; no fallback needed. Recorded in T10 Step 3.
