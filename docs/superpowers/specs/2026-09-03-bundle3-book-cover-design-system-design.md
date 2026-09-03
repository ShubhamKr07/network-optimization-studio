# Bundle 3 — Book-cover design system (SCND Optimization Studio) — design spec

Date: 2026-09-03. Source design package: `docs/design-system/` (imported commit `749e4d0`), drawn from
the *Supply Chain Network Design* book cover. Locked brainstorming decisions:
`docs/design-system/DECISIONS.md`. This spec is presentation-only; a separate implementation plan
follows.

**Goal:** Replace the app's current look (blue shadcn `:root` + the Phase 3.1 `.scn-theme` blue-gray
Barlow wireframe) with the textbook-cover brand — paper-white + leaf-green + a dark "band" motif,
`Source Serif 4` display / `IBM Plex Sans` UI / `IBM Plex Mono` for every number, print-like radii and
hairline borders — across all live surfaces (Landing, auth, Workspace). Light theme only.

**Architecture:** Retarget the app's existing shadcn HSL CSS variables (the Phase 3.1 proven path) at
global `:root` instead of a scoped class, swap the three font families, add additive raw tokens shadcn
lacks (band, green scale, data-viz), and add band/kicker markup where the design calls for it. Keep
every shadcn/Radix component structurally intact; close-match only the 6 non-Radix studio components.
No behavior, contract, API, DB, or solver changes.

**Tech stack:** React + Vite + Tailwind v4 (`@theme inline`) + shadcn/Radix, `artifacts/studio/src`.
Single stylesheet of record: `artifacts/studio/src/index.css`.

## Global constraints (verbatim, bind every task)

- **Presentation only.** No behavior/contract/API/DB/solver change. `e2e_accuracy.py` untouched and not
  re-run (no Python touched). Test churn limited to class/snapshot/style assertions.
- **Light theme only.** No dark mode on live surfaces.
- **Preserve all Radix a11y, focus, keyboard behavior, `data-testid`s, and `aria-*`.** Close-match =
  Tailwind class / token changes only; never restructure a component's DOM, roles, or test IDs.
- **Reference components are a visual spec, not code.** `docs/design-system/components/**` are
  inline-styled non-shadcn specimens (their own `.scnd-*` classes, injected `<style>`, no Radix, no test
  IDs). Match them by eye; never import or transplant them.
- **No per-model style branching on `modelId === "..."`.** Any per-model visual difference stays
  capability- / `chapters.ts`-driven (this repo's most-documented recurring bug class).
- **Fonts:** `Source Serif 4` (display/headings), `IBM Plex Sans` (UI/body), `IBM Plex Mono` (every
  number, stat, chip, axis label, uppercase kicker).
- **Copy unchanged.** No text/wording edits (footer stays "© Developed by hx1", titles unchanged) —
  this bundle restyles, it does not rewrite copy.
- **`Studio.tsx` / `.studio-lab` are out of scope and left untouched** (dead code — all four chapters
  are `workspace: true`, Studio unreachable via navigation). See "Resolved open item".

## Current state (grounded in code)

- `index.css` global `:root` = blue shadcn boilerplate (`--primary: 218 70% 52%`), `--radius: .5rem`,
  fonts `Inter`/`Space Grotesk`. `@theme inline` maps `--color-*: hsl(var(--*))`, so every shadcn token
  the `@theme` consumes **must** be an `H S% L%` triple.
- `.scn-theme` (Phase 3.1) is a scoped override applied on exactly one element:
  `Workspace.tsx:2265` root div. Also referenced by `Workspace.test.tsx` and `MapLegend.tsx`. It
  retargets shadcn vars to blue-gray + Barlow + `--radius: 0`.
- `.studio-lab` (Arcadia dark) + the `--arc-*` token block remain in `index.css`; the only **live**
  `.tsx` consumer of `--arc-*` is `components/ObjectiveBar.tsx` (9 references) — it renders as a dark
  card today. `Studio.tsx` is the only other consumer and is dead.
- Landing (`pages/Landing.tsx`), Login/Register (`pages/auth/*`) are plain shadcn on the global blue
  `:root` — no band, no serif, no kickers.
- `AppFooter.tsx` = `bg-background` bottom strip, `FOOTER_H = 24`.

## Token design

### A. shadcn variables retargeted at global `:root` (HSL triples)

Replace the blue values in `index.css`'s `:root` block. Approximate conversions (the plan pins exact
triples; hexes are the source of truth from `docs/design-system/tokens/colors.css`):

| shadcn var | book-cover source | hex | approx HSL triple |
|---|---|---|---|
| `--background` | paper | `#FCFCFA` | `60 20% 99%` |
| `--card`, `--popover`, `--sidebar` | white | `#FFFFFF` | `0 0% 100%` |
| `--foreground` / `*-foreground` (body) | ink-900 | `#181A15` | `84 11% 9%` |
| `--primary`, `--sidebar-primary` | green-600 | `#5F7F28` | `82 52% 33%` |
| `--primary-foreground` | white | `#FFFFFF` | `0 0% 100%` |
| `--secondary` | green-050 | `#F4F7EB` | `75 40% 95%` |
| `--muted` | paper-2 | `#F5F6F1` | `72 22% 95%` |
| `--muted-foreground` | ink-500 | `#5B5F54` | `82 6% 35%` |
| `--accent`, `--sidebar-accent` | green-400 | `#93B747` | `79 44% 50%` |
| `--border`, `--input`, `--sidebar-border` | line | `#E2E4DA` | `72 16% 87%` |
| `--ring`, `--sidebar-ring` | green-500 | `#7DA436` | `81 50% 43%` |
| `--destructive` | red (kept) | `#DC2626` | `0 72% 51%` |

Radius: `--radius: .5rem` → `--radius: 4px` (shadcn `sm/md/lg` resolve to 3/4/6). The existing
`--chart-1..5: red` placeholders get real values from the data-viz block below (Wave 3).

### B. Additive raw tokens shadcn lacks (defined once at `:root`, consumed directly)

Copied verbatim from the package's token files, kept as hex (consumed via `var(--x)` or Tailwind
arbitrary values, not through `@theme`):

- **Green scale:** `--green-050..800` (`docs/design-system/tokens/colors.css`).
- **Ink scale:** `--ink-900/800/700/500/400/300`.
- **Band motif:** `--surface-band: #181A15`, `--surface-band-fg: #FCFCFA`, `--surface-selected:
  #F4F7EB`, plus `--surface-sunken: #F5F6F1`.
- **Interactive steps:** `--primary-hover: #48611E` (green-700), `--primary-active: #324414`
  (green-800), `--link`, `--link-hover`.
- **Data-viz (Wave 3):** `--band-0..4` five-color scale (`#16A34A #84CC16 #F59E0B #EF4444 #DC2626`,
  index 0 = nearest → 4 = farthest — **replaces today's 4-color `--band-0..3`**); map-entity colors
  (`--map-warehouse`, `--map-warehouse-open`, `--map-customer`, `--map-customer-stroke`, `--map-flow`,
  `--map-inactive`); chart tokens `--chart-1..5`, `--chart-grid`, `--chart-axis-label`,
  `--utilization`.

### C. Fonts

Swap the `@import` line in `index.css` to load `Source Serif 4` (400/600/700) + `IBM Plex Sans`
(400/500/600/700) + `IBM Plex Mono` (400/500/600), dropping the current Space Grotesk/Inter/JetBrains
Mono/Barlow import (Barlow is only used by the retired `.scn-theme`; JetBrains/Space Grotesk only by
dead Arcadia). Set at `:root`: `--app-font-sans: 'IBM Plex Sans', system-ui, sans-serif`;
`--app-font-mono: 'IBM Plex Mono', ui-monospace, monospace`; `--app-font-heading` + new
`--app-font-display: 'Source Serif 4', Georgia, serif`. The `@theme inline` `--font-*` mappings already
read these.

### D. New utility classes (defined in `index.css`, consumed Waves 2/3)

- `.scnd-band` — `background: var(--surface-band); color: var(--surface-band-fg);` optional
  `border-bottom: 2px solid var(--green-400)`.
- `.scnd-kicker` — `font-family: var(--app-font-mono); font-size: 10.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted-foreground)`.
- `.scnd-display` — `font-family: var(--app-font-display)` (serif titles; color applied per-use, green
  or on-band).

## Per-wave design

Three sequential waves. Each leaves the app coherent and gate-green on its own (Wave 1 alone already
ships the green/serif/paper look; band + studio polish layer on top).

### Wave 1 — Foundations (single writer: `index.css`)

- Retarget `:root` shadcn vars (table A), add additive tokens (B), swap fonts (C), set `--radius: 4px`,
  add utilities (D), give `--chart-1..5` real values.
- **Retire `.scn-theme`:** delete the `.scn-theme` rule body (its role now lives in `:root`); leave the
  `scn-theme` className on `Workspace.tsx:2265` as a harmless no-op so Wave 1 need not touch
  `Workspace.tsx`/`Workspace.test.tsx`/`MapLegend.tsx` just to drop a class. (A later trivial cleanup
  may remove the dead className; not required here.)
- Leave `--arc-*` / `.studio-lab` definitions in place (still referenced by dead `Studio.tsx` and, until
  Wave 3, by `ObjectiveBar.tsx`).
- **Exit check:** app builds; Landing/auth/Workspace render paper/green/serif with 4px radii and hairline
  borders; `pnpm --filter studio test` green (class/snapshot churn expected and updated).

### Wave 2 — Band motif + chrome (markup)

- **Landing hero** (`pages/Landing.tsx`): wrap the page in a `.scnd-band` header strip — mono kicker
  "OPTIMIZATION STUDIO BY PROF. MICHAEL WATSON", green `.scnd-display` title "Network Design Labs" (per
  the package thumbnail) — above the paper body. Chapter cards: `c.chapter` ("CHAPTER 3") rendered as
  `.scnd-kicker`; `c.title` in serif; recent-solves stats stay mono (Wave 3 formalizes).
- **Workspace header** (`Workspace.tsx` `<header>` ~L2287): switch `bg-background` → `.scnd-band`; back
  arrow, scenario `<select>`, and summary recolor to band-fg; the center "Chapter N · description"
  becomes a serif/kicker treatment on the band. Preserve the 3-track grid, all test IDs, and `<md`
  stacking.
- **Auth** (`pages/auth/Login.tsx`, `Register.tsx`): add a `.scnd-band` title strip to the card (or a
  band header above it) — "SCND Optimization Studio" serif + "By Prof. Michael Watson" kicker.
- **`AppFooter.tsx`:** restyle to the paper/muted print footer (mono/hairline top rule); copy and
  `FOOTER_H` unchanged.
- **Exit check:** dark band visible on Landing hero + Workspace header + auth; kickers/serif render; all
  header test IDs intact; studio tests green.

### Wave 3 — Studio components close-match + mono-numbers + data-viz

- **`ObjectiveBar.tsx` — rewrite off `--arc-*`.** Today it's inline-styled against the dead dark Arcadia
  tokens (dark card). Rebuild as a paper/white summary bar: `.scnd-kicker` chapter label, serif title,
  muted description, and **mono** stat pills (`objective 2,387,… · avg distance 412 mi · run 0.24s`)
  using book-cover tokens. Same props, same DOM shape/testids where present.
- **Close-match the 5 other studio components** (Tailwind-only, DOM/roles/testids frozen):
  - `SidebarTree.tsx` — active row → green left-rule (`border-l-2` green-500) + `--surface-selected` bg +
    green-700 text (replacing `bg-muted font-medium`); section headers → `.scnd-kicker` (mono).
  - `TabBar.tsx` — document-tab styling; active tab paper + green underline/rule; mono/sans per package.
  - `ConstraintChips.tsx` — already mono chips; reconcile colors to tokens (stale badge stays amber
    status-statement).
  - `StaleOutputBanner.tsx` — status-statement styling (amber triangle kept), token colors.
  - `MapLegend.tsx` — legend swatches to the exact `--band-*` / map-entity token values.
- **Mono-numbers pass** — apply `--app-font-mono` (`font-mono`) to numeric/stat displays, prose stays
  sans. Concrete surfaces (plan enumerates exact lines): ObjectiveBar stats, Landing recent-solves stats
  (`obj`, `mi`, `s`), the Output-Map metric overlay in `Workspace.tsx`, numeric table cells across the
  output/input grid tabs (Open Warehouses, Assignments, Solution Summary, Service Stats, Flows,
  Distances), badges/chips carrying numbers, kicker labels.
- **Data-viz alignment** — distance-band UI (`lib/bands.ts` consumers, coverage bars, `NetworkMap`
  route/marker coloring) reads the fixed 5-color `--band-0..4`; reconcile `EntityMarkers.tsx` /
  `MapLegend.tsx` marker/bubble/flow colors to the map-entity tokens. (Marker geometry — triangles /
  demand bubbles — is already implemented from prior bundles; this only aligns colors, not shapes.)
- **Exit check:** the 6 studio components visually match the reference; all numbers render mono; band
  coverage/legend use the 5-color scale; full studio suite green; live browser verify.

## Testing & verification

- Per-wave: `pnpm run typecheck` + `pnpm --filter studio test` green. api-server unaffected (no backend
  change) but run once at the end. No Python touched → `e2e_accuracy.py` not re-run.
- Expect and update class/snapshot/style assertions (e.g. `Workspace.test.tsx`, `MapLegend.test.tsx`,
  any test asserting a specific color/utility class). Never weaken a behavioral/testid/role assertion to
  make a style change pass.
- Final: live-verify in a real browser (local dev, disposable account, purged after) — Landing band +
  serif title, auth band, Workspace band header, sidebar green active rule, mono stats, band-colored
  routes/legend — across at least two models (p-median-us + one other) to catch any per-model gate slip.

## Non-goals / scope guards

- No copy/wording changes; no new features; no map geometry changes (colors only).
- No dark mode; `Studio.tsx` / `.studio-lab` / `--arc-*` definitions left in place (dead).
- No shadcn component rebuilds; no importing the package's reference specimens.
- No API/spec/codegen/DB/solver changes → hard rules #1/#2/#6 not engaged.

## Resolved open item

The package is light-only; the sole dark surface is the dead `.studio-lab`/`Studio.tsx`. **Decision:
leave untouched** (zero-risk dead code). Deleting `Studio.tsx` + its `.studio-lab`/`--arc-*` CSS is a
separate cleanup, out of scope here — flagged as a future candidate. (After Wave 3, `--arc-*` is
consumed only by dead `Studio.tsx`.)

## Risks

- **Global `:root` change is broad.** Any component rendered outside a page inherits the new palette.
  Mitigated: shadcn tokens are the same variable names, just new values; the whole app already themes
  through them. Live-verify across surfaces catches strays.
- **Snapshot/class-assertion churn.** Some studio tests assert specific utility classes/colors; these
  update mechanically. Risk is mistaking a real regression for expected churn — reviewer confirms each
  changed assertion is cosmetic.
- **`ObjectiveBar` rewrite** is the one non-mechanical change (inline dark → token light). Isolated to a
  single file; its props/consumers are unchanged.
- **Contrast/AA.** Green-600 text on white and band-fg on band are AA per the package; verify any new
  green-on-paper or on-band text combination during live-verify.
