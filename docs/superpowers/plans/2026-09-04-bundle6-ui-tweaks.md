# Bundle 6 — Workspace + Landing/auth UI tweaks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twelve UI/UX refinements to the model Workspace and Landing/auth surfaces (item 6 — solver-feeding distance metrics — is a separate later bundle).

**Architecture:** T1 adds two read-only API fields (both already computed server-side); everything else is presentation. Seven tasks; T1/T3/T4/T6 parallel, T2 & T5 after T1, T7 (QA) last.

**Tech Stack:** React + Vite + Tailwind + shadcn + wouter + TanStack Query; Express 5 + Drizzle + orval/OpenAPI; vitest + RTL + Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-bundle6-ui-tweaks-design.md` (review-resolved). Read its resolutions log — it governs item 8 (hide everywhere), item 7 (shell parity), item 1 (one-shot seed), tests (update-not-add), and the logout constraint.

## Plan review — resolutions (2026-09-05)

Five findings; all fixed inline:

1. **[P1] "Full Playwright suite" can't pass — `labs.spec.ts` is known debt.**
   `e2e/labs.spec.ts` targets a stale remote + pre-D0 API shape (CLAUDE.md:218)
   and would fail any real run. **Fixed (T7):** run the Bundle-6-affected + new
   specs and explicitly **exclude `labs.spec.ts`** (via `--grep-invert`/an
   ignore); the plan no longer claims a green "full suite." labs.spec.ts's port
   stays a separate documented debt item, out of Bundle 6's scope.
2. **[P1] T2 header overflows narrow viewports.** The proposed non-wrapping
   flex row with a `flex-shrink-0` right cluster drops the current responsive
   one-column behavior (`Workspace.test.tsx:1809`) and overflows 375px. **Fixed
   (T2 Step 3):** the header stays a responsive grid —
   `grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto]` (stacks to one column
   below `md`); the narrow-viewport test is updated (T2 Step 5).
3. **[P1] Shared `min-width` ≠ shared width.** `min-w` only helps when content
   is narrower; either legend can grow past it (Input's wrapping demand row
   especially). **Fixed (T4):** both legend boxes use a shared **fixed**
   `w-[220px]` with `flex-wrap` on the marker rows (content wraps within the
   fixed width — minor intentional wrap of the Output row is accepted to achieve
   parity); T7 adds a real-browser assertion that the two legends'
   bounding-box widths are equal.
4. **[P2] Commit commands had shell placeholders.** `<the … test file>` parses
   as shell input redirection — unexecutable. **Fixed:** every commit command
   now uses exact paths (`artifacts/studio/src/__tests__/{Workspace,CostSummaryTab,Landing,Login,Register,AppShell}.test.tsx`;
   no `AuthShell.test.tsx` exists — T5's strip is covered via `Login.test.tsx`).
5. **[P2] T7 Login assertions need an unauthenticated state.** After the spec
   registers a user, `Gate` redirects `/login` → Landing. **Fixed (T7):** the
   Login assertions live in a separate unauthenticated `describe`/`test` using
   `storageState: undefined` (mirroring `bundle4-auth-landing.spec.ts`).

## Global Constraints

- Presentation-only except T1's `Scenario.solvedAt` + `LandingSummaryChapter.solvedScenarioCount` (both already computed server-side; no schema/DB change).
- Preserve every UNRELATED `data-testid`/`aria-*`, all UNRELATED mutation logic, and Landing's logout. Item 3 removes Workspace's OWN logout deliberately.
- Each task UPDATES its own affected existing tests, not just adds.
- Never hand-edit generated code; regenerate via `pnpm --filter @workspace/api-spec run codegen`, commit spec + output together (T1).
- Tokens only from the theme; light theme; no `Studio.tsx`/`.studio-lab`/`--arc-*`.
- One commit per task, `[bundle6-T<n>] <summary>`; commit from your own worktree with an explicit pathspec; re-check `git status` first. NEVER delegate to GLM.

---

## Task T1 — API contract additions (`[bundle6-T1]`)

**Files:** `lib/api-spec/openapi.yaml`; `artifacts/api-server/src/routes/scenarios.ts`; `artifacts/api-server/src/routes/landingSummary.ts`; Orval-regenerated `lib/api-zod`/`lib/api-client-react`; `artifacts/api-server/src/__tests__/routes.test.ts`.

**Interfaces:**
- Produces: `Scenario.solvedAt: string|null` (date-time); `LandingSummaryChapter.solvedScenarioCount: integer`.

- [ ] **Step 1: `toApiScenario` — add `solvedAt`**

In `routes/scenarios.ts`, add to the object `toApiScenario` returns (after `updatedAt`):
```ts
    solvedAt: row.solvedAt ? row.solvedAt.toISOString() : null,
```

- [ ] **Step 2: `landingSummary.ts` — expose per-model solved count**

In `perChapter`'s `.map`, include the per-model distinct-solve count (already computed as `solvedScenarios` on the grouped `solveByModel` row):
```ts
  const perChapter = scenarioRows.map((r) => {
    const s = solveByModel.get(r.modelId);
    return {
      modelId: r.modelId,
      scenarioCount: Number(r.scenarioCount),
      solvedScenarioCount: Number(s?.solvedScenarios ?? 0),
      lastSucceededSolveAt: s?.lastSucceededSolveAt?.toISOString() ?? null,
    };
  });
```

- [ ] **Step 3: OpenAPI — both new fields**

In `lib/api-spec/openapi.yaml`, add to the `Scenario` schema `properties` and its `required`:
```yaml
        solvedAt:
          type: ["string", "null"]
          format: date-time
```
(add `solvedAt` to the `Scenario` `required` list). And in `LandingSummaryChapter`:
```yaml
        solvedScenarioCount:
          type: integer
```
(add `solvedScenarioCount` to its `required: [modelId, scenarioCount, lastSucceededSolveAt]` → `[modelId, scenarioCount, solvedScenarioCount, lastSucceededSolveAt]`).

- [ ] **Step 4: Regen**

```bash
pnpm --filter @workspace/api-spec run codegen
```
Commit the changed generated files (verify with `git status`) with the spec. Do NOT hand-edit generated output.

- [ ] **Step 5: Tests**

In `routes.test.ts`:
- The scenarios tests that assert a returned scenario shape: add `solvedAt` to the mocked `scenariosTable` row fixtures (e.g. `solvedAt: new Date("2026-09-04T12:00:00Z")` for a solved row, `null` for unsolved) and assert `res.body.solvedAt` is the ISO string / null. If a test used `toMatchObject`, it stays green; if it used `toEqual` on the whole scenario, add the field.
- The `landing-summary` dedupe/mapping test (`configureSolveHistoryMocks`-style, from Bundle 4/5): assert each `perChapter` row now carries `solvedScenarioCount` equal to the grouped `solvedScenarios`.

- [ ] **Step 6: Gate + commit**

```bash
pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
git commit -m "[bundle6-T1] Scenario.solvedAt + LandingSummaryChapter.solvedScenarioCount" -- \
  lib/api-spec/openapi.yaml artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/routes/landingSummary.ts \
  artifacts/api-server/src/__tests__/routes.test.ts lib/api-zod/src/generated lib/api-client-react/src/generated
```

---

## Task T2 — Workspace header + entry (`[bundle6-T2]`, items 1-fe/2/3/5)

**Depends on T1** (`Scenario.solvedAt`). **Files:** `artifacts/studio/src/pages/Workspace.tsx` (+ `Workspace.test.tsx` / the relevant Workspace RTL spec).

- [ ] **Step 1: Default scenario = last-solved (item 1)**

Replace the `currentScenario` fallback (Workspace.tsx:876). Current:
```ts
const currentScenario = scenarioFromApi ?? scenarios?.find(s => s.id === scenarioIdFromUrl) ?? scenarios?.[0];
```
New — when there's no URL scenario, prefer the greatest non-null `solvedAt`, else the greatest `updatedAt`:
```ts
const defaultScenario = useMemo(() => {
  const list = scenarios ?? [];
  if (!list.length) return undefined;
  const solved = list.filter(s => s.solvedAt != null);
  if (solved.length) {
    return solved.reduce((best, s) => (s.solvedAt! > best.solvedAt! ? s : best));
  }
  return list.reduce((best, s) => (s.updatedAt > best.updatedAt ? s : best));
}, [scenarios]);
const currentScenario = scenarioFromApi ?? scenarios?.find(s => s.id === scenarioIdFromUrl) ?? defaultScenario;
```

- [ ] **Step 2: One-shot Input Map seeding (item 1, resolution #3)**

Add a ref + effect that opens the Input Map tab exactly once per model entry, never reactively on `activeTab === null`:
```ts
const didSeedTabRef = useRef<string | null>(null);
useEffect(() => {
  if (!currentScenario) return;
  if (didSeedTabRef.current === modelId) return;   // already seeded for this model
  didSeedTabRef.current = modelId;
  const entry = inputEntriesForModel(modelId).find(e => e.id === "input-map");
  if (entry) openTab("input", entry);
}, [currentScenario, modelId]);
```
(`openTab`/`inputEntriesForModel` already exist. The ref keys on `modelId` so navigating to a different chapter re-seeds once; closing the last tab does NOT reopen it — the effect's guard is already tripped.)

- [ ] **Step 3: Header restructure (items 2 + 3)**

Replace the header's inner grid (Workspace.tsx:2284-2416) with a two-zone flex: left = back-arrow + chapter summary (moved from center, left-aligned); right = stepper + Save-as-scenario + Run Optimizer. Remove the `select-scenario-context` dropdown, the `text-user-email` span, and the `button-logout` Button.
```tsx
<header className="scnd-band flex-shrink-0">
  {/* Responsive grid (resolution #2): two tracks at md+ (summary | controls),
      collapses to one stacked column below md so nothing overflows 375px. */}
  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:gap-4 px-4 py-1.5 min-h-14">
    {/* Left — back + chapter/summary */}
    <div className="flex items-center gap-2 min-w-0">
      <button onClick={() => navigate("/")} data-testid="button-page-back" title="Back to models"
        className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-[color:var(--ink-300)] hover:text-[color:var(--surface-band-fg)] hover:bg-white/10 transition-colors">
        <ArrowLeft className="w-4 h-4" />
      </button>
      {(() => {
        const activeChapter = chapterForModelId(modelId);
        if (!activeChapter) return null;
        return (
          <div data-testid="workspace-chapter-summary" className="min-w-0 truncate text-xs"
            title={`${activeChapter.chapter} · ${activeChapter.description}`}>
            <span className="scnd-kicker">{activeChapter.chapter}</span>
            <span className="text-[color:var(--ink-300)]"> · </span>
            <span className="scnd-display text-[color:var(--surface-band-fg)]">{activeChapter.description}</span>
          </div>
        );
      })()}
    </div>
    {/* Right — stepper + save-as + run (own grid track at md+; wraps/stacks
        below md, never forces horizontal overflow). */}
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {resultHistoryState.items.length > 0 && (
        <div className="flex items-center gap-1 text-xs">
          <button type="button" data-testid="button-result-back" disabled={!canGoBackResult} onClick={stepResultBack} title="Previous result"
            className="w-8 h-8 rounded flex items-center justify-center border border-[color:var(--ink-500)] text-[color:var(--surface-band-fg)] hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[color:var(--ink-300)] w-10 text-center font-mono" data-testid="text-result-history-position">
            {resultHistoryState.index + 1}/{resultHistoryState.items.length}
          </span>
          <button type="button" data-testid="button-result-forward" disabled={!canGoForwardResult} onClick={stepResultForward} title="Next result"
            className="w-8 h-8 rounded flex items-center justify-center border border-[color:var(--ink-500)] text-[color:var(--surface-band-fg)] hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button type="button" data-testid="button-save-as-scenario" onClick={handleSaveAsScenario} disabled={createScenario.isPending}
            className="text-xs border border-[color:var(--ink-500)] text-[color:var(--ink-300)] rounded px-2 py-1 hover:bg-white/10 hover:text-[color:var(--surface-band-fg)]">
            Save as scenario
          </button>
        </div>
      )}
      <Button size="sm" disabled={!currentScenario} onClick={openSolveDialog} data-testid="button-run-optimizer">Run Optimizer</Button>
    </div>
  </div>
</header>
```
Add `ChevronLeft, ChevronRight` to the existing lucide import (which already imports `ArrowLeft`).

- [ ] **Step 4: Remove dead logout code (item 3)**

Delete `handleLogout` and the `useLogoutUser` import/usage (Workspace.tsx:842-852 region) — now unused. Keep the `userEmail` prop on `WorkspaceProps` (App.tsx still passes it; just no longer rendered). Verify no other reference to `handleLogout`/`logoutUser` remains (`grep`).

- [ ] **Step 5: Update Workspace tests**

In `artifacts/studio/src/__tests__/Workspace.test.tsx`: remove/replace assertions about `select-scenario-context`, `text-user-email`, and `button-logout` (they're gone). **Update the narrow-viewport test (`Workspace.test.tsx:1809`)** — it currently anchors the responsive grid via `screen.getByTestId("select-scenario-context").closest('[class*="grid-cols-1"]')`; re-anchor on `workspace-chapter-summary` (or `button-page-back`) and assert the new responsive grid classes (`grid-cols-1` present, `md:grid-cols-[minmax(0,1fr)_auto]`) and that Run Optimizer + the stepper stay reachable at 375px. Add:
- last-solved default: given scenarios with differing `solvedAt`, the header/active scenario is the greatest-`solvedAt` one; with none solved, the greatest-`updatedAt` one.
- one-shot seed: on mount an `input:input-map` tab is open; **after closing the last tab, no tab is active and Input Map does NOT reopen** (dispatch close, assert `activeTabId` null / no tab rendered).
- stepper: `button-result-back`/`button-result-forward` render (chevron icons) when history exists.

- [ ] **Step 6: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle6-T2] Workspace: last-solved Input Map entry, header cleanup, pronounced stepper" -- \
  artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/Workspace.test.tsx
```

---

## Task T3 — Solution Summary compare (`[bundle6-T3]`, item 4)

**Files:** `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` (+ its test).

- [ ] **Step 1: Hyphenate City-State**

In `facilityCityLabel` (CostSummaryTab.tsx:~100 and ~104), change both `` `${…city}, ${…state}` `` to `` `${…city} - ${…state}` ``:
```ts
    if (added.city) return added.state ? `${added.city} - ${added.state}` : added.city;
    ...
  if (base?.city) return base.state ? `${base.city} - ${base.state}` : base.city;
```
Leave `openFacilityCityList`'s `.join(", ")` (inter-facility separator) unchanged.

- [ ] **Step 2: Remove the Aggregate utilization compare row**

Delete the entire `{supportsP && (<tr> … Aggregate utilization … </tr>)}` block (the `<tr>` with `data-testid="cost-summary-compare-utilization-${s.id}"`). Then remove the now-unused `aggregateUtilization` helper (verify no other reference via `grep aggregateUtilization`). Keep `supportsP` if still used elsewhere; if it becomes unused, remove it too.

- [ ] **Step 3: Update tests**

Remove any assertion on `cost-summary-compare-utilization-*`. Add: a compare render with a base facility asserts the city-state cell reads `"<City> - <State>"` (hyphen), and that no `cost-summary-compare-utilization-*` cell exists.

- [ ] **Step 4: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle6-T3] Solution Summary compare: drop utilization, hyphenate city-state" -- \
  artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx
```

---

## Task T4 — Input Map legend parity (`[bundle6-T4]`, item 7)

**Files:** `artifacts/studio/src/components/workspace/map/MapLegend.tsx`; `artifacts/studio/src/components/NetworkMap.tsx` (min-width only); tests if present.

Per resolution #2 — visual-shell parity + shared width, NOT pixel-identical. Output legend (NetworkMap, the reference) already uses `p-2 gap-2 text-xs rounded-md` + **14px** SVG markers; MapLegend matches the shell but uses **18px** warehouse swatches.

- [ ] **Step 1: Normalize MapLegend swatch to 14px**

In `MapLegend.tsx`, change the warehouse-status swatch from `w-[18px] h-[18px]` to `w-[14px] h-[14px]` (matches the Output legend's 14px markers).

- [ ] **Step 2: Shared FIXED width on both legend boxes (resolution #3)**

A shared `min-width` does NOT equalize widths (either box can grow past it). Use
a shared **fixed** `w-[220px]` on both boxes, and add `flex-wrap` to the marker
rows so content wraps within that fixed width instead of widening the box:
- `MapLegend.tsx`: outer `className="absolute bottom-4 left-4 bg-card border border-border rounded-md shadow p-2 flex flex-col gap-2 z-10 text-xs pointer-events-none"` → add ` w-[220px]`. (Its status row is `flex items-center gap-3` → add `flex-wrap`; its demand row already has `flex-wrap`.)
- `NetworkMap.tsx` (legend div, ~line 587): `className="absolute bottom-4 right-4 bg-white border border-border p-2 rounded-md shadow flex flex-col gap-2 z-10 text-xs"` → add ` w-[220px]`. Add `flex-wrap` to its marker row (`flex items-center gap-3` → `flex items-center gap-3 flex-wrap`) so the 3-4 markers wrap within 220px rather than overflow (accepted minor wrap of the Output row — the only change to the Output legend, made to achieve equal width).

Both boxes are now exactly 220px wide; heights vary with content. First read both
legends live and confirm 220px comfortably wraps the Output legend's 3-4 markers
(bump the shared constant if a marker+label pair is wider than 220px). The
bounding-box-width equality is asserted in a real browser by T7.

- [ ] **Step 3: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle6-T4] Input Map legend: shell parity + shared width with Output legend" -- \
  artifacts/studio/src/components/workspace/map/MapLegend.tsx artifacts/studio/src/components/NetworkMap.tsx
```

---

## Task T5 — Hide Ch5 everywhere + login footer chapters (`[bundle6-T5]`, items 8/12)

**Depends on T1** (`solvedScenarioCount`). **Files:** `artifacts/studio/src/lib/chapters.ts`; `artifacts/studio/src/pages/Landing.tsx`; `artifacts/studio/src/components/auth/AuthShell.tsx` (+ their tests).

- [ ] **Step 1: Hide Ch5 (item 8)**

In `chapters.ts`, add `hiddenFromLanding: true` to the `transport-coal` and `p-median-brazil` chapter entries (same as `two-echelon-gold-au`).

- [ ] **Step 2: Landing hides Ch5 everywhere (item 8)**

In `Landing.tsx`:
- Build a hidden-model set once: `const hiddenModelIds = new Set(CHAPTERS.filter(c => c.hiddenFromLanding).map(c => c.modelId));`
- **Recent Solves:** filter history entries — `history?.filter(h => !hiddenModelIds.has(h.modelId))` — use the filtered list for both the "any rows?" gate and the render.
- **perChapter (active + stats):** derive `const visiblePerChapter = (summary?.perChapter ?? []).filter(r => !hiddenModelIds.has(r.modelId));` and compute `activeModelId` over `visiblePerChapter` (not the full list).
- **Stats line:** compute visible totals from `visiblePerChapter` instead of `summary.totals`:
  `scenarios = Σ r.scenarioCount`, `solved = Σ r.solvedScenarioCount`. Render `{visibleLabs} labs · {scenarios} scenarios · {solved} solved`. (`byModel`/`ready` logic unchanged; keep the ready gate.)

- [ ] **Step 3: AuthShell footer = active chapters (item 12)**

In `AuthShell.tsx`, replace the hardcoded `LABS` array with a derived distinct-non-hidden-chapter list:
```tsx
import { CHAPTERS } from "@/lib/chapters";
// distinct non-hidden chapters, one label per chapter (dedupe by `chapter`)
const LABS = Array.from(new Set(CHAPTERS.filter(c => !c.hiddenFromLanding).map(c => c.chapter)));
```
Render the same strip (`auth-labs-strip` testid + styling) mapping `LABS` (now e.g. just `["Chapter 3"]`).

- [ ] **Step 4: Update tests**

- `Landing.test.tsx`: the visible-labs/stats assertions change (Ch5 hidden → fewer labs; stats from visible perChapter — add `solvedScenarioCount` to the mocked summary rows). Add a test: a Recent-Solves entry for a hidden model (`transport-coal`) is NOT rendered; the stats line excludes hidden-model counts. Update the existing "lists Chapter 3 and both Chapter 5 labs" test — Ch5 cards are now hidden (assert they're absent).
- `AuthShell`/Login/Register tests: the labs strip now shows chapter labels not model labels — update any assertion on the old `"Ch 5 · transport LP"` strings.

- [ ] **Step 5: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle6-T5] hide Ch5 everywhere on Landing + login footer active chapters" -- \
  artifacts/studio/src/lib/chapters.ts artifacts/studio/src/pages/Landing.tsx artifacts/studio/src/components/auth/AuthShell.tsx \
  artifacts/studio/src/__tests__/Landing.test.tsx artifacts/studio/src/__tests__/Login.test.tsx
```

---

## Task T6 — Auth/homepage copy + cover (`[bundle6-T6]`, items 9/10/11/13)

**Files:** `artifacts/studio/src/components/AppShell.tsx`; `artifacts/studio/src/components/DeveloperCredit.tsx`; `artifacts/studio/src/pages/auth/Login.tsx`; `artifacts/studio/src/pages/auth/Register.tsx` (+ tests). Independent of T1. File-disjoint from T5 (AuthShell is T5).

- [ ] **Step 1: Bigger hero cover (item 9)**

In `AppShell.tsx`'s hero branch, the book-cover `<img>` `className="h-12 w-auto rounded-sm flex-shrink-0"` → `className="h-24 w-auto rounded-sm flex-shrink-0"` (≈96px, still left of the title block, shadow unchanged).

- [ ] **Step 2: Footer copy (item 10)**

In `DeveloperCredit.tsx`, change `"Reach me out at"` → `"Reach out at"`.

- [ ] **Step 3: Login link + placeholder (items 11, 13)**

In `Login.tsx`: change the register `<Link>` text `"Register with your course email"` → `"Register"`; change the email `Input` `placeholder="you@university.edu"` → `placeholder="you@example.com"`.

- [ ] **Step 4: Register placeholder (item 13)**

In `Register.tsx`: change the email `Input` `placeholder="you@university.edu"` → `placeholder="you@example.com"`.

- [ ] **Step 5: Update tests**

- Login test: the register-link assertion (`/Register/`) still matches "Register". If any test asserted the exact old link/placeholder text, update it.
- AppShell test: if a test asserted the `h-12` cover size, update to `h-24` (else the img-present test is unaffected).

- [ ] **Step 6: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle6-T6] hero cover 96px, footer copy, login Register/placeholder" -- \
  artifacts/studio/src/components/AppShell.tsx artifacts/studio/src/components/DeveloperCredit.tsx \
  artifacts/studio/src/pages/auth/Login.tsx artifacts/studio/src/pages/auth/Register.tsx \
  artifacts/studio/src/__tests__/Login.test.tsx artifacts/studio/src/__tests__/AppShell.test.tsx
```

---

## Task T7 — QA (`[bundle6-T7]`, standing QA task)

`qa-sdet`, real Playwright against local dev servers (api :3001 + studio proxy :5199). Runs in the shared worktree (deps installed). **Updates the affected existing e2e specs AND runs the Bundle-6-affected + new specs, explicitly EXCLUDING the known-debt `labs.spec.ts`** (resolutions #1/#4 — `labs.spec.ts` targets a stale remote/pre-D0 API shape per CLAUDE.md:218 and would fail any real run; its port is separate debt, not Bundle 6's job — do NOT claim a green "full suite").

- [ ] **Step 1: Update affected existing specs**

`e2e/bundle4-auth-landing.spec.ts` asserts the old per-model auth-strip labels (`:50-51`) and the old three-visible-labs count / Ch5 presence (`:110-114`). Update those to the new reality: labs strip shows chapter labels (just "Chapter 3"); Landing card grid has no Ch5 cards; stats line reflects visible-only.

- [ ] **Step 2: New spec `e2e/bundle6-ui-tweaks.spec.ts`**

Two blocks. **(a) An authenticated block** (registers a fresh account; seeds via the real API):
- **Last-solved entry:** create 2 scenarios, solve the 2nd; navigate to the chapter route with no `?scenario=` → the 2nd (last-solved) is active and the **Input Map** tab is open. Close the last tab → no tab active (Input Map does not reopen).
- **Header:** no `select-scenario-context`, no `text-user-email`, no `button-logout`; `workspace-chapter-summary` present on the left; `button-result-back`/`-forward` render after a solve.
- **Solution Summary compare:** open two solved p-median-us scenarios in compare → no `cost-summary-compare-utilization-*` cell; an open-facility city cell reads `"<City> - <State>"`.
- **Legend parity (resolution #3):** on a solved p-median-us scenario, measure the Input Map's `map-legend` bounding-box width, then the Output Map's legend width; assert they are equal (both 220px).
- **Landing:** no Ch5 cards; a `transport-coal` solve does NOT appear in Recent Solves; stats line counts visible-only; hero cover img is ~96px (`h-24`).

**(b) A separate UNAUTHENTICATED block** (resolution #5 — `test.use({ storageState: undefined })`, mirroring `bundle4-auth-landing.spec.ts`; `Gate` would redirect `/login`→Landing in an authed context):
- **Login/auth:** on `/login` — "Register" link (not "Register with your course email"); email placeholder `you@example.com`; footer "Reach out at"; labs strip (`auth-labs-strip`) shows only "Chapter 3".

- [ ] **Step 3: Run for real + commit**

Start dev servers (api `DATABASE_URL=… PORT=3001`, studio `PORT=5199 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001`); run the Bundle-6-affected + new specs EXCLUDING `labs.spec.ts`, e.g.:
`E2E_BASE_URL=http://localhost:5199 npx playwright test --project=chromium --grep-invert @labs` (tag `labs.spec.ts`'s describe with `@labs`, or pass the explicit spec list omitting `labs.spec.ts`). Confirm the updated `bundle4-auth-landing.spec.ts` + the new `bundle6-ui-tweaks.spec.ts` pass and no OTHER run spec regressed. Kill dev servers after (no orphans). If a genuine product bug surfaces, STOP and report, don't patch source.
```bash
git commit -m "[bundle6-T7] e2e coverage + update auth-landing spec for Bundle 6" -- \
  artifacts/studio/e2e/bundle6-ui-tweaks.spec.ts artifacts/studio/e2e/bundle4-auth-landing.spec.ts
```

---

## Final gate (after all tasks cherry-picked)

```bash
pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Expected green. Bundle 6 touches no Python — pytest is a no-regression confirmation. If `resultEnvelope.test.ts` brazil flakes under parallel load, confirm in isolation (documented environmental flake). Re-run studio after any agent-install churn settles (documented Bundle 4/5 env gotcha).

## Execution order

T1, T3, T4, T6 parallel (disjoint). **T2 and T5 after T1** (need its regenerated `Scenario.solvedAt` / `LandingSummaryChapter.solvedScenarioCount`). T7 (QA) after all merged. Controller cherry-picks each onto branch + main and re-gates; final whole-branch review; then surface deploy.

## Self-review

- Spec coverage: items 1(T1+T2)/2(T2)/3(T2)/4(T3)/5(T2)/7(T4)/8(T1+T5)/9(T6)/10(T6)/11(T6)/12(T5)/13(T6). All 12 + all 5 resolutions mapped.
- Type consistency: `solvedAt`/`solvedScenarioCount` names consistent openapi↔route↔frontend; `didSeedTabRef`/`openTab`/`inputEntriesForModel` match Workspace's existing API; `hiddenModelIds`/`visiblePerChapter` consistent in Landing; legend shared fixed `w-[220px]`.
- No placeholders: every commit command uses exact repository paths (resolution #4); each code step shows the concrete edit; test-update steps name what to change.
