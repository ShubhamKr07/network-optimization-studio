# Ch4 UX fixes — design

**Date:** 2026-09-29
**Branch:** `ch4-ux-fixes` (off `9a598db`, which is both local `main` and `origin/main`)
**Status:** reviewed; review findings folded in. This document is the single normative body — there
is no retained pre-review variant and no open alternative.

**Scope:** three user-reported UX defects. Two are Chapter 4 (`max-coverage-us`) only; the third is
cross-model.

- **Item 1** — lock the Output entries until Chapter 4's Step 1 has solved.
- **Item 2** — make Chapter 4's "Run Optimizer" dialog show the *editable* Optimization Parameters
  for the step that will actually run, instead of today's read-only summary.
- **Item 3** — after Solve, show a blocking loading overlay with a light, quirky treatment.
  This one applies to **all six models**.

No API, DB, OpenAPI, or solver change. Frontend only.

---

## 0. Two prior decisions are deliberately unwound

| Prior decision | What it did | What changes |
|---|---|---|
| **CH4-18** | Chapter 4's sidebar Output rows stay *clickable* when the selected step is unsolved; the tab renders its own "Not solved yet" empty state | Only the **pre-Step-1** half is reverted. Post-Step-1 behaviour (Step 2 selected but unsolved → clickable, empty state) is kept. |
| **CH4-17 / R5** | Chapter 4's Solve dialog became confirmation-only (`readOnlyParams`), a read-only summary, because P and the service distances are frozen after Step 1 and editing top-level `gap`/`timeLimitSec` there would silently edit Step 1's limits while a Step-2-targeting student believed they were tuning the run about to happen | Fully reverted. The hazard it named is removed by correctness rather than by removal: the dialog renders the step that will actually run, so a Step-2 run shows Step 2's own `gap`/`timeLimitSec` and Step 1's are unreachable from it. |

`readOnlyParams` is **deleted**, not left dormant — `max-coverage-us` is its only caller.

---

## 1. Item 1 — Chapter 4 outputs hard-locked before Step 1

### Behaviour

| State | Sidebar Output rows | Rationale |
|---|---|---|
| Chapter 4, Step 1 not solved | **Disabled** (greyed, `aria-disabled`, not clickable) | Matches every other model. A student cannot open an output surface with no run behind it. |
| Chapter 4, Step 1 solved, Step 2 selected and unsolved | Clickable; tab shows the existing `chapter4OutputGate` empty state | CH4-18's preview affordance, kept. Once real output has been seen once, previewing Step 2's shape is informative rather than confusing. |
| Chapter 4, stale result | Clickable (unchanged) | `hasFreshSolvedRun` is false when stale, but `keepOutputsClickable` is true post-Step-1, so the row stays open and `StaleOutputBanner` / the Chapter 4 gate does the talking. |
| Every other model | Unchanged — `hasFreshSolvedRun` alone gates | `keepOutputsClickable` is false for them, as today. |

### Implementation

`SidebarTree`'s props and disable logic (`!hasSolvedRun && !keepOutputsClickable`) are **unchanged**.
One expression changes, at the `SidebarTree` call site in `Workspace.tsx`:

```tsx
keepOutputsClickable={stepState.isMaxCoverage && stepState.steps?.step1.solved === true}
```

`stepState.steps` is the server-derived projection (`useMaxCoverageSteps`), present only for
`max-coverage-us` — inert for the other five models exactly as before.

### `selectedStep` must reset on scenario change

`selectedStep` is initialised once and has exactly one writer today (`Workspace.tsx:2988`, on solve
success). It therefore survives a scenario switch. With an output tab already open, switching from a
`1 of 2` scenario (viewing Step 2) to a `0 of 2` scenario leaves `chapter4OutputGate` saying
"Solve Step 2" when the real prerequisite is Step 1.

Fix: reset the viewed step to the new scenario's target whenever the active scenario id changes.

```tsx
useEffect(() => {
  if (stepState.isMaxCoverage) setSelectedStep(stepState.targetStep);
}, [currentScenario?.id]);   // scenario identity only — NOT targetStep
```

The dependency list is deliberately scenario id alone. Depending on `targetStep` would yank the
student's view to Step 2 the instant Step 1 solved, duplicating and fighting the existing
success-path `setSelectedStep`.

This supersedes the earlier claim that already-open output tabs needed no handling — that claim was
false.

---

## 2. Item 2 — Chapter 4's Solve dialog renders the real Optimization Parameters tab

### The dialog follows the solve TARGET, not the viewed step

These are different concepts and conflating them is the central correctness requirement of this
item:

- `selectedStep` — which step's inputs/outputs the student is *looking at*. Free to move.
- `stepState.targetStep` — which step the next solve will *run*. Server-derived
  (`useMaxCoverageSteps.ts:31`): Step 1 until Step 1 has solved, then Step 2. It is what
  `stepState.solveLabel` already displays on the Run button.

The dialog renders `targetStep`. Otherwise two wrong states are reachable: at `0 of 2` a student
viewing the locked Step 2 presses **Solve Step 1** and sees Step 2's controls; at `1 of 2` a student
inspecting Step 1 presses **Solve Step 2** and sees Step 1's.

### Frozen Step 1 is unreachable from the dialog, by construction

`useMaxCoverageSteps.ts` derives both values from the same boolean:

```ts
const targetStep: 1 | 2 = steps.step1.solved ? 2 : 1;   // :31
step1Frozen: steps.step1.solved,                         // :37
```

So `targetStep === 1` implies `step1Frozen === false`. A dialog rendering `targetStep` can never
display a frozen Step 1 field, and `guardStep1Edit` always takes its bypass branch for edits
originating there.

The Solve dialog still yields if a freeze confirm is somehow pending, as defense-in-depth against a
future caller — but this is **not** the mechanism, and no test should treat it as the fix:

```tsx
<SolveDialog open={solveDialogOpen && pendingStep1Inputs == null} … />
```

`pendingStep1Inputs` is set only by `guardStep1Edit` and cleared by both confirm and cancel, so no
reopen bookkeeping exists to get wrong.

### `paramsSlot`

`SolveDialog` grows one new prop:

```ts
/** When supplied, replaces SolveDialog's own built-in parameter controls
 *  entirely. The caller owns what renders here. */
paramsSlot?: ReactNode;
```

`Workspace.tsx` supplies it only when `modelId === "max-coverage-us"`. The other five models pass
nothing and keep today's built-in controls verbatim.

### One base prop object, two intentional step variants

`OptimizationParametersTabProps` is currently **unexported**; it must be exported. The tab's props
are computed inline at its render site (`Workspace.tsx:3501-3558`) and are moved verbatim — none
rewritten — into a base object:

```tsx
const optimizationParamsBaseProps = {
  modelId, p, gap, timeLimitSec, distanceBands, capacityFactor, singleSource,
  capacityInactive, bomRatio, canonicalUnit, pMax, objective, highServiceDistKm,
  maxDistKm, avgServiceDistCapKm, onServiceDistanceChange, stepEditable,
  step2Gap, step2TimeLimitSec, coverageFloorFromStep1, onChange,
};   // every existing render-site expression, unchanged

const optimizationTabProps: OptimizationParametersTabProps = {
  ...optimizationParamsBaseProps,
  step: stepState.isMaxCoverage ? selectedStep : undefined,
};

const solveDialogParamsProps: OptimizationParametersTabProps = {
  ...optimizationParamsBaseProps,
  step: stepState.isMaxCoverage ? stepState.targetStep : undefined,
  idPrefix: "solve-dialog-",
  testIdPrefix: "solve-dialog-",
};
```

The base object must contain **every** prop the current call site passes, including
`capacityFactor`, `singleSource`, `capacityInactive`, and `bomRatio` — omitting them would silently
delete transport-coal's and two-echelon's model-specific controls. `showBandEditor` is *not* passed
today and stays out.

Type annotations here are documentation, not enforcement: most of the interface is optional, so
adding a future prop would not fail the build. The actual drift protection is that both renders
consume one complete base object with only the documented `step` / instance-prefix deltas layered
on.

### Instance namespacing (duplicate IDs)

With Optimization Parameters as the active background tab, opening the dialog mounts a **second**
`OptimizationParametersTab`. Both would emit `optimization-parameters-tab`, `input-gap`,
`input-time-limit`, `input-high-service-dist`, `input-max-dist`, `input-avg-service-cap`,
`input-step2-gap`, `input-step2-time-limit`, `slider-p-value`, `text-p-value`, `button-p-quick-*`,
`step2-parameters`, `step2-inherited`, `step2-floor-*`. Duplicate DOM `id`s break `<label htmlFor>`
association; duplicate test ids make every RTL and Playwright locator ambiguous.

`OptimizationParametersTab` therefore gains:

```ts
idPrefix?: string;      // default ""
testIdPrefix?: string;  // default ""
```

applied to every `id` and `data-testid` it emits, and forwarded to its nested `BandChipEditor`
(which already has a `testIdPrefix` prop — this is an established pattern here, not a new one) and
its `ChenDistanceInput` children. The tab keeps the empty default, so no existing test id moves.
The dialog uses `solve-dialog-`, which also preserves the `solve-dialog-*` naming the existing
dialog tests already expect for the shared fields.

### Step awareness

- **`targetStep === 1`** — P slider + quick-select, high-service distance, max distance, avg service
  distance cap, Step 1's `gap` / `timeLimitSec`, band chip editor. All editable (Step 1 cannot be
  frozen while it is the target).
- **`targetStep === 2`** — `step2-inherited` read-only row (P, high-service, max distance), the
  coverage floor locked from Step 1, and Step 2's **own** editable `gap` / `timeLimitSec`, plus the
  band editor.

### Dialog scroll contract

`components/ui/dialog.tsx`'s `DialogContent` has a fixed centered layout with no `max-h` and no
overflow treatment. The full Step 1 editor can exceed a short viewport or clip at high zoom. The
Chapter 4 dialog therefore sets `max-h-[calc(100dvh-2rem)]` with the parameter region in its own
`overflow-y-auto` block and the footer pinned outside it. Verified at a short mobile viewport and at
200% zoom.

### Context requirement

`UnitProvider` is mounted at the app root (`main.tsx:15`), so the embedded tab resolves
`useDisplayUnit()` normally in the running app. Any RTL test that mounts `SolveDialog` with a
`paramsSlot` containing the tab must wrap in `UnitProvider` or the hook throws.

---

## 3. Item 3 — blocking solve overlay, all six models

### Shared phase type

`SolveDialogPhase` moves out of `SolveDialog` and is renamed `SolvePhase`
(`"idle" | "saving" | "solving" | "failed"`), since it is now owned by `Workspace` and read by the
overlay. The overlay takes **only** `phase` and derives `open = phase !== "idle"` internally —
passing both would let a caller supply a contradictory pair that TypeScript cannot rule out.

### Lifecycle

```
Solve clicked
  → resetSolveState(); setSolvePhase("saving"); setSolveDialogOpen(false)
  → overlay mounts (phase !== "idle")
  → [save dirty draft] → [enqueue job] → [poll]
  → succeeded → phase "idle" → overlay unmounts, Output Map opens (today's behaviour)
  → failed    → phase "failed" → overlay flips to its error card
```

The overlay covers **both** `saving` and `solving`, so a synchronous save rejection (e.g. a 422) and
an async solver failure surface in the same place.

### Required state machine

| From | Event | To | Required effects |
|---|---|---|---|
| `idle` | Solve, dirty ordinary inputs | `saving` | Close parameter dialog; clear prior error and timing |
| `idle` | Solve, clean ordinary inputs | `solving` | Close parameter dialog; clear prior error and timing |
| `saving` | Save succeeds | `solving` | Enqueue exactly one job |
| `saving` | Save fails | `failed` | No enqueue; safe error message; no stale clock |
| `solving` | Enqueue fails | `failed` | No polling id; safe error message |
| `solving` | Job succeeds | `idle` | Stop polling; clear overlay; open Output Map; refresh scenario |
| `solving` | Job fails | `failed` | Stop polling; preserve **this** job's terminal clock and safe error |
| `failed` | Adjust & re-solve | `idle` + dialog open | Clear failed snapshot; render parameters for current `targetStep` |
| `failed` | Close | `idle` | Clear failed snapshot; remain on current tab |

### One reset helper, not three

`openSolveDialog()` already clears `solveError`, `solveErrorCode`, `solvePhase`, and
`lastJobSnapshot` (`Workspace.tsx:2834-2840`). That body is extracted as `resetSolveState()` (adding
a defensive `setPollingJobId(null)`), and `openSolveDialog()` becomes `resetSolveState()` plus
`setSolveDialogOpen(true)`. The overlay's callbacks reuse it — no second, subtly different reset
list:

```tsx
onAdjust={openSolveDialog}
onClose={resetSolveState}
```

Without this, **Adjust & re-solve** would leave the failed job's terminal `lastJobSnapshot` in
place and the next run's overlay would open showing the previous job's frozen elapsed total until
the first poll landed.

### Double-submit is guarded at both ends

Because `openSolveDialog()` resets the phase to `"idle"`, a keyboard Enter reaching the underlying
**Run Optimizer** button would reopen the dialog and cancel the guard mid-job. Therefore:

- a `solveInFlightRef` is set synchronously at the top of `handleSolve()` and checked before
  anything else;
- `handleSolve()` returns early when `phase !== "idle"` (alongside its existing browsing-history
  guard) — this protects the enqueue path itself, not just one button;
- `openSolveDialog()` returns early when `phase !== "idle"`;
- the header Run button is `disabled` while `phase !== "idle"`;
- and the overlay is genuinely modal, so the button is not reachable in the first place.

All five, because each alone has a hole — and the **ref is load-bearing, not belt-and-braces**: a
`phase !== "idle"` check protects later renders but not two calls through the same render closure,
where both observe `"idle"` before React commits the update. The state guard alone cannot make the
enqueue path single-entry.

The ref is cleared in exactly two places: `resetSolveState()` (which every dismissal and reopen
routes through) and the poll effect's success branch (which sets the phase directly rather than
calling the helper). It deliberately stays held while the failure card is up — Close and Adjust own
that transition.

Its regression test must invoke the solve handler **twice within one synchronous tick**. A
double-click test cannot cover this: the button unmounts after the first event, so the second click
never lands.

### The overlay is a real modal

A `position: fixed; inset: 0` div blocks pointer events at best. It does not make the background
inert to keyboard or assistive technology, does not trap or restore focus, exposes no `aria-modal`,
and gives no guarantee against Leaflet/portal layers painting above it.

The overlay therefore uses the existing Radix **`AlertDialog`** primitive
(`components/ui/alert-dialog.tsx`), not `Dialog` and not a bare div. `DialogContent` hardcodes an X
close control (`dialog.tsx:45-48`) with no `showCloseButton` seam, which disqualifies it for the
running state; `AlertDialog` already suppresses outside-click dismissal, so only Escape needs
explicit prevention.

While `saving` / `solving`:

- no close action renders;
- `onEscapeKeyDown` is prevented; outside interaction is already blocked;
- focus stays inside the modal surface and the background is inert;
- the header Run button is disabled (above).

### Running state

- `Loader2` spinner, `animate-spin motion-reduce:animate-none`.
- Phase line: `"Saving changes…"` / `"Solving…"`.
- A quip line rotating every **2500 ms**, `aria-hidden`.
- The elapsed clock, from the existing `useElapsed` hook and the same four timing props the dialog
  reads today (`lastJobSnapshot`). Renders nothing while `queuedAt` is absent — i.e. for the whole
  `saving` phase before a job exists.

**Live-region discipline.** The whole card must NOT sit inside `aria-live`, or the once-per-second
clock is announced every second. Only the phase line is a polite live region; the clock and the quip
are not live; a terminal failure fires exactly one `role="alert"`.

### Quips

New `artifacts/studio/src/lib/solveQuips.ts` — a frozen module-level array, no randomness, cycled by
index so tests are deterministic under fake timers:

```ts
export const SOLVE_QUIPS = [
  "Branching and bounding…",
  "Relaxing the integers…",
  "Tightening the gap…",
  "Arguing with CBC…",
  "Pricing out a few columns…",
  "Checking every warehouse twice…",
  "Nudging the simplex…",
  "Rounding, then regretting it…",
] as const;
```

Text-only: no new dependency, no SVG animation, and it degrades to a static first line if timers are
frozen. The timer resets for each new run and is cleared on unmount.

### Error state

The overlay stays mounted and swaps the running card for an error card:

- `role="alert"`, the server's safe `errorMessage` (never a raw diagnostic), and the frozen elapsed
  total (`useElapsed` freezes on a terminal `jobStatus`).
- **Adjust & re-solve** — `openSolveDialog`: clears the failed snapshot and reopens `SolveDialog`
  with parameters for the current `targetStep`, so the student changes something before rerunning.
  The only retry path; there is no blind re-enqueue, because a solve that just failed is unlikely to
  succeed unchanged.
- **Close** — `resetSolveState`, stay put.
- Focus: Adjust moves focus into the reopened dialog; Close restores focus to the header Run button.
- `isRetryableFailureCode` / `errorCode` is no longer consulted here — both actions are useful
  regardless of code, and that gate existed only to decide whether to render the blind retry.
  Verified by grep: `SolveDialog`'s `errorCode` prop is the **only** reader of `solveErrorCode`
  (`Workspace.tsx:2822` declares, `:4360` uses), so that state and its setter are deleted.
  `lib/solveFailure.ts` itself stays — `Landing.tsx:195` still consumes it for the solve-history
  list, and `solveFailure.test.ts` is untouched.

### `SolveDialog` slims down

With the dialog closing the instant Solve is pressed, its `busy`/progress/error/retry/elapsed
branches are unreachable. Removed props: `phase`, `errorMessage`, `errorCode`, `queuedAt`,
`startedAt`, `finishedAt`, `jobStatus`, `readOnlyParams`. Removed test ids:
`solve-dialog-progress`, `solve-dialog-elapsed`, `solve-dialog-error`, `solve-dialog-retry`,
`solve-dialog-readonly-summary`, `solve-dialog-readonly-objective`. The `busy`-derived `disabled` on
every control goes with them. `SolveDialog` becomes exactly its name: parameters plus Solve/Close.

### Accepted cost

A blocking overlay pins the UI for the duration of a solve. `timeLimitSec` defaults to 120
(`Workspace.tsx:261-264`) and is user-settable higher, so a student can lock themselves out for
minutes. Raised and chosen deliberately; the dismissible alternative was declined.

---

## 4. Files

**New**
- `artifacts/studio/src/components/workspace/SolveProgressOverlay.tsx`
- `artifacts/studio/src/lib/solveQuips.ts`
- `artifacts/studio/src/__tests__/SolveProgressOverlay.test.tsx`
- `artifacts/studio/e2e/solve-overlay-contract.spec.ts` — the controlled-response modality/focus/
  reduced-motion contract

**Changed**
- `artifacts/studio/src/pages/Workspace.tsx` — `keepOutputsClickable`; `selectedStep` reset on
  scenario change; base/tab/dialog prop objects; `paramsSlot`; dialog `open` yields to freeze
  confirm; `resetSolveState()` extraction and guards; overlay mount; `solveErrorCode` deleted.
- `artifacts/studio/src/components/workspace/SolveDialog.tsx` — add `paramsSlot`; export/move
  `SolvePhase`; delete `readOnlyParams` and the progress/elapsed/error/retry blocks and props; add
  the max-height/scroll contract.
- `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` — export
  `OptimizationParametersTabProps`; add `idPrefix`/`testIdPrefix` and thread them through every
  emitted `id`/`data-testid` and into `BandChipEditor`/`ChenDistanceInput`.
- `docs/CHANGELOG-implementation.md` — required by hard rule #9, in the same commit as the work.

**Tests to rewrite**
- `SolveDialog.test.tsx`, `Workspace.test.tsx`, `Workspace.Integration.test.tsx`,
  `OptimizationParametersTab.test.tsx`
- e2e: `ch4-two-step.spec.ts`, `max-coverage.spec.ts`, plus the semantic sweep below.

---

## 5. E2E dependency sweep — semantics, not just renamed ids

Several browser tests use the *disappearance of* `solve-dialog` as their solve-complete signal.
Under this design the dialog disappears immediately on submit, so those waits become false-green or
race the real result.

**Correction to an earlier draft of this section:** it claimed no `solveAndWait` / `solveViaUi` /
`runOptimizerAndWait` helper existed. That came from a grep scoped to `e2e/helpers/` (which indeed
contains only `modelLock.ts`). Measured across all of `e2e/` at `9a598db`: **10 spec files** define
one of those helpers locally, and **13 spec files** reference `solve-dialog`. Because each helper is
file-local, each must be fixed in place — but the inventory is far wider than the seven inline
`not.toBeVisible` sites originally listed.

Every `solve-dialog` consumer must therefore be **classified**, not matched against a fixed file
list:

| Consumer kind | Treatment |
|---|---|
| Parameter interaction before submit | Keep, unless a Chapter 4 locator moved into the embedded tab |
| Explicit Cancel/Close assertion | Keep — not a solve wait; the completion rewrite must not be applied here |
| Post-completion "the dialog really is gone" | Keep — still true, the dialog just closes earlier |
| Progress/clock observation | Move the locator **and** the loop's control condition to the overlay |
| Solve-completion wait | Replace with a durable per-run signal (below) |
| Helper already polling `solvedAt` or job status | Keep the durable poll; audit only its UI prelude |

The definite semantic rewrite is `jade-ch9-workspace-bundle.spec.ts`'s `solveAndObserveClock()`: it
reads `solve-dialog-elapsed` **and terminates its sampling loop when `solve-dialog` closes**, so
renaming the id alone would leave a loop that exits before observing anything.

**Completion waits must anchor on durable per-run state, not on transient overlay visibility.**
Requiring `solve-progress-overlay` to *become visible* is a race — a fast job can finish before
Playwright samples it — and `output-map-tab` alone is a false positive when that tab was already
open. Capture a per-run value (`solvedAt`, the job id, or result identity) before submitting and
require it to change; a spec that solves twice must re-capture before each submit. The overlay's own
appearance/modality contract gets **one** dedicated browser test with a deliberately delayed and a
deliberately failed job response, rather than being asserted on every solve.

Baseline greps, to be run before implementation and again before merge:

```sh
rg -n 'readOnlyParams|SolveDialogPhase|solveErrorCode|solve-dialog-(progress|elapsed|error|retry|readonly)' \
  artifacts/studio/src artifacts/studio/e2e
rg -n -C 4 'solve-dialog.*not\.toBeVisible|not\.toBeVisible.*solve-dialog' artifacts/studio/e2e
rg -n 'OptimizationParametersTabProps|<OptimizationParametersTab' artifacts/studio/src
rg -n 'solveAndWait|solveViaUi|runOptimizerAndWait' artifacts/studio/e2e
```

A zero-result grep for removed test ids is **not** sufficient — the second search is what finds
behaviour-dependent waits whose ids never changed.

---

## 6. Test plan

### Unit / RTL

- Chapter 4 output lock: disabled before Step 1, enabled after; non-Chapter-4 unchanged.
- The viewed-step × target-step cross product — `0/2` viewed at Step 1 and at Step 2, `1/2` viewed
  at Step 1 and at Step 2. In all four the dialog follows `targetStep`.
- Scenario switch with an output tab open resets the viewed step to the new scenario's target.
- No duplicate DOM `id` or `data-testid` values with the parameters tab mounted behind the dialog.
- `paramsSlot` replaces the built-in controls; a caller omitting it still gets them; no
  progress/error/retry test id survives.
- Dirty solve reaches `saving` then `solving`; clean solve goes straight to `solving`.
- Save rejection, enqueue rejection, and async job failure all land on the overlay error card.
- Success removes the overlay and opens Output Map.
- Adjust clears the old timing and opens parameters for the current target step.
- A second enqueue is impossible via click, keyboard activation, or direct handler invocation.
- Freeze confirmation still works from the ordinary tab editor, on both blur and Enter commit paths.
- Quip timer advances, wraps, resets per run, and cleans up on unmount; reduced motion disables the
  spinner animation.

### Browser / accessibility

Modality, focus, and reduced motion are the behaviours most likely to regress and the least
provable from component tests (which can only reach the Escape handler). They get a **dedicated
automated spec**, `e2e/solve-overlay-contract.spec.ts`, made deterministic by intercepting the
solve-job response — one route that stalls, one that returns a terminal failure. It asserts:

- focus enters and stays inside the running overlay; Tab and Shift+Tab cannot reach workspace
  controls;
- Escape and backdrop interaction do not dismiss while saving/solving;
- a failure focuses an error action; Adjust moves focus into the reopened dialog; Close restores
  focus to the Run button;
- `page.emulateMedia({ reducedMotion: "reduce" })` leaves the spinner's computed `animation-name`
  as `none` (with a cheap unit counterpart asserting the `motion-reduce:animate-none` class).

Provoking a real solver failure is **not** a deterministic trigger — a 1 s time limit on a large
problem may still return a valid terminal result — so real-solver failure handling is exploratory
QA on top of that spec, never the evidence for it.

Manual pass, in addition: phase changes announce once while quips and per-second clock updates do
not; short viewport and 200% zoom retain access to every parameter and footer action; run on
Chapter 4 and at least one non-Chapter-4 model, with a unit matrix over all six model ids covering
the remaining routing.

### Commands

```sh
pnpm --filter studio exec vitest run \
  src/__tests__/OptimizationParametersTab.test.tsx \
  src/__tests__/SolveDialog.test.tsx \
  src/__tests__/SolveProgressOverlay.test.tsx \
  src/__tests__/Workspace.test.tsx \
  src/__tests__/Workspace.Integration.test.tsx

pnpm --filter studio exec playwright test \
  e2e/ch4-two-step.spec.ts e2e/max-coverage.spec.ts \
  e2e/jade-ch9-workspace-bundle.spec.ts e2e/workspace-fixups.spec.ts \
  e2e/workspace-fixups-2.spec.ts e2e/workspace-ux-r1-r9.spec.ts \
  e2e/posthog-analytics.spec.ts
```

Full close-out gate:

```sh
pnpm run typecheck
pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
pnpm e2e:gate
```

The solver is untouched; the Python gate runs to prove no accidental coupling.

The CI E2E job currently carries `continue-on-error: true` over a documented red baseline, so a
green required CI job does **not** prove browser acceptance. Close-out evidence must include: an
E2E result captured on the parent commit; every directly affected spec green on this branch; the
full-suite branch result with zero new failures relative to the parent; and retained Playwright
report/trace evidence for any failure claimed pre-existing.

---

## 7. Non-goals

- No cancel-solve endpoint, and no UI implying one exists
  (`/scenarios/{id}/solve-jobs/{jobId}` is GET-only).
- No change to the other five models' dialog parameter controls — the "all models" part of the
  request applies to the loading overlay only.
- No change to `chapter4OutputGate`'s copy or to `StaleOutputBanner`.
- No SVG/canvas animation — the quirk is text plus the existing spinner.

---

## 8. Sign-off checklist

- [ ] Viewed step and solve target are represented as different values, with all four combinations
      tested.
- [ ] The running surface is genuinely modal for pointer, keyboard, and assistive technology.
- [ ] No duplicate ids/test ids with the parameters tab open behind the dialog.
- [ ] All old job timing/error state is cleared before a new attempt, through one reset helper.
- [ ] Every current optimization-parameter prop survives the refactor.
- [ ] Removed test ids **and** semantic solve-completion waits are both swept.
- [ ] Targeted RTL and Playwright suites green.
- [ ] Full gate has no new failures relative to the recorded parent baseline.
- [ ] Real-browser QA covers Chapter 4 plus a non-Chapter-4 model, keyboard modality, failure
      recovery, short viewport, reduced motion, and 200% zoom.
- [ ] `docs/CHANGELOG-implementation.md` records the implementation commits, gate counts, and any
      approved deviation.
