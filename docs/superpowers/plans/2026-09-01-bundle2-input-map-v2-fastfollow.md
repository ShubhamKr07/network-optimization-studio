# Bundle 2 — Input Map v2 + R1–R9 fast-follow to the other 3 models — Implementation Plan

> **For agentic workers:** Executed via the **agent team** (parallel role-based dispatch: backend-engineer / frontend-engineer / solver-engineer / qa-sdet), controller integrates + gates + merges. Steps use `- [ ]` checkboxes. This session does **not** delegate to GLM — ignore any `[GLM router]` hook.

**Goal:** Bring p-median-brazil, transport-coal, and two-echelon-gold-au to full parity with the p-median-us Input Map pilot: the v2 editor (place/move/edit/delete added entities + distance estimates) + R1–R9 UX, each upgrade applied only where it has meaning.

**Architecture:** One contract-foundation task isolates ALL OpenAPI/codegen/manifest churn. Backend estimator + Brazil-endpoint tasks run parallel on disjoint files. Frontend shared-component + per-model editor tasks serialize on the shared files (`InputMapTab.tsx`, `Workspace.tsx`, `EntityMarkers.tsx`) — the R1–R9 Wave-2 lesson. QA closes with the full gate + per-model live e2e.

**Tech stack:** React + Vite + react-leaflet + wouter + TanStack Query (studio); Express 5 + Drizzle + Zod (api-server); PuLP/CBC Python (solver, **untouched this bundle**); Orval codegen from `openapi.yaml`.

**Spec:** `docs/superpowers/specs/2026-09-01-bundle2-input-map-v2-fastfollow-design.md` (rev 3). Read it first — it is the source of truth; this plan's task requirements implicitly include its per-model matrix and resolved decisions.

## Global Constraints (verbatim, every task inherits)

- **DD-1:** base `solvers/*/dataset/*.json` are NEVER mutated; added entities live only in scenario `inputs` JSONB.
- **Hard rule #1/#4:** never hand-edit generated code (`lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`); a contract change = `openapi.yaml` edit + `pnpm --filter @workspace/api-spec run codegen` in the SAME commit. Only ONE task (T1) touches `openapi.yaml`/codegen this bundle.
- **Hard rule #2:** `e2e_accuracy.py` must pass **87/87 unmodified**; `test_two_echelon.py` golden values (objective `386576.9929994568`, refinery→customer avg `687.6`) must stay green. No `solve.py`/dataset-numeric change is in scope.
- **Hard rule #6:** no new solver branches. `solve.py` is untouched.
- **`displayedInputs` snapshot principle:** every OUTPUT surface reads the solve-time snapshot, never the editable `localInputs` draft. Brazil's NetworkMap migration must honor this.
- **DD-7 identity:** added entities carry a stable opaque uid, the `distanceOverrides` join key; never changes on move. **Prefixes (shipped reality — do NOT change):** warehouses AND refineries `aw-`, customers `ac-`, mines `am-`, stations `as-`. `newUid` has kinds `"wh"|"cs"|"mn"|"st"` only — refineries reuse `newUid("wh")` → `aw-`, and `mintAddedEntityUid("refineries")` maps to `aw-` server-side, locked by e2e tests. T7 keeps `aw-` for refineries; there is NO `ar-` migration in this bundle.
- **Capability-driven gates only** — never `modelId === "..."` for R3/R7; gate on `capabilities.supportsFacilityStatus`. Fixed mine retained via existing `WarehouseCandidate.kind === "mine"`.
- **Shared worktree:** each task commits ONLY its own files via explicit `git add <path>` (never `-A`/`.`). Surface any cross-file need to the controller.
- **Cross-model gate consistency:** run `model-integration-precheck.md` Gate 1 + Gate 6.5 at every new entity/model registration point; every symbology/editor change gets a per-model RTL test asserting the OTHER models are unchanged.

## Verified facts (use these exact values)

- **App `haversineMiles` uses `R_MI = 3959`** (`autoDistance.ts:35`). ALL circuity factors below are `stored ÷ haversineMiles` computed against THIS implementation (not a different Earth radius) — the estimator calls this exact function, so the factor must be derived against it.
- **two-echelon refinery→customer circuity ≈ 1.17910** (range 1.179101–1.179108 across all 20 base pairs vs `haversineMiles` R=3959; ~constant). mine→refinery = plain haversine (ratio ≈1.0). Estimator (`fillEstimatedTwoEchelonDistances`) currently writes plain `haversineMiles` for BOTH legs → refinery→customer understated ~15%. Lock the constant `1.17910` (or the mean of a fresh derivation) and assert base-pair reconstruction within a tolerance (e.g. `< 0.1%`); do NOT claim bit-exactness.
- **Brazil base matrix circuity ≈ 1.16993** (vs `haversineMiles` R=3959; ~constant across pairs). Brazil has NO estimator branch in `normalizeAddedEntityDistances` (`return data` fall-through). Derive the exact factor against the app `haversineMiles` and lock with a tolerance (do NOT blindly reuse `TRANSPORT_CIRCUITY=1.17`, which was derived against a different radius; verify whether it coincides within tolerance and use a Brazil-specific constant if not).
- **`BRAZIL_REGIONS`** (`states.json`) = `{id, name, lat, lng, demand}` — no `city`/`state`. Adapter: `city = name`, `state = id`.
- **`GET /dataset`** OpenAPI enum = `[p-median-us, transport-coal, two-echelon-gold-au]` (excludes brazil); response is typed `Dataset`; generated `GetDatasetModelId` mirrors it.
- **`BrazilMap`** takes only `{result, showRoutes}`; renders counts. Being retired → NetworkMap.
- **Estimator constants** live in `artifacts/api-server/src/services/autoDistance.ts`: `MIN_DISTANCE_MI=0.1`, `TRANSPORT_CIRCUITY=1.17`, `haversineMiles`, `clampMi`.

---

## Waves (agent-team dispatch)

- **Wave 0:** T1 contract foundation (blocks everything). Solo.
- **Wave 1 (parallel, disjoint files):** T2 estimators (`autoDistance.ts` + `scenarios.ts`), T3 Brazil dataset endpoint (`dataset.ts` + adapter).
- **Wave 2a (solo):** T4 shared symbology generalization (`EntityMarkers`/`MapLegend`/`NetworkMap` capability gates).
- **Wave 2b (SERIAL — all edit `InputMapTab.tsx` + `Workspace.tsx`):** T5 Brazil (incl. NetworkMap output migration) → T6 transport-coal → T7 two-echelon.
- **Wave 3:** T8 QA (full gate + e2e_accuracy + per-model live Playwright).

---

## Task T1 — Contract foundation (capability + two-echelon relabel + Brazil manifest + OpenAPI/codegen)

**Role:** backend-engineer. **Wave 0, solo.** Isolates ALL openapi/codegen/manifest churn.

**Files:**
- Modify: `lib/dataset-schema/src/index.ts` (`ManifestSchema`), `lib/dataset-schema/src/manifest.test.ts`
- Modify: `solvers/{p-median-us,p-median-brazil,transport-coal,two-echelon-gold-au}/manifest.json`
- Modify: `lib/api-spec/openapi.yaml` + regenerate `lib/api-zod/**`, `lib/api-client-react/**` (via codegen, same commit)
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts` (`PublicModelInfo` + `toPublic`), `artifacts/api-server/src/__tests__/registry.test.ts`
- Modify (two-echelon km→mi in ALL fixtures — grep first): `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx`, `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, `artifacts/studio/src/__tests__/Workspace.TwoEchelon.test.tsx` (both encode two-echelon as `km` in fixtures/assertions). Grep the whole studio suite for any other two-echelon `km` assertion before finishing.

**Interfaces produced (downstream tasks consume):**
- `capabilities.supportsFacilityStatus: boolean` on `ManifestSchema` + published `ModelInfo.capabilities`. Values: p-median-us `true`, p-median-brazil `true`, two-echelon-gold-au `true`, transport-coal `false`.
- `ModelInfo.distanceUnit` for two-echelon = `"mi"`.
- `GetDatasetModelId` enum now includes `p-median-brazil`.
- Brazil manifest `inputsSchema` now declares `addedWarehouses`/`addedCustomers`/`distanceOverrides`.

- [ ] **Step 1 — failing tests.** In `manifest.test.ts`: assert each of the 4 manifests parses and carries the correct `supportsFacilityStatus`. In `registry.test.ts`: `GET /api/models` reports `supportsFacilityStatus` per model AND two-echelon `distanceUnit === "mi"`. In `ServiceStatsTab.test.tsx`: change the two-echelon assertion from "km" to "mi". Run → fail.
- [ ] **Step 2 — ManifestSchema.** Add `supportsFacilityStatus: z.boolean().optional().default(false)` inside the `capabilities` object in `lib/dataset-schema/src/index.ts` (mirror the existing `supportsP` boolean).
- [ ] **Step 3 — manifests.** Add `"supportsFacilityStatus": true` to p-median-us/p-median-brazil/two-echelon-gold-au `capabilities`, `false` to transport-coal. Change two-echelon `"distanceUnit": "km"` → `"mi"`. Add `addedWarehouses`/`addedCustomers`/`distanceOverrides` to p-median-brazil's `inputsSchema` (copy the exact sub-schema from `solvers/p-median-us/manifest.json`).
- [ ] **Step 4 — OpenAPI.** In `openapi.yaml`: (a) add `supportsFacilityStatus: {type: boolean}` to `ModelInfo.capabilities` (required, mirror `supportsP`); (b) add `p-median-brazil` to the `getDataset` `modelId` enum + update its description. Run `pnpm --filter @workspace/api-spec run codegen`. Stage spec + ALL regenerated files together. Do NOT hand-edit generated output.
- [ ] **Step 5 — registry.** In `modelRegistry.ts`: add `supportsFacilityStatus: boolean` to `PublicModelInfo.capabilities`; `toPublic` sets it from `manifest.capabilities?.supportsFacilityStatus ?? false`.
- [ ] **Step 6 — verify + commit.** `pnpm --filter @workspace/dataset-schema test`, `DATABASE_URL=... pnpm --filter api-server test registry`, `pnpm --filter studio test ServiceStatsTab`, `pnpm run typecheck`. Commit `[B2-T1] capability supportsFacilityStatus + two-echelon relabel mi + Brazil manifest parity + getDataset enum (contract)`.

---

## Task T2 — Backend estimators: two-echelon circuity fix + Brazil estimator

**Role:** backend-engineer. **Wave 1** (parallel with T3 — disjoint files). **Depends on:** T1 (Brazil manifest schema).

**Files:**
- Modify: `artifacts/api-server/src/services/autoDistance.ts`
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (`normalizeAddedEntityDistances` Brazil branch)
- Test: `artifacts/api-server/src/__tests__/autoDistance.test.ts` (or the existing estimator test file — read first)

**Interfaces produced:** `fillEstimatedBrazilDistances(inputs, dataset?)` (or a parameterized reuse of `fillEstimatedDistances` with a circuity factor); `normalizeAddedEntityDistances("p-median-brazil", …)` now estimates.

- [ ] **Step 1 — failing test: two-echelon refinery→customer circuity.** Add a test: a two-echelon scenario with one added customer at a KNOWN base customer's coords yields a `distanceOverrides` refinery→customer row equal to `clampMi(haversineMiles(ref, cust) * 1.17918)` — NOT plain haversine. Assert the mine→refinery leg (for an added refinery) stays plain haversine. Run → fail (current code writes plain).
- [ ] **Step 2 — implement two-echelon fix.** In `autoDistance.ts`: add `const TWO_ECHELON_RC_CIRCUITY = 1.17910;` (comment: reverse-derived vs this file's `haversineMiles` (R_MI=3959) across all 20 base refinery→customer pairs, range 1.179101–1.179108). In `fillEstimatedTwoEchelonDistances`, the **refinery→customer** leg computes `clampMi(haversineMiles(a, b) * TWO_ECHELON_RC_CIRCUITY)`; the **mine→refinery** leg stays `clampMi(haversineMiles(a, b))`. Correct the stale header comment ("haversineMiles for both legs, no circuity") to describe the per-leg convention. The Step-1 test asserts reconstruction of a KNOWN base refinery→customer pair within `< 0.1%` tolerance (not bit-exact). Run → pass.
- [ ] **Step 3 — failing test: Brazil estimator.** A p-median-brazil scenario with one added warehouse + zero `distanceOverrides` → after `normalizeAddedEntityDistances`, `distanceOverrides` has `estimated:true` rows to active customers equal to `clampMi(haversineMiles(wh, region) * BRAZIL_CIRCUITY)` within `< 0.1%` of a known base pair. Also test POST-create and import-apply paths (mirror the existing p-median-us estimator route tests). Run → fail.
- [ ] **Step 4 — implement Brazil estimator.** Add `const BRAZIL_CIRCUITY` reverse-derived vs `haversineMiles` (R=3959) from Brazil's base matrix (≈1.16993 — verify; if it coincides with `TRANSPORT_CIRCUITY` within tolerance, reuse that, else a Brazil-specific constant). Add `fillEstimatedBrazilDistances` reusing `fillEstimatedDistances`'s structure × `BRAZIL_CIRCUITY`, sourcing base coords from `BRAZIL_DATASET` (coords are all the estimator needs). In `scenarios.ts` `normalizeAddedEntityDistances`, add `if (modelId === "p-median-brazil") return fillEstimatedBrazilDistances(...)` before the fall-through. Run → pass.
- [ ] **Step 5 — move/re-estimation + idempotency tests (P1, all 3 estimators).** Add tests proving, for Brazil (`distanceOverrides`), transport-coal (`laneCostOverrides`), and two-echelon (both-leg `distanceOverrides`): (a) a second `normalizeAddedEntityDistances` pass is **idempotent** (no new/changed rows); (b) after the frontend move-mutator purges an added entity's overrides (rows referencing its stable uid), a PATCH-path normalization **regenerates** those rows from the NEW coordinates (assert the new distance differs and matches the new coords); (c) the normalizer does NOT overwrite a user-supplied non-estimated override (`estimated:false` untouched). This proves move→re-estimate works end-to-end and the normalizer only fills genuinely-missing rows. Run → pass.
- [ ] **Step 6 — verify + commit.** `DATABASE_URL=... pnpm --filter api-server test autoDistance scenarios`, `pnpm run typecheck`. Confirm no `solvers/*/dataset` file changed (`git status`). Commit `[B2-T2] estimators: two-echelon r→c circuity 1.17910 + Brazil estimator + move/re-estimate coverage`.

---

## Task T3 — Brazil `GET /dataset` endpoint + Dataset adapter

**Role:** backend-engineer. **Wave 1** (parallel with T2 — disjoint files). **Depends on:** T1 (getDataset enum + Brazil manifest).

**Files:**
- Modify: `artifacts/api-server/src/routes/dataset.ts`
- Create/Modify: `artifacts/api-server/src/data/brazilDataset.ts` (adapter, mirroring `data/transportCoalDataset.ts`) — or inline the adapter in `dataset.ts` if trivial; follow the existing `data/*Dataset.ts` derivation pattern (source from `solvers/p-median-brazil/dataset/*.json` via `findRepoRoot()`, NOT `import.meta.url` relative — see CLAUDE.md gotcha).
- Test: `artifacts/api-server/src/__tests__/dataset.test.ts` (read first; add Brazil case)

**Interfaces produced:** `GET /dataset?modelId=p-median-brazil` → `{warehouses, customers}` in `Dataset` shape (every row has `id, city, state, lat, lng`; customers also `demand`).

- [ ] **Step 1 — failing test.** `GET /dataset?modelId=p-median-brazil` returns 200 with all Brazil warehouses + regions; each customer row has `city` (= region name), `state` (= region id), `lat`, `lng`, `demand`; each warehouse row has `city`/`state`/`lat`/`lng`. Run → fail (400 today).
- [ ] **Step 2 — adapter.** Build the Brazil `Dataset` from the canonical `solvers/p-median-brazil/dataset/{warehouses.json,states.json}`. Regions → customers via `{ id, city: name, state: id, lat, lng, demand }`. Warehouses → `{ id, city: <name or city>, state, lat, lng }` (read `warehouses.json`'s actual fields; apply the same name/id adapter if it also lacks city/state). Reuse `findRepoRoot()` for the path.
- [ ] **Step 3 — route branch.** Add `if (modelId === "p-median-brazil") { res.json({warehouses, customers}); return; }` in `dataset.ts`. Run → pass.
- [ ] **Step 4 — verify + commit.** `DATABASE_URL=... pnpm --filter api-server test dataset`, `pnpm run typecheck`, and verify against the BUILT server (`pnpm --filter api-server run dev`) that the path resolves (CLAUDE.md bundling gotcha). Commit `[B2-T3] Brazil GET /dataset endpoint + Dataset adapter (city=name, state=id)`.

---

## Task T4 — Shared symbology generalization + capability gates

**Role:** frontend-engineer. **Wave 2a, solo** (edits shared map components before the per-model tracks). **Depends on:** T1 (`supportsFacilityStatus` on `useListModels`).

**Files:**
- Modify: `artifacts/studio/src/components/workspace/map/EntityMarkers.tsx`, `map/MapLegend.tsx`, `map/types.ts`
- Modify: `artifacts/studio/src/components/workspace/map/CreateEntityDialog.tsx` + the edit/move/action-menu components + any role-labeled copy (generalize the entity/editor model — see Step 0)
- Modify: `artifacts/studio/src/components/NetworkMap.tsx` (R7 fixed-mine retention)
- Test: `EntityMarkers.test.tsx`, `MapLegend.test.tsx`, `NetworkMap.test.tsx` (+ role-config tests)

- [ ] **Step 0 — role/editor configuration (P1, prerequisite for T6/T7).** The shared entity model is p-median-us-shaped: `MapWarehouse` requires a `status`; `CreateEntityDialog` always renders + persists warehouse status; copy is hardcoded "warehouse/customer". transport-coal has NO mine status and uses mines/stations + `laneCostOverrides.cost`; two-echelon has status-bearing refineries + a fixed mine. Introduce a **role/editor config** (in `map/types.ts`) describing, per entity role: display label, whether it has a status field, whether it has a capacity/cost field, and its uid kind. `CreateEntityDialog`/edit/move/action components read this config instead of assuming warehouse-with-status. Default config = today's p-median-us behavior (no regression). Failing tests first: a config with `hasStatus:false` renders no status control and persists no `status`; labels come from the config. Then implement.
- [ ] **Step 1 — R1 green demand for all models.** In `types.ts`, change `demandTone(modelId)` to return green for ALL models (drop the p-median-us-only branch; green everywhere). Update/adjust the demand-tone tests. (R2 quintile sizing is already model-agnostic — confirm, add no-op test if missing.)
- [ ] **Step 2 — R7 fixed-mine retention (P1).** In `NetworkMap.tsx`, where `hideClosedWarehouses` filters warehouse-role rows absent from `openWarehouseIds`, add a guard: a row with `kind === "mine"` is ALWAYS retained regardless of open state. Failing test first: with `hideClosedWarehouses` true and a closed refinery + a fixed mine, the closed refinery is removed AND the mine remains. Implement → pass.
- [ ] **Step 3 — R3/R7 capability gate seam.** Ensure the props that drive R3 status paint + R7 hide-closed are set by callers based on `capabilities.supportsFacilityStatus` (the per-model tracks pass them). Add no cross-model regression: RTL asserts a `supportsFacilityStatus: false` render shows no status/hide-closed treatment.
- [ ] **Step 4 — verify + commit.** `pnpm --filter studio test EntityMarkers MapLegend NetworkMap`, `pnpm run typecheck`. Commit `[B2-T4] green demand all models + R7 fixed-mine retention + capability gate seam`.

---

## Task T5 — Brazil frontend: full-v2 editor + NetworkMap output migration

**Role:** frontend-engineer. **Wave 2b, FIRST (serial — edits `InputMapTab.tsx` + `Workspace.tsx`).** **Depends on:** T3 (dataset), T4 (symbology).

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` (replace Brazil `placeholder` with full-v2 `pmedian`-style mode)
- Modify: `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx` (route Brazil through `NetworkMap` in the WORKSPACE path only, replacing its `BrazilMap` branch)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (Brazil dataset query wiring; OutputMapTab props for Brazil)
- Test: `InputMapTabV2.test.tsx`, `OutputMapTab.test.tsx`, `Workspace.OutputMap.test.tsx`, `Workspace.Brazil.test.tsx` (+ Brazil cases)
- **Do NOT delete `BrazilMap.tsx` (P1):** `pages/Studio.tsx` (legacy page) + `Studio.test.tsx` still import/render it independently of `OutputMapTab`. Deleting it breaks typecheck/build. Retire it from the Workspace `OutputMapTab` path ONLY; `BrazilMap` stays for legacy Studio (a separately-scoped decommission, out of this bundle).

- [ ] **Step 1 — Brazil Input Map full-v2.** Brazil shares `PMedianMapInputs`; wire its `GET /dataset` query (T3) and render the full-v2 `PMedianInputMap` the pilot uses (place/move/edit/delete added warehouses+customers). Failing test first (Brazil render shows the v2 editor, not the placeholder), then implement. `supportsFacilityStatus` true → R3/R7 apply.
- [ ] **Step 1b — honor `demandEditable: false` (P2).** Brazil's manifest declares `demandEditable: false` (textbook-fixed region demands), but the reused `PMedianInputMap` exposes base-customer demand editing. Pass the model's `demandEditable` capability into the editor and **suppress base-region demand editing** when false, while STILL collecting a required demand for a newly-**added** customer (an added region has no textbook demand). Do NOT flip Brazil to `demandEditable: true`. Test: base Brazil region demand is read-only; an added Brazil customer requires + accepts a demand value.
- [ ] **Step 2 — output migration.** Route Brazil through `NetworkMap` in `OutputMapTab` (build the effective dataset from `displayedInputs` + Brazil dataset, honoring the snapshot principle), passing `hideClosedWarehouses` (R7) + `countryBounds` from Brazil's manifest. Failing tests: a closed Brazil warehouse is absent post-solve; an added-and-opened warehouse + its route render; unsaved coord edits don't move the displayed solve (displayedInputs). Then implement; retire `BrazilMap`.
- [ ] **Step 3 — verify + commit.** `pnpm --filter studio test InputMapTab OutputMap Workspace`, `pnpm run typecheck`. Commit `[B2-T5] Brazil full-v2 input editor + BrazilMap→NetworkMap output migration (R1-R7)`.

---

## Task T6 — transport-coal frontend: full-v2 editor (R3/R7 N/A)

**Role:** frontend-engineer. **Wave 2b, SECOND (serial).** **Depends on:** T5 (Workspace.tsx).

**Files:** `InputMapTab.tsx` (transport-coal `legacy` → full-v2 mines/stations), `Workspace.tsx`, `OutputMapTab.tsx` (effective dataset), the role-specific mutators for `TransportLpInputs`, and any transport role-config wiring not already landed by T4-Step-0. Tests. (T4-Step-0 provides the generalized entity/dialog model this task consumes.)

- [ ] **Step 1 — full-v2 mines/stations editor.** Replace transport-coal's `legacy` pin-drop with a full-v2 editor over its `TransportLpInputs` (added mines/stations + `laneCostOverrides`), using T4-Step-0's role config (mines: `hasStatus:false`; stations: demand entity). Place/move/edit/delete. R1 green bubbles on **stations**; R2 quintile; R4 Save-in-Layers. Failing test → implement. **Assert no meaningless `status` or `distanceOverrides` fields enter a transport PATCH** (transport uses `laneCostOverrides.cost`, not `distanceOverrides`, and has no status).
- [ ] **Step 2 — R3/R7 off.** Assert (RTL) that transport-coal renders NO status markers and NO hide-closed control — gated by `supportsFacilityStatus === false`. No regression to brazil/two-echelon.
- [ ] **Step 3 — effective output dataset (P1).** In `Workspace.tsx`/`OutputMapTab.tsx`, project `addedMines`/`addedStations` from **`displayedInputs`** into the Output Map's effective dataset (today the union is p-median-us-only) so `NetworkMap` can resolve result edges whose endpoints are scenario-local additions. RTL: an added transport lane (mine↔station involving an added entity) renders at solve-time coords; an unsaved move does NOT move the displayed solution's endpoints.
- [ ] **Step 4 — verify + commit.** `pnpm --filter studio test InputMapTab OutputMap Workspace`, `pnpm run typecheck`. Commit `[B2-T6] transport-coal full-v2 editor (station bubbles + R4, R3/R7 off) + effective output dataset`.

---

## Task T7 — two-echelon frontend: full-v2 editor + fixed mine + R3/R7 refineries

**Role:** frontend-engineer. **Wave 2b, THIRD (serial).** **Depends on:** T6 (Workspace.tsx).

**Files:** `InputMapTab.tsx` (two-echelon `legacy` → full-v2), `Workspace.tsx`, `OutputMapTab.tsx` (effective dataset), tests.

- [ ] **Step 1 — full-v2 editor + fixed mine.** Replace two-echelon's `legacy` mode with a full-v2 editor over refineries+customers (`addedRefineries`/`addedCustomers`/`distanceOverrides`) via T4-Step-0's role config (refineries: `hasStatus:true`, uid kind → `aw-` per DD-7; customers: demand entity). The mine is read-only context — NOT placeable/movable/editable/deletable; render it but exclude it from every edit affordance. R1 green customer bubbles; R2 quintile; R4. Failing test (mine has no edit affordances; a refinery/customer does) → implement.
- [ ] **Step 2 — R3/R7 refineries only.** Status markers + hide-closed apply to refineries (`supportsFacilityStatus` true); the fixed mine is retained by T4's `kind==="mine"` guard. RTL: hide-closed removes a closed refinery, keeps the mine; status paint on a forced-open refinery.
- [ ] **Step 3 — effective output dataset (P1).** Project `addedRefineries`/`addedCustomers` from **`displayedInputs`** into the Output Map effective dataset so `NetworkMap` renders BOTH legs (mine→refinery, refinery→customer) whose endpoints are scenario-local additions. RTL: an added refinery opened + its mine→refinery and refinery→customer routes render at solve-time coords; an unsaved move does NOT move the displayed solution.
- [ ] **Step 4 — verify + commit.** `pnpm --filter studio test InputMapTab OutputMap Workspace`, `pnpm run typecheck`. Commit `[B2-T7] two-echelon full-v2 editor: fixed mine read-only + R3/R7 refineries + effective output dataset (both legs)`.

---

## Task T8 — QA: full gate + per-model live Playwright

**Role:** qa-sdet. **Wave 3.** **Depends on:** T1–T7.

- [ ] **Step 1 — full gate.** `pnpm run typecheck`; `DATABASE_URL=... pnpm --filter api-server test` (watch the known `resultEnvelope` flake — re-run in isolation if exactly that 1 fails); `pnpm --filter studio test`; `pnpm --filter @workspace/dataset-schema test`; solver `python3 -m pytest tests/ -x` + `python3 tests/e2e_accuracy.py` (**87/87 unchanged**) + `python3 tests/test_two_echelon.py` (golden values green — proves the relabel + estimator changes didn't touch base numerics).
- [ ] **Step 2 — live Playwright (dev servers; expanded coverage per spec).** Real registered accounts, real solves, cleaned up after. Per model, exercise BOTH editable roles:
  - **Brazil:** add a warehouse + a customer → save → solve → v2 editor renders, output via NetworkMap, R7 hides a closed warehouse, R3 status paint (computed style).
  - **transport-coal:** add a mine + a station → save → solve → v2 editor, R1 green station bubbles, **no** status/hide-closed UI; verify generated lane costs.
  - **two-echelon:** add a refinery + a customer → save → solve → mine is read-only, R3/R7 on refineries (mine preserved), unit label reads **"mi"**; verify generated mine→refinery + refinery→customer rows (correct 1.17918 circuity on the latter).
  - Report real defects (root cause + fix) and STOP for controller decision on any runtime defect rather than fixing product code unilaterally.
- [ ] **Step 3 — commit.** New/updated e2e spec(s). Commit `[B2-T8] Bundle 2 QA — full gate + per-model live Playwright (both roles)`.

---

## Task T9 — Brazil CSV import/export (folded in, user decision)

**Role:** backend-engineer. **Parallel with T4** (backend files, disjoint from T4's map components). **Depends on:** T3 (Brazil dataset). Frontend import/export BUTTONS for Brazil fold into T5.

**Context:** Phase B (B6.3) shipped Brazil backend/solver-only — its import (`scenarios.ts:901-909`) + export (`484-492`) route gates never list `p-median-brazil`, so Brazil CSV 422s. Brazil shares p-median-us's schema/entities (warehouses/customers/distances) — `import.ts`'s `ImportEntity`, `DISPLAY` labels, and `mintAddedEntityUid` already handle them. The only gaps: the route gates, and validation/export must resolve Brazil's base dataset (`BRAZIL_DATASET` / the T3 adapter), NOT p-median-us's.

**Files:** `artifacts/api-server/src/routes/scenarios.ts` (import + export gates), `artifacts/api-server/src/services/import.ts` (Brazil base-dataset resolution — mirror how p-median-us resolves its dataset, but pick Brazil's when modelId is brazil), `artifacts/api-server/src/services/templates.ts` (export applies overrides onto Brazil's base dataset), tests.

- [ ] **Step 1 — failing tests.** Brazil scenario: `GET /export?entity=warehouses|customers|distances` returns Brazil rows (not p-median-us's); `POST /import` + `/import/apply` for warehouses/customers/distances validate against the BRAZIL base dataset (an id valid in Brazil but not p-median-us passes; a p-median-us-only id fails). Run → fail (422 today).
- [ ] **Step 2 — open the gates.** Add `p-median-brazil` to the import + export model→entity gates, scoped to warehouses/customers/distances (mirror p-median-us).
- [ ] **Step 3 — Brazil dataset resolution.** Where `import.ts`/`templates.ts` resolve the base dataset by modelId, add the Brazil branch (use the T3 adapter / `BRAZIL_DATASET`). Confirm added-entity uid minting (`aw-`/`ac-`) is already shared (it is). Run → pass.
- [ ] **Step 4 — verify + commit.** `DATABASE_URL=... pnpm --filter api-server test import export scenarios templates` + `pnpm run typecheck`. Confirm no `solvers/*/dataset` change. Commit `[B2-T9] open Brazil CSV import/export (warehouses/customers/distances) with Brazil base dataset`. NOTE for T5: add Brazil import/export UI buttons (mirror the p-median-us Overrides toolbar) as part of the Brazil frontend.

## Controller: final whole-branch review + merge + deploy

- [ ] Dispatch a final whole-branch reviewer (opus) over the full Bundle-2 diff: spec coverage per the matrix; capability gates (no `modelId===` for R3/R7); DD-1/hard-rule-#2 (base data + golden tests untouched); cross-model consistency (Gate 1 + 6.5); `displayedInputs` snapshot in Brazil's NetworkMap migration; estimator circuity correctness.
- [ ] Fix any Critical/Important via one fix dispatch. Re-verify the gate.
- [ ] Merge to local main (`--no-ff`). Per user's bundle plan: **e2e → deploy** (push origin + Render deploys for nos-api/nos-studio, then live-verify). Then Bundle 3 (ask user for new models).

## Self-review (controller, done)

- Spec coverage: every matrix cell has a task (T4 R1/R2 shared; T5/T6/T7 per-model R3/R4/R7 + editor; T2 estimators; T3 Brazil endpoint; T1 capability+relabel+manifest). ✓
- No placeholders; estimator constants (1.17918, 1.17) and adapter (city=name, state=id) are concrete. ✓
- Type consistency: `supportsFacilityStatus` defined T1, consumed T4–T7; `fillEstimatedBrazilDistances` defined T2. ✓
- Shared-file serialization: T5→T6→T7 serial on InputMapTab/Workspace; T1 sole owner of openapi/codegen. ✓
