# Design Upgrade Phase 6 Implementation Plan (autosave)

> **Execution:** agent-team dispatch per `AGENTS.md`, as in Phases 1–5. Never delegate to GLM (root hard rule #10).
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-6.N -b du-6.N-work <design-upgrade-p6 tip>`) and dispatches **without** `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-du-6.N && git rev-parse --abbrev-ref HEAD` (must print `du-6.N-work`, else STOP). The lead fast-forwards or cherry-picks each commit onto `design-upgrade-p6`.
> - **Roles:** DU-6.1, DU-6.2, DU-6.3 are studio-only: `frontend-engineer`, reviewed by the lead on Opus plus `ponytail:ponytail-review`. The brief hands the engineer the task's test files explicitly (tests are qa-sdet's domain by default). DU-6.4: `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - Tasks run sequentially in listed order; every task's commit is green on its own. If an agent stalls on the 600 s watchdog, inspect its worktree read-only and resume it with `SendMessage`; never re-dispatch (root `CLAUDE.md` Gotchas).
> - Steps use checkbox (`- [ ]`) syntax.

**Goal:** implement spec §5.6 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md:288-325`, decision D7, findings G23/CR-4/CR-5): Workspace edits save themselves through one serialized, debounced, per-scenario write queue; every action that reads the saved row first awaits `flushAutosave()`; failures are retained and retried and block Solve; a header indicator shows Saving… / Saved / the error with Retry; the last 20 edits can be undone; the page Save buttons and `DirtyNavPrompt` are removed and the Edit-dialog "Save" becomes "Apply".

**Architecture:**
- **`lib/autosave.ts`** (new, pure, no React): `createWriteQueue(opts)` owns debounce, coalescing per field, one in-flight request, client revision ids, stale-response detection, failure retention, the undo stack and a `pagehide` keepalive path. It never reads live state: each queued edit carries the exact payload snapshotted at enqueue.
- **Workspace** keeps its existing draft state (`localInputs`, `activeBandLens`, `activeInboundBandLens`). **One effect is the only enqueue point**: whenever the draft differs from the last value handed to the queue (the existing `saved*Ref`s, which now mean exactly that), it enqueues the changed field. Every edit path in the file already funnels into those three setters (19 `setLocalInputs` sites, two lens setters), so no writer can be missed.
- **Writers are the three existing field-scoped routes**, called through the generated plain functions: `updateScenario` (whole-input `PATCH /scenarios/:id`, bumps `inputsUpdatedAt`), `updateDistanceBands` and `updateInboundDistanceBands` (DU-4.1 routes, no epoch bump, so band edits never flip `stale`). **No API, OpenAPI, codegen, DB or solver change.**
- **Unchanged:** server routes, `isStale()`, the result-history stepper's read-only rules, exports' server side, the solver.

**Tech stack:** React 18 + Vite, TanStack Query v5 (Orval-generated client in `lib/api-client-react`), vitest + RTL (jsdom), Playwright.

## Global Constraints

The master plan's Global Constraints (`docs/superpowers/plans/2026-10-24-design-upgrade.md:22-56`) bind every task. In addition:

**Contracts**
- Fixed interface (master §A, verbatim): `lib/autosave.ts`: `createWriteQueue(opts): { enqueue(edit: QueuedEdit): void; flush(): Promise<void>; undo(): void; status: "idle" | "saving" | "saved" | "error" }`. This plan **adds** (D6) `reset(): void`, `readonly state: WriteQueueState`, and an optional `flush(opts?: { keepalive?: boolean })` argument. No §A name changes.
- Debounce exactly `1000` ms (`AUTOSAVE_DEBOUNCE_MS`); undo depth exactly `20` (`AUTOSAVE_UNDO_LIMIT`); keepalive body cap `60_000` characters (`KEEPALIVE_MAX_CHARS`; browsers reject keepalive bodies past 64 KiB in flight).
- Never hand-edit `lib/api-zod/src/generated/**` or `lib/api-client-react/src/generated/**`. No task here needs a regen.
- Every write uses an existing user-scoped route (404 when not owned, never 403). No new endpoint (spec §5.6 Security).
- Every write failure the user sees is rendered through `describeWriteError` (`lib/describeWriteError.ts:54`), never `err.message`.

**Repo guards this phase touches** (keep them green, never loosen a regex):
- `src/__tests__/mutationErrorSurface.test.ts`: `.mutate(` sites need `onError`; `.catch(` handlers must use the error (`ALLOWED_EMPTY_CATCHES` gains exactly one named entry, DU-6.1); Workspace `minSites` drops from 9 to the measured count (DU-6.2).
- `src/__tests__/historyReadOnlyGuards.test.ts`: `setLocalInputs` caller count and `GUARDED_MUTATORS` (DU-6.2, DU-6.3).
- `src/__tests__/themeSurfaceGuard.test.ts`: raw `var(--ink-NNN)` outside allow-listed lines (DU-6.2).

**Per-task obligations**
- Invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before writing code, `ponytail:ponytail-review` before committing (root hard rule #12; qa-sdet exempt).
- **Sweep:** rg `artifacts/studio/src` and `artifacts/studio/e2e/` for every testid, string and prop the task removes or renames; fix every `src/` hit in the same commit. e2e hits are fixed in DU-6.4 (D17) — list them in the task report.
- **Changelog:** append `### DU-6.N — …` to `docs/CHANGELOG-implementation.md` in the same commit. Numbers in it come from commands run in that task; an unmeasured value is the literal `unknown`.
- **Gate (per task):** zero concurrent vitest first (`cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "vitest busy: $cnt"`), then `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`, one suite at a time, never `pkill`. Check `docs/superpowers/flake-registry.md` before calling a failure a regression.
- **Gate (close-out):** `pnpm gate` (exit 3 = re-run serially, not a failure); `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`; `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py` and `python3 artifacts/api-server/src/solver/tests/e2e_journey.py <API_BASE_URL> <section>` for every section (master Global Constraints; D16).
- **Commit:**
  1. `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`
  2. Build a static path list `P` (deleted files included), `git add -A -- ${=P}`, check `git diff --cached --name-only` equals `P`.
  3. `git commit --only ${=P} -m "[DU-6.N] …"` (no `--` before the paths; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## User decisions OQ1–OQ6 (approved 2026-11-23)

The user approved this plan on 2026-11-23 with every default below unchanged. The "Recommended default" column is the decision; the alternatives are recorded for history only.

| ID | Question | Recommended default |
|---|---|---|
| OQ1 | **A change the server rejects** (e.g. a 422 on an invalid value) can never save by retrying. Spec says failures are never dropped and navigation awaits the flush. What happens when the student tries to leave with one? | **Block in-app navigation** (scenario switch, create, clone, back-to-chapters, history step, save-as) with a toast carrying the `describeWriteError` sentence, until Retry succeeds, the value is fixed, or (DU-6.3) the edit is undone. **Plus a native `beforeunload` "Leave site?" warning while a save is pending or failed** — the only guard for closing the tab, and the fallback when the keepalive request can't carry the payload (Super Model networks, D7). Alternative: allow leaving and discard the failed edit. |
| OQ2 | **Undo granularity.** Number fields commit on every grammar-complete keystroke (`useDistanceDraft`), so per-commit undo turns typing "650" into three undo steps and burns the 20-step budget. | **One undo step = one save window per field**: all commits to the same field inside the 1 s debounce window undo together (the window's first "before" value is restored). |
| OQ3 | **Exports read the saved row.** Spec §5.6 lists solve, save-as, switch, navigate and unmount as flush callers, not exports. Without a flush, an input export (or the Super Model network export) taken within 1 s of an edit misses it. | **Input exports and the Super Model export await the flush first** (one `beforeDownload` hook in `ExportProvider`, one line in `handleSuperExport`). Result exports don't (they read the solved run). |
| OQ4 | **Undo lifetime.** Spec: "last 20 committed edits per scenario, for the current session". | **Per scenario, while this chapter's Workspace stays open.** Cleared when the scenario's inputs are replaced from outside the edit path (import, history step, delete) and when the student leaves the chapter. Not persisted. |
| OQ5 | **Indicator when nothing has been saved yet this visit.** | **Show nothing** until the first edit; then "Saving…" → "Saved" (which stays). |
| OQ6 | **Analytics meaning changes.** The server fires PostHog `"scenario updated"` on every `PATCH /scenarios/:id` (`routes/scenarios.ts:336-338, 367-369`). Today that means one explicit Save; after Phase 6 it is one debounced autosave, so its count rises sharply from the deploy on and pre/post numbers are not comparable. | **Leave the event as is** and record the meaning change (with the deploy date) in the changelog; no code change. Alternative: stop capturing on autosave writes (a server change, out of this phase's studio-only scope). |

## Decisions (technical; no user input needed)

| ID | Decision | Why / overkill check | Task |
|---|---|---|---|
| D1 | **Four tasks, not master's three.** DU-6.1 the pure queue module; DU-6.2 the Workspace switch-over **including** the removal of Save/`DirtyNavPrompt`, the Apply rename and the RTL rewrite; DU-6.3 undo wiring (header control + shortcut); DU-6.4 QA. | Master's DU-6.1 (wire the queue) / DU-6.2 (remove Save) split leaves an intermediate commit with two writers (autosave plus a Save button) and forces every Save-clicking RTL test to be rewritten twice. Wiring and removal are one contract change (how inputs persist), so they are one commit (root Gotcha: slice by contract, not layer). Undo is separable and independently reviewable, so it gets its own commit. | all |
| D2 | **One enqueue point: a diff effect**, not an `enqueue()` call at each edit site. | The repo's recorded failure class: an enumeration built from a syntactic pattern misses the writer that matters (`write-feedback` missed `handleSaveInputs` four ways). Every edit already lands in `localInputs` / `activeBandLens` / `activeInboundBandLens`; diffing those against the last-enqueued value catches all current and future writers with ~15 lines. The `saved*Ref`s are already maintained at every non-edit replacement (scenario seed, history step, server adoption, import), so those never enqueue. | 6.2 |
| D3 | **Writers are the generated plain functions** `updateScenario` / `updateDistanceBands` / `updateInboundDistanceBands` (each `(scenarioId, body, options?: RequestInit)`, `lib/api-client-react/src/generated/api.ts:894,1812,1885`), not the `useMutation` hooks. | One code path for normal and `pagehide` keepalive writes (keepalive is just `{ keepalive: true }` in `RequestInit`; `customFetch` spreads it into `fetch`, `custom-fetch.ts:380-385`, and calls `fetch` synchronously when no auth-token getter is set). Independent of component lifecycle, so a write started before an unmount still completes. Hook `mutateAsync` cannot take per-call `RequestInit`. Cost: the `.mutate(` guard cannot see these calls; the queue's error path is covered by `autosave.test.ts` and the indicator's RTL test instead. | 6.2 |
| D4 | **Revision ids are client-only.** The server has no scenario ETag/version (only `solveInputRevision`, which bumps on geometric writes and is internal to solve publication). Because the queue sends one request at a time, responses arrive in send order; "stale-response rejection" means: a whole-input response is **not adopted into `localInputs`** when a newer `inputs` edit was enqueued after it was sent (`isLatest === false`). Cache writes (`setQueryData`) still apply in order. | A server version check would need a schema + route change for a case (two tabs on one scenario) that is last-write-wins today too. Not in spec scope. | 6.1, 6.2 |
| D5 | **One queue per scenario**, held in a Workspace `useRef(new Map<number, WriteQueue>())`. A scenario switch leaves the old queue alive, so its debounce timer and in-flight write still finish against the right id. | This is the structural fix for the earlier 600 ms autosave regression (a timer tied to the component dropped edits on switch, comment at `Workspace.tsx:1625-1639`). | 6.2 |
| D6 | **Additive interface members:** `reset()` (drop pending edits, retained failures and the undo stack; mark in-flight acks stale), `state` (`{ status, error, canUndo }` snapshot, for re-seeding the indicator on scenario switch), `flush({ keepalive: true })`. | `reset()` is required: after an import or a history step replaces the inputs, a retained or pending edit (and every undo entry, whose "before" values are whole old blobs) would otherwise write stale data over the replacement. No §A name is renamed. | 6.1 |
| D7 | **`pagehide`:** `flush({ keepalive: true })` fires copies of the in-flight and pending edits with `keepalive: payload ≤ 60 000 chars`, and changes no queue state (a bfcache restore simply re-sends; the writes are idempotent). Super Model networks (~185 KB, `app.ts:94`) exceed the cap and go out as an ordinary request, which the browser may cancel: best effort, as spec §5.6 says, and OQ1's `beforeunload` warning covers it. **Server side needs nothing:** `cors()` allows `PATCH` with credentials (`app.ts:63-68`), the browser sends `Origin` so the SEC-1 CSRF check passes (`app.ts:76-86`), the 2 MiB scenario body limit applies (`app.ts:93-97`). Cross-origin keepalive needs a CORS preflight, which DU-6.4 verifies in Chromium against a cross-origin local setup. | `sendBeacon` is POST-only and cannot carry `PATCH` or JSON without a preflight; a second write path would duplicate D3. | 6.1, 6.2, 6.4 |
| D8 | **Send order within a drain: `inputs` → `distanceBands` → `inboundDistanceBands`.** `buildWholeInputPayload()` (`Workspace.tsx:2167-2175`) keeps merging the lens into the whole-input body, so a band write sent after it can only move the lens forward. Band-only edits use only the field-scoped routes, so `stale` never flips for them (spec Q3; server `scenarioInputWrite.ts:137-138` also treats a bands-only diff as reporting-only). | Keeps the existing last-write-wins lens invariant with no new merge logic. | 6.1 |
| D9 | **Failure:** the failed edit is put back in `pending` (unless a newer edit for that field already replaced it), status `error`, every `flush()` waiter rejects. **Retry = `flush()`**, which re-sends the coalesced payload. A new edit to the field coalesces into the retained one. | No retry timer or backoff: the spec asks for a Retry action, and an automatic retry of a 422 just repeats the failure. | 6.1, 6.2 |
| D10 | **Solve:** `handleSolve`'s save-before-solve branch (`Workspace.tsx:3214-3259`) is replaced by `flushAutosave().then(runSolve, onFlushError)` inside the existing `"saving"` phase. While `status === "error"`, `solveBlockedReason` (read by both Solve buttons) carries "Your last change isn't saved: <sentence>" and the header Run button is disabled with that title. | Reuses the CH4UX-6 phase/overlay/failure surfaces unchanged; flush covers the debounce window and in-flight writes. | 6.2 |
| D11 | **Flush callers:** Run Optimizer (D10), save-as-scenario, scenario select, create-confirm, clone, the header back-to-chapters button, result-history step (replaces `DirtyNavPrompt`), the Super Model road-distance fetch (replaces "Save your changes first"), Super Model export and input exports (OQ3). **Best-effort, not awaited:** the cleanup of the effect keyed on `currentScenario?.id` (URL-driven switches, browser back/forward, unmount) and `pagehide`. **Delete** calls that scenario's `reset()` instead (flushing into a row about to be deleted is pointless, and a failed edit must not block deletion). **Import applied** calls `reset()` (the server just replaced the inputs). | These are every place in `Workspace.tsx` that reads the persisted row or leaves the scenario (traced, see "Writer and reader inventory"). | 6.2 |
| D12 | **Removed:** the toolbar Save button and "Unsaved changes" text (`Workspace.tsx:4755-4771`), the four Input Map Layers-row Saves (`InputMapTab.tsx:785-804, 1278-1297, 1776-1795, 2362-2381`) and their `isDirty/onSave/saving/saveLabel` props (four prop blocks at `:163-175, :235-247, :279-291, :322-334`; passes at `Workspace.tsx:3582-3585, 3608-3611, 3636-3639, 3678-3681`), `DirtyNavPrompt.tsx` and its test, `saveInLayersRow*`/`showToolbarSave`/`isEditableInputTab` (they only placed Save). The toolbar row survives only for Super Model's Import/Export buttons. **Renamed "Save" → "Apply"** in all three edit dialogs: `EditCustomerDialog.tsx:173`, `EditWarehouseDialog.tsx:142`, `SuperEntityDialog.tsx:58` (edit mode). Testids stay (`edit-customer-save`, `edit-warehouse-save`, `super-entity-submit`) so no e2e selector churns for a label change. Copy: `SuperTableUploadDialog.tsx:54` "Press Save to keep them." → "Changes save automatically." | Spec names "the Edit dialog" (singular); the code has three, all the same semantic, so all three are renamed. | 6.2 |
| D13 | **Indicator:** `components/workspace/AutosaveIndicator.tsx`, rendered in the header's right track before Run Optimizer. `data-testid="autosave-status"`, `data-status` = the status. Saving/Saved in `--ink-300` (same as the header subtitle), `role="status"`. Error: warning icon + sentence in `--surface-band-fg`, `role="alert"`, Retry button `data-testid="button-autosave-retry"` (24 px target). Error text is **not** red: red text on the ink band fails contrast in both themes, and the icon + role carry the meaning. | Same tokens as the rest of the header band (Phase 5 Q8), so dark mode needs nothing new. | 6.2 |
| D14 | **Undo:** the stack lives in the queue (OQ2/OQ4). `Cmd/Ctrl+Z` (no Shift/Alt) on `window`, ignored when the event target is inside `input, textarea, select, [contenteditable], [role='dialog']`; a header Undo button (`data-testid="button-undo"`). Both disabled while browsing an older history entry (ordinary edits are read-only there, decision 1h). An undo restores the "before" value through the normal setters; the diff effect then enqueues it **without** a `previous`, so the undo itself is not undoable and there is no redo (not in spec). | Minimal: no redo stack, no new state machine. | 6.3 |
| D15 | **`AUTOSAVE_DEBOUNCE_MS` is exported and passed explicitly by Workspace**, so RTL files can `vi.mock("@/lib/autosave", …)` it to `0` and wait with `waitFor` on real timers. The 1 s value itself is pinned in `autosave.test.ts` (fake timers) and in one Workspace test. | Fake timers across ~20 RTL files would fight `waitFor` and React Query. | 6.2 |
| D16 | **Run `e2e_accuracy.py` and `e2e_journey.py` at close-out** even though Phase 6 changes no server/solver code (spec §6: "the studio-only behaviour change uses existing routes"). | Master Global Constraints name Phase 6 explicitly; cheap. | close-out |
| D17 | **e2e sibling specs are rewritten in DU-6.4**, not DU-6.2. | Root Gotcha: the QA agent with local servers up is the natural owner; per-task gates don't run Playwright. DU-6.2's report lists the hits so DU-6.4 starts from an inventory. | 6.4 |

## Writer and reader inventory (verified 2026-11-23 on `6327e659`)

Line numbers drift; re-verify each with `rg -n` at task time.

**Draft writers (all reach the diff effect, D2):** `setLocalInputs` at `Workspace.tsx:1667` (seed), `:1808` (history step), `:1842` (DirtyNav discard — removed), `:2005`, `:2016`, `:2060`, `:2090`, `:2114`, `:2142` (table/parameter edits), `:2242` (save adoption — replaced), `:2394` (import), `:2662`, `:2689`, `:2716`, `:2745` (map edits per model), `:3240` (solve-save adoption — removed), `:3554`, `:4020`, `:4978` (Super Model). Lens: `setActiveBandLens` / `setActiveInboundBandLens` at `:2031`, `:2035` (`handleOptimizationParamsChange`, shared by the parameters tab and `SolveDialog`), seeded at `:1670`, `:1673`.

**Persisted-row readers / scenario leavers (D11):** `handleSolve` `:3172`, `handleSaveAsScenario` `:3389`, `handleSelectScenario` `:2872`, `handleCreateConfirm` `:2916`, `handleCloneScenario` `:2940`, `handleDeleteScenario` `:2962`, back button `:4646`, `stepResultBack/Forward` → `attemptStep` `:1823`, Super road fetch `:4015`/`:4819` (gated by `superFetchDisabledReason` `:2361`), `handleSuperExport` `:2899`, `ExportProvider` value `:4566-4584` (`contexts/ExportContext.tsx:102-120`), `superReadinessBlockedReason` `:2189` (precheck describes the saved row).

**Current explicit-save code removed by DU-6.2:** `saveWholeInputsAsync` `:2205-2269`, `handleSaveInputs` `:2276-2285`, `handleSaveBandsOnly` `:2292-2345`, `saveEnabled/saveLabel/saveIsPending/handleSaveClick` `:2359-2375`, `isDirty/ordinaryDirty/*LensDirty/lensDirty` `:1977-1990` (`isBrowsingHistoryNow` `:1991` stays), `dirtyNavPrompt` state and handlers `:1818-1864`, `DirtyNavPrompt` import `:100` and render `:4942-4947`, the "Save is explicit" comment `:1625-1639` (rewritten), `useUpdateDistanceBands`/`useUpdateInboundDistanceBands` hook calls `:1515-1516`. `useUpdateScenario` (`:1513`) stays: the name-only rename at `:3007` still uses it.

**Spec/master line references that have drifted:** spec's `Workspace.tsx:3074-3118` (save-then-solve) is now `:3214-3259`; `:4718-4728` (`DirtyNavPrompt`) is `:4942-4947`; `:1593-1601` (600 ms regression note) is `:1625-1639`.

---

### Task DU-6.1: `lib/autosave.ts` write queue (pure module)

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Files:**
- Create: `artifacts/studio/src/lib/autosave.ts`
- Create: `artifacts/studio/src/__tests__/autosave.test.ts`
- Modify: `artifacts/studio/src/__tests__/mutationErrorSurface.test.ts` (one `ALLOWED_EMPTY_CATCHES` entry)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `Scenario` type from `@workspace/api-client-react`.
- Produces (used verbatim by DU-6.2/6.3):

```ts
export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const AUTOSAVE_UNDO_LIMIT = 20;
export const KEEPALIVE_MAX_CHARS = 60_000;
export type AutosaveField = "inputs" | "distanceBands" | "inboundDistanceBands";
export type AutosaveStatus = "idle" | "saving" | "saved" | "error";
export interface QueuedEdit { field: AutosaveField; payload: unknown; previous?: unknown }
export interface WriteQueueState { status: AutosaveStatus; error: unknown; canUndo: boolean }
export interface WriteQueueOpts {
  write(field: AutosaveField, payload: unknown, init?: RequestInit): Promise<Scenario>;
  onAck(field: AutosaveField, payload: unknown, scenario: Scenario, isLatest: boolean): void;
  onUndo(field: AutosaveField, previous: unknown): void;
  onChange(state: WriteQueueState): void;
  debounceMs?: number;
  undoLimit?: number;
}
export interface WriteQueue {
  enqueue(edit: QueuedEdit): void;
  flush(opts?: { keepalive?: boolean }): Promise<void>;
  undo(): void;
  reset(): void;
  readonly status: AutosaveStatus;
  readonly state: WriteQueueState;
}
export function createWriteQueue(opts: WriteQueueOpts): WriteQueue;
```

- [ ] **Step 1: Write the failing tests** — `src/__tests__/autosave.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWriteQueue, AUTOSAVE_DEBOUNCE_MS, KEEPALIVE_MAX_CHARS, type WriteQueueOpts, type AutosaveField } from "@/lib/autosave";
import type { Scenario } from "@workspace/api-client-react";

type Call = { field: AutosaveField; payload: unknown; init?: RequestInit; resolve: (s: Scenario) => void; reject: (e: unknown) => void };
const row = (n: number) => ({ id: 1, inputs: { n } }) as unknown as Scenario;

function harness(over: Partial<WriteQueueOpts> = {}) {
  const calls: Call[] = [];
  const opts = {
    write: vi.fn((field: AutosaveField, payload: unknown, init?: RequestInit) =>
      new Promise<Scenario>((resolve, reject) => calls.push({ field, payload, init, resolve, reject }))),
    onAck: vi.fn(),
    onUndo: vi.fn(),
    onChange: vi.fn(),
    ...over,
  };
  return { q: createWriteQueue(opts), opts, calls };
}
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createWriteQueue (DU-6.1, spec §5.6)", () => {
  it("debounces 1000 ms and the constant is 1000", async () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(1000);
    const { q, opts } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    expect(q.status).toBe("saving");
    await vi.advanceTimersByTimeAsync(999);
    expect(opts.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(opts.write).toHaveBeenCalledWith("inputs", { a: 1 });
  });

  it("coalesces edits to the same field inside the window (last payload wins, one write)", async () => {
    const { q, opts } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    await vi.advanceTimersByTimeAsync(500);
    q.enqueue({ field: "inputs", payload: { a: 2 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(opts.write).toHaveBeenCalledTimes(1);
    expect(opts.write).toHaveBeenCalledWith("inputs", { a: 2 });
  });

  it("keeps one request in flight; a later edit waits for the ack", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    q.enqueue({ field: "inputs", payload: { a: 2 } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(opts.write).toHaveBeenCalledTimes(1);
    calls[0].resolve(row(1));
    await tick();
    expect(opts.write).toHaveBeenCalledTimes(2);
    expect(opts.write).toHaveBeenLastCalledWith("inputs", { a: 2 });
  });

  it("marks an ack stale (isLatest=false) when a newer edit to the field was enqueued after the send", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    q.enqueue({ field: "inputs", payload: { a: 2 } });
    calls[0].resolve(row(1));
    await tick();
    expect(opts.onAck).toHaveBeenLastCalledWith("inputs", { a: 1 }, row(1), false);
    await vi.advanceTimersByTimeAsync(1000);
    calls[1].resolve(row(2));
    await tick();
    expect(opts.onAck).toHaveBeenLastCalledWith("inputs", { a: 2 }, row(2), true);
    expect(q.status).toBe("saved");
  });

  it("sends inputs before distanceBands before inboundDistanceBands", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "inboundDistanceBands", payload: [1] });
    q.enqueue({ field: "distanceBands", payload: [2] });
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 3; i++) { calls[i].resolve(row(i)); await tick(); }
    expect(opts.write.mock.calls.map(c => c[0])).toEqual(["inputs", "distanceBands", "inboundDistanceBands"]);
  });

  it("retains a failed edit, reports the error, and flush() retries the same payload", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    const err = new Error("boom");
    calls[0].reject(err);
    await tick();
    expect(q.status).toBe("error");
    expect(q.state.error).toBe(err);
    expect(opts.onChange).toHaveBeenLastCalledWith({ status: "error", error: err, canUndo: false });
    const retried = q.flush();
    await tick();
    expect(opts.write).toHaveBeenLastCalledWith("inputs", { a: 1 });
    calls[1].resolve(row(1));
    await expect(retried).resolves.toBeUndefined();
    expect(q.status).toBe("saved");
  });

  it("a newer edit coalesces into a retained failure", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].reject(new Error("x"));
    await tick();
    q.enqueue({ field: "inputs", payload: { a: 3 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(opts.write).toHaveBeenLastCalledWith("inputs", { a: 3 });
  });

  it("flush() skips the debounce, resolves after the ack, and rejects on failure", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "distanceBands", payload: [5] });
    const p = q.flush();
    await tick();
    expect(opts.write).toHaveBeenCalledTimes(1);
    calls[0].resolve(row(0));
    await expect(p).resolves.toBeUndefined();
    q.enqueue({ field: "distanceBands", payload: [6] });
    const p2 = q.flush();
    await tick();
    calls[1].reject(new Error("nope"));
    await expect(p2).rejects.toThrow("nope");
  });

  it("flush() on an empty queue resolves immediately", async () => {
    const { q } = harness();
    await expect(q.flush()).resolves.toBeUndefined();
    expect(q.status).toBe("idle");
  });

  it("records one undo entry per field window, with the window's first previous value", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 }, previous: { a: 0 } });
    q.enqueue({ field: "inputs", payload: { a: 2 }, previous: { a: 1 } });
    expect(q.state.canUndo).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].resolve(row(2));
    await tick();
    q.enqueue({ field: "distanceBands", payload: [9], previous: [8] });
    q.undo();
    expect(opts.onUndo).toHaveBeenLastCalledWith("distanceBands", [8]);
    q.undo();
    expect(opts.onUndo).toHaveBeenLastCalledWith("inputs", { a: 0 });
    expect(q.state.canUndo).toBe(false);
    q.undo();
    expect(opts.onUndo).toHaveBeenCalledTimes(2);
  });

  it("keeps only the last 20 undo entries", async () => {
    const { q, opts, calls } = harness();
    for (let i = 0; i < 25; i++) {
      q.enqueue({ field: "inputs", payload: { a: i + 1 }, previous: { a: i } });
      await vi.advanceTimersByTimeAsync(1000);
      calls[i].resolve(row(i));
      await tick();
    }
    for (let i = 0; i < 25; i++) q.undo();
    expect(opts.onUndo).toHaveBeenCalledTimes(20);
    expect(opts.onUndo).toHaveBeenLastCalledWith("inputs", { a: 5 });
  });

  it("an edit without previous is not undoable", () => {
    const { q } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    expect(q.state.canUndo).toBe(false);
  });

  it("reset() drops pending work and undo entries, and marks the in-flight ack stale", async () => {
    const { q, opts, calls } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 }, previous: { a: 0 } });
    await vi.advanceTimersByTimeAsync(1000);
    q.enqueue({ field: "distanceBands", payload: [1], previous: [0] });
    q.reset();
    expect(q.state.canUndo).toBe(false);
    calls[0].resolve(row(1));
    await tick();
    expect(opts.onAck).toHaveBeenLastCalledWith("inputs", { a: 1 }, row(1), false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(opts.write).toHaveBeenCalledTimes(1);
    expect(q.status).toBe("saved");
  });

  it("flush({keepalive}) fires copies of in-flight + pending edits and leaves the queue unchanged", async () => {
    const { q, opts } = harness();
    q.enqueue({ field: "inputs", payload: { a: 1 } });
    await vi.advanceTimersByTimeAsync(1000);                 // { a: 1 } in flight
    q.enqueue({ field: "distanceBands", payload: [1] });
    const big = { blob: "x".repeat(KEEPALIVE_MAX_CHARS) };
    q.enqueue({ field: "inputs", payload: big });
    await q.flush({ keepalive: true });
    const sent = opts.write.mock.calls.slice(1);
    expect(sent).toEqual([
      ["inputs", { a: 1 }, { keepalive: true }],
      ["inputs", big, { keepalive: false }],
      ["distanceBands", [1], { keepalive: true }],
    ]);
    expect(q.status).toBe("saving");                         // pending untouched
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter studio test -- src/__tests__/autosave.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/autosave"`.

- [ ] **Step 3: Implement** — `src/lib/autosave.ts`:

```ts
// DU-6.1 (spec §5.6) — one serialized write queue per scenario. Pure: it never
// reads React state; every edit carries the exact payload its writer sends.
import type { Scenario } from "@workspace/api-client-react";

export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const AUTOSAVE_UNDO_LIMIT = 20;
// Browsers reject keepalive fetches once in-flight keepalive bodies pass 64 KiB.
export const KEEPALIVE_MAX_CHARS = 60_000;

export type AutosaveField = "inputs" | "distanceBands" | "inboundDistanceBands";
export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/** `previous` is the draft value before this edit, recorded for undo. Absent = not undoable. */
export interface QueuedEdit { field: AutosaveField; payload: unknown; previous?: unknown }
export interface WriteQueueState { status: AutosaveStatus; error: unknown; canUndo: boolean }

export interface WriteQueueOpts {
  write(field: AutosaveField, payload: unknown, init?: RequestInit): Promise<Scenario>;
  /** Every ack, in send order. isLatest=false: a newer edit to this field was enqueued after the
   *  send, so the caller must not adopt `scenario` into local state (stale-response rejection). */
  onAck(field: AutosaveField, payload: unknown, scenario: Scenario, isLatest: boolean): void;
  onUndo(field: AutosaveField, previous: unknown): void;
  onChange(state: WriteQueueState): void;
  debounceMs?: number;
  undoLimit?: number;
}

export interface WriteQueue {
  enqueue(edit: QueuedEdit): void;
  flush(opts?: { keepalive?: boolean }): Promise<void>;
  undo(): void;
  reset(): void;
  readonly status: AutosaveStatus;
  readonly state: WriteQueueState;
}

// Whole-input first: its body carries the band lens too, so a band write after it only moves the lens forward.
const ORDER: readonly AutosaveField[] = ["inputs", "distanceBands", "inboundDistanceBands"];
// pagehide: the page is unloading, nothing can render this; the edit stays pending (a bfcache restore resends it).
const ignoreUnloadingKeepalive = () => undefined;

export function createWriteQueue(opts: WriteQueueOpts): WriteQueue {
  const debounceMs = opts.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const undoLimit = opts.undoLimit ?? AUTOSAVE_UNDO_LIMIT;
  const pending = new Map<AutosaveField, { rev: number; payload: unknown }>();
  const latestRev = new Map<AutosaveField, number>();
  const undoStack: { field: AutosaveField; previous: unknown }[] = [];
  let rev = 0;
  let sending: { field: AutosaveField; payload: unknown } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let draining = false;
  let status: AutosaveStatus = "idle";
  let error: unknown = null;
  let waiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];

  const snapshot = (): WriteQueueState => ({ status, error, canUndo: undoStack.length > 0 });
  const setStatus = (next: AutosaveStatus, err: unknown = null) => { status = next; error = err; opts.onChange(snapshot()); };
  const settle = (failed: boolean, err?: unknown) => {
    const w = waiters;
    waiters = [];
    for (const x of w) if (failed) x.reject(err); else x.resolve();
  };

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        if (timer) return; // a debounce window reopened; its timer restarts the drain
        const field = ORDER.find(f => pending.has(f));
        if (!field) break;
        const edit = pending.get(field)!;
        pending.delete(field);
        sending = { field, payload: edit.payload };
        let scenario: Scenario;
        try {
          scenario = await opts.write(field, edit.payload);
        } catch (err) {
          if (!pending.has(field)) pending.set(field, edit); // retain; a newer coalesced edit wins
          setStatus("error", err);
          settle(true, err);
          return;
        } finally {
          sending = null;
        }
        opts.onAck(field, edit.payload, scenario, latestRev.get(field) === edit.rev);
      }
      setStatus("saved");
      settle(false);
    } finally {
      draining = false;
    }
  }

  return {
    enqueue(edit) {
      rev += 1;
      latestRev.set(edit.field, rev);
      // One undo step per field window (OQ2): only the window's first edit records its previous.
      if ("previous" in edit && !pending.has(edit.field)) {
        undoStack.push({ field: edit.field, previous: edit.previous });
        if (undoStack.length > undoLimit) undoStack.shift();
      }
      pending.set(edit.field, { rev, payload: edit.payload });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void drain(); }, debounceMs);
      setStatus("saving");
    },

    flush(o) {
      if (o?.keepalive) {
        const out = sending ? [sending] : [];
        for (const f of ORDER) {
          const p = pending.get(f);
          if (p) out.push({ field: f, payload: p.payload });
        }
        for (const e of out) {
          const keepalive = JSON.stringify(e.payload).length <= KEEPALIVE_MAX_CHARS;
          opts.write(e.field, e.payload, { keepalive }).catch(ignoreUnloadingKeepalive);
        }
        return Promise.resolve();
      }
      if (timer) { clearTimeout(timer); timer = null; }
      if (!draining && pending.size === 0) return Promise.resolve();
      const done = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
      if (status === "error") setStatus("saving"); // Retry
      void drain();
      return done;
    },

    undo() {
      const last = undoStack.pop();
      if (!last) return;
      opts.onChange(snapshot());
      opts.onUndo(last.field, last.previous);
    },

    reset() {
      if (timer) { clearTimeout(timer); timer = null; }
      pending.clear();
      undoStack.length = 0;
      for (const f of ORDER) latestRev.set(f, ++rev); // any in-flight ack is now stale
      setStatus(draining ? "saving" : "idle");
      settle(false);
    },

    get status() { return status; },
    get state() { return snapshot(); },
  };
}
```

Note the keepalive test expects `{ a: 1 }` (in flight) first, then the pending `inputs`, then `distanceBands`: that is the order the code above produces.

- [ ] **Step 4: Name the one empty catch.** In `mutationErrorSurface.test.ts` change `const ALLOWED_EMPTY_CATCHES: string[] = [];` to:

```ts
  // DU-6.1 — lib/autosave.ts's pagehide keepalive copies: the page is unloading, so nothing can
  // show the error, and the edit is still pending in the queue (a bfcache restore resends it).
  const ALLOWED_EMPTY_CATCHES: string[] = ["ignoreUnloadingKeepalive"];
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter studio test -- src/__tests__/autosave.test.ts src/__tests__/mutationErrorSurface.test.ts`
Expected: PASS (14 + existing).

- [ ] **Step 6:** per-task gate; `ponytail-review`; changelog `### DU-6.1 — autosave write queue (lib/autosave.ts)` (what landed, test count from the run, "no consumer yet; DU-6.2 wires it"); commit `[DU-6.1] add serialized autosave write queue`.

---

### Task DU-6.2: Workspace autosaves; Save buttons and DirtyNavPrompt removed; "Apply"

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing. This is the largest task: if the watchdog fires, resume via `SendMessage`.

**Files (static list; add every RTL file the sweep finds and paste the final list into the commit):**
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Create: `artifacts/studio/src/components/workspace/AutosaveIndicator.tsx`
- Delete: `artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx`, `artifacts/studio/src/__tests__/DirtyNavPrompt.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx`
- Modify: `artifacts/studio/src/components/workspace/map/dialogs/EditCustomerDialog.tsx`, `EditWarehouseDialog.tsx`, `artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx`, `SuperTableUploadDialog.tsx`, `SuperDistancesTab.tsx`
- Modify: `artifacts/studio/src/contexts/ExportContext.tsx` (OQ3)
- Modify tests: `__tests__/Workspace.test.tsx`, `Workspace.Integration.test.tsx` (incl. `:280-291` and `:605-627`), `Workspace.InputMapV2.test.tsx`, `Workspace.Brazil.test.tsx`, `Workspace.Jade.test.tsx`, `Workspace.Super.test.tsx`, `Workspace.Transport.test.tsx`, `Workspace.TransportCoal.test.tsx`, `Workspace.TwoEchelon.test.tsx`, `deliveryEditableInputs.test.tsx`, `InputMapTabV2.test.tsx`, `InputMapTabV2.jade.test.tsx`, `InputMapTabV2.transport.test.tsx`, `InputMapTabV2.twoEchelon.test.tsx`, `InputMapTab.deliveryFixedGeography.test.tsx`, `SuperInputMap.test.tsx`, `EditCustomerDialog.test.tsx`, `EditWarehouseDialog.test.tsx`, `SuperEntityDialog.test.tsx`, `mutationErrorSurface.test.ts`, `historyReadOnlyGuards.test.ts`, `themeSurfaceGuard.test.ts`; Create `__tests__/AutosaveIndicator.test.tsx`
- Modify: `artifacts/studio/CLAUDE.md` (one Gotcha, Step 12)
- Modify: `docs/CHANGELOG-implementation.md`

Inventory command (run first, paste into the report): `rg -n 'button-save|text-unsaved-changes|dirty-nav|DirtyNav|Save bands|Unsaved changes|saveLabel|fetchDisabledReason|"Save"' artifacts/studio/src artifacts/studio/e2e`

**Interfaces:**
- Consumes (DU-6.1): `createWriteQueue`, `AUTOSAVE_DEBOUNCE_MS`, `WriteQueue`, `WriteQueueState`, `AutosaveField`.
- Produces (DU-6.3/6.4 rely on): `queueFor(scenarioId): WriteQueue` and `flushAutosave(): Promise<void>` inside `Workspace`; `autosaveHandlersRef` (latest-render handlers); testids `autosave-status` (with `data-status`), `button-autosave-retry`; `ExportProviderValue.beforeDownload?: () => Promise<void>`. DU-6.2 enqueues edits **without** `previous` (undo arrives in DU-6.3).

- [ ] **Step 1: Failing behaviour tests.** In `Workspace.test.tsx`:
  - Extend the `vi.mock("@workspace/api-client-react", …)` factory with `updateScenario: vi.fn(), updateDistanceBands: vi.fn(), updateInboundDistanceBands: vi.fn(),`.
  - Add at file top (before the import of `Workspace`): `vi.mock("@/lib/autosave", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/autosave")>()), AUTOSAVE_DEBOUNCE_MS: 0 }));` (D15).
  - Add handles and a default resolution in `beforeEach`:

```ts
import { updateScenario as patchScenario, updateDistanceBands as patchBands, updateInboundDistanceBands as patchInbound } from "@workspace/api-client-react";
const mockPatchScenario = vi.mocked(patchScenario);
const mockPatchBands = vi.mocked(patchBands);
const mockPatchInbound = vi.mocked(patchInbound);
// in beforeEach:
mockPatchScenario.mockReset().mockImplementation(async (_id, body) => ({ ...scenario, inputs: { ...(body.inputs as object) } }) as never);
mockPatchBands.mockReset().mockImplementation(async (_id, body) => ({ ...scenario, inputs: { ...scenario.inputs, distanceBands: body.distanceBands } }) as never);
mockPatchInbound.mockReset().mockImplementation(async () => scenario as never);
```

  - New `describe("Workspace — autosave (DU-6.2)")`:

```ts
it("an edit saves itself through the whole-input PATCH; there is no Save button", async () => {
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
  expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
  await waitFor(() => expect(mockPatchScenario).toHaveBeenCalledTimes(1));
  const [id, body] = mockPatchScenario.mock.calls[0];
  expect(id).toBe(1);
  expect(body).toEqual({ inputs: expect.objectContaining({ warehouseOverrides: [{ id: "CHI", status: "forced_open", capacity: undefined }] }) });
  await waitFor(() => expect(screen.getByTestId("autosave-status")).toHaveAttribute("data-status", "saved"));
  expect(screen.getByTestId("autosave-status")).toHaveTextContent("Saved");
});

it("opening tabs and switching scenarios without editing writes nothing", async () => {
  renderWorkspace();
  for (const id of ["sidebar-input-warehouses", "sidebar-input-customers", "sidebar-input-optimization-parameters"]) fireEvent.click(screen.getByTestId(id));
  fireEvent.click(screen.getByTestId("sidebar-scenario-2"));   // use this file's existing scenario-select testid
  await new Promise(r => setTimeout(r, 20));
  expect(mockPatchScenario).not.toHaveBeenCalled();
  expect(mockPatchBands).not.toHaveBeenCalled();
  expect(screen.queryByTestId("autosave-status")).not.toBeInTheDocument();   // OQ5: idle shows nothing
});

it("a band-only edit uses the field-scoped route and never the whole-input PATCH", async () => {
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
  fireEvent.click(screen.getByTestId("button-remove-band-400"));            // a band present in this file's fixture
  await waitFor(() => expect(mockPatchBands).toHaveBeenCalledTimes(1));
  expect(mockPatchScenario).not.toHaveBeenCalled();
});

it("Run Optimizer flushes a pending edit before enqueueing the solve", async () => {
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
  fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
  fireEvent.click(screen.getByTestId("button-run-optimizer"));
  fireEvent.click(screen.getByTestId("button-solve"));                      // this file's existing dialog Solve testid
  await waitFor(() => expect(mockSolveScenario.mutate).toHaveBeenCalled());
  expect(mockPatchScenario.mock.invocationCallOrder[0]).toBeLessThan(mockSolveScenario.mutate.mock.invocationCallOrder[0]);
});

it("a failed save keeps the edit, shows the describeWriteError sentence, blocks Run, and Retry re-sends it", async () => {
  mockPatchScenario.mockRejectedValueOnce(Object.assign(new Error("HTTP 422"), { status: 422, data: { error: "Demand must be positive." } }));
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
  fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
  await waitFor(() => expect(screen.getByTestId("autosave-status")).toHaveAttribute("data-status", "error"));
  expect(screen.getByTestId("autosave-status")).not.toHaveTextContent("HTTP 422");
  expect(screen.getByTestId("button-run-optimizer")).toBeDisabled();
  const firstBody = mockPatchScenario.mock.calls[0][1];
  fireEvent.click(screen.getByTestId("button-autosave-retry"));
  await waitFor(() => expect(screen.getByTestId("autosave-status")).toHaveAttribute("data-status", "saved"));
  expect(mockPatchScenario.mock.calls[1][1]).toEqual(firstBody);
  expect(screen.getByTestId("button-run-optimizer")).toBeEnabled();
});

it("switching scenario mid-edit writes the edit to the OLD scenario before navigating", async () => {
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
  fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
  fireEvent.click(screen.getByTestId("sidebar-scenario-2"));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("?scenario=2"));   // this file's existing wouter mock
  expect(mockPatchScenario).toHaveBeenCalledTimes(1);
  expect(mockPatchScenario.mock.calls[0][0]).toBe(1);
  expect(mockPatchScenario.mock.invocationCallOrder[0]).toBeLessThan(mockNavigate.mock.invocationCallOrder.at(-1)!);
});

it("pagehide sends the pending edit with keepalive", () => {
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
  fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
  // Synchronously after the edit: the (0 ms) debounce timer has not fired, so the edit is still pending.
  window.dispatchEvent(new Event("pagehide"));
  expect(mockPatchScenario).toHaveBeenCalledWith(1, expect.anything(), { keepalive: true });
});
```

  Testids in the comments above (`sidebar-scenario-2`, `button-solve`, `mockNavigate`, band `400`) must be replaced with the ones this test file already uses for those controls; check with `rg -n 'sidebar-scenario|button-solve|mockNavigate|remove-band' src/__tests__/Workspace.test.tsx`. Do not invent selectors.

  Add `__tests__/AutosaveIndicator.test.tsx`: idle renders nothing; saving → "Saving…" with `role="status"`; saved → "Saved"; error → the `describeWriteError` sentence (feed an `ApiError`-shaped object with `data.error`), `role="alert"`, never `err.message`, Retry calls `onRetry`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter studio test -- src/__tests__/Workspace.test.tsx src/__tests__/AutosaveIndicator.test.tsx`
Expected: FAIL (no autosave; `button-save` present; missing module).

- [ ] **Step 3: `AutosaveIndicator.tsx`** (D13):

```tsx
import { AlertTriangle } from "lucide-react";
import { describeWriteError } from "@/lib/describeWriteError";
import type { WriteQueueState } from "@/lib/autosave";

export function AutosaveIndicator({ state, onRetry }: { state: WriteQueueState; onRetry: () => void }) {
  if (state.status === "idle") return null;
  if (state.status === "error") {
    const sentence = describeWriteError(state.error);
    return (
      <span role="alert" data-testid="autosave-status" data-status="error"
        className="flex items-center gap-1.5 max-w-xs text-xs text-[color:var(--surface-band-fg)]">
        <AlertTriangle aria-hidden className="w-3.5 h-3.5 shrink-0" />
        <span>{sentence}</span>
        <button type="button" onClick={onRetry} data-testid="button-autosave-retry"
          className="min-h-6 px-1 underline underline-offset-2 hover:bg-white/10 rounded">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span role="status" aria-live="polite" data-testid="autosave-status" data-status={state.status}
      className="text-xs text-[color:var(--ink-300)]">
      {state.status === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}
```

  `themeSurfaceGuard.test.ts` `ALLOWED` gains `["components/workspace/AutosaveIndicator.tsx", "var(--ink-300)", "ink header band (Q8)"]`.

- [ ] **Step 4: Workspace — the queue, writers, ack and the single enqueue point.** Near the existing mutation hooks (`:1513-1516`): delete the two band hook calls, keep `useUpdateScenario`. Import `updateScenario as patchScenario, updateDistanceBands as patchDistanceBands, updateInboundDistanceBands as patchInboundDistanceBands` from `@workspace/api-client-react`, and `createWriteQueue, AUTOSAVE_DEBOUNCE_MS, type WriteQueue, type WriteQueueState, type AutosaveField` from `@/lib/autosave`. Rewrite the "Save is explicit…" comment (`:1625-1639`) to describe autosave (D2, D5). After the `liveScenarioIdRef` lines (`:1655-1656`) add:

```tsx
  // DU-6.2 (spec §5.6) — autosave. One queue per scenario for this Workspace's
  // lifetime (D5): a switch leaves the old queue running, so its pending write
  // still lands on the right id. The saved*Refs above now mean "the value last
  // handed to the queue or adopted from the server" — the diff effect below
  // compares against them.
  const queuesRef = useRef(new Map<number, WriteQueue>());
  const [autosave, setAutosave] = useState<WriteQueueState>({ status: "idle", error: null, canUndo: false });
  // Latest-render handlers: queues outlive renders, so they call through this ref, never a stale closure.
  const autosaveHandlersRef = useRef({
    ack: (_s: number, _f: AutosaveField, _p: unknown, _u: Scenario, _l: boolean) => {},
  });

  function queueFor(scenarioId: number): WriteQueue {
    let q = queuesRef.current.get(scenarioId);
    if (!q) {
      q = createWriteQueue({
        debounceMs: AUTOSAVE_DEBOUNCE_MS,
        // D3 — the three existing field-scoped routes, through the generated plain functions.
        write: (field, payload, init) =>
          field === "inputs"
            ? patchScenario(scenarioId, { inputs: payload as Record<string, unknown> }, init)
            : field === "distanceBands"
              ? patchDistanceBands(scenarioId, { distanceBands: payload as number[] }, init)
              : patchInboundDistanceBands(scenarioId, { inboundDistanceBands: payload as number[] | null }, init),
        onAck: (field, payload, updated, isLatest) => autosaveHandlersRef.current.ack(scenarioId, field, payload, updated, isLatest),
        onUndo: () => undefined, // wired in DU-6.3
        onChange: state => {
          if (liveScenarioIdRef.current === scenarioId) setAutosave(state);
          else if (state.status === "error") {
            toast({ title: "Couldn't save a change to another scenario", description: describeWriteError(state.error), variant: "destructive" });
          }
        },
      });
      queuesRef.current.set(scenarioId, q);
    }
    return q;
  }

  function flushAutosave(): Promise<void> {
    return currentScenario ? queueFor(currentScenario.id).flush() : Promise.resolve();
  }

  // OQ1 — in-app navigation waits for the flush; a failed save keeps the student here.
  async function afterFlush(action: () => void) {
    try {
      await flushAutosave();
    } catch (err) {
      toast({ title: "Your last change isn't saved yet", description: describeWriteError(err), variant: "destructive" });
      return;
    }
    action();
  }
```

  Replace `saveWholeInputsAsync`'s `onSuccess` body with the ack handler (place it where `saveWholeInputsAsync` was, then delete `saveWholeInputsAsync`, `handleSaveInputs`, `handleSaveBandsOnly`, `saveEnabled`, `saveLabel`, `saveIsPending`, `handleSaveClick`, `superFetchDisabledReason`):

```tsx
  // DU-6.2 — every acknowledged autosave write. Whole-input responses are adopted
  // into the draft only when no newer inputs edit was enqueued since the send
  // (D4, stale-response rejection) and the student is still on that scenario.
  function handleAutosaveAck(scenarioId: number, field: AutosaveField, payload: unknown, updated: Scenario, isLatest: boolean) {
    if (field === "inputs" && isLatest && liveScenarioIdRef.current === scenarioId) {
      setLocalInputs(updated.inputs);
      savedInputsRef.current = updated.inputs;
    }
    queryClient.setQueryData(getGetScenarioQueryKey(scenarioId), updated);
    queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
    if (field !== "inputs") return;
    const sent = payload as Record<string, unknown>;
    queryClient.invalidateQueries({ queryKey: getPrecheckScenarioQueryKey(scenarioId) });
    void reportPendingPrecheckWatches(scenarioId);
    reportEstimatedDistanceWatches(scenarioId, distanceOverridesFromInputs(sent), distanceOverridesFromInputs(updated.inputs));
    reportEstimatedLaneCostWatches(scenarioId, laneCostOverridesFromInputs(sent), laneCostOverridesFromInputs(updated.inputs));
  }
  autosaveHandlersRef.current.ack = handleAutosaveAck;
```

  Replace `isDirty` … `lensDirty` (`:1977-1990`, keep `isBrowsingHistoryNow`) with the single enqueue point and the lifecycle effects:

```tsx
  // DU-6.2 (D2) — the ONLY enqueue point. Every edit path ends in setLocalInputs /
  // setActiveBandLens / setActiveInboundBandLens; non-edit replacements (seed,
  // history step, server adoption, import) also set the saved*Refs, so they
  // never differ here and never write. Deps are the draft only: on a scenario
  // switch the draft has not changed yet in that commit, so nothing is enqueued
  // for the new id until its own seeded draft is compared to its own refs.
  useEffect(() => {
    if (!currentScenario || localInputs == null) return;
    const q = queueFor(currentScenario.id);
    if (JSON.stringify(localInputs) !== JSON.stringify(savedInputsRef.current)) {
      savedInputsRef.current = localInputs;
      q.enqueue({ field: "inputs", payload: buildWholeInputPayload() });
    }
    if (JSON.stringify(activeBandLens) !== JSON.stringify(savedBandLensRef.current)) {
      savedBandLensRef.current = activeBandLens;
      q.enqueue({ field: "distanceBands", payload: activeBandLens });
    }
    if (JSON.stringify(activeInboundBandLens) !== JSON.stringify(savedInboundBandLensRef.current)) {
      savedInboundBandLensRef.current = activeInboundBandLens;
      q.enqueue({ field: "inboundDistanceBands", payload: activeInboundBandLens });
    }
  }, [localInputs, activeBandLens, activeInboundBandLens]);

  // Scenario switch (incl. URL-driven back/forward) and unmount: show the new
  // queue's state; best-effort flush of the one being left (D11).
  useEffect(() => {
    const id = currentScenario?.id;
    if (id == null) return;
    setAutosave(queueFor(id).state);
    return () => {
      queuesRef.current.get(id)?.flush().catch(err =>
        toast({ title: "Couldn't save your last change", description: describeWriteError(err), variant: "destructive" }));
    };
  }, [currentScenario?.id]);

  // D7 / OQ1 — closing or reloading the tab.
  useEffect(() => {
    const onPageHide = () => { for (const q of queuesRef.current.values()) void q.flush({ keepalive: true }); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      for (const q of queuesRef.current.values()) {
        if (q.status === "saving" || q.status === "error") { e.preventDefault(); return; }
      }
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
```

  The seed effect (`:1664-1676`) is unchanged. Check that `buildWholeInputPayload` is declared before the effect runs (it is a function declaration, hoisted). The effect must stay **after** the seed effect in source order.

- [ ] **Step 5: Solve and the blocked reason (D10).** Replace `superReadinessBlockedReason`/`solveBlockedReason` (`:2189-2195`):

```tsx
  const autosaveBusy = autosave.status === "saving" || autosave.status === "error";
  const autosaveBlockedReason = autosave.status === "error" ? `Your last change isn't saved: ${describeWriteError(autosave.error)}` : null;
  // QFX-3 — precheck describes the SAVED row, so it only blocks once nothing is pending.
  const superReadinessBlockedReason =
    modelId === "super-model" && !autosaveBusy && precheck && precheck.errors.length > 0
      ? `Fix the readiness issues before solving: ${precheck.errors[0].message}`
      : null;
  // The ONE blocked reason both Solve buttons read; an unsaved failure has priority (spec §5.6).
  const solveBlockedReason = autosaveBlockedReason ?? (objectiveRequired ? OBJECTIVE_REQUIRED_HINT : superReadinessBlockedReason);
```

  In `handleSolve`, replace the `if (ordinaryDirty && localInputs) { … } else { runSolve(); }` block (`:3214-3262`) and rewrite the "CRITICAL — save-before-solve" comment above the function to say the flush replaces it:

```tsx
    setSolvePhase("saving");
    // DU-6.2 (D10) — POST /solve solves the persisted row, so every pending
    // autosave write (debounce window or in flight) lands first.
    flushAutosave().then(runSolve, err => {
      const message = describeWriteError(err, "The scenario was not solved — fix the invalid input and try again.");
      setSolvePhase("failed");
      setSolveError(message);
      toast({ title: "Couldn't save your changes", description: message, variant: "destructive" });
    });
```

  Header Run button (`:4720-4728`): `disabled={!currentScenario || isBrowsingHistoryNow || solvePhase !== "idle" || objectiveRequired || autosave.status === "error"}` and `title={autosaveBlockedReason ?? (objectiveRequired ? OBJECTIVE_REQUIRED_HINT : undefined)}`.

- [ ] **Step 6: Flush callers (D11).**

```tsx
  function handleSelectScenario(id: number) {
    void afterFlush(() => navigate(`?scenario=${id}`));
  }
```
  - `handleCreateConfirm`: wrap the whole `createScenario.mutate(…)` call: `void afterFlush(() => { createScenario.mutate(…unchanged…); });`
  - `handleCloneScenario(id)`: same wrapping around `cloneScenario.mutate`.
  - `handleDeleteScenario(id)`: first line `queuesRef.current.get(id)?.reset();` (no flush).
  - `handleSaveAsScenario`: wrap the `createScenario.mutate` call in `void afterFlush(() => { … })`.
  - Back button `:4646`: `onClick={() => void afterFlush(() => navigate("/"))}`.
  - `handleImportApplied`: first line `queuesRef.current.get(updated.id)?.reset();`.
  - `handleSuperExport`: first statement inside `try`: `await flushAutosave();` (its existing `catch` already toasts `describeWriteError`).
  - Super road fetch: delete `superFetchDisabledReason`; at `:4015` pass `onFetchRoad={() => void afterFlush(() => setSuperRoadOpen(true))}` and drop `fetchDisabledReason`; at `:4819` drop `&& !superFetchDisabledReason` and wrap the opener the same way. In `SuperDistancesTab.tsx` delete the `fetchDisabledReason` prop (`:14`) and its use (`:157` becomes `disabled={p.readOnly}`).
  - Exports (OQ3): `ExportProviderValue` gains `/** DU-6.2 — awaited before an INPUT export, so pending autosave writes land first. */ beforeDownload?: () => Promise<void>;`. In `useExport`, destructure it, and in `download` after the three guards: `if ((INPUT_ENTITIES as readonly string[]).includes(entity)) await beforeDownload?.();` (add it to the `useMemo` deps). In Workspace's `exportValue` add `beforeDownload: flushAutosave,`. A rejection propagates to each export control's existing error handling; verify with `rg -n "download\(" src/components` that every caller already surfaces a rejection (WF-3 made `exportEntity` failures toast), and record the check in the report.

- [ ] **Step 7: History stepping replaces `DirtyNavPrompt`.** Delete the `dirtyNavPrompt` state, `handleDirtyNavDiscard/Cancel/Save`, the import (`:100`) and the render (`:4942-4947`); delete `components/workspace/DirtyNavPrompt.tsx` and `__tests__/DirtyNavPrompt.test.tsx`. Then:

```tsx
  // DU-6.2 — stepping replaces the draft, so pending writes land first; a failed
  // save keeps the student on this entry (OQ1). The undo history is cleared:
  // its "before" values belong to the draft being replaced (OQ4).
  function attemptStep(direction: "back" | "forward") {
    void afterFlush(() => {
      if (currentScenario) queueFor(currentScenario.id).reset();
      performStep(direction);
    });
  }
```

- [ ] **Step 8: Remove the Save surfaces (D12).**
  - Workspace toolbar row (`:4745-4790`): delete the "Unsaved changes" span and the Save `<Button>`; the row renders only for Super Model's Import/Export: replace `showToolbarSave` with `const showSuperToolbar = modelId === "super-model" && activeView?.kind === "input" && SUPER_INPUT_TABS.includes(activeView.entity);` and delete `isEditableInputTab`, `saveInLayersRow`, `saveInLayersRowTransport`, `saveInLayersRowTwoEchelon`, `saveInLayersRowJade`, `showToolbarSave` (re-check with `rg -n` that nothing else reads them). Remove the `Save` lucide import if now unused.
  - Insert in the header right track, before `<UnitToggle />` (the `.catch` must use its error; an empty one fails `mutationErrorSurface.test.ts`):

```tsx
            <AutosaveIndicator state={autosave} onRetry={() => {
              flushAutosave().catch(err => toast({ title: "Still couldn't save", description: describeWriteError(err), variant: "destructive" }));
            }} />
```
  - `InputMapTab.tsx`: delete the four Layers-row Save blocks and the four `isDirty/onSave/saving/saveLabel` prop declarations and destructurings; drop those four props at the four Workspace call sites. Remove the `Save` import if unused.
  - "Apply": `EditCustomerDialog.tsx:173` and `EditWarehouseDialog.tsx:142` text `Save` → `Apply`; `SuperEntityDialog.tsx:58` `{p.mode === "create" ? "Add" : "Apply"}`. Testids unchanged.
  - `SuperTableUploadDialog.tsx:54`: `Changes apply to the scenario and save automatically.`

- [ ] **Step 9: Guards.**
  - `mutationErrorSurface.test.ts`: Workspace `minSites` 9 → the count `rg -c '\.mutate(Async)?\(' artifacts/studio/src/pages/Workspace.tsx` prints after this task (expected 6: create, clone, delete, rename, solve, save-as), with a comment `// DU-6.2 — the four save mutate sites became autosave writes (lib/autosave.ts)`.
  - `historyReadOnlyGuards.test.ts`: the `setLocalInputs` count 19 → the value `rg -c 'setLocalInputs\(' artifacts/studio/src/pages/Workspace.tsx` prints (expected 17: −discard, −save adoption, −solve-save adoption, +autosave ack adoption), with a dated comment classifying the ack adoption as a server-response non-edit (same reasoning as CH4O-P1). Update the "Deliberately EXCLUDES" list (the discard path is gone).

- [ ] **Step 10: RTL sweep.** For every file in the inventory: tests that clicked `button-save` now assert the autosave write (`await waitFor(() => expect(mockPatchScenario).toHaveBeenCalledTimes(1))`, reading `mock.calls[0][0..1]`); add the three plain-function mocks to each file's `vi.mock` factory and the `AUTOSAVE_DEBOUNCE_MS: 0` mock; delete assertions on "Unsaved changes", `saveLabel`, "Save bands" and the dirty-nav prompt, replacing each with the behaviour it stood for. Required rewrites:
  - `Workspace.Integration.test.tsx:280-291` — "Save routes through the field-scoped PATCH, labelled Save bands": becomes "the band edit made while browsing history autosaves through `updateDistanceBands` once, and never the whole-input PATCH".
  - `Workspace.Integration.test.tsx:605-627` — "adding a 5th band and saving succeeds": becomes "adding a 5th band autosaves it through `updateDistanceBands` with `[…, 3000]` and no error surfaces".
  - Any history-step test that used the dirty-nav prompt: "stepping with a pending edit waits for the write, then steps"; "stepping while the save fails stays on the entry and toasts the sentence".
  - `InputMapTabV2*.test.tsx` / `InputMapTab.deliveryFixedGeography.test.tsx`: delete the Layers-row Save cases; add one assertion per mode that no `button-save` renders.
  - `EditCustomerDialog/EditWarehouseDialog/SuperEntityDialog` tests: the edit-mode button reads "Apply".
  - The 1 s value is pinned by `autosave.test.ts` (fake timers, real constant) and measured in a real browser by DU-6.4's debounce case; RTL files run with the mocked `0` (D15). Do not add fake timers to Workspace RTL files.

- [ ] **Step 11: Run** `pnpm --filter studio test -- src/__tests__/Workspace.test.tsx src/__tests__/AutosaveIndicator.test.tsx src/__tests__/Workspace.Integration.test.tsx`, then the full per-task gate. Expected: PASS.

- [ ] **Step 12: Durable rule** — append to `artifacts/studio/CLAUDE.md` (hard rule #9: rule only, history in the changelog):

  > - **Workspace autosaves (DU-6): never add a save call, and never add a reader of the saved row without `flushAutosave()`.** The only enqueue point is the diff effect over `localInputs`/`activeBandLens`/`activeInboundBandLens` — a new edit path just calls those setters. A new path that replaces the inputs from the server (like import) must set the `saved*Ref`s and call that scenario's queue `reset()`, or a pending/retained edit and the undo history will write the old draft over it. A new action that reads the persisted row (solve-like, export-like, navigation away) must `await flushAutosave()` first (`afterFlush` for navigation).

- [ ] **Step 13:** `ponytail-review`; changelog `### DU-6.2 — Workspace autosave; Save/DirtyNavPrompt removed; Apply` (measured counts, the e2e inventory for DU-6.4, any deviation); commit `[DU-6.2] autosave Workspace edits and remove the Save buttons`.

---

### Task DU-6.3: Undo (header control + Cmd/Ctrl+Z)

**Role:** frontend-engineer. Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing.

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.test.tsx`, `artifacts/studio/src/__tests__/historyReadOnlyGuards.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: DU-6.1 `QueuedEdit.previous`, `WriteQueue.undo()`, `state.canUndo`; DU-6.2 `queueFor`, `autosaveHandlersRef`, the diff effect.
- Produces: testid `button-undo`; `applyUndo(field, previous)` in `GUARDED_MUTATORS`.

- [ ] **Step 1: Failing tests** (in `Workspace.test.tsx`'s autosave describe):

```ts
it("the header Undo restores the last edit and saves the restored value", async () => {
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
  expect(screen.getByTestId("button-undo")).toBeDisabled();
  fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
  await waitFor(() => expect(mockPatchScenario).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId("button-undo"));
  await waitFor(() => expect(mockPatchScenario).toHaveBeenCalledTimes(2));
  expect(mockPatchScenario.mock.calls[1][1]).toEqual({ inputs: expect.not.objectContaining({ warehouseOverrides: [{ id: "CHI", status: "forced_open", capacity: undefined }] }) });
  expect(screen.getByTestId("button-undo")).toBeDisabled();   // the undo itself is not undoable
});

it("Ctrl+Z undoes outside text inputs and is ignored inside one", async () => {
  renderWorkspace();
  fireEvent.click(screen.getByTestId("sidebar-input-customers"));
  const demand = screen.getByTestId("input-customer-demand-C1");
  fireEvent.change(demand, { target: { value: "250" } });
  await waitFor(() => expect(mockPatchScenario).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(demand, { key: "z", ctrlKey: true });
  await new Promise(r => setTimeout(r, 20));
  expect(mockPatchScenario).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  await waitFor(() => expect(mockPatchScenario).toHaveBeenCalledTimes(2));
  fireEvent.keyDown(document.body, { key: "z", metaKey: true });   // nothing left: no third write
  await new Promise(r => setTimeout(r, 20));
  expect(mockPatchScenario).toHaveBeenCalledTimes(2);
});

it("a band edit is undoable through the field-scoped route", async () => { /* edit a band, undo, expect mockPatchBands called twice, second with the original bands */ });

it("Undo is disabled while an older result is displayed, and stepping clears the undo history", () => { /* reuse this file's two-result history fixture */ });
```

  Write the two outlined cases in full using this file's existing band and history fixtures (`rg -n 'button-result-back|remove-band' src/__tests__/Workspace*.test.tsx`).

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter studio test -- src/__tests__/Workspace.test.tsx -t "Undo|Ctrl\\+Z|undoable"`; Expected: FAIL (`button-undo` not found).

- [ ] **Step 3: Implement.**

```tsx
  // DU-6.3 (D14) — restores the "before" value through the normal setters; the
  // diff effect then enqueues it as an ordinary write, without `previous`.
  const undoingRef = useRef(false);
  function applyUndo(field: AutosaveField, previous: unknown) {
    if (isBrowsingHistoryNow) return;
    undoingRef.current = true;
    if (field === "inputs") setLocalInputs(previous as Record<string, unknown>);
    else if (field === "distanceBands") setActiveBandLens(previous as number[]);
    else setActiveInboundBandLens(previous as number[] | null);
  }
  function handleUndo() {
    if (isBrowsingHistoryNow || !currentScenario) return;
    queueFor(currentScenario.id).undo();
  }
  autosaveHandlersRef.current.applyUndo = applyUndo;
  autosaveHandlersRef.current.undo = handleUndo;
```

  - `autosaveHandlersRef`'s initial object gains `applyUndo: (_f: AutosaveField, _p: unknown) => {}` and `undo: () => {}`; in `queueFor`, `onUndo: (field, previous) => { if (liveScenarioIdRef.current === scenarioId) autosaveHandlersRef.current.applyUndo(field, previous); }`.
  - The diff effect records `previous` unless the change is an undo:

```tsx
    const record = !undoingRef.current;
    undoingRef.current = false;
    const edit = (field: AutosaveField, payload: unknown, previous: unknown) =>
      q.enqueue(record ? { field, payload, previous } : { field, payload });
    // …each branch: capture `const previous = savedXRef.current;` BEFORE assigning the ref, then `edit(field, payload, previous)`.
```

  - Keyboard (D14):

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const t = e.target as Element | null;
      if (t?.closest?.("input, textarea, select, [contenteditable], [role='dialog']")) return;
      e.preventDefault();
      autosaveHandlersRef.current.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
```

  - Header, immediately left of `AutosaveIndicator` (classes copied from the stepper buttons at `:4665-4668`):

```tsx
            <button type="button" data-testid="button-undo" onClick={handleUndo}
              disabled={!autosave.canUndo || isBrowsingHistoryNow}
              title="Undo last change (Ctrl+Z / ⌘Z)" aria-label="Undo last change"
              className="w-8 h-8 rounded flex items-center justify-center border border-[color:var(--ink-500)] text-[color:var(--surface-band-fg)] hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <Undo2 className="w-4 h-4" />
            </button>
```

  - `historyReadOnlyGuards.test.ts`: add `"applyUndo"` to `GUARDED_MUTATORS` (its first statement is the guard) and bump the `setLocalInputs` count by 1 with a dated comment.

- [ ] **Step 4:** tests PASS; per-task gate; `ponytail-review`; changelog `### DU-6.3 — undo (20 edits, header + Cmd/Ctrl+Z)`; commit `[DU-6.3] undo the last 20 autosaved edits`.

---

### Task DU-6.4: Phase 6 real-browser QA and sibling e2e sweep (qa-sdet)

**Role:** qa-sdet (exempt from karpathy/ponytail; if a ponytail ruleset is injected, ignore it and say so), reviewed by a separate `fable` reviewer agent. Debounce, keepalive, `beforeunload` and cross-origin preflight are invisible to jsdom; this task is where they are verified.

**Files:**
- Create: `artifacts/studio/e2e/helpers/autosave.ts`
- Create: `artifacts/studio/e2e/design-upgrade-p6.spec.ts`
- Modify: every sibling spec from DU-6.2's inventory (verified 2026-11-23: `bundle2-fastfollow`, `bundle6-ui-tweaks`, `chen-bands-units-qa`, `delivery-teaching`, `design-upgrade-p4`, `input-map-v2`, `input-tables-qa`, `jade-ch9-workspace-bundle`, `jade-transport-costs`, `jade-two-echelon`, `max-coverage`, `nonjade-servicestats-live-coverage`, `quick-fixes`, `super-model`, `two-echelon`, `workspace-fixups`, `workspace-fixups-2`, `workspace-ux-r1-r9` `.spec.ts`)
- Modify: `docs/superpowers/flake-registry.md` (sightings only), `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: helper.**

```ts
import { expect, type Page, type Response } from "@playwright/test";

const AUTOSAVE_PATH = /^\/api\/scenarios\/\d+(\/(inbound-)?distance-bands)?$/;
const isAutosaveWrite = (r: Response) => r.request().method() === "PATCH" && AUTOSAVE_PATH.test(new URL(r.url()).pathname);

/** Runs `edit`, then waits for its autosave PATCH to succeed and the indicator to settle on "Saved". */
export async function autosaved(page: Page, edit: () => Promise<void>): Promise<void> {
  const write = page.waitForResponse(isAutosaveWrite);
  await edit();
  expect((await write).ok()).toBe(true);
  await expect(page.getByTestId("autosave-status")).toHaveAttribute("data-status", "saved");
}
```

- [ ] **Step 2: sibling sweep.** In each listed spec, replace "edit, then click `button-save`" with `await autosaved(page, async () => { …edit… })`; drop "Unsaved changes" / "Save bands" / dirty-nav assertions, keeping the behaviour they guarded; edit-dialog flows keep their testids (label is now "Apply"). Run each changed spec green against local servers before moving on.

- [ ] **Step 3: `design-upgrade-p6.spec.ts`** — local servers per `e2e/CLAUDE.md` (api-server on 3001, studio with `API_PROXY_TARGET`, `VITE_POSTHOG_KEY`/`VITE_SENTRY_DSN` dummies), `E2E_BASE_URL` set; each test registers its own user and scenarios; solved state seeded via `helpers/seedSolvedResult.ts`; solve completion via `helpers/solvedAt.ts` (`readSolvedAt`, captured before triggering). Cases:
  - **Debounce + coalesce:** three edits to one field within 1 s produce exactly one PATCH, sent ≥ 1000 ms after the last edit (timestamps from `page.on("request")`); the indicator goes Saving… → Saved.
  - **Solve during the debounce window:** edit a warehouse status, click Run within 200 ms; the PATCH completes before the `POST …/solve` request starts; the solved result reflects the edit.
  - **Scenario switch mid-edit:** edit in scenario A, switch to B within 200 ms; A's PATCH lands with A's id before the URL changes; reopening A shows the edit; B received no write.
  - **Back to chapters mid-edit** (header back button) and **browser back** (URL-driven switch): the edit persists (reload and check).
  - **Out-of-order rejection:** `page.route` delays the first PATCH by 2 s; make a second edit to the same field meanwhile; the draft never shows the first response's value, and the persisted row ends with the second.
  - **Failure retention + retry:** `page.route` answers the PATCH with 422 `{ error: "…" }`; the indicator shows that sentence (never `HTTP 422`), Run Optimizer is disabled with the sentence as its title, scenario switch and back-to-chapters stay put with a toast (OQ1); `unroute`, click Retry → Saved, Run enabled, the persisted row has the edit.
  - **Reload mid-edit (keepalive):** edit, reload within 200 ms; after reload the edit is persisted. Run twice: same-origin (Vite proxy) and **cross-origin** (studio with `VITE_API_BASE_URL=http://localhost:3001`, no proxy) to exercise the keepalive CORS preflight. Report the cross-origin result exactly; if Chromium refuses the keepalive preflight, say so — do not "fix" it in this task.
  - **`beforeunload`:** with a pending edit, `page.close({ runBeforeUnload: true })` raises a `dialog` of type `beforeunload`; with status Saved it does not.
  - **Undo:** header Undo and Ctrl/Cmd+Z restore the last edit and save it; Ctrl+Z inside a number input does not trigger app undo; 21 separate edits (each > 1 s apart) allow exactly 20 undos; a burst of keystrokes in one field undoes as one step (OQ2).
  - **Band edits don't flip `stale`:** on a seeded solved JADE scenario, edit outbound and inbound bands; only `…/distance-bands` and `…/inbound-distance-bands` PATCHes are sent, and the Stale badge never appears. An ordinary edit does flip it.
  - **View-only navigation writes nothing:** for all 8 chapters, open every input tab, the Input Map and the Optimization Parameters without editing; zero autosave PATCHes (request listener).
  - **No Save anywhere:** no `button-save`, `text-unsaved-changes` or `dirty-nav-prompt` on any chapter; the three edit dialogs show "Apply".
  - **Exports wait (OQ3):** edit, immediately export the same input entity; the file contains the edit.
  - **Both themes:** the indicator (Saving/Saved/error + Retry) and Undo are legible in light and dark; attach screenshots.
- [ ] **Step 4: gates.** `pnpm gate`; `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`; `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`; `python3 artifacts/api-server/src/solver/tests/e2e_journey.py http://localhost:3001 <section>` for every section in its `JOURNEYS` dict. Record each number from the run in the changelog; never estimate.
- [ ] **Step 5:** commit `[DU-6.4] Phase 6 real-browser QA and sibling e2e sweep` with the changelog entry.

---

## Branch setup (once, before DU-6.1)

```bash
cd /Users/shubhamkr/network-optimization-studio
git fetch origin
git merge-base --is-ancestor origin/main main && echo "local main contains origin/main"   # must print; else STOP
git rev-parse main                                       # record as <base>; it must contain this plan's commit
git branch design-upgrade-p6 main                        # never switch the shared checkout
git worktree add --lock /Users/shubhamkr/nos-du-6.1 -b du-6.1-work design-upgrade-p6
```

Each later task: `git worktree add --lock /Users/shubhamkr/nos-du-6.N -b du-6.N-work <design-upgrade-p6 tip after DU-6.(N-1)>`. Brief every agent with the exact path and the branch-check first command.

## Phase 6 close-out

1. `superpowers:finishing-a-development-branch`, then `/harness-retro DU-6`, then **STOP for merge approval**. Merge, whole-branch review on the merged state, push and deploy are each separately approved (root Branch discipline).
2. **Deploy is `nos-studio` only** (no `artifacts/api-server/**`, `solvers/**`, `lib/db/**` or `lib/api-spec/**` change): confirm with `pnpm deploy:preflight -- <deployed-sha>..HEAD` on the full diff (no pathspec) and include its checklist in the deploy approval request. Re-fetch `origin/main` immediately before the trigger (Render builds the tip). Pushing `main` is deploy-adjacent for `nos-studio`; say so when asking.
3. Deploy notes for the user: every Workspace edit now writes to the server about 1 s after it is made, so the server's `scenario updated` PostHog event (`routes/scenarios.ts:323-330`) fires per autosave write instead of per Save click; dashboards counting it will jump. Students who leave a tab with a failed save see the browser's "Leave site?" prompt (OQ1).

## Self-review

- **Spec §5.6 coverage:** serialized queue, one in-flight, monotonic revision ids (6.1); stale responses never overwrite newer local state (D4; 6.1 test, 6.2 ack, 6.4 out-of-order); grammar-complete commit points enqueued after a 1 s debounce with same-field coalescing (D2, 6.1, 6.4); field-scoped writers, geometric edits bump `inputsUpdatedAt`, band edits don't (D8; 6.2 test, 6.4 stale check); `flushAutosave()` awaited by solve, save-as, switch, navigate (D11), unmount best-effort + `pagehide` keepalive (D7); failure retained, `describeWriteError` sentence, Retry re-sends the coalesced payload, solve blocked with the message (D9, D10); header indicator (D13); undo 20 per scenario, Cmd/Ctrl+Z outside text inputs and a header control, undo enqueues a normal write (D14, 6.3); page Save button and `DirtyNavPrompt` removed, Edit-dialog Save → Apply (D12); no new endpoint (D3, D7).
- **Master §A coverage:** DU-6.1/6.2/6.3 deliverables all present, re-sliced into four tasks (D1); band edits route through the DU-4.1 route (D8); `Workspace.Integration.test.tsx:280-291,605-627` rewritten (6.2 Step 10); sibling e2e specs rewritten (6.4); Phase 6 gate runs `e2e_accuracy.py` + `e2e_journey.py` (close-out, D16).
- **Beyond the spec, now covered:** exports reading the saved row (OQ3); import and history replacement vs pending writes and undo (D6 `reset()`); closing the tab with a failed or oversize pending write (OQ1 `beforeunload`); per-keystroke commits vs the undo budget (OQ2); the Super Model road fetch gate; four Layers-row Saves and three edit dialogs, not one each; three source guards.
- **Type consistency:** `AutosaveField`, `QueuedEdit`, `WriteQueueState`, `WriteQueue`, `createWriteQueue`, `AUTOSAVE_DEBOUNCE_MS` are defined in 6.1 and used unchanged in 6.2/6.3; `queueFor`, `flushAutosave`, `afterFlush`, `autosaveHandlersRef`, `applyUndo`, `handleUndo` are defined in 6.2/6.3 and used only there; testids `autosave-status` (+`data-status`), `button-autosave-retry`, `button-undo` are shared by 6.2/6.3 RTL and the 6.4 helper/spec.
