# Design Upgrade Phase 6 Implementation Plan (autosave + cover sign-in page)

> **Execution:** agent-team dispatch per `AGENTS.md`, as in Phases 1–5. Never delegate to GLM (root hard rule #10).
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-6.N -b du-6.N-work <design-upgrade-p6 tip>`) and dispatches **without** `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-du-6.N && git rev-parse --abbrev-ref HEAD` (must print `du-6.N-work`, else STOP). The lead fast-forwards or cherry-picks each commit onto `design-upgrade-p6`.
> - **Roles:** DU-6.1, DU-6.2, DU-6.3, DU-6.4 are studio-only: `frontend-engineer`, reviewed by the lead on Opus plus `ponytail:ponytail-review`. The brief hands the engineer the task's test files explicitly (tests are qa-sdet's domain by default). DU-6.5: `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - **Merged plan (2026-11-25):** the user folded the signed-out landing redesign (an `impeccable` critique plus an approved prototype) into this phase as DU-6.4. It shares no code with autosave; it is here so both ship as one reviewed, gated branch. The plan was re-grounded on `ce6a9490` the same day (WQF Parts A–C landed after the 2026-11-23 approval).
> - Tasks run sequentially in listed order; every task's commit is green on its own. If an agent stalls on the 600 s watchdog, inspect its worktree read-only and resume it with `SendMessage`; never re-dispatch (root `CLAUDE.md` Gotchas).
> - Steps use checkbox (`- [ ]`) syntax.

**Goal:** implement spec §5.6 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md:288-325`, decision D7, findings G23/CR-4/CR-5): Workspace edits save themselves through one serialized, debounced, per-scenario write queue; every action that reads the saved row first awaits `flushAutosave()`; failures are retained and retried and block Solve; a header indicator shows Saving… / Saved / the error with Retry; the last 20 edits can be undone; the page Save buttons and `DirtyNavPrompt` are removed and the Edit-dialog "Save" becomes "Apply". **Plus (DU-6.4):** signed-out visitors land on a public cover-style sign-in page at `/`, `/login` and `/register` (and the password pages), built from the approved prototype, with one product name, "Network Design Labs".

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
- `src/__tests__/historyReadOnlyGuards.test.ts`: `setLocalInputs` caller count and `GUARDED_MUTATORS` (DU-6.2 adds `handleApplyDeliveryCosts`, DU-6.3 adds `applyUndo`).
- `src/__tests__/themeSurfaceGuard.test.ts`: raw `var(--ink-NNN)` outside allow-listed lines (DU-6.2).
- `src/__tests__/inputMapSaveWiring.test.ts`: deleted in DU-6.2 (D19). Every assertion in it pins the Save wiring that this phase removes.

**Per-task obligations**
- Invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before writing code, `ponytail:ponytail-review` before committing (root hard rule #12; qa-sdet exempt).
- **Sweep:** rg `artifacts/studio/src` and `artifacts/studio/e2e/` for every testid, string and prop the task removes or renames; fix every `src/` hit in the same commit. e2e hits are fixed in DU-6.5 (D17) — list them in the task report.
- **Changelog:** append `### DU-6.N — …` to `docs/CHANGELOG-implementation.md` in the same commit. Numbers in it come from commands run in that task; an unmeasured value is the literal `unknown`.
- **Gate (per task):** zero concurrent vitest first (`cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "vitest busy: $cnt"`), then `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`, one suite at a time, never `pkill`. Check `docs/superpowers/flake-registry.md` before calling a failure a regression.
- **Gate (close-out):** `pnpm gate` (exit 3 = re-run serially, not a failure); `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`; `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py` and `python3 artifacts/api-server/src/solver/tests/e2e_journey.py <API_BASE_URL> <section>` for every section (master Global Constraints; D16).
- **Commit:**
  1. `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`
  2. Build a static path list `P` (deleted files included), `git add -A -- ${=P}`, check `git diff --cached --name-only` equals `P`.
  3. `git commit --only ${=P} -m "[DU-6.N] …"` (no `--` before the paths; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## User decisions OQ1–OQ8 (OQ1–OQ6 approved 2026-11-23; OQ7–OQ8 decided 2026-11-25)

The user approved this plan on 2026-11-23 with every default below unchanged. The "Recommended default" column is the decision; the alternatives are recorded for history only. OQ7–OQ8 were decided on 2026-11-25, after WQF Part C (`ce6a9490`) added Save-beside-Filter and the Delivery Costs Base multiplier.

| ID | Question | Recommended default |
|---|---|---|
| OQ1 | **A change the server rejects** (e.g. a 422 on an invalid value) can never save by retrying. Spec says failures are never dropped and navigation awaits the flush. What happens when the student tries to leave with one? | **Block in-app navigation** (scenario switch, create, clone, back-to-chapters, history step, save-as) with a toast carrying the `describeWriteError` sentence, until Retry succeeds, the value is fixed, or (DU-6.3) the edit is undone. **Plus a native `beforeunload` "Leave site?" warning while a save is pending or failed** — the only guard for closing the tab, and the fallback when the keepalive request can't carry the payload (Super Model networks, D7). Alternative: allow leaving and discard the failed edit. |
| OQ2 | **Undo granularity.** Number fields commit on every grammar-complete keystroke (`useDistanceDraft`), so per-commit undo turns typing "650" into three undo steps and burns the 20-step budget. | **One undo step = one save window per field**: all commits to the same field inside the 1 s debounce window undo together (the window's first "before" value is restored). |
| OQ3 | **Exports read the saved row.** Spec §5.6 lists solve, save-as, switch, navigate and unmount as flush callers, not exports. Without a flush, an input export (or the Super Model network export) taken within 1 s of an edit misses it. | **Input exports and the Super Model export await the flush first** (one `beforeDownload` hook in `ExportProvider`, one line in `handleSuperExport`). Result exports don't (they read the solved run). |
| OQ4 | **Undo lifetime.** Spec: "last 20 committed edits per scenario, for the current session". | **Per scenario, while this chapter's Workspace stays open.** Cleared when the scenario's inputs are replaced from outside the edit path (import, history step, delete) and when the student leaves the chapter. Not persisted. |
| OQ5 | **Indicator when nothing has been saved yet this visit.** | **Show nothing** until the first edit; then "Saving…" → "Saved" (which stays). |
| OQ6 | **Analytics meaning changes.** The server fires PostHog `"scenario updated"` on every `PATCH /scenarios/:id` (`routes/scenarios.ts:336-338, 367-369`). Today that means one explicit Save; after Phase 6 it is one debounced autosave, so its count rises sharply from the deploy on and pre/post numbers are not comparable. | **Leave the event as is** and record the meaning change (with the deploy date) in the changelog; no code change. Alternative: stop capturing on autosave writes (a server change, out of this phase's studio-only scope). |
| OQ7 | **Super Model Import/Export once Save is removed.** WQF-C2 renders one cluster (Save + Import network + Export) beside Filter on 7 Super table tabs, through `ToolbarSaveSlot` (asserted at `Workspace.Super.test.tsx:275-293`), and in the toolbar row on the other Super input tabs. | **Keep Import/Export beside Filter.** The slot stays as an actions-only slot and is renamed `ToolbarActionSlot`: file `components/data-table/ToolbarActionSlot.ts`, the context, the DataTable consumer, and testid `data-table-save-slot` → `data-table-action-slot` (the only e2e user is `wqf-c2-save-beside-filter.spec.ts`, which DU-6.5 rewrites anyway). `SAVE_BESIDE_FILTER_TABS`, `saveBesideFilter` and the Save part of `saveCluster` are removed. Only the Super table tabs provide the slot; every other table renders no slot content. Mechanics in D12. |
| OQ8 | **Delivery Costs Base multiplier Apply under autosave.** Today it is blocked while anything is unsaved ("Save your changes first") and writes through `saveWholeInputsAsync`, which this phase deletes. | **Blocked only while autosave status is `"error"`**, with the same `describeWriteError` sentence Run Optimizer shows (D10). `handleApplyDeliveryCosts` keeps the `wholeInputsBody`/`rowsThatFit` size guard, then applies through `setLocalInputs`, so the diff effect autosaves it. It gains the history read-only guard and a `GUARDED_MUTATORS` entry. Mechanics in D20. |

## Decisions (technical; no user input needed)

| ID | Decision | Why / overkill check | Task |
|---|---|---|---|
| D1 | **Autosave is split into three code tasks plus QA, not master's three.** DU-6.1 the pure queue module; DU-6.2 the Workspace switch-over **including** the removal of Save/`DirtyNavPrompt`, the Apply rename and the RTL rewrite; DU-6.3 undo wiring (header control + shortcut); DU-6.5 QA. (DU-6.4 is the separate cover-page task.) | Master's DU-6.1 (wire the queue) / DU-6.2 (remove Save) split leaves an intermediate commit with two writers (autosave plus a Save button) and forces every Save-clicking RTL test to be rewritten twice. Wiring and removal are one contract change (how inputs persist), so they are one commit (root Gotcha: slice by contract, not layer). Undo is separable and independently reviewable, so it gets its own commit. | all |
| D2 | **One enqueue point: a diff effect**, not an `enqueue()` call at each edit site. | The repo's recorded failure class: an enumeration built from a syntactic pattern misses the writer that matters (`write-feedback` missed `handleSaveInputs` four ways). Every edit already lands in `localInputs` / `activeBandLens` / `activeInboundBandLens`; diffing those against the last-enqueued value catches all current and future writers with ~15 lines. The `saved*Ref`s are already maintained at every non-edit replacement (scenario seed, history step, server adoption, import), so those never enqueue. | 6.2 |
| D3 | **Writers are the generated plain functions** `updateScenario` / `updateDistanceBands` / `updateInboundDistanceBands` (each `(scenarioId, body, options?: RequestInit)`, `lib/api-client-react/src/generated/api.ts:896,1814,1887`), not the `useMutation` hooks. | One code path for normal and `pagehide` keepalive writes (keepalive is just `{ keepalive: true }` in `RequestInit`; `customFetch` spreads it into `fetch`, `custom-fetch.ts:380-385`, and calls `fetch` synchronously when no auth-token getter is set). Independent of component lifecycle, so a write started before an unmount still completes. Hook `mutateAsync` cannot take per-call `RequestInit`. Cost: the `.mutate(` guard cannot see these calls; the queue's error path is covered by `autosave.test.ts` and the indicator's RTL test instead. | 6.2 |
| D4 | **Revision ids are client-only.** The server has no scenario ETag/version (only `solveInputRevision`, which bumps on geometric writes and is internal to solve publication). Because the queue sends one request at a time, responses arrive in send order; "stale-response rejection" means: a whole-input response is **not adopted into `localInputs`** when a newer `inputs` edit was enqueued after it was sent (`isLatest === false`). Cache writes (`setQueryData`) still apply in order. | A server version check would need a schema + route change for a case (two tabs on one scenario) that is last-write-wins today too. Not in spec scope. | 6.1, 6.2 |
| D5 | **One queue per scenario**, held in a Workspace `useRef(new Map<number, WriteQueue>())`. A scenario switch leaves the old queue alive, so its debounce timer and in-flight write still finish against the right id. | This is the structural fix for the earlier 600 ms autosave regression (a timer tied to the component dropped edits on switch, comment at `Workspace.tsx:1653-1661`). | 6.2 |
| D6 | **Additive interface members:** `reset()` (drop pending edits, retained failures and the undo stack; mark in-flight acks stale), `state` (`{ status, error, canUndo }` snapshot, for re-seeding the indicator on scenario switch), `flush({ keepalive: true })`. | `reset()` is required: after an import or a history step replaces the inputs, a retained or pending edit (and every undo entry, whose "before" values are whole old blobs) would otherwise write stale data over the replacement. No §A name is renamed. | 6.1 |
| D7 | **`pagehide`:** `flush({ keepalive: true })` fires copies of the in-flight and pending edits with `keepalive: payload ≤ 60 000 chars`, and changes no queue state (a bfcache restore simply re-sends; the writes are idempotent). Super Model networks (~185 KB, `app.ts:94`) exceed the cap and go out as an ordinary request, which the browser may cancel: best effort, as spec §5.6 says, and OQ1's `beforeunload` warning covers it. **Server side needs nothing:** `cors()` allows `PATCH` with credentials (`app.ts:63-68`), the browser sends `Origin` so the SEC-1 CSRF check passes (`app.ts:76-86`), the 2 MiB scenario body limit applies (`app.ts:93-97`). Cross-origin keepalive needs a CORS preflight, which DU-6.5 verifies in Chromium against a cross-origin local setup. | `sendBeacon` is POST-only and cannot carry `PATCH` or JSON without a preflight; a second write path would duplicate D3. | 6.1, 6.2, 6.5 |
| D8 | **Send order within a drain: `inputs` → `distanceBands` → `inboundDistanceBands`.** `buildWholeInputPayload()` (`Workspace.tsx:2189-2197`) keeps merging the lens into the whole-input body, so a band write sent after it can only move the lens forward. Band-only edits use only the field-scoped routes, so `stale` never flips for them (spec Q3; server `scenarioInputWrite.ts:137-138` also treats a bands-only diff as reporting-only). | Keeps the existing last-write-wins lens invariant with no new merge logic. | 6.1 |
| D9 | **Failure:** the failed edit is put back in `pending` (unless a newer edit for that field already replaced it), status `error`, every `flush()` waiter rejects. **Retry = `flush()`**, which re-sends the coalesced payload. A new edit to the field coalesces into the retained one. | No retry timer or backoff: the spec asks for a Retry action, and an automatic retry of a 422 just repeats the failure. | 6.1, 6.2 |
| D10 | **Solve:** `handleSolve`'s save-before-solve branch (`Workspace.tsx:3277-3329`) is replaced by `flushAutosave().then(runSolve, onFlushError)` inside the existing `"saving"` phase. While `status === "error"`, `autosaveBlockedReason` ("Your last change isn't saved: <sentence>") feeds `solveBlockedReason` (read by both Solve buttons), the header Run button's disabled state and title, and the Base multiplier's `applyBlockedReason` (OQ8). | Reuses the CH4UX-6 phase/overlay/failure surfaces unchanged; flush covers the debounce window and in-flight writes. | 6.2 |
| D11 | **Flush callers:** Run Optimizer (D10), save-as-scenario, scenario select, create-confirm, clone, the header back-to-chapters button, result-history step (replaces `DirtyNavPrompt`), the Super Model road-distance fetch (replaces "Save your changes first"), Super Model export and input exports (OQ3), and a WatBot question asked with scenario context (D18). **Best-effort, not awaited:** the cleanup of the effect keyed on `currentScenario?.id` (URL-driven switches, browser back/forward, unmount) and `pagehide`. **Delete** calls that scenario's `reset()` instead (flushing into a row about to be deleted is pointless, and a failed edit must not block deletion). **Import applied** calls `reset()` (the server just replaced the inputs). | These are every place in `Workspace.tsx` that reads the persisted row or leaves the scenario (traced, see "Writer and reader inventory"). | 6.2 |
| D12 | **Removed:** the Save button and "Unsaved changes" text, which live in `saveCluster` (`Workspace.tsx:4685-4723`, testid `workspace-save-cluster`). WQF-C2 renders that cluster either in the toolbar row (`:4851-4858`, gated `showToolbarSave && !saveBesideFilter`) or inside a DataTable through `<ToolbarSaveSlot.Provider value={saveBesideFilter ? saveCluster : null}>` (`:4866-4897`). Also removed: `SAVE_BESIDE_FILTER_TABS` (`:1298`, 31 model/tab pairs) and `saveBesideFilter` (`:2952-2958`); the four Input Map Layers-row Saves (`InputMapTab.tsx:785-804, 1278-1297, 1776-1795, 2362-2381`) and their `isDirty/onSave/saving/saveLabel` props (four prop blocks at `:163-175, :235-247, :279-291, :322-334`; passes at `Workspace.tsx:3644-3647, 3670-3673, 3698-3701, 3740-3743`); `DirtyNavPrompt.tsx` and its test; `saveInLayersRow*`/`showToolbarSave`/`isEditableInputTab` (`:2463`, `:2574-2599`; they only placed Save). **What remains is Super's Import network + Export only (OQ7):** `saveCluster` becomes `superActions` (testid `super-toolbar-actions`). On the 7 Super table tabs (`SUPER_ACTIONS_BESIDE_FILTER_TABS = ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "transportCosts"]`), Workspace provides it through the renamed `ToolbarActionSlot` (testid `data-table-action-slot`). On the other Super input tabs, it renders in the `workspace-toolbar-row` (testid kept: `rg -l workspace-toolbar-row` finds 4 e2e specs and 3 RTL files reading it). No other model renders the row or provides the slot. **Renamed "Save" → "Apply"** in all three edit dialogs: `EditCustomerDialog.tsx:173`, `EditWarehouseDialog.tsx:142`, `SuperEntityDialog.tsx:58` (edit mode). Testids stay (`edit-customer-save`, `edit-warehouse-save`, `super-entity-submit`) so no e2e selector churns for a label change. Copy: `SuperTableUploadDialog.tsx:54` "Press Save to keep them." → "Changes save automatically." | Spec names "the Edit dialog" (singular); the code has three, all the same semantic, so all three are renamed. | 6.2 |
| D13 | **Indicator:** `components/workspace/AutosaveIndicator.tsx`, rendered in the header's right track before Run Optimizer. `data-testid="autosave-status"`, `data-status` = the status. Saving/Saved in `--ink-300` (same as the header subtitle), `role="status"`. Error: warning icon + sentence in `--surface-band-fg`, `role="alert"`, Retry button `data-testid="button-autosave-retry"` (24 px target). Error text is **not** red: red text on the ink band fails contrast in both themes, and the icon + role carry the meaning. | Same tokens as the rest of the header band (Phase 5 Q8), so dark mode needs nothing new. | 6.2 |
| D14 | **Undo:** the stack lives in the queue (OQ2/OQ4). `Cmd/Ctrl+Z` (no Shift/Alt) on `window`, ignored when the event target is inside `input, textarea, select, [contenteditable], [role='dialog']`; a header Undo button (`data-testid="button-undo"`). Both disabled while browsing an older history entry (ordinary edits are read-only there, decision 1h). An undo restores the "before" value through the normal setters; the diff effect then enqueues it **without** a `previous`, so the undo itself is not undoable and there is no redo (not in spec). | Minimal: no redo stack, no new state machine. | 6.3 |
| D15 | **`AUTOSAVE_DEBOUNCE_MS` is exported and passed explicitly by Workspace**, so RTL files can `vi.mock("@/lib/autosave", …)` it to `0` and wait with `waitFor` on real timers. The 1 s value itself is pinned in `autosave.test.ts` (fake timers) and in one Workspace test. | Fake timers across ~20 RTL files would fight `waitFor` and React Query. | 6.2 |
| D16 | **Run `e2e_accuracy.py` and `e2e_journey.py` at close-out** even though Phase 6 changes no server/solver code (spec §6: "the studio-only behaviour change uses existing routes"). | Master Global Constraints name Phase 6 explicitly; cheap. | close-out |
| D17 | **e2e sibling specs are rewritten in DU-6.5**, not DU-6.2. | Root Gotcha: the QA agent with local servers up is the natural owner; per-task gates don't run Playwright. DU-6.2's report lists the hits so DU-6.5 starts from an inventory. | 6.5 |
| D18 | **A WatBot question asked with scenario context waits for the flush.** The `onAsk` handler (`Workspace.tsx:4906`) sends `{ tab, scenarioId }`, and the server builds the answer's context from the **persisted** `inputs` (`api-server/src/routes/watbot.ts:66-73`). With context: `void afterFlush(() => void watbot.ask(q, ctx))`. Without context: ask immediately, as today. | Same reasoning as OQ3's exports: an answer that describes a row missing the student's last second of edits is wrong in a way the student can't see. Exempting it would be simpler but leaves exactly that bug, so the flush is not overkill. It reuses `afterFlush`, so there is no new mechanism; a failed save keeps the question unsent with the toast, as navigation does (OQ1). | 6.2 |
| D19 | **Delete `inputMapSaveWiring.test.ts`, don't rewrite it.** All six of its cases (`:47-125`) pin the Layers-row and toolbar Save wiring (`isDirty={saveEnabled}` ×4, `handleSaveClick`, `showToolbarSave`, `saveBesideFilter`). | The bug class it guards, a mount with an inert Save or with two Saves, cannot exist once there is no Save. What still needs guarding (no `button-save` anywhere, Super actions placement) is asserted behaviourally in `Workspace.TabCoverage.test.tsx` and `Workspace.Super.test.tsx` (DU-6.2 Step 10). | 6.2 |
| D20 | **The Base multiplier is an ordinary draft edit (OQ8).** `handleApplyDeliveryCosts` (`Workspace.tsx:2321`): first statement `if (isBrowsingHistoryNow) return;`; then the unchanged `rowsThatFit(o => wholeInputsBody({ laneCostOverrides: o }), …, writeLimitBytes)` guard; then `setLocalInputs(prev => (prev ? { ...prev, laneCostOverrides: next } : prev))`. `wholeInputsBody` (`:2230`) stays, since it is the guard's measure of exactly what the autosave write sends (`{ inputs: buildWholeInputPayload() }`). The `applyBlockedReason` pass (`:4304`) becomes `autosaveBlockedReason`. | One write path. The Apply becomes one undo step (DU-6.3) for free. A failure surfaces in the indicator like every other edit. No second writer, so no overkill; a 10,329-row draft is already stringified per render by today's `isDirty`, so the diff effect costs nothing new. | 6.2 |

## Writer and reader inventory (verified 2026-11-25 on `ce6a9490`)

Line numbers drift; re-verify each with `rg -n` at task time. Measured: `rg -c 'setLocalInputs\(' artifacts/studio/src/pages/Workspace.tsx` = 19; `rg -c '\.mutate(Async)?\(' artifacts/studio/src/pages/Workspace.tsx` = 10.

**Draft writers (all reach the diff effect, D2):** `setLocalInputs` at `Workspace.tsx:1689` (seed), `:1830` (history step), `:1864` (DirtyNav discard — removed), `:2027`, `:2038`, `:2082`, `:2112`, `:2136`, `:2164` (table/parameter edits), `:2271` (save adoption inside `saveWholeInputsAsync` — replaced by the autosave ack), `:2447` (import), `:2715`, `:2742`, `:2769`, `:2798` (map edits per model), `:3302` (solve-save adoption — removed), `:3616`, `:4082`, `:5047` (Super Model). The WQF-C5 Base multiplier `handleApplyDeliveryCosts` `:2321` writes through `saveWholeInputsAsync({ laneCostOverrides })` today and becomes a `setLocalInputs` draft edit (D20). Lens: `setActiveBandLens` / `setActiveInboundBandLens` at `:2053`, `:2057` (`handleOptimizationParamsChange`, shared by the parameters tab and `SolveDialog`), seeded at `:1692`, `:1695`.

**Persisted-row readers / scenario leavers (D11):** `handleSolve` `:3232`, `handleSaveAsScenario` `:3451`, `handleSelectScenario` `:2925`, `handleCreateConfirm` `:2978`, `handleCloneScenario` `:3002`, `handleDeleteScenario` `:3024`, back button `button-page-back` `:4746`, `stepResultBack/Forward` → `attemptStep` `:1845`, Super road fetch `:4077`/`:4887` (gated by `superFetchDisabledReason` `:2414`), `handleSuperExport` `:2961`, `ExportProvider` value `:4665-4683` (`contexts/ExportContext.tsx:102-120`), `superReadinessBlockedReason` `:2211-2216` (precheck describes the saved row), WatBot `onAsk` with context `:4906` (server reads persisted `inputs`, `api-server/src/routes/watbot.ts:66-73`; D18).

**Current explicit-save code removed by DU-6.2:** `saveWholeInputsAsync` `:2234-2297`, `handleSaveInputs` `:2298-2314`, `handleSaveBandsOnly` `:2340-2398`, `saveEnabled/superFetchDisabledReason/saveLabel/saveIsPending/handleSaveClick` `:2400-2429`, `isDirty/ordinaryDirty/*LensDirty/lensDirty` `:1999-2014` (`isBrowsingHistoryNow` `:2015` stays), `dirtyNavPrompt` state and handlers `:1840-1887` (`attemptStep` `:1845` is rewritten, not deleted), `DirtyNavPrompt` import `:102` and render `:5011-5016`, the "Save is explicit" comment `:1653-1661` (rewritten), `useUpdateDistanceBands`/`useUpdateInboundDistanceBands` hook calls `:1537-1538`. `useUpdateScenario` (`:1535`) stays: the name-only rename at `:3069` still uses it. WQF-C2 Save placement: `SAVE_BESIDE_FILTER_TABS` `:1298`, `saveBesideFilter` `:2952-2958`, the Save half of `saveCluster` `:4685-4723`, `ToolbarSaveSlot` import `:38` and provider `:4866-4897` (D12, OQ7). `wholeInputsBody` `:2230` and the `writeLimitBytes` prop `:1466`/`:1513` stay (D20).

**Spec/master line references that have drifted:** spec's `Workspace.tsx:3074-3118` (save-then-solve) is now `:3277-3329`; `:4718-4728` (`DirtyNavPrompt`) is `:5011-5016`; `:1593-1601` (600 ms regression note) is `:1653-1661`.

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
- Rename: `artifacts/studio/src/components/data-table/ToolbarSaveSlot.ts` → `ToolbarActionSlot.ts` (`git mv`; OQ7); Modify: `artifacts/studio/src/components/data-table/DataTable.tsx` (its consumer, `:17`, `:92`, `:313`, `:334`; testid `data-table-action-slot`). `data-table/types.ts` is unaffected: its WQF change is `renderToolbarAction` (WQF-C5), not the slot.
- Modify: `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx` (the `applyBlockedReason` doc comment at `:63` now says it carries the autosave-error reason; D20)
- Delete: `artifacts/studio/src/__tests__/inputMapSaveWiring.test.ts` (D19)
- Modify tests: `__tests__/Workspace.test.tsx`, `Workspace.Integration.test.tsx` (incl. `:269-306`, `:622-641`, `:652-670`, `:928-932`, `:1016`), `Workspace.InputMapV2.test.tsx`, `Workspace.Brazil.test.tsx`, `Workspace.Jade.test.tsx`, `Workspace.Super.test.tsx`, `Workspace.Transport.test.tsx`, `Workspace.TransportCoal.test.tsx`, `Workspace.TwoEchelon.test.tsx`, `deliveryEditableInputs.test.tsx`, `InputMapTabV2.test.tsx`, `InputMapTabV2.jade.test.tsx`, `InputMapTabV2.transport.test.tsx`, `InputMapTabV2.twoEchelon.test.tsx`, `InputMapTab.deliveryFixedGeography.test.tsx`, `SuperInputMap.test.tsx`, `EditCustomerDialog.test.tsx`, `EditWarehouseDialog.test.tsx`, `SuperEntityDialog.test.tsx`, `mutationErrorSurface.test.ts`, `historyReadOnlyGuards.test.ts`, `themeSurfaceGuard.test.ts`, `Workspace.TabCoverage.test.tsx`, `DataTable.test.tsx`, `DeliveryCostsTab.test.tsx`, `SuperDistancesTab.test.tsx`, `SuperTableTab.test.tsx`, `CustomerTable.test.tsx`, `WarehouseTable.test.tsx`; Create `__tests__/AutosaveIndicator.test.tsx`. (`rawErrorMessageSurface.test.ts` names `DirtyNavPrompt` only in historical comments; leave it.)
- Modify: `artifacts/studio/CLAUDE.md` (one Gotcha, Step 12)
- Modify: `docs/CHANGELOG-implementation.md`

Inventory command (run first, paste into the report): `rg -n 'button-save|text-unsaved-changes|dirty-nav|DirtyNav|Save bands|Unsaved changes|saveLabel|fetchDisabledReason|"Save"|data-table-save-slot|workspace-save-cluster|saveBesideFilter|SAVE_BESIDE_FILTER_TABS|ToolbarSaveSlot|Save your changes first|applyBlockedReason|Couldn.t apply the multiplier' artifacts/studio/src artifacts/studio/e2e`

**Interfaces:**
- Consumes (DU-6.1): `createWriteQueue`, `AUTOSAVE_DEBOUNCE_MS`, `WriteQueue`, `WriteQueueState`, `AutosaveField`.
- Produces (DU-6.3/6.5 rely on): `queueFor(scenarioId): WriteQueue` and `flushAutosave(): Promise<void>` inside `Workspace`; `autosaveHandlersRef` (latest-render handlers); testids `autosave-status` (with `data-status`), `button-autosave-retry`; `ExportProviderValue.beforeDownload?: () => Promise<void>`; `ToolbarActionSlot` (testid `data-table-action-slot`), `superActions` (testid `super-toolbar-actions`), `SUPER_ACTIONS_BESIDE_FILTER_TABS`. DU-6.2 enqueues edits **without** `previous` (undo arrives in DU-6.3).

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

- [ ] **Step 4: Workspace — the queue, writers, ack and the single enqueue point.** Near the existing mutation hooks (`:1535-1538`): delete the two band hook calls, keep `useUpdateScenario`. Import `updateScenario as patchScenario, updateDistanceBands as patchDistanceBands, updateInboundDistanceBands as patchInboundDistanceBands` from `@workspace/api-client-react`, and `createWriteQueue, AUTOSAVE_DEBOUNCE_MS, type WriteQueue, type WriteQueueState, type AutosaveField` from `@/lib/autosave`. Rewrite the "Save is explicit…" comment (`:1653-1661`) to describe autosave (D2, D5). After the `liveScenarioIdRef` lines (`:1684-1685`) add:

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

  Replace `saveWholeInputsAsync`'s `onSuccess` body with the ack handler (place it where `saveWholeInputsAsync` was, then delete `saveWholeInputsAsync`, `handleSaveInputs`, `handleSaveBandsOnly`, `saveEnabled`, `saveLabel`, `saveIsPending`, `handleSaveClick`, `superFetchDisabledReason`; keep `wholeInputsBody` for D20's size guard):

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

  Replace `isDirty` … `lensDirty` (`:1999-2014`, keep `isBrowsingHistoryNow` `:2015`) with the single enqueue point and the lifecycle effects:

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

  The seed effect (`:1687-1697`) is unchanged. Check that `buildWholeInputPayload` is declared before the effect runs (it is a function declaration, hoisted). The effect must stay **after** the seed effect in source order.

- [ ] **Step 5: Solve and the blocked reason (D10).** Replace `superReadinessBlockedReason`/`solveBlockedReason` (`:2211-2216`):

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

  In `handleSolve`, replace the `if (ordinaryDirty && localInputs) { … } else { runSolve(); }` block (`:3277-3329`; the comment is at `:3222`) and rewrite the "CRITICAL — save-before-solve" comment above the function to say the flush replaces it:

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

  Header Run button (`:4807-4815`): `disabled={!currentScenario || isBrowsingHistoryNow || solvePhase !== "idle" || objectiveRequired || autosave.status === "error"}` and `title={autosaveBlockedReason ?? (objectiveRequired ? OBJECTIVE_REQUIRED_HINT : undefined)}`.

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
  - Back button (`button-page-back`, `:4746`): `onClick={() => void afterFlush(() => navigate("/"))}`.
  - `handleImportApplied`: first line `queuesRef.current.get(updated.id)?.reset();`.
  - `handleSuperExport`: first statement inside `try`: `await flushAutosave();` (its existing `catch` already toasts `describeWriteError`).
  - Super road fetch: delete `superFetchDisabledReason`; at `:4077` pass `onFetchRoad={() => void afterFlush(() => setSuperRoadOpen(true))}` and drop `fetchDisabledReason` (`:4078`); at `:4887` drop `&& !superFetchDisabledReason` and wrap the opener the same way. In `SuperDistancesTab.tsx` delete the `fetchDisabledReason` prop (`:14`) and its use (`:157` becomes `disabled={p.readOnly}`). Drop the prop from `SuperDistancesTab.test.tsx` (`:27`, `:199`) and `SuperTableTab.test.tsx` (`:74`), and delete the "Save your changes first" case (`SuperDistancesTab.test.tsx:225`): typecheck fails otherwise.
  - Exports (OQ3): `ExportProviderValue` gains `/** DU-6.2 — awaited before an INPUT export, so pending autosave writes land first. */ beforeDownload?: () => Promise<void>;`. In `useExport`, destructure it, and in `download` after the three guards: `if ((INPUT_ENTITIES as readonly string[]).includes(entity)) await beforeDownload?.();` (add it to the `useMemo` deps). In Workspace's `exportValue` add `beforeDownload: flushAutosave,`. A rejection propagates to each export control's existing error handling; verify with `rg -n "download\(" src/components` that every caller already surfaces a rejection (WF-3 made `exportEntity` failures toast), and record the check in the report.
  - WatBot (D18), `onAsk` at `:4906`: keep the three resets first, then `const ctx = o.includeContext ? { tab: o.tab, scenarioId: currentScenario?.id ?? null } : null; if (ctx) void afterFlush(() => void watbot.ask(q, ctx)); else void watbot.ask(q, null);`.
  - Base multiplier (OQ8, D20): rewrite `handleApplyDeliveryCosts` (`:2321`). The history guard must be its first statement, because `historyReadOnlyGuards.test.ts` reads the next 11 lines:

```tsx
  // WQF-C5 / DU-6.2 (D20) — Delivery Costs' Base multiplier is an ordinary draft edit: the
  // diff effect autosaves it like any other. Size guard BEFORE any state change: measure the
  // exact whole-input body the autosave write will send against the server's limit.
  function handleApplyDeliveryCosts(next: LaneCostOverride[], appliedKeys: ReadonlySet<string>) {
    if (isBrowsingHistoryNow) return;
    const fit = rowsThatFit(o => wholeInputsBody({ laneCostOverrides: o }), next, appliedKeys, writeLimitBytes);
    if (fit !== null) {
      toast({ title: "Too many rows to apply at once", description: `Filter to ${fit} rows or fewer, then apply again.`, variant: "destructive" });
      return;
    }
    setLocalInputs(prev => (prev ? { ...prev, laneCostOverrides: next } : prev));
  }
```

    At the `DeliveryCostsTab` mount (`:4304`): `applyBlockedReason={autosaveBlockedReason}`.

- [ ] **Step 7: History stepping replaces `DirtyNavPrompt`.** Delete the `dirtyNavPrompt` state, `handleDirtyNavDiscard/Cancel/Save` (`:1840-1887`), the import (`:102`) and the render (`:5011-5016`); delete `components/workspace/DirtyNavPrompt.tsx` and `__tests__/DirtyNavPrompt.test.tsx`. Then:

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
  - `saveCluster` (`:4685-4723`) → `superActions`: delete the "Unsaved changes" span and the Save `<Button>`; keep the Super Import network / Export JSX unchanged; testid `workspace-save-cluster` → `super-toolbar-actions`. Replace `SAVE_BESIDE_FILTER_TABS` (`:1298`) with `export const SUPER_ACTIONS_BESIDE_FILTER_TABS: readonly string[] = ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "transportCosts"];`, i.e. today's `super-model` entry. Replace `showToolbarSave` and `saveBesideFilter` (`:2952-2958`) with:

```tsx
  // OQ7 — Super's Import network / Export: beside Filter on its table tabs, in the toolbar row on the rest.
  const superActionsTab = modelId === "super-model" && currentScenario != null && activeView?.kind === "input" && SUPER_INPUT_TABS.includes(activeView.entity);
  const superActionsBesideFilter = superActionsTab && localInputs != null && !superIsEmpty && SUPER_ACTIONS_BESIDE_FILTER_TABS.includes(activeView.entity);
```

    The toolbar row (`:4851-4858`, testid `workspace-toolbar-row` kept) renders on `superActionsTab && !superActionsBesideFilter`; the provider (`:4866-4897`) becomes `<ToolbarActionSlot.Provider value={superActionsBesideFilter ? superActions : null}>`. Delete `isEditableInputTab` (`:2463`), `saveInLayersRow`, `saveInLayersRowTransport`, `saveInLayersRowTwoEchelon`, `saveInLayersRowJade` and `showToolbarSave` (`:2574-2599`); re-check with `rg -n` that nothing else reads them. Remove the `Save` lucide import (`:35`) if now unused.
  - `git mv components/data-table/ToolbarSaveSlot.ts components/data-table/ToolbarActionSlot.ts`. Export `ToolbarActionSlot`, with the doc comment "Workspace's Super Import/Export actions, rendered by DataTable beside its Filter button. `null` (the default) = none. Provided only on `SUPER_ACTIONS_BESIDE_FILTER_TABS`." In `DataTable.tsx`, change the import (`:17`), `saveSlot` → `actionSlot` (`:92`, `:313`) and the testid to `data-table-action-slot` (`:334`).
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
  - `mutationErrorSurface.test.ts`: Workspace `minSites` 9 → the count `rg -c '\.mutate(Async)?\(' artifacts/studio/src/pages/Workspace.tsx` prints after this task (measured 10 on `ce6a9490`; expected 6 after this task: create, clone, delete, rename, solve, save-as), with a comment `// DU-6.2 — the four save mutate sites became autosave writes (lib/autosave.ts)`.
  - `historyReadOnlyGuards.test.ts`: the `setLocalInputs` count 19 (measured on `ce6a9490`) → the value `rg -c 'setLocalInputs\(' artifacts/studio/src/pages/Workspace.tsx` prints (expected 18: −discard, −save adoption, −solve-save adoption, +autosave ack adoption, +Base multiplier Apply), with a dated comment classifying the ack adoption as a server-response non-edit (same reasoning as CH4O-P1) and the Apply as a user edit. Add `"handleApplyDeliveryCosts"` to `GUARDED_MUTATORS` (D20). Update the "Deliberately EXCLUDES" list (the discard path is gone).
  - Delete `inputMapSaveWiring.test.ts` (D19).

- [ ] **Step 10: RTL sweep.** For every file in the inventory: tests that clicked `button-save` now assert the autosave write (`await waitFor(() => expect(mockPatchScenario).toHaveBeenCalledTimes(1))`, reading `mock.calls[0][0..1]`); add the three plain-function mocks to each file's `vi.mock` factory and the `AUTOSAVE_DEBOUNCE_MS: 0` mock; delete assertions on "Unsaved changes", `saveLabel`, "Save bands" and the dirty-nav prompt, replacing each with the behaviour it stood for. Required rewrites:
  - `Workspace.Integration.test.tsx:269-306`: "a bands-only edit survives step-away/step-back … and Save routes through the field-scoped PATCH" becomes "the band edit survives stepping and autosaves through `updateDistanceBands` once, and never the whole-input PATCH".
  - `Workspace.Integration.test.tsx:622-641`: "adding a 5th band and saving succeeds" becomes "adding a 5th band autosaves it through `updateDistanceBands` with `[…, 3000]` and no error surfaces".
  - `Workspace.Integration.test.tsx:652-670` ("a bands-only edit is saveable from the Input Map's own Layers-row Save") becomes "a band edit made with the Input Map open autosaves through the field-scoped route; no `button-save` renders".
  - `Workspace.Integration.test.tsx:928-932` (inbound lens-only "Save bands") and `:1016` (inbound reset "Save bands"): the inbound edit autosaves through `updateInboundDistanceBands` only (reset sends `null`); drop the label assertions.
  - `Workspace.TabCoverage.test.tsx`: `saveLocation()` (`:170-177`) and its use (`:184-189`) become "no `button-save` on any input tab". On `super-model` only, `super-toolbar-actions` sits inside `data-table-action-slot` exactly on `SUPER_ACTIONS_BESIDE_FILTER_TABS` and in `workspace-toolbar-row` otherwise. The "31 pairs" test (`:981`) becomes "every `SUPER_ACTIONS_BESIDE_FILTER_TABS` entry is a real Super sidebar tab (7)".
  - `Workspace.Super.test.tsx:275-293`: the cluster is `super-toolbar-actions` and holds exactly `super-toolbar-import`, `super-toolbar-export`, with no `button-save`. Slot/row placement assertions are unchanged except for the testid `data-table-action-slot`.
  - `DataTable.test.tsx:7, 824-844`: `ToolbarActionSlot` and `data-table-action-slot`.
  - `Workspace.test.tsx:1355-1425` (WQF-C5): Apply asserts one `mockPatchScenario` call whose body has the applied `laneCostOverrides`. "Blocked while the draft has unsaved changes" becomes "blocked while autosave is in error; title is the autosave sentence". "A rejected Apply" becomes "a rejected Apply write shows the `describeWriteError` sentence in `autosave-status`" (the "Couldn't apply the multiplier" toast is gone). The size-guard case asserts `mockPatchScenario` is never called with the overrides.
  - `DeliveryCostsTab.test.tsx:426-429`: the fixture string becomes an autosave-error sentence (the prop contract is unchanged).
  - `CustomerTable.test.tsx:26,186`, `WarehouseTable.test.tsx:30,162`: comments that describe `handleDirtyNavDiscard` as current are reworded to past tense or removed (comment-only).
  - WatBot (D18), in `Workspace.test.tsx`'s autosave describe: "asking with context after an edit sends the PATCH before the ask", reusing that file's existing WatBot selectors.
  - Any history-step test that used the dirty-nav prompt: "stepping with a pending edit waits for the write, then steps"; "stepping while the save fails stays on the entry and toasts the sentence".
  - `InputMapTabV2*.test.tsx` / `InputMapTab.deliveryFixedGeography.test.tsx`: delete the Layers-row Save cases; add one assertion per mode that no `button-save` renders.
  - `EditCustomerDialog/EditWarehouseDialog/SuperEntityDialog` tests: the edit-mode button reads "Apply".
  - The 1 s value is pinned by `autosave.test.ts` (fake timers, real constant) and measured in a real browser by DU-6.5's debounce case; RTL files run with the mocked `0` (D15). Do not add fake timers to Workspace RTL files.

- [ ] **Step 11: Run** `pnpm --filter studio test -- src/__tests__/Workspace.test.tsx src/__tests__/AutosaveIndicator.test.tsx src/__tests__/Workspace.Integration.test.tsx`, then the full per-task gate. Expected: PASS.

- [ ] **Step 12: Durable rule** — append to `artifacts/studio/CLAUDE.md` (hard rule #9: rule only, history in the changelog):

  > - **Workspace autosaves (DU-6): never add a save call, and never add a reader of the saved row without `flushAutosave()`.** The only enqueue point is the diff effect over `localInputs`/`activeBandLens`/`activeInboundBandLens` — a new edit path just calls those setters. A new path that replaces the inputs from the server (like import) must set the `saved*Ref`s and call that scenario's queue `reset()`, or a pending/retained edit and the undo history will write the old draft over it. A new action that reads the persisted row (solve-like, export-like, navigation away) must `await flushAutosave()` first (`afterFlush` for navigation).

- [ ] **Step 13:** `ponytail-review`; changelog `### DU-6.2 — Workspace autosave; Save/DirtyNavPrompt removed; Apply` (measured counts, the e2e inventory for DU-6.5, any deviation); commit `[DU-6.2] autosave Workspace edits and remove the Save buttons`.

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

  - Header, immediately left of `AutosaveIndicator` (classes copied from the stepper buttons at `:4770-4780`):

```tsx
            <button type="button" data-testid="button-undo" onClick={handleUndo}
              disabled={!autosave.canUndo || isBrowsingHistoryNow}
              title="Undo last change (Ctrl+Z / ⌘Z)" aria-label="Undo last change"
              className="w-8 h-8 rounded flex items-center justify-center border border-[color:var(--ink-500)] text-[color:var(--surface-band-fg)] hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <Undo2 className="w-4 h-4" />
            </button>
```

  - `historyReadOnlyGuards.test.ts`: add `"applyUndo"` to `GUARDED_MUTATORS` (its first statement is the guard) and bump the `setLocalInputs` count by 1 (expected 19 = DU-6.2's 18 + `applyUndo`; re-measure with `rg -c 'setLocalInputs\(' artifacts/studio/src/pages/Workspace.tsx`) with a dated comment.

- [ ] **Step 4:** tests PASS; per-task gate; `ponytail-review`; changelog `### DU-6.3 — undo (20 edits, header + Cmd/Ctrl+Z)`; commit `[DU-6.3] undo the last 20 autosaved edits`.

---

### Task DU-6.4: Cover sign-in page at signed-out `/`, `/login`, `/register` (and the password pages)

**Role:** `frontend-engineer`, reviewed by the lead on Opus plus `ponytail:ponytail-review`. The brief hands the engineer the test files explicitly. Invoke `impeccable` (its craft floor) before the UI edit, as well as karpathy and ponytail.

**Why this task exists:** an `impeccable` critique of the signed-out entry (2026-11-25, score 24/36) found: P1 there is no public landing page (signed-out `/` redirects to a log-in wall); P1 the product is never shown; P2 registering looks secondary, with no reassurance; P2 the chapter strip is unlabelled; P2 three product names (`Optimization Studio`, `SCND Optimization Studio`, `Network Design Labs`) and no `h1`; plus the "or" divider at `Login.tsx:69` measured 3.6:1 (`#83887a` on `#fdfdfc`). The user chose to fix all of them and approved prototype v8 after five feedback rounds. Mapping: P1 wall → signed-out `/` renders the page (Step 4); P1 product → the map strip + lede; P2 register → equal-weight toggle + the create hint; P2 strip → chapter names removed (L12); P2 names → L2 + `h1`; contrast → the divider no longer exists.

**Decisions L1–L12** (user-approved through the prototype rounds and the 2026-11-25 questions; the plan's only normative source for this page besides the prototype):

| ID | Decision |
|---|---|
| L1 | Look: the book cover's palette and imagery: green top band, mint graph-paper page with a washed world map, dots and white arcs; centre olive→teal strip with a white world map and routes. The form sits inside the strip, not in a separate card. Detector finding `codex-grid-background` is accepted (the brief asks for the cover's graph paper). |
| L2 | One product name, **Network Design Labs**, as the page `h1`, the `<title>`, the in-app fallback wordmark and the legal page's back link. The in-app kicker reads **Offered by Michael Watson** (user, 2026-11-25). |
| L3 | Log in / Create account is a toggle inside the strip; the create submit reads **Create account**. |
| L4 | The toggle is local state; `/login` and `/register` only pick the starting mode. |
| L5 | Hints: log-in `New here? Choose Create account above.`; create `Password: at least 8 characters. Free for students and instructors using the book; any email works, no invite code needed.` (user confirmed "Free for students"). |
| L6 | **Light only**, whatever the app theme or OS scheme. This reverses Phase 5's "auth pages follow the theme" for these routes; DU-6.5 rewrites the two Phase 5 cases accordingly. |
| L7 | Consent checkbox and copy exactly as the live app's `TermsConsent` (WQF-B); submit disabled until it is ticked, in both modes. |
| L8 | Links on this page: surface-coloured text, semi-bold, no underline at rest, underline on hover/focus. External links open a new tab and carry a ↗ icon plus screen-reader "(opens in a new tab)". |
| L9 | "Supply Chain Network Design" links to `https://www.amazon.com/dp/B078PNRZJB`. |
| L10 | Forgot-password and reset-password use the same shell (user, 2026-11-25); `AuthShell` is deleted. |
| L11 | Footer: `Trouble signing in? Contact the developer`, a `mailto:` to the developer address `DeveloperCredit.tsx` already publishes. `DeveloperCredit` itself stays in `AppShell`. |
| L12 | No chapter names and no other authors on this page; "Offered by / Michael Watson" with LinkedIn and email icon links sits above the footer band. The lede's second sentence is one line from 860 px wide and wraps below that. |

**Source of truth:** the approved prototype v8, committed with this plan as `docs/superpowers/specs/2026-11-25-cover-sign-in-prototype.html` (open it in a browser; it loads d3 from a CDN only to draw the map, which this task replaces with a static asset). Port its CSS and markup; do not redesign. Where this task's text and the prototype disagree, the text wins (it records the user's later decisions, L1–L12).

**Files:**
- Create: `artifacts/studio/src/assets/world-land.svg` (generated once, Step 1; not under the generated-code dirs of hard rule #1)
- Create: `artifacts/studio/src/components/auth/CoverShell.tsx`, `artifacts/studio/src/components/auth/cover.css`
- Create: `artifacts/studio/src/pages/auth/SignIn.tsx` (replaces `Login.tsx` + `Register.tsx`)
- Create: `artifacts/studio/src/__tests__/SignIn.test.tsx` (every behavioural case of `Login.test.tsx` + `Register.test.tsx`, moved, plus the cases in Step 6)
- Modify: `artifacts/studio/src/App.tsx`, `artifacts/studio/src/components/auth/TermsConsent.tsx`, `artifacts/studio/src/pages/auth/ForgotPassword.tsx`, `artifacts/studio/src/pages/auth/ResetPassword.tsx`, `artifacts/studio/src/components/AppShell.tsx`, `artifacts/studio/src/pages/legal/LegalPage.tsx`, `artifacts/studio/index.html`
- Modify (tests): `src/__tests__/App.test.tsx`, `AppShell.test.tsx`, `ForgotPassword.test.tsx`, `ResetPassword.test.tsx`, and any other `src/` hit of the Step 7 sweep
- Delete: `src/components/auth/AuthShell.tsx`, `src/pages/auth/Login.tsx`, `src/pages/auth/Register.tsx`, `src/__tests__/Login.test.tsx`, `src/__tests__/Register.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing from DU-6.1–6.3 (independent of autosave; it is in this phase because the user merged the plans).
- Produces for DU-6.5: testids `cover-shell`, `cover-strip`, `mode-login`, `mode-register` (`aria-pressed`), `cover-offered-by`, `cover-help`; kept testids `input-email`, `input-password`, `checkbox-accept-terms`, `link-consent-terms`, `link-consent-privacy`, `link-forgot-password`, `button-login` (log-in mode) / `button-register` (create mode), `alert-login-error`, `alert-register-error`, `alert-password-changed`, `text-password-hint`. Removed testids: `auth-shell`, `auth-cover`, `auth-labs-strip`, `auth-credit`.

- [ ] **Step 1: world map asset.** In an empty temp dir **outside the repo** (nothing is added to any `package.json`):

```bash
cd "$(mktemp -d)" && echo '{"type":"module","private":true}' > package.json
npm i --no-audit --no-fund d3-geo@3.1.1 topojson-client@3.1.0 world-atlas@2.0.2
cat > gen.mjs <<'EOF'
import { readFileSync } from "node:fs";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
const topo = JSON.parse(readFileSync("node_modules/world-atlas/land-110m.json", "utf8"));
const land = feature(topo, topo.objects.land);
const g = land.features[0].geometry;
g.coordinates = g.coordinates.filter((poly) => Math.max(...poly[0].map((c) => c[1])) > -60); // drop Antarctica
// 1 unit = 1 degree: x = lon + 180, y = 90 - lat, so the page places routes without d3.
const projection = geoEquirectangular().scale(180 / Math.PI).translate([180, 90]);
const d = geoPath(projection).digits(1)(land);
process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180"><path d="${d}"/></svg>\n`);
EOF
node gen.mjs > /Users/shubhamkr/nos-du-6.4/artifacts/studio/src/assets/world-land.svg
```

Expected (measured 2026-11-25 when this plan was written): 46 026 bytes, 16 718 gzipped. Paste the command and both measured sizes into the changelog entry.

- [ ] **Step 2: `CoverShell`.** `CoverShell({ children }: { children: ReactNode })` renders, top to bottom, the prototype's `.band` (decorative, `aria-hidden`), `.paper` (grid + washed world + dots + white arcs), `<main>` with `h1` "Network Design Labs", the lede, the `.strip` (`<section aria-label="Sign in or create an account" data-testid="cover-strip">`: the world picture on the left, `children` in `.access` on the right), the `.offered` block (`data-testid="cover-offered-by"`), and the footer band (`data-testid="cover-help"`).
  - **CSS:** `cover.css`, imported by `CoverShell.tsx`, is the prototype's `<style>` ported verbatim except: every rule scoped under `.cover` (the shell's root class), the `.review-bar`/`.tbd` rules dropped, the form controls restyled as in Step 3. Root: `<div className="cover" data-testid="cover-shell">`.
  - **Light only (L6):** `.cover` sets every colour it uses from its own variables (the prototype's `:root` block moved onto `.cover`, plus `color-scheme: light`), and overrides the two theme tokens its children read: `.cover .access { --link: #B8E6CB; --text-muted: #CFDDD0 }`, `.cover .paper { --link: #17661B }`, `.cover .band { --link: #FFFFFF }`. Nothing inside `.cover` may read a theme token that changes under `html.dark` (no shadcn `Input`, `Button`, `Alert`, `Checkbox` inside the shell).
  - **Map, no runtime dependency:** import `worldLand from "@/assets/world-land.svg"` (URL). The page wash is an `<img>` (or CSS `background-image`) inside the existing `svg.bg` layer at `opacity: .55` tinted with the prototype's `--land`; the strip picture is `<svg viewBox="12 12 348 134" preserveAspectRatio="xMidYMid meet">` containing `<image href={worldLand} width=360 height=180>` (the viewBox crops to the prototype's fit box, lon −168…180, lat 78…−56), with the routes, beads and bubbles drawn **in the same 360×180 degree space**: `const at = ([lon, lat]: [number, number]) => [lon + 180, 90 - lat] as const`. Port `places`, the seven route pairs, the bead spacing (`t = .12; t < 1; t += .19`) and the deterministic `rnd` (seed 7) from the prototype script; bead positions come from the quadratic Bézier formula, not `getTotalLength()` (jsdom has no SVG geometry). The white land fill is the image's `filter: invert(1)` or a pre-coloured `fill` in the asset; pick whichever keeps the asset single-sourced and say which in the report.
  - **Motion:** route draw-in only under `@media (prefers-reduced-motion: no-preference)`, exactly as the prototype; `--len` is the Bézier length estimate, rounded up.
  - **Copy, exact:** h1 `Network Design Labs`. Lede: `Hands-on labs for ` + book link + `.` + `<br>` + `<span class="one-line">Pick a model from the book, change it on the map, solve it with a real optimizer, and compare what moved.</span>`. Book link `href="https://www.amazon.com/dp/B078PNRZJB"`, text `Supply Chain Network Design`, ↗ icon, `<span class="sr">(opens in a new tab)</span>`, `target="_blank" rel="noopener noreferrer"` (L9). Offered block: `Offered by` / `Michael Watson` (spaced caps via CSS) / LinkedIn `https://www.linkedin.com/in/michael-watson-07600a1/` (new tab, `aria-label="Michael Watson on LinkedIn (opens in a new tab)"`) and `mailto:michael.watson@northwestern.edu` (`aria-label="Email Michael Watson"`). Footer: `Trouble signing in? ` + `<a href="mailto:shubham.shubham4995@gmail.com">Contact the developer</a>` (L11; the same address `DeveloperCredit.tsx` already publishes).

- [ ] **Step 3: `SignIn` page.** `SignIn({ initialMode }: { initialMode: "login" | "register" })` renders `CoverShell` with the prototype's `.access` content. One component, two modes, both mutation hooks (`useLoginUser`, `useRegisterUser`); mode is local state (no URL change on toggle, L4).

```tsx
const [mode, setMode] = useState(initialMode);
const create = mode === "register";
const mutation = create ? registerUser : loginUser;
// …
<ul className="modes" role="group" aria-label="Choose">
  <li><button type="button" data-testid="mode-login" aria-pressed={!create} onClick={() => setMode("login")}>Log in</button></li>
  <li><button type="button" data-testid="mode-register" aria-pressed={create} onClick={() => setMode("register")}>Create account</button></li>
</ul>
```

  - Fields are native `<input>` with the prototype's underline style, `id="email"` / `id="password"`, the current `autoComplete`, `required`, `maxLength={128}`, and in create mode `minLength={8}` + `autoComplete="new-password"`; labels via `<label htmlFor>`. Keep every existing behaviour of `Login.tsx` / `Register.tsx` unchanged: `acceptTerms: true` in the body, submit gated on the checkbox (`disabled` while unchecked or pending), `setQueryData(getGetCurrentAuthUserQueryKey(), data)` then `navigate("/", { replace: true })` (the race comment moves with it), `?reset=done` → `alert-password-changed` (log-in mode only), errors through `describeWriteError` with the two existing fallback sentences, `text-password-hint` "Password must be at least 8 characters." when 0 < length < 8 in create mode, button labels `Log in` / `Logging in…` and `Create account` / `Creating account…` (L3: was "Register"). Alerts are `<p role="alert">` styled in `cover.css`, not shadcn `Alert`. "Forgot?" is a wouter `<Link href="/forgot-password">`, hidden in create mode.
  - Hint under the form (L5): log-in mode `New here? Choose <strong>Create account</strong> above.`; create mode `Password: at least 8 characters. Free for students and instructors using the book; any email works, no invite code needed.` (verified 2026-11-25: `routes/auth.ts` has no invite or domain gate — re-check with `rg -n -i "invite|domain" artifacts/api-server/src/routes/auth.ts` and stop if one appeared).
  - `TermsConsent` (L7): keep its copy, testids and `{ checked, onCheckedChange }` props; swap the shadcn `Checkbox` for a native `<input type="checkbox" id="accept-terms">` (`onChange={(e) => onCheckedChange(e.target.checked)}`), give both links the ↗ icon and `<span className="sr">(opens in a new tab)</span>`, drop `className: "underline"` (L8: no underline at rest, underline on hover/focus via `cover.css`). It is used only inside the shell after this task (`rg -n TermsConsent artifacts/studio/src` to confirm).

- [ ] **Step 4: routes.** In `App.tsx`:

```tsx
<Route path="/login">{user ? <Redirect to="/" /> : <SignIn initialMode="login" />}</Route>
<Route path="/register">{user ? <Redirect to="/" /> : <SignIn initialMode="register" />}</Route>
…
<Route path="/">{user ? authedOnly(<Landing />, "Network Design Labs", true) : <SignIn initialMode="login" />}</Route>
```

Every other route keeps its `Redirect to="/login"` (one `<Switch>`, every path always a real `Route`: the comment above `Gate` still holds). `ForgotPassword` and `ResetPassword` render inside `CoverShell` (L10): their form replaces the mode toggle with a serif heading in the toggle's style (`Reset your password` / `Set a new password`), same field/button/alert styling, same testids and behaviour.

- [ ] **Step 5: one product name (L2).** Replace the remaining names with `Network Design Labs`: `index.html` `<title>` → `Network Design Labs`; `AppShell.tsx` kicker (both sites) `Optimization Studio by Prof. Michael Watson` → `Offered by Michael Watson` and the fallback wordmark `SCND Optimization Studio` → `Network Design Labs`; `LegalPage.tsx` `Back to Optimization Studio` → `Back to Network Design Labs`. Confirm with `rg -n "Optimization Studio" artifacts/studio/src artifacts/studio/index.html` → no hits outside tests you then update.

- [ ] **Step 6: tests.** `SignIn.test.tsx` carries every case of the two deleted files (rename `Register` button text to `Create account`; drop only the assertions about removed layout: `auth-cover` class, labs strip, "Optimization Studio", "By Prof. Michael Watson", `auth-credit`), plus:
  - `/` signed out renders `SignIn` in log-in mode, not a redirect (`App.test.tsx`: replace "never shows NotFound at / while unauthenticated (redirects toward /login instead)").
  - The toggle: clicking `mode-register` sets `aria-pressed`, swaps the submit to `button-register` "Create account", hides `link-forgot-password`, shows the create hint; and back.
  - `initialMode="register"` starts in create mode (`/register`).
  - The book, LinkedIn, Terms and Privacy links have `target="_blank"`, `rel` containing `noopener`, and the `(opens in a new tab)` text; the email link is `mailto:michael.watson@northwestern.edu`.
  - Light only: render with `document.documentElement.classList.add("dark")`; no element inside `cover-shell` uses a class from shadcn `Input`/`Button`/`Alert` (assert `cover-shell` contains no `[data-slot]`, or the equivalent marker those components carry — check which one they set and name it in the test).
  - Run `SignIn.test.tsx`, `App.test.tsx`, `AppShell.test.tsx`, `ForgotPassword.test.tsx`, `ResetPassword.test.tsx`, `LegalPage` tests if any: all green.

- [ ] **Step 7: sweep and verify.** `rg -n -e auth-shell -e auth-cover -e auth-labs-strip -e auth-credit -e "Optimization Studio" -e "By Prof" -e "No account" -e "Already have an account" -e AuthShell -e "pages/auth/(Login|Register)" artifacts/studio/src` → fix every hit. List every `artifacts/studio/e2e/` hit for DU-6.5 (verified 2026-11-25: `bundle4-auth-landing`, `bundle6-ui-tweaks` :349-371, `design-system` :157-167, `design-upgrade-p1` :132, `design-upgrade-p2` :436/591, `design-upgrade-p5` :282/341/413/445-461/835/869/990, `password-reset`, `terms-consent`). Then look at it: `impeccable shot` of `/`, `/register`, `/forgot-password` at 1440×900, 1024×768, 390×844 against local servers, in light **and** with the OS in dark, and compare with the prototype; attach the shots to the report. Run `impeccable detect` on `CoverShell.tsx`, `cover.css`, `SignIn.tsx`; the `codex-grid-background` finding is accepted (L1: the cover's graph paper), anything else is fixed or reported.

- [ ] **Step 8:** per-task gate, then commit `[DU-6.4] cover sign-in page at signed-out /, /login, /register` with the changelog entry (Step 1 sizes, the screenshot list, the e2e inventory).

---

### Task DU-6.5: Phase 6 real-browser QA and sibling e2e sweep (qa-sdet)

**Role:** qa-sdet (exempt from karpathy/ponytail; if a ponytail ruleset is injected, ignore it and say so), reviewed by a separate `fable` reviewer agent. Debounce, keepalive, `beforeunload` and cross-origin preflight are invisible to jsdom; this task is where they are verified. It also verifies the DU-6.4 cover page in a real browser and rewrites the auth specs it broke.

**Files:**
- Create: `artifacts/studio/e2e/helpers/autosave.ts`
- Create: `artifacts/studio/e2e/design-upgrade-p6.spec.ts`, `artifacts/studio/e2e/cover-sign-in.spec.ts`
- Modify: every sibling spec from DU-6.2's inventory (verified 2026-11-23: `bundle2-fastfollow`, `bundle6-ui-tweaks`, `chen-bands-units-qa`, `delivery-teaching`, `design-upgrade-p4`, `input-map-v2`, `input-tables-qa`, `jade-ch9-workspace-bundle`, `jade-transport-costs`, `jade-two-echelon`, `max-coverage`, `nonjade-servicestats-live-coverage`, `quick-fixes`, `super-model`, `two-echelon`, `workspace-fixups`, `workspace-fixups-2`, `workspace-ux-r1-r9` `.spec.ts`; added 2026-11-25: `wqf-c2-save-beside-filter` (rewrite for OQ7: Super tabs show `super-toolbar-actions` in `data-table-action-slot`, no table shows a Save) and `wqf-c5-base-multiplier` (OQ8: one autosave PATCH per Apply))
- Modify: every auth spec from DU-6.4's inventory (verified 2026-11-25: `bundle4-auth-landing`, `bundle6-ui-tweaks` :349-371, `design-system` :157-167, `design-upgrade-p1` :132, `design-upgrade-p2` :436/591, `design-upgrade-p5` :282/341/413/445-461/835/869/990, `password-reset`, `terms-consent`)
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

- [ ] **Step 2b: auth sibling sweep (DU-6.4).** Replace `auth-shell`/`auth-cover`/`auth-labs-strip`/`auth-credit` and old-copy assertions with the cover testids and copy (DU-6.4 Interfaces, L2–L12); `Register` link clicks become `mode-register`; the Phase 5 "both themes" cases for `/login` and `/register` (`design-upgrade-p5` :869 and the theme-toggle loop at :341) assert the page stays light under `colorScheme: "dark"` and stays legible (L6), instead of asserting dark surfaces. Keep the 11 px floor (`design-upgrade-p1` :132). Run each changed spec green.

- [ ] **Step 3: `design-upgrade-p6.spec.ts`** — every test registers through `/api/auth/register` with `acceptTerms: true` (required since WQF-B, `routes/auth.ts:129`); local servers per `e2e/CLAUDE.md` (api-server on 3001, studio with `API_PROXY_TARGET`, `VITE_POSTHOG_KEY`/`VITE_SENTRY_DSN` dummies), `E2E_BASE_URL` set; each test registers its own user and scenarios; solved state seeded via `helpers/seedSolvedResult.ts`; solve completion via `helpers/solvedAt.ts` (`readSolvedAt`, captured before triggering). Cases:
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
- [ ] **Step 3b: `cover-sign-in.spec.ts`** (no seeded user unless stated; signed out):
  - `/` renders `cover-shell` (no redirect, URL stays `/`), `h1` "Network Design Labs", `<title>` "Network Design Labs"; `/login` and `/register` render the same shell in log-in and create mode.
  - **Round trips from `/`:** toggle to create, tick consent, register a fresh email → lands on the chapter Landing; log out → `/login`; log in from `/` with that user → Landing. Submit stays disabled until consent is ticked, in both modes.
  - The book link, Terms, Privacy and LinkedIn each open a **new page** (`context.waitForEvent("page")`) at the expected URL; the form tab keeps its typed email.
  - **Forgot/reset** render inside `cover-shell` and keep their flows (`password-reset.spec.ts` covers the mail path).
  - **Keyboard:** Tab order is mode toggle → email → Forgot? → password → consent → Terms → Privacy → submit; every stop shows a visible focus ring (screenshot each).
  - **Light only (L6):** under `colorScheme: "dark"` and with `nos:theme-pref` = `dark` in localStorage, the paper background computes to `rgb(234, 243, 232)`; `legibilityScan` finds nothing under its threshold.
  - **Layout:** at 1440, 1024 and 390 widths no horizontal scroll (`scrollWidth <= clientWidth`); at ≥ 860 px the lede's second sentence is one line (its `getClientRects().length === 1`), at 390 px it wraps; no text under 11 px.
  - **Reduced motion:** with `reducedMotion: "reduce"` the route paths have no running animation.
  - Attach full-page screenshots of `/`, `/register`, `/forgot-password` at the three widths, light and dark OS scheme.
- [ ] **Step 4: gates.** `pnpm gate`; `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`; `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`; `python3 artifacts/api-server/src/solver/tests/e2e_journey.py http://localhost:3001 <section>` for every section in its `JOURNEYS` dict. Record each number from the run in the changelog; never estimate.
- [ ] **Step 5:** commit `[DU-6.5] Phase 6 real-browser QA and sibling e2e sweep` with the changelog entry.

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
3. Deploy notes for the user: every Workspace edit now writes to the server about 1 s after it is made, so the server's `scenario updated` PostHog event (`routes/scenarios.ts:323-330`) fires per autosave write instead of per Save click; dashboards counting it will jump. Students who leave a tab with a failed save see the browser's "Leave site?" prompt (OQ1). Signed-out visitors now see the cover sign-in page at `/` instead of a redirect to `/login`, and every page reads "Network Design Labs" (DU-6.4).

## Self-review

- **Spec §5.6 coverage:** serialized queue, one in-flight, monotonic revision ids (6.1); stale responses never overwrite newer local state (D4; 6.1 test, 6.2 ack, 6.5 out-of-order); grammar-complete commit points enqueued after a 1 s debounce with same-field coalescing (D2, 6.1, 6.5); field-scoped writers, geometric edits bump `inputsUpdatedAt`, band edits don't (D8; 6.2 test, 6.5 stale check); `flushAutosave()` awaited by solve, save-as, switch, navigate (D11), unmount best-effort + `pagehide` keepalive (D7); failure retained, `describeWriteError` sentence, Retry re-sends the coalesced payload, solve blocked with the message (D9, D10); header indicator (D13); undo 20 per scenario, Cmd/Ctrl+Z outside text inputs and a header control, undo enqueues a normal write (D14, 6.3); page Save button and `DirtyNavPrompt` removed, Edit-dialog Save → Apply (D12); no new endpoint (D3, D7).
- **Master §A coverage:** DU-6.1/6.2/6.3 deliverables all present, re-sliced into three code tasks plus QA (D1); band edits route through the DU-4.1 route (D8); `Workspace.Integration.test.tsx` 269-306, 622-641, 652-670, 928-932, 1016 rewritten (6.2 Step 10); sibling e2e specs rewritten (6.5); Phase 6 gate runs `e2e_accuracy.py` + `e2e_journey.py` (close-out, D16).
- **Cover page coverage (DU-6.4):** every critique finding maps to a step (task preamble); L1–L12 each land in a step (L1 Step 2/7, L2 Step 5, L3–L5 Step 3, L6 Step 2 + 6.5 Step 3b, L7–L8 Step 3, L9 Step 2, L10 Step 4, L11–L12 Step 2); every removed testid and copy string is swept in `src/` (Step 7) and `e2e/` (6.5 Step 2b); the map ships as a 46 KB static asset with no new dependency (Step 1).
- **WQF drift (re-grounded 2026-11-25):** Save-beside-Filter (OQ7, D12), the Base multiplier writer (OQ8, D20), WatBot as a persisted-row reader (D18), `inputMapSaveWiring.test.ts` (D19), two new sibling specs (6.5).
- **Beyond the spec, now covered:** exports reading the saved row (OQ3); import and history replacement vs pending writes and undo (D6 `reset()`); closing the tab with a failed or oversize pending write (OQ1 `beforeunload`); per-keystroke commits vs the undo budget (OQ2); the Super Model road fetch gate; four Layers-row Saves and three edit dialogs, not one each; three source guards.
- **Type consistency:** `AutosaveField`, `QueuedEdit`, `WriteQueueState`, `WriteQueue`, `createWriteQueue`, `AUTOSAVE_DEBOUNCE_MS` are defined in 6.1 and used unchanged in 6.2/6.3; `queueFor`, `flushAutosave`, `afterFlush`, `autosaveHandlersRef`, `applyUndo`, `handleUndo` are defined in 6.2/6.3 and used only there; testids `autosave-status` (+`data-status`), `button-autosave-retry`, `button-undo` are shared by 6.2/6.3 RTL and the 6.5 helper/spec; `ToolbarActionSlot`, `SUPER_ACTIONS_BESIDE_FILTER_TABS`, `superActions` and testids `data-table-action-slot`, `super-toolbar-actions` are defined in 6.2 (OQ7) and asserted by its RTL and by 6.5's rewrite of `wqf-c2-save-beside-filter.spec.ts`.
