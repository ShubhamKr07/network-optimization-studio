# Design Upgrade Phase 5 Implementation Plan (dark mode)

> **Execution:** agent-team dispatch per `AGENTS.md`, as in Phases 1–4.
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-5.N -b du-5.N-work <design-upgrade-p5 tip>`) and dispatches without `isolation`. The agent's first Bash command is `cd` plus a branch check. The lead fast-forwards or cherry-picks each commit onto `design-upgrade-p5`.
> - **Roles:** DU-5.1, DU-5.2 and DU-5.3 are studio-only: `frontend-engineer`, reviewed by the lead on Opus with `ponytail-review`. DU-5.4: `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - Tasks run sequentially, in listed order, and every task's commit is green on its own. Steps use checkbox (`- [ ]`) syntax.

**Goal:** implement spec §5.5 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md:279-286`, decision D6): a brand-derived dark theme (ink surfaces, paper text, olive accents) that is actually applied, a light / dark / system control that follows `prefers-color-scheme` by default, and both themes checked against the §5.1.3 contrast targets.

**Architecture:**
- **Tokens:** the dead blue `.dark` block (`artifacts/studio/src/index.css:318-367`, never applied today) is replaced by a complete brand-derived block. Tailwind's `@custom-variant dark (&:is(.dark *))` (`index.css:34`) already keys off a `.dark` class on an ancestor, so the theme is one class on `<html>`.
- **Maps stay light (Q1).** OpenStreetMap tiles are light and the spec forbids a new tile provider, so every map is a **light island**: the light token block's selector becomes `:root, .dark .map-surface`, and each map wrapper carries `map-surface`. Lanes, markers, legend, popups and map toolbars keep today's light values and gates in both themes. Band colours *off* the map (`BandLabel` in tables) use a dark-surface band ramp.
- **Theme state:** `lib/theme.ts` (master §A interface) owns the preference, `localStorage` under `nos:theme-pref` with try/catch on every access, and the `<html>` class. A five-line inline script in `index.html` applies the class before first paint. A `ThemeToggle` segmented control sits in the AppShell and Workspace headers.
- **Unchanged:** API, solver, DB, exports, every map visual, and the light theme. Every light-mode value a task touches is replaced by a token with the identical light value (DU-5.2 asserts this), so light mode renders the same.

**Tech stack:** React 18 + Vite + Tailwind v4 (`@theme inline`, `@custom-variant`), vitest + RTL (jsdom), Playwright.

## Global Constraints

The master plan's Global Constraints (`2026-10-24-design-upgrade.md:22-56`) bind every task. In addition:

**Contracts**
- Fixed interface (master §A, verbatim): `lib/theme.ts`: `type ThemePref = "light" | "dark" | "system"; getThemePref(): ThemePref; setThemePref(p: ThemePref): void; applyTheme(p: ThemePref): void`.
- Storage key `nos:theme-pref` (mirrors `nos:display-unit-pref`, `contexts/UnitContext.tsx:16`). Default `"system"`. Every `localStorage` read and write is wrapped in try/catch, and the app renders correctly with storage throwing.
- The light token values do not change. New light-side token: only `--text-primary` (= `#48611E`, the existing `--green-700`), added so primary-coloured text can flip in dark.

**Colour rules**
- Dark values below were computed against the gates on 2026-10-29 (numbers in Decisions Q2). They are proposed under Q2 and need user approval, as the light band shades did on 2026-10-24. An implementer may not change a value to get a gate green; a failing gate is a STOP-and-report.
- Red stays for errors only. Overflow stays violet (light `#7C3AED`; dark `#A78BFA`, violet-400).
- The map light island is the dark value for every `--map-*`, `--accent*`, `--demand*` token and for the band ramp *on the map*.

**Per-task obligations**
- **Sweep:** rg `artifacts/studio/src` and `artifacts/studio/e2e/` for every changed class, token, testid and string, and fix all hits in the same commit.
- **Changelog:** append `### DU-5.N — …` to `docs/CHANGELOG-implementation.md` in the same commit.
- **Gate (per task):** `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`, with zero concurrent vitest, one suite at a time, never `pkill`. `pnpm gate` exit 3 means re-run serially, not failure. No api-server/solver change is in scope, so `e2e_accuracy.py`/`e2e_journey.py` are not phase gates (master: Phases 4 and 6 only); `pnpm gate` still runs pytest.
- **Gate (close-out):** `pnpm gate` and `E2E_BASE_URL=http://localhost:<port> pnpm e2e:gate`.
- **Commit:**
  1. Guard the branch: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`.
  2. Build a static path list `P`, stage it, and check `git diff --cached --name-only` equals `P`.
  3. `git commit --only ${=P} -m "[DU-5.N] …"` (no `--` before the paths; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Decisions

Q1 and Q2 need the user. The rest are technical defaults, open to change at plan review.

| ID | Default applied | Task |
|---|---|---|
| Q1 | **Maps stay light in dark mode (light island).** OSM tiles are light (`#F2EFE9` land) and spec §5.5 says "no new tile provider". A dark-tile alternative (CSS `filter: invert(1) hue-rotate(180deg)` on `.leaflet-tile-pane`) would make the ink warehouse markers (`--map-warehouse #181A15`) vanish, need a second band ramp gated against a filter-derived tile colour, and redo the Phase 3 map QA. With the island, every map visual and gate is unchanged and map overlays stay legible. **Deviation from master §A** ("band vs dark tile" gate): there is no dark tile, so the on-map gate stays the light one, and the dark band ramp is gated against the dark card instead, where `BandLabel` draws it. **Needs user approval.** | 5.1 |
| Q2 | **New dark colour values** (master constraint C3 allows only the listed new colours, so these need approval). Surfaces from the ink scale: background `#181A15` (ink-900), card/popover `#23261F` (ink-800), muted `#33362E` (ink-700), border `#3A3D34`, input/line-strong `#5B5F54` (ink-500). Text: body `#FCFCFA` (paper, 17.1:1 on bg), muted `#ADB1A4` (ink-300, 8.0:1), faint `#83887A` (ink-400, 4.8:1), brand `#93B747` (green-400, 7.6:1), primary text `#AFC975` (green-300, 9.6:1). Primary fill `#7DA436` (green-500) with ink text (6.0:1). Dark band ramp (off-map), one olive hue at five steps: `#E5EFD4 #B5D185 #8BB444 #749639 #5F7B2F` — vs dark card 12.9 / 9.1 / 6.4 / 4.5 / 3.2:1, adjacent 1.42 / 1.43 / 1.41 / 1.41:1. Status text on -bg: success `#4ADE80`/`#052E16` 8.6:1, warning `#FBBF24`/`#2A1E05` 9.8:1, danger `#F87171`/`#2C0B0B` 6.6:1, info `#38BDF8`/`#082030` 7.8:1 (Tailwind 400 text on 950-ish bg, the same family the light set uses). **Needs user approval.** | 5.1 |
| Q3 | **Destructive in dark = light red fill with ink text** (`--destructive` `#F87171`, `--destructive-foreground` ink-900; 7.3:1). One token pair serves both `bg-destructive` buttons and ~40 `text-destructive` error lines. No red satisfies white-text-on-fill ≥ 4.5 *and* text-on-dark-bg ≥ 4.5 at once (needs luminance ≤ 0.18 and ≥ 0.22), so keeping white-on-red would leave every dark error line at ≤ 3.9:1. | 5.1 |
| Q4 | **Four tasks, not master's three.** Master DU-5.1 (tokens) and DU-5.2 (control) leave out the surfaces that hard-code light: 16 `bg-white`, 9 `bg-primary text-white`, and ~12 `var(--green-700)` text sites. They get their own task (DU-5.2) with a source guard, so the token task stays reviewable. The control becomes DU-5.3 and QA DU-5.4. The §A `lib/theme.ts` interface is unchanged. | all |
| Q5 | **Hand-rolled `lib/theme.ts`, not the installed `next-themes`.** Overkill check: `next-themes` is in `package.json` (only an unused `components/ui/sonner.tsx` imports it), but it needs a provider, its no-flash script only helps SSR, and §A fixes a plain-function interface. The hand-rolled module is ~25 lines on the `UnitContext.tsx` precedent, and the inline script is needed in a Vite SPA either way. | 5.3 |
| Q6 | **Toggle placement:** AppShell header (both the hero and compact variants, before Log out) and the Workspace header (beside `UnitToggle`, `Workspace.tsx:4636`). Not on the login/register pages (`AuthShell`); they follow the stored or system preference. | 5.3 |
| Q7 | **Default is `system`**, per spec. Students whose OS is dark see the dark theme on first load after deploy, with no action. | 5.3 |
| Q8 | **The ink header band stays ink in both themes** (`.scnd-band`, `--surface-band #181A15`); in dark it meets an ink page and is separated by its existing 2px `--green-400` bottom border. Raw `--ink-*`/`--green-400` uses on the band (AppShell, AuthShell, Workspace header `:4593-4629`) are correct in both themes and are allow-listed in DU-5.2's guard. | 5.2 |
| Q9 | **Eight dormant `dark:` utilities** (shadcn `input-group`, `field`, `alert`, `kbd`) become live. They are shadcn's own dark defaults; DU-5.4 checks them in the browser and no task edits them pre-emptively. | 5.4 |

All paths below are relative to `artifacts/studio/` unless noted.

---

### Task DU-5.1: Dark token set, map light island, both-theme gates

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Files:**
- Modify `src/index.css`: replace the `.dark { … }` block (`:318-367`); change the light block's selector (`:148`) from `:root {` to `:root, .dark .map-surface {`; add `--text-primary: #48611E;` to the light block's raw-text line (`:224`); add `color-scheme` lines.
- Modify the wrapper `div` that contains each `<MapContainer>`, adding the class `map-surface`: `src/components/NetworkMap.tsx:740`, `src/components/workspace/tabs/InputMapTab.tsx` (4 maps: `:808`, `:1301`, `:1799`, `:2385`), `src/components/workspace/super/SuperInputMap.tsx:107`. rg `<MapContainer` at task time; the guard test fails on any map left without it.
- Modify `src/__tests__/designTokens.test.ts`: dark gates + light-island guard.

**Interfaces:**
- Produces: `.dark` complete token block; `.map-surface` class contract (light tokens inside a dark page); `--text-primary` token (light `#48611E`, dark `#AFC975`); `contrast()` already exported from `designTokens.test.ts`.

- [ ] **Step 1: Failing tests.** In `designTokens.test.ts` add a `DARK` slice and the gates:

```ts
const DARK = CSS.slice(CSS.indexOf(".dark {"), CSS.indexOf("}", CSS.indexOf(".dark {")));
function darkToken(name: string): string {
  const m = DARK.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token ${name} not found as a hex literal in .dark`);
  return m[1];
}
const DARK_BG = "#181A15";   // --background 84 11% 9%
const DARK_CARD = "#23261F"; // --card 86 10% 14%, where BandLabel draws off-map bands

describe("dark theme (DU-5.1, spec §5.5)", () => {
  it("band ramp on the dark card: each >= 3:1, adjacent >= 1.4:1, near = light -> far = dark", () => {
    const bands = [0, 1, 2, 3, 4].map(i => darkToken(`--band-${i}`));
    for (const b of bands) expect(contrast(b, DARK_CARD)).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 4; i++) {
      expect(contrast(bands[i], bands[i + 1])).toBeGreaterThanOrEqual(1.4);
      expect(lum(bands[i])).toBeGreaterThan(lum(bands[i + 1]));
    }
  });
  it("overflow stays violet", () => {
    expect(darkToken("--band-overflow").toUpperCase()).toBe("#A78BFA");
  });
  for (const s of ["success", "warning", "danger", "info"]) {
    it(`--${s} on --${s}-bg >= 4.5:1`, () => {
      expect(contrast(darkToken(`--${s}`), darkToken(`--${s}-bg`))).toBeGreaterThanOrEqual(4.5);
    });
  }
  for (const t of ["--text-body", "--text-muted", "--text-brand", "--text-primary", "--link"]) {
    it(`${t} >= 4.5:1 on background and card`, () => {
      expect(contrast(darkToken(t), DARK_BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(darkToken(t), DARK_CARD)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("--text-faint stays decorative-only but is not invisible (>= 3:1)", () => {
    expect(contrast(darkToken("--text-faint"), DARK_BG)).toBeGreaterThanOrEqual(3);
  });
  it("background and card hsl triples match the hex the gates assume", () => {
    expect(DARK).toMatch(/--background:\s*84 11% 9%/);
    expect(DARK).toMatch(/--card:\s*86 10% 14%/);
  });
});

describe("map light island (DU-5.1, Q1)", () => {
  it("the light token block also applies inside .dark .map-surface", () => {
    expect(CSS).toMatch(/:root,\s*\.dark \.map-surface\s*\{/);
  });
  it("the dark block declares no --map-* token (maps keep light values)", () => {
    expect(DARK).not.toMatch(/--map-/);
  });
  it("every file rendering a <MapContainer> wraps it in .map-surface", () => {
    const files = walk(resolve(__dirname, "..")).filter(f => /\.tsx$/.test(f) && !f.includes("__tests__"));
    const mapFiles = files.filter(f => readFileSync(f, "utf8").includes("<MapContainer"));
    expect(mapFiles.length).toBeGreaterThanOrEqual(3); // non-vacuity: NetworkMap, InputMapTab, SuperInputMap
    for (const f of mapFiles) {
      const src = readFileSync(f, "utf8");
      const maps = src.split("<MapContainer").length - 1;
      const surfaces = (src.match(/\bmap-surface\b/g) ?? []).length;
      expect(surfaces, f).toBeGreaterThanOrEqual(maps);
    }
  });
});
```

Add a `walk` helper beside `token()` (`readdirSync` recursive, `statSync().isDirectory()`); add `readdirSync, statSync` to the `node:fs` import. Add `--text-primary` to the light test: `expect(token("--text-primary").toUpperCase()).toBe("#48611E")`.

- [ ] **Step 2:** `pnpm --filter studio test -- designTokens` — expect the new cases to FAIL (no hex tokens in `.dark`, no island selector).

- [ ] **Step 3: Replace the `.dark` block** with:

```css
.dark {
  color-scheme: dark;
  --button-outline: rgba(255,255,255, .10);
  --badge-outline: rgba(255,255,255, .05);
  --opaque-button-border-intensity: 9;
  --elevate-1: rgba(255,255,255, .04);
  --elevate-2: rgba(255,255,255, .09);

  /* DU-5.1 — brand-derived dark: ink surfaces, paper text, olive accents.
     Values gated by designTokens.test.ts; approved under phase-5 plan Q2. */
  --background: 84 11% 9%;  --foreground: 60 25% 98%;
  --border: 80 8% 22%;
  --card: 86 10% 14%;       --card-foreground: 60 25% 98%;  --card-border: 80 8% 22%;
  --popover: 86 10% 14%;    --popover-foreground: 60 25% 98%; --popover-border: 80 8% 22%;
  --sidebar: 86 10% 14%;    --sidebar-foreground: 60 25% 98%; --sidebar-border: 80 8% 22%;
  --sidebar-primary: 81 50% 43%; --sidebar-primary-foreground: 84 11% 9%;
  --sidebar-accent: 79 44% 50%;  --sidebar-accent-foreground: 84 11% 9%;
  --sidebar-ring: 79 44% 50%;
  --primary: 81 50% 43%;    --primary-foreground: 84 11% 9%;
  --secondary: 83 10% 16%;  --secondary-foreground: 60 25% 98%;
  --muted: 82 8% 20%;       --muted-foreground: 78 8% 67%;
  --accent: 79 44% 50%;     --accent-foreground: 84 11% 9%;
  --destructive: 0 91% 71%; --destructive-foreground: 84 11% 9%; /* Q3: ≈#F87272 fill, ink text */
  --input: 82 6% 35%;
  --ring: 79 44% 50%;

  --success: #4ADE80; --success-bg: #052E16; --success-border: #166534;
  --warning: #FBBF24; --warning-bg: #2A1E05; --warning-border: #92400E;
  --danger: #F87171;  --danger-bg: #2C0B0B;  --danger-border: #991B1B;
  --info: #38BDF8;    --info-bg: #082030;    --info-border: #075985;
  --utilization: #93B747;

  /* off-map band ramp (BandLabel on cards); the map keeps the light ramp via .map-surface */
  --band-0: #E5EFD4; --band-1: #B5D185; --band-2: #8BB444; --band-3: #749639; --band-4: #5F7B2F;
  --band-overflow: #A78BFA;

  --chart-1: 79 44% 50%; --chart-2: 78 8% 67%; --chart-3: 79 40% 72%;
  --chart-4: 26 87% 55%; --chart-5: 81 5% 58%;
  --chart-grid: #33362E; --chart-axis-label: #ADB1A4;

  --text-body: #FCFCFA; --text-muted: #ADB1A4; --text-faint: #83887A; --text-brand: #93B747; --text-primary: #AFC975;
  --surface-band: #181A15; --surface-band-fg: #FCFCFA; --surface-selected: #2A3318; --surface-sunken: #1E201A;
  --line: #3A3D34; --line-strong: #5B5F54;
  --primary-hover: #93B747; --primary-active: #AFC975; --link: #AFC975; --link-hover: #CDDCA6; --focus-ring: #93B747;
}

.dark .map-surface { color-scheme: light; }
```

Change `:root {` (`:148`) to `:root, .dark .map-surface {`. Add `--text-primary: #48611E;` to the light raw-text line. Before relying on the island, check by reading the light block that every token in it is a plain declaration (the `@supports`-less relative-colour pairs at `:254-316` re-derive per element, so they re-evaluate correctly inside `.map-surface`; comment `:280-286` already states this).

- [ ] **Step 4:** add `map-surface` to each map wrapper `className` (no other change to those elements).
- [ ] **Step 5:** `pnpm --filter studio test -- designTokens` — PASS. A failing gate is a STOP: report the value and the measured ratio; do not adjust a value.
- [ ] **Step 6:** gate (Global Constraints), `ponytail-review`, changelog `### DU-5.1 — dark token set, map light island`, commit `[DU-5.1] brand-derived dark tokens, map light island, both-theme gates`.

---

### Task DU-5.2: Themed surfaces stop hard-coding light (studio only)

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Rule:** every replacement uses a token whose **light value is identical** to what it replaces, so light mode is unchanged:

| Replace | With | Light value (identical) |
|---|---|---|
| `bg-white` (not `hover:bg-white/10` on the ink band) | `bg-card` | `--card: 0 0% 100%` = `#FFFFFF` |
| `text-white` paired with `bg-primary` | `text-primary-foreground` | `0 0% 100%` |
| `var(--green-700)` as a text colour (`text-[var(--green-700)]`, `color: "var(--green-700)"`) | `var(--text-primary)` | `#48611E` |
| `var(--green-600)` as a text/icon colour | `var(--text-brand)` | `#5F7F28` |

A site with no identical-value token is a STOP-and-report, not an invention.

**Files (known, from rg on 2026-10-29; the sweep catches the rest):**
- `bg-white` → `bg-card`: `components/UnitToggle.tsx:31`, `components/NetworkMap.tsx:740`, `components/MapBulkEditToolbar.tsx:41`, `components/tables/WarehouseTable.tsx:162`, `components/tables/CustomerTable.tsx:188`, `components/workspace/tabs/JadeFlowsTab.tsx:447,458`, `components/workspace/tabs/OptimizationParametersTab.tsx:394`, `components/workspace/map/mapControls.tsx:136`, `components/data-table/entityCells.tsx:46`, `components/ConstraintChips.tsx:69`, `pages/Landing.tsx:182`. (Sites inside `.map-surface` — `NetworkMap.tsx:740`, `MapBulkEditToolbar`, `mapControls` — still migrate: inside the island `bg-card` resolves to white.)
- `text-white` with `bg-primary`: the same toggle/segment sites above.
- `--green-700` text: `components/workspace/SolveDialog.tsx:161`, `components/workspace/tabs/OptimizationParametersTab.tsx:375`, `components/workspace/tabs/InputMapTab.tsx:798,1291,1789,2375`, `pages/Workspace.tsx:4712`, `pages/Landing.tsx:141`, `components/ui/button.tsx:28`, `components/ui/field.tsx:148`, `components/ui/empty.tsx:76`, `components/ui/item.tsx:138`.
- `--green-600` icon colour: `components/DeveloperCredit.tsx:10,13`.
- Create `src/__tests__/themeSurfaceGuard.test.ts`.

- [ ] **Step 1: Failing guard.** Walk `src/` (non-test `.ts`/`.tsx`), fail on any match not in the allow-list:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// DU-5.2 — surfaces that hard-code a light colour do not flip in dark mode.
// Walks the whole tree (root CLAUDE.md: prefer a tree walk over a file list).
const SRC = resolve(__dirname, "..");
const PATTERNS: Array<[string, RegExp]> = [
  ["bg-white", /\bbg-white\b(?!\/)/],
  ["text-white", /\btext-white\b/],
  ["raw palette var", /var\(--(?:ink|green)-\d{3}\)/],
];
// file -> reason. Each entry must still match (stale entries fail).
const ALLOWED: Record<string, string> = {
  "components/AppShell.tsx": "ink header band: --ink-300 / --green-400 are correct in both themes (Q8)",
  "components/auth/AuthShell.tsx": "ink header band (Q8)",
  "pages/Workspace.tsx": "ink header band :4593-4629 (Q8)",
  "components/NetworkMap.tsx": "inside .map-surface: map marker highlight --green-700 is a map colour (Q1)",
};
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "__tests__" ? [] : walk(p)) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("themed surfaces (DU-5.2)", () => {
  const files = walk(SRC);
  it("scans the tree (non-vacuity)", () => expect(files.length).toBeGreaterThan(100));
  it("no hard-coded light surface outside the allow-list", () => {
    const hits = files.flatMap(f => {
      const rel = relative(SRC, f);
      if (rel in ALLOWED) return [];
      const src = readFileSync(f, "utf8");
      return PATTERNS.filter(([, re]) => re.test(src)).map(([name]) => `${rel}: ${name}`);
    });
    expect(hits).toEqual([]);
  });
  it("every allow-list entry still contains a pattern", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const src = readFileSync(join(SRC, rel), "utf8");
      expect(PATTERNS.some(([, re]) => re.test(src)), rel).toBe(true);
    }
  });
});
```

`DeveloperCredit.tsx` renders in the AppShell/AuthShell footers on the page surface, not the band, so it migrates (its `--green-600` icon colours) rather than being allow-listed. Verify each `AuthShell.tsx` raw-palette use sits on its ink panel (`:26` `--surface-band`) before keeping that entry.

- [ ] **Step 2:** run it — expect FAIL listing the files above.
- [ ] **Step 3:** apply the replacement table. Do not touch `hover:bg-white/10` on the band. Update any RTL test asserting the old class (rg `bg-white\|text-white\|green-700` in `src/__tests__`).
- [ ] **Step 4:** guard PASS; full studio suite green.
- [ ] **Step 5:** gate, `ponytail-review`, changelog, commit `[DU-5.2] themed surfaces use tokens instead of hard-coded light colours`.

---

### Task DU-5.3: Theme control (`lib/theme.ts`, no-flash script, header toggle)

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Files:**
- Create `src/lib/theme.ts`, `src/lib/__tests__/theme.test.ts`, `src/components/ThemeToggle.tsx`, `src/__tests__/ThemeToggle.test.tsx`.
- Modify `index.html` (inline script in `<head>`), `src/main.tsx` (apply + OS listener), `src/components/AppShell.tsx` (both header variants, before Log out), `src/pages/Workspace.tsx` (beside `<UnitToggle />`, `:4636`).

**Interfaces:**
- Produces (master §A): `ThemePref`, `getThemePref`, `setThemePref`, `applyTheme`. `ThemeToggle` with testids `theme-toggle`, `theme-toggle-light|dark|system`.

- [ ] **Step 1: Failing tests** `lib/__tests__/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getThemePref, setThemePref, applyTheme } from "@/lib/theme";

function mockSystemDark(dark: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn() }) as never;
}
beforeEach(() => { localStorage.clear(); document.documentElement.classList.remove("dark"); vi.restoreAllMocks(); });

describe("theme preference (DU-5.3)", () => {
  it("defaults to system", () => expect(getThemePref()).toBe("system"));
  it("ignores an invalid stored value", () => { localStorage.setItem("nos:theme-pref", "purple"); expect(getThemePref()).toBe("system"); });
  it("round-trips a stored value", () => { mockSystemDark(false); setThemePref("dark"); expect(getThemePref()).toBe("dark"); });
  it("survives storage that throws on read and write", () => {
    mockSystemDark(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getThemePref()).toBe("system");
    expect(() => setThemePref("dark")).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true); // applied even if not persisted
  });
  it("system follows prefers-color-scheme", () => {
    mockSystemDark(true); applyTheme("system"); expect(document.documentElement.classList.contains("dark")).toBe(true);
    mockSystemDark(false); applyTheme("system"); expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
  it("explicit light/dark override the OS", () => {
    mockSystemDark(true); applyTheme("light"); expect(document.documentElement.classList.contains("dark")).toBe(false);
    mockSystemDark(false); applyTheme("dark"); expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
  it("index.html's no-flash script uses the same storage key", () => {
    expect(readFileSync(resolve(__dirname, "../../../index.html"), "utf8")).toContain("nos:theme-pref");
  });
});
```

- [ ] **Step 2:** run — FAIL (module missing).
- [ ] **Step 3: `src/lib/theme.ts`:**

```ts
// DU-5.3 — master §A interface. Mirrors UnitContext's storage handling:
// every localStorage access is wrapped, and the app renders without storage.
// index.html carries a copy of applyTheme's logic so the class lands before
// first paint; theme.test.ts pins the shared storage key.
export type ThemePref = "light" | "dark" | "system";
const STORAGE_KEY = "nos:theme-pref";

export function getThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePref(p: ThemePref): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, p);
  } catch {
    // not persisted (private mode, quota); this session still switches
  }
  applyTheme(p);
}

export function applyTheme(p: ThemePref): void {
  const dark = p === "dark" || (p === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  document.documentElement.classList.toggle("dark", dark);
}
```

- [ ] **Step 4: `index.html`** — first child of `<head>`:

```html
<script>
  try { var p = localStorage.getItem("nos:theme-pref"); } catch (e) {}
  if (p === "dark" || ((p !== "light") && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
</script>
```

- [ ] **Step 5: `src/main.tsx`** — before `createRoot`:

```ts
import { applyTheme, getThemePref } from "@/lib/theme";
applyTheme(getThemePref());
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (getThemePref() === "system") applyTheme("system");
});
```

- [ ] **Step 6: `ThemeToggle`** — same segmented shape as `UnitToggle` (already migrated to tokens by DU-5.2), own state seeded from `getThemePref()`, 24px targets:

```tsx
import { useState } from "react";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";

const OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());
  return (
    <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="Theme" data-testid="theme-toggle">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          data-testid={`theme-toggle-${value}`}
          aria-pressed={pref === value}
          onClick={() => { setThemePref(value); setPref(value); }}
          className={`text-xs px-2 min-h-6 transition-colors ${
            pref === value ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

`ThemeToggle.test.tsx`: renders three buttons with `aria-pressed` reflecting the stored pref; clicking Dark sets `aria-pressed`, persists `nos:theme-pref=dark`, adds `.dark` to `<html>`; clicking System with `matchMedia` mocked light removes it.

- [ ] **Step 7:** render `<ThemeToggle />` in `AppShell.tsx` (both header variants, before the Log out button) and in `Workspace.tsx` beside `<UnitToggle />`. Sweep RTL tests that snapshot those headers.
- [ ] **Step 8:** tests PASS; gate; `ponytail-review`; changelog; commit `[DU-5.3] theme control: light/dark/system, no-flash script, header toggle`.

---

### Task DU-5.4: Phase 5 real-browser QA (qa-sdet)

**Role:** qa-sdet (exempt from karpathy/ponytail), reviewed by a separate `fable` reviewer agent. CSS behaviour is invisible to jsdom (`artifacts/studio/CLAUDE.md`), so this task is where dark mode is actually verified.

**Files:** create `e2e/design-upgrade-p5.spec.ts`; rewrite affected sibling specs found by the sweep; flake-registry sightings if any.

- [ ] **Step 1: sibling sweep.** rg `e2e/` for `bg-white`, `text-white`, `green-700`, header testids next to which the toggle now renders, and any `toHaveCSS` colour assertion. Rewrite hits and run each changed spec green.
- [ ] **Step 2: new spec** against local servers (`E2E_BASE_URL` set; recipe in `e2e/CLAUDE.md`), seeded results (`seedSolvedResult`, as in `design-upgrade-p1/p3.spec.ts`):
  - **System default:** `page.emulateMedia({ colorScheme: "dark" })` with no stored pref → `<html>` has `dark`, `body` background computes to `rgb(24, 26, 21)`; `colorScheme: "light"` → no `dark`.
  - **Toggle:** Dark → reload keeps dark; Light overrides an OS-dark emulation; System follows a mid-session `emulateMedia` change.
  - **No storage:** a context whose `localStorage` throws (`addInitScript` overriding `Storage.prototype.getItem/setItem`) loads, renders, and still switches theme in-session.
  - **No flash:** with OS-dark emulation, the first `page.goto` response's first paint already has `dark` on `<html>` (assert via `page.evaluate` in `addInitScript` timing or `DOMContentLoaded`).
  - **All 8 chapters in dark:** Landing, each chapter's Workspace (Input Map, Output Map, one table tab, Optimization Parameters), Compare. For each: the map wrapper computes a light background inside `.map-surface`; a `BandLabel` swatch on a dark card computes to a dark-ramp value; status alerts, a destructive button, a disabled control, focus ring, and the four Q9 `dark:` shadcn pieces are legible. Attach a full-page screenshot per chapter per theme to the report for the user.
  - **Light unchanged:** the same pages in light compute `bg-card` surfaces to `rgb(255, 255, 255)` and primary text to `rgb(72, 97, 30)`.
- [ ] **Step 3: gates.** `pnpm gate`; `E2E_BASE_URL=… pnpm e2e:gate`. Record the numbers in the changelog entry; never estimate a number that wasn't measured.
- [ ] **Step 4: commit** `[DU-5.4] Phase 5 real-browser QA and sibling e2e sweep` with changelog.

---

## Phase 5 close-out

1. `superpowers:finishing-a-development-branch`, then `/harness-retro DU-5`, then STOP for merge approval (push and deploy are separate approvals).
2. **Deploy is `nos-studio` only** (no `artifacts/api-server/**`, `solvers/**`, `lib/db/**` or `lib/api-spec/**` change); confirm with `pnpm deploy:preflight -- <deployed-sha>..HEAD` on the full diff, no pathspec. Re-fetch `origin/main` immediately before the trigger: Render builds the tip, not the approved SHA.
3. Deploy note: OS-dark students get dark mode on first load (Q7).

## Self-review

- **Spec coverage (§5.5):** dead `.dark` replaced with brand-derived values (5.1 Step 3); every Phase 1 semantic token has a dark value, maps by the island (5.1, Q1); both themes against §5.1.3 targets (5.1 Step 1 status/text gates; the light gates already exist); band ramp + patterns re-validated on the map (unchanged light ramp on light tiles, island guard) and off it (dark-card gate); no new tile provider (Q1); `prefers-color-scheme` default + light/dark/system header toggle + `localStorage` try/catch + correct render without storage (5.3 tests, 5.4 no-storage case); real-browser QA on all chapters (5.4).
- **Gaps the spec missed, now covered:** hard-coded light surfaces that would not flip (5.2 + guard); destructive red cannot meet both contrast targets with white text (Q3); the no-flash script in a Vite SPA (5.3 Step 4); eight dormant `dark:` utilities going live (Q9).
- **Type consistency:** `ThemePref` / `getThemePref` / `setThemePref` / `applyTheme` match master §A; storage key `nos:theme-pref` appears in `theme.ts`, `index.html` and the test; testids `theme-toggle-*` are used by 5.3's RTL test and 5.4's spec.
