# Ch4 UX fixes — design

**Date:** 2026-09-29
**Branch:** `ch4-ux-fixes` (off `9a598db`, which is both local `main` and `origin/main`)
**Scope:** three user-reported UX defects. Two are Chapter 4 (`max-coverage-us`) only; the third
is cross-model.

- **Item 1** — lock the Output entries until Chapter 4's Step 1 has solved.
- **Item 2** — make Chapter 4's "Run Optimizer" dialog show the *editable* Optimization Parameters
  for the step that is about to run, instead of today's read-only summary.
- **Item 3** — after Solve, show a blocking loading overlay with a light, quirky treatment.
  This one applies to **all six models**.

No API, DB, OpenAPI, or solver change. Frontend only.

---

## 0. Why this reverses two prior decisions

Two earlier Chapter 4 decisions are deliberately unwound here, in part:

| Prior decision | What it did | What changes |
|---|---|---|
| **CH4-18** | Chapter 4's sidebar Output rows stay *clickable* when the selected step is unsolved; the tab renders its own "Not solved yet" empty state | Only the **pre-Step-1** half is reverted. Post-Step-1 behaviour (Step 2 selected but unsolved → clickable, empty state) is kept. |
| **CH4-17 / R5** | Chapter 4's Solve dialog became confirmation-only (`readOnlyParams`), a read-only summary, because P and the service distances are frozen after Step 1 and editing top-level `gap`/`timeLimitSec` there would silently edit Step 1's limits while a Step-2-targeting student believed they were tuning the run about to happen | Fully reverted, but the original hazard is solved a *better* way: the dialog now renders the real step-aware tab, so a Step-2-targeting student edits Step 2's own `gap`/`timeLimitSec`, never Step 1's. The concern CH4-17 raised is addressed by correctness, not by removal. |

`readOnlyParams` is **deleted**, not left dormant. `max-coverage-us` is its only caller; a prop with
no caller is debt, and the repo's `model-integration-precheck` culture prefers removal over dead
seams.

---

## 1. Item 1 — Chapter 4 outputs hard-locked before Step 1

### Behaviour

| State | Sidebar Output rows | Rationale |
|---|---|---|
| Chapter 4, Step 1 not solved | **Disabled** (greyed, `aria-disabled`, not clickable) | Matches every other model. A student cannot open an output surface that has no run behind it. |
| Chapter 4, Step 1 solved, Step 2 selected and unsolved | Clickable; tab shows the existing `chapter4OutputGate` empty state ("Not solved yet — Solve Step 2") | CH4-18's preview affordance, kept. Once a student has seen real output once, previewing Step 2's shape is informative rather than confusing. |
| Chapter 4, stale result | Clickable (unchanged) | `hasFreshSolvedRun` is false when stale, but `keepOutputsClickable` is true post-Step-1, so the row stays open and `StaleOutputBanner` / the Chapter 4 gate does the talking. |
| Every other model | Unchanged — `hasFreshSolvedRun` alone gates | `keepOutputsClickable` is false for them, as today. |

### Implementation

`SidebarTree`'s props and disable logic (`!hasSolvedRun && !keepOutputsClickable`) are **unchanged**.
One expression changes, at the `SidebarTree` call site in `Workspace.tsx`:

```tsx
keepOutputsClickable={stepState.isMaxCoverage && stepState.steps?.step1.solved === true}
```

`stepState.steps` is the server-derived projection (`useMaxCoverageSteps`), present only for
`max-coverage-us` — so this is inert for the other five models exactly as before.

### Already-open tabs

An output tab can survive a scenario switch onto an unsolved Chapter 4 scenario. No extra handling:
`chapter4OutputGate` already renders "Not solved yet — Solve Step 1" for that case. The lock is a
*sidebar entry* gate, not a tab-eviction mechanism.

---

## 2. Item 2 — Chapter 4's Solve dialog renders the real Optimization Parameters tab

### Approach: one component, not a second copy

`SolveDialog` grows a single new prop:

```ts
/** When supplied, replaces SolveDialog's own built-in parameter controls
 *  entirely. The caller owns what renders here. */
paramsSlot?: ReactNode;
```

`Workspace.tsx` passes `paramsSlot={<OptimizationParametersTab {...optimizationParamsProps} />}`
only when `modelId === "max-coverage-us"`. The other five models pass nothing and keep today's
built-in controls verbatim.

### One prop expression, never two

The tab's props are currently computed inline at its render site in `renderTabContent()`. Every one
of those expressions is moved verbatim — none is rewritten — into a single object built once per
render, near the other derived values:

```tsx
const optimizationParamsProps: OptimizationParametersTabProps = { /* the existing
  render-site expressions, moved unchanged: modelId, p, pMax, gap, timeLimitSec,
  distanceBands, canonicalUnit, objective, highServiceDistKm, maxDistKm,
  avgServiceDistCapKm, onServiceDistanceChange, showBandEditor, step,
  stepEditable, step2Gap, step2TimeLimitSec, coverageFloorFromStep1, onChange */ };
```

Typing the object as `OptimizationParametersTabProps` is deliberate: it makes any future prop added
to the tab a typecheck error here rather than a silent omission at one of the two call sites. Both
the tab render site and `paramsSlot` then spread this same object. Two independently-written prop
lists for the same component is precisely the drift class this repo keeps hitting; there is exactly
one list.

### Step awareness comes for free

Because the embedded component is the tab itself, the dialog is step-aware with no new logic:

- **Step 1 selected** — P slider + quick-select, high-service distance, max distance, avg service
  distance cap, Step 1's `gap` / `timeLimitSec`, band chip editor.
- **Step 2 selected** — `step2-inherited` read-only row (P, high-service, max distance), the
  coverage floor (placeholder or locked value from Step 1), and Step 2's **own** editable
  `gap` / `timeLimitSec`, plus the band editor.

This is the fix for CH4-17's stated hazard: a Step-2-targeting student can no longer reach Step 1's
limits from this dialog at all.

### Freeze interplay — avoid stacked modals

Editing a frozen Step 1 field routes, unchanged, through `guardStep1Edit` → `pendingStep1Inputs`
→ `FreezeConfirmDialog`. That would put a Radix Dialog on top of a Radix Dialog, and this repo has a
documented, reproduced race in exactly that shape (a committed draft field opening a dialog that
steals focus; `.press("Enter")` self-closed the just-opened dialog).

Resolution — the Solve dialog yields while a freeze confirm is pending, with no new state:

```tsx
<SolveDialog open={solveDialogOpen && pendingStep1Inputs == null} … />
```

`pendingStep1Inputs` is set only by `guardStep1Edit` and cleared by both confirm and cancel, so the
Solve dialog hides for exactly the confirm's lifetime and reappears afterwards either way.
`solveDialogOpen` itself is untouched, so no "remember to reopen" bookkeeping exists to get wrong.

### Distance-draft commit

`OptimizationParametersTab`'s distance fields are draft-until-commit (`useDistanceDraft`, commit on
blur/Enter). Inside the dialog this is unchanged behaviour, but it interacts with the freeze guard
above: committing a frozen field via Enter is the exact shape of the documented race. The tab's own
`onKeyDown` already handles Enter; the mitigation here is structural (only one dialog is ever
mounted), and tests commit via blur, not Enter, per the repo's standing Playwright guidance.

---

## 3. Item 3 — blocking solve overlay, all six models

### Lifecycle

```
Solve clicked
  → setSolvePhase("saving"); setSolveDialogOpen(false)     ← dialog closes immediately
  → overlay mounts (solvePhase !== "idle")
  → [save dirty draft] → [enqueue job] → [poll]
  → succeeded → setSolvePhase("idle") → overlay unmounts, Output Map tab opens (today's behaviour)
  → failed    → setSolvePhase("failed") → overlay flips to its error card
```

The overlay covers **both** the `saving` and `solving` phases, so a synchronous save rejection
(e.g. a 422) and an async solver failure surface on the same surface, in the same place.

### The overlay component

New file `artifacts/studio/src/components/workspace/SolveProgressOverlay.tsx`.

```ts
interface SolveProgressOverlayProps {
  open: boolean;                       // solvePhase !== "idle"
  phase: "saving" | "solving" | "failed";
  queuedAt?: Date | string | number | null;
  startedAt?: Date | string | number | null;
  finishedAt?: Date | string | number | null;
  jobStatus?: ElapsedJobStatus;
  errorMessage?: string | null;
  onAdjust: () => void;   // close overlay, reopen SolveDialog
  onClose: () => void;    // close overlay, stay put
}
```

Both callbacks must clear the phase, or the overlay re-derives itself open:

```tsx
onAdjust={() => { setSolvePhase("idle"); setSolveError(null); setSolveDialogOpen(true); }}
onClose={()  => { setSolvePhase("idle"); setSolveError(null); }}
```

**Not a Radix `Dialog`.** A plain `position: fixed; inset: 0` backdrop plus a centered card. Radix
would bring Escape-to-close, outside-click-to-close, and portal/focus machinery that must then all be
disabled — more code, not less, for a surface that is deliberately inescapable while running.

**Mounted unconditionally** from `Workspace.tsx`'s single main return and self-gated on `open`, per
this repo's documented dialog-in-an-unreachable-branch gotcha.

### Running state

- `Loader2` spinner, `animate-spin motion-reduce:animate-none`.
- Phase line: `"Saving changes…"` (phase `saving`) / `"Solving…"` (phase `solving`).
- A quip line rotating every **2500 ms**.
- The elapsed clock, from the existing `useElapsed` hook and the same four timing props
  `SolveDialog` reads today (`lastJobSnapshot`). Renders nothing when `queuedAt` is absent
  (`label` is `null`) — e.g. the whole `saving` phase before a job exists.
- Container `role="status" aria-live="polite"`; the quip line itself is `aria-hidden` so a screen
  reader is not interrupted every 2.5 s by decorative text.
- No interactive elements at all while running: no close button, no Escape handler, no backdrop
  click handler. Nothing to cancel — there is no cancel endpoint
  (`/scenarios/{id}/solve-jobs/{jobId}` is GET-only), so offering one would be a lie.

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

Simple and text-only: no new dependency, no SVG animation, and the whole thing degrades to a static
first line if timers are frozen.

### Error state

The overlay stays mounted and swaps the running card for an error card:

- `role="alert"`, the server's safe `errorMessage` (never a raw diagnostic), and the frozen elapsed
  total (`useElapsed` freezes on a terminal `jobStatus`).
- **Adjust & re-solve** — closes the overlay and reopens `SolveDialog`, parameters intact and
  editable, so the student changes something before running again. This is the only retry path;
  there is no blind re-enqueue button, because a solve that just failed is unlikely to succeed
  unchanged.
- **Close** — dismiss, stay where you are.
- `isRetryableFailureCode` / `errorCode` is no longer consulted for this surface: both actions are
  useful regardless of code, and the errorCode-derived gate existed only to decide whether to render
  a blind retry, which is gone. Verified by grep: `SolveDialog`'s `errorCode` prop is the **only**
  reader of `Workspace.tsx`'s `solveErrorCode` state (`Workspace.tsx:2822` declares it, `:4360` is
  its sole use), so that state and its setter are deleted in the same commit. The
  `lib/solveFailure.ts` module itself stays — `Landing.tsx:195` still consumes it for the
  solve-history list, and `solveFailure.test.ts` is untouched.

### `SolveDialog` slims down

Now that the dialog closes the instant Solve is pressed, its `busy`/progress/error/retry/elapsed
branches are unreachable. Removed props: `phase`, `errorMessage`, `errorCode`, `queuedAt`,
`startedAt`, `finishedAt`, `jobStatus`, `readOnlyParams`. Removed testids:
`solve-dialog-progress`, `solve-dialog-elapsed`, `solve-dialog-error`, `solve-dialog-retry`,
`solve-dialog-readonly-summary`, `solve-dialog-readonly-objective`. The `busy`-derived `disabled`
on every control goes with them.

`SolveDialog` ends up as exactly what its name says: parameters plus Solve/Close.

Losing `busy` also loses the Solve button's `disabled={busy}` double-submit guard. It is replaced by
a truthful one at the source: `handleSolve` early-returns when `solvePhase !== "idle"`, alongside its
existing browsing-history guard. That protects the enqueue path itself rather than only the one
button that happens to call it.

### Accepted cost

A blocking overlay pins the entire UI for the duration of a solve. `timeLimitSec` defaults to 120
and is user-settable higher, so a student can lock themselves out for minutes. This was raised and
chosen deliberately; the alternative (dismissible, keeps running) was declined.

---

## 4. Files

**New**
- `artifacts/studio/src/components/workspace/SolveProgressOverlay.tsx`
- `artifacts/studio/src/lib/solveQuips.ts`
- `artifacts/studio/src/__tests__/SolveProgressOverlay.test.tsx`

**Changed**
- `artifacts/studio/src/pages/Workspace.tsx` — `keepOutputsClickable` expression;
  `optimizationParamsProps` hoist; `paramsSlot`; dialog `open` yields to freeze confirm;
  `setSolveDialogOpen(false)` in `handleSolve`; overlay mount + `onAdjust`/`onClose`.
- `artifacts/studio/src/components/workspace/SolveDialog.tsx` — add `paramsSlot`; delete
  `readOnlyParams` and the progress/elapsed/error/retry blocks and their props.

**Tests to rewrite** (each already asserts a removed testid or a changed behaviour)
- `SolveDialog.test.tsx`, `Workspace.test.tsx`, `Workspace.Integration.test.tsx`
- e2e: `workspace-fixups.spec.ts`, `workspace-fixups-2.spec.ts`,
  `jade-ch9-workspace-bundle.spec.ts` (all three hard-code `solve-dialog-progress|error|retry|elapsed`),
  plus `ch4-two-step.spec.ts` and `max-coverage.spec.ts` for the new lock and the editable dialog.

Grepping `e2e/` for every changed testid before merge is mandatory — this repo's recurring
`spec_gap` failure class is a UI bundle breaking a *prior* bundle's Playwright spec that the unit
gate cannot see.

---

## 5. Test plan

**Unit / RTL**
- `SidebarTree` is unchanged, so coverage lands in `Workspace.test.tsx`: a Chapter 4 scenario with
  `steps.step1.solved === false` renders `sidebar-output-*` disabled; with `step1.solved === true`
  and Step 2 selected-and-unsolved, the same rows are enabled. A non-Chapter-4 model is asserted
  unchanged in the same file.
- `SolveDialog.test.tsx` — `paramsSlot` replaces the built-in controls when supplied; the built-in
  controls still render for a caller that omits it; no progress/error/retry testid exists any more.
- `Workspace.Integration.test.tsx` — Chapter 4's dialog shows Step 1's editable controls when Step 1
  is selected and the Step 2 panel (`step2-parameters`, `step2-inherited`) when Step 2 is; editing a
  frozen Step 1 field hides the Solve dialog and shows `FreezeConfirmDialog`, and cancelling brings
  the Solve dialog back.
- `SolveProgressOverlay.test.tsx` — renders nothing when closed; shows "Saving changes…" then
  "Solving…"; the quip advances on a 2500 ms fake timer and wraps at the end of the array; no close
  affordance and no Escape handler exist while running; the error card shows the message and both
  actions, and each action fires its callback.

**Python / solver** — untouched. The standing gate still runs (`pytest`, plus `e2e_accuracy.py`
directly, which pytest does not discover), to prove no accidental coupling.

**Gate** — the full CLAUDE.md verification gate, then `pnpm e2e:gate`.

**QA** — a real-browser pass per the repo's standing rule that every bundle gets one: Chapter 4
locked outputs before Step 1, the step-aware dialog on both steps, the freeze-confirm handoff, and
the overlay + error card on at least one non-Chapter-4 model.

---

## 6. Non-goals

- No cancel-solve endpoint, and no UI that implies one exists.
- No change to the other five models' dialog parameter controls (the "all models" part of the
  request applies to the loading overlay only).
- No change to `chapter4OutputGate`'s empty-state copy or to `StaleOutputBanner`.
- No SVG/canvas animation — the quirk is text plus the existing spinner.
