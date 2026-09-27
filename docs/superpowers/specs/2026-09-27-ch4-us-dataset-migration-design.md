# Chapter 4 — US Dataset Migration (`chens-cosmetics-cn` → `max-coverage-us`)

**Date:** 2026-09-27
**Status:** third-review findings folded (see §13); awaiting re-review before planning
**Lands before:** [`2026-09-27-ch4-two-step-workflow-design.md`](2026-09-27-ch4-two-step-workflow-design.md) — see §9

---

## 1. Problem and scope

Chapter 4 currently teaches its coverage / min-distance pair over a China dataset (Chen's Cosmetics — 197 customers, 25 candidate warehouses, km). It should instead run over Al's Athletics — the same US dataset Chapter 3 uses for p-median — so the two chapters differ by the question asked, not by the data.

**In scope.** Building Chapter 4's own copy of the US dataset; renaming the model to `max-coverage-us`; re-deriving the chapter's default parameters; regenerating its goldens; removing the China dataset and its China-only tooling; deleting existing Chapter 4 scenario rows.

**Out of scope.** Chapter 3 (`p-median-us`) is untouched. The two-step workflow is a separate spec and builds on this one.

**MIG-1**: this migration adds **no new solver branch** and changes neither objective nor any constraint (CLAUDE.md hard rule #6). It does make one subtractive solver edit: the `× 1.17` circuity multiplication is removed for this model (MIG-6). That is the deletion of a constant, not a new code path — and it moves the factor to where distances are produced rather than consumed. An earlier draft of this decision claimed "edits no model logic"; that was written before R3 established why the multiplication has to go.

## 2. Model identity

**MIG-2**: the model id becomes `max-coverage-us`, the manifest `name` becomes `Al's Athletics — Max Coverage` (pairing with Chapter 3's `Al's Athletics — P-Median`), and the dataset directory becomes `solvers/max-coverage-us/dataset`.

**MIG-21 — the complete wire contract, declared (R1).** The public id and the private wire value are different strings and neither may be inferred from the other:

| Layer | Old | New |
|---|---|---|
| Public model id — manifest, `VALID_MODEL_IDS`, OpenAPI enum, `scenarios.model_id` | `chens-cosmetics-cn` | `max-coverage-us` |
| Private wire `modelType` — emitted by `pmedian.ts`'s `buildPayload()`, consumed by `solve.py`'s dispatcher | `chens` | `max_coverage_us` |

`max_coverage` is deliberately **not** used as the wire value even after MIG-22 frees it, because a reader seeing that string cannot tell whether it means the retired placeholder or the new model.

Two regressions are required, not one: that a `max-coverage-us` solve emits `modelType: "max_coverage_us"` on the wire, and that the retired `"chens"` now receives the dispatcher's error envelope (`_failureStage = "dispatch"`) rather than silently resolving.

**MIG-22 — the legacy placeholders are removed.** `max_coverage`, `p_center` and `set_cover` sit in `VALID_MODEL_IDS` (`routes/scenarios.ts:105-107`) and in three OpenAPI `modelId` enums (`openapi.yaml:173`, `:1428`, `:1632`), with no manifest, no Zod schema and no dispatcher branch. A scenario created with any of them passes the id check and then fails with `Unknown model_id` — a half-valid state that reports the wrong cause. All three are deleted from both places, with regenerated Orval output in the same commit (hard rules #1 and #4). This is a contract change beyond the migration's core, taken deliberately: it removes the trap and frees the name.

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

**MIG-6 — store Chapter 3's distances as-is; remove the solver's `× 1.17`.** The dataset stores `stored_mi × 1.609344` — Chapter 3's own matrix, converted to km, nothing else — and `solve_max_coverage` drops the `× 1.17` that `solve_chens` applied at `solve.py:1401`.

**One meaning everywhere.** Stored = solved = displayed = exported = Chapter 3's distances. There is no value in the system that means one thing to the solver and another at a read boundary.

**Why the alternative was rejected (R3).** An earlier draft divided by 1.17 on import so the solver's multiplication would cancel it. That solves *identically* — same effective distances, same open warehouses, same objective, same approved defaults — but leaves the stored number 14.5% below what it is solved against. `routes/referenceDistances.ts` serves the stored matrix directly, and export reads the same base matrix, so a student comparing the Distances tab across Chapter 3 and Chapter 4 would see different figures for the identical city pair while both chapters solved the same problem. The division was never load-bearing: it existed only to cancel a multiplication this dataset does not need.

**Why applying `× 1.17` to Chapter 3's numbers would be wrong.** Chapter 3's matrix already behaves as circuity-adjusted. Measured over the 5,129 pairs beyond 50 km, `stored_km ÷ true_great_circle_km` has median **1.1788**. Multiplying again would put effective distances ~1.38× great-circle — double-counted — and would silently move the goldens, since MIG-9's approved defaults (700 km → 68.4192%) were computed against un-multiplied Chapter 3 distances.

**Provenance, stated correctly.** Chapter 3's matrix is **pre-baked**, not derived: `scripts/extract-datasets.py`'s docstring says "only p-median-us's distance matrix was pre-baked JSON in solve.py; the other two are computed at import time from lat/lng + a circuity factor" — its `haversine * 1.17` refers to the transport and Brazil matrices. Chapter 3's numbers carry no documented factor. The 1.1788 ratio above is an empirical observation, not a provenance claim.

**MIG-20 — the factor moves to the producer.** `services/autoDistance.ts:90-94` currently estimates Chapter 4 added-entity distances as raw great-circle km (`R = 6371`, no circuity) precisely *because* the solver multiplied. With the multiplication gone, that estimator must apply the factor itself, or an added entity's distances land ~15% shorter than comparable base pairs and adding a warehouse would make it look artificially close to everything.

The estimator therefore multiplies its own haversine result by 1.17. That leaves added distances 0.75% below the base matrix's own 1.1788 ratio — the same order of inconsistency that exists today, and it reuses the constant already in the file rather than introducing 1.1788 as a second magic number. The rule to state in code: **distances enter the dataset already road-adjusted; nothing downstream adjusts them again.**

D8 is thereby reversed for this model, deliberately and in one place. Any future dataset delivered as raw great-circle km must be adjusted at import, not by reinstating a solver multiplication.

**Also rejected: recomputing from coordinates.** It discards information the pre-baked matrix carries. Counted 2026-09-27, the matrix holds **4 pairs stored at 0 miles and 8 at 2 miles**, and **23 warehouse/customer pairs are co-located by city *and* state**, with stored values spanning 0–15 miles. Recomputing would replace the near-zero entries with computed distances and shift which warehouses open.

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

**Verification already performed** (2026-09-27, real CBC via `solve_chens` with the US data injected in memory; no repo files modified). That run stored `stored_mi × 1.609344 ÷ 1.17` and let the solver multiply; MIG-6 now stores `stored_mi × 1.609344` with no multiplication. **The effective distances are identical either way**, so these figures carry over unchanged — the R3 decision moved where the number is written, not what is solved:

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

**MIG-16 — four stages across two deployments, each with its own rollback point (R2).** The lock deployment and the rename deployment **cannot be the same commit**: stage A needs the old manifest to still exist, and stage D removes it.

**Stage A — lock and deploy (deployment 1).** Set `capabilities.locked` on the old manifest; deploy `nos-api`. This is not new machinery: `middlewares/lockedModel.ts` already 403s every scenario-scoped route for a locked model, including create, and `lockedModelGuards.test.ts` asserts every `:scenarioId` handler carries the check *before* any write. `ch4-lock` proved it in production. **Proof required before proceeding:** a create attempt and a scenario-scoped write against the old model both return 403. **Rollback:** revert the manifest flag and redeploy; nothing has been destroyed.

**Stage B — wait for terminal status. The wait is mandatory; there is no shortcut.**

Two things are *not* available, and both were wrongly offered in earlier drafts:

- **`cancelJob()` is unreachable.** It has no route caller (`jobRunner.ts:918`) — process-local only, with no scenario cancellation endpoint.
- **SIGTERM is not a queue drain.** `drainForShutdown` (`jobRunner.ts:800-808`) calls `stopDispatcherScheduler()`, sets draining, waits for **active** jobs, then force-cancels the still-active ones. It never touches `queued` rows — they stay queued for whichever process next claims them. So a worker drain cannot produce this stage's exit condition, and an earlier draft that offered it as an alternative was wrong.

**What the runbook actually does:** keep workers **running** so pre-existing queued Chapter 4 jobs get claimed and finish, and poll until every affected job is terminal (`succeeded` or `failed`), with an explicit timeout. Stage A's lock is a route guard, so it stops new *requests* while leaving already-queued jobs free to execute — which is exactly what this stage needs. If a drain is used to stop active work, workers must then be restarted to consume the remaining queue before the zero-row check. **No ad-hoc `UPDATE` of job status, ever.**

**Scoping — join through the parent scenario (T2).** Affected jobs are identified as:

```sql
solve_jobs j JOIN scenarios s ON s.id = j.scenario_id
WHERE s.model_id = 'chens-cosmetics-cn'
```

**not** by `j.model_id`, which is A1 Class-1 nullable (`lib/db/src/schema/solve_jobs.ts:55`) and therefore `NULL` on every pre-A1 row. Filtering on it alone silently omits exactly the oldest jobs — the ones most likely to be sitting in an odd state. This join is what the zero-row proof and both counts use.

**Verification:** zero rows with status `queued` or `running` under that join. **Failure path:** if the timeout expires with rows still non-terminal, stop and report; do not proceed to Stage C and do not force a status write. Stage A's lock means nothing new arrives while it is investigated.

**Stage C — count, confirm, delete (one transaction).** Report affected `scenarios` and `solve_jobs` counts, broken down by `inputs->>'objective'`, using the **same parent-scenario join as Stage B** — never `solve_jobs.model_id`, for the nullability reason given there. Obtain explicit human confirmation **against that count**. Then, in a single transaction: delete `solve_jobs` first, then `scenarios` (the FK-safe ordering `routes/scenarios.ts` already uses), then purge `result_cache WHERE model_id = 'chens-cosmetics-cn'`.

`result_cache` rows are **not** FK children of `scenarios` (`lib/db/src/schema/result_cache.ts` — primary key `inputs_hash`, plus a plain `model_id` column), so deleting scenarios strands them holding China result payloads. Their `inputs_hash` covers `modelId + datasetVersion + SOLVER_CODE_HASH + inputs`, so once the id is deregistered they are permanently unreachable. One transaction, so a partial failure leaves no orphans. **Rollback:** this is the point of no return; the transaction either commits whole or aborts whole, and there is no undo after commit.

**Stage D — rename and deploy (deployment 2).** Only now does the rename land and the old manifest get removed (§7). Post-deploy checks: `GET /api/models` lists `max-coverage-us` and not the old id; the Chapter 4 card renders; a fresh scenario solves and returns the MIG-10 goldens. **Rollback:** revert the deployment; the data deleted in stage C does not come back, which is why C requires confirmation.

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
- the units passage explaining that "Chen's model is genuinely metric, which forced distance units to become a first-class, model-derived property" needs rewriting — Chapter 4 stays km-canonical (MIG-7), but over US data, so the justification is a deliberate contract choice rather than the geography. There is no shim to describe: MIG-6 stores Chapter 3's matrix as-is and the solver multiplier is gone, so stored, solved, displayed and exported distances are one value;
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
| MIG-1 | No new solver branch; one subtractive edit (the `× 1.17`) | §1 |
| MIG-2 | Model becomes `max-coverage-us` | §2 |
| MIG-3 | Rename carried through every identifier in one commit | §2 |
| MIG-4 | Dispatcher already rejects unknown ids; the real hazard is a half-rename | §2 |
| MIG-5 | Chapter 4 owns its own copy of the data | §3 |
| MIG-6 | Store Chapter 3 distances as-is; remove the solver `× 1.17` | §3 |
| MIG-7 | Chapter 4 stays km-canonical | §3 |
| MIG-8 | `p` cap 25 → 26 in all **four** declarations | §3 |
| MIG-9 | Derived US defaults | §4 |
| MIG-10 | Goldens are frozen solver output; no textbook exists | §5 |
| MIG-11 | Floor-0 equivalence against `solve_pmedian`, unit-aware | §5 |
| MIG-12 | The trade-off is quieter on Al's data, and that is recorded | §5 |
| MIG-13 | Existing Chapter 4 rows deleted, behind an explicit gate | §6 |
| MIG-14 | Supersedes the two-step spec's CH4-19 and CH4-20 | §6 |
| MIG-15 | Lands before the two-step workflow | §9 |
| MIG-16 | Four-stage runbook, two deployments, bounded drain | §6 |
| MIG-17 | Explicit rename inventory — 93 files, 47 of them tests | §8 |
| MIG-18 | Two-step spec textually amended, not reinterpreted | §9 |
| MIG-19 | `README.md` needs a content rewrite, incl. removing the GeoNames attribution | §8 |
| MIG-20 | Circuity factor moves to the added-entity estimator; D8 reversed here | §3 |
| MIG-21 | Complete wire contract: public `max-coverage-us`, private `max_coverage_us` | §2 |
| MIG-22 | Legacy `max_coverage`/`p_center`/`set_cover` placeholders removed | §2 |

---

## 11. First review resolution — 2026-09-27

> **HISTORICAL.** This section records the first round and is **superseded in part**: its B3 row and the
> "resulting semantics" paragraph below describe the `÷ 1.17` shim, which §12's R3 removed. Current
> distance behaviour is §3 (MIG-6/MIG-20) only. Nothing below describes shipped behaviour.

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

---

## 12. Second review resolution — 2026-09-27

Two blockers and one approval condition. **All three verified against source; all three held.**

| Finding | Verified how | Landed in |
|---|---|---|
| **R1** — the replacement wire contract was unspecified, and `max_coverage` is a real collision | `max_coverage` is in `VALID_MODEL_IDS` (`scenarios.ts:105`) and three OpenAPI `modelId` enums (`:173`, `:1428`, `:1632`) — a model id, not just a problem type | §2 MIG-21 (public `max-coverage-us` / wire `max_coverage_us`, two regressions) and MIG-22 (all three placeholders removed) |
| **R2** — deletion needed staging, and "cancel them" was not executable | `cancelJob()` (`jobRunner.ts:918`) has no route caller anywhere; the only supported stop is `drainForShutdown` on SIGTERM (`index.ts:83-104`) | §6 MIG-16 rewritten as four stages over two deployments, with a bounded drain, a stated failure path, and no ad-hoc status write |
| **R3** — display/export vs solved distances | `routes/referenceDistances.ts` serves the stored matrix directly, so the shim would show the same city pair 14.5% shorter in Chapter 4 than in Chapter 3 | §3 MIG-6 rewritten — store Chapter 3's distances as-is, remove the solver `× 1.17`; §3 MIG-20 moves the factor to the added-entity estimator |

**R3 reversed an earlier recommendation of mine, and the reason is worth keeping.** The first draft chose `÷ 1.17` over removing the multiplication on the grounds that both produce byte-identical distances and differ only in whether decision D8 survives. That was true of the *solver* and false of the *system*: `referenceDistances.ts` and export read the stored value, so the shim created a number meaning one thing to the solver and another at every read boundary — across two chapters sharing one dataset. Both options still solve identically; only one keeps a single meaning. Preserving a convention was the wrong thing to optimise for.

A third option — store Chapter 3's numbers and keep the multiplication — was rejected on measurement: Chapter 3's matrix already sits at median **1.1788×** true great-circle, so multiplying again reaches ~1.38× and would silently move MIG-9's approved goldens.

---

## 13. Third review resolution — 2026-09-27

One blocker and two required corrections. **All three verified against source; all three held.**

| Finding | Verified how | Landed in |
|---|---|---|
| **T1** — SIGTERM is not a queue drain | `drainForShutdown` (`jobRunner.ts:800-808`) stops the dispatcher, waits for **active** jobs, then force-cancels the active ones. `queued` rows are never touched | §6 Stage B rewritten — the terminal-state wait is mandatory, workers stay running to consume the queue, no drain shortcut |
| **T2** — scope jobs through the parent scenario | `solve_jobs.model_id` is A1 Class-1 nullable (`solve_jobs.ts:55`), so it is `NULL` on every pre-A1 row | §6 Stages B and C both scope via `solve_jobs JOIN scenarios ON s.id = j.scenario_id WHERE s.model_id = ...` |
| **T3** — stale "shim" wording | MIG-19 still justified the units passage by the shim R3 had already removed | §8 MIG-19 corrected; §11 headed **HISTORICAL** with its superseded parts named |

**T1 is a real operational error, not a wording problem.** Stage B required zero `queued` or `running` rows *and* offered a worker drain as a way to get there. Those are incompatible: a drain deliberately stops claiming new work, so queued rows survive it and wait for the next process. Following the runbook as written would have produced a passing zero-`running` check with queued Chapter 4 jobs still pending — which then execute against rows Stage C has deleted. The fix is the opposite of a shortcut: keep workers running so the queue finishes, and poll to terminal.

**T2 would have silently spared the oldest rows.** Filtering on `solve_jobs.model_id` looks correct and reads naturally, but that column only exists from A1 onward. Every pre-A1 Chapter 4 job has `NULL` there, so the zero-row proof would have passed while the least-understood jobs in the table were still live.

Both T1 and T2 share a shape worth noting: each would have produced a **green check on an incomplete population**, which is worse than an obviously failing one.
