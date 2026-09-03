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
- **Copy mostly frozen — additive only.** Existing instructional and functional copy is unchanged,
  including the Landing body `<h1>Labs</h1>` (the design kit `ui_kits/studio/Landing.jsx` keeps it). The
  only exceptions are locked brand-chrome **additions**: the new band hero title "Network Design Labs",
  the "OPTIMIZATION STUDIO BY PROF. MICHAEL WATSON" kicker, and the auth author string — none of these
  rename existing text. Footer copy ("© Developed by hx1") unchanged.
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
| ink `*-foreground` group (see note) | ink-900 | `#181A15` | `84 11% 9%` |
| white `*-foreground` group (see note) | white | `#FFFFFF` | `0 0% 100%` |
| `--primary`, `--sidebar-primary` | green-600 | `#5F7F28` | `82 52% 33%` |
| `--secondary` | green-050 | `#F4F7EB` | `75 40% 95%` |
| `--muted` | paper-2 | `#F5F6F1` | `72 22% 95%` |
| `--muted-foreground` | ink-500 | `#5B5F54` | `82 6% 35%` |
| `--accent`, `--sidebar-accent` | green-400 | `#93B747` | `79 44% 50%` |
| `--border`, `--input`, `--sidebar-border`, `--card-border`, `--popover-border` | line | `#E2E4DA` | `72 16% 87%` |
| `--ring`, `--sidebar-ring` | green-500 | `#7DA436` | `81 50% 43%` |
| `--destructive` | red (kept) | `#DC2626` | `0 72% 51%` |

**`*-foreground` enumeration (no ambiguity).** The current `:root` light block gives every foreground a
blue-tinged ink (`222 84% 12%`) or white. Wave 1 retargets each explicitly: **ink group →** `84 11% 9%`:
`--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`,
`--sidebar-foreground`, `--accent-foreground`, `--sidebar-accent-foreground`; **white group →**
`0 0% 100%`: `--primary-foreground`, `--destructive-foreground`, `--sidebar-primary-foreground`.
**`--accent-foreground`/`--sidebar-accent-foreground` are ink, not white** — `--accent` stays green-400
(needed for the `--accent-300/600/700` map-marker derivation), and shadcn menu primitives
(`select.tsx`/`dropdown-menu.tsx`) render `focus:text-accent-foreground` over it: white on green-400 is
only 2.31:1 (fail), ink on green-400 is ~8.2:1 (AA). A real-browser focus-state contrast check is added
in T11.
`--card-border`/`--popover-border` (today `214 32% 91%`, blue-derived) → line, so no blue-boilerplate
shadcn token survives.

**Token-representation rule (strict, both directions).** A variable is EITHER an `H S% L%` channel
triple (consumed only via `hsl(var(--x))`, and safe to feed the `@theme inline` `hsl(var(--*))`
mappings) OR a complete CSS color (hex, consumed via bare `var(--x)`). Never mix. Consequences the plan
must honor: (a) utilities that set `color:`/`background:` off a shadcn channel token must wrap it —
`.scnd-kicker` uses `color: hsl(var(--muted-foreground))`, not `var(--muted-foreground)` — OR use a raw
complete-color token (`--text-muted`, added in B); (b) `--chart-1..5` are consumed by `@theme inline` as
`hsl(var(--chart-*))`, so they MUST be HSL triples (replacing today's `--chart-1..5: red` placeholders),
not hex/`var(--green-*)`.

**Radius (corrected).** The `@theme inline` block resolves `--radius-sm/md/lg/xl` as
`calc(--radius − 4 / − 2 / +0 / +4)px`, so a single `--radius: 4px` yields `0 / 2 / 4 / 8` — and `Card`
uses `rounded-xl` (→ 8px), violating the 3/4/6px-only rule. Wave 1 therefore **pins the four Tailwind
radius variables explicitly** to the book-cover scale: `--radius-sm: 3px`, `--radius-md: 4px`,
`--radius-lg: 6px`, `--radius-xl: 6px` (cap `xl` at 6 so cards land at 6, the package's largest radius),
and keeps a base `--radius: 4px` for any consumer reading it directly. **No-pill exception:** geometry-
essential round controls — Radix Switch thumb/track, radio dots, progress/slider tracks, and map demand
bubbles — keep their intrinsic rounding; the no-pill rule applies to buttons/inputs/cards/badges only.

### B. Additive raw tokens shadcn lacks (defined once at `:root`)

Ported from the package's token files (`docs/design-system/tokens/{colors,dataviz}.css`). **Complete
CSS colors** (hex, consumed via bare `var(--x)`) unless marked HSL. This inventory is exhaustive for
what the Wave 2/3 close-match consumes — nothing here is "TBD at plan time":

- **Green scale:** `--green-050..800`. **Ink scale:** `--ink-900/800/700/500/400/300`.
- **Raw text colors** (so utilities/inline styles avoid the `hsl()` wrap): `--text-body: #181A15`,
  `--text-muted: #5B5F54`, `--text-faint: #83887A`, `--text-brand: #5F7F28`.
- **Band motif & surfaces:** `--surface-band: #181A15`, `--surface-band-fg: #FCFCFA`,
  `--surface-selected: #F4F7EB`, `--surface-sunken: #F5F6F1`.
- **Interactive steps:** `--primary-hover: #48611E` (green-700), `--primary-active: #324414`
  (green-800), `--link: #48611E`, `--link-hover: #324414`, `--focus-ring: #7DA436` (green-500).
- **Structural:** `--line: #E2E4DA`, `--line-strong: #C9CCBD` (strong-border alias for hairline-heavy
  tables/dividers that need one step darker).
- **Status (full sets, so `ConstraintChips`/`StaleOutputBanner`/Landing badges use tokens, not
  hardcoded Tailwind amber/green/red):** `--success #16A34A / --success-bg #F0FDF4 / --success-border
  #86EFAC`; `--warning #B45309 / --warning-bg #FFFBEB / --warning-border #FCD34D`; `--danger #DC2626 /
  --danger-bg #FEF2F2 / --danger-border #FCA5A5`.
- **Effects — via Tailwind's shadow theme namespace, NOT `:root` placeholders.** The live components use
  Tailwind shadow *utilities* (`Card` → `.shadow`, dialogs/popovers → `.shadow-md`/`.shadow-lg`, chart
  chrome → `.shadow-xl`), which compile from Tailwind's `@theme` shadow keys — they do **not** read the
  identically-named `:root --shadow-*` runtime placeholders (verified: `@theme inline` declares no shadow
  keys today, so those utilities use Tailwind's built-in defaults, and the transparent `:root
  --shadow-*` vars are dead). Wave 1 therefore declares the package shadows inside `@theme inline`'s
  shadow namespace — `--shadow-sm`, `--shadow` (bare), `--shadow-md`, `--shadow-lg`, `--shadow-xl` — so
  every existing utility class retargets app-wide. Flat print scale: `sm`/bare = `0 1px 2px
  rgba(24,26,21,.06)`; `md` = `0 2px 8px rgba(24,26,21,.10)`; `lg`/`xl` = `0 8px 30px rgba(24,26,21,.18)`
  (the package's overlay depth, for dialogs/popovers/chart chrome). To avoid conflating compile-time
  theme vars with runtime tokens, the transparent `:root`/`.dark --shadow-*` placeholders are **removed**
  (nothing reads them); if any component ever needs a raw shadow token it gets a non-conflicting name
  (`--elevation-*`).
- **Data-viz — bands & map entities (hex, Wave 3):** `--band-0..4` five-color scale
  (`#16A34A #84CC16 #F59E0B #EF4444 #DC2626`, index 0 = nearest → 4 = farthest — **replaces today's
  4-color `--band-0..3`**); map-entity colors `--map-warehouse #181A15`, `--map-warehouse-open #5F7F28`,
  `--map-customer #93B747`, `--map-customer-stroke #48611E`, `--map-flow #7DA436`, `--map-inactive
  #ADB1A4`.
- **Data-viz — map interaction-state rings (exact, hex, Wave 3):** `NetworkMap.tsx` hardcodes ring
  colors for three transient interaction states over ink/green markers. These are **functional
  affordances (like a focus ring), not brand surfaces**, and the book-cover palette has no three
  mutually-high-contrast hues that also read against both ink and green markers. **Decision (a reversal
  of rev-1's "replace each with a book-cover token"):** centralize them as named tokens but keep their
  current, already-distinct values — do NOT recolor the two accent rings, since any green substitute
  loses contrast on green markers and any shared-dark value collides forced-open with multi-select. Exact:
  `--map-ring-forced-open: #2D6CDF` (dashed, unchanged); `--map-ring-select: #FCD34D` (single-select,
  warm, = `--warning-border`); `--map-ring-multiselect: #7C3AED` (solid violet, unchanged — the one
  documented non-palette accent, retained only because it is a transient selection affordance). Only the
  neutral default marker stroke is rebranded: `--map-default-stroke: #83887A` (ink-400, replaces slate
  `#64748B`). Three-way distinction is preserved by color (blue/amber/violet) **and** the unchanged ring
  geometry (dashed vs solid, differing radius/width). This exception is surfaced for override.
- **Charts — split by whether `@theme` maps them (Wave 3):** Only `--chart-1..5` are consumed through
  `@theme inline`'s `hsl(var(--chart-*))`, so they are **HSL triples** (exact, replacing the `red`
  placeholders): `--chart-1: 82 52% 33%` (green-600), `--chart-2: 83 8% 20%` (ink-700), `--chart-3: 79
  44% 62%` (green-300), `--chart-4: 26 90% 37%` (warning `#B45309`), `--chart-5: 81 6% 51%` (ink-400).
  `--chart-grid`, `--chart-axis-label`, `--utilization` are **NOT** in any `@theme` mapping, so they stay
  **pinned complete-color hex** (from `docs/design-system/tokens/dataviz.css`): `--chart-grid: #E2E4DA`,
  `--chart-axis-label: #5B5F54`, `--utilization: #7DA436`. (If a later task wants Tailwind utilities for
  grid/axis, it must add `@theme` mappings first; not in scope here.)

### C. Fonts

Swap the `@import` line in `index.css` to load `Source Serif 4` (400/600/700) + `IBM Plex Sans`
(400/500/600/700) + `IBM Plex Mono` (400/500/600), dropping the current Space Grotesk/Inter/JetBrains
Mono/Barlow import (Barlow is only used by the retired `.scn-theme`; JetBrains/Space Grotesk only by
dead Arcadia). Set at `:root`: `--app-font-sans: 'IBM Plex Sans', system-ui, sans-serif`;
`--app-font-mono: 'IBM Plex Mono', ui-monospace, monospace`; `--app-font-heading`, the existing
`--app-font-serif`, and new `--app-font-display` all → `'Source Serif 4', Georgia, serif`. **All three
serif-family vars must be set** — `@theme inline` maps `font-serif` through `--app-font-serif` (today
still `Georgia`); leaving it behind makes the `font-serif` utility inconsistent with the display/heading
treatment. The `@theme inline` `--font-*` mappings already read these vars.

### D. New utility classes (defined in `index.css`, consumed Waves 2/3)

- `.scnd-band` — `background: var(--surface-band); color: var(--surface-band-fg);` optional
  `border-bottom: 2px solid var(--green-400)`.
- `.scnd-kicker` — `font-family: var(--app-font-mono); font-size: 10.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--text-muted)` (raw complete-color token, not the
  `--muted-foreground` channel triple — per the token-representation rule).
- `.scnd-display` — `font-family: var(--app-font-display)` (serif titles; color applied per-use, green
  or on-band).

## Per-wave design

Three sequential waves. Each leaves the app coherent and gate-green on its own (Wave 1 alone already
ships the green/serif/paper look; band + studio polish layer on top).

### Wave 1 — Foundations (single writer: `index.css`)

- Retarget `:root` shadcn vars (table A — including every enumerated ink/white `*-foreground` and
  `--card-border`/`--popover-border`, so no blue token survives), add the full additive token inventory
  (B), swap fonts (C — all three serif-family vars incl. `--app-font-serif`), add utilities (D). Pin the
  four Tailwind radius vars explicitly (`--radius-sm/md/lg/xl` = 3/4/6/6px) plus base `--radius: 4px`.
  Declare the package shadows in `@theme inline`'s shadow namespace (`--shadow-sm`/bare/`-md`/`-lg`/`-xl`)
  and remove the dead transparent `:root`/`.dark --shadow-*` placeholders. Give `--chart-1..5` real HSL
  values (grid/axis/utilization stay hex).
- **Retire `.scn-theme`:** delete the `.scn-theme` rule body (its role now lives in `:root`); leave the
  `scn-theme` className on `Workspace.tsx:2265` as a harmless no-op so Wave 1 need not touch
  `Workspace.tsx`/`Workspace.test.tsx`/`MapLegend.tsx` just to drop a class. (A later trivial cleanup
  may remove the dead className; not required here.)
- Leave `--arc-*` / `.studio-lab` definitions in place (still referenced by dead `Studio.tsx` and, until
  Wave 3, by `ObjectiveBar.tsx`).
- **Exit check:** app builds; Landing/auth/Workspace render paper/green/serif with 4px radii and hairline
  borders; `pnpm --filter studio test` green (class/snapshot churn expected and updated).

### Wave 2 — Band motif + chrome (markup)

- **Landing hero — owned by `AppShell.tsx`, one band, no stacking.** Landing is rendered inside
  `AppShell` (`App.tsx:39` `authedOnly` → `<AppShell userEmail=…>`), whose existing white header
  (`AppShell.tsx:35`, `bg-background`) already carries the product name, `text-user-email`, and the
  logout button. Adding a second branded header inside `Landing.tsx` would stack two headers. **Decision:
  restyle `AppShell`'s header into the `.scnd-band` hero** — mono kicker "OPTIMIZATION STUDIO BY PROF.
  MICHAEL WATSON", green `.scnd-display` hero title, with `text-user-email` + logout on the right of the
  same band (matches the package thumbnail + `ui_kits/studio/Landing.jsx`, where account actions live in
  the hero band). **NotFound decision (one branch, explicit prop):** `AppShell` gains an optional
  `heroTitle?: string` prop — Landing passes `heroTitle="Network Design Labs"`; `NotFound` passes none,
  so its band shows the kicker + a small serif product wordmark + account actions, no large hero title.
  Wave 2's file inventory **must include `AppShell.tsx`** (and its test) + `pages/not-found.tsx`.
- **Landing body** (`pages/Landing.tsx`): the existing body `<h1>Labs</h1>` **stays** (the design kit
  keeps both the band hero and this body heading — "Labs" is not renamed); render it in `.scnd-display`
  serif. Chapter cards — `c.chapter` ("CHAPTER 3") as `.scnd-kicker`; `c.title` in serif; badges use
  status tokens (B); recent-solves stats mono (Wave 3 formalizes). Landing keeps no header of its own
  (the band is AppShell's).
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
  - `MapLegend.tsx` — this is the **input-map** legend; it owns entity/status/demand swatches only
    (warehouse/customer/mine markers, statuses, demand bubble), **not** distance bands. Move those
    swatches to the map-entity tokens. (Distance-band swatches live in `NetworkMap.tsx`'s built-in
    output legend — handled in the Data-viz item below, not here.)
- **Mono-numbers pass** — apply `--app-font-mono` (`font-mono`) to every number/stat display, prose
  stays sans. Numeric **inputs are data displays too** and receive `font-mono` (not only read-only
  cells). The plan **derives the full surface list from the current tree** (grep numeric renders +
  `<input type=number>`/numeric editors), not from this spec's memory. Known surfaces to cover, at
  minimum: ObjectiveBar stats; Landing recent-solves stats (`obj`/`mi`/`s`); the Output-Map metric
  overlay in `Workspace.tsx`; `ConstraintChips`; the Optimization Parameters tab controls; the Solve
  dialog (`SolveDialog.tsx`); entity dialogs (`CreateEntity`/`EditWarehouse`/`EditCustomer`/`MoveConfirm`)
  and `MapDetailsCard`/map tooltips; the result-history position indicator; and all Bundle-2.2 output +
  input grids and their numeric cells/editors — Open Warehouses, Customer Assignments, Solution Summary,
  Service Stats, Flows, Distances, plus Warehouses, Customers, Mines, Stations, Lane Costs, Leg
  Distances. Prose labels stay sans; kickers use mono via `.scnd-kicker`.
- **Data-viz alignment (real owners).** `lib/bandPalette.ts` — NOT `lib/bands.ts` — owns the
  application's band palette (`BAND_COLORS`, already a 5-entry hardcoded hex array, with its own tests);
  point it at `--band-0..4` and update `bandPalette.test.ts`. Reconcile marker/bubble/flow colors in
  `EntityMarkers.tsx` (input-map markers) and `NetworkMap.tsx` (output map) to the map-entity tokens.
  `NetworkMap.tsx` hardcodes **interaction-state ring colors** in two duplicate icon factories
  (`createTriangleIcon` + its sibling) — blue `#2D6CDF` forced-open, amber `#FCD34D` single-select,
  violet `#7C3AED` multi-select, slate `#64748B` default — replace each with the corresponding new
  `--map-ring-*` / `--map-default-stroke` token (B), **preserving the three-way visual distinction** so
  interaction states stay unambiguous. Distinguish the two legends in the file inventory: the input-map
  `MapLegend.tsx` (a component) vs `NetworkMap.tsx`'s separate **built-in output legend** with its own
  duplicate hardcoded colors — both must move to tokens. Marker geometry (triangles / demand bubbles) is
  already implemented; this aligns colors only, not shapes.
- **Exit check:** the 6 studio components visually match the reference; all numbers render mono; band
  coverage/legend use the 5-color scale; full studio suite green; live browser verify.

## Testing & verification

- Per-wave: `pnpm run typecheck` + `pnpm --filter studio test` green (frontend-focused, adequate mid-
  bundle since only `artifacts/studio` changes).
- **Final bundle gate = the repository's full canonical gate** (`CLAUDE.md` / `AGENTS.md`), run once at
  the end even though no backend/solver code changed:

  ```bash
  pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
    && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
  ```

  The standalone `e2e_accuracy.py` / `e2e_journey.py` scripts are NOT run (no solver change; `e2e_journey`
  is dead at auth anyway).
- **Token/radius contract test — NOT via jsdom.** Studio Vitest runs `environment: "jsdom"` (setup
  imports only `@testing-library/jest-dom`, no built stylesheet), so jsdom's `getComputedStyle` cannot
  validate Tailwind-generated CSS or custom-property resolution. Split the check: (a) a **deterministic
  source/build-output contract test** (parse `index.css` / the built CSS) asserting token *shape* — each
  shadcn/`@theme`-mapped var and every `--chart-1..5` is a 3-number HSL triple (not hex, not `red`), and
  the raw complete-color tokens are hex — which catches a triple-vs-complete-color mistake at build time;
  (b) a **Playwright computed-style smoke test** (real browser) asserting resolved colors/radii — band
  bg, primary green, a `Card`'s 6px radius, a `.shadow` non-transparent — reusing the existing workspace
  e2e precedent, which already uses browser `getComputedStyle(...)` for map SVG colors
  (`e2e/workspace-ux-r1-r9.spec.ts`).
- Expect and update class/snapshot/style assertions (e.g. `Workspace.test.tsx`, `MapLegend.test.tsx`,
  `bandPalette.test.ts`, any test asserting a specific color/utility class). Never weaken a
  behavioral/testid/role assertion to make a style change pass.
- Final: live-verify in a real browser (local dev, disposable account, purged after) — Landing band +
  serif title, auth band, Workspace band header, sidebar green active rule, mono stats, band-colored
  routes/legend — across at least two models (p-median-us + one other) to catch any per-model gate slip.

## Non-goals / scope guards

- No copy/wording changes **beyond the locked additive brand-chrome exceptions** (Global Constraints:
  the "Network Design Labs" band hero, the kicker, the auth author string); no new features; no map
  geometry changes (colors only).
- No dark mode; `Studio.tsx` / `.studio-lab` / `--arc-*` definitions left in place (dead).
- No shadcn component rebuilds; no importing the package's reference specimens.
- No API/spec/codegen/DB/solver changes → hard rules #1/#2/#6 not engaged.

## Resolved open item

The package is light-only; the sole dark surface is the dead `.studio-lab`/`Studio.tsx`. **Decision:
leave untouched** (zero-risk dead code). Deleting `Studio.tsx` + its `.studio-lab`/`--arc-*` CSS is a
separate cleanup, out of scope here — flagged as a future candidate. (After Wave 3, `--arc-*` is
consumed only by dead `Studio.tsx`.)

## Review comments (2026-09-03, verbatim)

> The overall direction matches `docs/design-system/DECISIONS.md`: promote the book-cover theme to
> global `:root`, preserve shadcn/Radix behavior, close-match only the 6 named studio components, use
> three independently green waves, and leave the dead `Studio.tsx`/`.studio-lab` surface alone.
>
> **Implementation blockers.** (1) Separate HSL-channel tokens from complete CSS colors —
> `.scnd-kicker` must use `hsl(var(--muted-foreground))` or a raw `--text-muted`, not
> `var(--muted-foreground)`; `--chart-1..5` cannot be hex/`var(--green-*)` while `@theme inline` maps
> them as `hsl(var(--chart-*))`; do not mix. (2) Correct the radius mapping — `--radius: 4px` resolves
> `sm/md/lg/xl` to `0/2/4/8`, not 3/4/6; `Card` uses `rounded-xl` (8px); pin the Tailwind radius
> variables explicitly incl. `xl`, and state the round-control no-pill exceptions. (3) Choose one owner
> for the Landing header — Landing renders inside `AppShell`, whose header already has product name /
> email / logout; Wave 2 must include `AppShell.tsx` and decide replace-as-band vs retain. (4) Fix the
> copy constraint — "copy unchanged" conflicts with `Labs`→`Network Design Labs`, the new kicker, and
> Register author text; reword to allow the locked brand-chrome/title exceptions.
>
> **Coverage corrections.** (5) Complete the token inventory — `--success-*`/`--warning-*`/`--danger-*`,
> `--line-strong`, `--focus-ring`, card/overlay shadows. (6) Derive the mono-number inventory from the
> current tree — include numeric form controls (Optimization Parameters, Solve dialog, entity dialogs,
> table editors), map detail cards/tooltips, result-history position, and Bundle-2.2 grids; numeric
> inputs get `font-mono` too. (7) Real map palette sources — `lib/bandPalette.ts` (not `lib/bands.ts`)
> owns the 5-entry palette + tests; `NetworkMap.tsx` has blue/amber/violet/slate rings + a built-in
> legend distinct from `MapLegend.tsx`; define tokens for single-/multi-selection before replacing, keep
> distinguishability. (8) Use the full final gate (typecheck + api-server + studio + solver pytest); add
> a CSS contract check for token representation and resolved radii.

## Review resolution (2026-09-03)

All eight verified against the code and fixed in-spec:

1. **Token representation** — added the strict "Token-representation rule" (both directions) in §A; raw
   complete-color tokens `--text-body/-muted/-faint/-brand` added in §B; `.scnd-kicker` now uses
   `var(--text-muted)` (§D); `--chart-1..5` declared HSL triples (§B, Wave 1).
2. **Radius** — §A "Radius (corrected)" + Wave 1 now pin `--radius-sm/md/lg/xl = 3/4/6/6px` (cap `xl`
   at 6 so `Card` lands at 6); round-control no-pill exceptions stated (Switch/radio/progress/demand
   bubbles).
3. **Landing header owner** — Wave 2 now owns it via `AppShell.tsx` (restyle its header into the
   `.scnd-band` hero incl. account actions; Landing drops its own header; `AppShell.tsx` + test in the
   inventory). Confirmed `App.tsx:39` wraps Landing in `AppShell`.
4. **Copy constraint** — replaced "Copy unchanged" with "Copy mostly frozen" + explicit locked
   exceptions (`Labs`→`Network Design Labs`, kicker/author strings).
5. **Token inventory** — §B expanded to full status sets, `--line-strong`, `--focus-ring`, and the flat
   `--shadow-sm/md/overlay` (replacing transparent placeholders).
6. **Mono-numbers** — Wave 3 now says the plan derives the surface list from the tree, numeric inputs
   included; enumerates the Bundle-2.2 grids, dialogs, map cards/tooltips, and result-history position.
7. **Map palette** — §B adds `--map-*` entity + NEW `--map-ring-forced-open/-select/-multiselect` +
   `--map-default-stroke` tokens; Wave 3 corrected to `lib/bandPalette.ts` (+ its test), the two
   duplicate `NetworkMap.tsx` icon factories, and the distinct input `MapLegend.tsx` vs the built-in
   output legend — distinction preserved.
8. **Final gate** — Testing §: final bundle gate = the full canonical command (incl. api-server +
   solver pytest); added a Wave-1 CSS-contract test for computed color/radii.

## Re-review comments (rev 2, 2026-09-03, verbatim)

> The first review's eight items are mostly resolved in substance. The following issues remain and
> should be corrected before the implementation plan is written.
>
> **Remaining implementation blockers.** (1) Root shadow variables do not retarget Tailwind shadow
> utilities — `.shadow`/`.shadow-sm`/`-md`/`-lg`/`-xl` compile from Tailwind's theme shadow namespace,
> not the similarly named `:root` app variables; live components use all of those classes (`Card`→
> `shadow`, dialogs/popovers→`shadow-md`/`-lg`, chart chrome→`shadow-xl`), so replacing the transparent
> `:root --shadow-*` placeholders won't apply the package shadows. Map Tailwind's shadow theme namespace
> (incl. bare `shadow`) or restyle every consumer; keep raw tokens under non-conflicting names so
> compile-time theme vars and runtime vars aren't conflated. (2) The "exhaustive/nothing TBD" token
> inventory still contains TBDs and a representation error — pin exact `--map-ring-*` values (not "ink/
> dark", "warning-family", "e.g. green-800/ink", which can give forced-open and multi-select the same
> dark color); replace the chart "e.g." list with exact HSL triples for `--chart-1..5`; only `--chart-1..5`
> are `@theme`-mapped, so `--chart-grid`/`--chart-axis-label`/`--utilization` stay pinned complete-color
> tokens.
>
> **Remaining consistency/coverage corrections.** (3) Resolve the Landing-body and NotFound choices in
> the spec, not the plan — the text first says the body keeps its `Labs` section then says `Labs` moves
> into the band as `Network Design Labs`; decide (the kit keeps both), and replace the "shared hero is
> acceptable [on NotFound] (or the plan may pass an optional hero title)" branch with one decision +
> `AppShell` prop/route behavior. (4) Make Non-goals match the corrected copy rule ("No other copy/wording
> changes beyond the locked brand-chrome exceptions"). (5) Finish the global foundation retarget — set
> `--app-font-serif` to Source Serif 4 (`@theme` maps `font-serif` through it); retarget `--card-border`/
> `--popover-border` to line; enumerate every `*-foreground` rather than the ambiguous "`*-foreground`
> (body)". (6) Don't rely on jsdom for the computed-CSS contract (studio Vitest is jsdom, no built
> stylesheet) — use a source/build-output contract test for token shape + a Playwright computed-style
> smoke test (workspace e2e already uses browser `getComputedStyle` for map SVG colors). (7) Correct the
> earlier MapLegend sentence — it owns input-map entity/status/demand swatches, not `--band-*`; make it
> agree with the later Data-viz section. Editorial: "sibble" → "sibling".

## Re-review resolution (rev 2, 2026-09-03)

All seven + editorial verified against code and fixed:

1. **Shadows** — confirmed `@theme inline` declares no shadow keys (so `.shadow*` use Tailwind defaults;
   `:root --shadow-*` are dead). §B/Wave 1 now declare package shadows in the `@theme` shadow namespace
   (`--shadow-sm`/bare/`-md`/`-lg`/`-xl`) and remove the transparent `:root`/`.dark` placeholders; raw
   tokens, if ever needed, use `--elevation-*`.
2. **Token TBDs** — `--map-ring-*` pinned to exact hex (kept as functional-affordance values, a
   documented reversal with rationale: palette lacks 3 contrasting ring hues; distinction preserved by
   color + unchanged geometry); `--chart-1..5` pinned to exact HSL triples; grid/axis/utilization kept as
   pinned hex (not `@theme`-mapped).
3. **Landing/NotFound** — grounded against `ui_kits/studio/Landing.jsx`: kit keeps **both** the band hero
   and the body `<h1>Labs</h1>`. Spec now keeps both (Labs not renamed; "Network Design Labs" is additive
   band chrome) and gives `AppShell` an optional `heroTitle` prop (Landing sets it, NotFound doesn't) —
   one decision, `not-found.tsx` added to the inventory.
4. **Non-goals** — reworded to "No copy/wording changes beyond the locked additive brand-chrome
   exceptions".
5. **Foundation retarget** — §C sets all three serif vars incl. `--app-font-serif`; table A adds
   `--card-border`/`--popover-border` → line and a full ink/white `*-foreground` enumeration.
6. **Contract test** — confirmed studio Vitest = jsdom; replaced with a source/build-output token-shape
   contract test + a Playwright computed-style smoke test (reusing `e2e/workspace-ux-r1-r9.spec.ts`'s
   `getComputedStyle` precedent).
7. **MapLegend** — earlier close-match bullet corrected to entity/status/demand swatches; band swatches
   attributed to `NetworkMap.tsx`'s output legend. "sibble" → "sibling".

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
