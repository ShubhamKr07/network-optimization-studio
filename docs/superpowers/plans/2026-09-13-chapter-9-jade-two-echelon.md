# Chapter 9 — JADE Multi-Product Two-Echelon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is executed by the **agent team** (backend-engineer / solver-engineer / frontend-engineer / qa-sdet dispatched per task, controller cherry-picks + re-gates), per the user's standing default — not subagent-driven-development. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Add `two-echelon-jade-us` (Watson Ch. 9 "JADE Investment Decision") as the 5th solvable model — a multi-product, two-echelon (plant → warehouse → customer), single-source facility-location LP over the US — full-stack (dataset, solver, contract, tabbed Workspace incl. a plants echelon, products axis, plant×product capability matrix, and full Phase-B network editing), through the browser verify gate, then unhidden from Landing.

**Architecture:** Faithful port of the notebook model (spec §2). Canonical string IDs replace the notebook's colliding integer IDs. Solver is a new `solve_jade()` dispatched by `model_type`. All scenario edits enter as bounds/coefficients (hard rule 6). Contract-first: OpenAPI → orval codegen. Frontend rides the existing tabbed Workspace + Input Map v2 surfaces, extended for the new echelon/axis.

**Tech Stack:** Python PuLP/CBC solver; Express 5 + Drizzle + orval/OpenAPI; React + Vite + Tailwind + shadcn + wouter + TanStack Query; vitest/RTL/Playwright/pytest.

**Reference docs (read before executing any task):**
- Spec: `docs/superpowers/specs/2026-09-13-chapter-9-jade-two-echelon-design.md` — the requirements; §2 is the full model math, §2.7 the ground truth.
- `model-integration-precheck.md` — the 10 registration points + 8 gates, with exact file paths. Every task cites its gates. **This is the authoritative integration map.**

## Global Constraints

- **Branch:** all work on `jade-ch9` only (worktree `.claude/worktrees/jade-ch9`). Nothing to `main`.
- **Canonical IDs** (spec §2.1): `plant-<n>`, `product-<n>`, `wh-<notebookId>`, `customer-<notebookId>`; each entity keeps its integer notebook id as display-only `sourceId`. Every join/input/edge/import/export/UI identity uses the canonical string `id`, never `sourceId`/city/index/notebook integer.
- **Ground truth (hard rule 2, sacred):** forced `wh-11` (Phoenix) + `wh-14` (New York), P=2, capability diagonal, bands `[200,400,800,1600]` → `status optimal`, objective **`254060828.6157`**. `e2e_accuracy.py` (standalone; run `python3 e2e_accuracy.py`) is the solver-accuracy gate; the pre-existing 87 checks stay green, the JADE section is additive. **`e2e_journey.py` is NOT a JADE gate** — it is fully non-runnable (authenticates via the removed legacy `/login`, 401s at step 1), so it is neither run nor required here; a journey rewrite onto `/auth/*` is out of scope (its own future task).
- **Payload/merge boundary:** `buildPayload` (TS) forwards only *validated edits* + model params on the wire — never the base dataset. `solve.py` loads the JADE base package from disk (`_safe_load`) and `merge_inputs.py`'s new `build_merged_jade_dataset` performs a fresh, non-mutating merge per solve. This is the established two_echelon/transport boundary (verified in `pmedian.ts` + `solve.py`) — do not inline the dataset into the payload.
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). Change `openapi.yaml`, re-run orval, commit spec + regen together (hard rules 1/4).
- **Solver hygiene (Gate 3):** no `print()` except the final `print(json.dumps(result))`; no `writeLP()`; no `!pip`/plotly/IPython; `PULP_CBC_CMD(msg=False)`; binaries via `> 0.5`; relative-epsilon flow filter; averages from flows never `objective/demand`; never execute the notebook — literal-parse `get_data()`.
- **Distance unit:** miles (`distanceUnit: "mi"`). Distances copied verbatim from the notebook, never recomputed (Gate 2).
- **One task = one commit**, message `[jade-T<n>] <summary>`; solver+envelope in the same commit (Gate 5); spec+codegen in the same commit.
- **Recurring bug class:** every per-model gate/allowlist must be extended for `two-echelon-jade-us`; gate on **capabilities**, never `modelId === X` (precheck Gate 1/6/6.5, the nine silent failures).
- **Per-task gate:** `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test`; solver pytest + `python3 e2e_accuracy.py` whenever Python/dataset changes.

---

## Wave 1 — Data + registry (model listable, not yet solvable)

Rollout order per Gate 8: shared infra → dataset+manifest (listable) is the cheapest proof the registry works.

### Task 1: Canonical dataset package + extraction script

**Gates:** Gate 0, Gate 2, Gate 1.2 (version.json).

**Files:**
- Create: `artifacts/api-server/src/solver/tools/extract_jade_dataset.py` (committed one-off **Python** script — it must literal-parse Python source with `ast`/`ast.literal_eval`, which a `.ts` file cannot do; reads the notebook path, writes the package, asserts invariants)
- Create: `solvers/two-echelon-jade-us/dataset/{plants,products,warehouses,customers,distances,plant_product_capability,version}.json`
- Test: `artifacts/api-server/src/solver/tests/test_jade_dataset.py` (Python drift guard, mirrors `test_datasets.py`)

**Interfaces (produces — canonical record-map files, keyed by canonical id):**
- `plants.json` — `{ "plant-1": {id, sourceId:1, name, city, state, lat, lng}, … }` (4)
- `products.json` — `{ "product-1": {id, sourceId:1, name}, … }` (4)
- `warehouses.json` — `{ "wh-11": {id, sourceId:11, name, city, state, zip, lat, lng}, … }` (25)
- `customers.json` — `{ "customer-1": {id, sourceId:1, name, city, state, zip, lat, lng, demand, demands:{"product-1":tons,…}}, … }` (100); scalar `demand` = Σ of the 4 product demands (shared map sizing / legacy consumers)
- `distances.json` — **one** composite-key map: `"plant-1,wh-11": miles` (100 inbound) + `"wh-11,customer-1": miles` (2500 outbound) = 2600 entries. One file (matches existing package convention; keeps the `data/referenceDistances.ts` loader untouched).
- `plant_product_capability.json` — `[{plantId, productId, capacity}]`, all 16 cells (4 at `210000000`, 12 at `0`)
- `version.json` — `{version:1, sha256}` (sha256 via `computeSha256`, never by hand)

**Extraction method:** parse the `.ipynb` as JSON, locate the `get_data()` cell, `ast`-parse and `ast.literal_eval` its dict assignments (`customers`, `warehouses`, `plants`, `products`, `customer_demands`, `plant_wh_distance`, `wh_cust_distance`). **Never `exec`/import the notebook** (top-level has `!pip install`, a solve, file writes, Plotly). Re-key to canonical ids; the notebook integer ids collide across entity types (verified: plant∩customer = {1,2,3,4}, plant∩warehouse = {1,2,3}, warehouse∩customer = all 25) so re-keying is mandatory, not cosmetic.

- [ ] **Step 1:** Write `test_jade_dataset.py` asserting: 4 plants / 4 products / 25 warehouses / 100 customers; 400 demand cells, Σ demand `1545308`; per-product totals `569324 / 406660 / 325328 / 243996`; `distances.json` has exactly 2600 keys (100 + 2500); distance extrema `plant_wh` max `2907.302`, `wh_cust` max `3219.9609`; 34 inbound + 825 outbound pairs `> 1600`; all 16 capability cells present (4 non-zero); every canonical id globally unique across all four entity maps; coords in US range (lat 24–49, lng −125…−66); `version.json` sha256 matches `computeSha256`.
- [ ] **Step 2:** Run — expect FAIL (no dataset yet).
- [ ] **Step 3:** Write `extract_jade_dataset.py`, run it to generate the 7 files.
- [ ] **Step 4:** `python3 test_jade_dataset.py` (or pytest) — expect PASS. Spot-check `wh-11`=Phoenix, `wh-14`=New York.
- [ ] **Step 5:** Commit `[jade-T1] canonical dataset package + extraction script`.

**DoD:** all invariants asserted and green; files are canonical record-maps with `lat/lng`; `sourceId` retained; single `distances.json`.

---

### Task 2: dataset-schema entries, PACKAGE_SPECS, ManifestSchema flag, manifest.json

**Gates:** Gate 1.1 (manifest), 1.5 (PACKAGE_SPECS), 1.2 (version).

**Files:**
- Modify: `lib/dataset-schema/src/index.ts` — new entry schemas + PACKAGE_SPECS entry + `supportsPlantProductCapability` on `ManifestSchema.capabilities` + `two-echelon-jade-us` in `MODEL_IDS`
- Create: `solvers/two-echelon-jade-us/manifest.json`
- Test: `lib/dataset-schema/src/*.test.ts` (extend manifest + package tests)

**Interfaces (produces):**
```ts
export const JadePlantEntry = z.object({ id: z.string(), sourceId: z.number(), name: z.string(), city: z.string(), state: z.string(), lat: z.number(), lng: z.number() });
export const JadeProductEntry = z.object({ id: z.string(), sourceId: z.number(), name: z.string() });
export const JadeWarehouseEntry = z.object({ id: z.string(), sourceId: z.number(), name: z.string(), city: z.string(), state: z.string(), lat: z.number(), lng: z.number(), zip: z.string().optional() });
export const JadeCustomerEntry = JadeWarehouseEntry.extend({ demand: z.number(), demands: z.record(z.string(), z.number()) });
export const JadeCapabilityEntry = z.object({ plantId: z.string(), productId: z.string(), capacity: z.number() });
```
- PACKAGE_SPECS entry: `plants.json`→`z.record(z.string(), JadePlantEntry)`, `products.json`→`z.record(z.string(), JadeProductEntry)`, `warehouses.json`→`z.record(z.string(), JadeWarehouseEntry)`, `customers.json`→`z.record(z.string(), JadeCustomerEntry)`, `distances.json`→`DistanceMap`, `plant_product_capability.json`→`z.array(JadeCapabilityEntry)`.
- `ManifestSchema.capabilities` gains `supportsPlantProductCapability: z.boolean().optional().default(false)`.
- `manifest.json` capabilities: `{ supportsP:true, capacityModes:[], demandEditable:true, outputGrids:["openWarehouses","assignments","flows","costSummary","serviceStats"], supportsFacilityStatus:true, supportsReferenceDistances:true, supportsAddedCustomerExclusion:true, supportsPlantProductCapability:true }`, `distanceUnit:"mi"`, `countryBounds` computed from dataset lat/lng, `inputsSchema` JSON blob describing the Task-4 input shape.

- [ ] **Step 1:** Extend manifest test — `readManifest("two-echelon-jade-us")` parses; `capabilities.supportsPlantProductCapability === true`; `validatePackage`/`computeSha256` succeed on the T1 package.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Add schemas + PACKAGE_SPECS entry + capability flag + `MODEL_IDS` entry + `manifest.json`.
- [ ] **Step 4:** `pnpm --filter @workspace/dataset-schema test` — PASS.
- [ ] **Step 5:** Commit `[jade-T2] dataset-schema entries + PACKAGE_SPECS + manifest`.

**DoD:** package validates + hashes; manifest parses with the new capability; `MODEL_IDS` includes the model. (Model not yet in `GET /api/models` until the registry scans it — Task 3 asserts that.)

---

### Task 3: Registry listability (NOT the full consistency gate)

**Gates:** Gate 1.1 (manifest visible).

**Note (fix #2):** the full `registration.test.ts` `SOLVABLE` set asserts `VALID_MODEL_IDS` + a known input schema + `buildPayload` + a `solve.py` dispatcher all exist — none of which land until T4–T6. Adding JADE to `SOLVABLE` here would red the suite for all of Wave 2. So Wave 1 proves **listability only**; JADE joins the full `SOLVABLE` consistency test in **T6** (after its solve path exists).

**Files:**
- Modify (only if a hardcoded list excludes it): `artifacts/api-server/src/registry/modelRegistry.ts`
- Test: `artifacts/api-server/src/registry/__tests__/registration.test.ts` (correct path) — a **listability** assertion separate from `SOLVABLE`

- [ ] **Step 1:** Add a listability test: `two-echelon-jade-us` appears in the registry's scanned model list and `GET /api/models` count = 5. Do **not** add it to `SOLVABLE`.
- [ ] **Step 2:** Run — FAIL only if a hardcoded array excludes it (the registry scans `solvers/*/manifest.json` at boot).
- [ ] **Step 3:** Add the id to any residual hardcoded list the test flags.
- [ ] **Step 4:** `pnpm --filter api-server test registration` — PASS; boot the server, `GET /api/models` returns 5 incl. JADE.
- [ ] **Step 5:** Commit `[jade-T3] registry listability for two-echelon-jade-us`.

**DoD:** model listable via `GET /api/models`; listability test green (SOLVABLE untouched). **Wave 1 exit: model listable, not solvable.**

---

### Task 3.5: OpenAPI contract + codegen (full sweep)

**Gates:** Gate 1.7 (OpenAPI enum + codegen), Gate 0/Gate 5 (public result contract carries new fields), hard rules 1/4 (spec+regen one commit). **Predecessor of every typed consumer** (T4 route types, T8 route/service types, T10 dataset hooks, all of W3).

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (all of the below in one sweep)
- Regenerate: `pnpm --filter @workspace/api-spec run codegen` → commit `openapi.yaml` + regenerated `lib/api-zod` + `lib/api-client-react` together (never hand-edit generated)
- Test: contract/type smoke (generated client accepts the new id + shapes)

**Interface (the complete contract delta):**
- `modelId` enum gains `two-echelon-jade-us` at **every** occurrence (`GET /dataset`, `Scenario`, `ScenarioInput`, `ModelInfo`).
- `Dataset` gains optional `plants`, `products`, `plantProductCapabilities`; `WarehouseCandidate`/`Customer` gain optional `name` + integer `sourceId`; `Customer` gains optional `demands` (retains scalar `demand`). New `Plant`, `Product`, `PlantProductCapability` schemas. All optional → existing 4 datasets stay valid.
- `Edge.leg` gains `plant_to_warehouse`, `warehouse_to_customer`; `Edge.productId` optional (globally). `SolveMetrics.avgDistanceByLeg` reused; add optional `openFacilityIds`, `totalDemand`, `inboundCost`, `outboundCost` (these also land in `resultEnvelope.ts` in T5 — the **Zod envelope** and the **public OpenAPI SolveResult** are two layers; both must carry the fields or one strips them).
- `ModelInfo.capabilities` gains `supportsPlantProductCapability` (optional, default false at the public boundary).
- Import/export enums: `plants`, `plantCapabilities` join `ImportRequest`, `ImportApplyRequest`, the export query, and `ExportEnvelope`; `flows` (already in the export query) added to `ExportEnvelope`. `ReferenceDistancePair` gains optional `leg`.

- [ ] **Step 1:** Edit `openapi.yaml` for the full delta above; run codegen.
- [ ] **Step 2:** Review the generated diff (no hand edits); typecheck.
- [ ] **Step 3:** Contract smoke test — generated Zod accepts a JADE dataset/scenario/edge/metrics shape; existing models' shapes still parse.
- [ ] **Step 4:** `pnpm run typecheck && pnpm --filter api-server test`.
- [ ] **Step 5:** Commit `[jade-T3.5] OpenAPI contract + codegen for JADE` (spec + regen together).

**DoD:** one codegen pass exposes typed clients for every JADE consumer; existing models unaffected. This is the single OpenAPI/codegen task — T4/T8/T10/W3 **consume** these types, they do not re-edit `openapi.yaml`.

---

## Wave 2 — Solver + backend (solvable end-to-end)

**Concurrency & single-writer (fix #5 — honest map).** `routes/scenarios.ts` is a **shared hot file** edited by T4 (`VALID_MODEL_IDS`), T7 (precheck wiring), T8 (entity routes), and T12 (`normalizeAddedEntityDistances`) — these four **serialize** on that file; they are NOT dispatched as file-disjoint. `openapi.yaml` is owned solely by T3.5 (T3 does not touch it). Otherwise: solver lane (`solve.py`→T5, `merge_inputs.py`→T5/T6) ⊥ api-server lane where genuinely disjoint; `resultEnvelope.ts`→T5; `pmedian.ts`→T6. Sequence within the wave: **T3.5 (contract) → T4 → T5 ∥ (T6 after T5's envelope) → T7 → T8**, with T4/T7/T8's `routes/scenarios.ts` edits applied in series by the controller.

### Task 4: Zod input schema + KNOWN_SCHEMAS + VALID_MODEL_IDS

**Gates:** Gate 1.3 (KNOWN_SCHEMAS), 1.4 (VALID_MODEL_IDS — most-missed), Gate 5 (`timeLimitSec` required).

**Files:**
- Create: `artifacts/api-server/src/validation/inputs/jadeInputs.ts` (mirror `twoEchelon.ts` structure)
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts` (`KNOWN_SCHEMAS`), `artifacts/api-server/src/routes/scenarios.ts` (`VALID_MODEL_IDS`)
- Test: `artifacts/api-server/src/validation/inputs/*.test.ts`

**Interface (produces — `jadeInputsSchema`):**
- `p`: int ≥ 1 (no static max — UI/semantic max = effective active warehouse count incl. added, checked in Task 7 precheck).
- `distanceBands`: exactly 4 strictly-ascending positive integers.
- `gap`: number ≥ 0. `timeLimitSec`: positive integer (**required** — absent → `setTimeout(NaN)` kills every solve).
- `warehouseOverrides[]`: `{ id, status: "active"|"forced_open"|"inactive" }` (status only; no capacity — uncapacitated). "active" displays as "Potential".
- `customerOverrides[]`: `{ id, demands?: Record<productId, number≥0>, status: "active"|"excluded" }` (sparse per-product; omitted keys inherit base).
- `plantProductCapability[]`: `{ plantId, productId, enabled: boolean }`, pair-unique (sparse overrides on the 16-cell base).
- `addedPlants[]`: `{ id, displayCode?, city, state, lat, lng }` (added plants default all capability cells disabled).
- `addedWarehouses[]`: `{ id, displayCode?, city, state, lat, lng, status }`.
- `addedCustomers[]`: `{ id, displayCode?, city, state, lat, lng, demands: Record<all 4 productIds, number≥0>, status: "active"|"excluded" }`.
- `distanceOverrides[]`: `{ leg: "plant_to_warehouse"|"warehouse_to_customer", fromId, toId, distance: number≥0, estimated?: boolean }`, pair-unique per `(leg,fromId,toId)`, endpoints role-compatible.
- Required: `p`, `distanceBands`, `gap`, `timeLimitSec`.

- [ ] **Step 1:** Write validation tests: valid minimal payload parses; `timeLimitSec` absent → reject; `distanceBands` not-4 / non-ascending → reject; duplicate `plantProductCapability` pair → reject; `addedCustomers` missing a product key → reject; `distanceOverrides` missing `leg` → reject; `VALID_MODEL_IDS` accepts `two-echelon-jade-us` (a `POST /scenarios` route test); unknown model still 422.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Write `jadeInputs.ts`; register in `KNOWN_SCHEMAS`; add to `VALID_MODEL_IDS`.
- [ ] **Step 4:** `pnpm --filter api-server test` (validation + scenarios route) — PASS.
- [ ] **Step 5:** Commit `[jade-T4] JADE Zod inputs + KNOWN_SCHEMAS + VALID_MODEL_IDS`.

**DoD:** create/validate a JADE scenario succeeds; malformed inputs rejected at the boundary.

---

### Task 5: `solve_jade()` + dispatcher + result envelope (one commit)

**Gates:** Gate 3 (hygiene), Gate 5 BLOCKER (solver + envelope same commit), Gate 4 (band overflow), Gate 1.8 (dispatcher), Gate 7 BLOCKER (`e2e_accuracy`).

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py` (new `solve_jade()`; `solve()` dispatch)
- Modify: `artifacts/api-server/src/solver/resultEnvelope.ts` (leg enum +2, `Edge.productId`, metrics optional fields)
- Create: `artifacts/api-server/src/solver/tests/test_jade.py`
- Modify: `artifacts/api-server/src/solver/tests/e2e_accuracy.py` (add JADE section — hard rule 2, human-approved by this plan)

**Interfaces:**
- `solve.py`: faithful port of spec §2 as `solve_jade(inp)`. It **loads the JADE base package from disk** (`_safe_load("two-echelon-jade-us", …)`, mirroring the existing per-model loads) and calls `merge_inputs.py`'s `build_merged_jade_dataset(base, inp)` to apply edits — it does **not** receive the dataset on the wire (payload/merge boundary, Global Constraints). `solve()` gains `if model_type == 'two_echelon_jade': return solve_jade(inp)` and its terminal `return solve_pmedian(inp)` catch-all becomes `if model_type == 'p_median': return solve_pmedian(inp)` + a final unknown→`_envelope("error",…, "Unknown modelType: <x>")`. (Verified safe: `buildPayload` sets `modelType` for every model, `pmedian.ts:153`.)
  - Wire payload `inp` (from Task 6) — **edits + params only**: `{ modelType:"two_echelon_jade", p, distanceBands, gap, timeLimitSec, warehouseStatuses:[{warehouseId,status}], excludedCustomerIds:[…], customerDemands:{customerId:{productId:tons}}, capabilityOverrides:[{plantId,productId,enabled}], addedPlants:[…], addedWarehouses:[…], addedCustomers:[…], distanceOverrides:[{leg,fromId,toId,distance}] }` (exact edit-array names mirror the two_echelon passthrough). The solver builds the full effective plant×product cross-product from base ∪ added plants so an enabled off-diagonal cell works.
  - Envelope out: inbound edge per positive `(plant,warehouse,product)` flow with `leg:"plant_to_warehouse"`, `productId` set, `flow`=tons; outbound edge per customer aggregated across products with `leg:"warehouse_to_customer"`, no `productId`, `flow`=total served tons. `metrics.avgDistanceByLeg` (flow-weighted per leg), `weightedAvgDistance` (flow-weighted both legs — never `objective/demand`), `bandCoverage` = **exclusive per-band** coverage on the outbound leg **plus a separately labelled `> 1600` overflow entry** (`band:-1`) — same exclusive semantics as `lib/bands.ts`/every other model (no per-model envelope divergence); the **cumulative** Service-Stats view (approved spec §2.7) is rolled up from these at the display layer in T14. Overflow is never folded into the last boundary. `utilizationByNode` = demand-served tons per open wh, `openFacilityIds` (authoritative incl. zero-flow open wh), `totalDemand`, `inboundCost`, `outboundCost`. `details` retains per-product outbound assignments for audit.
- `resultEnvelope.ts`: `EdgeSchema.leg` enum → `["mine_to_refinery","refinery_to_customer","plant_to_warehouse","warehouse_to_customer"]`; add `productId: z.string().optional()`. `MetricsSchema` add optional `openFacilityIds: z.array(z.string())`, `totalDemand`, `inboundCost`, `outboundCost` (all `.optional()` — existing models unaffected).

- [ ] **Step 1:** `test_jade.py` (pytest) — the §2.7 forced case objective `254060828.6157` to 1e-6 relative + `optimal`; single-source (one wh per customer across products); plant-product capacity binds; min-charge applies below breakpoint (`< min/rate` miles → flat charge); capability toggle changes the chosen warehouses; excluded customer absent from outbound edges; forced-open/closed honored; **over-constraining guard** (spec §2.5.2 balance summed over plants, not per-pair — synthetic 2nd plant test, mirroring Ch10's `test_flow_balance_generalizes`); band overflow present (`band:-1` non-empty for the default bands); infeasible case returns a named cause.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `solve_jade()` + dispatch + envelope fields (same commit).
- [ ] **Step 4:** `python3 -m pytest tests/test_jade.py -x`; then `python3 e2e_accuracy.py` (87 pre-existing green + JADE section); `pnpm --filter api-server test` (envelope leg/productId/metric retention test).
- [ ] **Step 5:** Commit `[jade-T5] solve_jade + dispatcher + result envelope`.

**DoD:** notebook objective reproduced exactly; envelope retains new fields through Zod; `e2e_accuracy` green; solver hygiene clean.

---

### Task 6: Payload builder + merge bridge

**Gates:** Gate 1.6 (`SolveInput` + `buildPayload`).

**Files:**
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (`SolveInput` union + `buildPayload()` branch, `modelId→modelType`, forwards **edits only**)
- Modify: `artifacts/api-server/src/solver/merge_inputs.py` (new `build_merged_jade_dataset(base, inp)` — mirror `build_merged_two_echelon_dataset`; the merge lives in **Python**, per the established boundary — not TS)
- Modify: `artifacts/api-server/src/registry/__tests__/registration.test.ts` (now add JADE to `SOLVABLE` — its solve path exists as of this task)
- Test: `artifacts/api-server/src/solver/pmedian.test.ts` (+ `test_jade_merge.py` for the merge)

**Interface:**
- `buildPayload(input)` for `modelId === "two-echelon-jade-us"` → `modelType:"two_echelon_jade"` wire payload = the **edit arrays + params** of Task 5's shape (statuses, `excludedCustomerIds`, per-product `customerDemands`, `capabilityOverrides`, `addedPlants/Warehouses/Customers`, leg-discriminated `distanceOverrides`, `p`, `distanceBands`, `gap`, `timeLimitSec`). It forwards validated inputs by their schema names; it does **not** read or inline the base dataset. Canonical ids only (no `sourceId` on the wire). `supportsAddedCustomerExclusion` gated via the registry manifest, never `modelId === …` (mirror the two_echelon branch).
- `build_merged_jade_dataset(base, inp)` (Python): base package ∪ `addedPlants/Warehouses/Customers`; `distanceOverrides` (leg-keyed) + capability overrides (enabled→`210000000`, disabled→`0`; added plants default all-disabled) applied over base maps; statuses→force flags; exclusions applied. Per-call, non-mutating (base dict never mutated).

- [ ] **Step 1:** `pmedian.test.ts`: JADE payload carries the edit arrays with canonical ids and no dataset/no `sourceId`; a `capabilityOverrides {enabled:false}` and a `forced_open` status appear in the payload. `test_jade_merge.py`: `build_merged_jade_dataset` on the base yields 4/25/100 entities + 16 capability cells; a disabled cell → `0`; an added warehouse adds a row + its distance rows; excluded customer removed; base dict unmutated after the call.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement union + branch + `build_merged_jade_dataset`; add JADE to `SOLVABLE`.
- [ ] **Step 4:** `pnpm --filter api-server test pmedian registration` + `python3 -m pytest tests/test_jade_merge.py -x` — PASS.
- [ ] **Step 5:** Commit `[jade-T6] JADE payload builder + Python merge + SOLVABLE registration`.

**DoD:** a persisted JADE scenario solves end-to-end via the async job path (enqueue → poll → `succeeded`, correct objective); JADE in the full registration consistency test.

---

### Task 7: Semantic precheck

**Gates:** precheck "semantic precheck" (spec §5); Gate 6.5 auto-estimate feeds this.

**Files:**
- Create/modify: `artifacts/api-server/src/…/precheck` (register `precheckJadeInputs` in both standalone + solve-before-enqueue paths)
- Test: precheck tests

**Interface — `precheckJadeInputs(inputs, dataset)` checks:** global id collisions across added entities; `customerOverrides`/`addedCustomers` demand keys are known product ids; role/leg reference integrity for `distanceOverrides` (plant→wh from a plant to a wh, etc.); added-entity distance completeness on **both** legs; `forced_open count ≤ p ≤ active warehouse count`; sufficient **enabled** plant capacity for every product with positive effective demand. Shape-valid JADE inputs must never fall through to the default `{ok:true}`.

- [ ] **Step 1:** precheck tests: missing added-entity leg distance → blocked with cause; `p < forced_open` → blocked; a product with demand but no enabled plant → blocked with the product named; valid scenario → `{ok:true}`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement + register in both paths.
- [ ] **Step 4:** `pnpm --filter api-server test` — PASS.
- [ ] **Step 5:** Commit `[jade-T7] JADE semantic precheck`.

**DoD:** shape-valid but infeasible-by-construction inputs are rejected with a named cause before CBC.

---

### Task 8: Import/export/reset entity registration

**Gates:** Gate 1.9 (override entity registration) — Gate 7 export/import route tests.

**Files (import/export enums already landed in T3.5 — this task is service/route logic only, consuming those generated types):**
- Modify: `artifacts/api-server/src/services/templates.ts` (`apply<Entity>Overrides` + `<entity>RowsToCsv` for `plants`, `plantCapabilities`, `flows`)
- Modify: `artifacts/api-server/src/services/import.ts` (`ImportEntity` union + `COLUMNS`/`ENTITY_HAS_VALUE`/`VALID_STATUSES`; thread `modelId` to disambiguate the shared `customers` entity name)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (entity union + model↔entity pairing checks in `GET .../export`, `POST .../import`, `POST .../import/apply`, `POST .../reset-to-baseline`) — **shared-file: serialized after T4/T7/T12's edits to this file (see concurrency map)**
- Test: route tests

**Notes:** `plants` and `plantCapabilities` are new entities; `flows` already in the export query enum but must be accepted by `ExportEnvelope`. Capability rows are a matrix (`plantId,productId,enabled`) — `ENTITY_HAS_VALUE` semantics: boolean, not a numeric value column. `customers` collides with p-median-us's 200-row set — `modelId` disambiguates the 100-row JADE dataset. `reset-to-baseline` clears JADE's `warehouseOverrides/customerOverrides/plantProductCapability/addedPlants/addedWarehouses/addedCustomers/distanceOverrides`.

- [ ] **Step 1:** Route tests: export each JADE entity (warehouses/customers/plants/plantCapabilities/flows) 200; a sibling model's entity → 422; import-apply persists into the right `inputs` field; reset-to-baseline clears all JADE override arrays; `customers` import validates against the 100-row JADE dataset, not p-median-us's 200.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement across `templates.ts`, `import.ts`, `routes/scenarios.ts` (enums/types come from T3.5's codegen — no `openapi.yaml` edit here).
- [ ] **Step 4:** `pnpm --filter api-server test` + review generated diff.
- [ ] **Step 5:** Commit `[jade-T8] import/export/reset entity registration`.

**DoD:** all JADE entities import/export/reset; sibling entities rejected; `customers` disambiguated. **Wave 2 exit: JADE solvable + editable via API end-to-end.**

---

## Wave 3 — Frontend (tabbed Workspace)

**Concurrency & single-writer (fix #5).** `Workspace.tsx` is the W3 integration bottleneck — tab registry, effective-row projections, Output-Map tab, and Save reconciliation all live there, so **T11/T12/T13/T14/T15 all need it**. Resolve with the **optional-props pattern**: each leaf unit (T11 tabs, T13 map+palette, T14 grids, T15 Distances) ships standalone exposing new props with safe defaults (its own commit typechecks alone); a **single `Workspace.tsx` integrator (assigned to T12**, which already owns the heaviest surface there) wires every call site in series — not concurrently. `chapters.ts`→T9; `NetworkMap.tsx`/map palette→T13; `lib/bands.ts`→T14; new standalone component files are genuinely disjoint and parallelizable.

### Task 9: Chapter registration + header + map bounds

**Gates:** Gate 6 header BLOCKER, Gate 6 map-bounds.

**Files:** `artifacts/studio/src/lib/chapters.ts`; verify `lib/mapBounds.ts` reads manifest `countryBounds`.

**Interface:** add `{ path:"/chapter-9/jade", modelId:"two-echelon-jade-us", chapter:"Chapter 9", title:"JADE Network — Multi-Product Two-Echelon", description:…, workspace:true, hiddenFromLanding:true, labHeaderTitle:"JADE Network · Model Lab", labHeaderSubtitle:"Ch 9 · two-echelon multi-product · plants → warehouses → customers" }` to `CHAPTERS`. Header reads `chapterForModelId` (never a ternary).

- [ ] **Step 1:** Test: `chapterForModelId("two-echelon-jade-us")` returns the entry; header renders JADE title AND an existing model's title (e.g. "AL's Athletics") is absent (ternary-fallback guard); Landing hides it (`hiddenFromLanding`).
- [ ] **Step 2–4:** Add entry; `pnpm --filter studio test` — PASS.
- [ ] **Step 5:** Commit `[jade-T9] chapter registration + header`.

**DoD:** `/chapter-9/jade` routes to the Workspace with the correct header; hidden from Landing.

---

### Task 10: Dataset endpoint + Dataset schema wiring

**Gates:** Gate 0 (envelope/dataset fields), Gate 6.5 effective-row projection input.

**Files:** `artifacts/api-server/src/data/dataset.ts` + route (JADE `GET /dataset` returns plants/products/warehouses/customers/capabilities); `referenceDistances.ts` (leg field); frontend dataset hooks/types.

**Interface:** JADE `Dataset` response includes `plants`, `products`, `plantProductCapabilities`, warehouses/customers with `name`+`sourceId`, customers with `demands`; `ReferenceDistancePair` carries `leg`. **These schemas + typed hooks come from T3.5's codegen** (predecessor); this task only wires the server handler to populate them and confirms the generated frontend hooks read them.

- [ ] **Step 1–4:** Route test: `GET /dataset?modelId=two-echelon-jade-us` returns 4 plants / 4 products / 25 wh / 100 customers / 16 capability cells; `GET /models/:id/reference-distances` returns 2600 pairs with `leg`. Frontend dataset-hook test.
- [ ] **Step 5:** Commit `[jade-T10] JADE dataset + reference-distances endpoints`.

**DoD:** frontend can fetch the full JADE dataset incl. the base capability matrix.

---

### Task 11: Input tabs — Plants, Capability Matrix, Warehouses, Customers, Optimization Params

**Gates:** Gate 6 left-panel scoping.

**Files:** new `artifacts/studio/src/components/workspace/tabs/{PlantsTab,CapabilityMatrixTab}.tsx`; extend `WarehousesTab`/`CustomersTab`/`OptimizationParametersTab` gated on capabilities; `lib/workspaceTabs.ts` tab registry for the model.

**Interface:** Plants tab — id/city/state/lat/lng read-only base + added rows. Capability Matrix — effective-plants × 4-products checkbox grid; base cells default from the 16-cell matrix, added-plant rows default off; each toggle writes/removes a sparse `plantProductCapability` override. Warehouses — status select (no capacity column). Customers — per-product demand + active/excluded. Optimization Params — P (max = effective active wh count), 4 bands, gap, max time. Tab registry gated on `supportsPlantProductCapability` (matrix), `supportsFacilityStatus` (status), etc. — never `modelId ===`.

- [ ] **Step 1:** RTL: capability matrix renders effective plants × 4 products, base diagonal checked; toggling a cell writes an override; added-plant row defaults all-off. Warehouses show no capacity column. P slider max tracks active wh count.
- [ ] **Step 2–4:** Implement; `pnpm --filter studio test` — PASS.
- [ ] **Step 5:** Commit `[jade-T11] JADE input tabs + capability matrix`.

**DoD:** all JADE input tabs render + persist their slice of `inputs`.

---

### Task 12: Input Map v2 (full editor) for JADE

**Gates:** Gate 6.5 (all BLOCKERs), Gate 1.10 (multi-select — note: `Studio.tsx` is legacy; the live surface is the Workspace `InputMapTab`; wire the Workspace path, and only touch `Studio.tsx` if the model is reachable there).

**Scope note (fix #4):** full plant create/edit/move/copy/delete is a **new third map entity kind** — the existing editor tree only knows warehouse/customer (and Ch10's mine/refinery/customer). It touches the map type system + entity-id system + every dialog surface, not just symbology. This is the heaviest task; the controller may split it into **T12a (plant entity kind: types/ids/symbology/projection)** and **T12b (map editor dialogs + added-entity distances)** if a single commit loses coherence.

**Files:**
- `artifacts/studio/src/…/map/types.ts` — add a plant `MapEntity` variant + plant input/view model (`MapPlant`) alongside `MapWarehouse`/`MapCustomer`; define the plant **role** (supply, non-demand).
- `artifacts/studio/src/lib/entityId.ts` — plant UID prefix (`ap-…`) in `newUid` + `nextDisplayCode` (`PL-STATE-CITY-SEQ`); ensure move never re-keys the plant `id`.
- `map/statusPresentation.ts` + `map/EntityMarkers.tsx` — plant=square/supply, warehouse=triangle, customer=demand bubble (bubble size from customer scalar `demand`); fold any status vocab into the shared presentation mapping, never a per-model ternary.
- `InputMapTab.tsx` — add JADE to the full-editor `mode` branch (symbology + legend + inspect); wire the create/edit/move/details/action **dialog surfaces** for the plant kind (a plant has no capacity/demand field and no status — its editable attributes are geometry + which products it can make via the capability matrix; the create/edit dialog reflects that).
- `Workspace.tsx` — effective-row projection `MapPlant`/`MapWarehouse`/`MapCustomer` = base ⊕ overrides ∪ added; added plants default every capability cell disabled. **Single Workspace.tsx writer for all of W3 (see concurrency map).**
- `services/autoDistance.ts` — JADE role-scoped estimators for plant↔wh and wh↔customer legs.
- `routes/scenarios.ts` — `normalizeAddedEntityDistances` JADE dispatch (shared-file: serialized w/ T4/T7/T8).
- `addedPlants[].displayCode` schema field already in T4.

**Interface:**
- `InputMapTab` renders the full editor for JADE (all three entity kinds), not the legacy/placeholder branch.
- Added-entity identity: `newUid` (role-prefixed opaque id — `ap-`/`aw-`/`ac-` — never re-keyed on move) + derived `displayCode`; `gazetteer.ts` reverse-geocodes the drop point.
- `normalizeAddedEntityDistances` JADE branch: fills missing added-entity distances on POST/PATCH/import-apply as `estimated` — **reverse-derive the notebook's per-leg circuity from all base pairs** and lock it with reconstruction tests (do not assume Ch10's plain-haversine or transport's 1.17); estimate only pairs with ≥1 added endpoint, per leg. `e2e_accuracy` unaffected (base rows untouched).
- Save reconciliation: Workspace Save `onSuccess` adopts response `inputs` (generic, not gated to p-median-us). Move regenerates only `displayCode`/coords + clears that entity's own distance rows; delete drops the added row + its own rows; neither touches `*Overrides`.

- [ ] **Step 1:** RTL/API tests: `InputMapTab` renders the full editor (markers + legend for all three kinds) for JADE, not legacy; a created **added plant** mints an `ap-`-prefixed uid + `PL-…` `displayCode` and defaults all capability cells off; the plant create/edit/move/copy/delete dialogs work (not just warehouse); the distance grid shows `displayCode` not the uuid; `normalizeAddedEntityDistances` fills `estimated` rows for JADE with the derived circuity on PATCH/POST/import-apply; a reconstruction test proves the derived factor(s) rebuild base distances within tolerance; move doesn't re-key the plant id; `e2e_accuracy.py` unchanged.
- [ ] **Step 2–4:** Implement; gate re-run.
- [ ] **Step 5:** Commit `[jade-T12] JADE Input Map v2 editor (3 entity kinds) + added-entity distances` (or T12a/T12b if split).

**DoD:** map-first create/edit/move/copy/delete for **plants, warehouses, and customers**; added entities auto-get estimated per-leg distances; overrides reflected on the map.

---

### Task 13: Output Map — leg-colored routes + layer toggles + semantic-leg classification

**Gates:** Gate 6 (unknown-leg neutral fallback), spec §4 semantic-leg classification.

**Files:** `NetworkMap.tsx` + map leg palette (extend to `plant_to_warehouse`/`warehouse_to_customer`) — standalone, owned by T13. The Output-Map **tab wiring into `Workspace.tsx`** (layer toggles + overlay placement) is applied by the T12 `Workspace.tsx` integrator (concurrency map), consuming T13's component via optional props — T13 does not edit `Workspace.tsx` directly.

**Interface:** one Output Map; layer checkboxes (plant→wh lanes, wh→customer lanes, markers) reproduce the notebook's inbound/outbound/combined; routes colored by leg; unknown/absent leg → neutral. Map coalesces per-product inbound edges sharing `(leg,fromId,toId)` into one line (summed flow). Floating objective + weighted-avg-distance overlay.

- [ ] **Step 1:** RTL: both JADE legs render distinct colors; toggling a layer hides that leg; an unknown leg value renders neutral (no throw); inbound product edges coalesce to one line.
- [ ] **Step 2–5:** Implement; commit `[jade-T13] JADE output map + leg palette`.

**DoD:** Output Map shows both legs with working toggles.

---

### Task 14: Output grids + band overflow

**Gates:** Gate 4 (overflow), spec §4/§6 grids, semantic-leg classification.

**Files:** `Open Warehouses`/`Customer Assignments`/`Flows`/`Solution Summary`/`Service Stats` tab components; `lib/bands.ts` (explicit overflow bucket, without regressing other models); output-grid gating on manifest `outputGrids`.

**Interface:** Customer Assignments consumes facility→demand legs (`warehouse_to_customer` + `refinery_to_customer`), one aggregated row/customer. Flows consumes source→facility legs (`plant_to_warehouse` + `mine_to_refinery`), per-product (`productId` shown + in CSV/JSON). Open Warehouses uses `metrics.openFacilityIds` (incl. zero-flow) + **demand-served tons** (no utilization %, `capacityModes:[]`). Solution Summary shows inbound vs outbound cost split + objective + flow-weighted avg distance. Service Stats: **cumulative** outbound-demand coverage at the four band boundaries (per approved spec §2.7) + a separately labelled `> 1600 mi` overflow row — overflow never folded into the last boundary. (Mirrors Phase C's cumulative Service-Stats rollup computed on top of `lib/bands.ts`'s exclusive per-band semantics — the exclusive buckets from T5 are rolled up cumulatively at the Reports/Service-Stats layer, not re-derived.)

- [ ] **Step 1:** RTL: all five grids render; Open Warehouses shows demand-served not "%" and lists a zero-flow forced-open wh; Flows shows per-product rows; Customer Assignments aggregated one-per-customer; Service Stats shows **cumulative** coverage at the four boundaries + the `> 1600 mi` overflow row (overflow not absorbed). Confirm p-median-us/Ch10 band rendering unregressed.
- [ ] **Step 2–5:** Implement; commit `[jade-T14] JADE output grids + band overflow`.

**DoD:** all five grids correct; overflow explicit; no regression to other models' bands.

---

### Task 15: Distances tab + export/import buttons

**Gates:** Gate 6.5 displayCode-in-grid, spec §6 Distances.

**Files:** `DistancesTab` (JADE: single `distances.json`, visible Leg column, `(leg,fromId,toId)` identity, base reference + editable overrides both legs, paginated/filtered, `displayCode` for added entities); export/import buttons wired to T8 routes.

- [ ] **Step 1:** RTL: reference distances load (2600 pairs) with a Leg column; editing a pair writes a leg-discriminated override → "Changed"; added-entity rows show `displayCode` not uuid; export/import buttons present.
- [ ] **Step 2–5:** Implement; commit `[jade-T15] JADE Distances tab + export/import buttons`.

**DoD:** Distances tab shows both legs; overrides persist; import/export wired. **Wave 3 exit: full Workspace UI.**

---

## Wave 4 — QA + verify gate + rollout

### Task 16: QA (Playwright) + full-gate re-verification

**Gates:** Gate 7 (all), Gate 8 (rollout proof).

**Files:** `artifacts/studio/e2e/jade-two-echelon.spec.ts`; `Workspace.TabCoverage` sweep extended.

- [ ] **Step 1:** `qa-sdet` Playwright against local dev servers (real api-server + studio via `API_PROXY_TARGET`): register a fresh account; create a JADE scenario; solve → objective matches; toggle a capability cell → solution changes; verify leg-colored routes + layer toggles; all five output grids; capability-matrix persistence across save/reload; add a warehouse on the Input Map → estimated distances appear; import/export a customers CSV round-trip. Assert the header shows JADE (and not an existing model's title). Run twice (flake check). Clean up test accounts.
- [ ] **Step 2:** Full gate: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x) && python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`. All green; `e2e_accuracy` = 87 pre-existing + JADE section. **`e2e_journey.py` is NOT run and NOT a gate** (non-runnable, legacy `/login`; see Global Constraints).
- [ ] **Step 3:** Commit `[jade-T16] JADE QA e2e + tab coverage`.

**DoD:** QA green twice; full gate green; no product bugs.

---

### Task 17: Verify gate → unhide (browser, controller)

**Gates:** Gate 8 rollout.

- [ ] In-browser verify gate (`claude-in-chrome`, local dev): interactively confirm the BOM-free JADE model — capability matrix, plants echelon markers, leg-colored routes, layer toggles, all grids, a real solve reproducing `254060828.6157` for the forced Phoenix+NY config.
- [ ] Flip `hiddenFromLanding` off in `chapters.ts` (Ch9 only); update the affected Landing/Login/AppShell/bundle e2e assertions (labs count, card present) — same edit class as the Ch10 unhide.
- [ ] Commit `[jade-T17] unhide Chapter 9 on Landing`; full gate green.

**DoD:** Chapter 9 visible on Landing; all visibility tests updated.

**Deploy** (outward-facing — **surface + confirm with the user before triggering**, per standing rule): push `jade-ch9` → finish per `finishing-a-development-branch` (merge to main) → deploy `nos-studio` + `nos-api` (manual `trigger_deploy`) → live-verify `GET /api/models` = 5, a live JADE solve = `254060828.6157`, SPA route `/chapter-9/jade` 200 → clean up test accounts.

---

## Self-Review

- **Spec coverage:** §2 model → T5; §2.1 canonical IDs → T1/T2; §2.7 ground truth → T5/global; §3 package → T1/T2; §4 solver/envelope → T5/T6; §5 contract → T3/T4/T7/T8; §6 frontend → T9–T15; §7 verification → per-task tests + T16; §8 rollout → waves + T17. All spec sections mapped.
- **Precheck gates:** Gate 0→T1/T5/T10; Gate 1 ten points→T1(2),T2(1,5),T3(listability)+T6(full consistency),T4(3,4),T3.5(codegen 7),T5(8),T6(6),T8(9),T12(10); Gate 2→T1; Gate 3→T5; Gate 4→T5/T14; Gate 5→T5(same-commit)+T3.5(spec+regen same-commit); Gate 6→T9/T11/T13/T14; Gate 6.5→T12/T15; Gate 7→all tests+T16; Gate 8→T16/T17. All gates mapped.
- **Type consistency:** canonical id format, `modelType:"two_echelon_jade"`, leg enum values, capability `enabled`↔wire `0/210000000`, and `distanceOverrides.leg` are used identically across T1–T15.
- **No placeholders:** load-bearing interfaces (schemas, wire payload, envelope fields, manifest) are exact; large bodies (solver port, tab components) reference spec §2 + the named sibling files as templates, which the agent-team implementer reads — consistent with this repo's plan style.

## Review Findings — 2026-09-13 (`a35ec1c`)

**Status: changes required before execution.** The following findings were verified against the implementation plan, the approved design spec, and the current integration code.

1. **[P1] Assign the complete OpenAPI contract and regeneration before T10.** T10 says OpenAPI was extended in T3, but T3 does not touch `openapi.yaml`, and T8 only assigns import/export enum changes. The contract task must add `two-echelon-jade-us` to the dataset/scenario model enums; add plants, products, plant-product capabilities, JADE warehouse/customer fields, and `ReferenceDistancePair.leg`; extend the result edge/metrics contract; run orval; and commit spec plus generated clients together. T10 cannot provide typed frontend hooks without this predecessor.
2. **[P1] Move or split the T3 registration consistency gate.** Adding JADE to `SOLVABLE` makes `registration.test.ts` require `VALID_MODEL_IDS`, a known input schema, `buildPayload`, and a `solve.py` dispatcher before T4–T6 provide them. Keep Wave 1's listability proof as a separate registry/manifest test, then add JADE to the full registration consistency test after T6. Correct the test path to `artifacts/api-server/src/registry/__tests__/registration.test.ts`.
3. **[P1] Use cumulative Service Stats coverage.** T5 and T14 currently specify exclusive band coverage. The approved spec requires cumulative outbound-demand coverage at the four boundaries plus a separately labelled overflow row. Update both interfaces and their tests; do not fold overflow into the last boundary.
4. **[P1] Expand T12 to cover the actual third map entity kind.** Full plant create/edit/move/copy/delete cannot be implemented through the files currently listed. Add `map/types.ts`, `lib/entityId.ts`, the create/edit/move/details/action dialog surfaces, and their tests. Define a plant `MapEntity` variant, plant input/view models, plant role, stable plant UID/display-code prefix, and per-product capability defaults. Add plant-specific editor tests; the current checklist exercises only an added warehouse.
5. **[P1] Repair the single-writer/concurrency map.** `routes/scenarios.ts` is touched by T4, T7, T8, and T12 despite being assigned solely to T8. `Workspace.tsx` is touched by both T12 and T13 despite being assigned solely to T12. Serialize these tasks or assign each shared file to one integration task; do not dispatch the stated lanes as file-disjoint.
6. **[P1] Remove `e2e_journey.py` from the JADE gate or explicitly rewrite it.** The script is fully non-runnable because it authenticates through the removed legacy `/login` flow. The global constraint that it “must pass” conflicts with T16 leaving it unchanged and not running it. `e2e_accuracy.py` remains the solver-accuracy gate; a journey rewrite needs its own scoped task before it can count as coverage.
7. **[P2] Choose one payload/merge boundary in T6.** The established architecture has TypeScript forward validated scenario edits while Python loads the base dataset and performs a fresh, non-mutating merge per solve. T6 instead requires `buildPayload` to construct the full base-plus-edits dataset while also assigning `merge_inputs.py` “or the TS merge path.” Retain the current Python merge boundary unless the plan deliberately specifies and tests a broader architectural change.
8. **[P2] Make T1's extraction language match its method.** A TypeScript file cannot directly use Python `ast`/`ast.literal_eval`. Prefer a committed Python extractor, or explicitly specify a Python helper/subprocess boundary while keeping the notebook non-executable.

Execution should not begin until the P1 findings are incorporated into task ordering, file ownership, interfaces, and gates.

### Resolution — 2026-09-13 (all 8 incorporated)

1. **[P1] Contract task** — new **Task 3.5 (OpenAPI contract + codegen, full sweep)** added as predecessor of T4/T8/T10/W3; it owns all `openapi.yaml` edits + the single codegen pass. T3 no longer claims codegen; T8 consumes generated types (no `openapi.yaml` edit).
2. **[P1] Registration split** — T3 is **listability-only** at the correct path `artifacts/api-server/src/registry/__tests__/registration.test.ts`; JADE joins the full `SOLVABLE` consistency test in **T6** (after its solve path exists).
3. **[P1] Cumulative Service Stats** — envelope `bandCoverage` stays exclusive+overflow (no per-model divergence); **T14 rolls up cumulatively at the display layer** per spec §2.7; T5/T14 interfaces + tests updated.
4. **[P1] T12 plant entity kind** — files expanded to `map/types.ts`, `lib/entityId.ts`, plant `MapEntity`/role/UID(`ap-`)/`displayCode`(`PL-…`)/capability defaults, plant create/edit/move/copy/delete dialogs + plant-specific tests; T12 may split into T12a/T12b.
5. **[P1] Concurrency map** — `routes/scenarios.ts` serialized across T4/T7/T8/T12; `Workspace.tsx` wired by a single T12 integrator via the optional-props pattern (T11/T13/T14/T15 ship standalone). Both wave headers rewritten.
6. **[P1] e2e_journey.py** — removed from the JADE gate in Global Constraints + T16 (non-runnable, out of scope); `e2e_accuracy.py` is the solver gate.
7. **[P2] Payload/merge boundary** — T5/T6 corrected to the established boundary: `buildPayload` forwards **edits only**; `solve.py` loads the base package from disk; `merge_inputs.py`'s new `build_merged_jade_dataset` merges. Verified against `pmedian.ts`/`solve.py`.
8. **[P2] Extractor language** — T1 extractor is a committed **Python** script (`ast`/`ast.literal_eval`), not `.ts`.

## Execution Handoff

Executed by the **agent team** (user's standing default), waved as above with two-lane concurrency + single-writer serialization. Controller cherry-picks each task onto `jade-ch9`, re-runs the gate on the merged state, records progress, and runs a final whole-branch review before T17. QA (T16) is a first-class in-plan task (standing rule), not retrofitted.
