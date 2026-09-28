# Chapter 5 — Delivery Company Teaching Example — Design

**Date:** 2026-09-28
**Branch:** `ch5-ux`
**Model id:** `delivery-teaching-us` (the 7th model)
**Status:** Rev 1, awaiting review

---

## 1. Summary

A new, 7th model package: a p-median facility-location lab over the COG in-class
dataset (33 candidate DCs, 313 customers, continental US), whose objective is
driven by a **cost table that is separate from the distance table**, plus an
"Adjust Cost Table" feature that reprices every lane against a distance
threshold.

The teaching point is that optimising cost under a threshold penalty produces a
*different network* than optimising distance, and that the resulting network is
better on threshold coverage and worse on average distance. Both halves of that
claim are measured in §8.1, not asserted.

The model ships visible and unlocked on the Landing page. `transport-coal` and
`p-median-brazil` — the two existing Chapter 5 models — are untouched and remain
hidden.

---

## 2. Source material and provenance

Three sources, all read during design:

| Source | What it contributed |
| --- | --- |
| `Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb` (user's Downloads) | The existing Chapter 5 exercise. Confirmed `transport-coal` in this repo is a faithful port: 4 mines, 15 power stations, `distance × 1.17` circuity, `min Σ distance·flow`. **Not** the base for this model — see §3, decision 2. |
| `COG_CaseStudy_v2/Network Optimization.ipynb` | The model being built. p-median with `max_plants = 3`, binary single-source assignment, and the `multi_rate` cost rule (`cost_per_mile = 1`, `cost_per_mile_over_threshold = 10`, `dist_threshold = 800`). Its KPI block is the source of the Solution Summary requirements. |
| `COG_CaseStudy_v2/COG Model Data for In Class Example  3 DC 3 WH.xlsx` | The dataset. Six sheets; four are data (`Customers`, `Demand`, `Plants`, `Distance Matrix`) and two are prose (`Trans Costs`, `Outputs Needed`) that state the requirements directly. |

Two prose sheets are load-bearing and quoted verbatim:

> **`Trans Costs`** — "Costs in Scenario 1 are \$1 per mile" / "In Scenario 2,
> costs are \$1 per mile if less than 800 miles and \$10 per mile if more than
> 800 miles"

> **`Outputs Needed`** — "1. Map of the solution with the lines / 2. Weighted
> average distance from warehouse to customer / 3. Total demand and % of demand
> within 400 miles, 800 miles, 1200, and 1600 miles of a warehouse"

The filename's "3 DC 3 WH" refers to *opening three DCs*, not to the data's size.
The data is 33 × 313.

### 2.1 Divergences from the source notebook, and why

| Point | Notebook | This model | Reason |
| --- | --- | --- | --- |
| Threshold edge | `x < dist_threshold` gets the low rate | `dist <= threshold` gets the low rate | User decision. **No numeric effect on this dataset** — zero of the 10,329 lanes measure exactly 800 mi (§4.1). It matters only if a student moves the threshold onto a lane's exact value. |
| What the rate multiplies | `dist['Distance']` — the distance column | `cost[w,c]` — the cost table | User decision. Makes the cost table a real, editable input rather than a value the feature discards. With cost seeded equal to distance, the two readings agree until a student edits a cost. |
| Multi-product / multi-period | `assign[i,j,k,t]` over product and period sets | Collapsed away | The dataset has one product (`Product ID = 1`, "Product") and one period (`Time Period ID = 1`, "Entire span") in all 313 demand rows. Carrying the indices would add two singleton dimensions and no teaching content. |

---

## 3. Decisions

These are settled. They are recorded so a reader can tell a decision from an
accident, and so a future change is a decision to revisit rather than a bug to
fix.

| # | Decision | Consequence |
| --- | --- | --- |
| 1 | Ship as a new 7th model package, not as a change to `transport-coal` | Full registration cost (§9); zero regression risk to the live Chapter 5 coal lab |
| 2 | p-median base + the real COG 33/313 dataset | The model is a fork of `p-median-us`'s *shape*, not of `transport-coal`'s. See §3.1. |
| 3 | `distances.json` and `costs.json` ship as two separate files, seeded identical | ~210 KB duplicated at seed time; the cost table has an identity independent of distance from day one |
| 4 | Only this model becomes visible on Landing | `transport-coal` and `p-median-brazil` keep `hiddenFromLanding: true`; Landing goes from 3 visible labs to 4 |
| 5 | "Adjust Cost Table" is a persisted toggle, applied at solve time, never written back | Toggling off restores original costs exactly; two scenarios can differ by this flag alone, which is how the case study's Scenario 1 vs 2 works |
| 6 | A cost value is *billable miles*; the rate multiplies the **cost**, the threshold compares the **distance** | Editing a cost cell means "bill this lane as if it were N miles" — a carrier-contract reading — and leaves every distance metric untouched |
| 7 | `dist <= threshold` takes the low rate | See §2.1 |
| 8 | `P` is editable, defaults to 3, constrained `Σ open <= P` | Diverges from `p-median-us`, which uses `Σ open == p` (`solve.py:405`). Matches the COG notebook's `lpSum(use_plant) <= max_plants`. |
| 9 | Every customer is served by exactly one DC. No toggle. | Required for the weighted-average-distance and %-within-distance metrics to mean what the case study says |
| 10 | Solution Summary shows Objective, Weighted avg. distance, and cumulative % of demand within 400/800/1200/1600 mi | Matches the `Outputs Needed` sheet. The distance-band machinery already produces this. |
| 11 | The cost table is the only editable input. Demand and geography are fixed dataset. | No added entities, no facility status editing, no demand overrides, no customer exclusion |
| 12 | No capacity constraint anywhere | The `Plants` sheet has no capacity column and the notebook writes no capacity row. `capacityModes: []`. |
| 13 | `delivery-teaching-us`, route `/chapter-5/delivery`, chapter "Chapter 5", title "Delivery Company Teaching Example" | |
| 14 | Open to students on merge — not `locked` | |

### 3.1 Why the p-median base rather than a `transport-coal` fork

The request was phrased as "tweak the transport coal model", and the dataset
chosen is the COG one. Those two pull in different directions, and the dataset
won, for three reasons established from the data rather than from taste:

1. **The COG notebook is a p-median.** It selects which plants to open
   (`max_plants`, `use_plant` binaries) and assigns each customer wholly to one
   of them. `transport-coal` is a transportation LP: every origin is always
   open, flows are continuous and may split, and the binding constraint is
   per-mine capacity.
2. **The COG data has no capacities.** `transport-coal`'s entire teaching
   content — `capacityFactor`, `capacityInactive`, per-mine limits — has nothing
   to bind against. With all 33 origins open and no capacity, a min-cost
   transportation LP collapses to "assign every customer to its cheapest origin"
   and there is no decision left to teach.
3. **`p-median-us` is structurally the same model**, so the fork has a working,
   tested, in-repo template at every layer.

---

## 4. The data package

```
solvers/delivery-teaching-us/
  manifest.json
  dataset/
    warehouses.json    33 records
    customers.json     313 records, demand inline
    distances.json     10,329 lanes   — read-only, the sole source for distance metrics
    costs.json         10,329 lanes   — seeded identical, student-overridable
    version.json       { version: 1, sha256 }
```

### 4.1 Measured properties of the source data

Every row below was produced by parsing the xlsx during design, not read off the
sheet by eye.

| Property | Value |
| --- | --- |
| Candidate DCs (`Plants`) | 33, ids non-contiguous: `1,2,3,4,6,7,8,9,11,12,14,15,16,17,19,22,25,27,28,35,38,39,43,44,45,52,55,57,60,66,99,116,152` |
| Customers | 313, ids contiguous `1..313`, no duplicates |
| Plants ⊂ Customers | All 33 plant ids exist in `Customers` with identical names — the DCs are co-located with 33 of the 313 cities |
| Distance matrix | 10,329 pairs = 33 × 313 exactly. **0 missing, 0 duplicate.** |
| Distance range | 0.0 – 3268.87 mi, including **33 zero-distance pairs** (each DC serving its own city) |
| Demand | All 313 customers covered. 56,000 – 9,145,000. **Total 208,829,000.** |
| Lanes ≤ 800 mi | 3,819 of 10,329 (37.0%) |
| Lanes **exactly** 800 mi | **0** — this is why decision 7 has no numeric effect here |
| Geographic extent | lat 25.7783 – 48.7306, lng −123.0804 – −68.8299; 48 distinct states; no Alaska/Hawaii outliers |

`Status` is `Potential` on all 33 plants and `Active` is `1` on all 33 plants and
all 313 customers. Both columns are constant, carry no information, and are not
transcribed.

### 4.2 Identifier scheme

Warehouse ids are `W` + the sheet's plant id (`W8`). Customer ids are `C` + the
sheet's customer id (`C8`). Lane keys are `"W8,C269"`.

The xlsx reuses one id space across the `Plants` and `Customers` sheets — plant
`8` and customer `8` are both Atlanta. Raw ids would make a lane read `"8,8"`
and make a CSV row whose `fromId` and `toId` are both `8` genuinely ambiguous to
a human reader. Prefixing removes that and keeps the source-sheet number visible
for traceability.

City slugs are not an option: customer names are not unique (ids `67` and `276`
are both "Albany").

This matches the current convention. `max-coverage-us` — the newest model — keys
`distances.json` by string ids (`"ALN,C1"`); `p-median-us` predates it and keys
by 1-based ordinals (`"1,1"`), which is the older form and is not copied.

### 4.3 Transcription rules

Transcription is performed by a committed script, `scripts/extract-cog-dataset.py`,
a sibling of the existing `scripts/extract-datasets.py` and
`scripts/extract-mining-dataset.py`. It is not hand-typed: 10,329 hand-checked
lanes is not a thing that happens, and a committed script means the dataset can
be regenerated and diffed against the xlsx.

- **Distances**: the sheet's 4 decimal places, verbatim. Values such as
  `622.11569999999995` are IEEE noise on `622.1157` and are written as the
  latter. No further rounding — the objective is what a student compares against
  the notebook.
- **Coordinates**: 6 decimals (`33.974044`), which is sub-metre.
- **Zip codes**: strings. `02101` must keep its leading zero.
- **Demand**: the `Demand` sheet's `Product ID` / `Product` / `Time Period ID` /
  `Time Period` columns are dropped (all singleton), as is a stray prose note in
  cell H2. Demand lands inline on each customer record.
- **The 33 zero-distance self-pairs are kept exactly as the sheet has them.** A
  DC serving its own city at zero miles is correct, and it is a large part of
  what makes the ≤400 mi band move.
- `costs.json` is written as a byte-for-byte copy of `distances.json`'s values
  under the same keys.

The extraction script needs its source, so the two COG source files — the xlsx
and `Network Optimization.ipynb` — are committed to `attached_assets/` with
their sha256 recorded in `attached_assets/NOTEBOOKS.md`, matching how the
Chapter 4, 9 and 10 source material was handled. `docs/CHANGELOG-implementation.md:448`
currently records "Chapter 5 — nothing to commit", which this supersedes and
which should be amended rather than left contradicting the tree.

The design-time prototype that produced §8.1's golden values is preserved at
`docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py`. It reads the
xlsx directly and depends on nothing in `solve.py`, which is what makes it an
independent check on the real implementation rather than a restatement of it.

### 4.4 Package registration

`PACKAGE_SPECS` (`lib/dataset-schema/src/index.ts:115`) gains an entry reusing
the existing shared Zod schemas — `max-coverage-us` sets the precedent for
reuse rather than a bespoke shape:

```ts
{
  modelId: "delivery-teaching-us",
  files: {
    "warehouses.json": z.record(z.string(), WarehouseEntry),
    "customers.json":  z.record(z.string(), CustomerEntry),
    "distances.json":  DistanceMap,
    "costs.json":      DistanceMap,
  },
}
```

`costs.json` reuses `DistanceMap` because the shape is identical — a record of
`"from,to"` to number. `computeSha256` hashes the `files` keys in sorted
filename order, so `costs.json` is inside the integrity hash and a desynchronised
dataset fails at boot rather than at solve time.

`MODEL_IDS` in the same file (`:269`) is a separate hardcoded list and also needs
the new id.

---

## 5. The solver

### 5.1 Approach

Approach A of three considered: **a new `solve_delivery()` function and a new
`modelType: "delivery"`**, adding one branch to the dispatcher at `solve.py:1473`
and changing zero lines in any existing solver.

The alternatives were to extend `solve_pmedian()` with optional cost parameters
(one code path, but every Chapter 3 solve — the most-used lab — then runs
through changed code), or to extract a shared p-median core for both to call
(cleanest in the abstract, but a refactor of a 1,556-line file that all six
models depend on, putting all six in the blast radius).

A was chosen because one self-contained `solve_<x>()` per model is this repo's
existing, deliberate trade — six of them, with per-model accuracy tests and no
shared core. A new model that follows it is reviewable in isolation and cannot
regress Chapter 3. The cost is that the p-median assignment/open-facility
formulation exists twice. If that ever becomes a real maintenance burden, the
extraction is the fix, and it is easier once two copies exist with tests pinning
both.

### 5.2 Dataset loading

Module-level, alongside the existing loaders:

```python
DELIV_WAREHOUSES = _safe_load("delivery-teaching-us", "warehouses.json", default={})
DELIV_CUSTOMERS  = _safe_load("delivery-teaching-us", "customers.json",  default={})
_DELIV_DIST_RAW  = _safe_load("delivery-teaching-us", "distances.json",  default={})
_DELIV_COST_RAW  = _safe_load("delivery-teaching-us", "costs.json",      default={})
```

Both lane maps parse `"W8,C269"` into `(w, c)` tuples. `_safe_load` routes a
malformed package into `_load_error_envelope` rather than crashing the worker,
and `solve_delivery` opens with the same `if _LOAD_ERRORS.get(...)` guard every
other solver has.

### 5.3 Payload contract

What `buildPayload()` sends:

```
modelType:          "delivery"
pValue:             int
distanceBands:      number[]
gap, timeLimitSec
laneCostOverrides:  [{ fromId, toId, cost }]
costAdjustEnabled:  bool
distanceThreshold:  number
costPerMile:        number
costPerMileOver:    number
```

### 5.4 Effective cost

Built once, before the LP:

```python
cost = {**base_cost,
        **{(o["fromId"], o["toId"]): o["cost"] for o in lane_cost_overrides}}

if cost_adjust_enabled:
    ec = {k: v * (cost_per_mile if dist[k] <= threshold else cost_per_mile_over)
          for k, v in cost.items()}
else:
    ec = cost
```

Overrides land on `cost` and only on `cost`. **`dist` is read-only for the whole
function.** That single property is what makes every downstream distance metric
trustworthy, and it is the invariant §8.2's tests exist to defend.

An override naming an unknown warehouse or customer raises the existing
`UnresolvableIdError`, the same failure `transport-coal`'s bridge produces.

**No `build_merged_delivery_dataset` in `merge_inputs.py`.** That module exists
to reconcile *added* entities against ordinal-indexed datasets. Decision 11 adds
no entities and §4.2's ids are already strings, so the merge is the two-line
dict overlay above. If added warehouses or customers are ever wanted, that is
when the bridge gets written.

### 5.5 The LP

In `p-median-us`'s idiom (`solve.py:392-421`):

```python
prob = LpProblem("Delivery", LpMinimize)
A    = LpVariable.dicts("A", [(w, c) for w in warehouses for c in customers], 0, 1, cat='Binary')
Open = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

prob += lpSum(ec[(w, c)] * demand[c] * A[w, c] for w in warehouses for c in customers)

for c in customers:                                    # 313 rows
    prob += LpConstraint(lpSum(A[w, c] for w in warehouses),
                         LpConstraintEQ, f"served_{c}", 1)

prob += LpConstraint(lpSum(Open[w] for w in warehouses),
                     LpConstraintLE, "FacilityCount", p)      # 1 row — note LE

for w in warehouses:                                   # 10,329 rows
    for c in customers:
        prob += LpConstraint(A[w, c] - Open[w], LpConstraintLE, f"route_{w}_{c}", 0)

cbc = _run_cbc(prob, gap, time_limit, problem_uid="delivery")
```

Two deliberate choices:

**`LpConstraintLE` on `FacilityCount`.** `solve.py:405` uses `LpConstraintEQ`
for `p-median-us`. This model uses `<=`, matching the COG notebook's
`lpSum(use_plant) <= max_plants`. With no fixed facility cost the optimum always
uses all `P`, so the two forms give the same answer here — but the divergence is
deliberate and gets a test (§8.2) so that a later reader does not "fix" it.

**Per-pair linking rather than the aggregated `Σ_c A[w,c] <= |C|·Open[w]`.** The
aggregated form is 33 rows instead of 10,329, but its LP relaxation is far
weaker and CBC branches much more. The per-pair form is both faithful to the
notebook and faster. §8.1's measured 4.0 s solve is with the per-pair form.

### 5.6 Post-solve

```python
dist_weighted = 0.0
for (w, c) in assigned_pairs:
    d = dist[(w, c)]                      # distance table. never ec, never cost.
    dist_weighted += d * demand[c]
    edges.append({"fromId": w, "toId": c, "flow": round(demand[c]),
                  "distance": d, "band": band_idx})
    for b in distance_bands:
        if d <= b:
            band_demand[b] += demand[c]

weighted_avg_distance = dist_weighted / total_demand
```

Three things here are load-bearing.

**`weighted_avg_distance` is its own accumulator.** It is *not*
`obj_val / total_demand`. That expression is what `solve.py:483` (p-median) and
`solve.py:628` (transport) do, and it is correct for them only because their
objectives are distance-weighted. The moment the cost toggle is on, it returns
dollars-per-unit under a distance label — no exception, no failing assertion,
just a wrong number on screen.

This repo has already been bitten by this bug class **twice**: Chapter 9 and
Chapter 10 both shipped it and both now carry a regression test named
`test_avg_distance_not_derived_from_objective`
(`test_two_echelon.py:91`, `test_jade.py:153`), and `solve.py:114-117` carries a
comment warning about it by name. This model is the third case and gets the same
guard.

**`edges[].distance` carries the real distance, not the effective cost.**
`ServiceStatsTab.tsx:289` recomputes live band coverage client-side from
`edges[].distance` whenever a student changes the bands. Put cost there and the
coverage bars silently become a cost histogram with mile labels.

**`band_demand` accumulates cumulatively** (`if d <= b` inside the band loop),
matching `solve.py:478-480` and the `Outputs Needed` sheet's reading. The
repo's band coverage is cumulative end-to-end: the solver metric, and
`computeCumulativeBandCoverage` (`lib/units/src/bands.ts:37`) which
`ServiceStatsTab.tsx:289` consumes. The exclusive `computeBandCoverage`
(`artifacts/studio/src/lib/bands.ts:88`) still exists but no longer feeds
coverage bars — only route colouring via `assignBand`.

### 5.7 Emitted envelope

```python
_envelope(cbc.solutionStatus, status_str, round(obj_val), run_time, edges,
          {"utilizationByNode": utilization,
           "bandCoverage": band_coverage,
           "weightedAvgDistance": round(weighted_avg_distance, 1)},
          {"openWarehouseIds": open_ids,
           "assignments": assignments,
           "objective": "cost_adjusted" if cost_adjust_enabled else "base"},
          ...)
```

`details.objective` exists to drive units — see §6.5. No new `MetricsSchema`
fields are needed; `weightedAvgDistance` and `bandCoverage` are already optional
members of the shared schema (`resultEnvelope.ts:34`).

### 5.8 Failure modes

With no capacity and `P >= 1` the model is always feasible, so there is no
infeasibility story to write; the Zod bound `p: 1..33` prevents the one
degenerate case. `_run_cbc` already honours `gap`/`timeLimitSec` and reports
`terminationReason`/`achievedGap`, so a slow solve degrades to a gap-limited
answer rather than hanging. §8.1 measures the real solve at 4.0 s.

---

## 6. API and contract

### 6.1 Manifest

`solvers/delivery-teaching-us/manifest.json`:

```json
{
  "id": "delivery-teaching-us",
  "name": "Delivery Company Teaching Example",
  "chapter": "Chapter 5",
  "datasetDir": "solvers/delivery-teaching-us/dataset",
  "countryBounds": { "sw": [24, -125], "ne": [50, -66] },
  "distanceUnit": "mi",
  "capabilities": {
    "supportsP": true,
    "capacityModes": [],
    "demandEditable": false,
    "outputGrids": ["openWarehouses", "assignments", "costSummary", "serviceStats"],
    "supportsFacilityStatus": false,
    "supportsReferenceDistances": false,
    "supportsReferenceCosts": true,
    "supportsAddedCustomerExclusion": false
  },
  "inputsSchema": {
    "type": "object",
    "properties": {
      "p": { "type": "integer", "minimum": 1, "maximum": 33 },
      "distanceBands": {
        "type": "array",
        "items": { "type": "number", "exclusiveMinimum": 0 },
        "minItems": 1
      },
      "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "integer", "minimum": 1 },
      "costAdjustEnabled": { "type": "boolean" },
      "distanceThreshold": { "type": "number", "exclusiveMinimum": 0 },
      "costPerMile": { "type": "number", "exclusiveMinimum": 0 },
      "costPerMileOver": { "type": "number", "exclusiveMinimum": 0 },
      "laneCostOverrides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "fromId": { "type": "string", "minLength": 1 },
            "toId": { "type": "string", "minLength": 1 },
            "cost": { "type": "number", "exclusiveMinimum": 0 }
          },
          "required": ["fromId", "toId", "cost"]
        }
      }
    },
    "required": [
      "p", "distanceBands", "gap", "timeLimitSec",
      "costAdjustEnabled", "distanceThreshold", "costPerMile", "costPerMileOver"
    ]
  }
}
```

`inputsSchema` is the manifest-level JSON Schema mirror of §6.2's Zod schema,
following `transport-coal`'s manifest. The Zod schema remains the enforcing
copy; this one is descriptive, and the two are kept in step by
`deliveryContract.test.ts` (§8.3).

`countryBounds` reuses `p-median-us`'s proven continental-US box. The measured
extent (§4.1) sits strictly inside it, so no bespoke bounds are needed and the
map framing matches Chapter 3.

`outputGrids` fully determines the output tab set — `Workspace.tsx:3643` and
`:3938` gate on `OUTPUT_ENTITY_TO_CAPABILITY` lookups against this array, never
on `modelId`. So this model gets Open Warehouses, Customer Assignments, Solution
Summary and Service Stats, and no Flows tab, with no `Workspace.tsx` change for
output tabs.

**`supportsFacilityStatus: false` has a visible consequence.** That flag gates
Input-Map status paint (R3), hide-closed (R7), `MapLegend` status entries, *and*
the Solution Summary "Open facilities" row (`CostSummaryTab.tsx:488`). Setting
it false is correct — decision 11 gives students no way to force a DC open or
closed, and setting it true would light up editing affordances backed by no
data, which is precisely the bug class that caused Chapter 10's Round-1
regressions. The cost is that the Solution Summary will not list the chosen
DCs. They remain visible in the dedicated **Open Warehouses** output tab and on
the output map, which is where a student looks for them anyway.

### 6.2 Input validation

New `artifacts/api-server/src/validation/inputs/delivery.ts`:

```ts
const laneCostOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId:   z.string().min(1),
  cost:   z.number().positive(),
});

export const deliveryInputsSchema = z.object({
  p:                 z.number().int().min(1).max(33),
  distanceBands:     z.array(z.number().positive()).min(1),
  gap:               z.number().min(0),
  timeLimitSec:      z.number().int().min(1),
  costAdjustEnabled: z.boolean().default(false),
  distanceThreshold: z.number().positive(),
  costPerMile:       z.number().positive(),
  costPerMileOver:   z.number().positive(),
  laneCostOverrides: z.array(laneCostOverrideSchema).default([])
    .refine(noDuplicatePairs,
      { message: "laneCostOverrides must not contain duplicate (fromId, toId) pairs" }),
});
```

Two notes:

- The three rate fields are **always present**, with defaults, whether or not
  the toggle is on. Toggling on must never have to invent values, and a scenario
  cloned with the toggle off must retain the rates the student had configured.
- `costPerMileOver >= costPerMile` is **not** enforced. The case study uses 1 and
  10, but a student exploring a long-haul discount is doing legitimate
  what-if work, and an invented constraint would block it.

Registered in `KNOWN_SCHEMAS` (`registry/modelRegistry.ts:19`).

### 6.3 Routes

- `VALID_MODEL_IDS` (`routes/scenarios.ts:92`) gains the id. Missing this
  returns 422 on every `POST /scenarios` and is the checklist's most-missed item.
- `normalizeAddedEntityDistances` (`routes/scenarios.ts:450`) needs **no** entry.
  It dispatches per-model haversine fill for *added* entities; decision 11 adds
  none, and the function's `return data` fallback is the correct behaviour.
- The export/import `entityIs*` gate chains (`:906-922`, `:1602-1618`,
  `:1670-1686`) need **no** entry — see §7.4, import/export is out of scope.
- `GET /dataset` (`routes/dataset.ts:12`) gains a branch returning
  `{ warehouses, customers }`. This endpoint returns *only* entities, never lane
  tables, so the 10,329-lane files never reach the browser through it.

### 6.4 Reference costs

The cost table is the only editable input, and it is a sparse override list. A
student who has overridden nothing would otherwise see an empty table — which
fails the "add an input table for cost" requirement outright. They need to see
the base costs.

`GET /models/:id/reference-distances` (`routes/referenceDistances.ts:18`) already
solves this exact problem for distances: a capability-gated, unauthenticated,
model-scoped, read-only base matrix with an explicit ETag derived from the
package's `version.json` sha256 and a 304 revalidation path. Its data layer
(`data/referenceDistances.ts`) is deliberately structured as a per-model
`REFERENCE_DISTANCES_BY_MODEL` registry so a new model registers a builder
without the route changing.

This design adds the cost-side mirror rather than overloading the distance one:

- New capability `supportsReferenceCosts`, defaulting `false`, so no existing
  model's behaviour changes. A capability is not one declaration but four:
  `ManifestSchema.capabilities` (`lib/dataset-schema/src/index.ts:226`, as
  `z.boolean().optional().default(false)`), the public capabilities type and its
  mapping in `registry/modelRegistry.ts:75,102`, the `ModelInfoCapabilities`
  schema in `openapi.yaml`, and the regenerated `lib/api-zod` /
  `lib/api-client-react` types. Declaring it only in the manifest leaves it
  invisible to the frontend, which reads capabilities off `GET /api/models`.
- New route `GET /models/:id/reference-costs`, a direct structural mirror of
  `referenceDistances.ts` including the 422-on-unsupported, the explicit ETag and
  the `if-none-match` 304.
- New `data/referenceCosts.ts` with a `REFERENCE_COSTS_BY_MODEL` registry and a
  `delivery-teaching-us` builder reading `costs.json`.
- Response `{ pairs: [{ fromId, fromCode, toId, toCode, cost }], distanceUnit }`.

Serving costs through the `reference-distances` endpoint was rejected: its
payload field is named `distance`, and shipping cost values in it would be a
lie in the contract that some future reader would have to discover.

The response is ~10,329 pairs in one document. It is ETag-cached with
`must-revalidate`, so a student pays it once per dataset version.

### 6.5 Objective units

`Σ ec·demand·A` changes dimension with the toggle. With the adjustment off, `ec`
is billable miles and the objective is demand-miles. With it on, `ec` is dollars
per unit and the objective is dollars.

`objectiveDimension()` (`lib/units/src/objective.ts:20`) already takes an
`objectiveMode` second argument for exactly this — `max-coverage-us` switches
between `"percent"` and `"demand-distance"` on it (`:31-32`). The new case:

```ts
case "delivery-teaching-us":
  return objectiveMode === "cost_adjusted" ? "monetary" : "demand-distance";
```

**This function is an 11th registration point and it fails silently.** Its
`default:` returns `"opaque"`, which `formatObjective` renders as a bare
unit-less number (`lib/formatObjective.ts:92-94`). No error, no test failure.
Its own doc comment calls it "THE ONLY place in the repo where `modelId`
determines unit semantics", and it is **not** in `model-integration-precheck.md`'s
ten-point Gate 1 list. §9 records the corrected list.

### 6.6 OpenAPI

The `modelId` enum appears in four places in `lib/api-spec/openapi.yaml` — the
`GET /dataset` query parameter, the `GET /scenarios` query parameter, the
`Scenario` schema property and the `ScenarioInput` schema property. All four
need the new id. The `reference-costs` route and its response schema are added
alongside the existing `reference-distances` ones.

Then `pnpm --filter @workspace/api-spec run codegen`.
`lib/api-client-react` and `lib/api-zod` are generated and must never be
hand-edited.

Scenario `inputs` is typed as a free-form `type: object` in the contract by
design — per-model shape is enforced only by the Zod validators of §6.2.

---

## 7. Frontend

### 7.1 Chapter registration

`artifacts/studio/src/lib/chapters.ts`: `StudioModelType` gains a seventh member,
and `CHAPTERS` gains

```ts
{
  path: "/chapter-5/delivery",
  modelId: "delivery-teaching-us",
  chapter: "Chapter 5",
  title: "Delivery Company Teaching Example",
  description: "Facility location driven by a cost table: open three DCs to minimise delivery cost, then watch the network change when long lanes are repriced.",
  workspace: true,
  labHeaderTitle: "Delivery Company · Model Lab",
  labHeaderSubtitle: "Ch 5 · p-median · cost table vs distance table",
}
```

No `hiddenFromLanding`, no `locked` (decisions 4 and 14). The two existing
Chapter 5 entries are not touched — three cards will carry a "Chapter 5" label,
of which two stay hidden.

### 7.2 Default inputs

`defaultInputsForModel` (`Workspace.tsx:125`) gains:

```ts
case "delivery-teaching-us":
  return {
    p: 3,
    distanceBands: [400, 800, 1200, 1600],
    gap: 0,
    timeLimitSec: 120,
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    laneCostOverrides: [],
  };
```

The bands are the `Outputs Needed` sheet's four. The rate defaults are the
`Trans Costs` sheet's Scenario 2. A fresh scenario therefore opens as the case
study's Scenario 1 and becomes Scenario 2 with one click.

### 7.3 The "Adjust Cost Table" control

Lives in `OptimizationParametersTab.tsx`, which gates every control on **prop
presence** rather than on `modelId` — `{capacityFactor != null && (...)}` at
`:388`, `singleSource` at `:411`, `capacityInactive` at `:423`, `bomRatio` at
`:438`. The four new fields follow that pattern, so they render for this model
and for nothing else, with no `modelId` check added to the component.

Concretely, three edits to that file:

1. `OptimizationParametersField` (`:10-30`) gains `"costAdjustEnabled"`,
   `"distanceThreshold"`, `"costPerMile"`, `"costPerMileOver"`. The existing
   `onChange` signature already accepts `number | number[] | boolean` (`:132`),
   so the boolean needs no widening.
2. `OptimizationParametersTabProps` (`:32-133`) gains the four optional props.
3. A new presence-gated JSX block placed **with the `capacityFactor` /
   `singleSource` / `capacityInactive` family at `:388-437`** — after the
   ungated gap and time-limit inputs, and outside the `{objective != null &&
   (...)}` block at `:235-359`.

That placement is deliberate and load-bearing, for a reason external to this
design: see §7.7.

Behaviour: a button labelled **"Adjust Cost Table"** toggles
`costAdjustEnabled`. When on, three numeric fields appear — Distance Threshold,
Cost per mile, Cost per mile over the threshold — and a one-line explanation of
the rule, so a student can read what the toggle does without opening the
notebook. When off, the fields collapse but their values persist in the
scenario's inputs (§6.2).

This is a solver parameter, not a data edit. It never writes to `costs.json` and
never writes to `laneCostOverrides` (decision 5). Turning it off restores the
original costs exactly, and turning it on twice is idempotent — both properties
that the "rewrite the table" alternative would have lost.

### 7.4 The cost table tab

A new `DeliveryCostsTab.tsx`, modelled directly on `DistancesTab.tsx`:

- Sparse override rows the student has set, merged read-only with the base rows
  from `GET /models/:id/reference-costs` (§6.4) — the same `baseByKey` /
  `overrideByKey` / `mergedRows` structure `DistancesTab.tsx:362-390` uses for
  `supportsReferenceDistances` models.
- `PAGE_SIZE = 50` pagination, no virtualisation, matching `DistancesTab.tsx:330`.
- Two free-text substring filters (from / to), matching `:624-643`. With 10,329
  base rows these filters are not a nicety — they are the only practical way to
  reach a given lane, and the plan should treat "filter to a city, edit its cost"
  as the primary interaction rather than paging to row 4,000.
- Add-a-row uses typed ids, as `DistancesTab.tsx:660-698` does. Validation is
  non-empty ids, positive cost, and pair-not-already-overridden.

Wiring in `Workspace.tsx` follows the existing per-model input-tab gates around
`:2140-2200` and the tab-content render gates around `:3356-3465`.

**Import/export is deliberately out of scope for v1.** Registration point 9 —
`services/templates.ts`, `services/import.ts`'s `ImportEntity` union and
`COLUMNS`/`ENTITY_HAS_VALUE` tables, and three near-duplicated pairing-check
blocks in `routes/scenarios.ts` — is the single largest registration point, and
decision 11 chose the leanest editing surface. The sparse override model means a
student edits a handful of lanes, which the in-app editor handles. If bulk cost
editing is later wanted, it is an additive follow-up that changes nothing
specified here.

### 7.5 Objective display

`ObjectiveBar.tsx:43` routes through `formatObjective(modelId, objectiveMode, ...)`,
so the §6.5 `objectiveDimension` case is the whole change. With the toggle on
the objective renders as currency; with it off, as demand-miles.

### 7.6 Solution Summary

`CostSummaryTab.tsx` needs **no change**. Its rows are gated on metric presence,
not `modelId` (`:325-329`, and the row list at `:342-358`), and this model emits
`weightedAvgDistance`, so "Weighted avg. distance" (`:350`) appears in both the
single-scenario and compare views automatically. The "Open facilities" row is
absent by §6.1's `supportsFacilityStatus: false`.

Service Stats renders the four bands from `bandCoverage`, recomputing live from
`edges[].distance` when a student edits the bands (`ServiceStatsTab.tsx:288-290`).

### 7.7 Coordination with the in-flight Chapter 4 two-step work

`docs/superpowers/plans/2026-09-28-ch4-two-step-workflow.md` is merged to `main`
and not yet implemented. It edits three of the files this design also edits, so
the implementation plan must sequence around it rather than discover the
collision at merge time. Verified against that plan file:

| File | What the Ch4 plan does | Overlap with this design |
| --- | --- | --- |
| `OptimizationParametersTab.tsx` | Removes the Chapter 4 objective toggle | **Direct.** §7.3 adds the Adjust Cost Table control to this file. |
| `SolveDialog.tsx` | Removes the same toggle from its second mount | None — this design does not touch it, but it is the sibling mount that this repo's recurring bug class is about. |
| `Workspace.tsx` | Deletes `setChenObjectiveMode` and `MAX_COVERAGE_DEFAULT_COVERAGE_FLOOR_DEMAND` | **Indirect.** §7.2 and §7.4 add a `defaultInputsForModel` case and tab gates to this file. Different regions, same file. |
| `SidebarTree` | Adds an opt-in `keepOutputsClickable` prop | None. |

The `OptimizationParametersTab.tsx` overlap is the one that matters, and it is
**not in the JSX**. Measured at `32cacf8`:

| Region | Lines | Who touches it |
| --- | --- | --- |
| `OptimizationParametersField` union | 10–30 | **both** — Ch4 adds `"step2Gap" \| "step2TimeLimitSec"`, this design adds four |
| `OptimizationParametersTabProps` | 32–133 | **both** — Ch4 removes `onObjectiveModeChange` and `coverageFloorDemand` (`:107`) and adds five; this design adds four |
| `{objective != null && (` gate, and its `chen-objective-section` div | 235–236, 358–359 | neither — retained |
| the objective toggle div | 237–262 | Ch4 only — deleted |
| `{objective === "coverage" && (...)}` | 316–341 | neither — retained |
| `{objective === "min_distance" && (...)}` coverage floor | 343–357 | Ch4 only — deleted |
| gap / time limit, ungated | 361–382 | neither |
| `capacityFactor` / `singleSource` / `capacityInactive` / `bomRatio` gates | 388 / 411 / 423 / 438 | this design only |

Ch4 deletes two interior spans, not the enclosing block: the gate at 235 and
its closing `)}` at 359 survive, because the `objective` prop itself stays.
Their last deleted line is therefore **357**, and the first line this design
adds beside is **388** — thirty lines strictly between (358–387), far outside
git's three-line default context, so **the JSX hunks merge without a conflict
marker**.

The actual conflict is the union on one line and the props interface across
one hundred, where both changes add members. Rebasing therefore means
reconciling a type and an interface, not relocating JSX — a different and
easier job than "move your component block", but one that a reviewer skimming
for JSX conflicts will miss entirely.

*(This section's line numbers have been corrected twice, and both corrections
are left visible rather than swapped in silently — a spec whose refs were
quietly rewritten is indistinguishable from one that was right the first time.
Rev 1 put the collision at `:378-419`; that range came from a recon pass
reading `b7bb21a`, before the Chapter 4 migration merged, and at `32cacf8`
line 378 sits inside the ungated time-limit input. Rev 2 then treated the
whole `235–359` block as deleted and computed a 29-line gap; in fact only the
two interior spans go, the last deleted line is 357, and the gap is 30. Every
number in the table above was read off `32cacf8` directly.)*

**The step wrapper.** The Chapter 4 plan's Task 7 wraps its whole block in
`{(step ?? 1) === 1 && ...}` so Step 1 and Step 2 render exclusively. Anything
gated only on prop presence *inside* that wrapper silently stops rendering on
Step 2. §7.3 therefore places the Adjust Cost Table block **outside** it, with
the `capacityFactor` family at `:388-437`. This model has no step concept, its
control must render whenever its props are present, and the placement is stated
rather than left to be inferred from a diff.

This is worth stating rather than leaving to chance because this repo's
most-documented recurring bug class is exactly "a shared component's gate
extended for one model but not its sibling" — caught across two separate
features already. A Chapter 4 change that removes a toggle from both mounts and
adds an exclusive step wrapper, landing beside a Chapter 5 change that adds a
control to one of those mounts, is that pattern's natural habitat.

**Ordering.** The Chapter 4 work lands first: it is a deletion spanning two
files, this is an addition in one, and rebasing an addition onto a completed
deletion is the cheaper direction.

---

## 8. Testing

### 8.1 Golden values

A prototype of §5.5's exact formulation was built against the real xlsx and
solved with PuLP 3.3.2 / CBC during design. These are measured outputs, and they
are what the accuracy tests pin.

| | Scenario 1 — base (`costAdjustEnabled: false`) | Scenario 2 — adjusted (`true`, 800 / 1 / 10) |
| --- | --- | --- |
| `p` | 3 | 3 |
| Status | Optimal | Optimal |
| Objective | 88,240,913,478.10 | 150,194,534,098.60 |
| Open DCs | `W1` Los Angeles, `W2` New York City, `W60` Louisville | `W6` Detroit, `W43` New Orleans, `W45` Salt Lake City |
| Weighted avg. distance | 422.5511 mi | 508.6534 mi |
| % demand within 400 mi | 59.38 | 26.43 |
| % demand within 800 mi | 81.45 | 97.19 |
| % demand within 1200 mi | 99.44 | 100.00 |
| % demand within 1600 mi | 100.00 | 100.00 |
| CBC solve time | 4.0 s | 1.0 s |

Two things this buys beyond test fixtures.

**The teaching point is confirmed, not hoped for.** The threshold rule replaces
all three DCs, lifts 800-mile coverage from 81.45% to 97.19%, and *worsens*
average distance from 422.55 to 508.65 mi. A student can be asked why cost
optimisation under a threshold penalty trades average distance for threshold
coverage, and the model actually demonstrates it.

**The performance risk is closed.** 10,362 binaries against `p-median-us`'s
5,200 was the open question in §5.8. Measured at 4.0 s and 1.0 s, it is not a
risk. `timeLimitSec: 120` has ample headroom.

Objective values are pinned with a relative tolerance rather than exact equality
— CBC is deterministic for a fixed input but the values are ~10¹¹ and float
formatting across platforms is not worth a flaky gate. Open-DC sets, the
weighted average distance to 4 dp, and the band percentages to 2 dp are pinned
exactly.

### 8.2 Solver tests — `artifacts/api-server/src/solver/tests/test_delivery.py`

Modelled on `test_max_coverage.py`, the newest and most complete per-model
template.

| Test | Pins |
| --- | --- |
| `test_scenario_1_golden` | §8.1's base column end to end |
| `test_scenario_2_golden` | §8.1's adjusted column end to end |
| `test_avg_distance_not_derived_from_objective` | With `costPerMileOver = 10`, the reported `weightedAvgDistance` equals the hand-computed distance mean and **not** `objective / totalDemand`. The §5.6 bug class, third occurrence. Cloned from `test_two_echelon.py:91`. |
| `test_cost_override_does_not_move_distance_metrics` | A `laneCostOverride` changes the objective and leaves `weightedAvgDistance` and `bandCoverage` untouched when the assignment is unchanged. The §5.4 invariant. |
| `test_threshold_boundary_is_inclusive` | A synthetic lane at exactly the threshold bills at `costPerMile`, not `costPerMileOver`. Decision 7 — untestable on the real dataset, which has no such lane, so this one is synthetic by necessity. |
| `test_facility_count_is_at_most_p` | `Σ open <= p`, and the constraint sense is `LE`. Decision 8, guarding against a later "fix" to `EQ`. |
| `test_single_source` | Every customer has exactly one assignment with `flow == demand`. |
| `test_band_coverage_is_cumulative` | Band percentages are non-decreasing across ascending bands. |
| `test_edges_carry_distance_not_cost` | With the toggle on, `edges[].distance` matches `distances.json`, not `ec`. The §5.6 live-coverage trap. |
| `test_toggle_off_equals_unit_rate` | `costAdjustEnabled: false` and `true` with both rates `= 1` give the same objective. Confirms §5.4's claim that "off" is the case study's Scenario 1. |

`test_datasets.py` gains a `delivery-teaching-us` case: 33 warehouses, 313
customers, 10,329 lanes in each of `distances.json` and `costs.json`, no missing
pairs, and the two files agreeing at seed.

### 8.3 Contract and API tests

- `artifacts/api-server/src/__tests__/deliveryContract.test.ts` — `buildPayload`
  translation and `deliveryInputsSchema` acceptance/rejection, mirroring
  `maxCoverageContract.test.ts`.
- `referenceCosts.test.ts` — 200 with pairs, 422 for a model without the
  capability, ETag present, 304 on matching `if-none-match`. Mirrors
  `referenceDistances.test.ts`.
- `registry.test.ts` and `lib/dataset-schema/src/manifest.test.ts` gain
  per-model capability rows, as they have for every prior model.

### 8.4 Studio tests

- `OptimizationParametersTab` — the Adjust Cost Table button renders the three
  fields when on, collapses them when off, and preserves their values across the
  toggle.
- `DeliveryCostsTab` — base rows merge with overrides, filters narrow, pagination
  works at 10,329 rows.
- `formatObjective` / `objectiveDimension` — currency when `cost_adjusted`,
  demand-miles when `base`, and explicitly **not** `"opaque"`. This test is the
  guard for §6.5's silent-failure mode.
- `chapters.test.ts` — the new entry is visible on Landing and the two existing
  Chapter 5 entries remain hidden.

### 8.5 Playwright

`e2e/delivery-teaching.spec.ts`, modelled on `max-coverage.spec.ts`: create a
scenario → solve → assert §8.1's Scenario 1 open-DC set and weighted average
distance → toggle Adjust Cost Table → re-solve → assert the DC set flips to
Scenario 2's and 800-mile coverage rises → override one lane's cost → re-solve →
assert the objective moves and the distance metrics behave per §8.2.

`e2e_accuracy.py` and `e2e_journey.py` gain a `delivery` case each, following
their existing relative-assertion style.

---

## 9. Registration checklist

`model-integration-precheck.md` documents ten Gate 1 points. Two more were found
during this design and both fail silently. The working list for this model:

| # | Point | File |
| --- | --- | --- |
| 1 | Manifest | `solvers/delivery-teaching-us/manifest.json` |
| 2 | Dataset version | `solvers/delivery-teaching-us/dataset/version.json` |
| 3 | Zod schema + `KNOWN_SCHEMAS` | `validation/inputs/delivery.ts`, `registry/modelRegistry.ts:19` |
| 4 | Route allowlist | `routes/scenarios.ts:92` — most-missed |
| 5 | Package spec | `lib/dataset-schema/src/index.ts:115` |
| 6 | Payload builder + `SolveInput` union | `solver/pmedian.ts:8` |
| 7 | OpenAPI enum ×4, then codegen | `lib/api-spec/openapi.yaml` |
| 8 | Solver dispatcher | `solver/solve.py:1473` |
| 9 | Override entity import/export | **N/A — out of scope, §7.4** |
| 10 | Map multi-select allowlist | `Studio.tsx` — N/A, no bulk entity editing |
| **11** | **`objectiveDimension()`** | **`lib/units/src/objective.ts:20` — silent `"opaque"` on miss** |
| **12** | **`MODEL_IDS`** | **`lib/dataset-schema/src/index.ts:269`** |

Plus `chapters.ts`'s `StudioModelType` union and `CHAPTERS` entry,
`defaultInputsForModel`, and `routes/dataset.ts`.

Points 11 and 12 should be folded back into `model-integration-precheck.md` as
part of this work, so the eighth model does not rediscover them.

---

## 10. Out of scope

Stated so that their absence reads as a decision rather than an omission:

- **CSV/JSON import/export for the cost table** — §7.4. Additive later.
- **Editing demand, adding warehouses or customers, excluding customers,
  facility open/close status** — decision 11.
- **Any capacity constraint** — decision 12.
- **Changes to `transport-coal` or `p-median-brazil`**, including their Landing
  visibility — decision 4.
- **A distance-table editor.** Distances are read-only by §5.4's invariant; a
  student who wants a different distance edits the cost instead, which is what
  "billable miles" means.
- **Multi-product / multi-period** — §2.1.

---

## 11. Risks

| Risk | Assessment |
| --- | --- |
| Solve time at 10,362 binaries | **Closed.** Measured 4.0 s / 1.0 s (§8.1). |
| `weightedAvgDistance` derived from the objective | **Known bug class, twice regressed.** Mitigated by §5.6's separate accumulator and §8.2's guard test. |
| `objectiveDimension` missed | **Silent failure.** Mitigated by §8.4's explicit not-`"opaque"` assertion. |
| `reference-costs` payload size | ~10,329 pairs, ETag-cached with `must-revalidate`; paid once per dataset version. Acceptable, and identical in shape to what `p-median-us` already serves. |
| Three "Chapter 5" cards, two hidden | Cosmetic. Landing shows one; the label is only visibly duplicated if the other two are ever unhidden. |
| Dataset transcription error | Mitigated by a committed, re-runnable extraction script (§4.3) and `test_datasets.py`'s shape assertions, plus the §8.1 goldens which were computed from the xlsx directly and would not reproduce from a corrupted transcription. |
