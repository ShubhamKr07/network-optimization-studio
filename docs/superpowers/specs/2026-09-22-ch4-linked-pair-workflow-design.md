# Chapter 4 linked-pair workflow — design

**Date:** 2026-09-22
**Branch:** `ch4-ux`
**Model:** `chens-cosmetics-cn` (Chapter 4 — Chen's Cosmetics)
**Source:** `Ch4 Workflow Wireframes.dc.html` (frames 1a–1e)

---

## 1. Problem

Chapter 4 is the only model with two coupled objectives behind one toggle:

- **`coverage`** — maximize demand within `highServiceDistKm`, subject to an average-distance cap
  (`avgServiceDistCapKm`).
- **`min_distance`** — minimize demand-weighted distance, subject to a coverage floor
  (`coverageFloorDemand`).

The textbook teaches these as a **two-step sequence**, not two independent options: run Max Cover
first, read the covered demand it achieves, then run Min Distance with that figure as a hard floor to
clean up the assignment without losing coverage. The value that connects the two steps —
`details.coveredDemand` — is produced by step 1 and consumed by step 2.

Today the app exposes them as two unrelated modes on one scenario. A student can pick `min_distance`
with no prior coverage solve and type any floor they like, which is not the lab. Nothing in the UI
expresses that step 2 depends on step 1, and nothing compares the two results.

This design makes the dependency structural: a min-distance scenario exists only as a **follow-up**
spawned from a solved coverage scenario, with its floor seeded from that solve and locked.

## 2. Scope

In scope: `chens-cosmetics-cn` only. Schema, API, and UI changes needed for the linked pair, the
parameter-field rework, the sidebar tree, the spawn banner, and the gated Solution Summary.

Out of scope: solver changes (`solve.py` is untouched); other models; the general
PATCH-during-solve race (§9).

## 3. Decisions

Each decision below was taken explicitly during brainstorming. Where one deviates from a standing
repo rule, that is called out.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Chapter-4-only, gated on `modelId`** rather than a manifest capability | Product owner's explicit call. **Deviates from CLAUDE.md's "`capabilities` is the only correct per-model gate — never a `modelId === "..."` string comparison"** and from recurring bug class #1. Recorded as a known, accepted deviation; see §10. |
| D2 | Min-distance is reachable **only** by spawning a follow-up; its floor is always locked | The floor's only correct value is the parent's `coveredDemand`. An editable floor is an invitation to break the lab's premise. |
| D3 | Enforced in **API validation**, not UI-only | A UI-only rule leaves the orphan state reachable by any direct call, and the DB then holds rows the UI has no valid way to render. |
| D4 | Cloning a **follow-up** clones the **pair** — parent and child, linked to each other | Clone does a raw insert with no validation today; copying a child alone would mint the exact orphan D3 forbids. |
| D5 | Cloning a **coverage parent** copies the parent **only** | Clone sets `result: null`, so the copy has no solve to justify a child's floor. A copied child would be invalid on arrival. |
| D6 | Re-seed happens **server-side, in the solve-completion transaction** | Parent result and child floor can never disagree — the same guarantee `resultRunId` already provides. Bumping the child's `inputsUpdatedAt` makes the existing X1.1 staleness guard report `stale` with no new state. |
| D7 | Solution Summary is **strictly gated** — placeholder until both halves are solved | Faithful to wireframe 1d. A solved coverage scenario shows no standalone summary for this model. |
| D8 | Pre-existing orphan min-distance rows are **deleted** | Destructive against live data, so it runs as a counted, explicitly-authorized one-off — never a blind `DELETE`. Local dev count at time of writing: **0**. Production count to be taken and shown before anything executes. |
| D9 | The auto pair view **replaces** manual compare for Chen | Two states, one story. Other models keep `CostSummaryTab`'s manual toggle list untouched. |
| D10 | The gate's CTA **spawns and opens** the child; it never auto-solves | Every other solve in the app is explicitly confirmed; a CTA that silently starts a CBC job would be the only exception. |
| D11 | **1:1** parent-to-child, enforced by a unique partial index | Makes "the pair" well-defined for the gate, and the re-seed touches exactly one row. |
| D12 | Deleting a parent **cascades** to the child, behind a confirm | An orphan can then never come into existence. The confirm exists because one click would otherwise destroy two scenarios, one of them possibly solved. |
| D13 | `avgServiceDistCapKm` is **hidden** in min-distance mode | `solve.py:1242-1247` never reads it in that branch. Rendering it editable would let a student set a constraint the solve ignores, with no error. |
| D14 | `coverageFloorDemand` **stays visible** in coverage mode, read-only and derived | Unlike D13's field it is load-bearing: it is exactly what will seed the follow-up. Shows `— produced by solve` before solving, the actual value after. |
| D15 | Parent re-solve is **blocked (422)** while the child has a job in flight, with an explaining dialog | Chosen over discarding the child's result at completion. Keeps the job runner's write path unchanged; the student is told why rather than silently losing a solve. |
| D16 | Min-distance objective renders at **full 2dp with comma grouping** | The solver emits 2dp (D22) and the frozen golden is `123834216789.27`. The wireframe's integer rendering would differ from the value the tests assert. |

## 4. Data model

### 4.1 Schema

`lib/db/src/schema/scenarios.ts`:

```ts
parentScenarioId: integer("parent_scenario_id")
  .references((): AnyPgColumn => scenariosTable.id, { onDelete: "cascade" }),
```

The explicit `: AnyPgColumn` return annotation is required for the self-reference, for the same
reason it is already required on `resultRunId`.

Plus a unique partial index:

```sql
CREATE UNIQUE INDEX "UQ_scenarios_parent_scenario_id"
  ON scenarios (parent_scenario_id)
  WHERE parent_scenario_id IS NOT NULL;
```

This is what enforces D11 — cardinality comes from Postgres, not from application code.

The column is **nullable**, so hard rule #3's add-nullable → backfill → enforce-NOT-NULL protocol
does not apply. A plain `pnpm --filter @workspace/db push` is correct.

### 4.2 Staleness is free

```ts
isStale(row) = row.result != null && row.inputsUpdatedAt > row.solvedAt!   // scenarios.ts:115
```

D6's re-seed writes the child's floor and bumps `inputsUpdatedAt`. A solved child therefore becomes
stale automatically — frame 9's behavior with no new stored state, consistent with X1.1's
"derived, never stored" contract.

Note: `isStale` is currently duplicated at `scenarios.ts:114` and `distanceBands.ts:84`. This design
does not refactor that, but the re-seed makes the definition load-bearing in a third context; if the
two copies ever drift, the pair's staleness silently drifts with them.

### 4.3 Floor source of truth

`result.details.coveredDemand` (`solve.py:1284`) — an exact integer sum. `details.coveragePct` sits
beside it but is lossy; the floor must never be derived from the percentage.

## 5. API contract

Changes to `lib/api-spec/openapi.yaml`, with Orval regeneration committed in the same commit
(hard rule #1).

### 5.1 `Scenario` additions

- `parentScenarioId: integer | null` — read-only.
- `followUpScenarioId: integer | null` — derived from the reverse lookup. Present so the client can
  resolve a parent's child for the gate without an N+1.

  Derived, never stored — the unique partial index (§4.1) guarantees at most one. On `GET
  /scenarios` it must be resolved with **one** pass over the already-fetched result set (every child
  is itself a row in that set, so the reverse map is built in memory), not a per-row query — or the
  field re-introduces on the server the N+1 it exists to spare the client.

### 5.2 `POST /scenarios/{id}/follow-up`

Creates the min-distance follow-up. **Empty body — the parent row is the source of truth**, matching
how `/scenarios/{id}/solve` already works.

Child is created as:

| Field | Value |
|---|---|
| `name` | `"<parent.name> — Min Distance"` |
| `modelId` | parent's |
| `userId` | parent's |
| `inputs` | parent's `inputs`, with `objective: "min_distance"`, `coverageFloorDemand` = parent's `result.details.coveredDemand`, and `avgServiceDistCapKm` removed |
| `result` | `null` |
| `parentScenarioId` | parent's id |

Returns **201** with the created scenario. Returns **422** if the parent is not Chen, is not
`coverage`, is unsolved, is stale, or already has a follow-up. Returns **404** if the parent does not
exist *or is not owned by the caller* (hard rule #5 — never 403, to avoid ID enumeration).

Scenario names are not unique today and this design does not make them so. `"<parent> — Min
Distance"` may collide with a hand-named scenario; this is harmless because the link is by id.

### 5.3 `POST /scenarios/{id}/clone`

Signature unchanged; behavior changes underneath per D4/D5.

- Source is a **follow-up**: create a copy of the parent and a copy of the child, with the child copy
  pointing at the parent copy. Both copies have `result: null`.
- Source is a **coverage parent**: copy the parent only. No child is created.

Because both copies have `result: null`, a cloned child's floor no longer corresponds to any solve on
its new parent. It is retained as-is and the pair reads as gated until the new parent is solved,
which re-seeds it via D6. This is why the clone path skips the seed invariants — see §6.1.

### 5.4 Solve route

`POST /scenarios/{id}/solve` on a Chen coverage parent returns **422** with
`code: "follow_up_solve_in_flight"` when its follow-up has a job in `queued` or `running` status
(D15).

## 6. Enforcement

### 6.1 Where the rules live

`chensInputsSchema` (`validation/inputs/chens.ts:95`) is a **pure Zod schema over `inputs` alone** —
no row, no parent, no DB. It therefore cannot express the parent rules. The split is:

**Pure Zod (shape only):**
- `coverageFloorDemand` required iff `objective === "min_distance"`
- `avgServiceDistCapKm` rejected when `objective === "min_distance"` (D13)

**Route-level guard** — new `assertChenPairInvariants(inputs, parentRow | null, { checkSeed })`,
the single chokepoint, called from `POST /scenarios`, `PATCH /scenarios/:id`,
`POST /scenarios/:id/clone`, and `POST /scenarios/:id/follow-up`.

*Structural invariants* — always enforced, at every call site:

- `objective === "min_distance"` ⇒ `parentScenarioId != null`
- parent exists **and is owned by the same user** → else 404
- parent is `chens-cosmetics-cn` and is `coverage`
- `objective === "coverage"` ⇒ `parentScenarioId` is null (a coverage scenario is never a child)

*Seed invariants* — enforced only when `checkSeed` is true, i.e. on `POST /scenarios`,
`PATCH /scenarios/:id`, and `POST /:id/follow-up`:

- parent has a `result` and is not stale
- `coverageFloorDemand === parent.result.details.coveredDemand`

**`POST /:id/clone` passes `checkSeed: false`.** This is required, not an oversight: cloning a pair
produces a parent copy with `result: null` (§5.3), so the seed invariants are unsatisfiable by
construction there. The floor a cloned child carries is inherited data awaiting re-seed, not a claim
about its new parent's solve — and D6 re-seeds it the moment that parent is solved. The structural
invariants still hold, so no orphan is reachable through clone.

Two layers must stay in sync — this is recurring bug class #2 by construction, and is the main
maintenance cost of D3. The guard is deliberately a single named function called from four sites
rather than four inline checks, so the sync surface is one file.

### 6.2 Lifecycle

| Action | Behavior |
|---|---|
| `POST /scenarios` (Chen) | coverage only; `min_distance` → 422 `min_distance_requires_parent` |
| `POST /:id/follow-up` | as §5.2 |
| `PATCH` child | `objective` and `coverageFloorDemand` are immutable → 422. All other inputs editable |
| `PATCH` parent | unrestricted; a change that invalidates the child's floor is resolved on the parent's next solve via D6. If the parent is never re-solved it is simply stale, and §7.5's stale-counts-as-unsolved rule keeps the pair gated — so a wrong floor can never reach a side-by-side |
| clone follow-up | copies the pair (D4) |
| clone coverage | parent only (D5) |
| delete parent | cascade to child, behind a UI confirm (D12) |
| delete child | plain delete; parent untouched, re-spawnable |
| parent solve completes | in the same transaction: if Chen + coverage + has child → write child's floor, bump `inputsUpdatedAt` → child goes stale (D6) |

### 6.3 Cascade vs. `solve_jobs`

`solve_jobs.scenarioId` references `scenarios` with **no `onDelete`** (default NO ACTION), which is
why the existing delete route removes a scenario's jobs before the scenario itself. A DB-level
`ON DELETE CASCADE` from parent → child will therefore **fail whenever the child has any solve job**.

Resolution: extend the delete route to remove, in order — the child's jobs, the child, the parent's
jobs, the parent. Chosen over adding `onDelete: "cascade"` to `solve_jobs.scenarioId`, because that
would change deletion semantics for every model to fix a Chapter-4-local problem.

With the route deleting the child explicitly, the DB-level `ON DELETE CASCADE` from §4.1 never
actually fires on this path. It is retained as a backstop for any direct-SQL deletion (the orphan
purge, a support fix), where it correctly prevents a parent from being removed while leaving a child
pointing at nothing.

### 6.4 Orphan purge (D8)

A counted, explicitly-authorized one-off:

1. Count orphans: Chen scenarios with `inputs->>'objective' = 'min_distance'` and
   `parent_scenario_id IS NULL`.
2. Show the count and the affected rows to a human.
3. Execute only on explicit approval, deleting each row's `solve_jobs` first.

Local dev count at time of writing: **0**. Production count not yet taken.

## 7. UI

### 7.1 Optimization Parameters tab (wireframe 1a)

Replaces the `objective === "coverage"` / `=== "min_distance"` blocks at
`OptimizationParametersTab.tsx:306` and `:333`.

| Field | Coverage | Min-distance |
|---|---|---|
| High-service distance | editable | editable |
| Max distance | editable | editable |
| Avg service distance cap | editable | **hidden** (D13) |
| Coverage floor | **read-only derived** — `— produced by solve` before solving, `result.details.coveredDemand` after (D14) | **🔒 locked**, seeded from parent |

The derived floor in coverage mode is display-only: never posted, never part of `inputs`. It reads
off the scenario's own `result`.

**The objective toggle becomes a step indicator, not a control.** Both segments render; neither is
clickable. The inactive one carries the tooltip *"Min-distance runs as a follow-up — solve this
scenario first, then create the follow-up."* `onObjectiveModeChange` loses its Chen call site.

### 7.2 SolveDialog (wireframe 1c)

Mirrors the same field matrix, plus the existing Gap and Max-time fields. For a follow-up it gains
the subtitle `"<name> · Step 2 of linked pair"` and shows the floor locked. Chen's `pMax` is already
25 and is unchanged.

### 7.3 Sidebar tree (wireframe 1b)

`SidebarTree.tsx:81` is a flat `scenarios.map` today. It becomes a two-level tree — depth is exactly
2 by construction, since 1:1 and a child can never itself be a parent:

```
Baseline                        [MAX COVER ✓]
  └ 🔗 Baseline — Min Distance  [PENDING]
Cap tweak
```

Grouping is a client-side partition on `parentScenarioId`; no extra fetch. Badges: parent solved →
`MAX COVER ✓`; child unsolved → `PENDING`; child solved → `MIN DIST ✓`; either stale → the existing
stale badge takes precedence. Rename / clone / delete stay available on both levels, with the
parent's delete routed through the D12 confirm.

### 7.4 Spawn banner (wireframe 1b)

Renders when **all** of: model is Chen, `objective === "coverage"`, `result != null`, **not stale**,
`followUpScenarioId == null`.

The not-stale condition is load-bearing: a stale parent's `coveredDemand` no longer matches its
inputs, so seeding a floor from it would bake in a wrong number.

Content per 1b — coverage %, the covered-demand figure, the "clean it up" line, and
`Create min-distance follow-up →` with a caption stating what the click does. Action is
`POST /scenarios/:id/follow-up`, then navigate to the child.

It sits in the Workspace content header so it is visible from any tab.

### 7.5 Gated Solution Summary (wireframe 1d)

`CostSummaryTab` gains a Chen-only branch with exactly two states. The manual scenario toggle list is
hidden for Chen (D9).

**Gated state** — progress dots, "N of 2 models solved", and one context-dependent CTA:

| Situation | CTA |
|---|---|
| parent unsolved | `Run Max Cover →` — opens SolveDialog on the parent |
| parent solved, no child | `Run Min Distance →` — spawns, navigates, does not auto-solve (D10) |
| child exists, unsolved | `Run Min Distance →` — navigates to the child |

**Stale counts as unsolved for the gate.** A stale result was computed against inputs that no longer
hold, so including it in a side-by-side would compare two different problems. This also means a
parent re-solve drops the pair back to the gated state until the child re-runs — frame 9's intent,
expressed through the gate rather than as a separate warning.

**Pair state** — both solved and both non-stale. Rendered identically on the parent's tab and the
child's tab. Rows: Objective, Percent Coverage, Demand within High Service Dist, High Service
Distance, Floor Constraint (`—` for the parent, `131,645,389 ⇐ seeded` for the child), Weighted avg.
distance, Run time, Quality, Solver.

Both cross-mode rows come free: `details.coveragePct` and `details.coveredDemand` are written in
**both** modes (`solve.py:1284`), so no solver change is needed.

Numbers use comma grouping, never scientific notation. The min-distance objective renders at full 2dp
per D16.

### 7.6 Dialog-rendering hazard

The D12 delete confirm and the D15 in-flight dialog must each be **rendered in every return branch
that can trigger them**, not only in the component's main return. This repo has already shipped that
exact bug: `Studio.tsx`'s create-scenario dialog lived only in the main return, so the
zero-scenario early-return path could call `setShowCreateDialog(true)` with no Dialog mounted
anywhere — silent, and it blocked every brand-new account from creating a scenario at all.

`Workspace.tsx` is 4078 lines and is a designated single-writer shared file. It needs one owner in
the task waving, not parallel editors.

## 8. Error handling

Distinguishable codes alongside the existing `{error}` payload, so the client can tell one 422 from
another:

| Code | Status | Trigger |
|---|---|---|
| `min_distance_requires_parent` | 422 | min-distance inputs with no parent |
| `parent_not_solved` | 422 | parent has no `result` |
| `parent_stale` | 422 | parent's `result` predates its `inputs` |
| `floor_mismatch` | 422 | floor ≠ parent's `coveredDemand` |
| `follow_up_already_exists` | 422 | parent already has a child (D11) |
| `follow_up_solve_in_flight` | 422 | parent re-solve blocked by the child's running job (D15) |
| `objective_immutable` | 422 | PATCH tries to change a child's objective |
| `floor_immutable` | 422 | PATCH tries to change a child's floor |
| — | 404 | parent does not exist **or is owned by another user** (hard rule #5) |

The solver wrapper contract is untouched: it still never throws. An infeasible floor — e.g. the
student lowers `p` on the child until nothing clears the floor — returns
`{status: "error", infeasibilityReason: ...}` and the gate simply stays gated.

## 9. Known gaps, accepted

1. **The general PATCH-during-solve race is not fixed.** `solve_jobs.inputsHash` records what a job
   was dispatched with, but nothing compares it against the scenario's current inputs at completion.
   For every model, a PATCH landing mid-solve produces a result computed against superseded inputs
   whose `solvedAt` is newer than `inputsUpdatedAt` — so `isStale` reports **false** on a result that
   is actually wrong. D15 closes the Chapter-4 path into this race by refusing the parent re-solve;
   it does not close the race itself. Logged as open debt.
2. `isStale` remains duplicated (§4.2).
3. D1's `modelId` gating is a deliberate deviation (§10).

## 10. Deviation from CLAUDE.md

CLAUDE.md states: *"`capabilities` in the manifest is the only correct per-model gate — never a
`modelId === "..."` string comparison"*, and lists per-model gates extended for one model and
forgotten for its sibling as recurring bug class #1 — the most-hit class in this repo, 5+
occurrences.

D1 gates this feature on `modelId === "chens-cosmetics-cn"` at the product owner's explicit
direction. The risk this accepts: if a second two-objective model is ever added, every gate in this
design is a site that will silently fall through to the wrong behavior rather than erroring.

Mitigation within the accepted decision: confine the model check to **one exported predicate**
(e.g. `isLinkedPairModel(modelId)`) called from every gate site, so converting to a capability later
is a one-line change rather than a hunt. The deviation is recorded here so it is discoverable.

## 11. Testing

- **API** (vitest + supertest): each guard rule → its code; follow-up creation; clone-the-pair;
  clone-parent-only; cascade delete with jobs present; re-seed fires on parent solve; in-flight 422.
  Call `resetLoginRateLimiterForTests()` in `beforeEach` — this file will log in well past the
  10-per-minute cap.
- **Zod unit**: floor required iff min-distance; cap rejected when min-distance.
- **Frontend** (vitest + RTL): field matrix per mode; toggle non-interactive; banner shown/hidden
  across all five conditions including stale; sidebar nesting; each gate state and its CTA; pair
  table rows; and the delete-parent confirm reachable from **every** return branch.
- **Solver** (pytest): no solver change, so this is a regression check. `e2e_accuracy.py` must still
  pass **99/99 unmodified** (hard rule #2), run directly — `python3 -m pytest tests/ -x` does not
  discover it.
- **e2e** (Playwright, real browser, `qa-sdet`): the nine storyboard frames of wireframe 1e, end to
  end.

Verification gate before any task is considered done:

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

**Three-layer reminder** (recurring bug class #2): new fields must clear `openapi.yaml` (→ Orval
regen, same commit), the Zod schema, **and** the manifest `inputsSchema`. This repo has been bitten
by discovering a third location after two tasks had already reported done.
