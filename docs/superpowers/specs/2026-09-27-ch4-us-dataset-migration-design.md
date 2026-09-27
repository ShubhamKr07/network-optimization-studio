# Chapter 4 — US Dataset Migration (`chens-cosmetics-cn` → `max-coverage-us`)

**Date:** 2026-09-27
**Status:** review findings folded (see §11); awaiting re-review before planning
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
8. Dispatcher in `solver/solve.py`. **MIG-4**: `model-integration-precheck.md` warns that an unregistered id "falls through to `solve_pmedian` and returns a plausible wrong answer". **That warning is stale** — `solve.py:1487-1490` now returns an error envelope with `_failureStage = "dispatch"` and the message `Unknown modelType: <x>`, so an unknown id fails loudly. The unknown-id regression test is still required, but to hold that behaviour, not to catch a fall-through that no longer exists.

   The live hazard for *this* migration is different, and it is MIG-3's half-rename. `solve.py` dispatches on the `modelType` string `"chens"`, which `pmedian.ts`'s `buildPayload()` emits — neither is the model id. So renaming the model id while leaving `modelType`/`solve_chens` untouched produces a system that works perfectly, giving no signal that the rename is half-done, until someone later renames one side alone. That is why MIG-3 requires a single commit.
9. Override entity registration in `services/templates.ts`, `services/import.ts` and `routes/scenarios.ts`.
10. Map multi-select allowlist in `Studio.tsx`.

`registration.test.ts` (the checklist's BLOCKER item) must pass for the new id.

Beyond Gate 1, the id also appears in `artifacts/studio/src/lib/` (`chapters.ts`, `entityId.ts`, `entityIdentity.ts`, `formatLocation.ts`, `formatObjective.ts`), six workspace tab components, two table components, `SolveDialog.tsx`, `Workspace.tsx`, and `lib/units/src/objective.ts`. Measured 2026-09-27: **34 source files** under `artifacts/`, `lib/`, `scripts/` and `solvers/` reference `chens-cosmetics-cn`, excluding tests, e2e specs and generated output.

## 3. Dataset build

**MIG-5**: Chapter 4 gets its **own copy** of the data, not a shared pointer at `solvers/p-median-us/dataset`. The chapters are pinned to independent bytes with independent `version.json` files, so a Chapter 3 data fix cannot silently move Chapter 4's goldens.

**Source.** `solvers/p-median-us/dataset/{warehouses,customers,distances}.json` — 26 warehouses, 200 customers, 5,200 pairs, complete (measured: zero missing pairs).

**Re-keying.** The two models key their files differently: `p-median-us` keys entities by ordinal (`"1"`, `"2"`) with the real id inside the record; Chapter 4's loader keys by entity id (`"wh-15"`, `"cs-1"`). The copy is therefore re-keyed by each record's own `id` — warehouses become `"ALN"`, `"DAL"`, customers `"C1"` — and distance keys become `"<warehouseId>,<customerId>"`.

**MIG-6 — the `÷ 1.17` shim.** Chapter 4's solver multiplies every base distance by 1.17 before use (`solve.py:1401`, decision D8), so a dataset written for it must store pre-multiplication values. The copy therefore divides on import:

```
raw_km = stored_mi × 1.609344 ÷ 1.17
```

The solver's own `× 1.17` restores `stored_mi × 1.609344` exactly — a pure round-trip through one constant, lossless to float precision, and `0 ÷ 1.17 × 1.17 = 0` preserves the co-located pairs stored at or near zero.

**This is a representation shim, not provenance.** Chapter 3's matrix is **pre-baked**, not derived: `scripts/extract-datasets.py`'s own docstring states that "only p-median-us's distance matrix was pre-baked JSON in solve.py; the other two are computed at import time from lat/lng + a circuity factor" — the `haversine * 1.17` in that file refers to the transport and Brazil matrices. Chapter 3's numbers have no circuity factor to divide out. The 1.17 here exists solely to cancel the multiplication Chapter 4's solver performs, and the spec must not claim otherwise.

**Resulting semantics, measured.** Chapter 4 treats stored distances as raw great-circle km — `services/autoDistance.ts:90-94` estimates added-entity distances that way explicitly (`R = 6371 km`, no circuity, "solve_chens applies the ×1.17 factor itself"). The shim's output is consistent with that convention: across the 5,129 pairs over 50 km, `shim ÷ true_great_circle_km` has median **1.0075**, 5th–95th percentile 1.0057–1.0078, full range 0.9896–1.0078. Base distances therefore sit within ~0.8% of raw great-circle km, the same footing as the added-entity estimator, so base and added distances are directly comparable. The same value is what reference-distance display, import/export and precheck read, since all of them consume the stored base matrix.

**Rejected alternative, with the measurement.** Recomputing distances from the stored coordinates was considered and rejected: it discards information the pre-baked matrix carries. Counted 2026-09-27, the matrix holds **4 pairs stored at 0 miles and 8 at 2 miles**, and **23 warehouse/customer pairs are co-located by city *and* state**, with stored values spanning 0–15 miles. Recomputing would replace the near-zero entries with computed distances and shift which warehouses open.

> An earlier draft of this section reported "26 same-city pairs stored as 0 or 2". That figure was wrong twice over: 26 was a deviation count against a haversine model, not a pair count; and the matching used city name alone, which CLAUDE.md warns against — city names are not unique. Matching on name alone produced a spurious 621-mile "same-city" pair that is really Columbus **OH** against Columbus **GA**. The corrected figures are the ones above.

**MIG-7 — units.** Chapter 4 stays **km-canonical**. Its parameter names (`highServiceDistKm`, `maxDistKm`, `avgServiceDistCapKm`) and the manifest's `distanceUnit: "km"` are unchanged, so the OpenAPI contract, the Zod schema, `solve.py` and the UI need no rename. Accepted cost: the same city pair reads in km under Chapter 4 and miles under Chapter 3 until the student uses the existing `UnitToggle`.

**Manifest changes** beyond id and name: `countryBounds` becomes Chapter 3's US bounds `{ sw: [25.78, -123.11], ne: [47.67, -71.02] }`, and `p.maximum` rises from 25 to 26 (Al's has 26 candidate warehouses). **MIG-8**: that cap is declared in **four** places, and all four change together, each with its own regression assertion:

1. `p.maximum` in the manifest.
2. `.max(25)` in the Zod input schema.
3. `pMax={...}` at `Workspace.tsx:3297` — the Optimization Parameters tab.
4. `pMax={...}` at `Workspace.tsx:4014` — SolveDialog.

The two UI caps render independently; neither reads the other, and neither reads the manifest. Changing three of the four leaves a surface where `p=26` is rejected with no server involvement and no error that names the real cause.

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

**MIG-11 — the equivalence check.** Because a frozen self-produced golden certifies nothing, one independent assertion is added: Chapter 4's min-distance objective with `coverageFloorDemand: 0` is, by construction, the p-median problem — same objective, same `p`, coverage constraint slack. It must therefore reproduce `solve_pmedian`'s result on the same data. The two reach it through different code and different dataset handling, so a mangled distance conversion breaks the equality.

**The assertion must be unit-aware.** Chapter 4 is km-canonical (MIG-7) and Chapter 3 is mile-canonical, so the two objectives are in demand·km and demand·mi respectively and are *not* equal. The check asserts two things:

- identical open warehouse ids, and
- `maxCoverageObjective ≈ pMedianObjective × 1.609344`.

Verified 2026-09-27 with both solvers at `p=3`: open ids `{BAL, DAL, LA}` on both sides; `48,077,117,356.27 ÷ 1.609344 = 29,873,735,730.9997` against `solve_pmedian`'s `29,873,735,731` — an absolute difference of `2.9e-4` on a value of order `3e10`, a relative difference of `9.8e-15`. A relative tolerance of `1e-9` is therefore ample and still far tighter than any real conversion error.

This validates the data pipeline; it does **not** validate the coverage constraint or the average-distance cap, which are Chapter 4's own and which nothing in Chapter 3 exercises.

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

**This is destructive, touches production student data, and races the running system.** Counting, confirming and deleting is not sufficient on its own: between the count and the delete, the still-deployed old build can create a new Chapter 4 scenario, and a worker can publish a completed job onto a row being removed. The deletion must therefore run against a quiesced model.

**MIG-16 — the runbook, in order. No step may be skipped or reordered:**

1. **Block the model.** Set `capabilities.locked` on the old manifest and deploy it. This is not new machinery — `middlewares/lockedModel.ts` already 403s every scenario-scoped route for a locked model, including create, and `lockedModelGuards.test.ts` already asserts every `:scenarioId` handler carries the check *before* any write. It is the quiesce mechanism the repo already owns, and `ch4-lock` proved it in production.
2. **Drain the queue.** Let queued and running Chapter 4 jobs finish or cancel them; confirm none remain in `queued` or `running`. A job that completes after step 3 would otherwise publish onto a deleted row.
3. **Count, then confirm.** Report affected `scenarios` and `solve_jobs` rows, broken down by `inputs->>'objective'`. Obtain explicit human confirmation against that count. Nothing below runs without it.
4. **Delete in one transaction** — `solve_jobs` first, then `scenarios`, matching the existing FK-safe ordering in `routes/scenarios.ts`. One transaction so a partial failure leaves no orphans.
5. **Purge `result_cache`.** Rows there are **not** FK children of `scenarios` (`lib/db/src/schema/result_cache.ts` — primary key `inputs_hash`, with a plain `model_id` column), so deleting scenarios leaves them behind holding China result payloads. Their `inputs_hash` is computed over `modelId + datasetVersion + SOLVER_CODE_HASH + inputs`, so once the old model id is deregistered they are permanently unreachable — dead rows that can never be hit again. Delete `WHERE model_id = 'chens-cosmetics-cn'` in the same transaction.

The old manifest is removed (§7) only after this runbook completes; step 1 needs it to still exist.

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

**MIG-17 — the rename inventory is explicit, not "the obvious files".** Measured 2026-09-27, searching for `chens-cosmetics-cn`, `chensInputsSchema`, `solve_chens`, `CHENS` and `test_chens` across `artifacts/`, `lib/`, `scripts/` and `solvers/`: **93 files total**, of which **47 are test, e2e or benchmark files**. Naming only `test_chens.py` and three Playwright specs understates the work by an order of magnitude. The plan carries a checklist covering, at minimum:

- the solver benchmark corpus and its translator (`solver/tests/benchmark/` — `corpus.py`, `translate.py`, `corpus/manifest.json`, `real_solve_smoke.py`, `test_corpus.py`);
- API tests for import, precheck, reference distances, contract and templates;
- Studio unit tests across the workspace tabs, tables and `lib/` helpers;
- `lib/dataset-schema` and `lib/units` tests;
- **`README.md`** — see below.

**MIG-19 — `README.md` needs a content rewrite, not a rename sweep.** It is the project's public showcase and, as of `main@54fee51`, documents Chapter 4 as the China case. A grep for the model id finds only part of it; the rest is prose that names no identifier:

- the model table row — "Service-level siting in **China** … 25 WH · 197 customers · 4,925 distances (km)" — becomes Al's Athletics, 26 warehouses, 200 customers, 5,200 distances;
- the cited goldens `66.0639%` and `131645389` become the regenerated Chapter 4 values (§5);
- the units passage explaining that "Chen's model is genuinely metric, which forced distance units to become a first-class, model-derived property" needs rewriting — Chapter 4 stays km-canonical (MIG-7), but over US data, and the justification is now the shim (MIG-6), not the geography;
- the GeoNames / CC BY 4.0 attribution for Chinese postal codes is **removed**, since §7 deletes the dataset it credits. Leaving an attribution for data the project no longer ships is a licensing-hygiene defect, not a cosmetic one.

**e2e.** `chens-cosmetics.spec.ts`, `chen-bands-units-qa.spec.ts` and `nonjade-servicestats-live-coverage.spec.ts` reference the old id directly and all need rewriting. Note that all three also hard-code the old defaults (`highServiceDistKm: 600`), so MIG-9 breaks them independently of the rename. Per CLAUDE.md's recurring `spec_gap` rule this happens before merge — the unit gate does not run Playwright.

**Unchanged and must stay green.** `e2e_accuracy.py` has no Chapter 4 section (verified: `chens` appears nowhere in it), so this migration does not touch it. It must still pass unmodified (hard rule #2).

## 9. Sequencing

**MIG-15**: this migration lands **before** the two-step workflow. Both rewrite Chapter 4's goldens and its e2e specs; doing the dataset first means each is written once, against the final data.

**MIG-18**: the two-step spec is **textually amended** as part of this migration's commit — every `chens-cosmetics-cn`, `chensInputsSchema` and `solve_chens` reference in it is rewritten to the new names, along with its default values. It is not left to be "read as" using the new identifier: a spec that names identifiers which no longer exist is a spec that fails its own grep, and this repo's most-repeated bug class is precisely a stale model-name reference surviving a rename.

## 10. Decision index

Defined in place; this index is a pointer, not a restatement.

| Id | Subject | Section |
|---|---|---|
| MIG-1 | No solver logic or branch changes | §1 |
| MIG-2 | Model becomes `max-coverage-us` | §2 |
| MIG-3 | Rename carried through every identifier in one commit | §2 |
| MIG-4 | Dispatcher already rejects unknown ids; the real hazard is a half-rename | §2 |
| MIG-5 | Chapter 4 owns its own copy of the data | §3 |
| MIG-6 | `÷ 1.17` is a representation shim, not provenance; D8 preserved | §3 |
| MIG-7 | Chapter 4 stays km-canonical | §3 |
| MIG-8 | `p` cap 25 → 26 in all **four** declarations | §3 |
| MIG-9 | Derived US defaults | §4 |
| MIG-10 | Goldens are frozen solver output; no textbook exists | §5 |
| MIG-11 | Floor-0 equivalence against `solve_pmedian`, unit-aware | §5 |
| MIG-12 | The trade-off is quieter on Al's data, and that is recorded | §5 |
| MIG-13 | Existing Chapter 4 rows deleted, behind an explicit gate | §6 |
| MIG-14 | Supersedes the two-step spec's CH4-19 and CH4-20 | §6 |
| MIG-15 | Lands before the two-step workflow | §9 |
| MIG-16 | Quiesced, transactional deletion runbook | §6 |
| MIG-17 | Explicit rename inventory — 93 files, 47 of them tests | §8 |
| MIG-18 | Two-step spec textually amended, not reinterpreted | §9 |
| MIG-19 | `README.md` needs a content rewrite, incl. removing the GeoNames attribution | §8 |

---

## 11. Review resolution — 2026-09-27

An independent review returned four blockers and two required corrections. **All six were verified
against the source and all six held; none were disputed.** Each is folded into the normative sections
above rather than answered here — this section is the audit trail, not a second set of requirements.

| Finding | Verified how | Landed in |
|---|---|---|
| **B1** — MIG-8 undercounts the `p` caps | `Workspace.tsx` has two independent `pMax` renders, `:3297` and `:4014` | §3 MIG-8, now four declarations with per-site assertions |
| **B2** — deletion needs a quiesced, transactional runbook | `result_cache` is keyed on `inputs_hash` with a plain `model_id` column — not an FK child, so scenario deletion strands China payloads | §6 MIG-16, five ordered steps; `result_cache` purged in the same transaction |
| **B3** — MIG-6's provenance is wrong | `extract-datasets.py`'s docstring: "only p-median-us's distance matrix was pre-baked"; the `haversine * 1.17` refers to transport and Brazil | §3 MIG-6 rewritten as a shim, with measured semantics |
| **B4** — rename/test scope understated | 93 files carry the old identifiers; 47 are tests, e2e or benchmark | §8 MIG-17 inventory, §9 MIG-18 |
| **C1** — MIG-4 rationale stale | `solve.py:1487-1490` returns a `dispatch` error envelope for an unknown `modelType` | §2 MIG-4 rewritten; the real hazard is the half-rename |
| **C2** — MIG-11 must be unit-aware | Measured: `48,077,117,356.27 ÷ 1.609344` vs `29,873,735,731`, relative difference `9.8e-15` | §5 MIG-11, ratio assertion with a `1e-9` tolerance |

**Two corrections the review prompted but did not itself state.**

The disputed count in B3 was wrong in a second way the review didn't name: the original "same-city"
matching used city name alone, which CLAUDE.md explicitly warns against, and produced a spurious
621-mile co-located pair that is really Columbus **OH** against Columbus **GA**. Matching on city
*and* state gives 23 co-located pairs spanning 0–15 miles. Recorded in §3.

B3 asked for consistent semantics across base distances, reference-distance display, import/export,
precheck and added-entity estimates, without saying what they should be. Measuring answered it:
after the shim, base distances sit within ~0.8% of raw great-circle km (median ratio 1.0075 over
5,129 pairs), which is the convention `autoDistance.ts:90-94` already uses for added entities. The
two are on the same footing, so one rule covers all five consumers. Recorded in §3.
