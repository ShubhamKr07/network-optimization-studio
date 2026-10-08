# Chapter 4 model interface overhaul — design

**Date:** 2026-10-09
**Branch:** `ch4-model-upgrade` (base `main` @ `3343277`)
**Model:** `max-coverage-us` (Chapter 4, "AL's Athletics — Max Coverage")
**Approach:** overhaul the existing model in place (no new model id)

## 1. What changes and why

Chapter 4 today runs a **two-step workflow**: the student solves Step 1 (maximize
covered demand under an average-distance cap), the server captures that solve's
achieved `coveredDemand`, and Step 2 (minimize demand-weighted distance subject to
that captured floor) runs against it. The floor is server-produced and un-typeable
by design; editing any Step 1 field freezes and invalidates both results via a
monotonic `stepEpoch`.

That machinery is removed. The new workflow:

- **One** Optimization Parameters form holding every solve parameter.
- **One** solve per scenario. The objective is *derived* from the parameter values,
  not chosen by a toggle and not sequenced across two solves.
- `coverageFloorDemand` becomes **user-authored** — the inverse of today's contract.
- The model becomes **miles-canonical**, like every other model in the repo.

### Decisions taken (all four confirmed with the user before writing)

| # | Decision | Consequence |
|---|---|---|
| 1 | The average-service-distance cap **binds in both objectives** | One added constraint in `solve.py`; existing min-distance goldens must be recomputed |
| 2 | **Full miles-canonical**, including field renames | Repo's only km model disappears; ~41 files touch the renamed fields |
| 3 | Existing scenarios: **migrate `inputs`, clear `result`** | No user work lost; no result envelope is hand-converted |
| 4 | No in-scenario result comparison; **use the existing Compare page** | `StepComparisonTable` is deleted outright |

Plus one decision made while writing, called out here rather than left implicit:
the form renders an **explicit read-only line stating which model the current
values will run, and why** (user-selected option in decision 4's question).

### Measured blast radius

- **28** files reference the step machinery (`stepEpoch`, `maxCoverageSteps`,
  `useMaxCoverageSteps`, `StepToggle`, `StepComparisonTable`,
  `getScenarioStepResult`, `ScenarioSteps`).
- **41** files reference the three `...Km` input fields.
- Union ≈ 55 files; over half are tests.
- `guardStep1Edit` alone has **17** call sites in `Workspace.tsx`.

## 2. The contract

### 2.1 Units and dataset

`solvers/max-coverage-us/manifest.json`: `distanceUnit: "km"` → `"mi"`.

The dataset is **generated**, not authored: `scripts/src/build-max-coverage-dataset.ts:35`
builds it by multiplying p-median-us's integer-mile matrix by `MI2KM = 1.609344`.
Dropping that multiply regenerates the matrix as p-median-us's exact integers.

Verified, not assumed:

- `max-coverage-us` `ALN,C1` = `601.894656` km; `601.894656 / 1.609344` = `374.0`,
  which is p-median-us's `1,1` = `374`. The conversion is exact in both directions.
- Longest warehouse→customer pair: `5180.478336` km = **3219 mi** exactly.
  `maxDistMi` must stay above 3219 or customers become unassignable from every
  warehouse — the same trap the `ch4-mig-4` comment records for the old China-era
  `maxDistKm` of 5000.
- The base matrix contains genuine `0` values (co-located pairs) in both the km and
  mile forms. Not a new condition; no handling changes.

`solvers/max-coverage-us/dataset/version.json`'s `sha256` is regenerated with
`computeSha256()` — **never by hand** (registration point 2; a hand-written hash
makes every solve throw inside `readVersion()` before the solver even spawns).
`lib/dataset-schema/src/maxCoverageDataset.test.ts:23` asserts the pairs are "in km"
in its test name and must be retitled.

### 2.2 Inputs schema

`artifacts/api-server/src/validation/inputs/maxCoverage.ts`:

```
p                     int 1..26          required
highServiceDistMi     number > 0         required
maxDistMi             number > 0         required
avgServiceDistCapMi   number > 0         required   ← was coverage-mode-only
coverageFloorDemand   int >= 0           required   ← was min_distance-mode-only
gap                   number >= 0        required
timeLimitSec          int >= 1           required
capacityMode          "none"             defaulted
distanceBands         number[] > 0, strictly ascending, min 1   (reporting lens)
objective             "coverage" | "min_distance"  — SERVER-DERIVED
warehouseOverrides / customerOverrides / addedWarehouses /
addedCustomers / distanceOverrides                 — unchanged apart from the rename
```

Retained: `highServiceDistMi < maxDistMi` (`superRefine`), the
`distanceOverrides` pair-uniqueness refinement, the `distanceBands`
strictly-ascending refinement, and the legacy `distanceBands` derivation in the
`.transform` (now `[highServiceDistMi, maxDistMi]`).

Deleted: both objective-discriminated `superRefine` branches (the fields they
guarded are now unconditionally required), `stepEpoch`, `step2`,
`step2ParamsSchema`.

`.strict()` disappears with `step2ParamsSchema`; the top-level schema stays
non-strict, matching every sibling validator.

### 2.3 Objective derivation

One function, server-side, the single authority:

```
coverageFloorDemand === 0  →  objective = "coverage"      (Model 1)
coverageFloorDemand  >  0  →  objective = "min_distance"  (Model 2)
```

`objective` **stays stored on `inputs`**, written by the server on every write
exactly where `stepEpoch` was written (`services/scenarioInputWrite.ts:64-65`),
discarding whatever the client sent. It cannot simply be dropped: the derivation
is also an output-rendering input. `lib/units/src/objective.ts:objectiveDimension()`
keys this model's unit semantics off it — `"percent"` for coverage,
`"demand-distance"` for min-distance — and that is what makes Solution Summary,
`ObjectiveBar` and the Compare page render the objective with the right dimension
and the right unit conversion. `solve.py` echoes it into `details.objective`, and
`jobRunner.ts:1417` reads that echo into `resultSummary.objectiveMode`.

**The write guard inverts.** `services/scenarioInputWrite.ts`'s
`assertNoServerOwnedStepFields` currently refuses a client-supplied
`coverageFloorDemand` and a client-supplied `objective: "min_distance"`. Under the
new contract the floor is exactly what the student types, and `objective` is the
only server-owned field. The guard is rewritten (and renamed —
`assertNoServerOwnedFields`) to refuse **`objective`** when present, and to accept
`coverageFloorDemand`. Keeping it operating on the **raw** request body before Zod
runs is load-bearing for the same reason it was before: these validators are
non-strict, so an unknown key is stripped rather than refused, and silently
discarding a client-sent `objective` would report success while ignoring it.

### 2.4 Solver

`artifacts/api-server/src/solver/solve.py:solve_max_coverage`. The average-distance
cap hoists out of the objective branch. That is the entire mathematical change —
one constraint moves, no new code path, satisfying hard rule 6 (business rules
enter as bounds and coefficients, never as new `if`/`else` branches).

```python
mode = "coverage" if inp["coverageFloorDemand"] == 0 else "min_distance"
prob = LpProblem("max_coverage", LpMaximize if mode == "coverage" else LpMinimize)

# applies in BOTH modes now
prob += lpSum(adj[w, c] * dem[c] * a[w, c] for w in cand for c in custs) \
        <= inp["avgServiceDistCapMi"] * total

if mode == "coverage":
    prob += lpSum(hsp[w, c] * dem[c] * a[w, c] for w in cand for c in custs)
else:
    prob += lpSum(adj[w, c] * dem[c] * a[w, c] for w in cand for c in custs)
    prob += lpSum(hsp[w, c] * dem[c] * a[w, c] for w in cand for c in custs) \
            >= inp["coverageFloorDemand"]
```

Everything else in the function is unchanged except the three field renames and
the `details` echo keys (`highServiceDistMi` / `maxDistMi` / `avgServiceDistCapMi`).

`mode` is derived here from the floor, **not** read from `inp["objective"]`, and
`details.objective` echoes this locally-derived `mode` rather than the input field.
That matters: if the echo forwarded `inp["objective"]` while the math branched on
the floor, a disagreement between them would be invisible — the result envelope
would be labelled one model and computed as the other. Echoing the derived value
makes `details.objective` a report of what actually ran. The server's stored
`objective` (§2.3) is then a second application of the same rule, for the DB and the
UI, and §5.2's agreement test is what holds the two applications together.

**Infeasibility messages must name the binding constraint.** Both the floor and the
cap can now fail, together or separately, and `_envelope("infeasible", ...)`'s
single `infeasibilityReason` string is the only thing a student sees. CBC reports
"Infeasible" without attributing it, so attribution is computed **pre-solve** from
the data. Both checks below are *necessary* conditions — each is cheap and certain
when it fires, and neither is complete:

- **Cap.** Compute the unconstrained lower bound on weighted-average distance:
  assign every active customer to its nearest active warehouse ignoring both `p` and
  `maxDistMi`, i.e. `sum(demand[c] * min_w adj[w,c]) / total`. No feasible solution
  can beat this, so `avgServiceDistCapMi` below it is definitely infeasible → name
  the cap. `O(|W| × |C|)` on a dict already built.
- **Floor.** `coverageFloorDemand` above the demand coverable within
  `highServiceDistMi` is definitely infeasible → name the floor. This check already
  exists as a precheck rule (§3.3) and is reused rather than reimplemented.
- **Neither fires** → the infeasibility is a genuine interaction of `p`,
  `maxDistMi`, the cap and the floor that no cheap bound detects. Keep today's
  generic "No feasible assignment under the constraints", and say that both the
  coverage floor and the average-distance cap are candidates — an honest "one of
  these two" beats naming the wrong one.

Deliberately **not** attempted: an exact "smallest feasible cap for this `p`". That
is itself an optimization problem, so computing it to produce an error message
would mean solving a second ILP to explain the first one's failure.

### 2.5 Defaults

Round teaching numbers, not exact conversions. The goldens are recomputed either
way (§5), so exactness buys nothing and 434.96 mi is a worse number to teach with
than 450.

| Field | today (km) | exact (mi) | **new (mi)** |
|---|---|---|---|
| `highServiceDist` | 700 | 434.96 | **450** |
| `maxDist` | 5500 | 3417.54 | **3400** |
| `avgServiceDistCap` | 1000 | 621.37 | **650** |
| `distanceBands` | 700 / 1400 / 2800 / 5500 | — | **450 / 900 / 1800 / 3400** |
| `coverageFloorDemand` | absent | — | **0** (opens in Model 1) |
| `p` | 3 | — | 3 (unchanged) |

`maxDist` 3400 > 3219, so every customer is assignable.
`highServiceDist` (450) ≠ `avgServiceDistCap` (650) — `Workspace.test.tsx` carries a
guard test asserting these two are never made equal, because equal values tighten
the default solve to a different open set.

Changed in both places that hold them, which must not drift:
`artifacts/studio/src/pages/Workspace.tsx:146-177` (`defaultInputsForModel`) and
`solvers/max-coverage-us/manifest.json`'s `inputsSchema`.

## 3. Server changes

### 3.0 Registration points touched

`model-integration-precheck.md` is **mandatory** for work that registers a model,
entity or output grid. This change registers nothing new — the model id is
unchanged — but it rewrites the manifest, the validator, the payload builder and
the form, so six of the nineteen points are in scope anyway. Audit all nineteen
before claiming done; these six are known to be affected.

The list is **nineteen**, not ten (`model-integration-precheck.md:34`, after the
`delivery-teaching-us` integration found nine the original ten missed).
`CLAUDE.md:16`'s index row still says "the 10 registration points" and is stale —
**correct it in this branch**, because a reader who trusts it stops auditing nine
points early, and roughly half of the nineteen fail silently.

| Pt | Surface | What this change does to it |
|---|---|---|
| 2 | `dataset/version.json` sha256 | Regenerated via `computeSha256()` (§2.1) |
| 6 | `SolveInput` union + `buildPayload()` in `solver/pmedian.ts` | Four wire fields renamed (§3.3) |
| 11 | `objectiveDimension()` in `lib/units/src/objective.ts` | Keyed off the now-derived `objective`; unchanged in form, but §2.3 is why `objective` must stay stored |
| 12 | `inputEntriesForModel` case | **Gap closed** — gets an explicit case (§4.1) |
| 16 | `pMax` | **Gap closed, and the precheck's own entry is stale** — see §4.3 |
| 18 | `crossModelStepContract.test.ts`'s `NON_STEP_MODELS` | **Deleted** — see §3.1 |

Points 3, 4, 5, 7, 8, 19 (the id registries) are untouched: the model id does not
change, so no id set gains or loses a member. `modelIdSetEquality.test.ts` is the
automated guard for that claim and must stay green.

### 3.1 Deleted outright

| Path | Lines | Note |
|---|---|---|
| `services/maxCoverageSteps.ts` | 363 | Epoch authority, step summaries, the batch Compare-list query |
| `services/__tests__/maxCoverageSteps.test.ts` | — | |
| `services/__tests__/maxCoverageStepsBatch.test.ts` | — | |
| `solver/__tests__/maxCoverageStepWorkflow.test.ts` | — | Known load-flake; disappears with its subject |
| `__tests__/crossModelStepContract.test.ts` | — | Registration point 18. Asserts non-Ch4 models have no `steps` — vacuous once nothing has them. See below |
| `__tests__/maxCoverageWriteGuard.test.ts` | — | Replaced by a new test for the inverted guard (§5) |

`maxCoverageStepWorkflow` and `crossModelStepContract` are both on the known
load-flake list in the root `CLAUDE.md`; deleting them removes two entries from
that list, which must be edited in the same commit (see §5.4).

**Deleting `crossModelStepContract.test.ts` retires registration point 18**, and
that is a deliberate loss, not a cleanup. Its `NON_STEP_MODELS` array is the one
registration point that fails *loud* by design: every model other than
`max-coverage-us` must be listed in it, so a newly-added model is refused by a red
suite rather than slipping through silently. Once `max-coverage-us` has no steps,
the array is "every model" and the guard asserts nothing — keeping it would be a
test that cannot fail, which this repo has an explicit gotcha about. So it goes,
**and point 18 is struck from `model-integration-precheck.md` in the same commit**;
leaving it listed would send the next model's integration hunting for a file that
no longer exists. The nineteen becomes eighteen, and `CLAUDE.md:16`'s index row is
corrected to that number (§3.0), not to the stale ten.

### 3.2 API contract (`lib/api-spec/openapi.yaml`)

Remove `GET /scenarios/{scenarioId}/steps/{step}/result` (line 380), the
`ScenarioSteps` / `ScenarioStepState` / `ScenarioStepSummary` schemas (1671-1706),
and `Scenario.steps` (1639-1640). Re-run Orval; `lib/api-zod` and
`lib/api-client-react` regenerated output lands **in the same commit** as the spec
change (hard rule 1 and 4).

### 3.3 Modified

- **`routes/scenarios.ts`** — drop the `loadScenarioSteps` call on the single-scenario
  read (line 270), the `loadScenarioStepsBatch` call and its `ch4Rows` filter on the
  list route (200-205), the whole `steps/:step/result` handler (279-300), and the
  `initialInputsForInsert` wrapping on insert and clone (239, 2021). The
  `MAX_COVERAGE_DATASET` import and the distance-stub path (1265) are unrelated to
  steps and stay.
- **`services/scenarioInputWrite.ts`** — replace the `stepEpoch` computation
  (64-65) with the `objective` derivation; delete `changed.delete("stepEpoch")`
  (85); delete the `initialInputsForInsert` / `isStep1Key` re-exports (113);
  rewrite the guard per §2.3. The `isBandsOnlyChange` non-geometric-write rule is
  untouched and still correct.
  Note `objective` must be excluded from the `changed` set the same way `stepEpoch`
  was — it is derived from `coverageFloorDemand`, so it can never change *alone*,
  but leaving it in means a bands-only save that happens to be the first write
  after a migration would be misclassified as geometric.
- **`solver/jobRunner.ts`** — delete the entire
  `if (scenario.modelId === MAX_COVERAGE_MODEL_ID)` block (419-447) inside the
  enqueue transaction, including its Step-1-job lookup and the
  `synthesizeStep2Inputs` call. `solveInputs` becomes `validation.data` for every
  model with no special case. The `objectiveMode` read at 1417 is unchanged.
- **`solver/pmedian.ts`** — rename the four wire fields passed to `solve.py`
  (166-169). `objective` (164) still travels.
- **`services/precheck.ts`** — rename the fields in the two Ch4 rules (309, 324)
  and change both message strings from `km` to `mi` (313, 330). The
  `coverageFloorDemand` rule becomes reachable far more often: it used to apply
  only to a server-synthesized floor that was by construction achievable, and now
  guards a number a student typed. It is the floor half of §2.4's attribution.
- **`services/autoDistance.ts`** — delete `R_KM`, `MIN_DISTANCE_KM`,
  `haversineKm`, `clampKm` (101-113); `fillEstimatedMaxCoverageDistances` (513-560)
  switches to the shared `clampMi(haversineMiles(a, b) * MAX_COVERAGE_CIRCUITY)`,
  the same shape `p-median-brazil` already uses.
  `MAX_COVERAGE_CIRCUITY` stays `1.17`. This preserves today's estimates: a fill is
  currently `haversineKm × 1.17` and becomes `haversineMiles × 1.17`, and
  `6371 / 1.609344 = 3958.76` against `R_MI = 3959` is a **0.0061%** difference.
  Rounding moves from 2 dp (km) to 1 dp (mi) with `clampMi`'s `MIN_DISTANCE_MI`
  floor, matching every other model.
- **`solver/tests/benchmark/`** — `translate.py:201-213` renames; `corpus.py:36-37`'s
  "coverage requires `avgServiceDistCapKm`" rule becomes "every case requires the
  cap and the floor"; `corpus/manifest.json`'s Ch4 strata (lines ~105424+) get the
  renamed fields and an explicit floor. This manifest is hand-authored declared
  weights, not a generated artifact, and `test_corpus.py` is pytest-discovered
  under `tests/`, so it is inside the verification gate.

### 3.4 Migration

New one-off script, `scripts/src/migrate-ch4-to-miles.ts`, following
`scripts/src/migrate-delete-chens-scenarios.ts`'s existing shape (same argv/dry-run
conventions, same `DATABASE_URL` handling).

Per `scenarios` row with `model_id = 'max-coverage-us'`:

```
inputs.highServiceDistKm    -> inputs.highServiceDistMi   = round(v / 1.609344)
inputs.maxDistKm            -> inputs.maxDistMi           = round(v / 1.609344)
inputs.avgServiceDistCapKm  -> inputs.avgServiceDistCapMi = round(v / 1.609344)
inputs.distanceBands         = sorted(unique(round(b / 1.609344)))   // > 0
inputs.coverageFloorDemand   = existing value, else 0
inputs.objective             = derived from the floor (§2.3)
inputs.stepEpoch, inputs.step2  -> deleted
scenarios.result             -> NULL
scenarios.solved_at          -> NULL
result_cache rows for this model -> deleted
solve_jobs rows              -> left in place as history
```

Three details that are decisions, not mechanics:

1. **A missing `avgServiceDistCapKm` is possible** on a row last saved in
   min-distance mode (the old schema made it coverage-only, and
   `synthesizeStep2Inputs` destructured it away). Such a row gets the new default,
   650 mi. Without this the migrated row fails validation on its next read.
2. **Rounding can collapse a `distanceBands` pair** into a duplicate, which the
   strictly-ascending refinement rejects. Dedupe after rounding, and drop any
   value that rounds to 0.
3. **The script must be idempotent.** Re-running it on an already-migrated row must
   be a no-op, keyed on the presence of `highServiceDistMi`. This repo already has
   a non-idempotent runbook that silently double-converts
   (`docs/ops/timestamptz-migration.md`); that is the failure mode to not repeat.

Local dev DB holds **5** `max-coverage-us` scenarios. The production count is
**unknown and unmeasurable from this session** — `query_render_postgres` connects
from `35.227.164.209`, which is not on `nos-postgres`'s IP allowlist. Measuring it
needs `psql` from an allowlisted machine. Production is not touched by this branch;
running the migration there is a separate, separately-approved step with its own
dry-run read first.

## 4. Frontend changes

### 4.1 Chapter 3 parity is mostly *regained*, not built

Chapter 4 already renders the p-median tab set — Input Map, Customers, Warehouses,
Distances, Optimization Parameters — and its `capabilities.outputGrids` are
byte-identical to Chapter 3's. The tab *contents* therefore need no new work.

But it renders that set **by falling through**: `inputEntriesForModel`
(`Workspace.tsx:1245-1322`) has no `max-coverage-us` case, so it lands on the
`case "p-median-brazil": case "p-median-us": default:` tail. That is registration
point 12, and the precheck is explicit that the omission is a silent defect, not a
tidiness issue: *"omission **grants** an editable dataset surface a model may not
actually support."* `delivery-teaching-us` writes its case out in full for exactly
this reason, and its own comment says so — the switch's tail being *close to* what
the model wants makes writing the case out **more** important, not less, because
nothing then distinguishes "inherited by accident" from "chosen".

So this change adds an explicit `case "max-coverage-us":` returning the same five
entries it renders today. Zero behavioural change, and the next model's
integration can no longer silently inherit Chapter 4's surface or vice versa.
`Workspace.TabCoverage.test.tsx` is where the per-model assertion belongs.

What makes the chapter behave unlike Chapter 3 is `stepState.isMaxCoverage` gating
behaviour all over `Workspace.tsx`. Removing two-step restores four things with no
new code:

| Line | Today for Ch4 | After |
|---|---|---|
| 1904-1932 | Outputs read from the per-step endpoint via `useGetScenarioStepResult` | Outputs read `scenario.result`, like every model |
| 4220 | `timing={undefined}` — solve timing hidden | Solve timing shown |
| 4529 | Result-history stepper suppressed | Stepper available |
| 1587-1644 | `guardStep1Edit` freezes 17 edit paths behind a confirm dialog | Edits save normally |

`activeOutputResult` / `activeOutputInputs` / `activeOutputReady` collapse to the
non-Ch4 branch they already have. `keepOutputsClickable` (4610) and the
`hasFreshSolvedRun` conditions (4091, 4250) lose their Ch4 special case.

### 4.2 Deleted

`components/workspace/StepToggle.tsx` (65 lines),
`components/workspace/StepComparisonTable.tsx` (59),
`hooks/useMaxCoverageSteps.ts` (41), and their three test files
(`StepToggle.test.tsx`, `StepComparisonTable.test.tsx`, plus the step cases in
`Workspace.DisplayedInputs.test.tsx`). `e2e/ch4-two-step.spec.ts` is deleted whole.

In `Workspace.tsx`: `selectedStep` / `setSelectedStep`, the snap-to-target effect
(1545-1567, 3231), `guardStep1Edit` / `confirmStep1Edit` / `pendingStep1Inputs` and
their confirm dialog (4718-4810), `step2FromInputs` /
`step2GapFromInputs` / `step2TimeLimitSecFromInputs` (291-303), the
`useGetScenarioStepResult` import and query (19-20, 1912-1918), the `<StepToggle>`
render (4643-4649), the `<StepComparisonTable>` render (4362-4372), and the
`solveLabel` indirection at 4577 (becomes the literal `"Run Optimizer"`).

### 4.3 The form

`components/workspace/tabs/OptimizationParametersTab.tsx`. The `step` /
`stepEditable` / `step2Gap` / `step2TimeLimitSec` / `coverageFloorFromStep1` props
and the whole `step === 2` panel (396-443) are deleted, as are the four
`(step ?? 1) === 1` guards (266, 312, 451) — those existed only to keep Step 1's
block and Step 2's panel mutually exclusive. `step2Gap` / `step2TimeLimitSec` leave
the `OptimizationParametersField` union. `SolveDialog.tsx:170`'s hardcoded
`step={1}` goes with them.

The Chapter 4 block (today gated on `objective != null`) is re-gated on
`highServiceDistMi != null`, because `objective` is no longer a client-side concept
and must not be what makes the model's own fields appear. It renders, in one
column, in this order:

```
Warehouses to open (P)          slider + quick-select   [existing, unguarded]
High-service distance (mi)      ChenDistanceInput
Max distance (mi)               ChenDistanceInput
Avg service distance cap (mi)   ChenDistanceInput       [now unconditional]
Coverage floor (demand)         Input, integer >= 0     [now editable]
  -> derived-model line                                 [new]
Optimization gap (%)            Input                   [existing]
Max time (seconds)              Input                   [existing]
Distance bands                  BandChipEditor          [existing]
```

**`pMax` — do NOT add a second declaration.** Registration point 16 says `pMax`
lives at two independent Workspace mounts and warns that updating only one is the
likely failure. That entry is **stale for this model**, and following it literally
breaks the build. `CH4UX-6` deliberately reduced Chapter 4 to exactly **one**
declaration — `Workspace.tsx:3384`'s hoisted `optimizationParamsBaseProps` — and
deleted the `<SolveDialog>` arm as provably dead, because Chapter 4 is the only
model that supplies a `paramsSlot`, so the dialog's built-in P slider never mounts
for it. `Workspace.test.tsx:2827` then locks that in with a **source-text grep**:

```js
const caps = [...src.matchAll(/modelId === "max-coverage-us" \? (\d+)/g)].map(m => m[1]);
```

It asserts exactly one match, equal to `26`. Re-adding `modelId === "max-coverage-us" ? 26`
at the dialog mount — the instinctive move when rebuilding this form, and what
point 16 as written tells you to do — produces a second match and turns that test
red. `Workspace.tsx:4728-4738` and `:4752-4759` both carry comments warning that
even *quoting* the expression in a comment counts as a second declaration.

So: `pMax` stays at the single site, value `26`, and §4.3's rewrite must not
introduce another. The dialog's 26 cap is guarded only *behaviourally*
(`Workspace.test.tsx:2792-2799`, asserting `aria-valuemax="26"` on
`solve-dialog-slider-p-value`), and that test is the sole evidence for it — it
must not be weakened while the form is rebuilt. Point 16's line references
(`:3589`, `:4426`) no longer resolve; correct them in the precheck doc alongside
striking point 18.

`avgServiceDistCapMi` loses its `objective === "coverage"` wrapper (366-391) and
renders always. `coverageFloorDemand` changes from the read-only locked display it
is in the Step 2 panel to a plain editable integer input; it is **not** a distance,
so it does not go through `ChenDistanceInput` / `useDistanceDraft` and is never
unit-converted.

The three distance fields keep `ChenDistanceInput` and its
commit-on-blur-or-Enter draft behaviour unchanged. Two existing gotchas continue to
apply to them and to any test that touches them: a `.fill()` alone never reaches
the write path, and committing via blur is more reliable than `Enter` when the
commit opens a dialog.

**The derived-model line** is read-only, sits directly under the floor input, and
states both the model and the reason:

```
floor = 0:
  Model 1 — maximize demand within 450 mi,
  holding average distance at or under 650 mi

floor = 50,000,000:
  Model 2 — minimize average distance,
  covering at least 50,000,000 demand within 450 mi
```

It reads the same derivation function as the server, exported from a shared
location so there is one rule and not two — the alternative (a UI copy of the
rule) is how the Solve button's label and the step that actually ran came to be
able to disagree, which `useMaxCoverageSteps`'s own comment documents as the thing
it was written to prevent.

### 4.4 Validation surfacing

Every one of `highServiceDistMi`, `maxDistMi`, `avgServiceDistCapMi` is now
required `> 0` in both models, so a blank or zero is a 422 with a field path. There
is deliberately **no** state in which one of these fields is visible but inert —
that was the reason decision 1 went the way it did. The 422's field path must be
surfaced against the offending input, not as a bare toast, since all three fields
now fail the same way.

## 5. Testing

Run order and gate command are the repo's standing ones:

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

plus `pnpm e2e:gate`, and — because this change touches `solve.py` — the two
standalone scripts the pytest gate does **not** run:
`python3 e2e_accuracy.py` and `python3 e2e_journey.py <BASE_URL> <section>`.

`e2e_accuracy.py` has **no** Chapter 4 section (verified: zero `max-coverage`
references). Its expected count stays **99/99** and hard rule 2 is not engaged by
this work. Chapter 4's accuracy checks live in `test_max_coverage.py`.

### 5.1 Goldens must be recomputed, by running

`test_max_coverage.py` currently asserts, in km: `coveredDemand == 53385024`,
`coveragePct ≈ 68.4192`, `weightedAvgDistance ≈ 635.13` (coverage) and
`≈ 624.33` with `objective ≈ 48714263031.75` (min-distance), open set
`{DAL, LA, PIT}`.

Every one of these changes, for two independent reasons, and **no golden is
hand-derived** — each is read off a real `solve.py` invocation and recorded with the
command that produced it:

1. **Units.** The demand-weighted objective is linear in distance, so it scales by
   `1/1.609344`; `weightedAvgDistance` likewise. `coveredDemand` and `coveragePct`
   are not distances and do not scale.
2. **Thresholds.** The new defaults are round numbers, not exact conversions
   (450 mi vs 434.96), so the high-service and max-distance **predicates flip for
   some pairs**. The open set and the covered demand can legitimately differ, and
   asserting a mechanically-divided value would be asserting a number no solve ever
   produced.

One golden is worth predicting in advance, as a check on the §2.4 reasoning: the
existing min-distance case runs with **no** cap today and achieves a weighted
average of 624.33 km. A cap of 1000 km is therefore non-binding for it — the
optimum already satisfies it — so adding the cap at a loose value must leave that
solution unchanged. If it changes, the cap was tighter than intended and the test
is reporting a real modelling error, not a units artifact. That is the one place a
recomputed golden can be sanity-checked against the old one rather than simply
replaced.

### 5.2 New tests

- **`solve.py` / `test_max_coverage.py`** — the cap binds in min-distance mode:
  a cap tight enough to exclude the unconstrained optimum produces a *different,
  feasible* solution with a weighted average at or under the cap, and a cap below
  the achievable minimum produces `infeasible` naming the cap. Mirror of the
  existing floor-infeasible case at line 81.
- **Derivation agreement** — the server's derived `objective` and `solve.py`'s own
  `mode` agree for `floor = 0` and `floor > 0`. This is the test that keeps the rule
  being in two places from becoming two rules.
- **Write guard inversion** (`__tests__/maxCoverageWriteGuard.test.ts`, rewritten) —
  a client-supplied `coverageFloorDemand` is **accepted** and persisted; a
  client-supplied `objective` is **refused**; and the refusal is proved to operate
  on the raw body by sending `objective` alongside a valid payload and asserting the
  persisted row carries the *derived* value, not the sent one.
- **Migration** — a fixture row in each shape the migration must handle: a
  coverage-mode row, a min-distance row with no `avgServiceDistCapKm`, a row whose
  rounded bands collide, and an already-migrated row (idempotency). Per this repo's
  own gotcha, at least one of these runs against **real Postgres** through the actual
  writer rather than a hand-built in-memory fixture.
- **Unit canonicality** — `manifest.distanceUnit === "mi"` asserted directly, not
  only via a round-trip. A round-trip test passes in any environment where the two
  units coincidentally agree, which is exactly how the `timestamptz` class of bug
  stayed green in CI while live in production.
- **Derived-model line** — an RTL test that the line names Model 1 at `floor = 0`
  and Model 2 at `floor > 0`, reading the shared derivation. This is plain text in
  the DOM, so jsdom can genuinely fail it; it is not one of the CSS-dependent
  assertions that cannot fail.

### 5.3 Sibling e2e specs must be rewritten before merge

This is the repo's recurring `spec_gap` class, and this change is a textbook
trigger: it deletes testids (`step2-*`, `step2-parameters`, `step2-inherited`,
`step2-floor-placeholder`, `step2-floor-value`, the whole StepToggle surface),
deletes a visible-string contract (`Solve Step 1` / `Solve Step 2`), and renames
every Ch4 distance field. Specs that hard-code the old shape and are **not**
`@flaky`-tagged, so a full `e2e:gate` breaks even with every unit suite green:

- `e2e/ch4-two-step.spec.ts` — deleted
- `e2e/max-coverage.spec.ts` — rewritten for the single form and the new defaults
- `e2e/chen-bands-units-qa.spec.ts` — km→mi labels and values
- `e2e/nonjade-servicestats-live-coverage.spec.ts` — Ch4 field names
- `e2e/truthful-status.spec.ts`, `e2e/workspace-ux-r1-r9.spec.ts`,
  `e2e/bundle4-auth-landing.spec.ts` — grep each for a changed testid or string

Running the suite locally needs the documented recipe, including
`VITE_POSTHOG_KEY` and `VITE_SENTRY_DSN` dummies — without them
`posthog-analytics.spec.ts` and `sentry-capture.spec.ts` fail environmentally and
look like real breakage. Read `e2e/report/results.json`'s `stats.unexpected` and
`stats.flaky`, not the console tail, which folds retried failures away silently.

### 5.4 Known flakes, not regressions

Do not re-chase these; re-run in isolation first. Read the current list in
`CLAUDE.md` rather than a remembered copy of it — it gained four entries on
2026-10-05 and is edited as new flakes are observed.

Members of that list this work actually touches: `routes`, `resultEnvelope`,
`jobRunner`, `importMultiModelRoundTrip`, `crossModelStepContract`,
`maxCoverageStepWorkflow`. `precheck` is **not** on the list, so a `precheck`
failure here is a real finding and must be treated as one. Also expect
`test_transport.py::TestSingleSource` (hardcoded 60 s timeout, unrelated to this
diff — confirm with `git diff <base>..HEAD -- .../solve.py | grep transport`), and
studio vitest under concurrent load from another session's run
(`ps aux | grep "[v]itest" | grep -vc "zsh -c"` must read 0 before trusting a full
studio result as a gate).

Several of these live under `src/solver/__tests__/`, not `src/__tests__/` —
`maxCoverageStepWorkflow` among them. Search both before editing anything by path.

**The list itself must be edited in this branch.** §3.1 deletes
`maxCoverageStepWorkflow` and `crossModelStepContract` outright, so both come off
the flake list in the same commit that deletes them — otherwise the next session
hunts for two files that no longer exist, which is the exact failure the list's own
note warns about.

## 6. Risks and judgement calls

1. **Round-number defaults change the default solve.** Deliberate, and the reason
   §5.1 forbids hand-derived goldens. The alternative — exact conversions —
   preserves the current solution but teaches with 434.96 mi.
2. **The cap can now make Model 2 infeasible.** It is a new way for a student's
   scenario to fail, which is why §2.4 requires the infeasibility message to
   attribute the cause. A generic "no feasible assignment" here would be a
   usability regression even though the math is right.
3. **`avgServiceDistCapMi` becoming required is a breaking API change** for any
   client sending the old min-distance shape. Scope is this repo's own frontend
   plus the migration, both updated here. No external consumer exists.
4. **A pre-existing inconsistency is surfaced, not fixed.** After conversion
   Chapter 3 and Chapter 4 share a byte-identical distance matrix, yet their
   estimators disagree: `p-median-us` fills added-entity distances at circuity `1`,
   Chapter 4 at `1.17`. Keeping `1.17` is what preserves Chapter 4's current
   estimates (§3.3), so this branch keeps it and does **not** reconcile the two.
   Recorded here as a real question for a later task, with a named owner file
   (`services/autoDistance.ts`), not silently normalised.
5. **Deleting `maxCoverageSteps.ts` discards carefully-reasoned work** — the epoch
   authority and the batch Compare-list query, with its own proof that resolving
   the epoch check in Node is equivalent to resolving it in SQL. Both exist solely
   to serve two-step and have no other consumer, verified by the 28-file reference
   sweep.

## 6a. Review history

The spec was reviewed adversarially by Codex (`/codex:rescue`) before the
implementation plan was written. That run **failed partway** on an OpenAI usage
limit, having produced exactly one finding — but the finding was real and
cascaded into four spec gaps, all folded in above:

> the current precheck defines 19 registration points, not ten

Verified at `model-integration-precheck.md:34`. Consequences, each traced from that
one claim: `CLAUDE.md:16`'s stale "10 registration points" row (§3.0), the
fallthrough `inputEntriesForModel` case (point 12, §4.1), the `computeSha256()`
requirement (point 2, §2.1), and the deletion of a registration point (point 18,
§3.1). Chasing point 16 additionally found that the precheck's **own entry is
stale** and that following it literally breaks `Workspace.test.tsx:2827`'s
source-text grep (§4.3) — a trap neither the spec nor the precheck would have
caught during implementation.

**The review is incomplete.** Codex's own last message said it was treating all 19
points as the audit surface and had not yet finished that sweep; it had read the
spec, the manifests, `maxCoverage.ts`, `scenarioInputWrite.ts`, `openapi.yaml`,
`jobRunner.ts`, `autoDistance.ts`, `ObjectiveBar.tsx` and `ServiceStatsTab.tsx`
when it was cut off. Anything it had queued beyond the registration-point thread is
unknown. A second pass should rerun it after the limit resets and should be
considered a prerequisite to merge, not to planning.

## 7. Out of scope

- Touching `e2e_accuracy.py` (no Chapter 4 section; hard rule 2 not engaged).
- `artifacts/studio/e2e/labs.spec.ts` (stale pre-D0, excluded from `e2e:gate`).
- Reconciling the circuity inconsistency in risk 4.
- Running the migration against production. That is a separate step needing its own
  approval, a dry run, and `psql` from an allowlisted host.
- Any deploy. Note for when it is approved: this change touches **`solvers/**`**, so
  `nos-api` needs redeploying as well as `nos-studio` — `solvers/*/manifest.json` is
  read at boot by `registry/modelRegistry.ts` and baked into the API image. Do not
  conclude "frontend-only" from a pathspec over `artifacts/api-server lib/db
  lib/api-spec`; that exact mistake shipped a stale model name once already.
