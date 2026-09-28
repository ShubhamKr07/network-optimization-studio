# Chapter 5 Delivery Company Teaching Example — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `delivery-teaching-us`, the 7th model — a p-median facility-location lab over the COG dataset (33 candidate DCs, 313 customers) whose objective runs off a **cost table kept separate from the distance table**, plus an "Adjust Cost Table" toggle that reprices lanes against a distance threshold.

**Architecture:** A new self-contained `solve_delivery()` in the shared `solve.py` behind a new `modelType: "delivery"` — no existing solver's mathematics is touched. The cost table is a second dataset file seeded identical to distances; the student overrides it sparsely; the rate adjustment is derived at solve time and never written back. Every distance metric is accumulated from the distance table, never from the objective.

**Tech Stack:** Python 3 + PuLP/CBC (solver), Express 5 + Drizzle (API), Zod validators, OpenAPI + Orval codegen, React + Vite + TanStack Query (Studio), vitest/supertest (API), vitest/RTL (Studio), Playwright (e2e), pytest (solver).

**Source spec:** [`docs/superpowers/specs/2026-09-28-chapter-5-delivery-teaching-design.md`](../specs/2026-09-28-chapter-5-delivery-teaching-design.md) — Rev 2, review-folded. Decisions 1–14 in its §3; the 18-point registration checklist in its §9.

**Status: Rev 2 — review folded 2026-09-28.** Every row of the [Review record](#review-record-2026-09-28-rev-1) (9 blocking, 17 should-fix, 12 nits) has been rewritten into its task body below; the record is kept as the audit trail and its dispositions are historical. **Task 10 remains blocked until the Chapter 4 two-step branch (`ch4-2s-7-work`) merges to `main`** — see Task 0 Step 2 and Task 10's header. Every other task executes against current `main`.

---

## Global Constraints

Every task's requirements implicitly include this section.

**From the spec (exact values, verbatim):**

- Model id `delivery-teaching-us`; private wire `modelType` `delivery`; validator `deliveryInputsSchema`; solver entry `solve_delivery`. Route `/chapter-5/delivery`. Chapter label `Chapter 5`, title `Delivery Company Teaching Example`.
- Dataset: **33** warehouses, **313** customers, **10,329** lanes in each of `distances.json` and `costs.json` (dense 33 × 313, 0 missing, 0 duplicate). Total demand **208,829,000**. Distance range 0.0 – 3268.87 mi including **33 zero-distance self-lanes**. 3,819 lanes ≤ 800 mi; **0 lanes exactly 800 mi**.
- Ids are role-prefixed: warehouses `W<sheet id>`, customers `C<sheet id>`. Lane keys `"W8,C269"`.
- Defaults: `p` 3, `distanceBands` [400, 800, 1200, 1600], `gap` 0, `timeLimitSec` 120, `costAdjustEnabled` false, `distanceThreshold` 800, `costPerMile` 1, `costPerMileOver` 10.
- Effective cost: `ec[w,c] = cost[w,c] * (costPerMile if dist[w,c] <= threshold else costPerMileOver)` when enabled, else `cost[w,c]`. **Threshold compares `dist`; the rate multiplies `cost`; `<=` takes the low rate.**
- Constraints: `Σ_w y[w,c] = 1` per customer; `Σ_w o[w] <= P` (**`LpConstraintLE`**, not `EQ`); `y[w,c] <= o[w]` per pair.
- **`dist` is read-only for the whole solver.** Overrides land on `cost` only.
- `weightedAvgDistance` is its own accumulator — **never** `objective / total_demand`.
- `edges[].distance` carries the real distance, never the effective cost.
- Envelope precision: `objective` 2 dp, `weightedAvgDistance` 4 dp, band percentages 2 dp.
- Band coverage is **cumulative**, with an explicit Overflow row beyond the largest band.
- No capacity constraint. `capacityModes: []`. `utilizationByNode` is **not** emitted.
- Cost domain: lane overrides `finite().nonnegative()`; rates strictly positive.
- `p` bounded 1–33 in the schema **and** at both UI mounts via `pMax={33}`.
- Only this model becomes visible on Landing. `transport-coal` and `p-median-brazil` keep `hiddenFromLanding: true`. Landing goes from 3 visible labs to 4.
- Editable surface is the cost table **only**. No demand edits, no added entities, no facility status, no distance editor.

**Frozen goldens (spec §8.1) — these are the acceptance numbers:**

| | Scenario 1 (`costAdjustEnabled: false`) | Scenario 2 (`true`, 800 / 1 / 10) |
|---|---|---|
| Objective | 88,240,913,478.10 | 150,194,534,098.60 |
| Open DCs | `W1`, `W2`, `W60` | `W6`, `W43`, `W45` |
| Weighted avg. distance | 422.5511 mi | 508.6534 mi |
| % within 400 / 800 / 1200 / 1600 | 59.38 / 81.45 / 99.44 / 100.00 | 26.43 / 97.19 / 100.00 / 100.00 |

**From CLAUDE.md (hard rules that bind these tasks):**

- **`e2e_accuracy.py` is sacred.** Run it; never edit it. This model's goldens live in `test_delivery.py`. Modifying it needs explicit human approval.
- Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. Edit `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`, commit spec + regenerated output in the **same** commit.
- Ownership filtering is security-critical: non-owned resources return **404, never 403**.
- Solver business rules enter as data, never as new `if/else` paths in existing solver functions.
- One task = one commit. Message format `[<task-id>] <imperative summary>`.
- **Run every api-server command with `DATABASE_URL` inline.** `lib/db/src/index.ts` throws at import time without it; eight suites otherwise fail at *collection* and look like real failures. Use `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`.

**Learned from the Chapter 4 migration and this spec's review — not optional:**

- **Never assert on `Function.prototype.toString()`.** The vitest/esbuild transform strips comments, so a source-shape assertion against a stringified function silently tests nothing. Use `readFileSync` (as `lockedModelGuards.test.ts:33,82` does) or a real seam.
- **Eight of this model's registration points fail silently.** A permissive `inputEntriesForModel` default, an unmounted router, a pre-approving precheck, a blank export city column, a `pMax` ternary that omits the model, `objectiveDimension`'s `default: "opaque"`, the `isEditableInputTab` allow-list (no row → no Save path), and the Open Warehouses `capacityModes` pass-through that is jade-only today (no row → a utilization column with no denominator). None produces an error. Each has its own task step and its own test; the full list is the Review record's R7 table.
- **`Workspace.tsx`'s model gates are `modelId === "…"` chains, not exhaustive switches.** Typecheck surfaces only `defaultInputsForModel` and `inputEntriesForModel` (typed on `StudioModelType`). Every other gate must be found by the Task 0 probe sweep and edited by hand.
- Tests may import from workspace packages (`@workspace/units`, `@workspace/dataset-schema`) — that is the normal path. Do not add a relative import that reaches into a sibling package's `src/` to satisfy a test; that forces `rootDir` changes and breaks the build.
- **Python tests self-bootstrap.** There is no `conftest.py`, `pytest.ini`, or `pyproject.toml` anywhere in the repo. Every solver test file begins with `sys.path.insert(0, str(Path(__file__).parent.parent))` before `from solve import …` (`tests/test_max_coverage.py:22-24`). A test file without that header fails at collection.

---

## Plan-resolution notes (spec text vs. the repo as it stands)

Verified against the tree at `f9107ba`. Each is resolved inside a task rather than left for the implementer to discover.

| # | Spec says | Repo actually | Resolved in |
|---|---|---|---|
| 1 | "omit the model from tab allowlists" | `inputEntriesForModel` (`Workspace.tsx:1184`, tail at `:1222-1231`) ends `case "p-median-brazil": case "p-median-us": default:` — omission **grants** the full p-median editing surface. It is module-private today. | Task 8 |
| 2 | Override with an unknown id raises `UnresolvableIdError` | `runNetworkEditsPrecheckForModel` (`precheck.ts:1368`) returns `{ ok: true, errors: [] }` at `:1387` for an unregistered model, so it never reaches a 422. `UnresolvableIdError` is defined in `merge_inputs.py:31`, not `solve.py`, and surfaces on fd3 as `internal_error`/`solve_exception` (`solve.py:1549-1552`). | Tasks 3, 6 |
| 3 | `p` capped at 33 | `pMax` is already passed at both mounts — `Workspace.tsx:3320` and `:4037` — as `modelId === "max-coverage-us" ? 26 : undefined` ternaries (jade gets a dynamic count at `:3320`). The component defaults (`OptimizationParametersTab.tsx:151`, `SolveDialog.tsx:156`) are `50`. The fix is a `33` arm in both ternaries. | Task 10 |
| 4 | Band percentages to 2 dp | `computeCumulativeBandCoverage` (`lib/units/src/bands.ts:37-52`) returns `Math.round(...)` integers, and five models' tests are pinned to that. `ServiceStatsTab.tsx:6` imports it via the studio shim `@/lib/bands`, not `@workspace/units`, and its live recompute (`:242, :288-290`) drives the displayed bars whenever `presentationBands` is passed. | Task 12 |
| 5 | `costs.json` validated by `PACKAGE_SPECS` | `DistanceMap` is `z.record(z.string(), z.number())` (`dataset-schema/src/index.ts:23`) — accepts zeros **and negatives** | Task 7 |
| 6 | "create `referenceCosts.ts`" | `routes/index.ts:19-27` mounts every router explicitly; an unmounted route file 404s with no error | Task 7 |
| 7 | Open Warehouses shows Demand Served | **Not automatic.** `OpenWarehousesTab.tsx:158` shows Demand Served only when `displayedInputs.capacityModes` is an empty array, and `Workspace.tsx:3681` passes `capacityModes` **only for `two-echelon-jade-us`** (`undefined` for every other model, by an explicit gold-au regression guard). With `undefined` the tab falls to `showUtilization = capacityMode !== "none"` (`:160`) — and this model has no `capacityMode` input, so a utilization column renders with no denominator. | Task 12 |
| 8 | Precheck emits `unknown_warehouse`/`unknown_customer`/`unknown_lane` | `PrecheckErrorCode` is a closed union (`precheck.ts:76`: `completeness \| id_collision \| reference_integrity \| p_range \| capacity \| zero_demand \| no_feasible_route \| coverage_floor_infeasible`); `PrecheckError` is `{ code; message }` (`:86`). | Task 6 |
| 9 | Re-export the schema from `validation/inputs/index.ts` | That file is a 10-line delegator exporting `ValidateInputsResult` + `validateInputsForModel`; every consumer imports `./maxCoverage.js` etc. directly. | Task 4 |
| 10 | `buildEffectiveFacilityCityLookup` returns an object | Returns `Map<string, string>` (`templates.ts:1388-1402`), with a silent empty-map fallback. | Task 12 |
| 11 | Add `supportsReferenceCosts` to `ModelInfoCapabilities` | No such named schema; capabilities is inline under `ModelInfo` (`openapi.yaml:932-957`) with a `required` list at `:958`. `Scenario.inputs` is an opaque `type: object` (no per-model oneOf) and `ModelInfo.id` has no enum — nothing else in the contract enumerates models. | Task 4 |
| 12 | `cbc.runTimeSec` | `_run_cbc` (`solve.py:192`, `problem_uid` keyword-only) returns `CBCCaptureResult` with `solutionStatus / lpStatus / terminationReason / achievedGap / solverIncumbentObjective / solverBestBound` only. Each solver times itself. | Task 3 |
| 13 | `e2e_journey.py … delivery` | Sections dispatch via the `JOURNEYS` dict (`e2e_journey.py:620-626`); an unknown section exits 1. | Task 13 |
| 14 | "Chapter 4 first, this second" | The Chapter 4 two-step plan is ~60 % implemented: Tasks 1–6 committed on `ch4-2s-7-work` (`14c5e8f`…`63e16d5`, unmerged), Task 7 uncommitted in the locked worktree `.worktrees/ch4-two-step`. Its true file overlap with this plan is `Workspace.tsx`, `OptimizationParametersTab.tsx`, `SolveDialog.tsx`, `openapi.yaml`, `solve.py`, `CLAUDE.md` — not `objective.ts`/`bands.ts`/`chapters.ts`/`precheck.ts`/`templates.ts`. | Task 0, Task 10 |

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `scripts/extract-cog-dataset.py` | Transcribe the COG xlsx into the four dataset files. `--check` mode regenerates to a temp dir and byte-compares. |
| `solvers/delivery-teaching-us/manifest.json` | Model declaration + capabilities + `inputsSchema`. |
| `solvers/delivery-teaching-us/dataset/{warehouses,customers,distances,costs,version}.json` | The dataset package. |
| `artifacts/api-server/src/validation/inputs/delivery.ts` | `deliveryInputsSchema`. |
| `artifacts/api-server/src/data/deliveryDataset.ts` | Entity loader for `GET /dataset`. |
| `artifacts/api-server/src/data/referenceCosts.ts` | Base cost matrix + per-model builder registry + domain validation. |
| `artifacts/api-server/src/routes/referenceCosts.ts` | `GET /models/:id/reference-costs`. |
| `artifacts/api-server/src/__tests__/referenceCosts.test.ts` | 200 / ETag / 304 / 422 / malformed / mounted. |
| `artifacts/api-server/src/__tests__/deliveryContract.test.ts` | `buildPayload` + `deliveryInputsSchema` + `GET /dataset` + manifest-vs-Zod parity. |
| `artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts` | Every model-id registry is the same set (Task 4). |
| `artifacts/api-server/src/solver/tests/test_delivery.py` | Goldens and every solver invariant. |
| `lib/dataset-schema/src/deliveryDataset.test.ts` | Package shape + `version.json` sha (mirror of `maxCoverageDataset.test.ts`). |
| `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx` | Sparse cost-override editor over the base matrix. |
| `artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx` | RTL coverage. |
| `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx` | Tab set, read-only map, objective units, formatting. |
| `artifacts/studio/e2e/delivery-teaching.spec.ts` | Full journey. |

**Modified files** (union of every task's Files list — regenerate this table if a task's list changes)

| Path | Change | Task |
|---|---|---|
| `attached_assets/NOTEBOOKS.md` | Chapter 5 sources + hashes. | 1 |
| `docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py` | Reproducible oracle (`--xlsx`, SHA check, no `~/Downloads`). | 1 |
| `artifacts/api-server/src/solver/tests/test_datasets.py` | `delivery-teaching-us` package/version case. | 1 |
| `lib/dataset-schema/src/index.ts` | `PACKAGE_SPECS`, `MODEL_IDS`, `supportsReferenceCosts` in `ManifestSchema`. | 2 |
| `lib/dataset-schema/src/manifest.test.ts`, `lib/dataset-schema/src/index.test.ts` | Manifest assertions; per-model `validatePackage` + sha block. | 2 |
| `artifacts/api-server/src/registry/modelRegistry.ts` | `KNOWN_SCHEMAS` + `supportsReferenceCosts` capability. | 2, 4 |
| `artifacts/api-server/src/solver/solve.py` | `solve_delivery` + two pure seams + `_assign_band_or_overflow` + dispatcher branch + dataset loaders + `UnresolvableIdError` import. | 3 |
| `artifacts/api-server/src/solver/pmedian.ts` | `SolveInput` union + `buildPayload` branch. | 4 |
| `artifacts/api-server/src/routes/scenarios.ts` | `VALID_MODEL_IDS`. | 4 |
| `artifacts/api-server/src/registry/__tests__/registration.test.ts` | `SOLVABLE`, stub, count 6→7, three source-text gates. | 4 |
| `lib/api-spec/openapi.yaml` (+ regenerated `lib/api-zod`, `lib/api-client-react`) | 4 `modelId` enums, inline `ModelInfo.capabilities.supportsReferenceCosts`, the reference-costs path. | 4, 7 |
| `artifacts/api-server/src/routes/dataset.ts` | Entity branch. | 5 |
| `artifacts/api-server/src/services/precheck.ts` | `precheckDeliveryInputs` + dispatcher branch. | 6 |
| `artifacts/api-server/src/__tests__/precheck.test.ts` | Delivery cases + route-level 422. | 6 |
| `artifacts/api-server/src/routes/index.ts` | Mount `referenceCostsRouter`. | 7 |
| `lib/units/src/objective.ts`, `lib/units/src/__tests__/objective.test.ts` | `objectiveDimension` case + contract row. | 8 |
| `artifacts/studio/src/lib/chapters.ts` | `StudioModelType` + `CHAPTERS` entry. | 8 |
| `artifacts/studio/src/pages/Workspace.tsx` | `defaultInputsForModel`, explicit `inputEntriesForModel` case (exported), read-only map gate, `isEditableInputTab` row, tab render gates, `pMax` arms, `capacityModes` pass-through, OptParams props. | 8, 9, 10, 11, 12 |
| `artifacts/studio/src/__tests__/Landing.test.tsx` | `3 labs` → `4 labs`. | 8 |
| `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` | `readOnly` prop on the `pmedian` arm. | 9 |
| `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` | Adjust Cost Table control. | 10 |
| `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`, `SolveDialog.test.tsx` | Control + `pMax` assertions at both mounts. | 10 |
| `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx` | Delivery describe block. | 11 |
| `lib/units/src/bands.ts`, `lib/units/src/__tests__/bands.test.ts`, `artifacts/studio/src/lib/bands.ts` | Opt-in decimal precision (default unchanged) + shim passthrough. | 12 |
| `artifacts/api-server/src/services/templates.ts`, `artifacts/api-server/src/__tests__/templates.test.ts` | `buildEffectiveFacilityCityLookup` branch. | 12 |
| `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx` | 2 dp for this model. | 12 |
| `artifacts/api-server/src/solver/tests/e2e_journey.py` | `journey_delivery` + `JOURNEYS` entry. | 13 |
| `artifacts/studio/e2e/bundle4-auth-landing.spec.ts`, `bundle6-ui-tweaks.spec.ts` | Lab count 4, chapter strip. | 13 |
| `README.md`, `CLAUDE.md`, `model-integration-precheck.md`, `docs/CHANGELOG-implementation.md` | Closeout. | 13 |
| `docs/superpowers/specs/2026-09-28-chapter-5-delivery-teaching-design.md` | §6.1 `cost` → `minimum: 0`; §7.4 "positive" → "non-negative"; §5.6 solver emits the Overflow row. | this revision |

---

## Task 0: Freeze the base and run the dependency audit

**Files:** none changed. Produces a recorded finding list, not a diff.

**Why it is a task and not a paragraph.** The spec's §9 has 18 registration points, six found only by reading source. This audit runs **twice** — now, and again before closeout — because a consumer added *during* implementation is exactly what a single up-front sweep misses.

- [ ] **Step 1: Record and verify the base commit**

```bash
git rev-parse HEAD
git log --oneline -1
git diff --check
```

Record the SHA in the branch's progress ledger. Expected: a clean `git diff --check` with no output.

- [ ] **Step 2: Confirm the Chapter 4 migration is in ancestry**

The spec's line references were captured after that migration merged. Building on a tree without it means `max-coverage-us` does not exist and half the reference patterns are missing.

```bash
git merge-base --is-ancestor 1761260 HEAD && echo "migration present" || echo "STOP - migration not in ancestry"
```

Expected: `migration present`.

**Chapter 4 two-step.** That plan's Tasks 1–6 are committed on `ch4-2s-7-work` and Task 7 is in progress in `.worktrees/ch4-two-step`; neither is on `main` at `3065c91`. This plan's Task 10 edits the same `OptimizationParametersTab.tsx` and must be built on top of the merged result. Record the state now:

```bash
git branch --no-merged main | grep -c ch4-2s && echo "ch4 two-step NOT merged - Task 10 blocked" || echo "ch4 two-step merged"
git diff --name-only main...ch4-2s-7-work 2>/dev/null | sort
```

If unmerged, Tasks 1–9 and 11–13 proceed on a branch off current `main`; Task 10 waits, and before it starts, the branch is rebased onto the post-Ch4 `main` and Task 10's anchors are re-verified (it uses JSX anchors, not line numbers, for exactly this reason).

- [ ] **Step 3: Enumerate every registry that must learn the new id (probe sweep)**

Every registration point contains the literal id of the newest sibling, so grep for it. Test files and e2e are excluded because they are covered by Step 4.

```bash
rg -n --glob '!**/generated/**' --glob '!**/*.test.*' --glob '!**/__tests__/**' --glob '!e2e/**' \
   '"max-coverage-us"' artifacts lib solvers scripts | sort
```

Expected hit set at `3065c91` (every one is a registration point this plan touches or records as N/A; the file:line and owning task are in the Review record's R7 table):

- `lib/dataset-schema/src/index.ts` (`PACKAGE_SPECS`, `MODEL_IDS`)
- `lib/units/src/objective.ts:20` (`objectiveDimension`)
- `lib/api-spec/openapi.yaml` (×4 enums)
- `artifacts/api-server/src/registry/modelRegistry.ts:31` (`KNOWN_SCHEMAS`)
- `artifacts/api-server/src/routes/scenarios.ts` (`VALID_MODEL_IDS`, `normalizeAddedEntityDistances`, export gate, import gates)
- `artifacts/api-server/src/routes/dataset.ts:30`
- `artifacts/api-server/src/solver/pmedian.ts:13,137`
- `artifacts/api-server/src/services/precheck.ts:183,186,1384`
- `artifacts/api-server/src/services/templates.ts:1399`
- `artifacts/api-server/src/services/import.ts:476,509,553-568,633,918` (N/A for this model — no importable input entities — record as such)
- `artifacts/api-server/src/data/referenceDistances.ts:169-183` (N/A — `supportsReferenceDistances: false`)
- `artifacts/api-server/src/solver/solve.py` (dispatcher, loaders)
- `artifacts/studio/src/lib/chapters.ts:1,52`
- `artifacts/studio/src/pages/Workspace.tsx` (24 hits: `defaultInputsForModel`, `inputEntriesForModel`, `isEditableInputTab`, `saveInLayersRow`, reference-distances `enabled`, input-map dispatch, OptParams/SolveDialog props incl. `pMax`, output-tab `locationById`/`enableFilters`/`capacityModes` gates)
- `solvers/max-coverage-us/manifest.json` (the sibling's own package — not a registration point)

**Anything else is a finding** — record it with its disposition before Task 1.

- [ ] **Step 4: Baseline the counts and enumerations that will change**

```bash
rg -n 'toHaveLength\(6\)|six models|Six models|[0-9]+ labs|hiddenFromLanding|six-model' artifacts lib README.md CLAUDE.md
```

Known at `3065c91`: `README.md:155,171` "six models"; `CLAUDE.md` "Six models live under `solvers/`"; `registration.test.ts:98` `toHaveLength(6)`; `Landing.test.tsx:388` `"3 labs · 3 scenarios · 1 solved"`; `lib/units/src/__tests__/objective.test.ts:4` "the six-model contract"; per-model describe blocks in `lib/dataset-schema/src/index.test.ts`, `Workspace.TabCoverage.test.tsx`, `test_datasets.py`. Landing goes 3 visible labs → 4.

**Do not treat `bundle4-auth-landing.spec.ts` / `bundle6-ui-tweaks.spec.ts` as a correct baseline.** `docs/CHANGELOG-implementation.md:412` records both asserting `"2 labs"` when the true figure has been 3 since Chapter 4 was unlocked, and their `auth-labs-strip` expectations (`"Chapter 3Chapter 9"` vs `"Chapter 3Chapter 10"`) contradict each other. They are already wrong at main; fix them to the true post-change value rather than incrementing their current one.

- [ ] **Step 5: Baseline the gate**

```bash
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
pnpm --filter @workspace/units test
pnpm --filter @workspace/dataset-schema exec vitest run
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
# with api-server + studio running locally (see CLAUDE.md Gotchas for the dev-proxy recipe):
(cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 all)
pnpm e2e:gate
```

Record pass counts for **every** line, including `e2e_journey.py` and `pnpm e2e:gate` — Task 13 Step 5 diffs against this baseline and cannot do so for a command that was never run. A red baseline is a stop-and-report, not something to implement through (the two `"2 labs"` e2e specs are the known-red exception; record them as such). If the package manager cannot bootstrap, resolve that **first** — a failed bootstrap is neither a pass nor a fail and must not be recorded as either.

- [ ] **Step 6: Write the findings into the progress ledger**

An audit whose findings are not written down is an audit that did not happen.

---

## Task 1: Extract the COG dataset

**Files:**
- Create: `scripts/extract-cog-dataset.py`
- Create: `solvers/delivery-teaching-us/dataset/{warehouses,customers,distances,costs,version}.json`
- Modify: `attached_assets/NOTEBOOKS.md`
- Modify: `artifacts/api-server/src/solver/tests/test_datasets.py` (drift guard case)
- Modify: `docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py` (reproducible oracle)
- Create (copy): `attached_assets/COG-Network-Optimization.ipynb`, `attached_assets/COG-Model-Data-3DC-3WH.xlsx`, `attached_assets/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb`

**Interfaces:**
- Produces: the dataset package consumed by every later task. Lane keys `"W<n>,C<n>"`; entity files are id-keyed record maps (`max-coverage-us`'s convention, not `p-median-us`'s ordinal one).
- Consumes: nothing.

- [ ] **Step 1: Verify the source hashes before copying anything**

`~/Downloads` is not a controlled source directory. These are the values recorded during design (spec §4.3):

```bash
shasum -a 256 \
  "$HOME/Downloads/COG_CaseStudy_v2/Network Optimization.ipynb" \
  "$HOME/Downloads/COG_CaseStudy_v2/COG Model Data for In Class Example  3 DC 3 WH.xlsx" \
  "$HOME/Downloads/network-optimization-studio/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb"
```

Expected, exactly:

```
f3de39fb9306d5836a986a0f5349be285e883c904d91d9487b679b8d62f5c097  .../Network Optimization.ipynb
0b8feeba841d55cdbc3c9b852413e0fbc80cb1dc06b7531ef3503a9e42be28c3  .../COG Model Data for In Class Example  3 DC 3 WH.xlsx
98ef03da4fee2f54d9f5d30fbe88f212b870b92fa5aab11ba46b3e266c07fd01  .../Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb
```

Any mismatch is a **stop-and-report** — the source changed since design and the goldens in this plan may no longer describe it.

- [ ] **Step 2: Copy the three sources into `attached_assets/`**

```bash
cp "$HOME/Downloads/COG_CaseStudy_v2/Network Optimization.ipynb" \
   attached_assets/COG-Network-Optimization.ipynb
cp "$HOME/Downloads/COG_CaseStudy_v2/COG Model Data for In Class Example  3 DC 3 WH.xlsx" \
   attached_assets/COG-Model-Data-3DC-3WH.xlsx
cp "$HOME/Downloads/network-optimization-studio/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb" \
   attached_assets/
shasum -a 256 attached_assets/COG-Network-Optimization.ipynb \
              attached_assets/COG-Model-Data-3DC-3WH.xlsx \
              attached_assets/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb
```

Re-hash after the copy and confirm the three values are unchanged.

- [ ] **Step 3: Write the extraction script**

Create `scripts/extract-cog-dataset.py`. It uses only the standard library — `pandas` is **not** installed in this environment, so the xlsx is parsed with `zipfile` + `ElementTree`.

```python
#!/usr/bin/env python3
"""Transcribe the COG in-class workbook into solvers/delivery-teaching-us/dataset/.

Chapter 5 (modified) — Delivery Company Teaching Example.

The workbook's `Plants` and `Customers` sheets reuse ONE id space (plant 8 and
customer 8 are both Atlanta), so ids are role-prefixed here: W<n> / C<n>. Lane
keys are "W8,C269", matching max-coverage-us's id-keyed convention rather than
p-median-us's older ordinal one.

costs.json is written as a byte-for-byte copy of distances.json's values:
"for just this example the cost and the distance are the same" (spec decision 3).
They are separate files because a student overrides cost and never distance.

Usage:
  python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx
  python3 scripts/extract-cog-dataset.py --xlsx ... --check
"""
import argparse
import filecmp
import hashlib
import json
import os
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": M, "r": R}

EXPECTED_XLSX_SHA256 = "0b8feeba841d55cdbc3c9b852413e0fbc80cb1dc06b7531ef3503a9e42be28c3"
EXPECTED_WAREHOUSES = 33
EXPECTED_CUSTOMERS = 313
EXPECTED_LANES = 10329
EXPECTED_TOTAL_DEMAND = 208829000


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _col_letters(ref):
    """'AB12' -> 'AB'. Cells carry their own column in `r`; positional reading
    is wrong because xlsx OMITS empty cells, so a blank Zip Code would shift
    every later column silently."""
    return "".join(ch for ch in ref if ch.isalpha())


def sheet_records(z, sheets, sst, name):
    """Return a list of {header: raw-cell-text} dicts, one per data row.

    Keyed by header name via the header row's column letters, never by
    position. The workbook's sheets carry columns this script does not use
    (Customers: Name, Active, Country or Region; Plants: Status too; Demand:
    Customer, Product ID, Product, Time Period ID, Time Period; Distance
    Matrix: Plant, Customer) - reading by name makes them harmless.
    """
    target = sheets[name]
    path = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
    ws = ET.fromstring(z.read(path))

    def cell_value(c):
        t = c.get("t")
        v = c.find("m:v", NS)
        if v is None:
            return None
        if t == "s":
            return sst[int(v.text)]
        return v.text

    rows = list(ws.iter("{%s}row" % M))
    header_by_col = {_col_letters(c.get("r")): cell_value(c) for c in rows[0].findall("m:c", NS)}
    records = []
    for row in rows[1:]:
        rec = {h: None for h in header_by_col.values()}
        for c in row.findall("m:c", NS):
            h = header_by_col.get(_col_letters(c.get("r")))
            if h is not None:
                rec[h] = cell_value(c)
        records.append(rec)
    return records


def zip5(raw):
    """Spec 4.3: ZIPs are strings and keep leading zeros. A numeric cell for
    Boston arrives as '2101' (or '2101.0'); restore the 5-digit form."""
    if raw is None:
        return None
    s = str(raw).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(5) if s.isdigit() else s


def load_workbook(xlsx_path):
    z = zipfile.ZipFile(xlsx_path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target")
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheets = {s.get("name"): rels[s.get("{%s}id" % R)]
              for s in wb.find("m:sheets", NS)}
    sst = ["".join(t.text or "" for t in si.iter("{%s}t" % M))
           for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    return z, sheets, sst


def num(raw, places):
    """Strip IEEE noise: 622.11569999999995 -> 622.1157."""
    return round(float(raw), places)


def build(xlsx_path):
    z, sheets, sst = load_workbook(xlsx_path)

    plants = sheet_records(z, sheets, sst, "Plants")
    customers = sheet_records(z, sheets, sst, "Customers")
    demand = sheet_records(z, sheets, sst, "Demand")
    distances = sheet_records(z, sheets, sst, "Distance Matrix")

    def ident(raw):
        # Numeric id cells arrive as '8' or '8.0' depending on the writer.
        s = str(raw).strip()
        return s[:-2] if s.endswith(".0") else s

    warehouses = {}
    for r in plants:
        wid = "W" + ident(r["ID"])
        warehouses[wid] = {
            "id": wid,
            "city": r["City"],
            "state": r["State"],
            "lat": num(r["Latitude"], 6),
            "lng": num(r["Longitude"], 6),
            "zip": zip5(r["Zip Code"]),
        }

    demand_by_customer = {ident(r["Customer ID"]): float(r["Demand"])
                          for r in demand if r["Demand"] is not None}

    customers_out = {}
    for r in customers:
        raw_id = ident(r["ID"])
        cid = "C" + raw_id
        customers_out[cid] = {
            "id": cid,
            "city": r["City"],
            "state": r["State"],
            "lat": num(r["Latitude"], 6),
            "lng": num(r["Longitude"], 6),
            "zip": zip5(r["Zip Code"]),
            "demand": demand_by_customer[raw_id],
        }

    lanes = {}
    for r in distances:
        key = "W" + ident(r["Plant ID"]) + ",C" + ident(r["Customer ID"])
        if key in lanes:
            raise SystemExit("duplicate lane key: " + key)
        lanes[key] = num(r["Distance"], 4)

    # Fail loud rather than emitting a plausible-but-wrong package.
    assert len(warehouses) == EXPECTED_WAREHOUSES, len(warehouses)
    assert len(customers_out) == EXPECTED_CUSTOMERS, len(customers_out)
    assert len(lanes) == EXPECTED_LANES, len(lanes)
    assert sum(c["demand"] for c in customers_out.values()) == EXPECTED_TOTAL_DEMAND
    missing = [(w, c) for w in warehouses for c in customers_out
               if f"{w},{c}" not in lanes]
    assert not missing, f"{len(missing)} missing lanes, e.g. {missing[:3]}"
    # Spec Gate B: coordinates inside the continental-US box the manifest
    # declares, and ZIPs as 5-character strings.
    for e in list(warehouses.values()) + list(customers_out.values()):
        assert 24 <= e["lat"] <= 50 and -125 <= e["lng"] <= -66, (e["id"], e["lat"], e["lng"])
        assert isinstance(e["zip"], str) and len(e["zip"]) == 5, (e["id"], e["zip"])

    return {
        "warehouses.json": warehouses,
        "customers.json": customers_out,
        "distances.json": lanes,
        "costs.json": dict(lanes),   # seeded identical - spec decision 3
    }


def write_files(files, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, payload in files.items():
        with open(os.path.join(out_dir, name), "w") as fh:
            json.dump(payload, fh, indent=2, sort_keys=False)
            fh.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out-dir", default="solvers/delivery-teaching-us/dataset")
    ap.add_argument("--check", action="store_true",
                    help="regenerate into a temp dir and byte-compare; write nothing")
    args = ap.parse_args()

    actual = sha256_of(args.xlsx)
    if actual != EXPECTED_XLSX_SHA256:
        raise SystemExit(
            f"source sha256 mismatch\n  expected {EXPECTED_XLSX_SHA256}\n  actual   {actual}")

    files = build(args.xlsx)

    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            write_files(files, tmp)
            bad = []
            for name in files:
                a, b = os.path.join(tmp, name), os.path.join(args.out_dir, name)
                if not os.path.exists(b) or not filecmp.cmp(a, b, shallow=False):
                    bad.append(name)
            if bad:
                raise SystemExit("DRIFT: " + ", ".join(bad))
            print("check OK - all 4 files byte-identical")
            return

    write_files(files, args.out_dir)
    print(f"wrote {len(files)} files to {args.out_dir}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the extraction**

```bash
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx
```

Expected: `wrote 4 files to solvers/delivery-teaching-us/dataset`, no assertion failure.

- [ ] **Step 5: Verify the extracted shape independently of the script**

```bash
python3 - <<'PY'
import json
d = "solvers/delivery-teaching-us/dataset/"
w = json.load(open(d + "warehouses.json"))
c = json.load(open(d + "customers.json"))
dist = json.load(open(d + "distances.json"))
cost = json.load(open(d + "costs.json"))
print("warehouses", len(w), "customers", len(c), "lanes", len(dist))
print("total demand", sum(x["demand"] for x in c.values()))
print("keys identical:", dist.keys() == cost.keys())
print("values identical:", dist == cost)
print("zero lanes:", sum(1 for v in dist.values() if v == 0))
print("exactly 800:", sum(1 for v in dist.values() if v == 800))
print("max distance:", max(dist.values()))
print("first customer:", next(iter(c.values()))["id"], next(iter(c.values()))["city"])
print("W1,C1 self-lane:", dist["W1,C1"])
print("zip strings:", all(isinstance(e["zip"], str) and len(e["zip"]) == 5 for e in list(w.values()) + list(c.values())))
print("plant ids:", sorted(int(k[1:]) for k in w))
PY
```

Expected exactly: `warehouses 33 customers 313 lanes 10329`, `total demand 208829000`, `keys identical: True`, `values identical: True`, `zero lanes: 33`, `exactly 800: 0`, `max distance: 3268.8663` (the 4 dp value from the sheet; spec §4.1 quotes it at 2 dp), `first customer: C1 Los Angeles`, `W1,C1 self-lane: 0.0`, `zip strings: True`, `plant ids: [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 19, 22, 25, 27, 28, 35, 38, 39, 43, 44, 45, 52, 55, 57, 60, 66, 99, 116, 152]`.

The `W1,C1` line matters downstream: 33 customers are co-located with a plant and their self-lane is `0`. Task 3's override-invariance test must skip those lanes (Review record B2).

- [ ] **Step 6: Prove `--check` detects drift**

A check mode that has never failed is not known to work.

```bash
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx --check
python3 - <<'PY'
import json
p = "solvers/delivery-teaching-us/dataset/costs.json"
d = json.load(open(p)); k = next(iter(d)); d[k] = d[k] + 1
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
PY
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx --check || echo "drift correctly detected"
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx
```

Expected: first `check OK`, then `DRIFT: costs.json` and `drift correctly detected`, then a clean regeneration.

- [ ] **Step 7: Update `attached_assets/NOTEBOOKS.md`**

It currently records Chapter 5 as having no notebook (`:16` table row, `:104-109` section). Replace that with the three committed sources and their sha256 from Step 2, in the file's existing table format.

- [ ] **Step 8: Add the Python-side package drift guard**

`artifacts/api-server/src/solver/tests/test_datasets.py` is the C1.3 drift guard — one hand-written test per model, comparing the package's bytes to `version.json` and checking the loaded counts on `solve`. Append, following `test_p_median_us_matches_its_version`'s shape exactly:

```python
def test_delivery_teaching_us_matches_its_version():
    """Chapter 5 (modified). Two lane tables; both hashed, both loaded."""
    version = package_version("delivery-teaching-us")
    assert package_sha256("delivery-teaching-us",
                          ["warehouses.json", "customers.json", "distances.json", "costs.json"]) == version["sha256"]
    assert len(S.DELIV_WAREHOUSES) == 33
    assert len(S.DELIV_CUSTOMERS) == 313
    assert len(S.DELIV_DISTANCES) == 10329
    assert S.DELIV_DISTANCES.keys() == S.DELIV_COSTS.keys()
    assert S.DELIV_DISTANCES == S.DELIV_COSTS          # seeded identical (decision 3)
    assert sum(1 for v in S.DELIV_DISTANCES.values() if v == 0) == 33
```

This test is **red until Task 2 writes `version.json` and Task 3 adds the loaders** — expected; it is committed here so the package it guards and the guard land together, and it goes green in Task 3 Step 7.

- [ ] **Step 9: Make the design-time oracle reproducible**

Spec §4.3 / §12.5 make this a precondition for the goldens counting as independently measured. `docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py` (76 lines) currently hardcodes `~/Downloads` and `/tmp/ch5x/`. Rework it to: take `--xlsx` (required) and `--json-out` (optional); verify the xlsx sha256 against `EXPECTED_XLSX_SHA256` before reading; create only the directory it was asked to write; keep its formulation byte-for-byte (`<= P`, per-pair linking, cost derived from distance at solve time, cumulative bands to 2 dp). Run it once against `attached_assets/COG-Model-Data-3DC-3WH.xlsx` and confirm it prints the two goldens from Global Constraints. It shares no code with `solve.py` — that is what makes it an oracle.

- [ ] **Step 10: Commit**

`version.json` is written in Task 2, because its sha256 covers exactly the files `PACKAGE_SPECS` lists and that spec does not exist yet.

```bash
git add scripts/extract-cog-dataset.py \
        solvers/delivery-teaching-us/dataset/ \
        attached_assets/COG-Network-Optimization.ipynb \
        attached_assets/COG-Model-Data-3DC-3WH.xlsx \
        attached_assets/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb \
        attached_assets/NOTEBOOKS.md \
        artifacts/api-server/src/solver/tests/test_datasets.py \
        docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py
git commit -m "[ch5-del-1] transcribe the COG dataset and commit its sources"
```

---

## Task 2: Manifest, package spec, and the `supportsReferenceCosts` capability

**Files:**
- Create: `solvers/delivery-teaching-us/manifest.json`
- Create: `solvers/delivery-teaching-us/dataset/version.json`
- Modify: `lib/dataset-schema/src/index.ts` (`ManifestSchema` capabilities ~`:226`, `PACKAGE_SPECS` `:115`, `MODEL_IDS` `:269`)
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts` (`PublicModelInfo.capabilities` intersection `:69-80`, `toPublic` mapping `:103`)
- Test: `lib/dataset-schema/src/manifest.test.ts` (append), `lib/dataset-schema/src/index.test.ts` (append), `lib/dataset-schema/src/deliveryDataset.test.ts` (create)

**Interfaces:**
- Produces: `readManifest("delivery-teaching-us")` / `getManifest("delivery-teaching-us")` resolve; `capabilities.supportsReferenceCosts: boolean` exists on the public model-info type; `readVersion("delivery-teaching-us")` returns `{ version, sha256 }`.
- Consumes: Task 1's dataset files.

`readManifest` (`lib/dataset-schema`, throws on a missing file) and `getManifest` (`api-server/registry/modelRegistry.ts:115`, returns `Manifest | undefined` from the boot-time discovery map) are two different functions in two packages; tests in `lib/dataset-schema` use the former, api-server routes the latter.

- [ ] **Step 1: Write the failing manifest test**

Append to `lib/dataset-schema/src/manifest.test.ts`:

```ts
describe("delivery-teaching-us manifest (Chapter 5, 7th model)", () => {
  it("declares no capacity, P support, and reference costs", () => {
    const m = readManifest("delivery-teaching-us");
    expect(m.capabilities.supportsP).toBe(true);
    expect(m.capabilities.capacityModes).toEqual([]);
    expect(m.capabilities.demandEditable).toBe(false);
    expect(m.capabilities.supportsFacilityStatus).toBe(false);
    expect(m.capabilities.supportsReferenceCosts).toBe(true);
    expect(m.capabilities.supportsReferenceDistances).toBe(false);
    expect(m.distanceUnit).toBe("mi");
    expect(m.chapter).toBe("Chapter 5");
  });

  // capacityModes: [] is what drives OpenWarehousesTab's Demand Served column
  // (OpenWarehousesTab.tsx:158) - but only once Workspace.tsx:3681 passes it
  // through for this model (Task 12; today that pass-through is jade-only).
  // An absent array falls through to the capacityMode-string gate and renders
  // a utilization % this model cannot compute, so "empty" and "absent" are
  // NOT interchangeable here.
  it("distinguishes an empty capacityModes array from an absent one", () => {
    expect(readManifest("delivery-teaching-us").capabilities.capacityModes).toHaveLength(0);
  });

  it("defaults supportsReferenceCosts to false for every pre-existing model", () => {
    for (const id of ["p-median-us", "transport-coal", "p-median-brazil",
                      "two-echelon-gold-au", "two-echelon-jade-us", "max-coverage-us"]) {
      expect(readManifest(id).capabilities.supportsReferenceCosts).toBe(false);
    }
  });
});
```

Append to `lib/dataset-schema/src/index.test.ts`, mirroring the `max-coverage-us registration` block at `:64-82` — this file is one hand-written `describe` per model, not a loop over `PACKAGE_SPECS`, so a model without a block has **no** package validation and **no** sha coverage:

```ts
describe("delivery-teaching-us registration (Chapter 5, modified)", () => {
  it("validates the delivery-teaching-us package against its schema", () => {
    const spec = PACKAGE_SPECS.find(s => s.modelId === "delivery-teaching-us");
    expect(spec).toBeDefined();
    const result = validatePackage(spec!);
    expect(Object.keys(result["warehouses.json"] as object)).toHaveLength(33);
    expect(Object.keys(result["customers.json"] as object)).toHaveLength(313);
    expect(Object.keys(result["distances.json"] as object)).toHaveLength(10329);
    expect(Object.keys(result["costs.json"] as object)).toHaveLength(10329);
  });

  it("computeSha256 matches the version.json sha256 for delivery-teaching-us", () => {
    const spec = PACKAGE_SPECS.find(s => s.modelId === "delivery-teaching-us")!;
    expect(computeSha256(spec)).toBe(readVersion("delivery-teaching-us").sha256);
  });
});
```

Create `lib/dataset-schema/src/deliveryDataset.test.ts`, mirroring `maxCoverageDataset.test.ts` (same imports; `dir` points at `delivery-teaching-us`):

```ts
describe("delivery-teaching-us dataset package", () => {
  it("has 33 warehouses and 313 customers, keyed by role-prefixed entity id", () => {
    const w = read("warehouses.json");
    const c = read("customers.json");
    expect(Object.keys(w)).toHaveLength(33);
    expect(Object.keys(c)).toHaveLength(313);
    expect(w["W1"]).toMatchObject({ id: "W1", city: "Los Angeles" });
    expect(c["C1"]).toMatchObject({ id: "C1", city: "Los Angeles" });
    for (const [key, row] of Object.entries(w)) expect((row as { id: string }).id).toBe(key);
    for (const [key, row] of Object.entries(c)) expect((row as { id: string }).id).toBe(key);
    for (const row of [...Object.values(w), ...Object.values(c)]) {
      expect((row as { zip: string }).zip).toMatch(/^\d{5}$/);   // spec 4.3 leading zeros
    }
  });

  it("has all 10,329 lanes in BOTH tables, identical at seed, with 33 zero self-lanes", () => {
    const d = read("distances.json");
    const k = read("costs.json");
    expect(Object.keys(d)).toHaveLength(10329);
    expect(k).toEqual(d);
    expect(Object.values(d).filter((v) => v === 0)).toHaveLength(33);
    expect(d["W1,C1"]).toBe(0);
  });

  it("version.json's sha256 equals a recomputation over the four files in sorted order", () => {
    const v = read("version.json");
    expect(v.version).toBe(1);
    const hash = createHash("sha256");
    for (const name of ["costs.json", "customers.json", "distances.json", "warehouses.json"]) {
      hash.update(readFileSync(path.join(dir, name)));
    }
    expect(v.sha256).toBe(hash.digest("hex"));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @workspace/dataset-schema exec vitest run src/manifest.test.ts src/index.test.ts src/deliveryDataset.test.ts
```

Expected: FAIL — manifest file does not exist; `PACKAGE_SPECS.find` returns undefined; `version.json` missing.

- [ ] **Step 3: Write the manifest**

Create `solvers/delivery-teaching-us/manifest.json`:

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
            "cost": { "type": "number", "minimum": 0 }
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

`countryBounds` reuses `p-median-us`'s continental-US box. The measured extent (lat 25.7783–48.7306, lng −123.0804–−68.8299) sits strictly inside it, so the map framing matches Chapter 3 and no bespoke bounds are needed.

- [ ] **Step 4: Declare the capability in `ManifestSchema`**

In `lib/dataset-schema/src/index.ts`, beside `supportsFacilityStatus` (~`:226`):

```ts
    // Chapter 5 delivery — the cost table is the only editable input, and it
    // is a SPARSE override list, so a student who has overridden nothing would
    // see an empty table. This capability gates GET /models/:id/reference-costs,
    // the cost-side mirror of supportsReferenceDistances. Defaults false so no
    // existing model's behaviour changes.
    supportsReferenceCosts: z.boolean().optional().default(false),
```

- [ ] **Step 5: Add the package spec and the id**

`PACKAGE_SPECS` (`:115`) gains, reusing the shared entry schemas exactly as `max-coverage-us` does:

```ts
  {
    modelId: "delivery-teaching-us",
    files: {
      "warehouses.json": z.record(z.string(), WarehouseEntry),
      "customers.json": z.record(z.string(), CustomerEntry),
      "distances.json": DistanceMap,
      "costs.json": DistanceMap,
    },
  },
```

`MODEL_IDS` (`:269`) gains `"delivery-teaching-us"`.

**`DistanceMap` is `z.record(z.string(), z.number())` — it accepts zeros and negatives.** It is a shape check, not a domain check. Domain validation lives in Task 7's reference-cost builder. Do not tighten `DistanceMap`; five models depend on its current permissiveness. (`WarehouseEntry`/`CustomerEntry` are plain `z.object` — default *strip* — so `zip` survives because it is declared at `:16`, and any extra key would be dropped silently, not rejected.)

- [ ] **Step 6: Expose the capability through the registry**

In `artifacts/api-server/src/registry/modelRegistry.ts`, the public capabilities type is the inline intersection on `PublicModelInfo` (`:69-80`, `capabilities: Manifest["capabilities"] & { … supportsReferenceDistances: boolean; … }`). Add beside `supportsReferenceDistances` (`:80`):

```ts
    supportsReferenceCosts: boolean;
```

and to `toPublic(manifest)`'s mapping (`:103`):

```ts
      supportsReferenceCosts: manifest.capabilities?.supportsReferenceCosts ?? false,
```

A capability declared only in the manifest is invisible to the frontend, which reads capabilities off `GET /api/models`.

- [ ] **Step 7: Generate `version.json`**

`computeSha256` hashes the `files` keys in sorted filename order — `costs.json`, `customers.json`, `distances.json`, `warehouses.json` — so the spec must exist first.

```bash
node --input-type=module -e "
import { PACKAGE_SPECS, computeSha256 } from '@workspace/dataset-schema';
import { writeFileSync } from 'fs';
const spec = PACKAGE_SPECS.find(s => s.modelId === 'delivery-teaching-us');
const sha256 = computeSha256(spec);
writeFileSync('solvers/delivery-teaching-us/dataset/version.json',
  JSON.stringify({ version: 1, sha256 }, null, 2) + '\n');
console.log(sha256);
"
```

Expected: a 64-character hex digest printed, and the file written.

- [ ] **Step 8: Run the package tests to verify they pass**

```bash
pnpm --filter @workspace/dataset-schema exec vitest run
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/registry.test.ts src/__tests__/datasets.test.ts
```

Expected: PASS. `registry.test.ts` is the per-model capability-row suite (spec §8.3) — if it enumerates models by hand, add the delivery row there too and commit it here.

- [ ] **Step 9: Commit**

```bash
git add solvers/delivery-teaching-us/manifest.json \
        solvers/delivery-teaching-us/dataset/version.json \
        lib/dataset-schema/src/index.ts \
        lib/dataset-schema/src/manifest.test.ts \
        lib/dataset-schema/src/index.test.ts \
        lib/dataset-schema/src/deliveryDataset.test.ts \
        artifacts/api-server/src/registry/modelRegistry.ts
git commit -m "[ch5-del-2] register the delivery manifest, package spec, and reference-costs capability"
```

---

## Task 3: The Python solver

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py` (imports `:24-26`, dataset loaders block `:73-176`, new `solve_delivery` + seams before the dispatcher, dispatcher `:1477-1494`)
- Create: `artifacts/api-server/src/solver/tests/test_delivery.py`

**Interfaces:**
- Produces: `solve_delivery(inp)`; pure seams `_effective_delivery_costs(cost, dist, inp)` and `_build_delivery_problem(ec, p)` (module-level `DELIV_*` tables supply warehouses/customers/demand); band helper `_assign_band_or_overflow(d, bands)`; wire `modelType: "delivery"`.
- Consumes: Task 1's dataset files; `UnresolvableIdError` from `merge_inputs.py:31`.

This task is first among the code tasks because it is the only one whose correctness is pinned by measured numbers. Everything downstream is plumbing around it.

**Conventions every solver in this file follows, and this one must too** (all verified at `3065c91`): time the solve yourself (`t = time.time()` … `round(time.time() - t, 2)`); `_run_cbc(prob, gap, time_limit, problem_uid="…")` — `problem_uid` is keyword-only and isolates the CBC log path; the result has **no** `runTimeSec`; `cbc.lpStatus` is the raw PuLP string and goes in `_envelope`'s second (`quality`) slot; `Infeasible` → an `"infeasible"` envelope, any other non-`Optimal` → an `"error"` envelope with `_failureReason="solver_error"` and `_failureStage="cbc_parse"` (`solve.py:1428-1446`), otherwise jobRunner publishes a bogus success; always forward `termination_reason`, `achieved_gap`, `solver_incumbent_objective`, `solver_best_bound`. The eight PuLP names the snippet uses are already imported at `solve.py:24-26`.

- [ ] **Step 1: Write the failing golden tests**

Create `artifacts/api-server/src/solver/tests/test_delivery.py`:

```python
"""Chapter 5 (modified) - Delivery Company Teaching Example.

Goldens are measured, not predicted: the design-time prototype at
docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py solved this
exact formulation against the source workbook with PuLP/CBC. It shares no code
with solve.py, which is what makes it an independent oracle rather than a
restatement.
"""
import sys
from pathlib import Path

import pytest

# No conftest.py exists anywhere in this repo; every solver test bootstraps
# its own import path exactly like this (tests/test_max_coverage.py:22-24).
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from merge_inputs import UnresolvableIdError  # noqa: E402
from solve import (  # noqa: E402
    solve_delivery,
    _effective_delivery_costs,
    _build_delivery_problem,
    _assign_band_or_overflow,
    DELIV_DISTANCES,
    DELIV_COSTS,
)

BASE = {
    "modelType": "delivery",
    "pValue": 3,
    "distanceBands": [400, 800, 1200, 1600],
    "gap": 0,
    "timeLimitSec": 300,
    "laneCostOverrides": [],
    "costAdjustEnabled": False,
    "distanceThreshold": 800,
    "costPerMile": 1,
    "costPerMileOver": 10,
}


def adjusted(**over):
    return {**BASE, "costAdjustEnabled": True, **over}


def bands_of(env):
    return {row["band"]: row["percent"] for row in env["metrics"]["bandCoverage"]}


def test_scenario_1_golden():
    env = solve_delivery(dict(BASE))
    assert env["solutionStatus"] == "optimal"
    assert env["objective"] == pytest.approx(88240913478.10, rel=1e-9)
    assert set(env["details"]["openWarehouseIds"]) == {"W1", "W2", "W60"}
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(422.5511, abs=5e-4)
    b = bands_of(env)
    assert b[400] == pytest.approx(59.38, abs=5e-3)
    assert b[800] == pytest.approx(81.45, abs=5e-3)
    assert b[1200] == pytest.approx(99.44, abs=5e-3)
    assert b[1600] == pytest.approx(100.00, abs=5e-3)


def test_scenario_2_golden():
    env = solve_delivery(adjusted())
    assert env["solutionStatus"] == "optimal"
    assert env["objective"] == pytest.approx(150194534098.60, rel=1e-9)
    assert set(env["details"]["openWarehouseIds"]) == {"W6", "W43", "W45"}
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(508.6534, abs=5e-4)
    b = bands_of(env)
    assert b[400] == pytest.approx(26.43, abs=5e-3)
    assert b[800] == pytest.approx(97.19, abs=5e-3)
    assert b[1200] == pytest.approx(100.00, abs=5e-3)
    assert b[1600] == pytest.approx(100.00, abs=5e-3)


def test_avg_distance_not_derived_from_objective():
    """The bug class this repo has already shipped twice (Ch9, Ch10).

    With the adjustment ON the objective is in dollars, so objective/demand is
    dollars-per-unit. If weightedAvgDistance were derived that way it would be
    a plausible number under a distance label - no exception, no failing
    assertion. 508.6534 mi vs 719.2... $/unit are far enough apart that this
    assertion cannot pass by coincidence.
    """
    env = solve_delivery(adjusted())
    total_demand = 208829000
    derived = env["objective"] / total_demand
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(508.6534, abs=5e-4)
    assert abs(env["metrics"]["weightedAvgDistance"] - derived) > 1.0


def test_toggle_off_equals_unit_rate():
    """"Off" IS the case study's Scenario 1 ($1/mile), because costs are
    seeded equal to distances. Nothing special-cases it."""
    off = solve_delivery(dict(BASE))
    unit = solve_delivery(adjusted(costPerMile=1, costPerMileOver=1))
    assert off["objective"] == pytest.approx(unit["objective"], rel=1e-9)


def test_facility_count_is_at_most_p():
    """Decision 8. Asserted against the BUILT PuLP problem, never source text."""
    import pulp
    ec = _effective_delivery_costs(DELIV_COSTS, DELIV_DISTANCES, BASE)
    prob, _y, o = _build_delivery_problem(ec, p=3)
    named = {c.name: c for c in prob.constraints.values()}
    assert "FacilityCount" in named
    assert named["FacilityCount"].sense == pulp.LpConstraintLE
    env = solve_delivery(dict(BASE))
    assert len(env["details"]["openWarehouseIds"]) <= 3


def test_threshold_boundary_is_inclusive():
    """Decision 7. Synthetic by necessity - zero real lanes measure exactly 800."""
    dist = {("W1", "C1"): 800.0, ("W1", "C2"): 800.0001}
    cost = {("W1", "C1"): 800.0, ("W1", "C2"): 800.0001}
    ec = _effective_delivery_costs(cost, dist, adjusted())
    assert ec[("W1", "C1")] == pytest.approx(800.0 * 1)
    assert ec[("W1", "C2")] == pytest.approx(800.0001 * 10)


def test_cost_override_does_not_move_distance_metrics():
    """The section 5.4 invariant, with the precondition FORCED.

    A large enough override legitimately changes the optimum and therefore
    legitimately moves WAD. This case picks a lane already in the base
    solution and lowers its cost. Lowering the cost of a lane the optimum
    already uses cannot make any other solution strictly better than it,
    so the open set and assignment are unchanged; that equality is asserted
    before the metrics are compared.

    The lane must have a POSITIVE base cost: 33 customers are co-located
    with a plant (C1/W1 = Los Angeles, distance 0), and assignments[0] IS
    one of them - overriding a zero to zero changes nothing and the strict
    objective decrease below would fail for no real reason.
    """
    base = solve_delivery(dict(BASE))
    lane = next(a for a in base["details"]["assignments"] if a["distanceMi"] > 0)
    demand = _customers()[lane["customerId"]]["demand"]
    base_cost = DELIV_COSTS[(lane["warehouseId"], lane["customerId"])]
    over = solve_delivery({**BASE, "laneCostOverrides": [
        {"fromId": lane["warehouseId"], "toId": lane["customerId"], "cost": 0.0}]})
    assert set(over["details"]["openWarehouseIds"]) == set(base["details"]["openWarehouseIds"])
    assert _assignment_map(over) == _assignment_map(base)
    # Exactly the removed cost x demand, not merely "less".
    assert over["objective"] == pytest.approx(base["objective"] - base_cost * demand, abs=0.02)
    assert over["metrics"]["weightedAvgDistance"] == pytest.approx(
        base["metrics"]["weightedAvgDistance"], abs=1e-9)
    assert over["metrics"]["bandCoverage"] == base["metrics"]["bandCoverage"]


def test_cost_override_large_enough_does_move_the_assignment():
    """The other side. A cost change that reroutes demand SHOULD move WAD;
    a test that only ever proves invariance would pass against a solver that
    ignored overrides entirely."""
    base = solve_delivery(dict(BASE))
    huge = [{"fromId": a["warehouseId"], "toId": a["customerId"], "cost": 1e7}
            for a in base["details"]["assignments"][:40]]
    over = solve_delivery({**BASE, "laneCostOverrides": huge})
    assert _assignment_map(over) != _assignment_map(base)


def test_edges_carry_distance_not_cost():
    """ServiceStatsTab recomputes live coverage from edges[].distance. Put cost
    there and the coverage bars silently become a cost histogram in miles."""
    env = solve_delivery(adjusted())
    for e in env["edges"]:
        assert e["distance"] == pytest.approx(DELIV_DISTANCES[(e["fromId"], e["toId"])])
        assert e["flow"] == round(_customers()[e["toId"]]["demand"])


def test_assignment_record_shape():
    """Pins the plan's choice of solve_pmedian's record shape (solve.py:475-476)
    so a later edit cannot rename distanceMi to distance or drop band."""
    a = solve_delivery(dict(BASE))["details"]["assignments"][0]
    assert set(a) == {"customerId", "warehouseId", "distanceMi", "band"}
    assert a["distanceMi"] == pytest.approx(DELIV_DISTANCES[(a["warehouseId"], a["customerId"])])


def test_band_coverage_is_cumulative_and_exact():
    """Exact values, not merely non-decreasing - an exclusive rollup is also
    non-decreasing, so that assertion cannot tell the two semantics apart."""
    b = bands_of(solve_delivery(dict(BASE)))
    assert [b[400], b[800], b[1200], b[1600]] == [
        pytest.approx(59.38, abs=5e-3), pytest.approx(81.45, abs=5e-3),
        pytest.approx(99.44, abs=5e-3), pytest.approx(100.00, abs=5e-3)]
    assert -1 not in b          # both goldens reach 100% by 1600: no Overflow row


def test_overflow_band_is_emitted():
    """Spec 5.6 / 12.3.7: an explicit Overflow row (band -1, the OVERFLOW_BAND
    sentinel shared with lib/units and the gold/jade envelopes) whenever any
    assigned lane exceeds the largest band. Both goldens reach 100% by 1600,
    so a narrower band set is used to force it. Asserts the ROW EXISTS with
    the right remainder - `total < 100` alone is true even when no row is
    emitted, which is the bug this test exists to catch."""
    env = solve_delivery({**BASE, "distanceBands": [100, 200]})
    b = bands_of(env)
    assert -1 in b
    assert b[-1] == pytest.approx(100.0 - b[200], abs=5e-3)
    assert 0 < b[-1] < 100
    # edges beyond every band carry the overflow index len(bands), never a clamp
    assert any(e["band"] == 2 for e in env["edges"])
    assert all(e["band"] in (0, 1, 2) for e in env["edges"])


def test_assign_band_or_overflow_never_clamps():
    """The three older solvers clamp an over-band lane into the LAST band
    (solve.py:470, 642, 835 - documented at :1004-1006 as a misreporting
    fallback). This helper must return len(bands) instead."""
    assert _assign_band_or_overflow(50, [100, 200]) == 0
    assert _assign_band_or_overflow(100, [100, 200]) == 0     # inclusive upper edge
    assert _assign_band_or_overflow(150, [100, 200]) == 1
    assert _assign_band_or_overflow(201, [100, 200]) == 2     # overflow, not 1


def test_single_source():
    """Decision 9: exactly one assignment per customer AND it carries the
    customer's whole demand (spec 8.2's `flow == demand` half)."""
    env = solve_delivery(dict(BASE))
    seen = {}
    for a in env["details"]["assignments"]:
        assert a["customerId"] not in seen
        seen[a["customerId"]] = a["warehouseId"]
    assert len(seen) == 313
    flow_by_customer = {}
    for e in env["edges"]:
        flow_by_customer[e["toId"]] = flow_by_customer.get(e["toId"], 0) + e["flow"]
    for cid, c in _customers().items():
        assert flow_by_customer[cid] == round(c["demand"])


def test_no_utilization_metric():
    """No capacity means no utilization denominator. Emitting one would plant a
    number nothing can compute; OpenWarehousesTab shows Demand Served instead."""
    env = solve_delivery(dict(BASE))
    assert "utilizationByNode" not in env["metrics"]


def test_unknown_override_id_raises():
    """Fails closed with the shared UnresolvableIdError (merge_inputs.py:31),
    which solve()'s blanket handler turns into an fd3 internal_error. Task 6's
    precheck exists so a student never reaches this path with bad input."""
    with pytest.raises(UnresolvableIdError):
        solve_delivery({**BASE, "laneCostOverrides": [
            {"fromId": "W999", "toId": "C1", "cost": 1.0}]})
    with pytest.raises(UnresolvableIdError):
        solve_delivery({**BASE, "laneCostOverrides": [
            {"fromId": "C1", "toId": "W1", "cost": 1.0}]})   # role-swapped pair


def test_envelope_carries_status_evidence():
    """Spec 5.8: the truthful-status fields every other solver forwards."""
    env = solve_delivery(dict(BASE))
    assert env["quality"] == "Optimal"          # raw PuLP LpStatus, not a projection
    assert env["terminationReason"] is not None
    assert env["runTimeSec"] >= 0               # 0.00 is a legal rounded value; -1 is the absent sentinel
    assert env["details"]["objective"] == "base"
    assert solve_delivery(adjusted())["details"]["objective"] == "cost_adjusted"


def _assignment_map(env):
    return {a["customerId"]: a["warehouseId"] for a in env["details"]["assignments"]}


def _customers():
    from solve import DELIV_CUSTOMERS
    return DELIV_CUSTOMERS
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_delivery.py -x
```

Expected: FAIL — `ImportError: cannot import name 'solve_delivery' from 'solve'`.

- [ ] **Step 3: Add the import and the dataset loaders**

In `artifacts/api-server/src/solver/solve.py`, beside the other module-level loaders (the block spans `:73-176`; `_safe_load(model_id, filename, default=None)` is at `:61` and `_LOAD_ERRORS` at `:59`). First the import — `solve.py` does not currently import `UnresolvableIdError` anywhere (it lets `merge_inputs` raise it through):

```python
from merge_inputs import UnresolvableIdError
```

Then the loaders:

```python
# Chapter 5 (modified) - Delivery Company Teaching Example. TWO lane tables:
# distances.json is read-only and is the sole source of every distance metric;
# costs.json is seeded identical but is what the student overrides and what the
# objective runs on. Keeping them separate is the whole point of the chapter.
DELIV_WAREHOUSES = _safe_load("delivery-teaching-us", "warehouses.json", default={})
DELIV_CUSTOMERS  = _safe_load("delivery-teaching-us", "customers.json",  default={})
_DELIV_DIST_RAW  = _safe_load("delivery-teaching-us", "distances.json",  default={})
_DELIV_COST_RAW  = _safe_load("delivery-teaching-us", "costs.json",      default={})

DELIV_DISTANCES = {tuple(k.split(',')): v for k, v in _DELIV_DIST_RAW.items()}
DELIV_COSTS     = {tuple(k.split(',')): v for k, v in _DELIV_COST_RAW.items()}
```

- [ ] **Step 4: Add the band helper, the two pure seams, and the solver**

Append to `solve.py`, before the dispatcher. No module-level overflow-aware band helper exists today: `solve_two_echelon` has a nested `_band` returning `None` on overflow (`:1003`), `solve_jade` a nested `_band_exclusive` returning `-1` (`:1254`), and the three older solvers clamp into the last band inline (`:470, 642, 835`). This one is module-level so the test can import it.

```python
def _assign_band_or_overflow(d, bands):
    """Index of the smallest band >= d, or len(bands) when d exceeds every
    band. Mirrors lib/units' assignBandOrOverflow. Never clamps into the last
    band - that is how an over-1,600 lane gets miscounted as covered."""
    for i, b in enumerate(bands):
        if d <= b:
            return i
    return len(bands)


def _effective_delivery_costs(cost, dist, inp):
    """Chapter 5 (modified) - the rate rule, and the ONLY place it exists.

    The threshold compares the DISTANCE; the rate multiplies the COST; `<=`
    takes the low rate (decisions 6 and 7). A cost value is "billable miles":
    seeded equal to true distance, so cost x $/mile is dollars, and editing a
    cost cell means "bill this lane as if it were N miles".

    Pure and separately callable so the boundary rule and the constraint sense
    can be asserted without inspecting source text.
    """
    if not inp.get('costAdjustEnabled'):
        return dict(cost)
    threshold = inp['distanceThreshold']
    low = inp['costPerMile']
    high = inp['costPerMileOver']
    return {k: v * (low if dist[k] <= threshold else high) for k, v in cost.items()}


def _build_delivery_problem(ec, p):
    """Build the LP and return it UNSOLVED, so tests can assert on structure."""
    warehouses = list(DELIV_WAREHOUSES.keys())
    customers = list(DELIV_CUSTOMERS.keys())
    demand = {c: DELIV_CUSTOMERS[c]['demand'] for c in customers}

    prob = LpProblem("Delivery", LpMinimize)
    y = LpVariable.dicts("A", [(w, c) for w in warehouses for c in customers], 0, 1, cat='Binary')
    o = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    prob += lpSum(ec[(w, c)] * demand[c] * y[w, c] for w in warehouses for c in customers)

    for c in customers:
        prob += LpConstraint(lpSum(y[w, c] for w in warehouses),
                             LpConstraintEQ, f"served_{c}", 1)

    # Decision 8 - AT MOST P, matching the COG notebook's
    # `lpSum(use_plant) <= max_plants`. solve.py:405 uses EQ for p-median-us;
    # this divergence is deliberate and test_facility_count_is_at_most_p pins
    # the sense so a later reader does not "fix" it.
    prob += LpConstraint(lpSum(o[w] for w in warehouses),
                         LpConstraintLE, "FacilityCount", p)

    # Per-pair linking, as the COG notebook writes it. The aggregated form
    # (33 rows instead of 10,329) has a much weaker LP relaxation and CBC
    # branches far more; the measured 4.0s solve is with this form.
    for w in warehouses:
        for c in customers:
            prob += LpConstraint(y[w, c] - o[w], LpConstraintLE, f"route_{w}_{c}", 0)

    return prob, y, o


def solve_delivery(inp):
    if _LOAD_ERRORS.get("delivery-teaching-us"):
        return _load_error_envelope("delivery-teaching-us")

    t = time.time()
    p = inp['pValue']
    distance_bands = sorted(inp['distanceBands'])
    gap = float(inp.get('gap', 0.0))
    time_limit = int(inp.get('timeLimitSec', 120))

    warehouses = list(DELIV_WAREHOUSES.keys())
    customers = list(DELIV_CUSTOMERS.keys())
    demand = {c: DELIV_CUSTOMERS[c]['demand'] for c in customers}
    dist = DELIV_DISTANCES

    # Overrides land on COST and only on COST. `dist` is read-only for this
    # whole function - that single property is what makes every distance
    # metric below trustworthy. Fails closed on a bad id (merge_inputs'
    # UnresolvableIdError -> solve()'s blanket handler -> fd3 internal_error);
    # the api-server precheck (Task 6) is what turns that into a 422.
    cost = dict(DELIV_COSTS)
    for ov in (inp.get('laneCostOverrides') or []):
        key = (ov['fromId'], ov['toId'])
        if ov['fromId'] not in DELIV_WAREHOUSES:
            raise UnresolvableIdError(f"unknown warehouse id {ov['fromId']}")
        if ov['toId'] not in DELIV_CUSTOMERS:
            raise UnresolvableIdError(f"unknown customer id {ov['toId']}")
        if key not in cost:
            raise UnresolvableIdError(f"no lane {ov['fromId']}->{ov['toId']}")
        cost[key] = ov['cost']

    ec = _effective_delivery_costs(cost, dist, inp)
    prob, y, o = _build_delivery_problem(ec, p)
    cbc = _run_cbc(prob, gap, time_limit, problem_uid="delivery")
    st = cbc.lpStatus

    # Truthful status, exactly as solve_max_coverage does it (solve.py:1428-1446).
    if st == "Infeasible":
        return _envelope("infeasible", "infeasible", 0, round(time.time() - t, 2), [],
                         _EMPTY_METRICS, _EMPTY_DETAILS, "No feasible assignment under the constraints",
                         termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                         solver_incumbent_objective=cbc.solverIncumbentObjective,
                         solver_best_bound=cbc.solverBestBound)
    if st != "Optimal":
        env = _envelope("error", "error", 0, round(time.time() - t, 2), [],
                        _EMPTY_METRICS, _EMPTY_DETAILS, f"Solver terminated with status: {st}",
                        termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                        solver_incumbent_objective=cbc.solverIncumbentObjective,
                        solver_best_bound=cbc.solverBestBound)
        env["_failureReason"] = "solver_error"
        env["_failureStage"] = "cbc_parse"
        return env

    obj_val = value(prob.objective) or 0
    open_ids = [w for w in warehouses if o[w].varValue and o[w].varValue > 0.5]

    total_demand = sum(demand.values())
    dist_weighted = 0.0
    band_demand = {b: 0.0 for b in distance_bands}
    overflow_demand = 0.0
    edges, assignments = [], []

    for c in customers:
        chosen = next((w for w in warehouses if y[w, c].varValue and y[w, c].varValue > 0.5), None)
        if chosen is None:
            continue
        d = dist[(chosen, c)]          # DISTANCE table. never ec, never cost.
        dist_weighted += d * demand[c]
        band_idx = _assign_band_or_overflow(d, distance_bands)
        assignments.append({"customerId": c, "warehouseId": chosen,
                            "distanceMi": d, "band": band_idx})
        edges.append({"fromId": chosen, "toId": c, "flow": round(demand[c]),
                      "distance": d, "band": band_idx})
        if band_idx == len(distance_bands):
            overflow_demand += demand[c]
        for b in distance_bands:
            if d <= b:
                band_demand[b] += demand[c]

    weighted_avg_distance = dist_weighted / total_demand if total_demand else 0.0
    # Cumulative rows (spec 5.7), plus an explicit Overflow row - band -1, the
    # OVERFLOW_BAND sentinel shared with lib/units and the gold/jade envelopes -
    # whenever any lane lies beyond the largest band (spec 5.6 / 12.3.7). Both
    # goldens reach 100% by 1,600 and so emit no Overflow row.
    band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / total_demand, 2)}
                     for b in distance_bands]
    if overflow_demand > 0:
        band_coverage.append({"band": -1, "percent": round(overflow_demand * 100 / total_demand, 2)})

    # Precision is contract, not display (spec 5.7): the goldens run to cents
    # and four decimals. No utilizationByNode - there is no capacity, so there
    # is no denominator and any value would be fabricated.
    return _envelope(
        cbc.solutionStatus, st, round(obj_val, 2), round(time.time() - t, 2), edges,
        {"bandCoverage": band_coverage,
         "weightedAvgDistance": round(weighted_avg_distance, 4)},
        {"openWarehouseIds": open_ids,
         "assignments": assignments,
         "objective": "cost_adjusted" if inp.get('costAdjustEnabled') else "base"},
        termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
        solver_incumbent_objective=cbc.solverIncumbentObjective,
        solver_best_bound=cbc.solverBestBound,
    )
```

- [ ] **Step 5: Add the dispatcher branch**

In `solve()` (`:1477-1494`; it reads `inp.get('modelType', 'p_median')` and dispatches `transport`, `capacitated_pmedian`, `two_echelon`, `two_echelon_jade`, `max_coverage_us`, `p_median`), before the unknown-modelType error envelope. The exact string `if model_type == 'delivery':` is what Task 4's `registration.test.ts` source gate will assert:

```python
    if model_type == 'delivery':
        return solve_delivery(inp)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_delivery.py -x -v
```

Expected: PASS, all 17 cases. The two golden solves take roughly 4s and 1s.

- [ ] **Step 7: Prove no existing solver moved, and the Task 1 drift guard goes green**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```

Expected: the full pytest suite green — including `test_datasets.py::test_delivery_teaching_us_matches_its_version`, red since Task 1 — and `e2e_accuracy.py` reporting **99/99** (the count is computed at runtime from its `_counts`; it has no Chapter 4 or Chapter 5 section and gains none here). `e2e_accuracy.py` is sacred — if it fails, this change is wrong; do not edit it.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/solver/solve.py \
        artifacts/api-server/src/solver/tests/test_delivery.py
git commit -m "[ch5-del-3] add solve_delivery with the cost/distance separation and measured goldens"
```

---

## Task 4: Validator, payload builder, and route registration

**Files:**
- Create: `artifacts/api-server/src/validation/inputs/delivery.ts`
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts` (`KNOWN_SCHEMAS` `:19-37`; import the schema from `../validation/inputs/delivery.js` directly — `validation/inputs/index.ts` is a 10-line delegator, not a barrel, and is **not** edited)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (`VALID_MODEL_IDS` `:92-106`)
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (`SolveInput` `:8-13`, `buildPayload` branches `:20/:45/:86/:137`, fallthrough `:173`)
- Modify: `lib/api-spec/openapi.yaml` (4 `modelId` enums at `:47`, `:166-172`, `:1417-1424`, `:1618-1625`; inline `ModelInfo.capabilities` at `:932-958`)
- Modify: `artifacts/api-server/src/registry/__tests__/registration.test.ts` (`SOLVABLE` `:25`, count `:98`, `STUB_INPUTS` `:118`, source gates `:222-238`)
- Create: `artifacts/api-server/src/__tests__/deliveryContract.test.ts`
- Create: `artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts`

**Interfaces:**
- Produces: `deliveryInputsSchema`, `DeliveryInputs`; `buildPayload` emits `modelType: "delivery"`.
- Consumes: Task 3's wire contract, Task 2's manifest.

This is the **atomic OBS-5 commit**: `KNOWN_SCHEMAS` + `VALID_MODEL_IDS` + `buildPayload` + `SOLVABLE` land together, because `registration.test.ts` exists precisely to catch a model registered in one place and missing from the others. It also adds the set-equality test spec §9 recommends, so the *next* model cannot be registered in four of six places either.

- [ ] **Step 1: Write the failing contract test**

Create `artifacts/api-server/src/__tests__/deliveryContract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deliveryInputsSchema } from "../validation/inputs/delivery.js";
import { buildPayload } from "../solver/pmedian.js";

function baseInputs() {
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
}

describe("deliveryInputsSchema", () => {
  it("accepts the default payload and defaults laneCostOverrides", () => {
    const parsed = deliveryInputsSchema.parse({ ...baseInputs(), laneCostOverrides: undefined });
    expect(parsed.laneCostOverrides).toEqual([]);
    expect(parsed.costAdjustEnabled).toBe(false);
  });

  it("accepts p at the 33 bound and rejects 34", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 33 }).success).toBe(true);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 34 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 0 }).success).toBe(false);
  });

  // The source ships 33 zero-distance self-lanes, seeded into costs.json as
  // zero costs. A schema forbidding a zero OVERRIDE would forbid restoring a
  // value the dataset itself contains.
  it("accepts a zero lane-cost override but rejects a negative or non-finite one", () => {
    const zero = [{ fromId: "W1", toId: "C1", cost: 0 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: zero }).success).toBe(true);
    const neg = [{ fromId: "W1", toId: "C1", cost: -1 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: neg }).success).toBe(false);
    const inf = [{ fromId: "W1", toId: "C1", cost: Number.POSITIVE_INFINITY }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: inf }).success).toBe(false);
  });

  it("rejects a zero or negative rate", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMile: 0 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMileOver: -1 }).success).toBe(false);
  });

  it("rejects duplicate (fromId, toId) override pairs", () => {
    const dup = [
      { fromId: "W1", toId: "C1", cost: 5 },
      { fromId: "W1", toId: "C1", cost: 6 },
    ];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: dup }).success).toBe(false);
  });
});

describe("buildPayload — delivery-teaching-us", () => {
  it("emits modelType 'delivery' and passes every rate field through", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({ ...baseInputs(), costAdjustEnabled: true }),
    }) as Record<string, unknown>;

    expect(payload.modelType).toBe("delivery");
    expect(payload.pValue).toBe(3);
    expect(payload.costAdjustEnabled).toBe(true);
    expect(payload.distanceThreshold).toBe(800);
    expect(payload.costPerMile).toBe(1);
    expect(payload.costPerMileOver).toBe(10);
    expect(payload.distanceBands).toEqual([400, 800, 1200, 1600]);
  });

  // The dispatcher's old failure mode was a missing branch landing in
  // solve_pmedian and returning a plausible WRONG answer.
  it("never emits p_median for this model", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse(baseInputs()),
    }) as Record<string, unknown>;
    expect(payload.modelType).not.toBe("p_median");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts
```

Expected: FAIL — cannot resolve `../validation/inputs/delivery.js`.

- [ ] **Step 3: Write the validator**

Create `artifacts/api-server/src/validation/inputs/delivery.ts`:

```ts
import { z } from "zod";

// Chapter 5 (modified) - Delivery Company Teaching Example.
//
// The cost domain is NONNEGATIVE, not positive: the source data contains 33
// zero-distance self-lanes (a DC serving its own city), seeded into costs.json
// as zero costs, so forbidding a zero override would forbid restoring a value
// the dataset itself ships. The RATES stay strictly positive - a zero rate
// makes every lane free and the objective degenerate.
const laneCostOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  cost: z.number().finite().nonnegative(),
});

export const deliveryInputsSchema = z.object({
  // 33 candidate DCs. This bound is the API's only enforcement - both UI
  // mounts default pMax = 50 and must be passed pMax={33} explicitly, or a
  // student selects 40 from a control that offered it and gets a 422.
  p: z.number().int().min(1).max(33),
  distanceBands: z.array(z.number().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),

  // The three rate fields are ALWAYS present, with defaults, whether or not
  // the toggle is on: toggling on must never have to invent values, and a
  // scenario saved with the toggle off must retain the rates the student had
  // configured. costPerMileOver >= costPerMile is deliberately NOT enforced -
  // a student exploring a long-haul discount is doing legitimate what-if work.
  costAdjustEnabled: z.boolean().default(false),
  distanceThreshold: z.number().positive(),
  costPerMile: z.number().positive(),
  costPerMileOver: z.number().positive(),

  laneCostOverrides: z.array(laneCostOverrideSchema).default([])
    .refine(
      (rows) => new Set(rows.map((r) => `${r.fromId},${r.toId}`)).size === rows.length,
      { message: "laneCostOverrides must not contain duplicate (fromId, toId) pairs" },
    ),
});

export type DeliveryInputs = z.infer<typeof deliveryInputsSchema>;
```

There is no barrel to re-export from: `validation/inputs/index.ts` exports only `ValidateInputsResult` and `validateInputsForModel`. Consumers (`modelRegistry.ts`, `precheck.ts`, `pmedian.ts`) import `../validation/inputs/delivery.js` directly, exactly as they import `./maxCoverage.js`.

- [ ] **Step 4: Register in all four places at once**

`registry/modelRegistry.ts` `KNOWN_SCHEMAS` (`:19-37`; `KNOWN_MODEL_IDS = Object.keys(KNOWN_SCHEMAS)` at `:37` derives from it):

```ts
  "delivery-teaching-us": deliveryInputsSchema,
```

`routes/scenarios.ts` `VALID_MODEL_IDS` (`:92-106`):

```ts
  "delivery-teaching-us",
```

`solver/pmedian.ts` `SolveInput` (`:8-13`):

```ts
  | { modelId: "delivery-teaching-us"; inputs: DeliveryInputs };
```

`solver/pmedian.ts` `buildPayload` — a branch **before** the unguarded fallthrough at `:173` (`modelType: input.modelId === "p-median-brazil" ? "capacitated_pmedian" : "p_median"`), since that fallback is "whatever is left" and would otherwise swallow this model. The exact strings `input.modelId === "delivery-teaching-us"` and `modelType: "delivery"` are what the registration source gate asserts:

```ts
  if (input.modelId === "delivery-teaching-us") {
    const i = input.inputs;
    return {
      modelType: "delivery",
      pValue: i.p,
      distanceBands: i.distanceBands,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
      costAdjustEnabled: i.costAdjustEnabled,
      distanceThreshold: i.distanceThreshold,
      costPerMile: i.costPerMile,
      costPerMileOver: i.costPerMileOver,
      laneCostOverrides: i.laneCostOverrides,
    };
  }
```

`registry/__tests__/registration.test.ts` has four things to extend, not one:

1. `SOLVABLE` (`:25`) — add `"delivery-teaching-us"`.
2. `STUB_INPUTS` (`:118`) — add a minimal delivery object: `{ p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 60, costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [] }`.
3. `expect(res.body).toHaveLength(6)` (`:98`, `GET /api/models`) → **7**.
4. The three `readFileSync` source-text gates at `:222-238` are written per model for the newest one (`max-coverage-us`). Add the delivery equivalents beside them: `pmedian.ts` contains `'input.modelId === "delivery-teaching-us"'` and `'modelType: "delivery"'`; `solve.py` contains `"if model_type == 'delivery':"`; the openapi enum loop over `KNOWN_MODEL_IDS` already covers the yaml once `KNOWN_SCHEMAS` has the key.

- [ ] **Step 5: Add the set-equality test**

Create `artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts`. Spec §9 recommends it; the Rev 1 review found three registries that had silently diverged in the past. Every registry is read from its real source; the two that live outside this package (`openapi.yaml`, `chapters.ts`) are read as text with `readFileSync` (the pattern `lockedModelGuards.test.ts:33,82` uses), never imported across packages.

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { MODEL_IDS, PACKAGE_SPECS } from "@workspace/dataset-schema";
import { KNOWN_MODEL_IDS } from "../registry/modelRegistry.js";
import { VALID_MODEL_IDS } from "../routes/scenarios.js";

function repoRoot(): string {
  let dir = process.cwd();
  while (!readFileSyncSafe(path.join(dir, "pnpm-workspace.yaml"))) dir = path.dirname(dir);
  return dir;
}
function readFileSyncSafe(p: string): string | null { try { return readFileSync(p, "utf8"); } catch { return null; } }

describe("model-id registries are one set", () => {
  const canonical = new Set<string>(MODEL_IDS);

  it("KNOWN_SCHEMAS, VALID_MODEL_IDS and PACKAGE_SPECS match MODEL_IDS exactly", () => {
    expect(new Set(KNOWN_MODEL_IDS)).toEqual(canonical);
    expect(new Set(VALID_MODEL_IDS)).toEqual(canonical);
    expect(new Set(PACKAGE_SPECS.map((s) => s.modelId))).toEqual(canonical);
  });

  it("every openapi modelId enum lists every id (and no extra)", () => {
    const yaml = readFileSync(path.join(repoRoot(), "lib/api-spec/openapi.yaml"), "utf8");
    for (const id of canonical) expect(yaml.split(`- ${id}`).length - 1).toBeGreaterThanOrEqual(3);
    // Single-line enum form at the GET /dataset site:
    expect(yaml).toContain(`enum: [${[...canonical].join(", ")}]`);
  });

  it("chapters.ts' StudioModelType names exactly the same ids", () => {
    const src = readFileSync(path.join(repoRoot(), "artifacts/studio/src/lib/chapters.ts"), "utf8");
    const union = src.split("\n")[0]!;
    const ids = [...union.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(new Set(ids)).toEqual(canonical);
  });
});
```

Adjust the openapi assertion to the file's real enum formatting (one site is single-line `enum: […]` at `:47`, three are multi-line `- id` lists) after reading it — the intent is "every site lists every id", not the exact regex above.

- [ ] **Step 6: Update the OpenAPI contract and regenerate**

In `lib/api-spec/openapi.yaml`, add `delivery-teaching-us` to the `modelId` enum at **all four** sites — `GET /dataset` query (`:47`, single-line), `GET /scenarios` query (`:166-172`), `Scenario.modelId` (`:1417-1424`), `ScenarioInput.modelId` (`:1618-1625`). Capabilities is **not** a named schema: add `supportsReferenceCosts: { type: boolean }` to the inline `capabilities` object under `ModelInfo` (`:932-957`) beside `supportsReferenceDistances`, and add it to that object's `required` list (`:958`) — the registry always emits it (Task 2 Step 6), so requiring it costs nothing and lets the generated client type it as `boolean` rather than `boolean | undefined`.

Nothing else in the contract enumerates models: `Scenario.inputs` / `ScenarioInput.inputs` / `ScenarioUpdate.inputs` are opaque `type: object`, and `ModelInfo.id` is a bare string.

```bash
pnpm --filter @workspace/api-spec run codegen     # = orval --config ./orval.config.ts && pnpm -w run typecheck:libs
git status --porcelain lib/api-client-react lib/api-zod
```

Expected: only OpenAPI-derived files changed. Never hand-edit them; spec and regenerated output commit together.

- [ ] **Step 7: Run the contract, registration, and set-equality tests**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run \
    src/__tests__/deliveryContract.test.ts \
    src/__tests__/modelIdSetEquality.test.ts \
    src/registry/__tests__/registration.test.ts \
    src/__tests__/registry.test.ts
pnpm run typecheck
```

Expected: PASS. The set-equality test is expected to be red until Task 8 adds the id to `chapters.ts` — commit it here anyway (it is the point of the test that it is red while the registries disagree), and note the known-red in the commit body.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/validation/inputs/delivery.ts \
        artifacts/api-server/src/registry/modelRegistry.ts \
        artifacts/api-server/src/registry/__tests__/registration.test.ts \
        artifacts/api-server/src/routes/scenarios.ts \
        artifacts/api-server/src/solver/pmedian.ts \
        artifacts/api-server/src/__tests__/deliveryContract.test.ts \
        artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts \
        lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "[ch5-del-4] register delivery-teaching-us across schema, routes, payload, and contract"
```

---

## Task 5: Entity dataset loader and `GET /dataset`

**Files:**
- Create: `artifacts/api-server/src/data/deliveryDataset.ts`
- Modify: `artifacts/api-server/src/routes/dataset.ts`
- Test: `artifacts/api-server/src/__tests__/deliveryContract.test.ts` (append)

**Interfaces:**
- Produces: `DELIVERY_WAREHOUSES: WarehouseCandidate[]`, `DELIVERY_CUSTOMERS: Customer[]`, `DELIVERY_LANE_KEYS: ReadonlySet<string>` (the lane-existence set Tasks 6 and 7 both read).
- Consumes: Task 1's dataset files.

`WarehouseCandidate` (`data/dataset.ts:36`) and `Customer` (`:51`) both carry optional `zip`; `Customer.demand` is required. Two root-resolution conventions coexist in this package — `maxCoverageDataset.ts:13` reimplements `findRepoRoot`, `referenceDistances.ts:3` imports `SOLVERS_ROOT` from `@workspace/dataset-schema` — and both are bundling-safe. This task mirrors the former (its direct sibling); Task 7 mirrors the latter (its direct sibling). Do not unify them here.

- [ ] **Step 1: Write the failing test**

Append to `deliveryContract.test.ts`:

```ts
import request from "supertest";
import app from "../app.js";

describe("GET /dataset — delivery-teaching-us", () => {
  it("returns 33 warehouses and 313 customers and no lane tables", async () => {
    const res = await request(app).get("/api/dataset?modelId=delivery-teaching-us").expect(200);
    expect(res.body.warehouses).toHaveLength(33);
    expect(res.body.customers).toHaveLength(313);
    // The 10,329-lane files must never reach the browser through this route.
    expect(res.body.distances).toBeUndefined();
    expect(res.body.costs).toBeUndefined();
  });

  it("carries role-prefixed ids and inline demand", async () => {
    const res = await request(app).get("/api/dataset?modelId=delivery-teaching-us").expect(200);
    expect(res.body.warehouses.every((w: { id: string }) => w.id.startsWith("W"))).toBe(true);
    expect(res.body.customers.every((c: { id: string }) => c.id.startsWith("C"))).toBe(true);
    expect(res.body.customers.reduce((s: number, c: { demand: number }) => s + c.demand, 0))
      .toBe(208829000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts
```

Expected: FAIL — `400 Unknown modelId: delivery-teaching-us`.

- [ ] **Step 3: Write the loader**

Create `artifacts/api-server/src/data/deliveryDataset.ts`, following `maxCoverageDataset.ts`'s bundling-safe pattern exactly — esbuild collapses `import.meta.url` for every merged module, so the repo root is found by walking up to `pnpm-workspace.yaml` rather than by a source-relative path:

```ts
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { WarehouseCandidate, Customer } from "./dataset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate repo root (pnpm-workspace.yaml) from " + from);
    dir = parent;
  }
  return dir;
}

// Chapter 5 (modified) - Delivery Company Teaching Example. Record maps keyed
// by real entity id (W8 / C269), the max-coverage-us convention, not
// p-median-us's ordinal keys - so Object.values (insertion order), not a
// byIndex sort. Distances are miles and are the effective distances as the
// source workbook gives them; no circuity factor is applied.
const DELIVERY_DATASET_DIR = path.join(findRepoRoot(__dirname), "solvers", "delivery-teaching-us", "dataset");

interface DeliveryWarehouseEntry { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }
interface DeliveryCustomerEntry extends DeliveryWarehouseEntry { demand: number; }

function loadJson(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(DELIVERY_DATASET_DIR, filename), "utf8"));
}

export const DELIVERY_WAREHOUSES: WarehouseCandidate[] =
  Object.values(loadJson("warehouses.json") as Record<string, DeliveryWarehouseEntry>);

export const DELIVERY_CUSTOMERS: Customer[] =
  Object.values(loadJson("customers.json") as Record<string, DeliveryCustomerEntry>);

// Lane-existence set. Lives here rather than beside the reference-cost builder
// so that precheck (Task 6) and the reference-cost endpoint (Task 7) both read
// one source and cannot drift, and so neither task depends on the other.
export const DELIVERY_LANE_KEYS: ReadonlySet<string> =
  new Set(Object.keys(loadJson("costs.json")));
```

- [ ] **Step 4: Add the route branch**

In `artifacts/api-server/src/routes/dataset.ts`, import the loader and add a branch beside the others, before the 400 fallthrough:

```ts
  if (modelId === "delivery-teaching-us") {
    // Chapter 5 (modified) - entities only. The two 10,329-lane tables are
    // served separately and lazily by GET /models/:id/reference-costs; this
    // route has never returned lane data for any model.
    res.json({ warehouses: DELIVERY_WAREHOUSES, customers: DELIVERY_CUSTOMERS });
    return;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/data/deliveryDataset.ts \
        artifacts/api-server/src/routes/dataset.ts \
        artifacts/api-server/src/__tests__/deliveryContract.test.ts
git commit -m "[ch5-del-5] load the delivery entities and serve them from GET /dataset"
```

---

## Task 6: Precheck — turn bad override ids into actionable 422s

**Files:**
- Modify: `artifacts/api-server/src/services/precheck.ts` (new `precheckDeliveryInputs`, dispatcher `:1368`)
- Test: `artifacts/api-server/src/__tests__/precheck.test.ts` (append)

**Interfaces:**
- Produces: `precheckDeliveryInputs(inputs: DeliveryInputs): PrecheckResult`.
- Consumes: Task 4's `DeliveryInputs`, Task 5's loaders (`DELIVERY_WAREHOUSES`, `DELIVERY_CUSTOMERS`, `DELIVERY_LANE_KEYS`).

**Why this is its own task.** `runNetworkEditsPrecheckForModel` (`:1368-1387`) is an if-chain over six ids ending `return { ok: true, errors: [] }`. An unregistered model is **silently pre-approved** — every override reaches the worker and a bad id surfaces as a generic `internal_error` from `UnresolvableIdError` instead of something a student can act on. Nothing errors; the failure is entirely in the quality of the message.

**The error vocabulary is closed.** `PrecheckErrorCode` (`precheck.ts:76`) is `"completeness" | "id_collision" | "reference_integrity" | "p_range" | "capacity" | "zero_demand" | "no_feasible_route" | "coverage_floor_infeasible"`, and `PrecheckError` (`:86`) is `{ code: PrecheckErrorCode; message: string }` — no `entityId`. The cases below use three existing members with the offending id in the message: `reference_integrity` (an id or pair that does not exist in the dataset), `id_collision` (a duplicate pair), `completeness` (a non-finite or negative cost). Do not widen the union for this model.

**Two callers, two statuses.** `jobRunner.ts:380` calls it inside `enqueueScenarioSolve` and a failure becomes `{ kind: "precheck_failed", errors }`, which `routes/scenarios.ts:533-534` returns as **422** `{ error: "Network-edit precheck failed", errors }`. `routes/scenarios.ts:620` (`GET /scenarios/:scenarioId/precheck`) returns the raw `PrecheckResult` as **200**. The route-level test below goes through the solve endpoint because that is the path a student hits.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/__tests__/precheck.test.ts`:

```ts
describe("precheckDeliveryInputs", () => {
  const base = {
    p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120,
    costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10,
    laneCostOverrides: [],
  };

  it("passes a clean payload", () => {
    expect(runNetworkEditsPrecheckForModel("delivery-teaching-us", base).ok).toBe(true);
  });

  it("rejects an unknown warehouse id as reference_integrity, naming it", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W999", toId: "C1", cost: 5 }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.code).toBe("reference_integrity");
    expect(r.errors[0]!.message).toContain("W999");
  });

  it("rejects an unknown customer id", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C999", cost: 5 }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toContain("C999");
  });

  // A role-swapped pair is individually valid on both sides and still not a lane.
  it("rejects a pair that exists in neither lane table", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "C1", toId: "W1", cost: 5 }] });
    expect(r.ok).toBe(false);
  });

  it("accepts a zero override, matching the dataset's 33 zero self-lanes", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C1", cost: 0 }] });
    expect(r.ok).toBe(true);
  });

  // Spec 6.2.1 / Gate D: the Zod schema already refuses these on PATCH, but
  // the precheck runs on the STORED row at solve time and must not trust it.
  it("rejects a duplicate (fromId,toId) pair and a negative or non-finite cost", () => {
    const dup = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C2", cost: 5 }, { fromId: "W1", toId: "C2", cost: 6 }] });
    expect(dup.ok).toBe(false);
    expect(dup.errors[0]!.code).toBe("id_collision");
    const neg = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C2", cost: -1 }] });
    expect(neg.ok).toBe(false);
    expect(neg.errors[0]!.code).toBe("completeness");
    const inf = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C2", cost: Number.POSITIVE_INFINITY }] });
    expect(inf.ok).toBe(false);
  });

  // The regression that matters: before this task the dispatcher's fallback
  // returned ok:true for this model, so every one of the cases above passed.
  it("no longer falls through to the unknown-model pre-approval", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "nonsense", toId: "nonsense", cost: 1 }] });
    expect(r.ok).toBe(false);
  });
});
```

And the route-level case — in `artifacts/api-server/src/__tests__/routes.test.ts` (which already has `loginAs()` and calls `resetLoginRateLimiterForTests()` in `beforeEach`), following its existing per-model solve-precheck cases:

```ts
it("POST /scenarios/:id/solve returns 422 (not a failed job) for a delivery override with an unknown id", async () => {
  const cookie = await loginAs(/* fresh user */);
  const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "bad override", modelId: "delivery-teaching-us",
            inputs: { ...deliveryDefaults, laneCostOverrides: [{ fromId: "W999", toId: "C1", cost: 1 }] } })
    .expect(201);
  const res = await request(app).post(`/api/scenarios/${created.body.id}/solve`).set("Cookie", cookie);
  expect(res.status).toBe(422);
  expect(res.body.error).toBe("Network-edit precheck failed");
  expect(JSON.stringify(res.body.errors)).toContain("W999");
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/precheck.test.ts src/__tests__/routes.test.ts
```

Expected: every negative case FAILS by returning `ok: true` — the pre-approval; the route case enqueues a job instead of 422ing.

- [ ] **Step 3: Write the precheck**

In `artifacts/api-server/src/services/precheck.ts`, following the existing per-model precheck shape (`precheckMaxCoverageInputs` at `:236` is the nearest sibling), importing `DeliveryInputs` from `../validation/inputs/delivery.js` and the three loaders from `../data/deliveryDataset.js`:

```ts
// Chapter 5 (modified) - lane-cost override validation. The solver keeps its
// own UnresolvableIdError and fails closed; this exists so invalid USER input
// is a 422 the student can act on rather than a generic worker internal_error.
// Every code below is from the closed PrecheckErrorCode union (:76) - the
// offending id lives in the message, as the other prechecks do it.
export function precheckDeliveryInputs(inputs: DeliveryInputs): PrecheckResult {
  const errors: PrecheckError[] = [];
  const warehouses = new Set(DELIVERY_WAREHOUSES.map((w) => w.id));
  const customers = new Set(DELIVERY_CUSTOMERS.map((c) => c.id));
  const seen = new Set<string>();

  for (const ov of inputs.laneCostOverrides ?? []) {
    const pair = `${ov.fromId},${ov.toId}`;
    if (seen.has(pair)) {
      errors.push({ code: "id_collision", message: `Duplicate lane cost override for ${pair}` });
      continue;
    }
    seen.add(pair);
    if (!Number.isFinite(ov.cost) || ov.cost < 0) {
      errors.push({ code: "completeness", message: `Lane ${pair} has a non-finite or negative cost (${ov.cost})` });
      continue;
    }
    if (!warehouses.has(ov.fromId)) {
      errors.push({ code: "reference_integrity", message: `Unknown warehouse id ${ov.fromId}` });
      continue;
    }
    if (!customers.has(ov.toId)) {
      errors.push({ code: "reference_integrity", message: `Unknown customer id ${ov.toId}` });
      continue;
    }
    if (!DELIVERY_LANE_KEYS.has(pair)) {
      errors.push({ code: "reference_integrity", message: `No lane ${ov.fromId} to ${ov.toId}` });
    }
  }
  return { ok: errors.length === 0, errors };
}
```

Add the dispatcher branch inside `runNetworkEditsPrecheckForModel` (`:1368`), after the `max-coverage-us` branch (`:1384`) and **before** the `return { ok: true, errors: [] }` fallback (`:1387`):

```ts
  if (modelId === "delivery-teaching-us") {
    return precheckDeliveryInputs(inputs as unknown as DeliveryInputs);
  }
```

- [ ] **Step 4: Run to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/precheck.test.ts src/__tests__/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/precheck.ts \
        artifacts/api-server/src/__tests__/precheck.test.ts \
        artifacts/api-server/src/__tests__/routes.test.ts
git commit -m "[ch5-del-6] precheck delivery lane-cost overrides instead of pre-approving them"
```

---

## Task 7: The reference-costs endpoint

**Files:**
- Create: `artifacts/api-server/src/data/referenceCosts.ts`
- Create: `artifacts/api-server/src/routes/referenceCosts.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Create: `artifacts/api-server/src/__tests__/referenceCosts.test.ts` (imports `buildDeliveryReferenceCostsFrom` from `../data/referenceCosts.js` for the malformed cases)
- Modify: `artifacts/api-server/src/__tests__/deliveryContract.test.ts` (manifest-vs-Zod parity; imports `getManifest` from `../registry/modelRegistry.js`)

**Interfaces:**
- Produces: `GET /api/models/:id/reference-costs` → `{ pairs: [{ fromId, fromCode, toId, toCode, cost }], distanceUnit }`; `getReferenceCosts(modelId)`; `buildDeliveryReferenceCostsFrom(costs, distances)` (pure, exported for tests).
- Consumes: Task 2's `supportsReferenceCosts` capability; Task 5's `DELIVERY_WAREHOUSES` / `DELIVERY_CUSTOMERS`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/__tests__/referenceCosts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("GET /models/:id/reference-costs", () => {
  it("serves all 10,329 lanes for delivery-teaching-us", async () => {
    const res = await request(app).get("/api/models/delivery-teaching-us/reference-costs").expect(200);
    expect(res.body.pairs).toHaveLength(10329);
    expect(res.body.distanceUnit).toBe("mi");
    const p = res.body.pairs[0];
    expect(p).toHaveProperty("fromId");
    expect(p).toHaveProperty("toId");
    expect(p).toHaveProperty("cost");
  });

  it("sets an ETag and answers 304 to a matching if-none-match", async () => {
    const first = await request(app).get("/api/models/delivery-teaching-us/reference-costs").expect(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    await request(app).get("/api/models/delivery-teaching-us/reference-costs")
      .set("If-None-Match", etag).expect(304);
  });

  it("422s a model without the capability", async () => {
    await request(app).get("/api/models/p-median-us/reference-costs").expect(422);
    await request(app).get("/api/models/not-a-model/reference-costs").expect(422);
  });

  // The silent failure this test exists for: a route file that is created but
  // never registered in routes/index.ts 404s with no error anywhere.
  it("is reachable through the top-level mount, not merely defined", async () => {
    const res = await request(app).get("/api/models/delivery-teaching-us/reference-costs");
    expect(res.status).not.toBe(404);
  });
});

// Spec 6.4 / 12.4.2: the builder is the ONLY domain check on the lane table
// (PACKAGE_SPECS' DistanceMap accepts zeros and negatives). Exercise it on a
// malformed in-memory table rather than a mutated file, so the test never
// touches the real dataset.
describe("buildDeliveryReferenceCosts — malformed source", () => {
  it.each([
    ["a negative cost",          { "W1,C1": -1 }],
    ["a non-finite cost",        { "W1,C1": Number.NaN }],
    ["an unknown warehouse",     { "W999,C1": 1 }],
    ["a malformed key",          { "W1": 1 }],
    ["a missing lane (count)",   {}],
  ])("throws on %s", (_label, costs) => {
    expect(() => buildDeliveryReferenceCostsFrom(costs as Record<string, number>, costs as Record<string, number>))
      .toThrow(/referenceCosts:/);
  });
});
```

`buildDeliveryReferenceCostsFrom(costs, distances)` is the pure core of the builder (Step 3 splits file-reading from validation so this is testable without fixtures); the module-level `buildDeliveryReferenceCosts()` reads the two files and calls it.

Also append to `deliveryContract.test.ts` the manifest-vs-Zod parity check spec §6.1 promises that file keeps:

```ts
it("manifest.inputsSchema and deliveryInputsSchema agree on bounds and required keys", () => {
  const m = getManifest("delivery-teaching-us")!.inputsSchema as {
    properties: Record<string, { minimum?: number; maximum?: number; exclusiveMinimum?: number }>;
    required: string[];
  };
  expect(m.properties.p).toMatchObject({ minimum: 1, maximum: 33 });
  expect(m.properties.laneCostOverrides!.items?.properties?.cost).toMatchObject({ minimum: 0 });   // zero allowed, matches .nonnegative()
  expect(m.properties.costPerMile).toMatchObject({ exclusiveMinimum: 0 });                          // matches .positive()
  expect(new Set(m.required)).toEqual(new Set(["p", "distanceBands", "gap", "timeLimitSec",
    "costAdjustEnabled", "distanceThreshold", "costPerMile", "costPerMileOver"]));
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/referenceCosts.test.ts
```

Expected: FAIL — 404 on every case.

- [ ] **Step 3: Write the data layer, with domain validation**

Create `artifacts/api-server/src/data/referenceCosts.ts`, mirroring `data/referenceDistances.ts`'s registry shape:

```ts
import { readFileSync } from "fs";
import path from "path";
import { SOLVERS_ROOT, readVersion } from "@workspace/dataset-schema";
import { DELIVERY_WAREHOUSES, DELIVERY_CUSTOMERS } from "./deliveryDataset.js";

export interface ReferenceCostPair {
  fromId: string;
  fromCode: string;
  toId: string;
  toCode: string;
  cost: number;
}

export interface ReferenceCostsData {
  modelId: string;
  pairs: ReferenceCostPair[];
  /** Quoted per RFC 9110, derived from the package's version.json sha256. */
  etag: string;
}

/**
 * PACKAGE_SPECS cannot do this: DistanceMap is z.record(z.string(), z.number()),
 * which accepts zeros AND negatives. This builder is the only place a malformed
 * lane table is caught, so it fails loud at load rather than serving a 200 with
 * bad data. Split into a pure core (exported for the malformed-source test) and
 * a file-reading wrapper.
 */
function buildDeliveryReferenceCosts(): ReferenceCostsData {
  const dir = path.join(SOLVERS_ROOT, "delivery-teaching-us", "dataset");
  const costs = JSON.parse(readFileSync(path.join(dir, "costs.json"), "utf8")) as Record<string, number>;
  const distances = JSON.parse(readFileSync(path.join(dir, "distances.json"), "utf8")) as Record<string, number>;
  return buildDeliveryReferenceCostsFrom(costs, distances);
}

export function buildDeliveryReferenceCostsFrom(
  costs: Record<string, number>,
  distances: Record<string, number>,
): ReferenceCostsData {
  const warehouses = new Set(DELIVERY_WAREHOUSES.map((w) => w.id));
  const customers = new Set(DELIVERY_CUSTOMERS.map((c) => c.id));
  const expected = warehouses.size * customers.size;

  if (Object.keys(costs).length !== expected) {
    throw new Error(`referenceCosts: expected ${expected} lanes, found ${Object.keys(costs).length}`);
  }
  const costKeys = Object.keys(costs).sort().join("|");
  const distKeys = Object.keys(distances).sort().join("|");
  if (costKeys !== distKeys) {
    throw new Error("referenceCosts: costs.json and distances.json key sets differ");
  }

  const pairs: ReferenceCostPair[] = [];
  for (const [key, cost] of Object.entries(costs)) {
    const [fromId, toId] = key.split(",");
    if (!fromId || !toId) throw new Error(`referenceCosts: malformed lane key "${key}"`);
    if (!warehouses.has(fromId)) throw new Error(`referenceCosts: unknown warehouse "${fromId}"`);
    if (!customers.has(toId)) throw new Error(`referenceCosts: unknown customer "${toId}"`);
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error(`referenceCosts: lane "${key}" has a non-finite or negative cost`);
    }
    pairs.push({ fromId, fromCode: fromId, toId, toCode: toId, cost });
  }

  const { sha256 } = readVersion("delivery-teaching-us");
  return { modelId: "delivery-teaching-us", pairs, etag: `"${sha256}"` };
}

const REFERENCE_COSTS_BY_MODEL: Record<string, ReferenceCostsData> = {
  "delivery-teaching-us": buildDeliveryReferenceCosts(),
};

/** Undefined for any model that has not registered a builder; the route 422s on that. */
export function getReferenceCosts(modelId: string): ReferenceCostsData | undefined {
  return REFERENCE_COSTS_BY_MODEL[modelId];
}
```

The lane-existence set that `services/precheck.ts` needs is `DELIVERY_LANE_KEYS`
from `data/deliveryDataset.ts` (Task 5), not a second copy derived here — one
source, no drift, and no dependency between this task and Task 6. This file
imports `SOLVERS_ROOT` because its direct sibling `referenceDistances.ts:3`
does; `deliveryDataset.ts` walks to `pnpm-workspace.yaml` because *its* sibling
`maxCoverageDataset.ts:13` does. Both are bundling-safe; leave both.

- [ ] **Step 4: Write the route**

Create `artifacts/api-server/src/routes/referenceCosts.ts`, a direct structural mirror of `routes/referenceDistances.ts` (`:21-24` 422 for no-capability **or** unknown id, `:33` 422 for capability-without-builder, `:37-38` explicit ETag + Cache-Control, `:41` exact `if-none-match` compare → 304). The app disables Express's automatic weak ETags globally, and neither this route nor `/dataset` is behind `requireAuth` (only `routes/scenarios.ts:90` mounts it):

```ts
import { Router } from "express";
import { getManifest } from "../registry/modelRegistry.js";
import { getReferenceCosts } from "../data/referenceCosts.js";

// Chapter 5 (modified) - GET /models/:id/reference-costs, the cost-side mirror
// of reference-distances. Unauthenticated + model-scoped, like /dataset and
// /models, so there is no owner and no 404-vs-403 concern here. Immutable base
// matrix: never merged with a scenario's own laneCostOverrides.
const router = Router();

router.get("/models/:id/reference-costs", (req, res) => {
  const modelId = req.params.id;
  const manifest = getManifest(modelId);
  if (!manifest || !manifest.capabilities.supportsReferenceCosts) {
    res.status(422).json({ error: `Model ${modelId} does not support reference costs` });
    return;
  }

  const data = getReferenceCosts(modelId);
  if (!data) {
    res.status(422).json({ error: `Model ${modelId} does not support reference costs` });
    return;
  }

  res.set("ETag", data.etag);
  res.set("Cache-Control", "public, max-age=0, must-revalidate");

  if (req.headers["if-none-match"] === data.etag) {
    res.status(304).end();
    return;
  }

  res.json({ pairs: data.pairs, distanceUnit: manifest.distanceUnit ?? "mi" });
});

export default router;
```

- [ ] **Step 5: Mount it**

In `artifacts/api-server/src/routes/index.ts` — this repo registers every router here, not in `app.ts`:

```ts
import referenceCostsRouter from "./referenceCosts.js";
...
router.use(referenceCostsRouter);
```

- [ ] **Step 6: Add the path to OpenAPI and regenerate**

Add `/models/{id}/reference-costs` beside the existing reference-distances path, with its 200/304/422 responses and the `ReferenceCostPair` schema.

```bash
pnpm --filter @workspace/api-spec run codegen
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/referenceCosts.test.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/data/referenceCosts.ts \
        artifacts/api-server/src/routes/referenceCosts.ts \
        artifacts/api-server/src/routes/index.ts \
        artifacts/api-server/src/__tests__/referenceCosts.test.ts \
        artifacts/api-server/src/__tests__/deliveryContract.test.ts \
        lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "[ch5-del-7] serve and validate the base cost matrix behind a mounted endpoint"
```

---

## Task 8: Studio registration and the explicit input surface

**Files:**
- Modify: `artifacts/studio/src/lib/chapters.ts` (`StudioModelType` `:1`, `CHAPTERS`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`defaultInputsForModel` `:125` — already exported; `inputEntriesForModel` `:1184` — module-private today, export it)
- Modify: `lib/units/src/objective.ts:20-35`, `lib/units/src/__tests__/objective.test.ts:4-13` (the "six-model contract" table)
- Modify: `artifacts/studio/src/__tests__/Landing.test.tsx:388`
- Create: `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx`

**Interfaces:**
- Produces: `StudioModelType` includes `"delivery-teaching-us"`; a `CHAPTERS` entry at `/chapter-5/delivery`; default inputs; the explicit three-entry tab list; `objectiveDimension` arm.
- Consumes: Task 4's contract.

**This task closes two of the eight silent failures.** `inputEntriesForModel` has a permissive `default:` that would grant the full p-median editing surface, and `objectiveDimension`'s `default:` renders the objective as a unit-less number. `App.tsx:63-86` iterates `CHAPTERS`, so the route needs no `App.tsx` edit; there is no Compare page (multi-scenario compare is `CostSummaryTab.tsx:444`, which calls `formatObjective` per row and needs nothing new).

- [ ] **Step 1: Write the failing tests**

Create `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx`. Fifteen existing studio tests already import `@/pages/Workspace` directly, so this is the established pattern:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CHAPTERS, chapterForModelId } from "@/lib/chapters";
import { objectiveDimension } from "@workspace/units";
import { formatObjective } from "@/lib/formatObjective";
import { defaultInputsForModel, inputEntriesForModel } from "@/pages/Workspace";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";   // used by Task 9's block

describe("delivery-teaching-us — chapter registration", () => {
  it("is visible on Landing while the other two Chapter 5 labs stay hidden", () => {
    const entry = chapterForModelId("delivery-teaching-us");
    expect(entry).toBeDefined();
    expect(entry!.hiddenFromLanding).toBeFalsy();
    expect(entry!.locked).toBeFalsy();
    expect(entry!.path).toBe("/chapter-5/delivery");
    expect(chapterForModelId("transport-coal")!.hiddenFromLanding).toBe(true);
    expect(chapterForModelId("p-median-brazil")!.hiddenFromLanding).toBe(true);
  });

  it("takes Landing from three visible labs to four", () => {
    expect(CHAPTERS.filter(c => !c.hiddenFromLanding)).toHaveLength(4);
  });
});

describe("delivery-teaching-us — default inputs", () => {
  it("opens as the case study's Scenario 1, one click from Scenario 2", () => {
    expect(defaultInputsForModel("delivery-teaching-us")).toEqual({
      p: 3,
      distanceBands: [400, 800, 1200, 1600],
      gap: 0,
      timeLimitSec: 120,
      costAdjustEnabled: false,
      distanceThreshold: 800,
      costPerMile: 1,
      costPerMileOver: 10,
      laneCostOverrides: [],
    });
  });
});

describe("delivery-teaching-us — objective units", () => {
  it("is monetary when adjusted and demand-distance when not, never opaque", () => {
    expect(objectiveDimension("delivery-teaching-us", "cost_adjusted")).toBe("monetary");
    expect(objectiveDimension("delivery-teaching-us", "base")).toBe("demand-distance");
    expect(objectiveDimension("delivery-teaching-us", null)).not.toBe("opaque");
  });

  // Spec 8.4: the RENDERED string, not just the dimension. Pinned by identity
  // with the two models that already own those dimensions, so this test needs
  // no knowledge of the suffix/locale format and cannot drift from it.
  it("renders like jade when adjusted and like p-median when not", () => {
    const x = 150194534098.6;
    expect(formatObjective("delivery-teaching-us", "cost_adjusted", x, "mi", "mi"))
      .toBe(formatObjective("two-echelon-jade-us", null, x, "mi", "mi"));
    expect(formatObjective("delivery-teaching-us", "base", 88240913478.1, "mi", "mi"))
      .toBe(formatObjective("p-median-us", null, 88240913478.1, "mi", "mi"));
    expect(formatObjective("delivery-teaching-us", "cost_adjusted", x, "mi", "mi"))
      .not.toBe(formatObjective("not-a-model", null, x, "mi", "mi"));   // not the opaque path
  });
});

describe("delivery-teaching-us — the input surface is fixed", () => {
  // The silent failure: inputEntriesForModel's tail is
  //   case "p-median-brazil": case "p-median-us": default:
  // so a model that is merely ABSENT inherits Customers, Warehouses and
  // Distances editors. Omission grants the editable surface; only an explicit
  // case withholds it.
  it("offers exactly Input Map, Delivery Costs and Optimization Parameters", () => {
    expect(inputEntriesForModel("delivery-teaching-us").map(e => e.id))
      .toEqual(["input-map", "deliveryCosts", "optimization-parameters"]);
  });

  it("offers no customers, warehouses or distances editor", () => {
    const ids = inputEntriesForModel("delivery-teaching-us").map(e => e.id);
    expect(ids).not.toContain("customers");
    expect(ids).not.toContain("warehouses");
    expect(ids).not.toContain("distances");
  });

  it("does not disturb the p-median default for the models that rely on it", () => {
    expect(inputEntriesForModel("p-median-us").map(e => e.id))
      .toEqual(["input-map", "customers", "warehouses", "distances", "optimization-parameters"]);
  });
});
```

`inputEntriesForModel` is module-private at `Workspace.tsx:1184` — add `export` (a named export is the smallest change that makes this testable, and the function is already pure).

Also add the contract row to `lib/units/src/__tests__/objective.test.ts`'s `cases` table (`:5-13`, one row per model/mode; the describe is titled "the six-model contract" — retitle to "seven-model"):

```ts
    ["delivery-teaching-us", "base",          "demand-distance",   true],
    ["delivery-teaching-us", "cost_adjusted", "monetary",          false],
```

And update `artifacts/studio/src/__tests__/Landing.test.tsx:388` from `"3 labs · 3 scenarios · 1 solved"` to `"4 labs · 3 scenarios · 1 solved"` (the new chapter has no summary row in that test's mock, so it contributes 0 scenarios / 0 solved — same as Ch4 and Ch9 there).

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx src/__tests__/Landing.test.tsx
pnpm --filter @workspace/units test
```

Expected: FAIL — `StudioModelType` rejects the id at the type level, the tab assertions return the p-median list, `objectiveDimension` returns `"opaque"`, Landing still counts 3.

- [ ] **Step 3: Register the chapter**

In `artifacts/studio/src/lib/chapters.ts`, extend the union on line 1 with `| "delivery-teaching-us"` and add to `CHAPTERS`:

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
  },
```

No `hiddenFromLanding`, no `locked`. The two existing Chapter 5 entries are not touched.

- [ ] **Step 4: Add default inputs and the explicit tab case**

`defaultInputsForModel` (`:125`) — the bands are the `Outputs Needed` sheet's four, the rates are the `Trans Costs` sheet's Scenario 2:

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

`inputEntriesForModel` (`:1184`) — an **explicit** case, placed before the `p-median-brazil`/`p-median-us`/`default` tail:

```ts
    // Chapter 5 (modified) - the cost table is the ONLY editable dataset
    // surface (spec decision 11). This case is load-bearing, not tidiness:
    // the switch's tail is `case "p-median-brazil": case "p-median-us":
    // default:`, so a model that is merely absent INHERITS the Customers,
    // Warehouses and Distances editors. Omission grants the editable surface.
    case "delivery-teaching-us":
      return [
        { id: "input-map", label: "Input Map" },
        { id: "deliveryCosts", label: "Delivery Costs" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
```

- [ ] **Step 5: Add the objective-units case**

In `lib/units/src/objective.ts` (`:20`), before `default:`:

```ts
    case "delivery-teaching-us":
      // A cost value is billable miles. With the adjustment OFF the objective
      // is billable-miles x demand; with it ON the rate turns it into dollars.
      // Missing this case renders the objective through `default: "opaque"` as
      // a bare unit-less number - no error, no failing test.
      return objectiveMode === "cost_adjusted" ? "monetary" : "demand-distance";
```

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx src/__tests__/Landing.test.tsx src/lib/chapters.test.ts src/__tests__/lockedChapterDrift.test.ts src/__tests__/App.test.tsx
pnpm --filter @workspace/units test
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/modelIdSetEquality.test.ts
pnpm run typecheck
```

Expected: PASS, including the set-equality test that has been red since Task 4. Typecheck surfaces only the two `switch (modelId: StudioModelType)` sites (`defaultInputsForModel`, `inputEntriesForModel`) — **every other model gate in `Workspace.tsx` is a `modelId === "…"` chain that typecheck cannot see**; Tasks 9–12 each name the ones they own, and Task 13 Step 5's probe sweep is the backstop.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/lib/chapters.ts \
        artifacts/studio/src/pages/Workspace.tsx \
        lib/units/src/objective.ts \
        lib/units/src/__tests__/objective.test.ts \
        artifacts/studio/src/__tests__/Landing.test.tsx \
        artifacts/studio/src/__tests__/deliveryRegistration.test.tsx
git commit -m "[ch5-del-8] register the delivery chapter and declare its fixed input surface"
```

---

## Task 9: Read-only Input Map

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (map render gate ~`:2999`)
- Test: `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx` (append)

**Interfaces:**
- Produces: `InputMapTab`'s `pmedian` arm (`InputMapTab.tsx:128-164`) accepts `readOnly?: boolean`; when true it renders markers, legend and details card and **no** mutation affordance.
- Consumes: Task 8's tab registration.

The smallest safe change is a read-only variant of the existing p-median map, not a new map component. Today the map renders `mode="pmedian"` with `onInputsChange={handlePMedianMapInputsChange}` (`Workspace.tsx:2998-3004`, the un-gated fallback branch of `entity === "input-map"`) — fully editable. No `readOnly` prop exists today; read-only-ness is currently expressed only as `demandEditable={false}` (base-customer demand) plus omitting `onSave` (no relocated Save), which leaves add/move/copy/delete fully live — so a real prop is needed, not a combination of the existing ones.

- [ ] **Step 1: Write the failing tests**

Append to `deliveryRegistration.test.tsx` (its imports of `render`, `screen`, `InputMapTab` were added in Task 8 Step 1):

```tsx
describe("delivery-teaching-us — the map is read-only", () => {
  function renderDeliveryMap() {
    return render(<InputMapTab mode="pmedian" readOnly
                               warehouses={[{ id: "W1", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.24 }]}
                               customers={[{ id: "C2", city: "Chicago", state: "IL", lat: 41.88, lng: -87.63, demand: 1000 }]}
                               inputs={{}} countryBounds={{ sw: [24, -125], ne: [50, -66] }}
                               onInputsChange={() => { throw new Error("read-only map must never call onInputsChange"); }} />);
  }

  // Real testids at 3065c91 - arming chips, right-click add menu, marker
  // action menu, Layers-row Save. Asserting the tab list alone would pass
  // against a map a student can still drag a warehouse on, which is why every
  // affordance is named individually.
  it.each([
    "button-input-map-place-wh", "button-input-map-place-cs",       // InputMapTab.tsx:833,836
    "armed-status-bar", "button-armed-cancel",                       // :840,844
    "map-add-menu", "map-add-menu-wh", "map-add-menu-cs",            // :368-375 (right-click)
    "map-action-menu", "map-action-edit", "map-action-move",         // map/MapActionMenu.tsx
    "map-action-copy", "map-action-delete",
    "button-save",                                                   // :868 (Layers-row Save)
  ])("does not render %s", (testid) => {
    renderDeliveryMap();
    expect(screen.queryByTestId(testid)).toBeNull();
  });

  it("does not open the action menu or the add menu from a marker / map interaction", async () => {
    renderDeliveryMap();
    // right-click the map surface and click a marker; neither menu may appear
    // (copy the interaction helpers from InputMapTabV2.test.tsx).
    expect(screen.queryByTestId("map-action-menu")).toBeNull();
    expect(screen.queryByTestId("map-add-menu")).toBeNull();
  });

  it("still renders the map, its legend and the read-only details card", () => {
    renderDeliveryMap();
    expect(screen.getByTestId("input-map-tab")).toBeInTheDocument();    // root testid (:817); there is no "input-map"
  });
});
```

The edit dialogs (`edit-warehouse-*`, `edit-customer-*`, `create-entity-*`, `move-confirm-*`) are reached only through the two menus asserted above, so gating the menus gates them; do not add per-dialog gates.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx
```

Expected: FAIL — `readOnly` is not a prop (TS error) and the arming chips render.

- [ ] **Step 3: Add the `readOnly` prop**

In `InputMapTab.tsx`'s `pmedian` arm (`:128-164`), add `readOnly?: boolean` beside `demandEditable?` with a comment recording why it exists, and gate on `!readOnly`: the arming chips + armed bar (`:833-844`), the right-click add menu (`:368-379`), the marker action menu (`map/MapActionMenu.tsx` mount), and the Layers-row Save (`:868`). Do not gate on `modelId` — this repo's recurring bug class is a shared component gated for one model and not its sibling, and a capability-style boolean prop cannot drift that way. `demandEditable` stays as is (`false` for this model via the manifest).

- [ ] **Step 4: Pass it from Workspace**

At the p-median map render (`Workspace.tsx:2998-3004`), pass `readOnly={modelId === "delivery-teaching-us"}` and, for that model, an `onInputsChange` that is a no-op (the prop is required by the arm's type), so the component cannot write even if a future edit reintroduces an affordance. Leave `isEditableInputTab` (`:2140-2200`) and `saveInLayersRow` (`:2211`) **without** a delivery `input-map` row — the map has nothing to save, so it must not be treated as an editable tab (that would render a dirty-state Save with no effect).

- [ ] **Step 5: Run to verify they pass, and that no other model changed**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx \
  src/__tests__/InputMapTabV2.test.tsx src/__tests__/InputMapTab.maxCoverage.test.tsx \
  src/__tests__/InputMapTabV2.transport.test.tsx
```

Expected: PASS, including every pre-existing Input Map suite.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/deliveryRegistration.test.tsx
git commit -m "[ch5-del-9] add a read-only Input Map variant and use it for delivery"
```

---

## Task 10: The Adjust Cost Table control and the `P` bound

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` (`OptimizationParametersField` union, `OptimizationParametersTabProps`, new JSX block — located by anchor, see Step 4)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (both `pMax` ternaries and the four new props at the `OptimizationParametersTab` mount; `pMax` at the `SolveDialog` mount)
- Test: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx` (append), `artifacts/studio/src/__tests__/SolveDialog.test.tsx` (append)

**Interfaces:**
- Produces: four new `OptimizationParametersField` members — `"costAdjustEnabled"`, `"distanceThreshold"`, `"costPerMile"`, `"costPerMileOver"` — and four optional props.
- Consumes: Task 8's default inputs.

**BLOCKED until the Chapter 4 two-step branch merges.** At `3065c91` that plan is ~60 % implemented on `ch4-2s-7-work` (Tasks 1–6 committed, Task 7 in the locked worktree `.worktrees/ch4-two-step`, where this file already carries `step?: 1 | 2`, `stepEditable`, `step2Gap`, `step2TimeLimitSec` and a `{(step ?? 1) === 1 && …}` wrapper). Build this task **on the merged result**: rebase the Ch5 branch onto post-Ch4 `main` first (Task 0 Step 2's guard), then locate every edit point by the anchors below — this task deliberately carries **no line numbers** for this file because both the `main` and `ch4-2s-7-work` versions were measured and differ. At `3065c91` (pre-merge, for orientation only): union `:10-30`, props `:32-133` (`pMax?` at `:53`, `onChange` at `:132`), `pMax = 50` at `:151`, the P slider `:195-216`, the Chen `{objective != null && (` block `:235-359`, the `{bomRatio != null && (` block **opens** at `:438` and closes ~`:455`.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`:

```tsx
describe("Adjust Cost Table (delivery-teaching-us)", () => {
  const deliveryProps = {
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    gap: 0,
    timeLimitSec: 120,
    p: 3,
    pMax: 33,
    distanceBands: [400, 800, 1200, 1600],
    onChange: vi.fn(),
  };

  it("renders the button and hides the three fields when the toggle is off", () => {
    render(<OptimizationParametersTab {...deliveryProps} />);
    expect(screen.getByTestId("button-adjust-cost-table")).toBeInTheDocument();
    expect(screen.queryByTestId("input-distance-threshold")).toBeNull();
    expect(screen.queryByTestId("input-cost-per-mile")).toBeNull();
    expect(screen.queryByTestId("input-cost-per-mile-over")).toBeNull();
  });

  it("reveals the three fields when the toggle is on", () => {
    render(<OptimizationParametersTab {...deliveryProps} costAdjustEnabled />);
    expect(screen.getByTestId("input-distance-threshold")).toHaveValue(800);
    expect(screen.getByTestId("input-cost-per-mile")).toHaveValue(1);
    expect(screen.getByTestId("input-cost-per-mile-over")).toHaveValue(10);
  });

  it("emits costAdjustEnabled through the generic onChange", async () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...deliveryProps} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-adjust-cost-table"));
    expect(onChange).toHaveBeenCalledWith("costAdjustEnabled", true);
  });

  // Values persist across the toggle: the schema always carries all three, so
  // turning the feature off and on again must not reset a student's rates.
  it("does not clear the rate values when toggled off", async () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...deliveryProps} costAdjustEnabled onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-adjust-cost-table"));
    expect(onChange).toHaveBeenCalledWith("costAdjustEnabled", false);
    expect(onChange).not.toHaveBeenCalledWith("costPerMile", expect.anything());
    expect(onChange).not.toHaveBeenCalledWith("distanceThreshold", expect.anything());
  });

  it("renders nothing of the sort for a model that passes none of these props", () => {
    render(<OptimizationParametersTab gap={0} timeLimitSec={120} distanceBands={[500]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-adjust-cost-table")).toBeNull();
  });

  // The component default is pMax = 50 against a schema cap of 33. P is a
  // Radix <Slider data-testid="slider-p-value" max={pMax}> plus quick-pick
  // buttons filtered by n <= pMax - there is no "input-p".
  it("caps the P slider at 33 and drops quick-picks above it", () => {
    render(<OptimizationParametersTab {...deliveryProps} />);
    expect(screen.getByTestId("slider-p-value")).toHaveAttribute("aria-valuemax", "33");   // Radix exposes max as aria-valuemax on the thumb; adjust to the real rendered attribute after one run
    expect(screen.getByTestId("button-p-quick-25")).toBeInTheDocument();
    expect(screen.queryByTestId("button-p-quick-50")).toBeNull();
  });
});
```

And in `SolveDialog.test.tsx`, following its existing `pMax` case for max-coverage-us (the dialog has its own `pMax = 50` default at `SolveDialog.tsx:156` and its own slider `solve-dialog-slider-p` at `:205`):

```tsx
it("caps P at 33 for delivery-teaching-us", () => {
  render(<SolveDialog {...baseProps} p={3} pMax={33} />);
  expect(screen.getByTestId("solve-dialog-slider-p")).toHaveAttribute("aria-valuemax", "33");
});
```

Spec §6.2 wants the UI to accept 33 and refuse 34: with a slider whose `max` is 33, 34 is unreachable — that is the assertion. The API's `.max(33)` (Task 4) is the second line.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx src/__tests__/SolveDialog.test.tsx
```

Expected: FAIL — no such testids; `pMax` 33 not yet honoured by a delivery arm.

- [ ] **Step 3: Extend the field union and the props**

`OptimizationParametersField` gains four members. The existing `onChange` signature is already `(field, value: number | number[] | boolean)`, so the boolean needs no widening:

```ts
  // Chapter 5 (modified) - the Adjust Cost Table feature's four fields.
  | "costAdjustEnabled"
  | "distanceThreshold"
  | "costPerMile"
  | "costPerMileOver"
```

`OptimizationParametersTabProps` gains:

```ts
  /** Chapter 5 (modified) - present only for delivery-teaching-us. Gated on
   * presence like every other model-specific parameter in this component,
   * never on modelId. */
  costAdjustEnabled?: boolean;
  distanceThreshold?: number;
  costPerMile?: number;
  costPerMileOver?: number;
```

- [ ] **Step 4: Add the JSX block**

Insert **immediately after the closing `)}` of the `{bomRatio != null && (` block** (the block *opens* at `:438` on `main` and runs ~17 lines; find it by the `slider-bom-ratio` testid, not by line) — with the `capacityFactor` / `singleSource` / `capacityInactive` / `bomRatio` family, after the ungated gap and time-limit inputs, and **outside** both the Chen `{objective != null && (` block and Chapter 4's `{(step ?? 1) === 1 && (` step wrapper.

That placement is load-bearing. Chapter 4's Task 7 wraps its own block in the step wrapper so Steps 1 and 2 render exclusively; anything gated only on prop presence *inside* that wrapper silently stops rendering on Step 2. This model has no step concept and its control must render whenever its props are present. After inserting, confirm with `rg -n 'cost-adjust-section|step ?? 1|slider-bom-ratio' OptimizationParametersTab.tsx` that the new testid sits below `slider-bom-ratio` and is not enclosed by the step wrapper's range.

```tsx
{costAdjustEnabled != null && (
  <div className="space-y-2" data-testid="cost-adjust-section">
    <Button
      variant={costAdjustEnabled ? "secondary" : "outline"}
      className="h-8 w-full text-sm"
      data-testid="button-adjust-cost-table"
      onClick={() => onChange("costAdjustEnabled", !costAdjustEnabled)}
    >
      Adjust Cost Table
    </Button>
    {costAdjustEnabled && (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Each lane is repriced from its distance: at or under the threshold it
          bills at the first rate, beyond it at the second. Distances are never
          changed.
        </p>
        <div>
          <Label htmlFor="input-distance-threshold" className="text-xs text-muted-foreground">
            Distance threshold (mi)
          </Label>
          <Input id="input-distance-threshold" type="number" value={distanceThreshold}
                 data-testid="input-distance-threshold"
                 className="h-8 text-sm mt-1 font-mono"
                 onChange={e => onChange("distanceThreshold", parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <Label htmlFor="input-cost-per-mile" className="text-xs text-muted-foreground">
            Cost per mile
          </Label>
          <Input id="input-cost-per-mile" type="number" value={costPerMile}
                 data-testid="input-cost-per-mile"
                 className="h-8 text-sm mt-1 font-mono"
                 onChange={e => onChange("costPerMile", parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <Label htmlFor="input-cost-per-mile-over" className="text-xs text-muted-foreground">
            Cost per mile over the threshold
          </Label>
          <Input id="input-cost-per-mile-over" type="number" value={costPerMileOver}
                 data-testid="input-cost-per-mile-over"
                 className="h-8 text-sm mt-1 font-mono"
                 onChange={e => onChange("costPerMileOver", parseFloat(e.target.value) || 0)} />
        </div>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Wire both mounts from Workspace**

`pMax` is **already passed** at both mounts as a modelId ternary — `Workspace.tsx:3320` (`modelId === "two-echelon-jade-us" ? jadeActiveWarehouseCount(dataset, localInputs) : modelId === "max-coverage-us" ? 26 : undefined`) and `:4037` (`modelId === "max-coverage-us" ? 26 : undefined`). Add a `: modelId === "delivery-teaching-us" ? 33` arm to **both**; a bound enforced at one mount is not a bound. (`26` is a hardcoded literal for max-coverage; `33` is likewise the schema's `.max(33)` — the two must move together if the dataset ever changes, which is why Task 4's contract test pins 33/34.)

Pass the four values into `OptimizationParametersTab` beside the Chen props at `:3320-3334`, reading them off `localInputs` with the same presence-typed reader pattern the file already uses (`optionalNumberFromInputs(localInputs, "…")`; add a `booleanFromInputs` for `costAdjustEnabled` if none exists), each gated `modelId === "delivery-teaching-us" ? … : undefined` exactly like the Chen props so no sibling receives them.

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx \
  src/__tests__/SolveDialog.test.tsx
```

Expected: PASS, including the pre-existing suites and the Chapter 4 two-step suites now on `main`.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx \
        artifacts/studio/src/__tests__/SolveDialog.test.tsx
git commit -m "[ch5-del-10] add the Adjust Cost Table control and cap P at 33 in both mounts"
```

---

## Task 11: The Delivery Costs tab

**Files:**
- Create: `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx`
- Create: `artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (tab content branch; `isEditableInputTab` row `:2140-2200`)
- Modify: `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx` (delivery block)

**Interfaces:**
- Consumes: Task 7's `GET /models/:id/reference-costs` via the generated hook (`useGetReferenceCosts` / `getGetReferenceCostsQueryKey` from `@workspace/api-client-react`, produced by Task 7's codegen); Task 8's `deliveryCosts` entry id.
- Produces: edits to `localInputs.laneCostOverrides`.

Modelled directly on `DistancesTab.tsx`: base rows from the reference endpoint merged read-only with the student's sparse overrides, `PAGE_SIZE = 50` pagination (`DistancesTab.tsx:330`, function-local), two free-text substring filters (`fromFilter`/`toFilter`, `:288-289`), typed-id add row (`:660-698`).

**With 10,329 base rows the filters are not a nicety.** They are the only practical way to reach a lane; paging to row 4,000 is not an interaction. Treat "filter to a city, edit its cost" as the primary flow.

**The tab must be declared editable, or it cannot save.** `isEditableInputTab` (`Workspace.tsx:2140-2200`) is an allow-list of `(entity, modelId)` pairs — `laneCosts` is listed for `transport-coal` only (`:2200`), `distances` for five models (`:2198`). Without a `deliveryCosts` row for this model the shared toolbar Save never appears and the dirty state is never tracked. Nothing errors.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx` covering:

```tsx
describe("DeliveryCostsTab", () => {
  it("renders base rows from the reference-costs query", async () => { /* mock the hook with 3 pairs, assert all 3 render */ });
  it("shows an override in place of its base value and marks it overridden", async () => { /* ... */ });
  it("paginates at 50 rows", async () => { /* mock 120 pairs, assert 50 rendered and a page control present */ });
  it("renders the first page of a 10,329-pair table without materialising every row", async () => {
    /* mock 10,329 pairs; assert exactly 50 rows in the DOM and that render completes well under
       the suite's default 5 s timeout - spec 8.4 says "pagination works at 10,329 rows", and a
       120-row mock cannot prove that */
  });
  it("filters by from-id substring", async () => { /* ... */ });
  it("filters by to-id substring", async () => { /* ... */ });
  it("adds an override for a typed pair", async () => { /* assert onChange receives {fromId,toId,cost} */ });
  it("rejects a duplicate (fromId,toId) at add time", async () => { /* ... */ });
  it("accepts a zero cost", async () => { /* the dataset ships 33 zero self-lanes */ });
  it("rejects a negative cost", async () => { /* ... */ });
  it("removes an override and falls back to the base value", async () => { /* ... */ });
});
```

Fill each body with real assertions against the component's own testids — copy the interaction patterns from `DistancesTab.test.tsx`, which exercises the identical shape.

Append a delivery block to `Workspace.TabCoverage.test.tsx`, mirroring the `max-coverage-us` block at `:656-760` (a solved scenario fixture, a `useListModels` mock carrying this model's manifest capabilities incl. `capacityModes: []`, `supportsReferenceCosts: true`, `outputGrids` of four; then `runTabCoverage`). Inputs side: `[INPUT_MAP, { sidebarId: "deliveryCosts", tabTestId: "delivery-costs-tab" }, OPTIMIZATION_PARAMETERS]`; outputs side: `[OUTPUT_MAP, OPEN_WAREHOUSES, CUSTOMER_ASSIGNMENTS, COST_SUMMARY, SERVICE_STATS]` and **no** `FLOWS`. This is the test that proves every declared tab opens real content (decision 10's "three outputs, placed" and spec §6.1's four output grids) and that no fourth input tab leaks in.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/DeliveryCostsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx
```

Expected: FAIL — module not found; the coverage block finds no `delivery-costs-tab`.

- [ ] **Step 3: Write the component**

Create `DeliveryCostsTab.tsx` following `DistancesTab.tsx`'s structure: `baseByKey` from the reference query, `overrideByKey` from `laneCostOverrides`, `mergedRows` combining them, `PAGE_SIZE = 50`, `fromFilter`/`toFilter`, and an add-row with typed ids validated for non-empty, **non-negative** finite cost (zero is legal: 33 self-lanes ship at zero; spec §7.4's "positive" is corrected to "non-negative" in this revision), and pair-not-already-overridden. Root `data-testid="delivery-costs-tab"`. The value column is **cost**, labelled as cost, and carries no unit conversion — a cost is billable miles, not a distance, and must not be routed through `useDistanceDraft`. Compute `mergedRows` lazily per page (filter → slice → merge), not merge-all-then-slice, so the 10,329-row test holds.

- [ ] **Step 4: Render it from Workspace and declare it editable**

Add a tab-content branch for `entity === "deliveryCosts"`, beside the existing `laneCosts` (`:3465`) and `distances` (`:3356`) branches. Add `(activeTab.entity === "deliveryCosts" && modelId === "delivery-teaching-us")` to `isEditableInputTab`'s allow-list (`:2140-2200`) with a comment naming this task, so the shared toolbar Save and dirty tracking apply.

- [ ] **Step 5: Run to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/DeliveryCostsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx
pnpm --filter studio test
```

Expected: PASS, and the full Studio suite still green.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx \
        artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx \
        artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx \
        artifacts/studio/src/pages/Workspace.tsx
git commit -m "[ch5-del-11] add the Delivery Costs override editor over the base cost matrix"
```

---

## Task 12: Outputs — band precision, Demand Served, Solution Summary, and exports

**Files:**
- Modify: `lib/units/src/bands.ts:37-52`, `artifacts/studio/src/lib/bands.ts:25-37` (shim re-export)
- Modify: `artifacts/api-server/src/services/templates.ts` (`buildEffectiveFacilityCityLookup` `:1388-1402`)
- Modify: `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx` (`:288-290`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (Open Warehouses `capacityModes` pass-through `:3681`)
- Test: `lib/units/src/__tests__/bands.test.ts`, `artifacts/api-server/src/__tests__/templates.test.ts`, `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx`, `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, `artifacts/studio/src/__tests__/Workspace.test.tsx` (Open Warehouses column), `artifacts/api-server/src/__tests__/routes.test.ts` (output export)

**Interfaces:**
- Produces: `computeCumulativeBandCoverage(edges, bands, opts?: { decimals?: number })` — **default unchanged**, re-exported unchanged through the studio shim; `buildEffectiveFacilityCityLookup` resolves delivery warehouse cities; Open Warehouses shows Demand Served for this model.
- Consumes: Task 3's envelope, Task 5's loaders.

**Where the numbers actually come from.** `ServiceStatsTab.tsx:288-290` recomputes coverage live from `edges[].distance` via `computeCumulativeBandCoverage` whenever Workspace passes `presentationBands` (it does for every band model), and only falls back to the envelope's `metrics.bandCoverage`. So the 2 dp contract for the *bars* is the `decimals` option below; the envelope's 2 dp (Task 3) is what exports and the Solution Summary read. Both must hold. `ServiceStatsTab` imports the helper from the studio shim `@/lib/bands`, which re-exports `@workspace/units` — the new option must flow through that re-export (it is a plain `export { … }` list, so widening the signature upstream is enough; verify the shim's type re-export picks it up).

- [ ] **Step 1: Write the failing tests**

In `lib/units/src/__tests__/bands.test.ts`:

```ts
describe("computeCumulativeBandCoverage — opt-in precision", () => {
  const edges = [
    { distance: 100, flow: 1 },
    { distance: 900, flow: 2 },
  ];

  // Five models have tests pinned to integer percentages. Changing the default
  // is out of scope; this is additive.
  it("still returns integers by default", () => {
    const rows = computeCumulativeBandCoverage(edges, [400, 1600]);
    expect(rows[0]!.percent).toBe(33);
  });

  it("returns two decimals when asked", () => {
    const rows = computeCumulativeBandCoverage(edges, [400, 1600], { decimals: 2 });
    expect(rows[0]!.percent).toBeCloseTo(33.33, 2);
  });

  it("keeps the Overflow row under both precisions", () => {
    const rows = computeCumulativeBandCoverage(edges, [400], { decimals: 2 });
    expect(rows.some(r => r.band === OVERFLOW_BAND)).toBe(true);
  });
});
```

In `artifacts/api-server/src/__tests__/templates.test.ts` (the function returns a `Map<string, string>`, `templates.ts:1388`):

```ts
it("resolves delivery-teaching-us warehouse cities", () => {
  const lookup = buildEffectiveFacilityCityLookup("delivery-teaching-us", {});
  // Missing this branch ships blank city values in the Open Warehouses export
  // and nothing errors - the fallback at templates.ts:1402 is an empty Map.
  expect(lookup.get("W1")).toBe("Los Angeles");
  expect(lookup.get("W60")).toBeTruthy();
  expect(lookup.size).toBe(33);
});
```

In `artifacts/studio/src/__tests__/Workspace.test.tsx` (or the Open Warehouses suite that already covers jade's Demand Served column), a delivery case: render a solved delivery scenario with a `useListModels` mock whose capabilities carry `capacityModes: []`, open Open Warehouses, and assert the column header is `"Demand Served"` and no utilization `%` cell renders. Today `Workspace.tsx:3681` passes `capacityModes` to `facilityDisplayedInputs` **only for `two-echelon-jade-us`** (an explicit guard so gold-au, whose manifest also declares `[]`, keeps its historical rendering); for every other model it is `undefined`, and `OpenWarehousesTab.tsx:158-160` then falls to `showUtilization = capacityMode !== "none"` — this model has no `capacityMode` input, so the utilization column would render with nothing to compute.

In `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, a delivery case per spec §7.6 / decision 10: the single-scenario table shows the Objective row rendered through `formatObjective` (monetary for `cost_adjusted`, demand-distance for `base`) and the `"Weighted avg. distance"` row (`CostSummaryTab.tsx:350`) at 4 dp; read the component's row gating for `"Open facilities"` (`:490`, compare mode) and assert whatever it does for a `supportsFacilityStatus: false` model — the point is a pinned expectation, not a guess.

In `artifacts/api-server/src/__tests__/routes.test.ts`, the output-export path (`GET /scenarios/:scenarioId/export?entity=…&format=…`, `scenarios.ts:623`; gated by the manifest's `outputGrids` at `:699`, built at `:842-844`, city column via `buildEffectiveFacilityCityLookup`): seed a delivery scenario whose `result` is the Scenario 1 golden envelope (no live CBC), then assert `openWarehouses` CSV has a populated city column for `W1`, `costSummary` JSON carries `objectiveMode: "base"` and `weightedAvgDistance: 422.5511`, `serviceStats` JSON keeps `81.45` (2 dp) and includes an Overflow row when the seeded envelope has one, and `flows` returns **422** (not in this model's `outputGrids`).

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @workspace/units exec vitest run src/__tests__/bands.test.ts
pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx src/__tests__/CostSummaryTab.test.tsx
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/templates.test.ts src/__tests__/routes.test.ts
```

Expected: FAIL — no `decimals` option; `lookup.get("W1")` undefined; utilization column renders; export city column blank.

- [ ] **Step 3: Add opt-in precision**

In `lib/units/src/bands.ts:37`, add an optional third parameter `opts?: { decimals?: number }` and route both `Math.round` calls (`:44` and the overflow row `:48-50`) through `roundTo(x, opts?.decimals ?? 0)`, so existing output is byte-identical. Confirm `artifacts/studio/src/lib/bands.ts`'s re-export needs no change (it re-exports the symbol, not a wrapper).

- [ ] **Step 4: Add the city-lookup branch and the Demand Served pass-through**

In `services/templates.ts:1397-1402`, add a `delivery-teaching-us` arm to the ternary chain returning `DELIVERY_WAREHOUSES` (imported from `../data/deliveryDataset.js`), so the id→city `Map` is populated.

In `Workspace.tsx:3681`, widen the jade-only gate to `modelId === "two-echelon-jade-us" || modelId === "delivery-teaching-us"` with a comment: the gold-au guard the existing comment describes still holds, because gold-au is still excluded by name.

- [ ] **Step 5: Pass 2 decimals for this model in Service Stats**

In `ServiceStatsTab.tsx:288-290`, pass `{ decimals: 2 }` to `computeCumulativeBandCoverage` when the active model is `delivery-teaching-us`. No capability-shaped seam for "band precision" exists in the manifest; a single explicit `modelId` comparison is acceptable here and must carry a comment saying why (spec §5.7 pins 2 dp for this model only; the other five models' tests are pinned to integers).

- [ ] **Step 6: Run to verify they pass, plus every band consumer**

```bash
pnpm --filter @workspace/units test
pnpm --filter studio exec vitest run src/__tests__/bands.test.ts src/__tests__/bandsSingleSource.test.ts \
  src/__tests__/ServiceStatsTab.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/CostSummaryTab.test.tsx
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/templates.test.ts src/__tests__/routes.test.ts
```

Expected: PASS, with every pre-existing integer-percentage assertion untouched.

- [ ] **Step 7: Verify the four output grids export in a real browser**

Create a delivery scenario, solve it, and export each of Open Warehouses, Assignments, Cost Summary and Service Stats as CSV and JSON from the UI. Confirm: cities are populated, the objective carries the right mode and units, weighted average distance keeps 4 dp, band percentages keep 2 dp, and an Overflow row appears when present. The automated version of this is Step 1's `routes.test.ts` case; this step is the one manual confirmation that the UI's export buttons hit that route.

The spec's §9 point-9 `N/A` is **input-side only** (no importable input entities; `services/import.ts`'s five ternaries need no delivery arm — recorded in R7) — output exports are in scope.

- [ ] **Step 8: Commit**

```bash
git add lib/units/src/bands.ts lib/units/src/__tests__/bands.test.ts \
        artifacts/studio/src/lib/bands.ts \
        artifacts/api-server/src/services/templates.ts \
        artifacts/api-server/src/__tests__/templates.test.ts \
        artifacts/api-server/src/__tests__/routes.test.ts \
        artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/Workspace.test.tsx \
        artifacts/studio/src/__tests__/CostSummaryTab.test.tsx
git commit -m "[ch5-del-12] add opt-in band precision, delivery city lookup, Demand Served, and verified exports"
```

---

## Task 13: End-to-end, journey, and closeout

**Files:**
- Create: `artifacts/studio/e2e/delivery-teaching.spec.ts`
- Modify: `artifacts/api-server/src/solver/tests/e2e_journey.py`
- Modify: `artifacts/studio/e2e/bundle4-auth-landing.spec.ts`, `bundle6-ui-tweaks.spec.ts`
- Modify: `README.md`, `CLAUDE.md`, `model-integration-precheck.md`, `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: Write the Playwright journey**

Create `artifacts/studio/e2e/delivery-teaching.spec.ts`, modelled on `max-coverage.spec.ts`:

1. Landing shows the Chapter 5 Delivery card; `transport-coal` and `p-median-brazil` remain absent.
2. Create a scenario → the tab rail shows exactly Input Map, Delivery Costs, Optimization Parameters.
3. The Input Map renders and exposes no add/move/delete/status/demand/Save affordance.
4. Solve → Scenario 1's open set `{W1, W2, W60}` and weighted average distance 422.5511.
5. Click **Adjust Cost Table**, confirm the three fields appear at 800 / 1 / 10, re-solve → open set flips to `{W6, W43, W45}` and 800-mile coverage rises to 97.19%.
6. Override one lane's cost and re-solve. **Pin a lane whose override cannot change the assignment**, or assert the mathematically correct result of a controlled change — a bare "objective moved" assertion is ambiguous because a large override legitimately reroutes demand.
7. Export Open Warehouses as CSV and assert the city column is populated.

**Use seeded solver results for everything except one real-CBC solve.** pytest owns the numeric proof; three live CBC solves in Playwright buys nothing and costs ~6 seconds each.

- [ ] **Step 2: Add the journey case**

Add a `journey_delivery()` to `e2e_journey.py` following its existing style: create → solve → assert status optimal, 313 customers served, open ids ⊆ the 33 warehouse ids, weighted average distance in a sane range; then a second run with the toggle on asserting the open set changes. **Register it in the `JOURNEYS` dict** (`:620-626`) as `"delivery": journey_delivery` — sections dispatch through that dict and an unregistered name exits 1 with `Unknown section`. The CLI form is `python3 e2e_journey.py <base-url> <section>` (`argv[1]` must start with `http`, `argv[2]` is the section).

`e2e_accuracy.py` is **not** touched. It is run at the gate and never edited.

- [ ] **Step 3: Fix the already-stale lab-count specs**

`bundle4-auth-landing.spec.ts:120,153-154,183-184,212-213` and `bundle6-ui-tweaks.spec.ts:270-271` assert `"2 labs"` when the true figure has been 3 since Chapter 4 was unlocked (`docs/CHANGELOG-implementation.md:412`). Set them to the correct post-change value of **4**. Their `auth-labs-strip` assertions disagree with each other today (`bundle4:50,55` `"Chapter 3Chapter 9"`; `bundle6:313-314` `"Chapter 3Chapter 10"`) and neither matches the live non-hidden set — set both to the true post-change strip. Do not increment their current wrong values. (`labs.spec.ts:95-103` also enumerates three stale lab names but is excluded from `e2e:gate` and stays untouched.)

- [ ] **Step 4: Run the full gate**

```bash
git diff --check
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
pnpm --filter @workspace/units test
pnpm --filter @workspace/dataset-schema exec vitest run
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
(cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 delivery)
pnpm e2e:gate
```

Expected: all green; `e2e_accuracy.py` at **99/99**, unmodified. `resultEnvelope.test.ts` and `jobRunnerDispatcher` are known load-induced flakes — if they fail, re-run those files in isolation before treating it as a regression.

- [ ] **Step 5: Re-run Task 0's dependency audit**

A consumer added *during* implementation is exactly what a single up-front audit misses. Re-run Task 0 Steps 3 and 4 **with `"delivery-teaching-us"` as the probe** and diff the hit set against the R7 table: every hit must be an R7 row, and every non-N/A R7 row must be a hit. Then re-run the `"max-coverage-us"` sweep and confirm the two hit sets differ only where R7 says N/A.

- [ ] **Step 6: Documentation closeout**

- `README.md:155,171` — "six models" → seven.
- `CLAUDE.md` — (a) `:139` corrects the stale claim that `e2e_journey.py` is "fully non-runnable"; it authenticates via `/auth/register` + `/auth/login` (`e2e_journey.py:201,235,239`) and now has a `delivery` section; (b) the "Six models live under `solvers/`" line in *v2 implementation progress* → seven, adding `delivery-teaching-us` (Ch.5 modified) to the list.
- `model-integration-precheck.md` — Gate 1 currently lists **ten** registration points (`:34`, `:37-83`). Append points 11–18 from the spec's §9 plus the ones this plan found: `objectiveDimension` (`lib/units/src/objective.ts`), explicit `inputEntriesForModel` case, `runNetworkEditsPrecheckForModel` branch, `routes/index.ts` mount, `buildEffectiveFacilityCityLookup`, both `pMax` ternaries, `isEditableInputTab` row, Open Warehouses `capacityModes` pass-through, per-model test blocks (`index.test.ts`, `test_datasets.py`, `TabCoverage`, `objective.test.ts`, `Landing.test.tsx`). Note explicitly which fail silently, and point at `modelIdSetEquality.test.ts` as the automated guard for the id registries.
- `docs/CHANGELOG-implementation.md` — the implementation entry, and amend `:449`'s "Chapter 5 — nothing to commit", which Task 1 supersedes.
- `attached_assets/NOTEBOOKS.md` — already updated in Task 1; confirm the hashes match the committed files.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/e2e/ artifacts/api-server/src/solver/tests/e2e_journey.py \
        README.md CLAUDE.md model-integration-precheck.md docs/CHANGELOG-implementation.md
git commit -m "[ch5-del-13] add the delivery e2e journey and complete the documentation closeout"
```

(`model-integration-precheck.md` lives at the repo root, so the bare path is correct.)

- [ ] **Step 8: Run `/harness-retro`**

A branch is not finished until this has run.

---

## Self-Review (Rev 2)

**1. Spec coverage.** Decision 1 → Tasks 2/4. Decision 2 → Tasks 1/3. Decision 3 → Task 1 (+ `deliveryDataset.test.ts`, `test_datasets.py`). Decision 4 → Task 8 (+ `Landing.test.tsx`). Decisions 5/6/7 → Task 3 (`_effective_delivery_costs`). Decision 8 → Task 3 (`LpConstraintLE` + its test). Decision 9 → Task 3 (`served_{c}` equality + `test_single_source` incl. `flow == demand`). Decision 10 → Task 11 (`TabCoverage` block: the four output tabs open, no Flows) + Task 12 (`CostSummaryTab` Objective/WAD rows, Service Stats 2 dp, export route test). Decision 11 → Tasks 8/9/11. Decision 12 → Task 2 (`capacityModes: []`) + Task 3 (no `utilizationByNode`) + Task 12 (`capacityModes` pass-through → Demand Served). Decision 13 → Tasks 2/8. Decision 14 → Task 8. Spec §9's 18 registration points map as: 1–2 Task 2; 3 Task 4; 4 Task 4; 5 Task 2; 6 Task 4; 7 Tasks 4/7; 8 Task 3; 9 N/A input-side (recorded), outputs in Task 12; 10 N/A; 11 Task 8; 12 Task 2; 13 Task 8; 14 Task 6; 15 Task 7; 16 Task 12; 17 Task 10; 18 Task 4. Points this plan added beyond §9 (R7 rows 19–30): `routes/dataset.ts` Task 5; `isEditableInputTab` Task 11; read-only map gate Task 9; Open Warehouses pass-through Task 12; `JOURNEYS` Task 13; studio band shim Task 12; per-model test blocks Tasks 1/2/8/11; set-equality test Task 4. Spec sections previously unmapped are now mapped: §4.3 oracle rework → Task 1 Step 9; §5.6/§12.3.7 Overflow row → Task 3 (solver emits `band: -1`) + test; §5.8 evidence fields → `test_envelope_carries_status_evidence`; §6.1 parity → Task 7; §6.2.1 duplicate/domain precheck + route 422 → Task 6; §7.6 Summary/Output Map → Tasks 11/12; §8.4 `formatObjective` → Task 8; §12.4.1 exports → Task 12 `routes.test.ts`.

**2. Placeholder scan.** One deliberate exception: Task 11 Step 1 lists eleven test names with `/* ... */` bodies rather than full code, because each body is a mechanical copy of the corresponding case in `DistancesTab.test.tsx`, which exercises an identical component shape — reproducing 200 lines of near-duplicate RTL here would be less accurate than pointing at the file the implementer must match. Two assertions are marked "adjust after one run" because they depend on a rendering detail not worth pinning blind: the Radix slider's rendered `max` attribute (Task 10) and the openapi enum's exact text form (Task 4). Every testid, field name, error code, function signature and line number in this revision was read from the tree at `3065c91`, not guessed.

**3. Type consistency.** `solve_delivery` / `_effective_delivery_costs(cost, dist, inp)` / `_build_delivery_problem(ec, p)` / `_assign_band_or_overflow` / `DELIV_DISTANCES` / `DELIV_COSTS` / `DELIV_CUSTOMERS` are declared once in Task 3 and consumed under the same names in its tests and in Task 1's `test_datasets.py` case. `deliveryInputsSchema` / `DeliveryInputs` are declared in Task 4 and consumed in Tasks 6 and 10. `DELIVERY_WAREHOUSES` / `DELIVERY_CUSTOMERS` / `DELIVERY_LANE_KEYS` are declared in Task 5 and consumed in Tasks 6, 7 and 12. `getReferenceCosts` / `buildDeliveryReferenceCostsFrom` are declared and consumed within Task 7. The tab entity id is `deliveryCosts` and its root testid `delivery-costs-tab` in Tasks 8 and 11 consistently. `PrecheckError` codes used are all members of the closed union.

**Two defects earlier revisions caught and fixed rather than noted.** (Rev 1) A `deliveryLaneKeySet()` helper in Task 7 consumed by Task 6 — a task depending on a later one; moved to `DELIVERY_LANE_KEYS` in Task 5. (Rev 2) The full Review record below: 9 blocking, 17 should-fix, 12 nits, every one folded into its task body above.

**Open risk to watch at review:** Task 10 is the only task built on a tree other than `3065c91` — it waits for `ch4-2s-7-work` to merge and then locates every edit by JSX anchor. If both land in either order the JSX merges clean, but the `OptimizationParametersField` union and the props interface conflict and must be reconciled by hand — not relocated. Task 0 Step 2 records the state; Task 13 Step 5's `"delivery-teaching-us"` probe is the backstop for any Workspace gate this revision still missed.

---

## Review record (2026-09-28, Rev 1)

**Status: every row below was folded into the task bodies above on 2026-09-28 (Rev 2).** The dispositions are kept as written for the audit trail; they describe what Rev 2 did, not what remains. R4 (claims that held), R6 (dependency-check methods) and R7 (registration inventory) stay live references — Task 0 Step 3 and Task 13 Step 5 point at R7.

**Method.** Every claim the plan makes about the repository was traced against the tree at `3065c91` (main, clean) by six independent read-only passes: solver (`solve.py` + tests), api-server TS, `lib/*` + OpenAPI, Studio + e2e, git/sources/Chapter-4 status, and a spec-vs-plan coverage cross-check. Findings are grouped by severity; each carries a disposition. "Fold" means: rewrite the named task step in place for Rev 2.

**Base facts re-established (do not re-derive):** `1761260` (Ch4 migration merge) is an ancestor of HEAD. All three `~/Downloads` source hashes match the plan exactly. Postgres `nos_dev` accepts connections. `pulp` 3.3.2 imports; `pandas` does not. The `~/Downloads` xlsx has six sheets (`Customers`, `Demand`, `Plants`, `Trans Costs`, `Distance Matrix`, `Outputs Needed`); customer ids are exactly `1..313`; all 33 plant ids also appear as customer ids and the matrix stores `0` for each of those 33 self-lanes; plant ids are `1,2,3,4,6,7,8,9,11,12,14,15,16,17,19,22,25,27,28,35,38,39,43,44,45,52,55,57,60,66,99,116,152`.

### R1. Blocking — the implementer builds wrong code or a red test

| # | Task | Finding | Evidence | Disposition |
|---|---|---|---|---|
| B1 | 10, 0 | **The Chapter 4 two-step plan is ~60 % implemented, not plan-only.** Tasks 1–6 are committed on `ch4-2s-7-work` (`14c5e8f`…`63e16d5`, not merged to main); Task 7 is in progress, uncommitted, in the locked worktree `.worktrees/ch4-two-step`, where `OptimizationParametersTab.tsx` already carries `step?: 1 \| 2`, `stepEditable`, `step2Gap`, `step2TimeLimitSec` plus new `StepToggle.tsx` / `FreezeConfirmDialog.tsx`. Every line number in Task 10 (`:10-30`, `:32-133`, `:235-359`, `:438`) is main-only. Also on main, `:438` is where the `bomRatio` block **opens** (it ends ~`:455`); "insert immediately after `:438`" lands inside it. | `git log --all -- artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`; `git worktree list`; `OptimizationParametersTab.tsx:438` | Fold: Task 0 Step 2 gains a second ancestry guard on the Ch4 merge SHA; Task 10 is blocked until then and every line number is re-captured against that tree. Insert point becomes "after the `bomRatio` block closes". |
| B2 | 3 | **`test_cost_override_does_not_move_distance_metrics` picks a zero lane.** `assignments[0]` is customer `C1` (Los Angeles), co-located with `W1`, distance 0, base cost 0. Overriding to `0.0` changes nothing, so `assert over["objective"] < base["objective"]` fails. | xlsx `Distance Matrix` row plant 1 → customer 1 = 0; `W1` is open in Scenario 1 | Fold: pick `next(a for a in assignments if a["distanceMi"] > 0)`; assert `over["objective"] == base["objective"] - d*demand` to within rounding rather than bare `<`. |
| B3 | 3 | **`cbc.runTimeSec` does not exist.** `_run_cbc(prob, gap, time_limit, *, problem_uid=None, msg=False)` returns `CBCCaptureResult` with slots `solutionStatus, terminationReason, achievedGap, solverIncumbentObjective, solverBestBound, lpStatus` only. Every solver times itself (`start = time.time()` … `run_time = time.time() - start`). The snippet also drops `quality=cbc.lpStatus`, never forwards the four evidence kwargs (`termination_reason`, `achieved_gap`, `solver_incumbent_objective`, `solver_best_bound`), and omits the non-optimal handling at `solve.py:1440-1446` (`_failureReason="solver_error"`, `_failureStage="cbc_parse"`), so a timeout or CBC parse failure would be published as a success. `status_str = "optimal" if … else cbc.solutionStatus` is a tautology. | `solve.py:192`, `cbc_termination.py:463-469`, `solve.py:231-250`, `solve.py:1440-1446` | Fold: copy `solve_max_coverage`'s timing + status + evidence-forwarding block verbatim; delete `status_str`. |
| B4 | 3 | **`UnresolvableIdError` lives in `merge_inputs.py:31`, not `solve.py`.** The snippet raises it without importing it. The test module also lacks the `sys.path.insert(0, …parent); sys.path.insert(0, …parent.parent)` bootstrap every sibling test uses — there is no `conftest.py`, `pytest.ini`, or `pyproject.toml` anywhere in the repo — so `from solve import …` fails at collection. | `merge_inputs.py:31`; `tests/test_max_coverage.py:22-24`; `find . -name conftest.py` → none | Fold: `from merge_inputs import UnresolvableIdError` in `solve.py`; add the bootstrap header to `test_delivery.py`. Note that the error surfaces on fd3 as `internal_error`/`solve_exception` (`solve.py:1549-1552`), which is exactly why Task 6 exists. |
| B5 | 3, 12 | **The Overflow row is never emitted, and the test named for it cannot fail.** Global Constraints and spec §5.6/§5.7/§8.2/§10 require an explicit Overflow row in `metrics.bandCoverage`. `solve_delivery` builds `band_coverage` as a comprehension over `distance_bands` only. `test_overflow_band_is_emitted` asserts `total < 100.0`, which is true whether or not a row exists. Repo has two conventions: p-median/transport/brazil emit cumulative rows with **no** overflow row; gold/jade emit `{"band": -1, …}` (`OVERFLOW_BAND`) exclusively. The client-side `computeCumulativeBandCoverage` appends an overflow row only when `overflowFlow > 0`. | `solve.py:485, 657, 849-851, 1056-1060, 1335-1340`; `lib/units/src/bands.ts:48-50` | Fold: emit cumulative rows **plus** `{"band": -1, "percent": round(overflow*100/total, 2)}` whenever overflow demand > 0 (matches the client helper's semantics); rewrite the test to assert a `band == -1` row exists for `[100, 200]` and is absent for the default bands. |
| B6 | 6 | **The precheck error codes and field do not exist.** `PrecheckErrorCode` is a closed union at `precheck.ts:76` — `"completeness" \| "id_collision" \| "reference_integrity" \| "p_range" \| "capacity" \| "zero_demand" \| "no_feasible_route" \| "coverage_floor_infeasible"`; `PrecheckError` is `{ code; message }` (`:86`), no `entityId`. The snippet's `unknown_warehouse` / `unknown_customer` / `unknown_lane` + `entityId` do not typecheck. Also missing vs spec §6.2.1 / Gate D: duplicate-pair and finite/negative cost checks, and a route-level test that a bad override yields **422** (`scenarios.ts:533-534`) rather than a worker `internal_error`. | `precheck.ts:76-91`; `jobRunner.ts:380-382`; `scenarios.ts:533` | Fold: use `reference_integrity` with the id in the message; add duplicate + domain checks; add one supertest case through `POST /scenarios/:id/solve` asserting 422. |
| B7 | 4 | **`validation/inputs/index.ts` is not a schema barrel.** It is a 10-line delegator exporting only `ValidateInputsResult` and `validateInputsForModel`. Every consumer imports `./pMedian.js`, `./maxCoverage.js` directly. Step 3's "re-export it from index.ts alongside the others" has no "others". | `validation/inputs/index.ts:1-10` | Fold: delete the re-export sentence; `modelRegistry.ts` imports `./delivery.js`'s schema directly like its siblings. |
| B8 | 12 | **`buildEffectiveFacilityCityLookup` returns a `Map`, not an object.** Signature is `(modelId: string, inputs: { addedWarehouses?; addedRefineries? }): Map<string, string>` with a ternary chain and an empty-map fallback. `lookup["W1"]` is always `undefined`, so the test is red against a correct implementation. | `templates.ts:1388-1402` | Fold: `lookup.get("W1")`. |
| B9 | 1 | **The extractor reads cells positionally and drops ZIP leading zeros.** `sheet_rows` returns `[cell_value(c) for c in row.findall("m:c")]`; xlsx omits empty `<c>` elements, so any blank cell shifts every later column silently (the sheets carry `Name`, `Active`, `Status`, `Country or Region` beyond the plan's list). Spec §4.3 requires ZIPs as strings preserving `02101`-class zeros; `cell_value` returns raw `<v>` text and nothing asserts it. | xlsx headers (Customers: `ID, Name, Active, City, State, Zip Code, Country or Region, Latitude, Longitude`; Plants add `Status`; Demand: `Customer ID, Customer, Product ID, Product, Time Period ID, Time Period, Demand`; Distance Matrix: `Plant ID, Plant, Customer ID, Customer, Distance`) | Fold: key cells by the column letter in each `<c r="…">`, look up header→letter once; zero-pad ZIP to 5 when the cell is numeric; add a Step 5 assertion on ZIP string-ness and on lat/lng ranges (spec Gate B). |

### R2. Should-fix — silent wrong behaviour, dead test, or stale premise

| # | Task | Finding | Evidence | Disposition |
|---|---|---|---|---|
| S1 | 8, 9, 11 | **`Workspace.tsx` has 12+ further `modelId ===` gates the plan never lists.** `isEditableInputTab` (`:2140-2200`) is an allow-list of `(entity, modelId)` pairs — with no `deliveryCosts` row the tab is not editable, so no Save/dirty path; Save-suppression rows (`:2211-2226`); reference-distances query `enabled` allow-list (`:1426`); input-map mode dispatch (`:2929/2954/2974`); OutputMap (`:3555-3614`); open-warehouses (`:3661-3686`); customer-assignments (`:3699`); flows (`:3747-3793`); `DistancesTab` `locationById` (`:3382`); `enableFilters` (`:3066`, `:3686`). These are `===` chains, not exhaustive switches — Task 8 Step 6's "typecheck will surface every remaining switch" is false for all of them. | `Workspace.tsx` lines cited | Fold: enumerate each gate as its own sub-step in Tasks 8/9/11 with a test; add them to the R7 inventory. |
| S2 | 10 | **`pMax` premise is stale.** It is already passed at both mounts: `Workspace.tsx:3320` (`modelId === "two-echelon-jade-us" ? jadeActiveWarehouseCount(...) : modelId === "max-coverage-us" ? 26 : undefined`) and `:4037` (`modelId === "max-coverage-us" ? 26 : undefined`). The action is to add a `33` arm to both ternaries, not "pass pMax". `pMax = 50` defaults at `OptimizationParametersTab.tsx:151` and `SolveDialog.tsx:156` are correct. | cited lines | Fold Task 10 Step 5. |
| S3 | 9, 10 | **Three plan-referenced handles are fictional.** `input-p` does not exist — P is a `<Slider>` with `data-testid="slider-p-value"` (`:205`), `max={pMax}` (`:201`), and quick-picks `button-p-quick-${n}` filtered by `n <= pMax` (`:209-213`). `input-map` does not exist — the root is `input-map-tab` (`InputMapTab.tsx:817`). `InputMapTab` has no `readOnly` prop today (read-only is expressed via `demandEditable` + omitting `onSave`). Real mutation testids: `button-input-map-place-wh`/`-cs` (`:833,836`), `map-add-menu(-wh/-cs/-pl)` (`:368-379`), `map-action-edit/-move/-copy/-delete` (`map/MapActionMenu.tsx`), `edit-warehouse-status*`, `edit-customer-status*`, `create-entity-status`, `edit-customer-demand-input/-slider`, `create-entity-demand`, `button-save` (`:868`). lat/lng are read-only `<p>` text, not inputs. `SolveDialog` is at `components/workspace/SolveDialog.tsx` (no `dialogs/`). | cited lines | Fold Task 9 Step 1 testid list and Task 10 `caps the P slider` test (assert `slider-p-value` `max` and that `button-p-quick-25` renders while nothing above 33 does). |
| S4 | 8, 13 | **`Landing.test.tsx:388` asserts `"3 labs · 3 scenarios · 1 solved"`.** Goes red the moment the chapter is visible. Not listed in any task. `App.test.tsx:132,141,149` enumerates hidden paths — unaffected since delivery is visible. `lockedChapterDrift.test.ts` pins the locked set to `["two-echelon-jade-us"]` — unaffected. | `Landing.test.tsx:388` | Fold into Task 8 Step 6: update to `4 labs`. |
| S5 | 4 | **`registration.test.ts` has source-text gates per model** at `:222-238` (asserts the `pmedian.ts` branch, the `solve.py` `model_type == '…'` string, and the openapi enum entry via `readFileSync`). Task 4 lists only `SOLVABLE`, stubs, and the count (`toHaveLength(6)` at `:98`). | `registration.test.ts:98, 118-134, 222-238` | Fold Task 4 Step 4: extend all three gates for `delivery` / `model_type == 'delivery'`. |
| S6 | 2 | **`lib/dataset-schema/src/index.test.ts` is hand-written per model, not a loop.** Gold `:4`, jade `:33`, max-coverage `:64` each have a `validatePackage(spec)` + `computeSha256 == readVersion().sha256` block. A 7th model gets zero package validation and zero sha coverage unless a block is added. Same for `maxCoverageDataset.test.ts:40`'s version check pattern on the api-server side. | `index.test.ts` | Fold into Task 2 Step 1 (new block) and Task 5 (a `deliveryDataset.test.ts` mirroring `maxCoverageDataset.test.ts`). |
| S7 | 1, 3 | **`test_datasets.py` delivery case is absent** (spec §8.2: 33/313/10,329 in both files, no missing pair, files agree at seed). The only shape guard over 10,329 transcribed lanes is the extractor's `--check`. | `tests/test_datasets.py` | Fold into Task 3 Step 1 as a second test file addition. |
| S8 | 4, 7 | **`ModelInfoCapabilities` is not a named OpenAPI schema.** Capabilities is an inline object under `ModelInfo` (`openapi.yaml:932-957`) with `required: [supportsP, capacityModes, demandEditable, outputGrids, supportsFacilityStatus, supportsReferenceDistances, supportsAddedCustomerExclusion]` (`:958`). `outputGrids` is `array of string`, no enum, in both Zod (`z.array(z.string())`) and OpenAPI. The four `modelId` enum sites are `:47`, `:166-172`, `:1417-1424`, `:1618-1625`; `Scenario.inputs` / `ScenarioInput.inputs` / `ScenarioUpdate.inputs` are bare `type: object` (no per-model oneOf), and `ModelInfo.id` has no enum — good news, nothing else to add. | cited lines | Fold Task 4 Step 5 wording; decide whether `supportsReferenceCosts` joins `required` (recommend yes, since the registry always emits it). |
| S9 | 13 | **`e2e_journey.py` dispatches via a `JOURNEYS` dict** (`:620-626`: auth/dataset/pmedian/transport/brazil). `python3 e2e_journey.py http://localhost:3000 delivery` parses (`argv[1]` URL, `argv[2]` section) but exits 1 with `Unknown section` until an entry is added. | `e2e_journey.py:55-57, 620-643` | Fold Task 13 Step 2: "add `delivery` to `JOURNEYS`". |
| S10 | 12 | **`ServiceStatsTab` imports `computeCumulativeBandCoverage` from the studio shim `@/lib/bands`**, not `@workspace/units`; live recompute (`useLiveCoverage`, `:242, :288-290`) drives the displayed percentages whenever Workspace passes `presentationBands`, and the envelope's `metrics.bandCoverage` is only the fallback. The `decimals` option must be threaded through `artifacts/studio/src/lib/bands.ts:25-37`. Envelope precision therefore matters for exports and Solution Summary, not for the Service Stats bars. | `ServiceStatsTab.tsx:6, 242, 288-290`; `studio/src/lib/bands.ts` | Fold Task 12 Steps 3/5. |
| S11 | 12, 13 | **`services/import.ts` and the `scenarios.ts` export/import gates are unlisted registration points.** `import.ts:476, 509, 553-568, 633, 918` (five modelId ternaries incl. the `entity === "customers"` allowlist); `scenarios.ts:906-926` export entity gate and `:931/:1005/:1094/:1206` export builders; `:1602-1622`, `:1670-1690` import gates; `normalizeAddedEntityDistances` `:451-484`. Task 12 Step 7 says output exports are in scope but never touches the export gate. | cited lines | Fold: trace each for the delivery model; record in R7 which are N/A (no importable entities) vs required (output grid exports). |
| S12 | 3, 7, 12 | **Spec-mapped tests missing.** `test_single_source` lacks the `flow == demand` half (§8.2). `referenceCosts.test.ts` promises "malformed" in the File Structure table but has no malformed-source case. No manifest-vs-Zod parity test in `deliveryContract.test.ts` though spec §6.1 says that file keeps them in step. No test that Solution Summary shows Objective + WAD and no "Open facilities" row, that Service Stats hosts the bands, or that the Output Map draws lines (decision 10, §7.6). `formatObjective`/`ObjectiveBar` rendering (monetary vs demand-distance) untested; only `objectiveDimension` is. No `_LOAD_ERRORS` / `_load_error_envelope` path test (§5.8). | spec §8, §7.6, §5.8 | Fold: one named test per item into Tasks 3/7/8/12. |
| S13 | 1 | **Prototype reproducibility rework (§4.3 / §12.5) has no task.** `docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py` (76 lines) hardcodes `~/Downloads` and `/tmp/ch5x/`; Task 3's docstring cites it as the independent oracle. Its formulation is `<= P`, per-pair linking, cost derived from distance at solve time — consistent with `solve_delivery`. | asset file | Fold: add Task 1 Step 9 (take `--xlsx`, verify SHA, write only requested dirs) or explicitly waive in the plan with a reason. |
| S14 | 8 | **`Workspace.TabCoverage.test.tsx` and `lib/units/src/__tests__/objective.test.ts` ("the six-model contract") are per-model enumerations.** Neither is listed. `inputEntriesForModel` is module-private today (`:1184`) — the plan already anticipates exporting it. | `Workspace.TabCoverage.test.tsx:656-731`; `objective.test.ts:4` | Fold: add a delivery `describe` to each in Task 8. |
| S15 | 0 | **Task 0 Step 3's command is invalid.** `rg --type tsx` — `tsx` is not an rg type; the step errors out instead of producing the audit list. Step 5's baseline omits `e2e_journey.py` and `pnpm e2e:gate`, so Task 13 Step 5's "diff against the baseline" has no baseline for them. | `rg --type-list` | Fold: use `--glob '*.{ts,tsx,py}'`; add both commands to Step 5. |
| S16 | 5, 7 | **Two root-resolution conventions.** `maxCoverageDataset.ts:13` reimplements `findRepoRoot` (Task 5 copies it); `referenceDistances.ts:3` imports `SOLVERS_ROOT` from `@workspace/dataset-schema` (Task 7 copies that). Both work; the plan should say why it keeps both rather than leave an implementer to "tidy" one. | cited lines | Fold: one sentence in Task 7 Step 3. |
| S17 | 13 | **Docs targets are off or incomplete.** CHANGELOG refs are `:412` (`"2 labs"` stale specs) and `:449` (`"Chapter 5 — nothing to commit"`), not 411/448. `model-integration-precheck.md` has **10** numbered points today (`:37-83`); none of `inputEntriesForModel`, `pMax`, `routes/index.ts`, `buildEffectiveFacilityCityLookup`, or the precheck dispatcher appears. Spec §12.4.4 also names the CLAUDE.md model table ("Six models live under `solvers/`"); Task 13 lists only `CLAUDE.md:139`. | cited lines | Fold Task 13 Step 6. |

### R3. Nits — reference rot inside the plan

| # | Finding | Disposition |
|---|---|---|
| N1 | Plan-resolution table rows 1, 5, 6 cite "Task 9", "Task 8", "Task 8"; the real tasks are 8, 7, 7. Line "Domain validation lives in Task 8's reference-cost builder" (Task 2 Step 5) → Task 7. | Fold. |
| N2 | Task 3 Interfaces declares `_build_delivery_problem(warehouses, customers, demand, ec, p)`; the code and both call sites use `(ec, p)`. | Fold to `(ec, p)`. |
| N3 | Task 5 Interfaces omits `DELIVERY_LANE_KEYS`, which the code exports and Tasks 6/7 consume by name. | Fold. |
| N4 | Task 9 Step 1 appends a `describe` using `render`, `screen`, `InputMapTab` to a file whose Task 8 imports include none of them. | Fold: add the import step. |
| N5 | `ServiceStatsTab.tsx` is edited (Task 12 Step 5) and committed (Step 8) but appears in neither the Modified-files table nor Task 12's Files list. The Modified table also omits `validation/inputs/index.ts` (now moot, B7), `__tests__/precheck.test.ts`, `__tests__/templates.test.ts`, `lib/units/src/bands.test.ts`, `__tests__/OptimizationParametersTab.test.tsx`, `lib/dataset-schema/src/manifest.test.ts`, `e2e/bundle4-auth-landing.spec.ts`, `e2e/bundle6-ui-tweaks.spec.ts`. | Fold: regenerate the table from the union of every task's Files list. |
| N6 | Global Constraints say "Do not import across packages to satisfy a test", yet Task 8's studio test imports `objectiveDimension` from `@workspace/units`. Workspace-package imports are normal; the rule was about relative paths into a sibling package's `src/`. | Fold: reword the constraint. |
| N7 | Task 13 Step 4 runs `e2e_journey.py http://localhost:3000 delivery`; spec §12.9 runs `e2e_journey.py delivery`. Both parse; pick one. | Fold. |
| N8 | `registration.test.ts` line references in Task 4 are absent; `modelRegistry.ts` capability interface is `PublicModelInfo.capabilities` at `:69-80` (inline intersection), mapping at `:103`; `solve.py` dispatcher is at `:1477-1494`, loaders at `:73-176`. | Fold line refs. |
| N9 | Manifest `laneCostOverrides.cost` is `minimum: 0` in the plan and `exclusiveMinimum: 0` in spec §6.1; spec §7.4 also says "positive cost". The plan is right (§6.2/§12.3.4, 33 zero self-lanes) but the spec contradiction is unflagged. | Fold: note it; correct the spec in the same commit as Rev 2. |
| N10 | Task 11 test mocks pagination at 120 pairs; spec §8.4 says "pagination works at 10,329 rows". A 120-row mock proves paging, not the render cost at 10,329 — add one render-time assertion or state the waiver. | Fold. |
| N11 | `test_delivery.py` docstring comment for `assignments[].distanceMi`/`band` — field names are plan inventions (spec defines no assignment shape). They match `solve_pmedian`'s `{customerId, warehouseId, distanceMi, band}` (`solve.py:475-476`), which is the right choice; say so and pin it with a test. | Fold. |
| N12 | Self-Review §1 says Decision 10 → "Tasks 3/12" but Task 12 has nothing about the Summary/Service-Stats split beyond band precision. | Resolved by S12. |

### R4. Claims that held (so Rev 2 need not re-trace them)

`KNOWN_SCHEMAS` `:19`; `VALID_MODEL_IDS` `:92`; `SolveInput` `:8` and the unguarded p-median fallthrough at `pmedian.ts:173`; `runNetworkEditsPrecheckForModel` `:1368` with silent `ok:true` at `:1387`; `routes/dataset.ts` if-chain with 400 fallthrough at `:59`; `routes/index.ts:19-27` mounts every router incl. `referenceDistances` at `:23`; `referenceDistances.ts` registry/ETag/304/422 shape (unknown id and no-capability both 422; unauthenticated); `WarehouseCandidate`/`Customer` types incl. optional `zip` and required `demand`; `lib/db/src/index.ts:7-11` throws without `DATABASE_URL`; `scenarios.model_id` is plain `text`; `DistanceMap` `:23`; `PACKAGE_SPECS` `:115` (max-coverage entry `:160-167`); `MODEL_IDS` `:269`; `computeSha256(spec)` hashes sorted filenames; `readManifest`/`readVersion`/`SOLVERS_ROOT` exports; `computeCumulativeBandCoverage` `:37-52` with `OVERFLOW_BAND = -1`; `objectiveDimension(modelId, objectiveMode)` `:20` with `default: "opaque"`; `objectiveModeOfDetails` reads `details.objective` as a free string (so `"cost_adjusted"`/`"base"` work); `codegen` script is `orval --config ./orval.config.ts && pnpm -w run typecheck:libs`; `e2e:gate`/`e2e:quarantine`/`typecheck` root scripts; `StudioModelType` union on `chapters.ts:1`; `Chapter` interface with required `labHeaderTitle`/`labHeaderSubtitle`; `App.tsx:63-86` iterates `CHAPTERS` (no route edit needed); both Ch5 entries `hiddenFromLanding: true`; `defaultInputsForModel` exported at `:125`; `inputEntriesForModel` tail `case "p-median-brazil": case "p-median-us": default:` at `:1222-1231`; `OpenWarehousesTab.tsx:158-160` empty-vs-absent `capacityModes` gate; `DistancesTab` `PAGE_SIZE = 50` (`:330`), `fromFilter`/`toFilter`, `useDistanceDraft`, `useGetReferenceDistances`; all seven named studio test files exist; 15 studio tests already import `@/pages/Workspace`; `bundle4-auth-landing.spec.ts:120,153-154,183-184,212-213` and `bundle6-ui-tweaks.spec.ts:270-271` assert `"2 labs"` (stale today; their `auth-labs-strip` expectations also contradict each other); no Compare page exists (multi-scenario compare is `CostSummaryTab.tsx:444`); no analytics model-id enum; `README.md:155,171` "six models"; `CLAUDE.md:139` "fully non-runnable"; `e2e_journey.py:201,235,239` auth lines; `attached_assets/NOTEBOOKS.md:16,104-109`; `.claude/glm-delegation-disabled.md` exists; all eight PuLP names in the snippet are already imported (`solve.py:24-26`); `solve.py:404-405` uses `LpConstraintEQ` for p-median.

### R5. Closeout strategy

Overkill check: no new tooling. Fold in place, re-verify with the same probe. There is no simpler alternative that leaves the plan executable.

1. **Sequence.** Chapter 5 branches off `main` **after** `ch4-2s-7-work` merges. Task 0 Step 2 gains `git merge-base --is-ancestor <ch4-merge-sha> HEAD`. Task 10 is blocked until then; Tasks 1–9 and 11–12 are not (their files do not overlap the Ch4 branch — true overlap is `Workspace.tsx`, `OptimizationParametersTab.tsx`, `SolveDialog.tsx`, `openapi.yaml`, `solve.py`, `CLAUDE.md`; **not** `objective.ts`, `bands.ts`, `chapters.ts`, `precheck.ts`, `templates.ts`, `model-integration-precheck.md` as the closing note feared).
2. **Fold, Rev 2.** Every B/S/N row is rewritten into its task body in place — no errata layer. The Modified-files table is regenerated from the union of every task's Files list. Missing tests become named steps: `test_datasets.py` case, `index.test.ts` block, `deliveryDataset.test.ts`, `Landing.test.tsx` 4-labs, `TabCoverage` block, `objective.test.ts` row, `registration.test.ts` source gates, `JOURNEYS` entry, `referenceCosts` malformed case, `flow == demand`, manifest-vs-Zod parity, Summary/Service-Stats/Output-Map placement, route-level 422.
3. **Registration inventory as a table (R7), not prose.** Spec §13.1 promised Gates A–G and a review matrix; the plan carries neither. R7 is the matrix: point → verified `file:line` → task → test that fails if missed → silent or loud.
4. **Resolve the two spec contradictions explicitly** in the plan body and correct the spec in the same commit: Overflow row emitted by the solver (yes, `band: -1` when overflow > 0); `laneCostOverrides.cost` `minimum: 0` (spec §6.1 snippet and §7.4 "positive" are wrong).
5. **Re-run the six-lens verification on Rev 2** before declaring ready. A claim checked at Rev 1 is not checked at Rev 2.

### R6. Dependency-check methods

- **Probe sweep by newest sibling.** Every registration point contains the literal `"max-coverage-us"`. Committed into Task 0 with its expected hit list; re-run at Task 13; any hit outside R7 is a finding:
  ```bash
  rg -n --glob '!**/generated/**' --glob '!**/*.test.*' --glob '!**/__tests__/**' --glob '!e2e/**' \
     '"max-coverage-us"' artifacts lib solvers scripts
  ```
  Against `3065c91` this surfaces `services/import.ts`, `data/referenceDistances.ts`, `lib/units/src/objective.ts`, and the Workspace gates in S1 — none of which the Rev 1 inventory carried.
- **Set-equality test** (spec §9 recommends it; Rev 1 dropped it). One api-server test asserting `MODEL_IDS == keys(KNOWN_SCHEMAS) == VALID_MODEL_IDS == PACKAGE_SPECS ids == openapi enum (×4, via readFileSync) == CHAPTERS modelIds (via readFileSync of chapters.ts)`. Kills the "registered in four of six places" class permanently.
- **Silent-fallback inventory.** Six places swallow an unknown model rather than fail: `pmedian.ts:173` (p-median payload), `precheck.ts:1387` (`ok:true`), `templates.ts:1402` (empty map), `objective.ts` default (`opaque`), `inputEntriesForModel` default (p-median tab set), `isEditableInputTab` (not editable). Each gets a dedicated negative test in Rev 2. Optional follow-up outside this plan: make the `switch (modelId: StudioModelType)` sites exhaustive with `assertNever` so typecheck catches the eighth model.
- **Per-task compile gate.** After each commit: `pnpm run typecheck` plus that task's test file only. Interface tables already exist per task; a task's test may import only names an earlier task produced.
- **Cross-branch overlap before Task 10.** `git diff --name-only main...ch4-2s-7-work` intersected with the plan's Modified-files list is the true conflict set; recompute after the Ch4 merge.
- **Spec-to-plan trace on Rev 2.** Repeat the decision-by-decision and §9 point-by-point cross-check; on Rev 1 it found eight unmapped spec sections.

### R7. Verified registration inventory (at `3065c91`)

| # | Point | File:line | Task | Fails how if missed | Test that catches it |
|---|---|---|---|---|---|
| 1 | Manifest | `solvers/delivery-teaching-us/manifest.json` | 2 | loud (`readManifest` throws) | `manifest.test.ts` |
| 2 | `version.json` | same dir | 2 | loud (`readVersion` throws) | `index.test.ts` block (S6) |
| 3 | Zod schema + `KNOWN_SCHEMAS` | `modelRegistry.ts:19` | 4 | loud (422 on PATCH) | `registration.test.ts` |
| 4 | `VALID_MODEL_IDS` | `routes/scenarios.ts:92` (enforced `:225`) | 4 | loud (422 on create) | `registration.test.ts` |
| 5 | `PACKAGE_SPECS` | `dataset-schema/src/index.ts:115` | 2 | loud | `index.test.ts` block |
| 6 | `SolveInput` + `buildPayload` | `pmedian.ts:8`, `:173` fallthrough | 4 | **silent** (p-median payload) | `deliveryContract.test.ts` "never emits p_median" |
| 7 | OpenAPI enums ×4 + capability + path | `openapi.yaml:47, 166-172, 1417-1424, 1618-1625, 932-958` | 4, 7 | loud (Zod client rejects) | `registration.test.ts:222-238` gate |
| 8 | Solver dispatcher | `solve.py:1477-1494` | 3 | loud (fd3 dispatch failure) | `test_delivery.py` + registration source gate |
| 9 | `MODEL_IDS` | `dataset-schema/src/index.ts:269` | 2 | loud | `manifest.test.ts:274-280` loop |
| 10 | `objectiveDimension` | `lib/units/src/objective.ts:20` | 8 | **silent** (`opaque`) | `deliveryRegistration.test.tsx` + `objective.test.ts` row |
| 11 | `inputEntriesForModel` explicit case | `Workspace.tsx:1184` (tail `:1222-1231`) | 8 | **silent** (p-median tabs) | `deliveryRegistration.test.tsx` |
| 12 | `defaultInputsForModel` | `Workspace.tsx:125` | 8 | loud (TS exhaustiveness) | same |
| 13 | `CHAPTERS` + `StudioModelType` | `chapters.ts:1`, entries | 8 | loud | `chapters.test.ts`, `Landing.test.tsx:388` (S4) |
| 14 | Precheck dispatcher | `precheck.ts:1368-1387` | 6 | **silent** (`ok:true`) | `precheck.test.ts` + route-level 422 (B6) |
| 15 | Router mount | `routes/index.ts:19-27` | 7 | **silent** (404) | `referenceCosts.test.ts` "reachable" |
| 16 | `buildEffectiveFacilityCityLookup` | `templates.ts:1388-1402` | 12 | **silent** (blank city column) | `templates.test.ts` (B8) |
| 17 | `pMax` both mounts | `Workspace.tsx:3320`, `:4037` | 10 | **silent** (slider offers 50, API 422s) | `OptimizationParametersTab.test.tsx`, `SolveDialog.test.tsx` |
| 18 | `registration.test.ts` SOLVABLE/stubs/count/source gates | `:25, :98, :118, :222-238` | 4 | loud | itself |
| 19 | `routes/dataset.ts` branch | `:14-59` | 5 | loud (400) | `deliveryContract.test.ts` |
| 20 | `isEditableInputTab` allow-list | `Workspace.tsx:2140-2200` | 11 | **silent** (no Save) | new (S1) |
| 21 | Save-suppression rows | `Workspace.tsx:2211-2226` | 9 | silent | new (S1) |
| 22 | Reference-distances query allow-list | `Workspace.tsx:1426` | 11 | n/a for delivery (no distances) | note only |
| 23 | Input-map mode dispatch + read-only | `Workspace.tsx:2929-3004` | 9 | silent (editable map) | `deliveryRegistration.test.tsx` map block |
| 24 | OutputMap / open-warehouses / assignments / flows gates | `Workspace.tsx:3555-3614, 3661-3699, 3747-3793` | 12 | silent (empty output tabs) | `TabCoverage` block (S14) |
| 25 | `services/import.ts` ternaries | `:476, 509, 553-568, 633, 918` | 13 (audit) | n/a (no importable entities) — must be *recorded* as N/A | R7 row |
| 26 | `scenarios.ts` export gate + builders | `:906-926, 931-1206` | 12 | loud or silent per grid — trace | export test (S11) |
| 27 | `e2e_journey.py` `JOURNEYS` | `:620-626` | 13 | loud (exit 1) | itself |
| 28 | Studio band shim `decimals` passthrough | `studio/src/lib/bands.ts:25-37` | 12 | silent (integer %) | `ServiceStatsTab.test.tsx` |
| 29 | `index.test.ts` / `deliveryDataset.test.ts` / `test_datasets.py` | per-model blocks | 2, 5, 3 | silent (zero coverage) | themselves |
| 30 | `Landing.test.tsx:388`, `bundle4`/`bundle6` e2e lab counts | cited | 8, 13 | loud (red suite) | themselves |

Rows 1–18 correspond to spec §9 (renumbered to match this plan's task order); rows 19–30 are the points this review added.
