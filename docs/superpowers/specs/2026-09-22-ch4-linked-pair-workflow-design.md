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

Out of scope: solver changes (`solve.py` is untouched); other models; and the general
PATCH-during-solve race, which R6 assigns to its own follow-up bundle for the reasons in §9.1.

## 3. Decisions

`D`-numbered decisions were taken during brainstorming; `R`-numbered ones resolve the 2026-09-22
review in §12. The `R` prefix exists because this repo's other specs already own `D17` (solver
infeasibility handling, `solve.py:1258`) and `D22` (2-dp rounding) — a second `D17` in this document
would make both references ambiguous.

Where a decision deviates from a standing repo rule, that is called out.

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
| D15 | Parent re-solve is **blocked (422)** while the child has a job in flight, with an explaining dialog | Chosen over discarding the child's result at completion. Keeps the job runner's write path unchanged; the student is told why rather than silently losing a solve. **Extended by R2** — blocking one direction is not sufficient. |
| D16 | Min-distance objective renders at **full 2dp with comma grouping** | The solver emits 2dp (D22) and the frozen golden is `123834216789.27`. The wireframe's integer rendering would differ from the value the tests assert. |
| R1 | A single **usable Chen result** predicate replaces every `result != null` test | Review 12.2. `markSucceeded` writes `scenario.result` for *any* schema-valid envelope (`jobRunner.ts:415`), and Chen returns `_EMPTY_DETAILS` on both its infeasible and error paths (`solve.py:1259`, `:1262`). Result presence therefore does not imply a seedable solve. |
| R2 | Solve initiation is **serialized across the whole pair**, both directions | Review 12.1. `enqueueSolveJob` snapshots the `SolveInput` into `pendingJobs` at enqueue (`jobRunner.ts:129`) and the worker executes that snapshot, so a child queued before a re-seed is *guaranteed* to ignore it — deterministically so at `SOLVE_WORKER_CONCURRENCY=1`. |
| R3 | Spawning requires the parent's solve to have run at **`gap === 0`** | A gap-terminated CBC run is reported as `Optimal` by PuLP and Chen hardcodes `_envelope("optimal", ...)` (`solve.py:1286`), so the dialog's default Gap = 1% can seed a floor up to ~1% below the true optimum — which the child then enforces as a *hard* constraint. The frozen golden solves at `gap: 0.0`. |
| R4 | Clone's pair response is **additive**: top-level `Scenario` plus optional `alsoCreated: Scenario[]` | Review 12.3 asked for `{primaryScenario, createdScenarios}`; that rewrites `POST /clone`'s contract for all six models and every generated call site. The additive shape meets the same cache-before-navigate and atomicity requirements without breaking the other five models. |
| R5 | A cloned child's **non-objective, non-floor inputs stay editable** while its parent is unsolved or stale; a usable seed is required only at **child solve** | Review 12.6. Resolves the contradiction between "seed guard on every PATCH" and "all other inputs editable". Moves the seed check to the solve route. |
| R6 | The enqueue-time snapshot root cause gets its **own follow-up bundle**, not this one | A completion-time hash comparison as originally proposed would discard a valid result after a `distanceBands`-only edit — which `scenarios.ts:238-245` deliberately treats as non-geometric and harmless. Fixing that correctly needs `diffInputKeys` semantics and its own spec; shipping the naive version here would trade a silent bug for a visible regression. |

## 4. Data model

### 4.1 Schema

`lib/db/src/schema/scenarios.ts`:

```ts
parentScenarioId: integer("parent_scenario_id")
  .references((): AnyPgColumn => scenariosTable.id, { onDelete: "cascade" }),
```

The explicit `: AnyPgColumn` return annotation is required for the self-reference, for the same
reason it is already required on `resultRunId`.

Plus a unique partial index, **declared in the `pgTable` index callback** — not as raw SQL. Per
review 12.7, SQL that appears only in this document is never created by `drizzle-kit push`.
drizzle-orm 0.45.2 exposes `IndexBuilder.where(condition: SQL)` (`pg-core/indexes.d.ts:67`), so this
is expressible directly:

```ts
}, (table) => [
  index("IDX_scenarios_user_id").on(table.userId),
  uniqueIndex("UQ_scenarios_parent_scenario_id")
    .on(table.parentScenarioId)
    .where(sql`${table.parentScenarioId} IS NOT NULL`),
]);
```

This is what enforces D11 — cardinality comes from Postgres, not from application code. It is also
the mechanism §6.4 uses to make follow-up creation race-safe, so it must exist in the schema
definition, not merely in the database.

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

### 4.4 The usable-result predicate (R1)

`result != null` is **not** a "this scenario solved successfully" test. `markSucceeded`
(`jobRunner.ts:415`) writes `scenario.result` for *any* envelope that passes
`ResultEnvelopeSchema`, and Chen returns `_EMPTY_DETAILS` on both its infeasible path
(`solve.py:1259`) and its error path (`solve.py:1262`). A scenario can therefore hold a result with
no `details.coveredDemand` at all.

One shared predicate, used by **every** consumer — follow-up creation, banner visibility, the D6
re-seed, the gate's progress count, and pair-summary eligibility:

```
usableChenResult(row) =
     row.result != null
  && row.result.status === "optimal"
  && row.result.details?.objective === <the expected mode>
  && Number.isInteger(row.result.details?.coveredDemand)
  && row.result.details.coveredDemand >= 0
```

Malformed or legacy results **fail closed** — they are treated as not-usable and produce the
documented 422 or the gated placeholder, never a thrown error. Note that `status` is the envelope's
literal success marker, distinct from `quality`, which carries CBC's own status string.

### 4.5 Gap provenance (R3)

Spawning requires the parent's solve to have run at `gap === 0`. `details` does not record the run's
gap (`solve.py:1282-1284`), but it does not need to: spawning already requires a **non-stale**
parent, and any change to `gap` is a non-bands input change that bumps `inputsUpdatedAt`
(`scenarios.ts:238-245`). For a spawn-eligible parent, `inputs.gap` is therefore exactly the gap that
produced `result`. No solver change is required.

This matters because a gap-terminated CBC run is reported by PuLP as `Optimal`, and Chen's success
path hardcodes `_envelope("optimal", "optimal", ...)` (`solve.py:1286`) — so `status` alone cannot
distinguish a proven optimum from a 1%-gap incumbent.

## 5. API contract

Changes to `lib/api-spec/openapi.yaml`, with Orval regeneration committed in the same commit
(hard rule #1).

### 5.1 `Scenario` additions

Both are declared **required, nullable, read-only** properties of `Scenario` — not optional. An
optional field is indistinguishable from "this endpoint didn't populate it", which is precisely the
ambiguity review 12.4 identifies.

- `parentScenarioId: integer | null` — read directly off the row.
- `followUpScenarioId: integer | null` — derived from the reverse lookup; never stored. The unique
  partial index (§4.1) guarantees at most one.

**Projection is specified for every endpoint that returns a `Scenario`**, not just the list. The
current single-row projector `toApiScenario(row)` cannot infer a reverse link, so it must be given
one. Leaving it to project `null` by default would let a parent's own PATCH response overwrite
correct cached relationship state, re-show the spawn CTA, and permit a duplicate follow-up request:

| Endpoint | How `followUpScenarioId` is resolved |
|---|---|
| `GET /scenarios` (list) | **One** in-memory pass over the already-fetched rows — every child is itself a row in that set. Never a per-row query, or the field re-introduces on the server the N+1 it exists to spare the client |
| `GET /scenarios/{id}` | One ownership-scoped child lookup |
| `POST /scenarios` | Always `null` — a new scenario cannot already have a child |
| `PATCH /scenarios/{id}` | One ownership-scoped child lookup |
| `POST /{id}/clone` | Known from the insert: the cloned parent's child is the cloned child; the cloned child's is `null` |
| `POST /{id}/follow-up` | Known from the insert on both rows |
| import / update endpoints returning a scenario | One ownership-scoped child lookup |

Every lookup is scoped by `userId`, for the same anti-enumeration reason as hard rule #5.

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

Returns **201** with the created scenario. Returns **404** if the parent does not exist *or is not
owned by the caller* (hard rule #5 — never 403, to avoid ID enumeration).

Returns **422** if the parent is not Chen, is not `coverage`, is stale, already has a follow-up
(§6.4), lacks a **usable result** per §4.4, or was solved at a **non-zero gap** per §4.5. The last
two supersede the earlier "is unsolved" wording: an infeasible or errored parent holds a `result`
yet has no `coveredDemand` to seed from, and a gap-terminated parent has one that may be
understated.

Scenario names are not unique today and this design does not make them so. `"<parent> — Min
Distance"` may collide with a hand-named scenario; this is harmless because the link is by id.

### 5.3 `POST /scenarios/{id}/clone`

Behavior changes underneath per D4/D5, and the response gains one **additive** field per R4.

- Source is a **follow-up**: create a copy of the parent and a copy of the child, with the child copy
  pointing at the parent copy. Both copies have `result: null`.
- Source is a **coverage parent**: copy the parent only. No child is created.

**Both inserts are one DB transaction.** Two independent inserts can leave a half-cloned pair — a
parent copy with no child, or worse a child insert that fails after its parent is committed
(review 12.3).

**Response shape.** The top-level body stays a single `Scenario` — the **semantic clone target**,
i.e. the cloned *child* when a follow-up was cloned — plus:

```
alsoCreated?: Scenario[]   // every other row this call created
```

Absent or empty for the five other models and for a parent-only clone, so their generated clients
are unaffected. When a pair is cloned it contains the cloned parent.

**Both existing consumers must hydrate every returned row before navigating.**
`Workspace.tsx:2574` and `Studio.tsx:627` currently `setQueryData` the single response row and then
navigate; with a pair, the cloned parent would be missing from the list cache at the moment the new
route renders. A background `invalidateQueries` does not preserve that guarantee — it resolves after
navigation. Both call sites write the top-level scenario *and* every `alsoCreated` entry
synchronously, then navigate.

Because both copies have `result: null`, a cloned child's floor no longer corresponds to any solve on
its new parent. It is retained as-is and the pair reads as gated until the new parent is solved,
which re-seeds it via D6. This is why the clone path skips the seed invariants — see §6.1.

### 5.4 Solve route

**Pair-wide serialization (R2).** `POST /scenarios/{id}/solve` on *either* member of a pair returns
**422** `pair_solve_in_flight` when *either* member has a job in `queued` or `running` status.
D15 blocked only the parent-while-child direction, which is insufficient: `enqueueSolveJob`
snapshots the `SolveInput` into `pendingJobs` at enqueue (`jobRunner.ts:129`) and the worker executes
*that snapshot*, so a child queued before the parent's re-seed will run against the old floor and
then write a `solvedAt` newer than the bumped `inputsUpdatedAt` — reporting fresh while being wrong.
At `SOLVE_WORKER_CONCURRENCY=1` this is not a race but a certainty.

The check and the enqueue must be **atomic**; two simultaneous prechecks can otherwise both pass.
See §6.4 — the same conditional-insert mechanism covers this and follow-up creation.

**Seed check at child solve (R5).** Solving a *child* requires a usable seed at that moment: the
parent has a usable result (§4.4), is not stale, ran at `gap === 0` (§4.5), and the child's stored
floor equals the parent's `coveredDemand`. Otherwise **422** `seed_required_for_solve`. This is the
counterpart to R5's relaxation of PATCH — inputs stay editable on an unsolved-parent clone, but the
solve itself cannot proceed on an unfounded floor.

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

*Seed invariants* — enforced only when `checkSeed` is true:

- parent has a **usable result** (§4.4) and is not stale
- parent's solve ran at `gap === 0` (§4.5)
- `coverageFloorDemand === parent.result.details.coveredDemand`

**Where `checkSeed` is true:** `POST /scenarios`, `POST /:id/follow-up`, and
`POST /:id/solve` for a child (§5.4).

**Where it is false:** `POST /:id/clone` and `PATCH /scenarios/:id`.

Clone must skip it because cloning a pair produces a parent copy with `result: null` (§5.3), making
the seed invariants unsatisfiable by construction. PATCH must skip it per R5: requiring a solved,
non-stale parent on every child PATCH would contradict the lifecycle's promise that all
non-objective, non-floor inputs stay editable, and would block unrelated edits to a cloned child
until its parent is solved — or any time the parent is merely stale (review 12.6).

In both cases the floor a child carries is inherited data awaiting re-seed, not a claim about its
parent's current solve. D6 re-seeds it when that parent is solved, and §5.4's solve-time check is
what guarantees no solve ever runs on an unfounded floor. The structural invariants hold throughout,
so no orphan is reachable by either path.

**PATCH error precedence.** A child PATCH is evaluated in this fixed order, so the returned code is
deterministic rather than dependent on which check happens to run first:

1. `objective` changed → `objective_immutable`
2. `coverageFloorDemand` changed → `floor_immutable`
3. structural invariants → their own codes
4. everything else → proceed

Two layers must stay in sync — this is recurring bug class #2 by construction, and is the main
maintenance cost of D3. The guard is deliberately a single named function called from four sites
rather than four inline checks, so the sync surface is one file.

### 6.2 Lifecycle

| Action | Behavior |
|---|---|
| `POST /scenarios` (Chen) | coverage only; `min_distance` → 422 `min_distance_requires_parent` |
| `POST /:id/follow-up` | as §5.2 |
| `PATCH` child | `objective` and `coverageFloorDemand` are immutable → 422. All other inputs editable **even when the parent is unsolved or stale** (R5) |
| solve child | requires a usable seed *at solve time* → else 422 `seed_required_for_solve` (§5.4) |
| solve either member | 422 `pair_solve_in_flight` if either member has a queued or running job (R2) |
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

### 6.4 Concurrency and the unique-violation path

Two concurrent `POST /:id/follow-up` requests can both pass an application-level "parent has no
child" precheck. The partial unique index (§4.1) preserves database integrity, but the losing insert
raises SQLSTATE **23505**, which surfaces as a **500** unless handled — not the documented
`422 follow_up_already_exists` (review 12.5).

**Resolution: make the index the arbiter rather than the precheck.** Attempt the insert and map a
`23505` violation *on the specifically named index* `UQ_scenarios_parent_scenario_id` to
`422 follow_up_already_exists`. A violation on any other constraint must not be swallowed — a blanket
`23505` catch would silently convert unrelated integrity bugs into a misleading 422. The
application-level precheck stays, as a fast path that produces the same code without a failed insert.

The same reasoning applies to §5.4's pair-solve check: the in-flight test and the enqueue must be
atomic, or two simultaneous submissions both observe an idle pair and both proceed.

**On lock mechanism:** review 12.1 suggested an advisory lock as one option. Note that the job queue
is module-level in-memory state (`queue`, `pendingJobs` in `jobRunner.ts`), so the solve architecture
is already single-instance-bound, and `render.yaml` declares no `numInstances`. An advisory lock
would therefore buy correctness only for a deployment topology the rest of the runner cannot support.
A DB-level conditional insert/update is sufficient, cheaper, and covers both cases with one
mechanism. If the API is ever scaled past one instance, the in-memory queue is the thing that breaks
first — not this lock.

### 6.5 Orphan purge (D8)

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

Renders when **all** of: model is Chen, `objective === "coverage"`, the scenario has a **usable
result** (§4.4), it is **not stale**, its solve ran at **`gap === 0`** (§4.5), and
`followUpScenarioId == null`.

Every one of those conditions is load-bearing, and the banner's visibility rule must be the *same*
predicate the follow-up endpoint enforces — a banner offering an action the API will refuse is worse
than no banner:

- **usable result** — an infeasible or errored parent holds a `result` but carries `_EMPTY_DETAILS`,
  so there is no `coveredDemand` to seed from. My original `result != null` wording offered a spawn
  action on exactly those scenarios (review 12.2).
- **not stale** — a stale parent's `coveredDemand` no longer matches its inputs.
- **gap === 0** — otherwise the seeded floor may be understated (R3).
- **no existing follow-up** — the 1:1 rule.

When the parent has a result that is *not* usable, the banner is replaced by a short explanation of
why there is nothing to spawn from (infeasible, errored, or gap-limited), not silently hidden.
`followUpScenarioId` must come from a correctly-projected response (§5.1) — a stale `null` here
re-shows the CTA and invites a duplicate request.

Content per 1b — coverage %, the covered-demand figure, the "clean it up" line, and
`Create min-distance follow-up →` with a caption stating what the click does. Action is
`POST /scenarios/:id/follow-up`, then navigate to the child.

It sits in the Workspace content header so it is visible from any tab.

### 7.5 Gated Solution Summary (wireframe 1d)

`CostSummaryTab` gains a Chen-only branch with exactly two states. The manual scenario toggle list is
hidden for Chen (D9).

**This is cheaper than it was when the wireframes were drawn.** The `ch4-fixes` bundle (`917bc88`,
landed on main 2026-09-22) unified the single-scenario path onto the *same* `<table>` shell compare
mode uses — metric column plus one column per scenario — so adding a second scenario now adds a
column rather than swapping a `<dl>` for a table. The pair view is therefore a two-column instance
of a shell that already exists, not a new layout. The gated placeholder remains a genuinely distinct
third rendering, since it shows no table at all.

**Gated state** — progress dots, "N of 2 models solved", and one context-dependent CTA:

| Situation | CTA |
|---|---|
| parent has no usable result | `Run Max Cover →` — opens SolveDialog on the parent |
| parent's result is infeasible or errored | no CTA; the placeholder states the reason and offers `Edit parameters →` |
| parent usable but solved at a non-zero gap | `Re-solve at gap 0 →` — opens SolveDialog with `gap` set to 0 (R3) |
| parent usable, no child | `Run Min Distance →` — spawns, navigates, does not auto-solve (D10) |
| child exists, no usable result | `Run Min Distance →` — navigates to the child |

**"Solved" here means the usable-result predicate (§4.4), never `result != null` (R1).** A member
whose solve returned infeasible or errored holds a `result` with `_EMPTY_DETAILS`; counting it as
solved would open the gate onto a summary with no numbers behind it. The placeholder names the
reason rather than showing "1 of 2" with no indication of why the other half will never complete.

**Stale counts as unsolved for the gate.** A stale result was computed against inputs that no longer
hold, so including it in a side-by-side would compare two different problems. This also means a
parent re-solve drops the pair back to the gated state until the child re-runs — frame 9's intent,
expressed through the gate rather than as a separate warning.

**Pair state** — both members have a usable result and neither is stale. Rendered identically on the
parent's tab and the child's tab. Rows: Objective, Percent Coverage, Demand within High Service Dist, High Service
Distance, Floor Constraint (`—` for the parent, `131,645,389 ⇐ seeded` for the child), Weighted avg.
distance, Run time, Quality, Solver.

Both cross-mode rows come free: `details.coveragePct` and `details.coveredDemand` are written in
**both** modes (`solve.py:1284`), so no solver change is needed.

Numbers use comma grouping, never scientific notation. The min-distance objective renders at full 2dp
per D16.

### 7.6 Dialog-rendering hazard

The D12 delete confirm and the R2 pair-in-flight dialog must each be **rendered in every return branch
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
| `parent_result_not_usable` | 422 | parent has no result, or one that fails §4.4 — infeasible, errored, or missing `coveredDemand` (R1, replaces `parent_not_solved`) |
| `parent_stale` | 422 | parent's `result` predates its `inputs` |
| `parent_gap_not_zero` | 422 | parent's solve ran at `gap > 0`, so its `coveredDemand` may be understated (R3) |
| `floor_mismatch` | 422 | floor ≠ parent's `coveredDemand` |
| `follow_up_already_exists` | 422 | parent already has a child (D11) — raised by the precheck **or** mapped from a `23505` violation on `UQ_scenarios_parent_scenario_id` (§6.4) |
| `pair_solve_in_flight` | 422 | a solve was requested on either member while either has a queued or running job (R2, replaces the one-directional `follow_up_solve_in_flight`) |
| `seed_required_for_solve` | 422 | child solve requested without a usable seed at that moment (R5, §5.4) |
| `objective_immutable` | 422 | PATCH tries to change a child's objective |
| `floor_immutable` | 422 | PATCH tries to change a child's floor |
| — | 404 | parent does not exist **or is owned by another user** (hard rule #5) |

`objective_immutable` and `floor_immutable` take precedence over the structural codes, per the PATCH
ordering in §6.1 — so a request that changes both the objective and something structural returns the
objective code deterministically, not whichever check ran first.

The solver wrapper contract is untouched: it still never throws. An infeasible floor — e.g. the
student lowers `p` on the child until nothing clears the floor — returns
`{status: "error", infeasibilityReason: ...}`.

**Correcting an earlier claim.** A previous draft of this section said such a result "simply stays
gated". That was only true by accident: it relied on the gate testing `result != null`, which an
error envelope *satisfies*. The gate would have opened onto a summary with no numbers behind it. It
is §4.4's predicate — applied to the banner, the gate, the seed guard, and the D6 re-seed alike —
that actually makes the statement true.

## 9. Known gaps, accepted

1. **The general PATCH-during-solve race is not fixed — it gets its own bundle (R6).** The root
   cause is that `enqueueSolveJob` snapshots the `SolveInput` into `pendingJobs` at enqueue
   (`jobRunner.ts:129`) and the worker executes that snapshot, never re-reading the row.
   `solve_jobs.inputsHash` records what the job was dispatched with, but nothing compares it at
   completion. For every model, a PATCH landing mid-solve produces a result computed against
   superseded inputs whose `solvedAt` is newer than `inputsUpdatedAt` — so `isStale` reports
   **false** on a result that is actually wrong.

   R2's pair-wide lock is **containment, not a fix**: it stops the Chapter-4 pair from exercising
   the bug, while every other model — and Chen itself via a plain PATCH-during-solve on one
   scenario — remains exposed.

   The obvious fix (compare `job.inputsHash` against the current inputs hash at completion, discard
   on mismatch) **must not be implemented naively**, because `computeInputsHash` hashes `inputs`
   wholesale including `distanceBands`, while `scenarios.ts:238-245` deliberately treats a
   bands-only edit as non-geometric and harmless — it does not even bump `inputsUpdatedAt`. A raw
   hash comparison would therefore discard a perfectly valid result because the student adjusted a
   reporting band mid-solve: trading a silent bug for a visible regression. The correct comparison
   uses `diffInputKeys` semantics, which is why this needs its own spec rather than a corner of this
   one.
2. `isStale` remains duplicated (§4.2).
3. D1's `modelId` gating is a deliberate deviation (§10).
4. **Single-instance assumption.** The job queue is module-level in-memory state, and this design's
   pair serialization inherits that constraint (§6.4). `render.yaml` declares no `numInstances`, so
   this holds today; a second API instance would break the existing runner before it broke anything
   added here.

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

Worth noting for whoever picks this up: the `ch4-fixes` bundle that landed the same day
(`917bc88`) added JADE's Inbound/Outbound cost rows to compare mode and gated them **on metric
presence across the selection, explicitly never on `modelId`** — the surrounding code is actively
moving away from the pattern D1 adopts. The predicate above is what keeps this feature's divergence
to a single, greppable line.

## 11. Testing

- **API** (vitest + supertest): each guard rule → its code; follow-up creation; clone-parent-only;
  cascade delete with jobs present; re-seed fires on parent solve.
  Call `resetLoginRateLimiterForTests()` in `beforeEach` — this file will log in well past the
  10-per-minute cap.
- **Pair-solve concurrency (R2)** — both request orderings (parent-then-child, child-then-parent),
  both completion orderings, a queue pinned to `SOLVE_WORKER_CONCURRENCY=1` where the bad ordering
  is deterministic rather than probabilistic, and two simultaneous submissions racing the precheck.
- **Non-optimal and malformed results (R1)** — a parametrised case per envelope shape: optimal,
  infeasible, error, and a malformed/legacy result with absent or non-integer
  `details.coveredDemand`. Each asserted against *every* consumer: follow-up creation, banner
  visibility, gate progress count, pair eligibility, and the D6 re-seed. Malformed must fail closed
  with the documented response, never throw.
- **Gap provenance (R3)** — spawn refused at `gap > 0` with `parent_gap_not_zero`; permitted at
  `gap === 0`; and the gate's `Re-solve at gap 0 →` CTA appearing only in that state.
- **Concurrent follow-up creation (R4/§6.4)** — two simultaneous requests; the loser returns
  `422 follow_up_already_exists`, **not** a 500. A sequential duplicate test does not exercise this
  and is not a substitute. Also assert that a `23505` on any *other* constraint is not swallowed
  into a 422.
- **Atomic pair clone (R4)** — the pair is created in one transaction; a forced failure on the
  second insert leaves no partial clone; the response carries the cloned child top-level and the
  cloned parent in `alsoCreated`; and both consumers hydrate every row into the list cache
  *before* navigating.
- **Relationship projection (§5.1)** — `parentScenarioId` and `followUpScenarioId` correct on every
  endpoint that returns a `Scenario`, not just the list. Specifically: a parent's own PATCH response
  must not project `followUpScenarioId: null` over correct cached state.
- **Cloned-child edit lifecycle (R5)** — a non-objective, non-floor PATCH succeeds while the parent
  is unsolved *and* while it is stale; objective and floor changes return their codes with the
  §6.1 precedence; and the child's solve is refused with `seed_required_for_solve` until the parent
  has a usable gap-0 result.
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

---

## 12. Review — 2026-09-22

> **Resolution (same day).** All seven findings were verified against the code and accepted; each is
> now folded into the normative sections above as R1–R6 plus §4.4, §4.5, §5.1, §5.3, §5.4, §6.1 and
> §6.4, per the §12.8 approval condition. Three points were negotiated rather than taken verbatim:
>
> - **12.3's response shape** — implemented as an *additive* `alsoCreated: Scenario[]` (R4) instead
>   of `{primaryScenario, createdScenarios}`, which would have rewritten `POST /clone`'s contract for
>   all six models. Atomicity and cache-before-navigate requirements are met unchanged.
> - **12.1's lock mechanism** — a DB conditional insert rather than an advisory lock, because the job
>   queue is already module-level in-memory state and therefore single-instance-bound; an advisory
>   lock would buy correctness only for a topology the runner cannot support (§6.4).
> - **12.1's root cause** — fixed in a *separate* bundle (R6), not here. The naive completion-time
>   hash comparison would discard valid results after a `distanceBands`-only edit, which
>   `scenarios.ts:238-245` deliberately treats as harmless (§9.1).
>
> One finding the review did not raise was added: **R3**, a gap-terminated parent seeding an
> understated floor.
>
> The review text below is retained unedited as the historical record.

**Status: not approved.** The linked-pair direction is sound, but the following contract gaps must be
resolved before implementation approval. Findings 1–3 are blockers.

### 12.1 BLOCKER — D15 does not serialize parent and child solves

D15 blocks a parent solve only when its child already has a queued or running job. It does not block
the reverse ordering: a parent solve can start first and a child solve can then be submitted while the
parent is still queued or running. This permits:

1. Parent solve starts with inputs P1.
2. Child solve starts with the old floor F1.
3. Parent completes, writes result P2, re-seeds the child to floor F2, and bumps the child's
   `inputsUpdatedAt`.
4. Child completes using F1 and writes a newer `solvedAt`.
5. The timestamp-only `isStale` check reports the child as fresh even though its result was computed
   from the superseded floor.

**Probability note.** This exact ordering is probably low-frequency in ordinary single-tab classroom
use. A local baseline measurement on 2026-09-22 took approximately 1.63 s for coverage and 0.66 s for
min-distance; with the default three-worker pool and an idle queue, a manual child submission has a
narrow timing window. It becomes materially more likely with two tabs, direct API use, automation,
longer edited datasets, or a busy queue. With worker concurrency set to one, a child queued while the
parent runs will execute from its captured old inputs after the parent re-seeds it, making the bad
ordering effectively deterministic conditional on both submissions. Likelihood is therefore low in
the intended happy path but high under specific supported operating conditions; impact is high
because the wrong result is silently presented as fresh.

Required resolution: serialize solve initiation across the whole pair. A parent or child solve must
be rejected while either member has a queued or running job. The active-job check and enqueue must be
atomic (pair-row lock, advisory lock, or equivalent), since two simultaneous prechecks can otherwise
both pass. Add tests for both request orderings, both completion orderings, a single-worker queue, and
simultaneous submissions. If product explicitly accepts this race instead, correct §9's claim that
D15 closes the Chapter-4 path and record the precise residual risk.

### 12.2 BLOCKER — `result != null` is not a successful/seedable solve predicate

`ResultEnvelope.status` can be `optimal`, `infeasible`, or `error`. Chen's infeasible/error envelopes
have empty details and therefore no `details.coveredDemand`, yet the spawn banner, seed guard, pair
gate, and D6 completion path are specified in terms of result presence. This contradicts §8's claim
that an error result simply stays gated and can instead expose a spawn action, attempt to seed an
undefined floor, or fail in the completion transaction.

Define one shared **usable Chen result** predicate: the envelope parses, `status === "optimal"`, the
expected objective mode is present, and `details.coveredDemand` is a nonnegative integer. Use it for
follow-up creation, banner visibility, D6 re-seeding, progress counting, and pair-summary eligibility.
Malformed legacy results must fail closed with a specified response rather than throw. Add
optimal/error/infeasible/malformed-result tests.

### 12.3 BLOCKER — clone-pair atomicity and response contract are undefined

Cloning a follow-up creates two scenarios, while §5.3 says the endpoint signature is unchanged and
the current OpenAPI response is one `Scenario`. The existing clients synchronously place that one
response into the list cache before navigation. Returning only the child leaves its parent absent
from the cache; returning only the parent navigates away from the user's semantic clone target. A
background invalidation does not preserve the cache-before-navigation guarantee. Two independent
inserts can also leave a partial clone if the second insert fails.

Make pair cloning one DB transaction and define an explicit response, for example
`{ primaryScenario, createdScenarios }`. When the source is a child, `primaryScenario` must be the
cloned child and `createdScenarios` must contain the cloned parent and child. Both clone consumers
must synchronously cache all returned rows before navigating. Update OpenAPI and generated clients.

### 12.4 HIGH — reverse-link projection is specified only for list responses

The design explains how `followUpScenarioId` is derived for `GET /scenarios`, but `Scenario` is also
returned by single GET, create, PATCH, clone, follow-up, and import/update endpoints. The current
single-row projector cannot infer a reverse link. A parent mutation response that projects
`followUpScenarioId: null` could overwrite correct cached relationship state, show the spawn CTA, or
permit a duplicate request.

Declare `parentScenarioId` and `followUpScenarioId` as required, nullable, read-only `Scenario`
properties and specify correct projection for every endpoint returning a scenario. List responses
can use the in-memory reverse map; single-row parent responses need one ownership-scoped child lookup
or mutation-specific relationship data.

### 12.5 HIGH — the unique-index race is not mapped to the promised API error

Two concurrent follow-up requests can both pass the application-level "no child" precheck. The
partial unique index preserves database integrity, but the losing insert will raise a unique
violation unless explicitly handled, producing a 500 instead of `422 follow_up_already_exists`.

Lock the parent during creation and/or catch SQLSTATE `23505` for the specifically named partial
unique index and map it to the documented 422. Add a concurrent-request test; a sequential duplicate
test is insufficient.

### 12.6 HIGH — cloned-child editing contradicts the seed guard

Pair cloning intentionally creates an unsolved parent and skips seed validation for its child. The
design also says every child PATCH uses `checkSeed: true`, which requires a solved, non-stale parent,
while the lifecycle promises that all child inputs other than objective and floor remain editable.
Those rules make ordinary edits to a cloned child impossible until the parent is solved and also
block unrelated edits whenever the parent is stale.

Choose and document one behavior. Either lock all child editing until the parent has a usable solve
and reflect that lock in the UI, or allow non-objective/non-floor edits while the parent is
unsolved/stale and require a valid seed only before child solve. The latter matches the current
"all other inputs editable" contract. Also specify PATCH error precedence so objective/floor changes
reliably return `objective_immutable`/`floor_immutable` rather than a seed or structural error.

### 12.7 Implementation clarification — the partial index must be represented in Drizzle

The schema section shows raw SQL but prescribes `drizzle-kit push`. Declare the partial index in the
`pgTable` index callback with `uniqueIndex(...).where(...)`, or provide an explicit migration and
change the deployment instruction. SQL shown only in this document will not be created by `push`.

### 12.8 Approval conditions

Approval requires the normative sections—not only this review appendix—to incorporate findings
12.1–12.7. Extend the test plan with pair-solve concurrency, non-optimal/malformed result handling,
concurrent follow-up creation, relationship projection for every response shape, atomic pair cloning
and cache hydration, and the chosen cloned-child edit lifecycle.
