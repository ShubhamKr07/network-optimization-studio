# Bundle 6 — Workspace + Landing/auth UI tweaks

**Date:** 2026-09-04
**Status:** Design — written-spec review resolved (see resolutions log)

## Written-spec review — resolutions (2026-09-04)

Five findings; all resolved inline:

1. **[P1] Item 8 hid cards, not models (user chose: hide everywhere).**
   `hiddenFromLanding` only filters the card grid; Recent Solves, the stats
   line, and the active badge still counted hidden models. **Resolved:** item 8
   now hides Ch5 EVERYWHERE on Landing — cards + Recent Solves + stats totals +
   active-badge pick all filter to non-hidden modelIds. Needs one small backend
   field (`LandingSummaryChapter.solvedScenarioCount`, already computed in the
   landing-summary solve query but not yet exposed) so the visible "N solved"
   total is derivable frontend-side. Folded into T1's backend contract work;
   Landing.tsx filtering added to T5.
2. **[P1] Item 7 had no measurable "equal size."** Both legends are
   content-driven; copying `p-2`/`gap-2`/`text-xs` can't equalize the boxes.
   **Resolved:** item 7 targets **visual-shell parity + a shared fixed width** —
   match padding, typography, gap, border/radius, and a 14px marker/swatch
   scale, and pin both legend boxes to the same `min-width` so they read as the
   same box; height still varies with content (documented, not pixel-identical).
3. **[P2] Item 1 Input-Map seeding must be one-shot.** An effect that opens
   Input Map whenever `activeTab` is null would reopen it after the user closes
   the last tab, defeating the reducer's empty state. **Resolved:** seed the
   Input Map tab exactly ONCE per Workspace mount/model entry (a ref-guarded
   one-shot), never a reactive open-when-null; T2 test asserts closing the final
   tab leaves no tab active.
4. **[P2] Tests must be UPDATED, not only added.** Items 8/12 invalidate
   existing auth-strip/labs-count assertions; items 2/3 invalidate Workspace
   picker/email/logout assertions. **Resolved:** each task updates its OWN
   affected unit tests (T2 Workspace, T5 Landing/AuthShell); T6 (QA) updates the
   affected e2e specs (`e2e/bundle4-auth-landing.spec.ts:50-51,110-114`) AND
   runs the FULL Playwright suite, not just new coverage.
5. **[P2] Global logout constraint contradicted item 3.** **Resolved:** the
   constraint is reworded to "preserve every unrelated `data-testid`/`aria-*`,
   all UNRELATED mutation logic, and Landing's logout behavior" — item 3 removes
   Workspace's own logout deliberately.

## Goal

Twelve user-requested UI/UX refinements to the model workspace and the
Landing/auth surfaces. (The user's item 6 — distance-metric selection that
feeds the solver — is **split into its own later bundle**; see "Deferred".)

## Scope / non-goals

- Presentation-only **except** item 1, which exposes `solvedAt` on the Scenario
  API (one added read-only field; `solvedAt` already exists in the DB — no
  schema change).
- Light theme only; tokens from `index.css` / the theme system; no
  `Studio.tsx` / `.studio-lab` / `--arc-*`. Never hand-edit generated code.
- Preserve every unrelated `data-testid`, `aria-*`, and mutation/logout logic.

## Deferred (item 6 → its own bundle)

Distance-metric selection (euclidean / haversine / true road) that **replaces**
the solve distance source and **feeds the solver**. Locked decisions for that
bundle: metric replaces the textbook matrix (requires an explicit
`e2e_accuracy.py` hard-rule-2 override); a **real routing provider** is wired
(user supplies provider choice + API key); large surface (`solve.py`,
`merge_inputs.py`, datasets, accuracy tests, matrix caching). Not in Bundle 6.

---

## Item 1 — Land on the last-solved scenario's Input Map

**Files:** `lib/api-spec/openapi.yaml` + `routes/scenarios.ts` (`toApiScenario`)
+ `routes/landingSummary.ts` + Orval regen (backend, all in T1);
`pages/Workspace.tsx` (frontend, T2).

- **Backend (T1):** add `solvedAt: string|null (date-time)` to the `Scenario`
  response schema and populate it in `toApiScenario` (the column exists on the
  `scenarios` table; `stale` is already derived from it server-side). Regen.
  (T1 also adds `solvedScenarioCount` to `LandingSummaryChapter` for item 8 —
  see resolution #1.)
- **Frontend (T2):** when the route has **no** `?scenario=` param, pick the
  default scenario as the one with the greatest non-null `solvedAt` (the
  last-solved); if none is solved, fall back to the greatest `updatedAt`
  (most-recently edited). Currently `currentScenario` defaults to
  `scenarios?.[0]` (Workspace.tsx:876) — replace that fallback with this
  selection.
- **One-shot Input Map seeding (resolution #3):** on entry, open that
  scenario's **Input Map** tab ONCE per Workspace mount/model entry — guard with
  a ref (e.g. `didSeedTabRef`) so it fires a single time after the scenario
  resolves, NOT a reactive "open Input Map whenever `activeTab` is null" (which
  would reopen it the instant the user closes the last tab, defeating
  `lib/workspaceTabs.ts`'s intentional empty-tab state). A `?scenario=` deep
  link (e.g. from Landing's recent-solves) still wins. **T2 test:** closing the
  final tab leaves no tab active (Input Map does NOT auto-reopen).

## Item 2 — Remove header scenario dropdown; chapter+summary to far left

**Files:** `pages/Workspace.tsx`.

- Remove the "Scenario:" label + `<select data-testid="select-scenario-context">`
  (Workspace.tsx:2300-2317) from the header's left zone.
- Move the chapter summary (`workspace-chapter-summary`, currently the center
  grid track, 2327-2341) into the **left zone**, immediately after the
  back-arrow button. Collapse the 3-track grid (`auto_1fr_auto`) accordingly
  (e.g. `1fr_auto`: left = back + chapter/summary, right = stepper + solve).
- Scenario switching is via the sidebar Scenarios tree only (already exists —
  `SidebarTree onSelectScenario`); no header picker.

## Item 3 — Remove email + Log out from the model page header

**Files:** `pages/Workspace.tsx`.

- Remove the `text-user-email` span (2348-2350) and the `button-logout`
  `<Button>` (2353-2361) from the header's right zone (delete the now-empty
  top row div). Remove the now-unused `handleLogout`/`useLogoutUser` (and its
  import) to keep the file lint-clean.
- Logout remains available from Landing (`AppShell` hero has Log out); the
  header back-arrow already returns to `/`. `userEmail` prop stays on
  `WorkspaceProps` (still passed by App.tsx) even though the header no longer
  renders it — do not touch App.tsx.

## Item 4 — Solution Summary compare: drop utilization; hyphenate City-State

**Files:** `components/workspace/tabs/CostSummaryTab.tsx`.

- Remove the "Aggregate utilization" compare row (the `<tr>` at ~331-347 with
  `data-testid="cost-summary-compare-utilization-${s.id}"`) entirely, and the
  `aggregateUtilization` helper if it becomes unused.
- In `facilityCityLabel` (~97-104), change the city/state pair separator from
  `", "` to `" - "` (hyphen): `` `${city} - ${state}` ``. Leave
  `openFacilityCityList`'s inter-facility join as `", "` (disambiguation:
  "New York - NY, Chicago - IL"). Any other `${city}, ${state}` in this file's
  compare output gets the same hyphen treatment; do not touch non-compare tabs.

## Item 5 — Make the result-history stepper arrows more pronounced

**Files:** `pages/Workspace.tsx`.

- The `←`/`→` text buttons (2369-2391, `button-result-back`/`button-result-forward`,
  `w-6 h-6`, `--ink-300`) are easy to miss. Replace the bare text glyphs with
  lucide `ChevronLeft`/`ChevronRight` icons at a larger, higher-contrast affordance:
  bigger hit area (`w-8 h-8`), brighter resting color (`--surface-band-fg` with a
  subtle border, e.g. `border border-[color:var(--ink-500)]`), keeping the
  existing disabled (`opacity-30`) + hover (`bg-white/10`) states and both
  testids. Keep the `text-result-history-position` counter between them.

## Item 7 — Input Map legend box equal size to the Output Map legend

**Files:** `components/workspace/map/MapLegend.tsx` (and/or its InputMapTab
call sites).

- The Input Map renders the standalone `MapLegend`
  (`components/workspace/map/MapLegend.tsx:83-130`, `absolute bottom-4 left-4 …
  p-2 … text-xs`, swatches `w-[18px] h-[18px]`); the Output Map uses NetworkMap's
  own built-in legend (`OutputMapTab.tsx:241`, `NetworkMap.tsx:587-634`).
- **"Equal size" = visual-shell parity + shared width (resolution #2).** The two
  legends have content-driven heights (conditional mine/band/hint rows;
  variable demand buckets), so they cannot be pixel-identical without
  truncation. Instead make them read as the same box: align MapLegend's
  padding, typography, gap, and border/radius to NetworkMap's legend (the
  **Output legend is the reference** — do NOT restyle it), normalize the
  marker/swatch scale to a shared **14px**, and pin BOTH legend boxes to the
  same `min-width` so their widths match. Height still varies with content —
  this is documented, not pixel-identical. Read NetworkMap's exact legend
  styling in the plan to derive the shared `min-width`/padding values. Preserve
  all `legend-*` testids.

## Item 8 — Hide Chapter 5 models from Landing (everywhere)

**Files:** `lib/chapters.ts`; `pages/Landing.tsx` (+ test);
`LandingSummaryChapter.solvedScenarioCount` from T1 (backend).

- **`chapters.ts`:** set `hiddenFromLanding: true` on `transport-coal` and
  `p-median-brazil` (the two Chapter 5 models), same mechanism as
  `two-echelon-gold-au`. Routes stay registered (deep links/scenarios still
  work).
- **`Landing.tsx` — hide everywhere (resolution #1, user chose "everywhere"):**
  the card grid already filters `!hiddenFromLanding`. Additionally:
  - **Recent Solves:** filter the `useGetSolveHistory` entries to non-hidden
    modelIds (drop rows whose `modelId` maps to a hidden chapter).
  - **Active badge:** compute `activeModelId` over only the non-hidden
    `perChapter` rows.
  - **Stats line:** compute the visible totals frontend-side over non-hidden
    `perChapter` — scenarios = Σ `scenarioCount`, solved = Σ
    `solvedScenarioCount` (the new T1 field) — instead of the endpoint's global
    `totals`. `labs` = non-hidden chapter count (already so).
- **`LandingSummary` (T1 backend):** add `solvedScenarioCount: integer` to each
  `LandingSummaryChapter` (the value is already computed per-model as
  `countDistinct(scenarioId)` in `routes/landingSummary.ts`'s solve query — just
  include it per row). Regen. This is what makes the visible "N solved"
  derivable without trusting the global total.
- Item 12's footer also derives from `!hiddenFromLanding` (unchanged).

## Item 9 — Homepage hero cover fuller, beside the text

**Files:** `components/AppShell.tsx`.

- The hero-band book-cover `<img>` (Bundle 5, `h-12 w-auto` ≈ 48px) grows to
  ~96px tall (`h-24 w-auto`), still the first child of the band flex row (left
  of the kicker/title/tagline block), keeping the drop shadow + `rounded-sm`.
  Only the `hero` branch; compact band unchanged.

## Item 10 — Footer copy "Reach me out at" → "Reach out at"

**Files:** `components/DeveloperCredit.tsx`.

- Change the string "Reach me out at" to "Reach out at". Shared component →
  updates both the login page and the homepage footer.

## Item 11 — Login cross-link "Register with your course email" → "Register"

**Files:** `pages/auth/Login.tsx`.

- Change the register `<Link>` text from "Register with your course email" to
  "Register". (Login test asserts `/Register/` — still matches.)

## Item 12 — Login footer strip: active chapters, not models

**Files:** `components/auth/AuthShell.tsx`.

- Replace the hardcoded 4-model `LABS` array (`"Ch 3 · p-median"`, …) with a
  list derived from `CHAPTERS` (`@/lib/chapters`): **distinct non-hidden
  chapters** (`!hiddenFromLanding`), deduped by the `chapter` field, one label
  per chapter (e.g. `"Chapter 3"`), never per model. After item 8 this renders
  just "Chapter 3"; it grows automatically as chapters are unhidden. Keep the
  `auth-labs-strip` testid + styling.

## Item 13 — Generic email placeholder

**Files:** `pages/auth/Login.tsx`, `pages/auth/Register.tsx`.

- Change the email `Input` placeholder from `"you@university.edu"` to a generic
  `"you@example.com"` on both pages.

---

## Global constraints (bind every item)

- Presentation-only except T1's added read-only API fields (`Scenario.solvedAt`,
  `LandingSummaryChapter.solvedScenarioCount` — both already computed
  server-side, no schema/DB change). Tokens only from the theme; light theme;
  `designTokens.contract.test.ts` stays green.
- Preserve every UNRELATED `data-testid`/`aria-*`, all UNRELATED mutation logic,
  and Landing's logout behavior (resolution #5). Item 3 removes Workspace's own
  logout deliberately; that is not a violation.
- Each task UPDATES its own affected existing tests (not just adds) —
  resolution #4.
- Never hand-edit generated code; regenerate via Orval and commit spec +
  output together (T1).
- One commit per task, message `[bundle6-T<n>] <summary>`.

## Execution (agent team, file-disjoint tasks + standing QA)

- **T1** (backend) — API contract additions: `Scenario.solvedAt` (in
  `toApiScenario`) + `LandingSummaryChapter.solvedScenarioCount` (in
  `routes/landingSummary.ts`'s solve group): `openapi.yaml` +
  `routes/scenarios.ts` + `routes/landingSummary.ts` + Orval regen +
  `routes.test.ts`.
- **T2** (frontend) — `Workspace.tsx` items 1(frontend)/2/3/5 (+ updates its own
  picker/email/logout unit tests). **Depends on T1** (`Scenario.solvedAt`).
- **T3** (frontend) — `CostSummaryTab.tsx` item 4 (+ tests).
- **T4** (frontend) — `MapLegend.tsx` item 7 (+ tests).
- **T5** (frontend) — item 8-everywhere + item 12: `chapters.ts`, `Landing.tsx`,
  `AuthShell.tsx` (+ update their tests — auth-strip labels, labs count).
  **Depends on T1** (`LandingSummaryChapter.solvedScenarioCount` for the stats).
- **T6** (frontend) — auth/homepage copy items 9/10/11/13: `AppShell.tsx`,
  `DeveloperCredit.tsx`, `Login.tsx`, `Register.tsx` (+ tests). Independent of
  T1. (File-disjoint from T5 — item 12's `AuthShell.tsx` is T5; the auth pages
  are T6.)
- **T7** (QA) — `qa-sdet` real Playwright: last-solved landing + Input Map (+
  closing last tab leaves none open), header has no picker/email/logout +
  chapter summary left, pronounced stepper, Solution Summary compare has no
  utilization + hyphenated city-state, Landing hides Ch5 EVERYWHERE (cards +
  recent solves + stats) + bigger cover, login "Register"/generic
  placeholder/"Reach out at"/single-chapter footer strip. **UPDATES the affected
  existing e2e specs** (`bundle4-auth-landing.spec.ts`) and runs the FULL
  Playwright suite. Standing QA task per memory.

T1/T3/T4/T6 run in parallel (disjoint); **T2 and T5 both after T1** (need its
regenerated types); T7 (QA) after all. Controller cherry-picks each onto main +
re-gates; final whole-branch review; then surface deploy.
