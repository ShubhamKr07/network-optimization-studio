# Design Upgrade Phase 5 Implementation Plan (dark mode)

> **Execution:** agent-team dispatch per `AGENTS.md`, as in Phases 1–4.
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-5.N -b du-5.N-work <design-upgrade-p5 tip>`) and dispatches without `isolation`. The agent's first Bash command is `cd` plus a branch check. The lead fast-forwards or cherry-picks each commit onto `design-upgrade-p5`.
> - **Roles:** DU-5.1, DU-5.2 and DU-5.3 are studio-only: `frontend-engineer`, reviewed by the lead on Opus with `ponytail-review`. DU-5.4: `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - Tasks run sequentially, in listed order, and every task's commit is green on its own. Steps use checkbox (`- [ ]`) syntax.

**Goal:** implement spec §5.5 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md:279-286`, decision D6): a brand-derived dark theme (ink surfaces, paper text, olive accents) that is actually applied, including the maps; a light / dark / system control that follows `prefers-color-scheme` by default; both themes checked against the §5.1.3 contrast targets.

**Architecture:**
- **Tokens:** the dead blue `.dark` block (`artifacts/studio/src/index.css:318-367`, never applied today) is replaced by a complete brand-derived block, including dark `--map-*` values. Tailwind's `@custom-variant dark (&:is(.dark *))` (`index.css:34`) already keys off a `.dark` class on an ancestor, so the theme is one class on `<html>`.
- **Dark maps (Q1, user decision 2026-11-04):** same OpenStreetMap tiles (no new provider, spec §5.5), darkened by one CSS filter on `.leaflet-tile-pane`. Only the tile pane is filtered; lanes, markers and overlays draw in the dark map tokens on top. OSM land `#F2EFE9` filters to `#1C1915`, and every on-map gate is measured against that. Leaflet's own white chrome (zoom buttons, popups, attribution) gets dark overrides from the tokens.
- **One dark band ramp** serves lanes, the map legend and `BandLabel` in tables, gated against both the dark tile and the dark card.
- **Theme state:** `lib/theme.ts` (master §A interface) owns the preference, `localStorage` under `nos:theme-pref` with try/catch on every access, and the `<html>` class. A three-line inline script in `index.html` applies the class before first paint. A `ThemeToggle` segmented control sits in the Workspace header only (Q6); the choice applies on every page.
- **Unchanged:** API, solver, DB, exports, and the light theme. Every light-mode value a task touches is replaced by a token with the identical light value (DU-5.2 asserts this), so light mode renders the same.

**Tech stack:** React 18 + Vite + Tailwind v4 (`@theme inline`, `@custom-variant`), Leaflet via react-leaflet, vitest + RTL (jsdom), Playwright.

## Global Constraints

The master plan's Global Constraints (`2026-10-24-design-upgrade.md:22-56`) bind every task. In addition:

**Contracts**
- Fixed interface (master §A, verbatim): `lib/theme.ts`: `type ThemePref = "light" | "dark" | "system"; getThemePref(): ThemePref; setThemePref(p: ThemePref): void; applyTheme(p: ThemePref): void`.
- Storage key `nos:theme-pref` (mirrors `nos:display-unit-pref`, `contexts/UnitContext.tsx:16`). Default `"system"`. Every `localStorage` read and write is wrapped in try/catch, and the app renders correctly with storage throwing.
- The light token values do not change. New tokens, both with a light value equal to an existing one: `--text-primary` (light `#48611E` = `--green-700`) and `--map-highlight` (light `#48611E`), so primary-coloured text and the highlighted-warehouse marker can flip in dark.

**Colour rules**
- Every dark value below was approved by the user on 2026-11-04 from the side-by-side preview (a private claude.ai preview page, not linked here), under master constraint C3. An implementer may not change a value to get a gate green; a failing gate is a STOP-and-report.
- The tile filter is exactly `invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)`. The gates' `DARK_TILE = "#1C1915"` is **measured**, not computed: Chromium (Playwright, 2026-11-04) renders OSM land `#F2EFE9` under this filter, including Leaflet's `mix-blend-mode: plus-lighter` on tiles (`leaflet.css:63`), as exactly `#1C1915` (water `#AAD3DF` → `#1C3D47`). A unit test pins the filter string; DU-5.4 re-samples a real tile pixel, which is the source of truth.
- Red stays for errors only. Overflow stays violet (light `#7C3AED`; dark `#A78BFA`, violet-400).
- **Known exception (Q3, user decision 2026-11-04):** destructive red stays `#DC2626` with white text in dark, so `text-destructive` error lines measure 3.7:1 on the dark background and 3.1:1 on the dark card, below the 4.5:1 text target. A test pins them at ≥ 3:1 so the exception cannot quietly worsen.

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

Q1–Q3 are user decisions (2026-11-04). Q4–Q9 are technical defaults the user kept; Q10 was added after Codex round 2 and is a default awaiting the user's plan approval.

| ID | Decision | Task |
|---|---|---|
| Q1 | **Maps go dark by filtering the OSM tiles** (user decision; the recommended light-map alternative was declined). `.dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) }`: land `#F2EFE9` → `#1C1915`, water `#AAD3DF` → `#1C3D47`, parks → `#0D270D`, roads → near-black, labels → light grey. Every `--map-*` token gets a dark value, gated against `#1C1915`. This matches master §A ("band vs dark tile") as written. | 5.1 |
| Q2 | **Dark values (user-approved from the preview).** Surfaces (HSL triples, because `@theme` maps them through `hsl(var(--x))`; gates measure the rendered colour): background `84 11% 9%` (renders `#171914`), card/popover `86 10% 14%` (`#242720`), muted `82 8% 20%`, border `80 8% 22%`, input `82 6% 35%`. Text on bg / card: body `#FCFCFA` 17.2 / 14.8:1, muted `#ADB1A4` 8.1 / 6.9:1, faint `#83887A` 4.9 / 4.2:1 (decorative only), brand `#93B747` 7.7 / 6.6:1, primary text `#AFC975` 9.6 / 8.3:1. Primary fill `81 50% 43%` (`#7EA437`) with ink text, 6.1:1. Band ramp `#E5EFD4 #B5D185 #8BB444 #749639 #5F7B2F`: vs dark tile 14.7 / 10.4 / 7.3 / 5.1 / 3.6:1, vs dark card 12.7 / 9.0 / 6.3 / 4.5 / 3.2:1, adjacent 1.42 / 1.43 / 1.41 / 1.41:1. Map, vs dark tile: warehouse `#E7EED4` (green-100) 14.7:1; customer `#93B747` 7.6:1 with stroke `#CDDCA6`; plant `#2E7D32` (unchanged, approver-pinned) 3.4:1 and 2.2:1 vs customer; inactive `#83887A` 4.8:1; flow `#AFC975`; default stroke `#ADB1A4` 8.0:1; rings forced-open `#5B9BFF` 6.3:1, select `#FCD34D` 12.1:1, multiselect `#A78BFA` 6.4:1; highlighted warehouse `#7EA437` 6.1:1 (2.4:1 vs a plain warehouse, as light's 2.5:1). Status text on -bg: success `#4ADE80`/`#052E16` 8.6:1, warning `#FBBF24`/`#2A1E05` 9.8:1, danger `#F87171`/`#2C0B0B` 6.6:1, info `#38BDF8`/`#082030` 7.8:1. | 5.1 |
| Q3 | **Destructive keeps white text on `#DC2626` in dark** (user decision; the recommended light-red fill was declined). `--destructive 0 72% 51%`, `--destructive-foreground 0 0% 100%` (4.8:1). Error text stays `text-destructive` (user kept the default on the follow-up): 3.7:1 on the dark bg, 3.1:1 on the dark card, recorded as a known exception (Global Constraints). Switching error text to `--danger` (6.5:1) remains available as a later change. | 5.1 |
| Q4 | **Four tasks, not master's three.** Master DU-5.1 (tokens) and DU-5.2 (control) leave out the surfaces that hard-code light: 16 `bg-white`, 10 `bg-primary text-white`, ~14 raw `--green-*` text/marker colours. They get their own task (DU-5.2) with a source guard. The control becomes DU-5.3 and QA DU-5.4. The §A `lib/theme.ts` interface is unchanged. | all |
| Q5 | **Hand-rolled `lib/theme.ts`, not the installed `next-themes`.** Overkill check: `next-themes` is in `package.json` (only an unused `components/ui/sonner.tsx` imports it), but it needs a provider, its no-flash script only helps SSR, and §A fixes a plain-function interface. The hand-rolled module is ~25 lines on the `UnitContext.tsx` precedent, and the inline script is needed in a Vite SPA either way. | 5.3 |
| Q6 | **Toggle placement (user decision 2026-11-04): the Workspace header only**, beside `UnitToggle` (`Workspace.tsx:4636`). The choice works across all pages in that browser: Landing, Compare and the login/register pages have no switch but apply the stored preference (or the OS setting) through `index.html`'s script and `main.tsx`. Stored per browser in `localStorage`, not per account (user confirmed; no API or DB change). | 5.3 |
| Q7 | **Default is `system`**, per spec. Students whose OS is dark see the dark theme on first load after deploy, with no action. | 5.3 |
| Q8 | **The ink header band stays ink in both themes** (`.scnd-band`, `--surface-band #181A15`); in dark it meets an ink page and is separated by its existing 2px `--green-400` bottom border. Raw `--ink-*`/`--green-400` uses on the band (AppShell, AuthShell, Workspace header `:4593-4629`) are correct in both themes and are allow-listed per line in DU-5.2's guard. | 5.2 |
| Q9 | **Eight dormant `dark:` utilities** (shadcn `input-group`, `field`, `alert`, `kbd`) become live. They are shadcn's own dark defaults; DU-5.4 checks them in the browser and no task edits them pre-emptively. | 5.4 |
| Q10 | **Two non-token map colours stay as they are** (Codex round 2): the Move/Copy ghost tints `#2563eb` / `#059669` (`InputMapTab.tsx:813` etc., `SuperInputMap.tsx:113`) measure 3.4:1 / 4.7:1 on the dark tile, so they pass without change; the Gold fixed mine is Leaflet's default PNG pin (`InputMapTab.tsx:1816`), white-outlined, unchanged in light. Tokenising either would change light mode. DU-5.4 checks both on a dark map. | 5.4 |

All paths below are relative to `artifacts/studio/` unless noted.

---

### Task DU-5.1: Dark token set, dark map tiles, both-theme gates

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Files:**
- Modify `src/index.css`: replace the `.dark { … }` block (`:318-367`); add `--text-primary: #48611E;` to the light raw-text line (`:224`) and `--map-highlight: #48611E;` to the light map-entities line (`:232-235`); add the dark Leaflet rules after the existing `.leaflet-tooltip.nos-map-tooltip` rule (`:24-30`).
- Modify `src/__tests__/designTokens.test.ts`: dark gates, inventory, filter pin.

**Interfaces:**
- Produces: `.dark` complete token block; `--text-primary` (light `#48611E`, dark `#AFC975`); `--map-highlight` (light `#48611E`, dark `#7EA437`), consumed by DU-5.2; `contrast()` already exported from `designTokens.test.ts`.

- [ ] **Step 1: Failing tests.** In `designTokens.test.ts` add:

```ts
const DARK = CSS.slice(CSS.indexOf(".dark {"), CSS.indexOf("}", CSS.indexOf(".dark {")));
// A token is a hex literal or an "H S% L%" triple (consumed as hsl(var(--x))).
// Triples are converted to the hex the browser renders, so every gate measures
// what students see, not a nearby palette value (Codex PR5-4).
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
function darkToken(name: string): string {
  const m = DARK.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6}|\\d+ \\d+% \\d+%)`));
  if (!m) throw new Error(`token ${name} not declared in .dark`);
  if (m[1].startsWith("#")) return m[1];
  const [h, s, l] = m[1].split(/[ %]+/).map(Number);
  return hslToHex(h, s, l);
}
const DARK_BG = darkToken("--background");
const DARK_CARD = darkToken("--card"); // legend + BandLabel surface
// OSM land #F2EFE9 through TILE_FILTER, as Chromium renders it (measured
// 2026-11-04, phase-5 plan Q1); DU-5.4 re-samples a real tile. The pin below
// keeps the filter and this constant in step.
const TILE_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)";
const DARK_TILE = "#1C1915";

describe("dark theme (DU-5.1, spec §5.5)", () => {
  it("tiles are darkened by exactly the filter the gates assume", () => {
    expect(CSS).toContain(`.dark .leaflet-tile-pane { filter: ${TILE_FILTER}; }`);
  });
  const bands = [0, 1, 2, 3, 4].map(i => darkToken(`--band-${i}`));
  it("band ramp: >= 3:1 on the dark tile and the dark card, adjacent >= 1.4:1, near = light -> far = dark", () => {
    for (const b of bands) {
      expect(contrast(b, DARK_TILE)).toBeGreaterThanOrEqual(3);
      expect(contrast(b, DARK_CARD)).toBeGreaterThanOrEqual(3);
    }
    for (let i = 0; i < 4; i++) {
      expect(contrast(bands[i], bands[i + 1])).toBeGreaterThanOrEqual(1.4);
      expect(lum(bands[i])).toBeGreaterThan(lum(bands[i + 1]));
    }
  });
  it("overflow stays violet", () => {
    expect(darkToken("--band-overflow").toUpperCase()).toBe("#A78BFA");
  });
  for (const t of ["--map-warehouse", "--map-warehouse-open", "--map-customer", "--map-plant", "--map-inactive",
                   "--map-ring-forced-open", "--map-ring-select", "--map-ring-multiselect", "--map-default-stroke",
                   "--map-highlight", "--band-overflow"]) {
    it(`${t} >= 3:1 on the dark tile`, () => {
      expect(contrast(darkToken(t), DARK_TILE)).toBeGreaterThanOrEqual(3);
    });
  }
  it("plants stay distinguishable from customers (>= 1.5:1)", () => {
    expect(contrast(darkToken("--map-plant"), darkToken("--map-customer"))).toBeGreaterThanOrEqual(1.5);
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
  it("primary and destructive fills carry >= 4.5:1 foreground text", () => {
    expect(contrast(darkToken("--primary-foreground"), darkToken("--primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkToken("--destructive-foreground"), darkToken("--destructive"))).toBeGreaterThanOrEqual(4.5);
  });
  it("KNOWN EXCEPTION (Q3, user 2026-11-04): text-destructive below AA in dark, pinned >= 3:1", () => {
    expect(contrast(darkToken("--destructive"), DARK_BG)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkToken("--destructive"), DARK_CARD)).toBeGreaterThanOrEqual(3);
  });
  it("muted-foreground >= 4.5:1 on muted", () => {
    expect(contrast(darkToken("--muted-foreground"), darkToken("--muted"))).toBeGreaterThanOrEqual(4.5);
  });
  it("hslToHex is exact (non-vacuity)", () => {
    expect(hslToHex(84, 11, 9)).toBe("#171914");
    expect(hslToHex(0, 0, 100)).toBe("#FFFFFF");
  });
});

describe("dark token inventory (DU-5.1, Codex PR5-7)", () => {
  // Every semantic token declared in the light block has a dark value, except
  // families that are not theme-dependent or are derived from another token.
  // Exact derived-border list (Codex PR5-R2-7): --card-border, --sidebar-border,
  // --popover-border and the status borders are semantic and must have dark values.
  const EXEMPT = /^--(?:green-\d|ink-\d|accent-\d|demand|app-font|radius|tracking|spacing|(?:sidebar-primary|sidebar-accent|primary|secondary|muted|accent|destructive)-border$)/;
  const declared = (block: string) => new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
  it("covers every light semantic token", () => {
    const light = [...declared(ROOT)].filter(t => !EXEMPT.test(t));
    expect(light.length).toBeGreaterThan(40); // non-vacuity
    const dark = declared(DARK);
    expect(light.filter(t => !dark.has(t))).toEqual([]);
  });
});
```

Add to the light tests: `expect(token("--text-primary").toUpperCase()).toBe("#48611E")` and `expect(token("--map-highlight").toUpperCase()).toBe("#48611E")`. The border exemption names only the relative-colour derivations (`:254-276`), which re-derive from their base token under `.dark`.

- [ ] **Step 2:** `pnpm --filter studio test -- designTokens` — expect the new cases to FAIL.

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
     Values approved 2026-11-04 (phase-5 plan Q2); gated by designTokens.test.ts. */
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
  --destructive: 0 72% 51%; --destructive-foreground: 0 0% 100%; /* Q3: unchanged white-on-red, known exception */
  --input: 82 6% 35%;
  --ring: 79 44% 50%;

  --success: #4ADE80; --success-bg: #052E16; --success-border: #166534;
  --warning: #FBBF24; --warning-bg: #2A1E05; --warning-border: #92400E;
  --danger: #F87171;  --danger-bg: #2C0B0B;  --danger-border: #991B1B;
  --info: #38BDF8;    --info-bg: #082030;    --info-border: #075985;
  --utilization: #93B747;

  /* one band ramp for lanes, legend and BandLabel: gated on the dark tile AND the dark card */
  --band-0: #E5EFD4; --band-1: #B5D185; --band-2: #8BB444; --band-3: #749639; --band-4: #5F7B2F;
  --band-overflow: #A78BFA;

  --chart-1: 79 44% 50%; --chart-2: 78 8% 67%; --chart-3: 79 40% 72%;
  --chart-4: 26 87% 55%; --chart-5: 81 5% 58%;
  --chart-grid: #33362E; --chart-axis-label: #ADB1A4;

  --text-body: #FCFCFA; --text-muted: #ADB1A4; --text-faint: #83887A; --text-brand: #93B747; --text-primary: #AFC975;
  --surface-band: #181A15; --surface-band-fg: #FCFCFA; --surface-selected: #2A3318; --surface-sunken: #1E201A;
  --line: #3A3D34; --line-strong: #5B5F54;
  --primary-hover: #93B747; --primary-active: #AFC975; --link: #AFC975; --link-hover: #CDDCA6; --focus-ring: #93B747;

  /* map entities on the filtered dark tile (land #1C1915) */
  --map-warehouse: #E7EED4; --map-warehouse-open: #E7EED4; --map-customer: #93B747;
  --map-customer-stroke: #CDDCA6; --map-flow: #AFC975; --map-inactive: #83887A;
  --map-ring-forced-open: #5B9BFF; --map-ring-select: #FCD34D; --map-ring-multiselect: #A78BFA;
  --map-default-stroke: #ADB1A4; --map-plant: #2E7D32; --map-highlight: #7EA437;
}
```

Then the Leaflet rules, after `.leaflet-tooltip.nos-map-tooltip` (`:24-30`):

```css
/* DU-5.1 (Q1) — dark maps: the same OSM tiles, darkened. Only the tile pane is
   filtered; lanes and markers draw in the dark --map-* tokens on top. The
   gates' DARK_TILE (#1C1915) is OSM land through exactly this filter. */
.dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9); }
.dark .leaflet-container { background: #1C1915; } /* before tiles load (leaflet.css default #ddd) */
.dark .leaflet-bar a,
.dark .leaflet-popup-content-wrapper,
.dark .leaflet-popup-tip,
.dark .leaflet-tooltip:not(.nos-map-tooltip) {
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  border-color: hsl(var(--border));
}
.dark .leaflet-container .leaflet-control-attribution { background: hsl(var(--card) / 0.8); color: hsl(var(--muted-foreground)); }
.dark .leaflet-container .leaflet-control-attribution a { color: var(--link); }
.dark .leaflet-container a.leaflet-popup-close-button { color: hsl(var(--muted-foreground)); }
.dark .leaflet-container a.leaflet-popup-close-button:hover,
.dark .leaflet-container a.leaflet-popup-close-button:focus { color: hsl(var(--foreground)); }
/* tooltip arrows (leaflet.css:620 ff.) follow the card surface */
.dark .leaflet-tooltip-top:before { border-top-color: hsl(var(--card)); }
.dark .leaflet-tooltip-bottom:before { border-bottom-color: hsl(var(--card)); }
.dark .leaflet-tooltip-left:before { border-left-color: hsl(var(--card)); }
.dark .leaflet-tooltip-right:before { border-right-color: hsl(var(--card)); }
```

(`leaflet.css` white defaults, measured: `.leaflet-bar a` `:289`, attribution `:414`, popup tip `:523`, close button `:527`, `.leaflet-tooltip` `:580`, tooltip arrows `:620` ff. The app's `.nos-map-tooltip` already reads `--card`. rg the app for any other `leaflet-` class it styles, and for `.leaflet-div-icon` use — that default is white with a border — before committing.)

Add `--text-primary: #48611E;` to the light raw-text line and `--map-highlight: #48611E;` to the light map-entities line.

- [ ] **Step 4:** `pnpm --filter studio test -- designTokens` — PASS. A failing gate is a STOP: report the value and the measured ratio; do not adjust a value.
- [ ] **Step 5:** gate (Global Constraints), `ponytail-review`, changelog `### DU-5.1 — dark token set, dark map tiles`, commit `[DU-5.1] brand-derived dark tokens, dark map tiles, both-theme gates`.

---

### Task DU-5.2: Themed surfaces stop hard-coding light (studio only)

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Rule:** every replacement uses a token whose **light value is identical** to what it replaces, so light mode is unchanged:

| Replace | With | Light value (identical) |
|---|---|---|
| `bg-white` (not `hover:bg-white/10` on the ink band) | `bg-card` | `--card: 0 0% 100%` = `#FFFFFF` |
| `text-white` paired with `bg-primary` | `text-primary-foreground` | `0 0% 100%` |
| `var(--green-700)` as a text colour (`text-[var(--green-700)]`, `color: "var(--green-700)"`) | `var(--text-primary)` | `#48611E` |
| `var(--green-700)` as the highlighted-warehouse marker colour (`NetworkMap.tsx:72-73,130-131`) | `var(--map-highlight)` | `#48611E` |
| `var(--green-600)` as a text/icon colour | `var(--text-brand)` | `#5F7F28` |

A site with no identical-value token is a STOP-and-report, not an invention.

**Files (known, from rg on 2026-10-29; the sweep catches the rest):**
- `bg-white` → `bg-card`: `components/UnitToggle.tsx:31`, `components/NetworkMap.tsx:740`, `components/MapBulkEditToolbar.tsx:41`, `components/tables/WarehouseTable.tsx:162`, `components/tables/CustomerTable.tsx:188`, `components/workspace/tabs/JadeFlowsTab.tsx:447,458`, `components/workspace/tabs/OptimizationParametersTab.tsx:394`, `components/workspace/map/mapControls.tsx:136`, `components/data-table/entityCells.tsx:46`, `components/ConstraintChips.tsx:69`, `pages/Landing.tsx:182`.
- `text-white` with `bg-primary`: the same toggle/segment sites above, and `components/workspace/super/superTables.tsx:98` (string returned by `activeClassOf`).
- `--green-700` text: `components/workspace/SolveDialog.tsx:161`, `components/workspace/tabs/OptimizationParametersTab.tsx:375`, `components/workspace/tabs/InputMapTab.tsx:798,1291,1789,2375`, `pages/Workspace.tsx:4712`, `pages/Landing.tsx:141`, `components/ui/button.tsx:28`, `components/ui/field.tsx:148`, `components/ui/empty.tsx:76`, `components/ui/item.tsx:138`.
- `--green-700` marker: `components/NetworkMap.tsx:72-73,130-131`.
- `--green-600` text/icon colour: `components/DeveloperCredit.tsx:10,13` (renders in the AppShell/AuthShell footers on the page surface, not the band) and `components/auth/AuthShell.tsx:42` (page title on `bg-background`).
- Create `src/__tests__/themeSurfaceGuard.test.ts`.

- [ ] **Step 1: Failing guard.** Walk `src/` (non-test `.ts`/`.tsx`), fail on any match not in the allow-list:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// DU-5.2 — surfaces that hard-code a light colour do not flip in dark mode.
// Same shape as rawPaletteClasses.test.ts: tree walk, comment lines skipped,
// non-vacuity. Exceptions are per LINE, not per file (Codex PR5-5): an
// allow-listed file can still hold a real offender elsewhere.
const SRC = resolve(__dirname, "..");
const PATTERNS: Array<[string, RegExp]> = [
  ["bg-white", /\bbg-white\b(?!\/)/],
  ["text-white", /\btext-white\b/],
  ["raw palette var", /var\(--(?:ink|green)-\d{3}\)/],
];
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
// [file, substring that identifies the allowed line(s), reason]. Each entry must still match.
const ALLOWED: Array<[string, string, string]> = [
  ["components/AppShell.tsx", "var(--ink-300)", "ink header band (Q8)"],
  ["components/AppShell.tsx", "var(--green-400)", "ink header band title (Q8)"],
  ["components/auth/AuthShell.tsx", "var(--ink-300)", "ink header panel (Q8)"],
  ["components/auth/AuthShell.tsx", "var(--green-400)", "ink header panel border + diamond (Q8)"],
  ["pages/Workspace.tsx", "var(--ink-", "ink header band :4593-4629 (Q8)"],
];
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "__tests__" ? [] : walk(p)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const allowed = (file: string, line: string) => ALLOWED.some(([f, needle]) => f === file && line.includes(needle));

describe("themed surfaces (DU-5.2)", () => {
  const files = walk(SRC);
  it("is not vacuous", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(PATTERNS[0][1].test('className="bg-white"')).toBe(true);
    expect(PATTERNS[0][1].test('className="hover:bg-white/10"')).toBe(false);
  });
  it("no hard-coded light surface outside the allow-list", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!isCode(line) || allowed(rel(f), line)) return;
        for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${rel(f)}:${i + 1} ${name} — ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it("every allow-list entry still matches a line with a pattern", () => {
    for (const [f, needle] of ALLOWED) {
      const lines = readFileSync(join(SRC, f), "utf8").split("\n").filter(l => isCode(l) && l.includes(needle));
      expect(lines.some(l => PATTERNS.some(([, re]) => re.test(l))), f).toBe(true);
    }
  });
});
```

Verify each allowed AppShell/AuthShell line sits on the ink band or panel; `AuthShell.tsx:42` (`--green-600` title on the `bg-background` page, Codex PR5-R2-4) is **not** on the panel and migrates to `--text-brand`. `Workspace.tsx:4712` (`--green-700` on the Save button) is **not** allowed and migrates.

- [ ] **Step 2:** run it — expect FAIL listing the files above.
- [ ] **Step 3:** apply the replacement table. Do not touch `hover:bg-white/10` on the band. Update any RTL test asserting the old class or colour (rg `bg-white\|text-white\|green-700\|green-600` in `src/__tests__`).
- [ ] **Step 4:** guard PASS; full studio suite green.
- [ ] **Step 5:** gate, `ponytail-review`, changelog, commit `[DU-5.2] themed surfaces use tokens instead of hard-coded light colours`.

---

### Task DU-5.3: Theme control (`lib/theme.ts`, no-flash script, header toggle)

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Files:**
- Create `src/lib/theme.ts`, `src/lib/__tests__/theme.test.ts`, `src/components/ThemeToggle.tsx`, `src/__tests__/ThemeToggle.test.tsx`.
- Modify `index.html` (inline script in `<head>`), `src/main.tsx` (apply + OS listener), `src/pages/Workspace.tsx` (beside `<UnitToggle />`, `:4636`). `AppShell.tsx` is not touched (Q6).

**Interfaces:**
- Produces (master §A): `ThemePref`, `getThemePref`, `setThemePref`, `applyTheme`. `ThemeToggle` with testids `theme-toggle`, `theme-toggle-light|dark|system`.

- [ ] **Step 1: Failing tests** `lib/__tests__/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getThemePref, setThemePref, applyTheme } from "@/lib/theme";

// vi.stubGlobal + unstubAllGlobals, the NetworkBackground.test.tsx:8-15,39
// pattern; a direct window.matchMedia assignment would leak across tests.
function mockSystemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn() }));
}
beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

(`var` is function-scoped, so `p` is visible after the `try`; if `getItem` throws, `p` is `undefined` and the script falls through to the OS setting. No CSP is set on the static site, so an inline script is allowed; confirm with `curl -sI https://nos-studio.onrender.com` at task time and STOP if a `Content-Security-Policy` header appears.)

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

`ThemeToggle.test.tsx` (same `vi.stubGlobal` pattern): renders three buttons with `aria-pressed` reflecting the stored pref; clicking Dark sets `aria-pressed`, persists `nos:theme-pref=dark`, adds `.dark` to `<html>`; clicking System with `matchMedia` mocked light removes it.

- [ ] **Step 7:** render `<ThemeToggle />` in `Workspace.tsx` beside `<UnitToggle />` only. Sweep RTL tests that snapshot the Workspace header.
- [ ] **Step 8:** tests PASS; gate; `ponytail-review`; changelog; commit `[DU-5.3] theme control: light/dark/system, no-flash script, header toggle`.

---

### Task DU-5.4: Phase 5 real-browser QA (qa-sdet)

**Role:** qa-sdet (exempt from karpathy/ponytail), reviewed by a separate `fable` reviewer agent. CSS behaviour and filters are invisible to jsdom (`artifacts/studio/CLAUDE.md`), so this task is where dark mode is actually verified.

**Files:** create `e2e/design-upgrade-p5.spec.ts`; rewrite affected sibling specs found by the sweep; flake-registry sightings if any.

- [ ] **Step 1: sibling sweep.** rg `e2e/` for `bg-white`, `text-white`, `green-700`, `green-600`, header testids next to which the toggle now renders, and any `toHaveCSS` colour assertion. Rewrite hits and run each changed spec green.
- [ ] **Step 2: new spec** against local servers (`E2E_BASE_URL` set; recipe in `e2e/CLAUDE.md`), seeded results (`seedSolvedResult`, as in `design-upgrade-p1/p3.spec.ts`):
  - **System default:** `page.emulateMedia({ colorScheme: "dark" })` with no stored pref → `<html>` has `dark`, and `body`'s background equals a probe element styled `background: hsl(var(--background))` (never a hard-coded rgb: the triple renders `#171914`); `colorScheme: "light"` → no `dark`.
  - **Toggle (Workspace header only, Q6):** Dark → reload keeps dark; Light overrides an OS-dark emulation; System follows a mid-session `emulateMedia` change. The switch is absent from Landing, Compare and login/register.
  - **Works across pages:** choose Dark in a Workspace, then go back to Landing, open Compare, log out to the login page, and log in again: every page renders dark with no flash; choose Light in a Workspace with OS-dark emulation and the same pages render light.
  - **No storage:** a context whose `localStorage` throws (`addInitScript` overriding `Storage.prototype.getItem/setItem`) loads, renders, and still switches theme in-session.
  - **No flash:** with OS-dark emulation, `<html>` already has `dark` at `DOMContentLoaded` (an `addInitScript` listener records it), before the React bundle runs.
  - **Dark maps (Q1):** on Output Map (p-median-us, JADE), Input Map and the Super Model input map, `.leaflet-tile-pane`'s computed `filter` equals the plan's string; a screenshot pixel sampled on open land (away from labels and lanes) is dark (relative luminance < 0.05); every lane's computed `stroke` equals its dark `--band-N` and its `stroke-dasharray` equals the light run's (patterns unchanged); legend swatches match; warehouse/customer/plant markers compute to the dark `--map-*`; a popup (and its close button), a tooltip and its arrow, the zoom buttons and the attribution compute to `--card`-based colours with readable text; the sampled land pixel is used to re-check the band and marker contrast gates (≥ 3:1) against what was actually rendered. Q10: the Move/Copy ghost circle and the Gold fixed-mine pin are visible on the dark tile (screenshot in the report).
  - **Copy map image (dark):** "Copy map" (`lib/copyMapToClipboard.ts`, `html-to-image`) in dark mode produces a PNG whose land pixel is dark and whose markers use the dark tokens; if the capture drops the filter, report it with the PNG — do not fix silently.
  - **All 8 chapters in dark:** Landing, each chapter's Workspace (Input Map, Output Map, one table tab, Optimization Parameters), Compare. For each: a `BandLabel` swatch computes to a dark-ramp value; status alerts, a destructive button, a disabled control, the focus ring and the four Q9 `dark:` shadcn pieces are legible. Attach a full-page screenshot per chapter per theme to the report for the user.
  - **Light unchanged:** the same pages in light compute `bg-card` surfaces to `rgb(255, 255, 255)`, primary text to `rgb(72, 97, 30)`, and `.leaflet-tile-pane` to `filter: none`.
- [ ] **Step 3: gates.** `pnpm gate`; `E2E_BASE_URL=… pnpm e2e:gate`. Record the numbers in the changelog entry; never estimate a number that wasn't measured.
- [ ] **Step 4: commit** `[DU-5.4] Phase 5 real-browser QA and sibling e2e sweep` with changelog.

---

## Phase 5 close-out

1. `superpowers:finishing-a-development-branch`, then `/harness-retro DU-5`, then STOP for merge approval (push and deploy are separate approvals).
2. **Deploy is `nos-studio` only** (no `artifacts/api-server/**`, `solvers/**`, `lib/db/**` or `lib/api-spec/**` change); confirm with `pnpm deploy:preflight -- <deployed-sha>..HEAD` on the full diff, no pathspec. Re-fetch `origin/main` immediately before the trigger: Render builds the tip, not the approved SHA.
3. Deploy note: OS-dark students get dark mode, including dark maps, on first load (Q7); dark-mode error text is a known 3.7:1 exception (Q3).

## Self-review

- **Spec coverage (§5.5):** dead `.dark` replaced with brand-derived values (5.1 Step 3); every Phase 1 semantic token has a dark value, enforced by the inventory test (5.1); both themes against §5.1.3 targets (5.1 gates; the light gates already exist), with the one approved exception pinned (Q3); band ramp and patterns re-validated on the (dark) map tiles (5.1 tile gates, 5.4 stroke/dash checks); no new tile provider (Q1, filter on the same tiles); `prefers-color-scheme` default + light/dark/system header toggle + `localStorage` try/catch + correct render without storage (5.3 tests, 5.4 no-storage case); real-browser QA on all chapters (5.4).
- **Gaps the spec missed, now covered:** hard-coded light surfaces that would not flip (5.2 + guard); Leaflet's own white chrome (5.1 Leaflet rules); the no-flash script in a Vite SPA (5.3 Step 4); eight dormant `dark:` utilities going live (Q9).
- **Type consistency:** `ThemePref` / `getThemePref` / `setThemePref` / `applyTheme` match master §A; storage key `nos:theme-pref` appears in `theme.ts`, `index.html` and the test; testids `theme-toggle-*` are used by 5.3's RTL test and 5.4's spec; `--text-primary` and `--map-highlight` are produced by 5.1 and consumed by 5.2.

## Review log — Codex round 1 (high effort, 2026-10-29)

Folded (PR5-n = Codex finding n). Three findings targeted the light-map approach, which the user then declined (Q1, 2026-11-04); they are recorded as moot rather than deleted.
- **PR5-1** map guard matched `<MapContainer` in comments → moot: no map-wrapper guard under dark tiles.
- **PR5-2** light map area inherited dark-page text colour → moot for the island; the same concern now applies to Leaflet's own white chrome, covered by the 5.1 Leaflet rules and a 5.4 check.
- **PR5-3** Q1 contradicted master §A → resolved: dark tiles match master §A as written.
- **PR5-4** HSL triples render ≠ the ink hexes the gates assumed (`84 11% 9%` → `#171914`) → tests convert triples to the rendered hex; every ratio in Q2 is from rendered colours; e2e compares against a probe, not an rgb literal.
- **PR5-5** file-level allow-list hid real offenders (`Workspace.tsx:4712`, `NetworkMap.tsx:740`) → per-line allow entries; `NetworkMap`'s marker highlight now migrates to `--map-highlight` instead of being allowed.
- **PR5-6** guard would flag comments (`entityCells.tsx:29`) → `isCode` from `rawPaletteClasses.test.ts`.
- **PR5-7** dark gates only saw hex literals; no completeness check → triple parsing + a light-vs-dark declaration inventory (map tokens no longer exempt), plus fill/foreground and muted gates.
- **PR5-8** map band/pattern revalidation untested → DU-5.4 checks tile filter, a land pixel, lane stroke/dash, legend and markers.
- **PR5-9** direct `window.matchMedia` assignment leaks → `vi.stubGlobal` / `unstubAllGlobals`.
- **PR5-10** inventory missed `superTables.tsx:98` → added.

## Review log — Codex round 2 (high effort, 2026-11-04)

On the revised plan (dark tiles):
- **PR5-R2-1** `DARK_TILE` claimed wrong (`#1C1315` sRGB) and `plus-lighter` blending unaccounted → **measured instead**: Chromium renders `#F2EFE9` under the filter, with a `plus-lighter` child, as exactly `#1C1915` (water `#1C3D47`). The constant stands; it is now documented as measured, and DU-5.4 re-samples a real tile and re-checks the gates against it.
- **PR5-R2-2** Gold fixed mine is Leaflet's default PNG pin → kept (light unchanged, white-outlined pin), Q10; DU-5.4 checks it on a dark map.
- **PR5-R2-3** Move/Copy ghost hex tints → measured 3.4:1 / 4.7:1 on the dark tile, kept (Q10); checked in DU-5.4.
- **PR5-R2-4** AuthShell allow-list hid `AuthShell.tsx:42` (`--green-600` on the page) → AppShell/AuthShell needles narrowed to `--ink-300` / `--green-400`; line 42 migrates to `--text-brand`.
- **PR5-R2-5** tooltip arrows and popup close button stayed light → dark rules added to DU-5.1 and checked in DU-5.4.
- **PR5-R2-6** dark "Copy map" export unverified → DU-5.4 real-browser check of the PNG.
- **PR5-R2-7** inventory exempted every `*-border` → exact list of derived borders only.
