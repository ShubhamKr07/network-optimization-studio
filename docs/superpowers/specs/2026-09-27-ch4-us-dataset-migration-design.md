# Chapter 4 — US Dataset Migration (`chens-cosmetics-cn` → `max-coverage-us`)

**Date:** 2026-09-27
**Status:** design approved; not yet planned or implemented
**Lands before:** [`2026-09-27-ch4-two-step-workflow-design.md`](2026-09-27-ch4-two-step-workflow-design.md) — see §9

---

## 1. Problem and scope

Chapter 4 currently teaches its coverage / min-distance pair over a China dataset (Chen's Cosmetics — 197 customers, 25 candidate warehouses, km). It should instead run over Al's Athletics — the same US dataset Chapter 3 uses for p-median — so the two chapters differ by the question asked, not by the data.

**In scope.** Building Chapter 4's own copy of the US dataset; renaming the model to `max-coverage-us`; re-deriving the chapter's default parameters; regenerating its goldens; removing the China dataset and its China-only tooling; deleting existing Chapter 4 scenario rows.

**Out of scope.** Chapter 3 (`p-median-us`) is untouched. The two-step workflow is a separate spec and builds on this one. `solve.py`'s coverage and min-distance formulations are unchanged — **MIG-1**: this migration adds no solver branch and edits no model logic (CLAUDE.md hard rule #6).

## 2. Model identity

**MIG-2**: the model id becomes `max-coverage-us`, the manifest `name` becomes `Al's Athletics — Max Coverage` (pairing with Chapter 3's `Al's Athletics — P-Median`), and the dataset directory becomes `solvers/max-coverage-us/dataset`.

**MIG-3**: the rename is carried through every identifier in one commit — `validation/inputs/chens.ts` → `maxCoverage.ts`, `chensInputsSchema` → `maxCoverageInputsSchema`, `solve_chens` → `solve_max_coverage`, and the data/dispatch helpers that carry the `CHENS` suffix. A half-rename is worse than either end state: CLAUDE.md's most-repeated bug class is a stale `modelId === "..."` comparison, and leaving the old name in half the code is exactly how one survives a grep.

All ten registration points in `model-integration-precheck.md` Gate 1 are touched, because a rename is a deregistration plus a registration:

1. Manifest — `solvers/max-coverage-us/manifest.json` (§3).
2. Dataset version — `solvers/max-coverage-us/dataset/version.json`, `sha256` from `computeSha256()`, never by hand.
3. Zod schema + `KNOWN_SCHEMAS` in `registry/modelRegistry.ts`.
4. `VALID_MODEL_IDS` in `routes/scenarios.ts` — the checklist's "most-missed item".
5. `PACKAGE_SPECS` in `lib/dataset-schema/src/index.ts`.
6. `SolveInput` union + `buildPayload()` in `solver/pmedian.ts`.
7. `modelId` enum in `lib/api-spec/openapi.yaml` — **four separate occurrences** (lines 47, 172, 1427, 1631) — then `pnpm --filter @workspace/api-spec run codegen`. The generated files under `lib/api-zod` and `lib/api-client-react` carry the id and are **never** hand-edited (hard rule #1); spec and regenerated output land in the same commit (hard rule #4).
8. Dispatcher in `solver/solve.py`. **MIG-4**: this is the dangerous one — the checklist warns an unregistered id "falls through to `solve_pmedian` and returns a plausible wrong answer", with no error. For this model that failure is especially quiet, because `solve_pmedian` over the same dataset returns a *genuinely optimal p-median answer* — it would look entirely correct while silently ignoring the coverage objective. A test asserting the dispatcher rejects an unknown id, rather than only asserting the happy path, is required here.
9. Override entity registration in `services/templates.ts`, `services/import.ts` and `routes/scenarios.ts`.
10. Map multi-select allowlist in `Studio.tsx`.

`registration.test.ts` (the checklist's BLOCKER item) must pass for the new id.

Beyond Gate 1, the id also appears in `artifacts/studio/src/lib/` (`chapters.ts`, `entityId.ts`, `entityIdentity.ts`, `formatLocation.ts`, `formatObjective.ts`), six workspace tab components, two table components, `SolveDialog.tsx`, `Workspace.tsx`, and `lib/units/src/objective.ts`. Measured 2026-09-27: **34 source files** under `artifacts/`, `lib/`, `scripts/` and `solvers/` reference `chens-cosmetics-cn`, excluding tests, e2e specs and generated output.

## 3. Dataset build

**MIG-5**: Chapter 4 gets its **own copy** of the data, not a shared pointer at `solvers/p-median-us/dataset`. The chapters are pinned to independent bytes with independent `version.json` files, so a Chapter 3 data fix cannot silently move Chapter 4's goldens.

**Source.** `solvers/p-median-us/dataset/{warehouses,customers,distances}.json` — 26 warehouses, 200 customers, 5,200 pairs, complete (measured: zero missing pairs).

**Re-keying.** The two models key their files differently: `p-median-us` keys entities by ordinal (`"1"`, `"2"`) with the real id inside the record; Chapter 4's loader keys by entity id (`"wh-15"`, `"cs-1"`). The copy is therefore re-keyed by each record's own `id` — warehouses become `"ALN"`, `"DAL"`, customers `"C1"` — and distance keys become `"<warehouseId>,<customerId>"`.

**MIG-6 — circuity.** Chapter 3 stores distances already multiplied by circuity (`haversine * 1.17`, `scripts/extract-datasets.py:10`). Chapter 4 stores raw distances and applies `× 1.17` inside the solver (`solve.py:1401`, decision D8). The copy therefore divides on import:

```
raw_km = stored_mi × 1.609344 ÷ 1.17
```

The solver's own `× 1.17` restores `stored_mi × 1.609344` exactly. This is a pure round-trip through one constant, so it does not assume 1.17 was Chapter 3's true provenance factor — and `0 ÷ 1.17 × 1.17 = 0` preserves the 26 same-city pairs stored as 0 or 2 miles.

**Rejected alternative, with the measurement.** Recomputing distances from the stored coordinates was considered and is measurably wrong: against `haversine × 1.17` the median relative deviation from the stored values is 0.74%, the best-fit factor is 1.17885 rather than 1.17, and 26 pairs deviate by more than 5%. Those 26 are the same-city pairs — Baltimore→Baltimore, Boston→Boston — stored near zero on purpose. Recomputing would replace them with 10–30 mile distances and change which warehouses open.

**MIG-7 — units.** Chapter 4 stays **km-canonical**. Its parameter names (`highServiceDistKm`, `maxDistKm`, `avgServiceDistCapKm`) and the manifest's `distanceUnit: "km"` are unchanged, so the OpenAPI contract, the Zod schema, `solve.py` and the UI need no rename. Accepted cost: the same city pair reads in km under Chapter 4 and miles under Chapter 3 until the student uses the existing `UnitToggle`.

**Manifest changes** beyond id and name: `countryBounds` becomes Chapter 3's US bounds `{ sw: [25.78, -123.11], ne: [47.67, -71.02] }`, and `p.maximum` rises from 25 to 26 (Al's has 26 candidate warehouses). **MIG-8**: that cap is declared in three places — the manifest, `.max(25)` in the Zod schema, and `pMax={... 25}` in `Workspace.tsx` — and all three change together.

## 4. Defaults

**MIG-9** — derived from the data and solver-verified (§5):

| Parameter | China (today) | US | Basis |
|---|---|---|---|
| `highServiceDistKm` | 600 | **700** | 68.4192% coverage at `p=3` — nearest to the 66.0639% the chapter teaches today. 600 gives 57.47%, 800 gives 76.90%. |
| `maxDistKm` | 5000 | **5500** | The longest pair is 5,180.5 km, so 5000 would leave customers unassignable. 5500 also keeps the cap non-binding, which §5's equivalence check requires. |
| `avgServiceDistCapKm` | 1000 | **1000** | The coverage-optimal weighted average is 635.13 km, so 1000 sits slack — the same relationship China has (658.46 against 1000). Stays unequal to `highServiceDistKm`, per the standing warning in `defaultInputsForModel`. |
| `p` | 3 | **3** | Unchanged. |
| `distanceBands` | [600, 1200, 2400, 5000] | **[700, 1400, 2800, 5500]** | Same shape, rescaled to the new high and max. Bands are a reporting lens, not a constraint. |

## 5. Goldens and verification

**MIG-10**: the goldens are `solve.py`'s own output on the new dataset, frozen into the chapter's pytest suite. There is no textbook answer table to check against — and, contrary to CLAUDE.md's description of it, `e2e_accuracy.py`'s p-median section asserts only structure and relations (status optimal, opens exactly `p`, serves 200 customers, monotonicity across `p`), never a published warehouse set or objective value. Chapter 3 has no textbook-pinned goldens either.

**MIG-11 — the equivalence check.** Because a frozen self-produced golden certifies nothing, one independent assertion is added: Chapter 4's min-distance objective with `coverageFloorDemand: 0` is, by construction, the p-median problem — same objective, same `p`, coverage constraint slack. It must therefore reproduce `solve_pmedian`'s result on the same data. The two reach it through different code and different dataset handling, so a mangled distance conversion breaks the equality. This validates the data pipeline; it does **not** validate the coverage constraint or the average-distance cap, which are Chapter 4's own and which nothing in Chapter 3 exercises.

**Verification already performed** (2026-09-27, real CBC via `solve_chens` with the converted US data injected in memory; no repo files modified):

| | Step 1 — coverage | Step 2 — min distance |
|---|---|---|
| Status | optimal | optimal |
| Coverage | 68.4192% | 68.4192% (floor held exactly) |
| Covered demand | 53,385,024 | 53,385,024 |
| Open warehouses | `DAL, LA, PIT` | `DAL, LA, PIT` |
| Weighted avg distance | 635.13 km | 624.33 km |

The equivalence check passes: min-distance at floor 0 opens `{BAL, DAL, LA}` with weighted average 616.17 km, matching an independent brute-force p-median optimum over all 2,600 warehouse triples (616.2 km).

The method was validated against the existing chapter first — the same computation reproduces China's golden exactly (131,645,389 / 66.0639% / `{wh-40, wh-69, wh-102}`).

**MIG-12 — the pedagogical change is recorded deliberately.** On Al's data, Step 2 does **not** change the warehouse set; it improves assignments only, cutting weighted average distance by 1.70%. China's equivalent gain is 5.6%. This is a property of the dataset, not of the chosen defaults: measured across thresholds 600/700/800/1000 the gain ranges 1.27–1.85%, and across `p` = 3/4/5 it ranges 1.27–1.81%, with the warehouse set unchanged in every case. The chapter's lesson shifts from "re-optimizing the network" to "a coverage-optimal solution leaves ~2% of average distance on the table through assignment alone" — true, teachable, and quieter.

**Re-derivation at implementation time.** The figures above come from an in-memory injection, not from files on disk. Once `solvers/max-coverage-us/dataset/` exists, the goldens are regenerated by driving `python3 solve.py` over stdin — the path the job runner actually uses — and those values, not these, are what get frozen.

## 6. Existing data

**MIG-13**: existing `chens-cosmetics-cn` scenario rows are **deleted**, together with their `solve_jobs` children, as part of the migration.

Nothing about them survives the swap: their `inputs` reference China entity ids (`wh-40`, `cs-1`) that do not exist in the US dataset, and their stored `result` names open warehouses that are gone. Migrating `model_id` alone would leave rows pointing at absent entities.

**This is destructive and touches production student data, so it is gated, not automatic.** The implementation plan must, in order: (a) count the affected rows per objective and report the number; (b) obtain explicit confirmation to proceed on that count; (c) delete `solve_jobs` children before parent scenarios, matching the existing delete ordering in `routes/scenarios.ts`. No step runs without (b).

Measured 2026-09-27: the local dev database holds **0** Chapter 4 scenarios. Production has not been queried.

**MIG-14 — consequence for the two-step spec.** This makes `CH4-19` (legacy `coverage` scenarios adopt as "Step 1 solved") and `CH4-20` (null `input_snapshot` falls back to `scenarios.result`) moot: after this migration there are no legacy Chapter 4 scenarios to adopt. Those two decisions are superseded and the two-step spec is amended to say so rather than left to contradict this one.

## 7. What becomes dead

Removed in the same commit — git retains the history, so nothing is lost:

- `solvers/chens-cosmetics-cn/` — manifest and dataset, including its `README.md` GeoNames attribution, which no longer describes any shipped data.
- `scripts/src/extract-chens-dataset.ts` and `scripts/src/geocode-chens.ts` — China-only dataset tooling.
- `docs/dataset-audit/chens-geocode-provenance.json` — provenance for postal codes no longer shipped.

`attached_assets/` is **not** touched (hard rule #7). The three ChensCosmetics notebooks stay as textbook source material; `attached_assets/NOTEBOOKS.md` gains a note that Chapter 4 no longer ships that dataset.

## 8. Testing

**Solver (pytest).** `test_chens.py` becomes `test_max_coverage.py` with goldens regenerated per §5, plus the **MIG-11** equivalence assertion and the **MIG-4** unknown-id dispatcher assertion.

**Registration.** `registration.test.ts` must pass for `max-coverage-us` and must no longer recognise `chens-cosmetics-cn`.

**Dataset integrity.** `version.json`'s `sha256` is generated by `computeSha256()` and verified by `lib/dataset-schema`'s `PACKAGE_SPECS` entry — the mechanism that would otherwise let a corrupt copy through undetected.

**Contract.** Regenerated Orval output compiles and the four `openapi.yaml` enum sites agree.

**Frontend.** `chapters.ts` resolves Chapter 4 to the new id; the Chapter 4 card renders; the map draws over US bounds.

**e2e.** `chens-cosmetics.spec.ts`, `chen-bands-units-qa.spec.ts` and `nonjade-servicestats-live-coverage.spec.ts` all reference the old id and all need rewriting. Per CLAUDE.md's recurring `spec_gap` rule this happens before merge — the unit gate does not run Playwright.

**Unchanged and must stay green.** `e2e_accuracy.py` has no Chapter 4 section (verified: `chens` appears nowhere in it), so this migration does not touch it. It must still pass unmodified (hard rule #2).

## 9. Sequencing

**MIG-15**: this migration lands **before** the two-step workflow. Both rewrite Chapter 4's goldens and its e2e specs; doing the dataset first means each is written once, against the final data. The two-step spec's own text refers to `chens-cosmetics-cn` throughout and is read as referring to `max-coverage-us` once this lands.

## 10. Decision index

Defined in place; this index is a pointer, not a restatement.

| Id | Subject | Section |
|---|---|---|
| MIG-1 | No solver logic or branch changes | §1 |
| MIG-2 | Model becomes `max-coverage-us` | §2 |
| MIG-3 | Rename carried through every identifier in one commit | §2 |
| MIG-4 | Dispatcher fall-through returns a plausible wrong answer; test for it | §2 |
| MIG-5 | Chapter 4 owns its own copy of the data | §3 |
| MIG-6 | Circuity divided out on import; D8 preserved | §3 |
| MIG-7 | Chapter 4 stays km-canonical | §3 |
| MIG-8 | `p` cap 25 → 26 in all three declarations | §3 |
| MIG-9 | Derived US defaults | §4 |
| MIG-10 | Goldens are frozen solver output; no textbook exists | §5 |
| MIG-11 | Floor-0 equivalence against `solve_pmedian` | §5 |
| MIG-12 | The trade-off is quieter on Al's data, and that is recorded | §5 |
| MIG-13 | Existing Chapter 4 rows deleted, behind an explicit gate | §6 |
| MIG-14 | Supersedes the two-step spec's CH4-19 and CH4-20 | §6 |
| MIG-15 | Lands before the two-step workflow | §9 |
