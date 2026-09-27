# Chapter 4 — Two-Step Workflow (Max Coverage → Min Distance)

**Date:** 2026-09-27
**Model:** `max-coverage-us` (Chapter 4, Al's Athletics — Max Coverage; km-canonical per MIG-7)
**Status:** review findings folded (see §12). Rebased onto the migration's terminology; **approval is gated on the migration spec being approved first** (W1), since these names are that spec's to finalise.
**Lands after:** [`2026-09-27-ch4-us-dataset-migration-design.md`](2026-09-27-ch4-us-dataset-migration-design.md). This document is written in that spec's **final** terminology — public id `max-coverage-us`, private wire `modelType` `max_coverage_us`, `maxCoverageInputsSchema`, `solve_max_coverage` — per its MIG-18, which forbids treating old identifiers as "read as" their replacements. §8 is superseded by its MIG-13.
**Wireframes:** [`assets/ch4-wireframes/Ch4 Workflow Wireframes.dc.html`](assets/ch4-wireframes/Ch4%20Workflow%20Wireframes.dc.html) — frames 3a–3f, committed alongside this spec with its `support.js` renderer so it opens standalone. The deck is the normative source for workflow behaviour; §7 records where this design deliberately departs from its *layout*.

---

## 1. Problem

Chapter 4 has two coupled objectives — maximize covered demand, then minimize weighted average distance without giving that coverage back. Today `max-coverage-us` exposes both through one free toggle in the Optimization Parameters tab (`OptimizationParametersTab.tsx:233`, gated at `:306` and `:333`). A student can run a min-distance solve with an arbitrary `coverageFloorDemand`, or none of the chapter's actual reasoning.

Nothing links the two runs. The floor that makes a min-distance solve meaningful — the coverage a max-coverage solve actually achieved — has to be transcribed by hand, and nothing checks it.

This design replaces the free toggle with an ordered two-step workflow in which Step 2's floor is produced by Step 1 and cannot be typed.

## 2. Scope

**In.** The two-step state machine; Step 2 parameter storage; step-aware solve targeting; per-step result reads; the Chapter 4 UI changes needed to drive it; the side-by-side comparison at `2 of 2`; migration of existing Chapter 4 scenarios.

**Out.** Any change to the other five models. Any change to the workspace navigation chrome (**CH4-1**: the deck's fixed `Inputs`/`Outputs` tab strip is *not* adopted — see §7). Any change to `solve.py`, which already implements both objectives and needs no new branch for this design (CLAUDE.md hard rule #6). The prerequisite migration makes one subtractive solver edit of its own (MIG-1/MIG-6); this design adds none. Any change to `scenarios.result`, `scenarios.stale`, or the A7 publication CAS.

## 3. State machine

A step is **solved** when a succeeded `solve_jobs` row exists for it that still belongs to the current configuration (§4.3). Nothing about step state is stored; it is derived on every read.

| State | Step 1 | Step 2 |
|---|---|---|
| `0 of 2` | data and parameters editable; Solve targets Step 1 | viewable; nothing editable; Solve disabled |
| `1 of 2` | frozen | parameters editable; data frozen; floor seeded and locked; Solve targets Step 2 |
| `2 of 2` | frozen | parameters editable; editing after solve marks Step 2 stale until re-solved |

**Frozen** means the value cannot change while the current results stand — not that the field renders disabled. §7's **CH4-16** specifies how the freeze is enforced.

**Transitions.**

- Solve Step 1 at `0 of 2` → `1 of 2`.
- Solve Step 2 at `1 of 2` → `2 of 2`.
- Re-solve Step 2 at `2 of 2` → remains `2 of 2`, stale flag cleared.
- Confirmed edit to any Step 1 field, from `1 of 2` or `2 of 2` → `0 of 2`. **CH4-2**: both results are dropped, not just Step 2's. The deck's frame 6 says only that Step 2 clears; dropping Step 1's result as well is the deliberate extension, and it is what makes solve targeting derivable from state alone.
- Edit to Step 2's parameters at `2 of 2` → remains `2 of 2`, Step 2 flagged stale.
- Edit to `distanceBands` in any state → no transition. Bands are a reporting lens, not a model constraint, and stay editable while Step 1 is frozen (§4.3).

**CH4-3**: staleness exists in exactly one place — Step 2, after Step 2 has solved. Step 1 can never be stale, because the only thing that can change it also clears it.

**CH4-4**: a Step 1 *parameter* change is treated identically to a Step 1 *data* change. Frame 6 names only data edits; a parameter change invalidates the seeded floor the same way, so it takes the same path.

## 4. Data model

### 4.1 Shape

`scenarios.inputs` keeps its current flat Chapter 4 shape as Step 1 and gains exactly two keys:

- `stepEpoch` — integer, minimum 1, defaults to 1. The validity marker for §4.3.
- `step2` — Step 2's own parameters. Absent until first touched.

No new columns on any table. **CH4-5**: Step 2's entity data is *not* stored. §3's freeze makes it unreachable for Step 2's data to differ from Step 1's — at `1 of 2` and `2 of 2` Step 1 is frozen, and the only thing that unfreezes it clears both steps back to `0 of 2`. The deck's "snapshot copied at Step 1 solve" (frame 3b) is therefore an enforced invariant, not a copy. **This invariant is load-bearing: if the freeze rule is ever loosened, §4.1 must be revisited before the UI is.**

### 4.2 Validation

`maxCoverageInputsSchema` (`artifacts/api-server/src/validation/inputs/maxCoverage.ts:95`) must declare both new keys.

It is a plain `z.object`, so Zod strips unknown keys. `autoDistance.ts:541` and the PATCH path both re-parse stored inputs through it, so an undeclared `step2`/`stepEpoch` would be silently dropped on the next save rather than rejected — silent data loss, not a validation error.

`step2` carries only `gap` and `timeLimitSec`. **CH4-6**: `p`, `highServiceDistKm` and `maxDistKm` are inherited from Step 1 and are not editable on Step 2. `highServiceDistKm` must be inherited or the floor constrains demand within a different radius than the one that produced it; `maxDistKm` follows for the same reason; `p` is inherited so that frame 3d's comparison puts two objectives over one network rather than two different networks. `avgServiceDistCapKm` does not exist in min-distance mode.

The stored `objective` stays `"coverage"` — Step 1 is always the coverage step — so a stored blob remains a valid coverage payload under the existing discriminated `superRefine`. **CH4-24 (§4.3) makes that a rule the server enforces**, not merely a convention this design follows.

### 4.3 The epoch

**CH4-7**: a step's result is valid only while the configuration it was solved against is current. "Clearing" a step cannot mean deleting `solve_jobs` rows — that table is history and feeds export — so validity is marked instead.

A **Step 1 field** is any key in `inputs` other than `step2`, `stepEpoch` and `distanceBands`.

**CH4-23 — the epoch is server-authoritative. A client can never set it.** `stepEpoch` lives in the client-writable `inputs` blob, so if the PATCH path merely validated it, a client could submit an *old* epoch and resurrect a historical job whose `input_snapshot` carries that value — presenting a superseded result as current. That is an integrity hole, not a cosmetic one, and it was present in the first draft of this design.

The rule: the PATCH handler **discards any client-supplied `stepEpoch`** and computes the stored value itself, from the persisted row, inside the same locked transaction that writes `inputs`:

- changed keys include a Step 1 field → `stepEpoch = persisted + 1`;
- changed keys are only `step2`, only `distanceBands`, or both → `stepEpoch = persisted`, unchanged.

Computed from the freshly-locked row, never from a client value and never read-modify-write in application code, so two concurrent edits cannot both derive the same next epoch. The existing per-key diff in `routes/scenarios.ts:122-141` (`diffInputKeys`) gains this one further classification.

**CH4-24 — two validators, one boundary.** A stored Chapter 4 payload must never be a min-distance payload. Today `maxCoverageInputsSchema` accepts `objective: z.enum(["coverage", "min_distance"])`, so a client could PATCH `objective: "min_distance"` with any `coverageFloorDemand` it liked and bypass this entire workflow — the exact defect §1 exists to close.

So the one schema splits into two, with opposite rules:

| Validator | Used for | `objective` |
|---|---|---|
| **Persisted Step 1 validator** | every `POST`/`PATCH` of `scenarios.inputs` | `"coverage"` only; `min_distance` is **rejected**, as is any client-supplied `coverageFloorDemand` |
| **Synthesized Step 2 snapshot validator** | the object built at enqueue (§5, CH4-10) and persisted as `input_snapshot` | `"min_distance"` required, with the server-injected floor |

Only the server can produce a payload the second validator accepts. That is what makes the floor un-typeable rather than merely un-shown.

A job counts for its step when its `input_snapshot`'s `stepEpoch` equals the scenario's current `stepEpoch`. Bumping the epoch therefore drops both steps at once, with nothing deleted — that bump *is* the confirm-and-clear.

**CH4-8**: `scenarios.solveInputRevision` is left alone. Reusing it would require exempting Step 2 parameter writes from bumping it, which weakens the A7 publication CAS for in-flight Step 2 jobs. A separate epoch inside `inputs` costs no column and leaves the correctness core untouched.

**Step 2 staleness** is a direct comparison: Step 2 is stale when it is solved and the current `inputs.step2` differs from the `step2` values recorded in that job's `input_snapshot`. `solve_jobs.inputsHash` is *not* used for this — it mixes in `SOLVER_CODE_HASH` (`jobRunner.ts:226`), so every `solve.py` deploy would flip every scenario to stale. It is a cache key, not a staleness signal.

## 5. Solve path

`POST /scenarios/:id/solve` keeps its empty body; the DB row stays the source of truth.

**CH4-9**: the target step is derived inside `enqueueScenarioSolve`'s existing locked transaction (`routes/scenarios.ts:530`), which already re-validates against the freshly locked row. Step 1 unsolved → target Step 1; Step 1 solved → target Step 2. Deriving it under the same lock means a concurrent edit cannot land between the decision and the enqueue.

**CH4-10**: Step 2's `SolveInput.inputs` is synthesized at enqueue and never stored. It is built from the stored blob with `objective` set to `min_distance`, `coverageFloorDemand` set to Step 1's `coveredDemand` read from Step 1's own job result, `avgServiceDistCapKm` dropped, and `step2`'s `gap`/`timeLimitSec` merged over the top. That synthesized object is what gets validated and persisted as `input_snapshot`, so:

- the snapshot's `objective` is what identifies which step a job belongs to;
- the floor the student was shown and the floor the solver was given come from one source and cannot disagree.

`coverageFloorDemand` is declared as an integer (`maxCoverage.ts`, the renamed `chens.ts:108`) and Step 1's `coveredDemand` is emitted as `int(covered)` (`solve.py:1462`), so the injection needs no rounding and cannot fail shape validation.

**CH4-11 — one active job per scenario, enforced at the database, not in the UI.** The first draft disabled the Solve button and stopped there. That is not an enforcement boundary: `enqueueScenarioSolve` locks the scenario row with `.for("update")` and then validates, prechecks and inserts (`jobRunner.ts:366-390`) **without ever checking for an existing job**, and `solve_jobs` carries no unique index over active rows. The lock serialises the two transactions; it does not make the second one refuse. Two tabs, or two direct `POST`s, both enqueue.

That matters more here than in a single-objective model, because the target step is *derived from state* (CH4-9). Two Step 1 enqueues at `0 of 2` race to publish, and whichever lands second decides what `1 of 2` means.

The guard goes **inside the same locked transaction**: if any `solve_jobs` row for this scenario has status `queued` or `running`, refuse. Backed by a partial unique index on `(scenario_id) WHERE status IN ('queued','running')`, so the database itself rejects a second active row even if a future caller forgets the check — the same belt-and-braces posture `lockedModelGuards.test.ts` already applies to route guards.

The refusal is a documented response, not a generic 500: **`409 Conflict`** with the in-flight `jobId`, so the client can attach to the running job rather than retry blindly. `POST /scenarios/:id/solve`'s OpenAPI entry gains that response.

The index is additive and nullable-free, so hard rule #3's NOT NULL protocol does not apply — but it can only be created once no scenario already holds two active rows, which the plan checks before applying.

## 6. Read path and API contract

**CH4-12**: Chapter 4's UI reads neither `scenarios.result` nor `scenarios.stale`; it reads `steps` only. With CH4-20 superseded (§8), the server has no legacy fallback to build and derives `steps` purely from `solve_jobs`. Both columns continue to be written exactly as today — the publication CAS is untouched and the other five models are unaffected — but for a two-step scenario `result` holds whichever step solved last, which is a question nobody asks.

**`GET /scenarios/:id` gains a `steps` object**, present only for `max-coverage-us`. Per step: `solved`, `stale`, `jobId`, and a compact `summary`. `Workspace.tsx` already polls the scenario while a solve runs, so the step toggle, the `N of 2 solved` counter and the output gating refresh with no new polling.

**CH4-13**: the summary is projected in SQL. Frame 3d's comparison needs objective, percent coverage, covered demand, weighted average distance, run time and quality. `solve_jobs.resultSummary` (`jobRunner.ts:1358-1365`) carries only four of those — no covered demand, no coverage percent, no solution status. Rather than change the write path, which would leave every existing row short anyway, the read route extracts the missing fields from the stored envelope with jsonb path expressions, so Postgres returns the small object and never ships two full envelopes to Node. Same posture as `routes/solveHistory.ts`, which already pushes its dedupe into SQL.

With both summaries on the scenario, frame 3d's comparison table renders from data the UI already holds — no extra fetch when it unlocks at `2 of 2`.

**CH4-14**: full envelopes stay lazy. `GET /scenarios/:id/steps/:step/result` returns the complete stored envelope for one step. The output tabs read from it and the toggle refetches, so a 200-customer assignments grid is fetched only when looked at.

`steps` and the new endpoint are additive optional entries in `lib/api-spec/openapi.yaml`. Orval regenerates; spec and generated output land in the same commit (hard rules #1 and #4). Ownership filtering and 404-never-403 apply to the new endpoint unchanged (hard rule #5).

## 7. UI

**CH4-1** (stated in §2): the workspace chrome is unchanged. The deck draws fixed `Inputs`/`Outputs` tabs with an always-present five-sub-tab row; the repo has a left sidebar (`SidebarTree.tsx`) opening closable tabs (`TabBar.tsx`). These are the same information: for Chapter 4 the sidebar already lists exactly the deck's five input entries (`inputEntriesForModel`'s default branch) and, after filtering by the manifest's `outputGrids`, exactly its five output entries (`OUTPUT_ENTRIES`). The deck draws horizontally what the sidebar lists vertically. Adopting the strip would touch all six models' tab wiring in a 4,103-line `Workspace.tsx` and every e2e spec that drives the sidebar, for no semantic gain.

**Header.** The step toggle (`1. Max Coverage` / `2. Min Distance`) and the `N of 2 solved` counter join `UnitToggle` and `Run Optimizer` in the existing `scnd-band` header. **CH4-15**: the toggle is always selectable. At `0 of 2` Step 2 is viewable with a lock icon — the deck locks Step 2's *Solve*, not the act of looking at it (frame 3a).

**Data tabs.** Input Map, Customers, Warehouses and Distances are **not** per-step; by **CH4-5** both steps show identical data. They are editable at `0 of 2` and frozen once Step 1 solves, whichever step the toggle points at. Frame 3b's "snapshot · read-only" banner appears on them whenever Step 1 is solved.

**CH4-16**: the freeze is enforced by intercepting the edit, not by rendering read-only. No table or tab component currently accepts a `readOnly` prop. Fields stay live; the first edit attempt raises the confirm-and-clear dialog; confirming bumps the epoch, drops both results to `0 of 2`, and lets the edit proceed. This matches frame 6 literally and adds no plumbing to table components shared with other chapters. Accepted cost: a student can begin typing before learning there is a consequence.

**Optimization Parameters** is the one genuinely per-step tab.

- Step 1 selected: today's Chapter 4 block, editable at `0 of 2`, frozen after.
- Step 2 selected: `p`, `highServiceDistKm`, `maxDistKm` shown inherited and locked; `avgServiceDistCapKm` absent; `gap` and `timeLimitSec` editable; Coverage Floor showing frame 3a's dashed "— produced by solve" until Step 1 solves, then the seeded value with a lock.

**CH4-17**: the free objective toggle (`chen-objective-toggle`, `OptimizationParametersTab.tsx:233`) is removed for Chapter 4. The step toggle becomes the only way to choose an objective, so two controls cannot disagree and no path reaches a min-distance solve without the floor that gives it meaning.

**Outputs.** Per-step gating replaces the single `hasFreshSolvedRun` flag that currently greys the whole Outputs list (`Workspace.tsx:1416`, consumed at `SidebarTree.tsx:123`). **CH4-18**: per frame 3e the entries stay clickable and an unsolved step's tabs render "Not solved yet — Solve Step 2" rather than being disabled, so a student can see what they would get before committing.

**Solve.** The button reads `Solve Step 1` or `Solve Step 2`, derived from the same rule the server applies (**CH4-9**), so the label cannot disagree with what runs. Auto-navigation to the Output Map on success already exists (`Workspace.tsx:2816`); frame 3c needs only that the toggle is set to the step that just solved.

**Solution Summary** shows the selected step's summary, and at `2 of 2` the side-by-side comparison beneath it (frame 3d).

## 8. Legacy and compatibility

> **SUPERSEDED by the US dataset migration (MIG-13, MIG-14).** That migration deletes every existing Chapter 4 scenario row, because their inputs and results reference China entity ids absent from the US dataset. It lands first (MIG-15), so by the time this design is implemented there are no legacy Chapter 4 scenarios to adopt. **CH4-19** and **CH4-20** below no longer apply and are retained only as the record of what was decided before the dataset swap. The clone and delete paragraphs at the end of this section are unaffected and still hold.

Existing Chapter 4 scenarios are single-objective with one result and no step structure. Measured 2026-09-27: the local dev database holds **0** Chapter 4 scenarios. Production has not been queried.

**CH4-19**: a legacy `coverage` scenario adopts as "Step 1 solved" and can continue into Step 2. A legacy `min_distance` scenario opens read-only with a note that it predates the two-step workflow — its Step 1 never existed, so its floor was never produced by anything.

**CH4-20**: `solve_jobs.input_snapshot` is A1 Class-1 nullable, so a scenario whose jobs predate A1 can recover neither step nor epoch from the job. Those fall back to `scenarios.result` plus the stored `inputs.objective`, which is exactly the adoption rule above, and self-heal onto the job-based path at the next solve. A missing `stepEpoch` — in stored inputs or in a snapshot — reads as 1, so legacy rows match the default epoch rather than being orphaned.

**Clone** copies `inputs` verbatim and no jobs (`routes/scenarios.ts:1914`), so a cloned pair lands at `0 of 2` with the student's parameters preserved. Correct with no special-casing.

**Delete** is unchanged; child `solve_jobs` rows are already removed first.

## 9. Invariants and error handling

**CH4-21 — Step 2 cannot be infeasible.** Step 2 inherits `p`, `highServiceDistKm` and `maxDistKm` from Step 1, drops the average-service-distance cap, and adds `covered demand ≥ floor` where the floor is Step 1's *achieved* covered demand. Step 1's own solution therefore lies inside Step 2's feasible set by construction — including when Step 1 terminated on a gap rather than a proven optimum, since the floor is what Step 1 achieved, not what it might have achieved. An infeasible Step 2 indicates a defect, and is asserted as an invariant rather than handled as a user-facing outcome.

**Solve failures** need nothing new: a failed job is not a succeeded job, so the step stays unsolved and `SolveDialog`'s existing `errorCode`/`errorMessage` path reports it. The failure contract is unchanged — execution failures are failed jobs, never cached, never published.

## 10. Testing

**API (vitest/supertest).** Step derivation inside the locked transaction, for each of the three states. Epoch-bump classification: a Step 1 field bumps, a `step2`-only save does not, a `distanceBands`-only save does not. The synthesized Step 2 input, including floor injection from Step 1's job result. The `steps` projection, including a step with no job. Ownership returning 404 for the new endpoint.

**Security and concurrency regressions, required (W2/W3).** These cover holes the first draft left open, so they are not optional coverage:

- **Forged epoch** — a PATCH carrying a `stepEpoch` lower than the persisted one leaves the stored epoch untouched and does not revive the superseded job (CH4-23).
- **Direct min-distance PATCH** — a PATCH with `objective: "min_distance"`, with or without a `coverageFloorDemand`, is rejected by the persisted Step 1 validator (CH4-24).
- **Concurrent edit** — two overlapping Step 1 PATCHes yield two distinct consecutive epochs, never the same value twice.
- **Concurrent double-POST** — two simultaneous solve requests produce exactly one `queued`/`running` job; the loser gets `409` with the in-flight `jobId` (CH4-11).
- **Re-solve after the guard** — a stale Step 2 at `2 of 2` still re-solves normally once no job is active, proving the guard does not wedge the ordinary path.

**Validation (vitest).** `stepEpoch`/`step2` round-trip through `maxCoverageInputsSchema` without being stripped; a legacy payload lacking both parses with `stepEpoch` defaulting to 1; `step2` rejects `p`/`highServiceDistKm`/`maxDistKm`.

**Solver (pytest).** **CH4-21** asserted against the existing Chapter 4 goldens: seed a min-distance solve with the coverage solve's achieved covered demand and assert it solves rather than reporting infeasible.

**Frontend (vitest/RTL).** The §3 state table's rendering, the step toggle, per-step output gating, the confirm-and-clear interception, and the comparison table appearing only at `2 of 2`.

**Sacred and unchanged.** `e2e_accuracy.py` must pass unmodified (hard rule #2). Verified 2026-09-27: it has no Chapter 4 section — its five sections are `pmedian`, `transport`, `brazil`, `jade`, `cross`, and the model id appears nowhere in it — so neither this design nor the dataset migration touches it.

**Goldens come from the migration, not from here.** The Chapter 4 defaults and goldens this design tests against are the ones the US dataset migration establishes (MIG-9, MIG-10) — `highServiceDistKm` 700, `maxDistKm` 5500, `avgServiceDistCapKm` 1000. This design changes no default and regenerates no golden; it must leave `highServiceDistKm` and `avgServiceDistCapKm` unequal, per the standing warning in `defaultInputsForModel` (`Workspace.tsx:134-140`).

**CH4-22 — sibling e2e specs are rewritten in the same bundle.** `artifacts/studio/e2e/max-coverage.spec.ts` step 4 switches to min-distance mode through the UI objective toggle that **CH4-17** removes, so it is a known breakage. `chen-bands-units-qa.spec.ts` and `tab-coverage.spec.ts` are audited for the same dependency, and any spec asserting on `chen-objective-toggle` or on the Outputs-disabled-until-solved behaviour is rewritten to the new UI. Per CLAUDE.md's recurring `spec_gap` rule this happens before merge, not after — the unit gate does not run Playwright and will not catch it.

## 11. Decision index

Defined in place; this index is a pointer, not a restatement.

| Id | Subject | Section |
|---|---|---|
| CH4-1 | Workspace chrome unchanged | §2, §7 |
| CH4-2 | A Step 1 edit clears both steps | §3 |
| CH4-3 | Staleness exists only on Step 2 | §3 |
| CH4-4 | Step 1 parameter edits behave as data edits | §3 |
| CH4-5 | Step 2's entity data is not stored | §4.1 |
| CH4-6 | Step 2 owns only `gap` and `timeLimitSec` | §4.2 |
| CH4-7 | Step validity marked by `stepEpoch` | §4.3 |
| CH4-8 | `solveInputRevision` left untouched | §4.3 |
| CH4-9 | Target step derived inside the enqueue lock | §5 |
| CH4-10 | Step 2's solve input synthesized, not stored | §5 |
| CH4-11 | One active job per scenario, enforced in the DB; `409` on conflict | §5 |
| CH4-12 | Chapter 4 ignores `scenarios.result`/`stale` | §6 |
| CH4-13 | Per-step summary projected in SQL | §6 |
| CH4-14 | Full envelopes fetched lazily per step | §6 |
| CH4-15 | Step toggle always selectable | §7 |
| CH4-16 | Freeze enforced by intercepting the edit | §7 |
| CH4-17 | Free objective toggle removed | §7 |
| CH4-18 | Unsolved output tabs show an empty state | §7 |
| CH4-19 | ~~Legacy coverage adopts; min_distance read-only~~ — superseded by MIG-13 | §8 |
| CH4-20 | ~~Null `input_snapshot` falls back to `scenarios.result`~~ — superseded by MIG-13 | §8 |
| CH4-21 | Step 2 cannot be infeasible | §9 |
| CH4-22 | `max-coverage.spec.ts` rewritten in the same bundle | §10 |
| CH4-23 | `stepEpoch` is server-authoritative; client values discarded | §4.3 |
| CH4-24 | Two validators: persisted rejects `min_distance`, synthesized requires it | §4.3 |

---

## 12. Review resolution — 2026-09-27

Three blockers. **All three verified against source; all three held.** Two of them were real holes in this design, not presentation problems.

| Finding | Verified how | Landed in |
|---|---|---|
| **W1** — the document must be textually rebased, not "read as" | The prerequisite's MIG-18 forbids the construct this header used | Rebased throughout to `max-coverage-us` / `max_coverage_us` / `maxCoverageInputsSchema` / `solve_max_coverage`; status now gates approval on the migration's |
| **W2** — `stepEpoch` was client-writable, and a stored min-distance payload was accepted | `stepEpoch` sits in the client-writable `inputs` blob; `chens.ts:97` accepts `objective: z.enum(["coverage","min_distance"])` today | §4.3 CH4-23 (server-authoritative epoch) and CH4-24 (two validators); §10 regressions |
| **W3** — one-in-flight was UI-only | `enqueueScenarioSolve` (`jobRunner.ts:366-390`) locks the row then inserts with no active-job check; `solve_jobs` has no unique index over active rows | §5 CH4-11 rewritten — in-transaction guard, partial unique index, documented `409` |

**W2 is the one worth dwelling on.** The first draft put a security-relevant validity marker inside a blob the client writes, and separately relied on "the stored objective stays coverage" as a convention rather than a constraint. Either alone is exploitable: forge an old `stepEpoch` and a superseded job presents as current; or PATCH `objective: "min_distance"` with a floor of your choosing and skip the workflow entirely — the precise thing §1 says this design exists to prevent. Both are now enforced server-side with named regressions.

**W3 is the same class of mistake at a different layer.** CH4-11 originally disabled a button and called it a rule. It matters more here than in a single-objective model because the target step is *derived from state*: two Step 1 enqueues at `0 of 2` race, and the loser decides what `1 of 2` means.

**On W1's sequencing.** The rebase is done now rather than deferred, because leaving the "read as" construct in place is exactly what MIG-18 prohibits. The names used are the ones already decided for the migration; if re-review changes any of them, both specs change together. Approval of this document still follows the migration's, as W1 requires.
