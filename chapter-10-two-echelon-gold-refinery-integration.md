# Chapter 10 — Two-echelon gold refinery siting

Integration plan for adding the Chapter 10 mining problem as a fourth playable model.

- **Model id:** `two-echelon-gold-au`
- **Wire `modelType`:** `two_echelon`
- **Source:** Watson et al., *Supply Chain Network Design*, Ch. 10 Q4 (`Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb`)

**Read first:** [`model-integration-precheck.md`](./model-integration-precheck.md) — the generic
gates every model integration must pass. This document covers only what is specific to Chapter 10.

---

## 1. The problem

A gold mine at Kalgoorlie (Western Australia) supplies ten jewellery customers on the east coast.
Raw gold must be refined before delivery. Two candidate refinery sites exist: **Daggar Hills**
(294 km from the mine, ~2,191 km average to customers) and **Cunnamulla** (1,465 km from the mine,
~688 km average to customers).

Refining is not 1:1. A **bill-of-materials (BOM) ratio** governs how many kilos of raw gold produce
one kilo of refined gold.

| Scenario | BOM ratio | Optimal refinery |
|---|---|---|
| 1 | 1.1 | Cunnamulla — customer-adjacent |
| 2 | 2.0 | Daggar Hills — mine-adjacent |

**The BOM ratio is the lesson, not a parameter.** At 2.0, nearly double the mass travels the
mine→refinery leg, so being 294 km from the mine outweighs being far from customers. The general
principle — site a facility near whichever side carries the heavier flow — is why this exercise
exists.

Every design decision below serves making that flip *visible*. A solver that returns correct
objectives while hiding the flip has failed the exercise.

---

## 2. Model

Minimize total distance-weighted flow across both legs, where `TRUCKLOAD_KG = 44000` converts kilos
to truckloads (the notebook's cost divisor — preserve it).

**Variables**
- `x[p,r] ≥ 0` — raw gold, mine → refinery
- `y[r,c] ≥ 0` — refined gold, refinery → customer
- `open[r] ∈ {0,1}` — refinery built

**Constraints**
1. Demand: `Σ_r y[r,c] = demand[c]` ∀c
2. Single site: `Σ_r open[r] = 1`
3. Big-M link: `Σ_c y[r,c] − totalDemand · open[r] ≤ 0` ∀r
4. BOM balance: `Σ_p x[p,r] = bomRatio · Σ_c y[r,c]` ∀r

### Correction to the source notebook

The notebook writes constraint 4 **per `(p,r)` pair**:

```python
for p in plants:
    for r in refineries:
        prob += x[p,r] - bom * lpSum(y[r,c] for c in customers) == 0
```

This requires *each individual mine* to supply the refinery's full raw requirement. With one mine it
is correct. With two it forces `2 × bom × demand` of raw inflow — double-shipping, with a feasible
optimal solution and no error raised.

Implement the summed form (constraint 4 above). It is mathematically identical for the current
single-mine dataset and correct for any future variant that adds a mine.

---

## 3. Dataset

`solvers/two-echelon-gold-au/dataset/`

| File | Contents |
|---|---|
| `mines.json` | `kalgoorlie` (WA) |
| `refineries.json` | `daggar-hills` (WA), `cunnamulla` (QLD) |
| `customers.json` | 10 records with `demand` |
| `distances.json` | 22 pairs, keyed `"fromId,toId"` |
| `version.json` | `{version, sha256}` — **mandatory**, see precheck Gate 1.2 |

**Slug re-keying.** The notebook's customer ids run `1,2,3,5,6,7,8,9,10,11` — id 4 is absent — and
refineries reuse ids `3` and `4` from the customer id space. Re-key everything to slugs
(`sydney`, `daggar-hills`, …) before writing any file.

**Schema conformance.** Use `lng` not `lon`, and supply `state` (WA, NSW, VIC, QLD, SA, ACT) —
required by `WarehouseEntry`. Do **not** reuse `MineEntry`; it requires `capacity`, which this model
has no notion of in v1.

**Distances are copied verbatim.** The textbook's answer key depends on these exact values.
Recomputed great-circle distances would be more accurate and less correct.

**Extraction assertions:** 10 customers · total demand 7,400,000 · 2 refineries · 1 mine · 22
distance pairs · all `lat ∈ [-38.5, -16.0]` · all `lng ∈ [113.0, 155.0]`.

---

## 4. Contract extensions

Two optional fields are added to the shared result envelope. Both are **optional**, so the three
existing models are unaffected.

```ts
// resultEnvelope.ts
EdgeSchema:    leg?: "mine_to_refinery" | "refinery_to_customer"
MetricsSchema: avgDistanceByLeg?: { leg: string; avgDistance: number; totalFlow: number }[]
```

**Why `avgDistanceByLeg` is required for this exercise.** Part (b)(2) asks for the average distance
on *each* leg and why they move in opposite directions. A single blended `weightedAvgDistance`
averages them together and erases the answer.

**Compute averages from flows** — `Σ(d × f) / Σf` per leg — never from the objective. The objective
is divided by `TRUCKLOAD_KG`, so the `obj / totalDemand` shortcut used by `solve_transport` would
understate distance 44,000×.

> **Zod strips unknown keys silently.** The solver change and the `resultEnvelope.ts` change must
> ship in the **same commit**, or the fields are deleted in transit with no error. See precheck
> Gate 5.

---

## 5. Distance bands

Default bands must be Australian-scale: `[500, 1000, 1500, 2000, 2600]`.

The longest leg in this dataset is **Daggar Hills → Brisbane at 2,544 km**. The shared band helper
assigns out-of-range distances to the *last* band rather than an overflow bucket, so US-scale
defaults would report ~100% coverage within 2,000 km when the true figure is far lower.

Band only the **refinery→customer** leg. Banding both legs double-counts against total demand.

---

## 6. Inputs

```ts
// validation/inputs/twoEchelon.ts
bomRatio: z.number().gt(1).max(10),   // ≤1 would mean refining creates mass
refineryOverrides: { id, status: "active" | "forced_open" | "inactive" }[]
customerOverrides: { id, demand?, status: "active" | "excluded" }[]
distanceBands: number[]
gap: number
timeLimitSec: number                   // required — NaN here kills every solve
```

`bomRatio` uses `.gt(1)`, not `.positive()`. Rejecting a nonsensical ratio at the edge is cheaper
than debugging the optimum it produces.

---

## 7. Phases

Detailed code for each step is in `TECHNICAL_IMPLEMENTATION_PLAN.md`. Summary:

| Phase | Work | Exit |
|---|---|---|
| **H** | Shared hardening — see §8 | Existing tests green, no new model |
| **M0** | Extract dataset to slugs; assert against notebook | Files exist; sha256 matches |
| **M1** | Manifest + `PACKAGE_SPECS` | Model listed; not yet solvable |
| **M2** | `solve_two_echelon()` + dispatcher | CLI reproduces both notebook objectives |
| **M3** | Envelope schema, Zod inputs, allowlist, payload builder, OpenAPI codegen | Typecheck clean; round-trip retains new fields |
| **M4** | Australia bounds, two-leg edge colouring, BOM slider, per-leg panel | Flip visible and comparable |

**M2 and M3.1 (envelope schema) are one commit.** Do not split.

### Frontend notes

- Map bounds come from the manifest via `lib/mapBounds.ts` — already generalized. Extend
  `NetworkMap.tsx` rather than adding a third country-specific map component.
- Colour edges by `edge.leg`, mirroring the notebook's green (mine→refinery) / red
  (refinery→customer) convention. Unknown/absent `leg` falls back to neutral styling.
- BOM control is a **slider** (1.0–3.0, step 0.1, rounded before send). The flip point is worth
  discovering; a slider invites sweeping, a number field does not.
- Per-leg panel renders only when `avgDistanceByLeg?.length`.
- Map `openWarehouseIds` → "Refinery selected" in the copy layer.

---

## 8. Prerequisite hardening

These fix shared infrastructure and should land **before** M2. Full detail in
`application-audit-and-remediation-plan.md`.

| Task | Why it blocks this work |
|---|---|
| Capture solver `stderr` in failure messages | Python tracebacks are currently discarded; without this you debug M2 blind |
| Top-level React error boundary | A render throw in the new per-leg panel currently blanks the whole app |
| Solver-code hash in the result cache key | Otherwise a fixed solver returns the pre-fix cached result |
| Per-model dataset/manifest load isolation | A malformed new dataset currently breaks all four models at import |
| Registration consistency test | Makes precheck Gate 1 automatic |
| CI guard: no `print()` / `writeLP()` in `solve.py` | Both corrupt stdout or race on disk |

---

## 9. Tests

| Test | Guards |
|---|---|
| `test_scenario_1_selects_cunnamulla` | baseline |
| `test_scenario_2_selects_daggar_hills` | baseline |
| `test_objective_matches_notebook` (both, rel 1e-6) | verbatim distances, `/44000` divisor |
| `test_flow_balance_generalizes` (synthetic 2nd mine) | §2 correction |
| `test_leg_averages_move_oppositely` | **the exercise's actual answer** |
| `test_bom_flip_threshold` (bracket, not point) | CBC tie-breaking is arbitrary |
| `test_band_overflow_not_absorbed` (2,544 km leg) | §5 |
| `test_avg_distance_not_derived_from_objective` | §4 |
| `test_all_refineries_inactive_infeasible` | messaging |
| `test_two_forced_open_infeasible` | messaging |
| API: envelope **retains** `leg` + `avgDistanceByLeg` | §4 silent-strip guard |
| API: `bomRatio: 0.5` → 422; missing `timeLimitSec` → 422 | §6 |
| RTL: per-leg panel absent when field absent | defensive rendering |
| **Existing `e2e_accuracy.py` + `e2e_journey.py` unchanged** | **merge gate** |

---

## 10. Out of scope

- **Refinery capacity limits.** Would make `utilizationByNode` meaningful and the model genuinely
  capacitated. Deferred deliberately: once two constraints can each cause the flip, students can no
  longer isolate the cause. Ship the clean lesson first.
- **Multiple open refineries (`p > 1`).** Manifest declares `supportsP: false`. Relaxing constraint 2
  to `Σ open[r] = p` is small, but uninteresting with only two candidate sites.
- **Fixed facility opening costs.** Requires a cost column the textbook dataset does not provide.
- **Live distance recomputation.** Rejected — see §3.
- **Gamification quest.** An earlier draft of this plan included a task to add an "Arcadia" quest
  for this model. **That subsystem does not exist in this repository** — no quest, XP, badge,
  leaderboard, progress route, or `user_progress` table, despite the README describing all of them.
  Adding one is a separate feature requiring a new DB table, new routes, and a new frontend section;
  it is not an appendix to a model integration. See
  `application-audit-and-remediation-plan.md` §B1.

---

## 11. Commit sequence

1. `fix(solver): capture stderr, parse last stdout line, set subprocess cwd`
2. `fix(cache): include solver code hash in cache key`
3. `fix(registry): contain dataset and manifest load failures`
4. `test(registry): assert model registration consistency`
5. `ci: forbid stray print() and writeLP() in solve.py`
6. `feat(data): extract Ch.10 mining dataset with slug ids`
7. `feat(registry): register two-echelon-gold-au manifest and package spec`
8. `feat(solver)!: two-echelon refinery siting + envelope leg/per-leg metrics`
9. `feat(api): zod schema, allowlist, payload builder, openapi codegen`
10. `feat(studio): australia bounds, two-leg edges, BOM slider, per-leg panel`
11. `test: solver, api, and e2e coverage for two-echelon model`

Commit 8 must not be split — see §4.
