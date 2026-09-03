# Bundle 3 — Book-cover design system Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is executed by the **agent team**
> (frontend-engineer implementers + independent reviewer per task), the standing NOS execution model.
> Steps use checkbox (`- [x]`) syntax. Spec: `docs/superpowers/specs/2026-09-03-bundle3-book-cover-design-system-design.md` (rev 2).

**Goal:** Reskin all live surfaces (Landing, auth, Workspace) to the textbook-cover brand — paper/leaf-green/dark-band, Source Serif 4 + IBM Plex Sans/Mono, print radii + hairlines — by retargeting shadcn tokens at global `:root`, adding band/kicker markup, and close-matching the 6 studio components. Presentation only.

**Architecture:** One `index.css` foundation (Wave 1) that every later task consumes; band/chrome markup (Wave 2); studio-component close-match + mono-numbers + map palette (Wave 3). No behavior/contract/API/DB/solver change.

**Tech Stack:** React + Vite + Tailwind v4 (`@theme inline`) + shadcn/Radix, `artifacts/studio/src`.

## Global Constraints (bind every task, verbatim from spec)

- **Presentation only.** No behavior/contract/API/DB/solver change. No Python touched → `e2e_accuracy.py` not re-run.
- **Light theme only.** No dark-mode work on live surfaces.
- **Preserve every `data-testid`, `aria-*`, role, interactive/Radix structure, and focus/keyboard behavior — and freeze the DOM of the six close-match studio components** (T8) to class/token/inline-style changes only. **Additive brand-chrome markup is explicitly allowed** where a task requires it: T3-T6 add band wrappers, hero/kicker/title elements, and header restructuring on Landing/AppShell/auth/Workspace-header/footer. The rule is: never remove/rename a testid, never break a Radix primitive's structure or a11y, never restructure a *close-match* component — but adding presentational wrapper/hero/kicker elements around existing content on the chrome surfaces is the point of Wave 2.
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

- `artifacts/studio/src/index.css` **+ `components/ui/switch.tsx`** (thumb shadow decouple, Step 5b) — T1 (foundation: tokens, fonts, radii, shadows, utilities).
- `artifacts/studio/src/__tests__/designTokens.contract.test.ts` — T2 (NEW, source-contract).
- `artifacts/studio/src/components/AppShell.tsx` (+ `AppShell.test.tsx`), **`App.tsx` (+ `App.test.tsx`)**, `pages/Landing.tsx`, `pages/not-found.tsx` — T3.
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

**Files:** Modify `artifacts/studio/src/index.css` and `artifacts/studio/src/components/ui/switch.tsx` (Step 5b — thumb shadow decouple).

**Interfaces produced (consumed by all later tasks):**
- Utility classes `.scnd-band`, `.scnd-kicker`, `.scnd-display`.
- Global `:root` book-cover palette (shadcn vars) + additive tokens (`--green-*`, `--ink-*`, `--text-*`, `--surface-band*`, `--map-*`, `--band-0..4`, status, `--line-strong`, `--focus-ring`).
- Retargeted Tailwind theme vars: radii `--radius-sm/md/lg/xl = 3/4/6/6px`, shadows in `@theme`.

- [x] **Step 1: Swap the font `@import`** (line 1). Replace the current Space Grotesk/Inter/JetBrains/Barlow import with:
```css
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
```
Leave the `leaflet`, `tailwindcss`, `tw-animate-css` imports and the `.leaflet-container{z-index:0}` block unchanged.

- [x] **Step 2: Retarget the `:root` LIGHT block** (starts `/* LIGHT MODE */ :root {` ~L301). Change these exact values (old → new). Leave `--button-outline`, `--badge-outline`, `--opaque-button-border-intensity`, `--elevate-1/2`, the derived `*-border` fallbacks, `--accent-300/600/700`, `--demand*`, `--tracking-normal`, `--spacing` unchanged:
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
--sidebar-accent-foreground: 222 84% 12% → 84 11% 9%   (INK, not white — AA on green-400)
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
--accent: 210 40% 96%            →  79 44% 50%   (green-400; kept for --accent-300/600/700 map derivation)
--accent-foreground: 222 84% 12% →  84 11% 9%    (INK, not white — white-on-green-400 is 2.31:1, fails AA; ink is ~8.2:1)
--destructive: 0 72% 51%         →  0 72% 51%      (unchanged)
--destructive-foreground         →  0 0% 100%      (unchanged)
--input: 214 32% 91%             →  72 16% 87%
--ring: 218 70% 52%              →  81 50% 43%
```

- [x] **Step 3: Replace the status + band-0..3 + chart + font + radius + shadow lines** in `:root` (the block `--success` through `--radius`/`--shadow-*`). New values:
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

- [x] **Step 4: `.dark` block** — remove its transparent `--shadow-*` placeholder lines **and** its five `--chart-1..5: red` placeholder lines (L495-499) — both are dead, and T2's contract scans the whole stylesheet, so a `red` left anywhere fails it. Leave the rest of `.dark` untouched (dead surface).

- [x] **Step 5: Add radii + shadows to `@theme inline`.** In the existing `@theme inline {…}` block, replace the four `--radius-*` calc lines with pinned values, and add the shadow namespace:
```css
  --radius-sm: 3px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --radius-xl: 6px;

  --shadow-xs: 0 1px 1px rgba(24,26,21,.04);
  --shadow-sm: 0 1px 2px rgba(24,26,21,.06);
  --shadow: 0 1px 2px rgba(24,26,21,.06);
  --shadow-md: 0 2px 8px rgba(24,26,21,.10);
  --shadow-lg: 0 8px 30px rgba(24,26,21,.18);
  --shadow-xl: 0 8px 30px rgba(24,26,21,.18);
```
**Shadow-consumer audit (from `grep shadow* components/ui/*`):** small/utility depth — `card` (`shadow`),
`button` (`shadow-xs`/`shadow-sm`), `badge` (`shadow-xs`), `select` trigger (`shadow-sm`), `switch` track
(`shadow-sm`); overlay — `dialog` (`shadow-lg`), `dropdown-menu` (`shadow-lg`/`-md`), `popover`
(`shadow-md`), `select` content (`shadow-md`). `--shadow-xs` **must** be defined (buttons/badges use it;
omitting it silently reverts them to Tailwind's stock shadow). The one conflict: `switch.tsx`'s **thumb**
uses `shadow-lg` (which is now the 30px overlay) — see Step 5b.

- [x] **Step 5b: decouple the Switch thumb from the overlay scale.** In `components/ui/switch.tsx` (L20),
  change the thumb's `shadow-lg` → `shadow-sm` so the toggle thumb keeps a small shadow while `shadow-lg`
  serves dialogs/dropdowns as the overlay. This is the only live consumer where overlay-`lg` would be
  wrong; verify no other non-overlay control uses `shadow-lg` (grep confirmed: only switch thumb + the
  overlay surfaces).

- [x] **Step 6: Retire `.scn-theme`.** Replace the entire `.scn-theme { … }` rule body (the Phase 3.1 override block) with an empty no-op comment `/* .scn-theme retired (Bundle 3): book-cover theme lives at :root now; class left on Workspace.tsx as a harmless no-op */ .scn-theme {}`. Leave `.studio-lab` and the `--arc-*` block untouched (dead Studio.tsx + T7's ObjectiveBar until rewritten).

- [x] **Step 7: Add the three utility classes** at the end of `index.css`:
```css
@layer components {
  .scnd-band { background: var(--surface-band); color: var(--surface-band-fg); border-bottom: 2px solid var(--green-400); }
  .scnd-kicker { font-family: var(--app-font-mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); }
  /* On the dark band, --text-muted (#5B5F54) is only 2.68:1; --ink-300 (#ADB1A4) is 8.02:1 (matches the Landing kit). */
  .scnd-band .scnd-kicker { color: var(--ink-300); }
  .scnd-display { font-family: var(--app-font-display); }
}
```
(T3/T4/T6 place kickers on the band; this contextual rule keeps them readable while light-surface
kickers keep `--text-muted`.)

- [x] **Step 8: Build + smoke.** Run `pnpm --filter studio test` — expect some class/snapshot churn in later-task files but T1 itself should not break behavioral tests. Run `pnpm --filter studio run build` to confirm the CSS compiles (catches an invalid `@theme`/token). Fix any red.

- [x] **Step 9: Commit** — `[bundle3-T1] index.css book-cover foundation (tokens/fonts/radii/shadows/utilities)`.

### Task 2: design-token source-contract test

**Files:** Create `artifacts/studio/src/__tests__/designTokens.contract.test.ts`.

**Interfaces consumed:** reads `index.css` from disk (source-contract, NOT jsdom computed style).

- [x] **Step 1: Write the test.** Read `index.css` as text; assert token *shape* (the representation rule):
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

// EXHAUSTIVE — every color the `@theme inline` block maps via hsl(var(--x))
// must be an HSL triple. Derived from the @theme `--color-*: hsl(var(--*))` lines.
const HSL_MAPPED = [
  "background","foreground","border","input","ring",
  "card","card-foreground","card-border",
  "popover","popover-foreground","popover-border",
  "primary","primary-foreground","secondary","secondary-foreground",
  "muted","muted-foreground","accent","accent-foreground",
  "destructive","destructive-foreground",
  "chart-1","chart-2","chart-3","chart-4","chart-5",
  "sidebar","sidebar-foreground","sidebar-border",
  "sidebar-primary","sidebar-primary-foreground",
  "sidebar-accent","sidebar-accent-foreground","sidebar-ring",
];
// Complete raw-token inventory (bare var(--x), never hsl-wrapped).
const HEX_RAW = [
  "green-050","green-100","green-200","green-300","green-400","green-500","green-600","green-700","green-800",
  "ink-900","ink-800","ink-700","ink-500","ink-400","ink-300",
  "text-body","text-muted","text-faint","text-brand",
  "surface-band","surface-band-fg","surface-selected","surface-sunken",
  "line","line-strong","primary-hover","primary-active","link","link-hover","focus-ring",
  "success","success-bg","success-border","warning","warning-bg","warning-border","danger","danger-bg","danger-border",
  "band-0","band-1","band-2","band-3","band-4",
  "map-warehouse","map-warehouse-open","map-customer","map-customer-stroke","map-flow","map-inactive",
  "map-ring-forced-open","map-ring-select","map-ring-multiselect","map-default-stroke",
  "chart-grid","chart-axis-label","utilization",
];

describe("design tokens — representation contract", () => {
  it.each(HSL_MAPPED)("@theme-mapped --%s is an HSL triple", (n) => {
    expect(value(n), n).toMatch(HSL_TRIPLE);
  });
  it.each(HEX_RAW)("raw --%s is a complete hex color", (n) => {
    expect(value(n), n).toMatch(HEX);
  });
  it("pins the critical values", () => {
    expect(value("primary")).toBe("82 52% 33%");
    expect(value("accent-foreground")).toBe("84 11% 9%");        // ink, not white (finding 1)
    expect(value("sidebar-accent-foreground")).toBe("84 11% 9%");
    expect(value("radius-sm")).toBe("3px");
    expect(value("radius-lg")).toBe("6px");
    expect(value("radius-xl")).toBe("6px");
    expect(value("surface-band")).toBe("#181A15");
  });
  it("no `red` placeholder and no transparent runtime shadow placeholders remain", () => {
    expect(css).not.toMatch(/--chart-[1-5]\s*:\s*red/);
    expect(css).not.toMatch(/--shadow[-a-z0-9]*\s*:[^;]*\/\s*0\.00/); // the old transparent placeholders
  });
  it("@theme declares the shadow namespace incl. xs (buttons/badges depend on it)", () => {
    for (const s of ["--shadow-xs","--shadow-sm","--shadow-md","--shadow-lg"]) {
      expect(css.includes(s), s).toBe(true);
    }
  });
});
```

- [x] **Step 2: Run** `pnpm --filter studio test src/__tests__/designTokens.contract.test.ts` — expect PASS (T1 already landed). If a token is the wrong shape, fix it in `index.css` (this is exactly the class of bug the test exists to catch).
- [x] **Step 3: Commit** — `[bundle3-T2] design-token source-contract test`.

---

## Wave 2 — Band motif + chrome (parallel after T1)

### Task 3: AppShell band hero + Landing + NotFound

**Files:** Modify `components/AppShell.tsx`, `App.tsx` (root route passes `heroTitle`), `pages/Landing.tsx`, `pages/not-found.tsx`; update `AppShell.test.tsx`, `App.test.tsx`, `Landing.test.tsx` (as present).

**Interfaces:** `AppShell` gains `heroTitle?: string`. Consumes `.scnd-band`/`.scnd-kicker`/`.scnd-display` (T1).

**AppShell band markup (pin both branches):**
```tsx
<header className="scnd-band flex-shrink-0 flex items-center gap-3 px-4 py-3">
  <div className="flex-1 min-w-0">
    <div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>
    {heroTitle
      ? <div className="scnd-display text-lg font-semibold" style={{ color: "var(--green-400)" }}>{heroTitle}</div>
      : <div className="scnd-display text-sm font-semibold" style={{ color: "var(--surface-band-fg)" }}>SCND Optimization Studio</div>}
  </div>
  <span className="text-sm" style={{ color: "var(--ink-300)" }} data-testid="text-user-email">{userEmail}</span>
  <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout" style={{ color: "var(--ink-300)" }}>Log out</Button>
</header>
```

- [x] **Step 1 (test first):** In `AppShell.test.tsx` (create if absent), assert: renders `data-testid="text-user-email"` + logout button (unchanged behavior); the header carries `.scnd-band`; **with** `heroTitle="Network Design Labs"` that title renders; **without** `heroTitle`, the fallback "SCND Optimization Studio" wordmark renders (both branches covered). Run → fails.
- [x] **Step 2:** `AppShell.tsx` — restyle the `<header>` (L35) from `bg-background` to `className="scnd-band …"`; keep `h-12`→ allow taller (e.g. `py-3`) for the hero; render kicker `<div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>` + (if `heroTitle`) `<div className="scnd-display" style={{color:"var(--green-400)"}}>{heroTitle}</div>`; keep `{userEmail}` (testid intact) + logout button on the right, recolored for the band (`text-[color:var(--ink-300)]`/ghost). Add `heroTitle?: string` to props.
- [x] **Step 3:** `pages/Landing.tsx` — pass nothing new itself; Landing's parent `App.tsx` renders `<AppShell>` — **update `App.tsx:39/46`** so the `/` route passes `heroTitle="Network Design Labs"` (add an optional param to `authedOnly` or wrap Landing's AppShell explicitly). Keep the body `<h1>Labs</h1>` but render it `.scnd-display`; chapter-card `c.chapter` → `.scnd-kicker`; `CardTitle` serif; the recent-solves status badge → status tokens (`text-[color:var(--success)]` etc.); recent-solves stat spans get `font-mono` (also covered by T9 — idempotent).
- [x] **Step 4:** `pages/not-found.tsx` — passes no `heroTitle`, so its AppShell band shows the kicker + the small "SCND Optimization Studio" serif wordmark fallback (pinned above). Assert (in `App.test.tsx` or a not-found test) the fallback wordmark renders and the large green hero title does NOT.
- [x] **Step 5:** Run `pnpm --filter studio test` (AppShell/Landing/App tests) → green; update any snapshot/class assertion that is purely cosmetic. `typecheck`.
- [x] **Step 6: Commit** — `[bundle3-T3] AppShell band hero + Landing/NotFound`.

### Task 4: Auth pages band

**Files:** Modify `pages/auth/Login.tsx`, `pages/auth/Register.tsx`.

- [x] **Step 1 (test):** existing `Login`/`Register` tests must stay green (testids `input-email`/`input-password`/`button-login` unchanged). Add one assertion that a `.scnd-band` (or kicker) element renders on the auth page.
- [x] **Step 2:** Wrap the card with a `.scnd-band` title strip (or a band header above the centered card): serif "SCND Optimization Studio" + `.scnd-kicker` "By Prof. Michael Watson". Keep the form, `AppFooter`, all testids. Register mirrors Login.
- [x] **Step 3:** test + typecheck green. **Commit** — `[bundle3-T4] auth pages band`.

### Task 5: AppFooter restyle

**Files:** Modify `components/AppFooter.tsx`.

- [x] **Step 1 (test):** `AppFooter` test (create/extend) — copy "© Developed by hx1" unchanged, `data-testid="app-footer"`, `FOOTER_H` export unchanged.
- [x] **Step 2:** restyle to paper/muted print footer — `border-t` hairline (`border-[color:var(--line)]`), `text-[color:var(--text-faint)]`, mono (`font-mono`), keep `height: FOOTER_H`.
- [x] **Step 3:** test + typecheck. **Commit** — `[bundle3-T5] AppFooter print restyle`.

### Task 6: Workspace header band

**Files:** Modify `pages/Workspace.tsx` (header region only, ~L2287–L2340; the 3-track grid).

- [x] **Step 1 (test):** `Workspace.test.tsx` — all header testids (`button-page-back`, `select-scenario-context`, the summary, account/logout, stepper, Save/Run) stay present; grid + `<md` stacking preserved. Add one assertion the header carries `.scnd-band`.
- [x] **Step 2:** change `<header className="border-b flex-shrink-0 bg-background">` → `className="scnd-band flex-shrink-0"`; recolor the back arrow, `Scenario:` label, `<select>`, centered "Chapter N · description" summary, and account zone to band-fg (`text-[color:var(--surface-band-fg)]` / `--ink-300` for muted); the center summary chapter uses `.scnd-kicker` + serif description. Keep the grid `grid-cols-[auto_1fr_auto]`, `min-h-14`, all testids, all handlers.
- [x] **Step 3:** test + typecheck green; update cosmetic assertions. **Commit** — `[bundle3-T6] Workspace header band`.

---

## Wave 3 — Studio components close-match + mono-numbers + map palette

### Task 7: ObjectiveBar rewrite (off `--arc-*`)

**Files:** Modify `components/ObjectiveBar.tsx`.

- [x] **Step 1 (test):** extend/confirm `ObjectiveBar.test.tsx` — same props/render (chapter label, title, description, stat pills when `result`, "Not yet solved" otherwise); stats are `font-mono`. No `--arc-*` string remains (assert via a source check or a computed-class check).
- [x] **Step 2:** rewrite the inline styles: container → white card (`background: hsl(var(--card))` — the existing shadcn token; do NOT invent `--surface-card`), `border: 1px solid var(--line)`, `box-shadow: var(--shadow-sm)`, `border-radius: var(--radius-md)`; kicker `var(--text-muted)` mono; title `var(--app-font-display)` `var(--text-body)`; description `var(--text-muted)`; `StatPill` → mono, `var(--text-muted)`, `1px solid var(--line)`. Replace every `--arc-*` with book-cover tokens. Props/DOM unchanged.
- [x] **Step 3:** `grep -n 'arc-' components/ObjectiveBar.tsx` → zero. test + typecheck green. **Commit** — `[bundle3-T7] ObjectiveBar book-cover rewrite`.

### Task 8: Close-match the 5 other studio components

**Files:** Modify `components/workspace/SidebarTree.tsx`, `components/workspace/TabBar.tsx`, `components/workspace/StaleOutputBanner.tsx`, `components/ConstraintChips.tsx`, `components/workspace/map/MapLegend.tsx`.

- [x] **Step 1 (tests first):** for each, keep all existing tests green; add/adjust the specific cosmetic assertion noted below. DOM/roles/testids frozen.
- [x] **Step 2 — SidebarTree:** `rowClass(active)` — active state → `bg-[color:var(--surface-selected)] text-[color:var(--text-brand)] border-l-2 border-[color:var(--green-500)] font-medium` (replacing `bg-muted font-medium text-foreground`); `SidebarSection` header → add `font-mono` (kicker) to the existing `text-[10px] uppercase tracking-wide`.
- [x] **Step 3 — TabBar:** active tab → `bg-background` + a **top** green rule matching the reference
  `TabBar.jsx` (`boxShadow: active ? "inset 0 2px 0 var(--green-500)" : "none"`), NOT a bottom border;
  apply via `style={{ boxShadow: isActive ? "inset 0 2px 0 var(--green-500)" : "none" }}`. Keep
  `role=tablist/tab`, testids; test the active tab's inset boxShadow (or its class).
- [x] **Step 4 — StaleOutputBanner:** amber triangle kept; recolor text to tokens (`text-[color:var(--text-body)]`/`--text-muted`), status-statement tone unchanged.
- [x] **Step 5 — ConstraintChips:** chips already `font-mono`; reconcile the stale `Badge` amber classes to status tokens (`text-[color:var(--warning)] border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]`); chip border/hover to `--line`/`--primary`.
- [x] **Step 6 — MapLegend (input-map legend only):** move entity/status swatches to the map-entity
  tokens. The **customer swatches — including the demand-bubble size samples — use exactly
  `--map-customer` (fill) + `--map-customer-stroke` (stroke)**, the same pair T10 gives the markers
  (Steps 3-4), so legend and markers can never diverge. **No `--demand-*` here:** the demand legend is
  precisely customer bubbles at three sizes (size, not a different color), so there is no genuinely
  distinct `--demand-*` consumer to justify the exception — drop it. Warehouse/mine swatches →
  `--map-warehouse`/`--map-warehouse-open`/`--map-inactive`. **Do NOT** add distance-band swatches here
  (those live in NetworkMap's output legend, T10).
- [x] **Step 7:** `pnpm --filter studio test` green (update cosmetic assertions); typecheck. **Commit** — `[bundle3-T8] close-match 5 studio components`.

### Task 10: Map palette → tokens (run before T9)

**Files:** Modify `components/NetworkMap.tsx`, `components/workspace/map/EntityMarkers.tsx`, `lib/bandPalette.ts`, `__tests__/bandPalette.test.ts`.

> Ordered before T9 in text but file-disjoint from T7/T8 → parallel with them; must merge before T9.

- [x] **Step 1 (test):** `bandPalette.test.ts` — assert `BAND_COLORS` are the CSS-var references
  `["var(--band-0)",…,"var(--band-4)"]` (a **static contract that the tokens are authoritative** — a
  literal-hex array with the same values would fail this, which is the point), 5 entries, index semantics
  intact (`getBandColor(6)` clamps to index 4). NetworkMap markers: assert via existing RTL tests they
  still render; computed colors verified in T11.
- [x] **Step 2 — bandPalette.ts:** change `BAND_COLORS` to
  `["var(--band-0)","var(--band-1)","var(--band-2)","var(--band-3)","var(--band-4)"]` so `--band-0..4` is
  the single source of truth (consumers — NetworkMap `divIcon` SVG stroke/fill, and the band-coverage
  bars' inline `style`/`backgroundColor` — all accept `var()` since they render in-document). Grep every
  `BAND_COLORS`/`getBandColor` consumer to confirm each is a CSS context (SVG attr or inline style), not
  a place that needs a resolved hex (e.g. a canvas API); if any needs a literal, resolve it via
  `getComputedStyle` there rather than reverting the array.
- [x] **Step 3 — NetworkMap.tsx:** replace the hardcoded hexes in BOTH icon factories (`createTriangleIcon` + sibling, L34–L58 and L92–L116) and the built-in legend/marker SVGs (L446-447 leg colors, L498/509/514 default+multiselect, L593/600/606/607 legend icons, tooltip L176-188 grays) with the tokens — **context-specific, because the same hex means different things in different markers:**
  - **Warehouse triangles** (`createTriangleIcon` + sibling, L34/92 default stroke `#64748B`) → `var(--map-default-stroke)`.
  - **Warehouse open** `#16A34A` → `var(--map-warehouse-open)`; **highlighted-open** `#15803D` → `var(--green-700)` (the exact darker step, not "a step").
  - **Warehouse inactive** `#DC2626` → keep `var(--danger)`.
  - **Customer bubble default** (L498 fill `#94A3B8`, L514 stroke `#64748B`) → fill `var(--map-customer)`, stroke `var(--map-customer-stroke)` — the SAME pair T8's legend uses (they must match). Do NOT fold the customer stroke into `--map-default-stroke`.
  - **Rings:** forced-open `#2D6CDF` → `var(--map-ring-forced-open)`; single-select `#FCD34D` → `var(--map-ring-select)`; multi-select `#7C3AED` → `var(--map-ring-multiselect)`.
  - **Leg colors** (L446-447) → `var(--map-warehouse-open)` / `var(--danger)`; **tooltip grays** (L176-188) → `var(--line)` / `var(--text-body)` / `var(--text-muted)`.
  - Band-state fills (`getBandColor(...)`) already flow from `bandPalette` (Step 2) — no literal change. **Note (confirmed, no landmine):** `var(--map-*)` in the SVG `stroke`/`fill` strings resolves directly — both `NetworkMap.tsx` (L72/L133) and `EntityMarkers.tsx` (L81/L91) build icons via `L.divIcon({html})`, i.e. in-document DOM SVG that inherits `:root` custom properties, NOT `data:` URIs. The only asset icon is stock Leaflet's default pin (`NetworkMap.tsx:22`), which we do not recolor. No literal-hex fallback needed.
- [x] **Step 4 — EntityMarkers.tsx:** align to `--map-*` tokens. **Customer demand bubbles → `var(--map-customer)` fill / `var(--map-customer-stroke)` stroke** (retiring the Bundle-2.2 `--demand-300/600` for bubbles — under book-cover, supply is ink warehouse triangles and demand is green customer bubbles, so they're already distinct without a separate demand green; this is the same pair the NetworkMap markers (Step 3) and the T8 legend use, so all three match). Warehouse/mine markers → `var(--map-warehouse)`/`var(--map-warehouse-open)`/`var(--map-inactive)`. Flows → `var(--map-flow)`. Grep for remaining `--demand-*` / `--accent-*` / literal-hex uses in this file and reconcile each. (Leave the `--demand-*` token *definitions* in `index.css` in place if any non-bubble consumer remains; otherwise they become dead — acceptable, don't chase.)
- [x] **Step 5:** test + typecheck green. **Commit** — `[bundle3-T10] map palette → book-cover tokens`.

### Task 9: Mono-numbers pass (run LAST, after T7/T8/T10 merge)

**Files (exhaustive, from `grep toLocaleString|toFixed|toExponential` + `type="number"`, excluding dead `pages/Studio.tsx`, recharts-internal `ui/chart.tsx`, unused `ui/calendar.tsx`, and `BrazilMap.tsx`/already-mono):**
Formatters + raw-numeric cells — `components/NetworkMap.tsx`* , `components/ObjectiveBar.tsx`* , `components/workspace/map/{MapActionMenu,MapDetailsCard,MapLegend}.tsx`, `components/workspace/map/dialogs/MoveConfirmDialog.tsx` (raw `{newLat}`/`{newLng}`, testids `move-confirm-lat`/`-lng`), `components/workspace/SolveDialog.tsx`, `components/workspace/tabs/{AssignmentsTab,CostSummaryTab,CustomersTab,FlowsTab,MinesTab,OpenWarehousesTab,OptimizationParametersTab,OutputMapTab,ServiceStatsTab,StationsTab,WarehousesTab}.tsx` (**ServiceStatsTab** renders raw `≤ {b.band} {unit}` + `{b.percent}%` band/percent cells at ~L62/L66 with no `font-mono` — mono both), `pages/Workspace.tsx` (result-history position, `data-testid="text-result-history-position"` ~L2367), `pages/Landing.tsx`*, `components/tables/{CustomerTable,MineTable,StationTable,WarehouseTable}.tsx`.
Numeric inputs (`type="number"` → also mono) — `components/workspace/SolveDialog.tsx`, `components/workspace/tabs/{LaneCostsTab,LegDistancesTab,OptimizationParametersTab,WarehousesTab,MinesTab,CustomersTab,DistancesTab,StationsTab}.tsx`, `components/workspace/map/dialogs/{EditWarehouseDialog,EditCustomerDialog,CreateEntityDialog}.tsx`, `components/tables/{CustomerTable,MineTable,StationTable,WarehouseTable}.tsx`.
(*already handled in T3/T7/T10 — re-verify only, don't double-edit.)
**Excluded (dead):** `components/MapBulkEditToolbar.tsx` (rendered only by dead `Studio.tsx` — grep-confirmed consumers: `Studio.tsx` + its tests), `pages/Studio.tsx`, `ui/calendar.tsx` (no date UI), `ui/chart.tsx` (recharts internal), `BrazilMap.tsx` (already mono).
**Also run a raw-numeric-JSX pass:** the formatter/`type="number"` greps miss identifier/stat displays that render a number via a bare `{someNumber}` or a `-stat`/`-position`/`-count`/`-value` testid (e.g. the result-history position above). During T9, grep each listed file for `data-testid=".*\(stat\|count\|position\|value\|distance\|objective\)"` and bare numeric JSX and mono those too.

**Rule:** every rendered number and every numeric `<input>` value gets `font-mono` (Tailwind class, or `style={{fontFamily:"var(--app-font-mono)"}}` for inline-styled spots). Prose/labels stay sans. Kickers already mono via `.scnd-kicker`.

- [x] **Step 1 (test):** pick 3 representative surfaces (a table numeric cell, a numeric input, the CostSummary stat) and assert the numeric element carries `font-mono` in RTL. Run → fails where not yet applied.
- [x] **Step 2:** apply `font-mono` to the numeric render/input in each enumerated file. Where a file already has partial mono (tables, ConstraintChips), only fill gaps — grep each file for the formatter/`type="number"` and confirm the enclosing element is mono.
- [x] **Step 3:** `pnpm --filter studio test` green; typecheck. **Commit** — `[bundle3-T9] mono-numbers pass (enumerated surfaces)`.

### Task 11: Playwright computed-style smoke

**Files:** Create `artifacts/studio/e2e/design-system.spec.ts`.

- [x] **Step 1:** mirror the existing `e2e/workspace-ux-r1-r9.spec.ts` setup (dev-proxy, disposable account). Assert via real-browser `getComputedStyle`:
  - Landing AppShell header background ≈ ink `rgb(24, 26, 21)`; a primary button color ≈ green-600.
  - a `Card` `borderRadius` = `6px` (not 8).
  - a `Card`'s `boxShadow` equals the **exact expected** small shadow (`rgba(24, 26, 21, 0.06) 0px 1px 2px 0px`), NOT merely `!== "none"` — a transparent `rgba(.../0)` would pass `!== none` but be invisible; and a dialog's `boxShadow` is the overlay value while a Switch thumb's is the small value (proves Step 5b's decouple).
  - **focus-state contrast:** open a `Select`/dropdown, focus an option, read the focused option's `color` (≈ ink `rgb(24,26,21)`) over its `background` (≈ green-400) — guards finding 1's AA fix.
  - a band-colored route/legend swatch resolves to a `--band-*` value.
  - the band hero title "Network Design Labs" is visible and body "Labs" still present.
- [x] **Step 2:** run locally per the repo's e2e instructions (start api-server + studio with `API_PROXY_TARGET`, then `npx playwright test design-system.spec.ts`). If the env can't run e2e in the execution sandbox, mark the spec written-but-not-run and flag for the live-verify step (same convention as prior bundles).
- [x] **Step 3: Commit** — `[bundle3-T11] design-system Playwright smoke`.

---

## Final gate + live verify (controller)

- [x] Run the full canonical gate on the merged branch:
```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
  (Solver pytest expected unaffected — no Python touched; run it per the gate contract anyway. `e2e_accuracy.py`/`e2e_journey.py` not run.)
- [x] **Live-verify** in a real browser (local dev, disposable account, purged after) across ≥2 models (p-median-us + one other): Landing dark band + green serif "Network Design Labs" + body "Labs"; auth band; Workspace band header; sidebar green left-rule active row; mono stats everywhere; band-colored routes + legend using the 5-color scale; map single/multi-select rings still distinguishable; 6px card radii; hairlines. Screenshot-check contrast (green-on-white, band-fg-on-band).
- [x] Update `CLAUDE.md` v0.3 progress with the Bundle 3 outcome.
- [x] Finish per `superpowers:finishing-a-development-branch` (merge to local main, push, deploy both Render services, prod-smoke).

## Review comments (2026-09-03, rev 1, verbatim)

> **Blockers.** (1) Accent foregrounds fail contrast on live Radix controls — T1 sets
> `--accent-foreground`/`--sidebar-accent-foreground` white over green-400; `select.tsx` uses
> `focus:bg-accent focus:text-accent-foreground`, so focused option text is only 2.31:1; readme reserves
> green-400 for marks, green-600 for AA text, and rev-2 spec places `--sidebar-accent-foreground` in the
> ink group — use ink on green-400 (or a pale-green surface with green-700/ink text) + a real-browser
> focus contrast check; amend the spec too. (2) `.scnd-kicker` (`--text-muted` #5B5F54) is 2.68:1 on
> `--surface-band` #181A15 where T3/T4/T6 use it — add `.scnd-band .scnd-kicker { color: var(--ink-300); }`
> (8.02:1). (3) Global shadow remap unsafe — `--shadow-lg`→30px overlay also hits the Switch thumb
> (`switch.tsx` uses `shadow-lg`); T1 deletes `--shadow-xs` though Buttons/Badges use it; separate overlay
> from utility depth, keep Switch small, T11 must assert non-transparent/exact shadow (`!== "none"` passes
> an invisible `rgba(.../0)`).
> **Coverage.** (4) T9 mono list not exhaustive — omits `Workspace.tsx` `text-result-history-position`
> and `MoveConfirmDialog.tsx` lat/lng; `MapBulkEditToolbar.tsx` is dead-Studio-only; supplement the grep
> with raw numeric JSX. (5) T10 leaves `BAND_COLORS` as duplicated hex literals + a comment — return
> `var(--band-N)` (or another single-source mechanism) + a static contract proving token refs. (6) T8 puts
> the active TabBar rule on the bottom; the reference `TabBar.jsx` uses `inset 0 2px 0 var(--green-500)`, a
> top rule — match it. (7) The contract test validates samples — enumerate every `@theme`-mapped token +
> the complete raw inventory, assert pinned values, assert no transparent shadow placeholders. (8) T3 omits
> `App.tsx` (Step 3 edits the root route there) — add it + `App.test.tsx`; pin the NotFound no-title
> fallback markup + assert both branches. (9) T8 allows `--demand-*` in MapLegend, which can drift from
> T10's `--map-customer`/`--map-customer-stroke` markers — require the exact token pair in both.

## Review resolution (2026-09-03, rev 1)

Reviewer raised 9 issues on the first plan draft; all verified against code and fixed:

1. **Accent foreground contrast** — `select`/`dropdown` render `focus:text-accent-foreground` over
   `--accent` (green-400); white was 2.31:1. Fixed to **ink** (`84 11% 9%`, ~8.2:1) for
   `--accent-foreground` + `--sidebar-accent-foreground` in T1 Step 2; **spec amended** too; T11 adds a
   real-browser focus-state contrast check. `--accent` kept green-400 (needed for `--accent-300/600/700`
   map derivation).
2. **On-band kicker contrast** — added `.scnd-band .scnd-kicker { color: var(--ink-300); }` (8.02:1) in
   T1 Step 7; light-surface kickers keep `--text-muted`.
3. **Shadow remap safety** — audited every `ui/*` shadow consumer; added `--shadow-xs` (buttons/badges
   need it), and T1 Step 5b decouples the Switch thumb (`shadow-lg`→`shadow-sm`) so overlay-`lg` serves
   dialogs/dropdowns only. T11 asserts exact (not `!== none`) shadows.
4. **Mono list** — added `Workspace.tsx` (`text-result-history-position`) + `MoveConfirmDialog.tsx`
   (lat/lng); removed dead `MapBulkEditToolbar.tsx` (Studio-only, grep-confirmed); added a raw-numeric-JSX
   pass.
5. **bandPalette authoritative** — `BAND_COLORS` returns `var(--band-N)` (single source of truth); test
   is a static contract asserting the var refs (a literal-hex array would fail).
6. **TabBar rule edge** — corrected to the reference's **top** inset rule (`inset 0 2px 0
   var(--green-500)`), not a bottom border.
7. **Contract test exhaustive** — T2 now enumerates every `@theme`-mapped token (HSL) + the complete
   raw-token inventory (hex) via `it.each`, pins critical values, and asserts no transparent shadow
   placeholders remain.
8. **T3 file boundary** — added `App.tsx`/`App.test.tsx`; pinned the NotFound fallback wordmark markup
   and both-branch assertions.
9. **MapLegend/marker parity** — legend customer swatch must use the exact `--map-customer` /
   `--map-customer-stroke` pair T10 gives the markers; `--demand-*` only for a genuine demand-scale row.

## Re-review comments (2026-09-03, rev 2, verbatim)

> **Blockers.** (1) T1 guarantees T2's test fails: T1 removes `--chart-1..5: red` from `:root` but leaves
> the rest of `.dark` untouched, while `.dark` still defines all five red chart placeholders and T2
> rejects that pattern anywhere. Remove/replace the `.dark` chart placeholders in T1 too. (2) T10 maps
> both `#64748B` and `#94A3B8` to `--map-default-stroke`, but in the customer marker `#94A3B8` is the fill
> and `#64748B` is the stroke — map them to `--map-customer`/`--map-customer-stroke`; also name the exact
> destination token for the `#15803D` highlighted state instead of "+ a highlighted step".
> **Coverage/execution safety.** (3) T9 omits `ServiceStatsTab.tsx`, whose band and percentage cells
> render raw numbers without `font-mono`; the spec includes Service Stats — add it + assertions. (4)
> Opening file inventory is stale: assigns only `index.css` to T1 though T1 also edits `ui/switch.tsx`,
> and omits `App.tsx`/`App.test.tsx` from T3 though the task includes them — update both. (5) T7 uses
> `var(--surface-card, #fff)` but `--surface-card` is never defined and T2 doesn't inventory it — use
> `hsl(var(--card))` or add the token; don't depend on a fallback.
> **Ambiguities.** (6) T8 first requires the exact customer fill/stroke pair, then permits `--demand-*`
> for the demand-bubble scale — but that legend is precisely customer bubbles at three sizes; remove the
> exception or name a genuinely distinct `--demand-*` consumer. (7) The global "preserve every DOM
> structure / never restructure" rule conflicts with T3-T6 (new hero wrappers/band headers) — narrow the
> freeze to interactive/Radix structure, roles, testids, and the six close-match components, and
> explicitly allow the additive brand-chrome markup those tasks require.

## Review resolution (2026-09-03, rev 2)

All 7 verified against code and fixed:

1. **`.dark` chart red** — T1 Step 4 now removes the `.dark` `--chart-1..5: red` lines too (confirmed at
   L495-499); T2's whole-file scan then passes.
2. **Customer marker fill/stroke** — confirmed L498 fill `#94A3B8` / L514 stroke `#64748B`; T10 Step 3 now
   maps them to `--map-customer`/`--map-customer-stroke` (distinct from the warehouse-triangle stroke,
   which stays `--map-default-stroke`), and names `#15803D` → `var(--green-700)` exactly.
3. **ServiceStatsTab** — added to T9 (confirmed raw `≤ {b.band}` / `{b.percent}%` at ~L62/66, no mono).
4. **Inventory sync** — top File Structure + T1 `Files:` now include `ui/switch.tsx`; T3 line + inventory
   include `App.tsx`/`App.test.tsx`.
5. **T7 token** — uses existing `hsl(var(--card))`, not an undefined `--surface-card`.
6. **Demand exception** — removed; MapLegend demand-bubble size samples + EntityMarkers customer bubbles
   both use `--map-customer`/`--map-customer-stroke` (supply=ink triangles vs demand=green bubbles is
   already distinct under book-cover, so no separate demand green is needed).
7. **DOM-freeze constraint** — narrowed to Radix/interactive structure + roles + testids + the six
   close-match components; additive brand-chrome markup on T3-T6 chrome surfaces explicitly allowed.

## Self-review (run before dispatch — the discipline the post-mortems named)

1. **Every code reference has a receipt.** All file paths/line refs above came from grep/read this session (map colors L34–L607, mono surfaces from the formatter/`type=number` greps, `AppShell.tsx:35`, `App.tsx:39`, `bandPalette.ts`). ✓
2. **Every mechanism verified, not assumed.** Shadows via `@theme` (confirmed `@theme` has no shadow keys today); radii pinned (confirmed calc math); `--app-font-serif` set (confirmed `@theme` maps `font-serif` through it); contract test reads source not jsdom (confirmed studio vitest = jsdom). ✓
3. **Exhaustive lists, not samples.** Mono-numbers = the full grep output; map colors = every hardcoded hex in the three files. ✓
4. **Constraint cross-read.** Copy rule (additive) consistent across Global Constraints / T3 / T5; "no `modelId===`" honored (T10 uses tokens, not model branches); testids frozen asserted per task. ✓
5. **The one open risk was closed, not deferred:** T10's `var()`-in-SVG question — verified both map components use `L.divIcon({html})` (in-document), so `var()` resolves; no fallback needed. Recorded in T10 Step 3.
