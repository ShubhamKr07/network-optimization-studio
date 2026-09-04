# Bundle 6 — Workspace + Landing/auth UI tweaks

**Date:** 2026-09-04
**Status:** Design (pending written-spec review)

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
+ Orval regen (backend); `pages/Workspace.tsx` (frontend).

- **Backend:** add `solvedAt: string|null (date-time)` to the `Scenario`
  response schema and populate it in `toApiScenario` (the column exists on the
  `scenarios` table; `stale` is already derived from it server-side). Regen.
- **Frontend:** when the route has **no** `?scenario=` param, pick the default
  scenario as the one with the greatest non-null `solvedAt` (the last-solved);
  if none is solved, fall back to the greatest `updatedAt` (most-recently
  edited). Currently `currentScenario` defaults to `scenarios?.[0]`
  (Workspace.tsx:876) — replace that fallback with this selection.
- On entry, open that scenario's **Input Map** tab by default (dispatch an
  `open input input-map` tab if no tab is active). A `?scenario=` deep link
  (e.g. from Landing's recent-solves) still wins and is respected.

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
  (`components/workspace/map/MapLegend.tsx`, `absolute bottom-4 left-4 … p-2 …
  text-xs`, swatches `w-[18px] h-[18px]`); the Output Map uses NetworkMap's own
  built-in legend (`OutputMapTab.tsx:241`, `NetworkMap.tsx:~590`). Size the
  Input Map `MapLegend` box (padding, width/min-width, font size, swatch size)
  to match the Output Map legend's box exactly. **The Output Map legend's
  dimensions are the reference** — read NetworkMap's legend styling in the plan
  and align MapLegend to it (no restyle of the Output legend). Preserve all
  `legend-*` testids.

## Item 8 — Hide Chapter 5 models from Landing

**Files:** `lib/chapters.ts`.

- Set `hiddenFromLanding: true` on `transport-coal` and `p-median-brazil` (the
  two Chapter 5 models), same mechanism as `two-echelon-gold-au`. Routes stay
  registered (deep links/scenarios still work); they simply don't appear in the
  Landing card grid. `visibleLabs`/stats and item 12's footer both derive from
  the `!hiddenFromLanding` filter, so they update automatically.

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

- Presentation-only except item 1's added `solvedAt` field. Tokens only from the
  theme; light theme; `designTokens.contract.test.ts` stays green.
- Preserve every unrelated `data-testid`/`aria-*` and all mutation/logout logic.
- Never hand-edit generated code; regenerate via Orval and commit spec +
  output together (item 1).
- One commit per task, message `[bundle6-T<n>] <summary>`.

## Execution (agent team, file-disjoint tasks + standing QA)

- **T1** (backend) — `Scenario.solvedAt` on the API: `openapi.yaml` +
  `routes/scenarios.ts` (`toApiScenario`) + regen + `routes.test.ts`.
- **T2** (frontend) — `Workspace.tsx` items 1(frontend)/2/3/5 (+ its tests).
  **Depends on T1** (needs the regenerated `solvedAt` on the Scenario type).
- **T3** (frontend) — `CostSummaryTab.tsx` item 4 (+ its tests).
- **T4** (frontend) — `MapLegend.tsx` item 7 (+ tests).
- **T5** (frontend) — Landing/auth tweaks items 8/9/10/11/12/13: `chapters.ts`,
  `AppShell.tsx`, `DeveloperCredit.tsx`, `Login.tsx`, `Register.tsx`,
  `AuthShell.tsx` (+ their tests). All six files disjoint from T1-T4.
- **T6** (QA) — `qa-sdet` real Playwright: last-solved landing + Input Map, header
  has no picker/email/logout + chapter summary left, pronounced stepper,
  Solution Summary compare has no utilization + hyphenated city-state, Landing
  hides Ch5 + bigger cover, login "Register"/generic placeholder/"Reach out
  at"/single-chapter footer strip. **Standing per memory — QA is a first-class
  plan task.**

T1/T3/T4/T5 run in parallel (disjoint); T2 after T1; QA after all. Controller
cherry-picks each onto main + re-gates; final whole-branch review; then surface
deploy.
