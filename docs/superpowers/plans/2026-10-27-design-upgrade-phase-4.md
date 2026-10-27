# Design Upgrade Phase 4 Implementation Plan (multi-echelon / multi-product)

> **Execution:** agent-team dispatch per `AGENTS.md`, as in Phases 1–3.
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-4.N -b du-4.N-work <design-upgrade-p4 tip>`) and dispatches without `isolation`. The agent's first Bash command is `cd` plus a branch check. The lead cherry-picks each commit onto `design-upgrade-p4`.
> - **Roles (Q8):** DU-4.1, DU-4.2 and DU-4.3 are cross-layer contract tasks (units + api-server + OpenAPI/Orval + studio), each one commit, so each goes to **one** `backend-engineer` whose brief lists the studio files explicitly. DU-4.4 is studio-only: `frontend-engineer`. The lead reviews each on Opus with `ponytail-review`. DU-4.5: `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - Tasks run sequentially, in listed order, and every task's commit is green on its own. Steps use checkbox (`- [ ]`) syntax.

**Goal:** implement spec §5.4 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md`). That covers:
- per-leg distance bands for the two two-echelon models with bands (`two-echelon-jade-us`, `two-echelon-gold-au`): an optional `inboundDistanceBands` input, a field-scoped write route, one `bandsForLeg` adapter used by every consumer, and a second band editor (G9);
- the export `distance_band` label moving from `Band N` / `Overflow` to the range text, on a grid-local template version (G6, export part);
- an "Inbound lanes" table on Service Stats, plus its export section;
- collapsing product repetition in JADE Customer Assignments, Plant Production and the Capability Matrix (G8).

**Architecture:**
- **One adapter, in `@workspace/units`:** `bandsForLeg(leg, inputs)`, with the leg role sets moved there from the studio's `lib/legPalette.ts` and from `units/bands.ts`'s private copy. Server and studio both call it; nothing re-implements the choice.
- **Studio state:** a second lens beside `activeBandLens`, `activeInboundBandLens: number[] | null` (`null` = key absent = fallback). It is saved through the new field-scoped route, exactly as the existing lens is saved through `useUpdateDistanceBands`.
- **Exports:** the two JADE grids move to their own envelopes at `JADE_EXPORT_TEMPLATE_VERSION = 4`; the generic assignments/flows envelopes stay at v3. Service Stats moves to `SERVICE_STATS_TEMPLATE_VERSION = 4` when its row shape gains the inbound section.
- **Unchanged:** `solve.py`, every result envelope, the DB schema (`inputs` is jsonb), entity import, `e2e_accuracy.py`, `e2e_journey.py`.

**Tech stack:** React 18 + Vite + Tailwind v4, vitest + RTL, Playwright; Express + Drizzle + hand-written Zod validators; `@workspace/units`; Orval from `lib/api-spec/openapi.yaml`.

## Global Constraints

The master plan's Global Constraints (`2026-10-24-design-upgrade.md:22-56`) bind every task. In addition:

**Contracts**
- Fixed interface (master §A, verbatim):
  ```ts
  // @workspace/units
  export const INBOUND_LEGS: ReadonlySet<string>;
  export const OUTBOUND_LEGS: ReadonlySet<string>;
  export function bandsForLeg(
    leg: string | null | undefined,
    inputs: { distanceBands: number[]; inboundDistanceBands?: number[] },
  ): number[]; // inbound -> inboundDistanceBands ?? distanceBands; otherwise distanceBands
  ```
- Fixed route (master §A): `PATCH /scenarios/:scenarioId/inbound-distance-bands`, body `{ inboundDistanceBands: number[] }`, one `jsonb_set`, no `inputsUpdatedAt` bump, 404 when not owned. OpenAPI path + Orval regen in the same commit (DU-4.1).
- `inboundDistanceBands` goes into each manifest's `inputsSchema.properties` and **never** into `required[]`.
- Hard rules #1 (never hand-edit generated code), #5 (`user_id` filter, 404 never 403) and #6 (no solver branches) apply. `pmedian.ts` builds the solver input by naming fields (`:29-297`), so the new key never reaches `solve.py`; do not add it there.
- **Remove consumers before producers:** `bandLabelOrOverflow` is deleted in DU-4.2, in the same commit that moves its last two callers (server JADE builders and `JadeFlowsTab`'s client export) to the range label.

**Content rules**
- Reuse the Phase 2/3 authorities: `bandRangeLabel`, `BandLabel`, `formatDistanceDisplay`, `formatDistanceNumber`, `Chapter.demandUnit` / `demandHeader` (`lib/chapters.ts:11,136,144`).
- The second band editor is labelled **"Inbound lanes"** with the role pair from the model (Q2); the existing editor is relabelled **"Customer-facing lanes"** only for models that show both.
- No invented figures: the inbound table is computed from `result.edges` only.

**Per-task obligations**
- **Sweep:** rg `artifacts/studio/src`, `artifacts/studio/e2e/`, `artifacts/api-server/src` and `lib/` for every changed testid, string, prop, export header and version literal, and fix all hits in the same commit. Each task lists its known affected tests; the sweep catches the rest.
- **Changelog:** append `### DU-4.N — …` to `docs/CHANGELOG-implementation.md` in the same commit.
- **Gate (per task):** `pnpm run typecheck`, `pnpm --filter api-server test`, `pnpm --filter studio test`, `pnpm --filter @workspace/units test` (if units changed), `pnpm --filter studio run typecheck:e2e`, with zero concurrent vitest, one suite at a time, never `pkill`. `pnpm gate` exit 3 means re-run serially, not failure.
- **Gate (close-out):** `pnpm gate`, `E2E_BASE_URL=http://localhost:<port> pnpm e2e:gate`, and `python3 e2e_accuracy.py` + `python3 e2e_journey.py <BASE_URL> <section>` for every section, run directly from `artifacts/api-server/src/solver/tests/` (master Global Constraints: Phase 4 is a server/API phase).
- **Commit:**
  1. Guard the branch: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`.
  2. Build a static path list `P`, stage it, and check `git diff --cached --name-only` equals `P`.
  3. `git commit --only ${=P} -m "[DU-4.N] …"` (no `--` before the paths; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- `docs/model-integration-precheck.md` is **mandatory reading** for DU-4.1–4.3 (spec §5.4.1); each brief cites its Gates 1, 6 and 6.5 (shared allowlists extended for one model and forgotten for a sibling).

## Decisions (recommended defaults applied; to confirm before execution)

| ID | Default applied | Task |
|---|---|---|
| Q1 | **Validation mirrors each model's own `distanceBands` rule.** JADE's schema refines strictly-ascending; gold's does not. Each schema declares its band array once (`const bandsSchema = …`) and uses it for both keys (`inboundDistanceBands: bandsSchema.optional()`), so the two keys can never drift. This is stricter than the spec's literal `z.array(z.number().positive()).min(1).optional()` for JADE only, deliberately. | 4.1 |
| Q2 | Editor labels: existing editor "Customer-facing lanes (warehouse → customer)" on JADE / "(refinery → customer)" on gold; new editor "Inbound lanes (plant → warehouse)" on JADE / "(mine → refinery)" on gold. The role words come from the model's map `EntityRoleConfig`. Single-echelon models keep today's "Distance bands" label unchanged. | 4.1 |
| Q3 | **The second editor appears when the model's manifest `inputsSchema.properties` contains `inboundDistanceBands`** (helper `hasInboundBands(inputsSchema)`, the `lib/integerDemand.ts:4-5` precedent). No new capability flag, no OpenAPI capability change. | 4.1 |
| Q4 | **No "clear" path.** When the key is absent the inbound editor is seeded with a copy of the customer-facing bands and shows the hint "Using the customer-facing bands until you change these." The first edit writes the key; from then on the two sets are independent. The route's body stays `{ inboundDistanceBands: number[] }` exactly as master §A fixes it. A reset-to-fallback control is deferred until someone asks for it. | 4.1 |
| Q5 | The inbound editor lives on Optimization Parameters only. `SolveDialog`'s band editor stays single (customer-facing) — the solve dialog configures the solve, and inbound bands never reach the solver. | 4.1 |
| Q6 | **JADE exports get their own envelopes at v4.** `AssignmentsExportEnvelope` and `FlowsExportEnvelope` today admit both generic and JADE rows under one `enum: [3]` (`openapi.yaml:2571-2613`). DU-4.2 splits them: `JadeAssignmentsExportEnvelope` / `JadeFlowsExportEnvelope` (`enum: [4]`, JADE rows only) join `ExportEnvelope.oneOf`; the generic envelopes keep `enum: [3]` with generic rows only. `templateVersion` makes the `oneOf` unambiguous even for empty `rows`. Every non-JADE model's export is byte-identical. | 4.2 |
| Q7 | **Generic flows stay v3.** gold's `mine_to_refinery` rows classify against `bandsForLeg` from DU-4.1, so their numeric `band` index is relative to the inbound set when one is saved. The shape is unchanged and an existing scenario (key absent) exports byte-identically, so no consumer's file changes; DU-4.2 documents the per-leg meaning in `FlowExportRow.description` instead of bumping a version shared with transport-coal (which has no legs and earned no bump). | 4.1, 4.2 |
| Q8 | One agent per cross-layer task (backend-engineer for DU-4.1–4.3, studio files listed in the brief), because a contract change is one commit and splitting one commit across two agents in one worktree invites a half-done handoff. | all |
| Q9 | **Service Stats export section shape (v4, all models):** every row gains `section: "outbound" \| "inbound"` and a nullable `flow`. Outbound rows are today's cumulative rows unchanged (`flow` null / blank). Inbound rows (two-echelon only) are **exclusive** per band: `band` = the band's upper boundary in the requested unit (`-1` = overflow, never converted), `flow` = summed inbound flow, `percent` = share of total inbound flow. CSV header `template_version,section,band,distance_unit,percent,flow`. | 4.3 |
| Q10 | **Assignments "expand" is an in-cell disclosure, not injected sub-rows.** `DataTable` has no row expansion (`components/data-table/DataTable.tsx`), and injecting child rows breaks its sort, filter and paging. A split customer's row shows "Split (n warehouses)" as a button; pressing it reveals a per-product list (product → warehouse · distance · band) inside the row. Split rows show "—" for Distance and Distance Band; the warehouse filter offers each warehouse plus "Split". | 4.4 |
| Q11 | Plant Production: rows with zero enabled capacity are hidden by default behind a "Show disabled plant-products" switch; "Remaining capacity" becomes "Utilization %" = `actual / capacity × 100`, 0 dp, "—" when capacity is 0. | 4.4 |
| Q12 | Production row re-count (spec §5.4.1) is a **pre-deploy step**, not a planning step: the hosted Render MCP cannot reach the database (IP allowlist, tried 2026-10-27). SQL in "Phase 4 close-out". The key is optional, so the count is informational: no existing row can fail validation because of it. | close-out |

All paths below are relative to the repo root unless noted. Studio paths are under `artifacts/studio/src/`, server paths under `artifacts/api-server/src/`.

---

### Task DU-4.1: `inboundDistanceBands` end to end (one atomic commit)

**Role:** backend-engineer (studio files listed below are part of this brief). Invoke `karpathy-guidelines` + `ponytail` first, `ponytail-review` before committing. Read `docs/model-integration-precheck.md` Gates 1, 6, 6.5.

**Files:**
- Modify `lib/units/src/bands.ts` — export `INBOUND_LEGS`, `OUTBOUND_LEGS`, `bandsForLeg`; `serviceEdgesFor` uses the exported `OUTBOUND_LEGS`.
- Modify `lib/units/src/__tests__/bands.test.ts`.
- Modify `artifacts/studio/src/lib/legPalette.ts` — import the two sets from `@workspace/units` (delete the local copies at `:20-21`).
- Modify `artifacts/api-server/src/validation/inputs/jadeInputs.ts:193-244`, `artifacts/api-server/src/validation/inputs/twoEchelon.ts:86-122` (+ their tests under `validation/inputs/__tests__/`).
- Modify `solvers/two-echelon-jade-us/manifest.json`, `solvers/two-echelon-gold-au/manifest.json` (`properties` only).
- Modify `artifacts/api-server/src/validation/formatInputIssues.ts` — label `inboundDistanceBands: "Inbound distance bands"` (the coverage test iterates every `properties` key).
- Modify `artifacts/api-server/src/routes/distanceBands.ts` — second handler.
- Modify `artifacts/api-server/src/services/scenarioInputWrite.ts:134` — reporting-only key set.
- Modify `artifacts/api-server/src/routes/scenarios.ts:771-825`, `artifacts/api-server/src/services/templates.ts` (`buildFlowRows` :1883-1903, `buildJadeFlowRows` :2059-2113).
- Modify `lib/api-spec/openapi.yaml` (new path after `:803-841`) + regenerate `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`.
- Studio: `pages/Workspace.tsx`, `components/workspace/tabs/OptimizationParametersTab.tsx`, `components/workspace/tabs/BandChipEditor.tsx` (label prop), `components/workspace/tabs/OutputMapTab.tsx`, `components/NetworkMap.tsx`, `components/workspace/map/MapLegend.tsx`, `components/workspace/tabs/JadeFlowsTab.tsx`, new `lib/inboundBands.ts`.
- Tests: `__tests__/routes.test.ts` (api), `solver/__tests__/scenarioSolveAtomicity.test.ts` (real Postgres), `__tests__/lockedModelGuards.test.ts` (must still pass unchanged), studio `__tests__/NetworkMap.test.tsx`, `OutputMapTab.test.tsx`, `JadeFlowsTab.test.tsx`, `OptimizationParametersTab.test.tsx`, `Workspace.Jade.test.tsx`, `Workspace.TwoEchelon.test.tsx`, `legPalette.test.ts`, new `__tests__/inboundBands.test.ts`.

**Interfaces:**
- Produces (units): the master §A block above, verbatim.
- Produces (studio): `hasInboundBands(inputsSchema: Record<string, unknown> | undefined): boolean` in `lib/inboundBands.ts`; `NetworkMap` prop `inboundBands?: number[]` and `inboundLabelBands?: number[]`; `MapLegend` prop `inboundBands?: number[]`; `JadeFlowsTab` prop `inboundBands?: number[] | null`; `OptimizationParametersTab` props `inboundDistanceBands?: number[]`, `inboundBandsLabel?: string`, `outboundBandsLabel?: string`.
- Produces (api): generated hook `useUpdateInboundDistanceBands` (operationId `updateInboundDistanceBands`).
- Consumed by DU-4.2 (`bandsForLeg` in the JADE builders), DU-4.3 (`bandsForLeg`, `INBOUND_LEGS`), DU-6.1 (the route).

- [ ] **Step 1: units — failing tests first.** Add to `lib/units/src/__tests__/bands.test.ts`:

```ts
describe("bandsForLeg (DU-4.1)", () => {
  const inputs = { distanceBands: [200, 400], inboundDistanceBands: [500, 1500] };
  it("inbound legs read inboundDistanceBands", () => {
    expect(bandsForLeg("plant_to_warehouse", inputs)).toEqual([500, 1500]);
    expect(bandsForLeg("mine_to_refinery", inputs)).toEqual([500, 1500]);
  });
  it("inbound legs fall back to distanceBands when the key is absent (Q7)", () => {
    expect(bandsForLeg("plant_to_warehouse", { distanceBands: [200, 400] })).toEqual([200, 400]);
  });
  it("outbound, unknown and absent legs read distanceBands", () => {
    for (const leg of ["warehouse_to_customer", "refinery_to_customer", "typo_leg", null, undefined]) {
      expect(bandsForLeg(leg, inputs)).toEqual([200, 400]);
    }
  });
  it("role sets are the one authority", () => {
    expect([...INBOUND_LEGS].sort()).toEqual(["mine_to_refinery", "plant_to_warehouse"]);
    expect([...OUTBOUND_LEGS].sort()).toEqual(["refinery_to_customer", "warehouse_to_customer"]);
  });
});
```

Run `pnpm --filter @workspace/units test` — expect FAIL (`bandsForLeg` not exported).

- [ ] **Step 2: units — implement.** In `lib/units/src/bands.ts`, replace the private `const OUTBOUND_LEGS = …` (`:9`) with:

```ts
/** DU-4.1 — the ONE leg-role authority (moved from studio lib/legPalette.ts). */
export const INBOUND_LEGS: ReadonlySet<string> = new Set(["mine_to_refinery", "plant_to_warehouse"]);
export const OUTBOUND_LEGS: ReadonlySet<string> = new Set(["refinery_to_customer", "warehouse_to_customer"]);

/** DU-4.1 — the ONE band-set choice per leg. Inbound legs use the scenario's
 *  inboundDistanceBands when saved, else distanceBands (spec Q7); every other
 *  leg, including none at all, uses distanceBands. */
export function bandsForLeg(
  leg: string | null | undefined,
  inputs: { distanceBands: number[]; inboundDistanceBands?: number[] },
): number[] {
  return leg != null && INBOUND_LEGS.has(leg) ? inputs.inboundDistanceBands ?? inputs.distanceBands : inputs.distanceBands;
}
```

`serviceEdgesFor` keeps its body; it now reads the exported set. In studio `lib/legPalette.ts` delete `:20-21` and add `import { INBOUND_LEGS, OUTBOUND_LEGS } from "@workspace/units";`. Run units + `legPalette.test.ts` — PASS.

- [ ] **Step 3: validation — failing tests.** In `validation/inputs/__tests__/jadeInputs.test.ts` and the two-echelon test: (a) a valid input **with** `inboundDistanceBands: [300, 900]` parses and **retains** the key; (b) a valid input **without** it parses and the key stays absent (`"inboundDistanceBands" in parsed === false`); (c) `[]`, `[0]`, `[-5]` are rejected; (d) JADE rejects `[900, 300]` (Q1), gold accepts it (same as gold's `distanceBands`). Run — FAIL on (a).

- [ ] **Step 4: validation — implement.** JADE (`jadeInputs.ts:198-204`): hoist the existing refined array into `const bandsSchema = z.array(z.number().positive()).min(1).refine(…same message, with "distanceBands" replaced by "Bands"…)` and use `distanceBands: bandsSchema, inboundDistanceBands: bandsSchema.optional(),`. Keep the old message text for `distanceBands` if any test pins it (grep `strictly-ascending`). Gold (`twoEchelon.ts:99`): `const bandsSchema = z.array(z.number().positive()).min(1);` then `distanceBands: bandsSchema, inboundDistanceBands: bandsSchema.optional(),`. No `.default(…)` — absent must stay absent (same reasoning as `jadeInputs.ts` `transportCosts`). Manifests: add beside `distanceBands`

```json
"inboundDistanceBands": {
  "type": "array",
  "items": { "type": "number", "exclusiveMinimum": 0 },
  "minItems": 1,
  "description": "Optional inbound-leg reporting lens; absent = inbound lanes use distanceBands"
},
```

Do **not** touch `required`. Add the `INPUT_FIELD_LABELS` entry. Run the validation tests, `formatInputIssues.test.ts`, `registration.test.ts`, `lib/dataset-schema` tests — PASS.

- [ ] **Step 5: reporting-only on the general PATCH — failing test.** In `solver/__tests__/scenarioSolveAtomicity.test.ts` beside `:514-525`, add: "a PATCH /scenarios/:id whose sole changed inputs key is inboundDistanceBands does NOT increment solve_input_revision" (JADE scenario; assert `solve_input_revision` and `inputsUpdatedAt` unchanged, `stale === false` on a solved row). Also: "changing distanceBands and inboundDistanceBands together is still reporting-only". Run — FAIL.

- [ ] **Step 6: implement.** `services/scenarioInputWrite.ts:134`:

```ts
// DU-4.1 — both band lenses are reporting-only (spec Q3): a save whose changed
// keys are all lens keys never bumps the epoch.
const REPORTING_ONLY_KEYS = new Set(["distanceBands", "inboundDistanceBands"]);
const isBandsOnlyChange = [...changed].every((k) => REPORTING_ONLY_KEYS.has(k));
```

Update the comment block at `:115-125` to name both keys, and `:64-66` to name both field-scoped routes. Run — PASS.

- [ ] **Step 7: field-scoped route — failing tests.** In `__tests__/routes.test.ts`, mirror the `describe("PATCH /api/scenarios/:scenarioId/distance-bands …")` block (`:2646-2770`) as `describe("PATCH /api/scenarios/:scenarioId/inbound-distance-bands (DU-4.1)")`: 200 + returned `inputs.inboundDistanceBands` for an owned JADE scenario; 404 for another user's id and for a missing id (never 403); 400 for `{}`, `{ inboundDistanceBands: [] }`, `[0]`; 400 for JADE `[900, 300]`; 401 unauthenticated; locked model → the lock response, with no write. In `scenarioSolveAtomicity.test.ts` (real Postgres): the route leaves `inputsUpdatedAt` and `solve_input_revision` unchanged and `stale` false on a solved scenario, and a concurrent write to another `inputs` key is preserved (one `jsonb_set`). Run — FAIL (404 route missing).

- [ ] **Step 8: implement the route** in `routes/distanceBands.ts`, after the existing handler, sharing its `toApiScenario`:

```ts
// DU-4.1 — field-scoped update of inputs.inboundDistanceBands only. Same
// contract as the distance-bands route above: one jsonb_set (never a
// read-modify-write of inputs), no inputsUpdatedAt bump (a reporting lens,
// spec Q3), 404 for a scenario the caller does not own, validated by the
// model's own schema so a model without the key keeps rejecting nothing it
// accepted before and JADE keeps its ascending rule.
const inboundBandsBodySchema = z.object({
  inboundDistanceBands: z.array(z.number().positive()).min(1),
});

router.patch("/scenarios/:scenarioId/inbound-distance-bands", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const parsedBody = inboundBandsBodySchema.safeParse(req.body);
  if (!parsedBody.success) { res.status(400).json({ error: "Invalid inboundDistanceBands" }); return; }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }
  if (isModelLocked(scenario.modelId)) { respondLocked(res); return; }

  const candidateInputs = { ...(scenario.inputs as Record<string, unknown>), inboundDistanceBands: parsedBody.data.inboundDistanceBands };
  const revalidated = validateInputsForModel(scenario.modelId, candidateInputs);
  if (!revalidated.success || !("inboundDistanceBands" in revalidated.data)) {
    // The second clause rejects a model whose schema strips the key (every
    // single-echelon model): writing it would persist a value nothing reads.
    res.status(400).json({ error: "Invalid inboundDistanceBands for this model" });
    return;
  }

  const [row] = await db.update(scenariosTable)
    .set({
      inputs: sql`jsonb_set(${scenariosTable.inputs}, '{inboundDistanceBands}', ${JSON.stringify(parsedBody.data.inboundDistanceBands)}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();

  res.json(toApiScenario(row));
});
```

Add a test: p-median-us scenario → 400 (its `z.object()` strips the key). `validateInputsForModel` returns `{ success: true; data: Record<string, unknown> } | { success: false; … }` (`registry/modelRegistry.ts:130-132`), so the stripped-key check reads `revalidated.data`. Run the route tests and `lockedModelGuards.test.ts` — PASS.

- [ ] **Step 9: OpenAPI + Orval.** In `lib/api-spec/openapi.yaml`, after the `/scenarios/{scenarioId}/distance-bands` path (`:803-841`), add `/scenarios/{scenarioId}/inbound-distance-bands` with `operationId: updateInboundDistanceBands`, the same parameter and response block, body `required: [inboundDistanceBands]`, `inboundDistanceBands: { type: array, minItems: 1, items: { type: number, exclusiveMinimum: 0 } }`, description naming the two-echelon models, the fallback, the reporting-only rule and the 400 for models without the key. Regenerate with `pnpm --filter @workspace/api-spec run codegen` (runs Orval, then `typecheck:libs`; confirm the package name with `jq -r .name lib/api-spec/package.json`). Commit the spec and the regenerated output together.

- [ ] **Step 10: server consumers via `bandsForLeg`.** `routes/scenarios.ts:777` and `:797`: build one lens object

```ts
const inputsLens = scenario.inputs as { distanceBands?: number[]; inboundDistanceBands?: number[] };
const savedLens = { distanceBands: inputsLens.distanceBands ?? [], inboundDistanceBands: inputsLens.inboundDistanceBands };
```

and for the JADE branch `{ distanceBands: inputsLens.distanceBands ?? [200, 400, 800, 1600], inboundDistanceBands: inputsLens.inboundDistanceBands }` (keeps the solve.py default fallback). Change `buildJadeFlowRows(result, lens, canonicalUnit, requestedUnit)` and `buildFlowRows(result, canonicalUnit, requestedUnit, lens)` to take `lens: { distanceBands: number[]; inboundDistanceBands?: number[] }` instead of `bands` / `savedBands`, classifying each row with `bandsForLeg(e.leg, lens)` (JADE inbound rows: `bandsForLeg("plant_to_warehouse", lens)`). `buildJadeAssignmentRows`, `buildAssignmentRows` and `buildServiceStatsRows` are outbound-only and keep taking `lens.distanceBands`. Update every caller of the changed signatures (rg `buildJadeFlowRows\|buildFlowRows`). Tests in the api-server export suites: a JADE scenario with `inboundDistanceBands: [100]` exports its `plant_to_warehouse` rows banded against `[100]` and its outbound rows against `distanceBands`; the same scenario without the key exports byte-identically to before (snapshot the CSV); a gold scenario's `mine_to_refinery` `band` index follows the inbound set.

- [ ] **Step 11: studio state and save path.** In `pages/Workspace.tsx`:
  - beside `:1618` add `const [activeInboundBandLens, setActiveInboundBandLens] = useState<number[] | null>(null);` seeded at `:1625-1627` from `Array.isArray(inputs?.inboundDistanceBands) ? inputs.inboundDistanceBands : null`, plus a `savedInboundBandLensRef` mirroring `savedBandLensRef`;
  - `const updateInboundDistanceBandsMutation = useUpdateInboundDistanceBands();` beside `:1481`;
  - `handleOptimizationParamsChange` (`:1980-1986`): `if (field === "inboundDistanceBands") { setActiveInboundBandLens(value as number[]); return; }`;
  - `lensDirty` (`:1943`) also compares the inbound lens to its ref;
  - `handleSaveBandsOnly` (`:2229-2251`) saves each lens that is dirty through its own mutation, each with the existing `onError: … describeWriteError` pattern (the `mutationErrorSurface.test.ts` guard reads this file — every new `.mutate(` needs an `onError`);
  - `buildWholeInputPayload` (`:2113-2117`) and the clone merge (`:3273`): add `...(activeInboundBandLens ? { inboundDistanceBands: activeInboundBandLens } : {})` so the key stays absent when it was absent;
  - pass `inboundBands={activeInboundBandLens}` to `OutputMapTab` (`:4210`) and `JadeFlowsTab` (`:4392`), and `inboundDistanceBands: activeInboundBandLens ?? activeBandLens`, `showInboundBandEditor: hasInboundBands(activeModelManifest?.inputsSchema)` plus the two labels (Q2) into `optimizationParamsBaseProps` (`:3340`).

- [ ] **Step 12: editor.** `lib/inboundBands.ts`:

```ts
/** DU-4.1 (Q3) — a model offers a second, inbound band editor exactly when its
 *  manifest declares the optional key (lib/integerDemand.ts precedent). */
export function hasInboundBands(inputsSchema: Record<string, unknown> | undefined): boolean {
  return (inputsSchema as { properties?: Record<string, unknown> } | undefined)?.properties?.inboundDistanceBands != null;
}
```

`BandChipEditor` gains an optional `label?: string` that replaces the "Distance bands" text (`:243`, legacy `:106`) when given (unit suffix unchanged). `OptimizationParametersTab` (`:737-745`): when `showInboundBandEditor`, render the existing editor with `label={outboundBandsLabel}` and a second `BandChipEditor` with `label={inboundBandsLabel}`, `bands={inboundDistanceBands}`, `onChange={b => onChange("inboundDistanceBands", b)}`, `testIdPrefix="inbound-"`, and under it the Q4 hint when the Workspace lens is `null` (pass `inboundUsesFallback`). Tests (`OptimizationParametersTab.test.tsx`, `inboundBands.test.ts`): JADE and gold show two labelled editors; p-median shows one, labelled "Distance bands"; editing the inbound editor calls `onChange("inboundDistanceBands", …)`; the hint shows only while falling back; `hasInboundBands` true for both two-echelon manifests (read the real manifest JSON) and false for the other six.

- [ ] **Step 13: map, legend, flows tab.**
  - `OutputMapTab.tsx:211-213`: `const effectiveInbound = inboundBands && inboundBands.length > 0 ? inboundBands : effectiveBands;` and `mapInbound = laneColour === "band" ? effectiveInbound : []`; pass `inboundBands={mapInbound}` / `inboundLabelBands={effectiveInbound}` to `NetworkMap` (`:507-508`). The narrative is outbound-only (`resultNarrative.ts:175`, `serviceEdgesFor`), so it stays on `effectiveBands` — note this in the changelog as a checked consumer.
  - `NetworkMap.tsx`: route polyline (`:810-816`) classifies with `bandsForLeg(edge.leg, { distanceBands: bands, inboundDistanceBands: inboundBands })`; the `legColor && bands.length === 0` check must read the leg's own set length. Customer popup (`:646`, `:659`, `:663`) and customer fill (`:860`) are outbound → unchanged. Pass `inboundBands` to the legend (`:987`) only when it differs from `bands` (`JSON.stringify` compare).
  - `MapLegend.tsx`: when `inboundBands` is given, render a second section "Inbound lanes" (same swatch + `bandRangeLabel` rows, overflow row included) under the existing section, which is then titled "Customer-facing lanes". Absent → exactly today's single "Distance bands" section.
  - `JadeFlowsTab.tsx:229-231`: `effectiveInbound = inboundBands ?? effectiveBands` with its own `displayInbound` and `inboundKey`; Plant→Warehouse rows (`:252-253`) classify with it; `legColumns()` (`:285-319`) takes the table's band set as a parameter so each table's "Distance Band" column, filter options and `filterResetKey` use its own set. The client export's `band` string keeps calling `bandLabel` until DU-4.2 — with the per-table set.
  - Tests: `NetworkMap.test.tsx:1758` keeps its single-set case and gains "an inbound edge colours by inboundBands, an outbound edge by bands"; `MapLegend` shows two sections only when the sets differ; `JadeFlowsTab.test.tsx` gains "Plant→Warehouse bands against inboundBands, Warehouse→Customer against bands" and its `:378-424` filter tests stay green with `inboundBands` absent; `OutputMapTab.test.tsx:454-492` stay green.

- [ ] **Step 14: sweep, gate, changelog, commit.** rg for `distanceBands`, `activeBandLens`, `bandsKey`, `"Distance bands"` across studio `src` + `e2e/`, api `src`, `lib/`; every production consumer either calls `bandsForLeg` or is listed in the changelog entry as outbound-only (`JadeAssignmentsTab`, `ServiceStatsTab` coverage, the narrative, `CostSummaryTab` frozen rows, `buildAssignmentRows`, `buildServiceStatsRows`, `buildJadeAssignmentRows`, `SolveDialog`). Run the per-task gate. Changelog `### DU-4.1 — inbound distance bands (design upgrade, Phase 4)` names the route, the reporting-only key set, Q1/Q3/Q4/Q5, and the consumer inventory. Commit `[DU-4.1] add inbound distance bands: per-leg lens, field-scoped route, second editor`.

---

### Task DU-4.2: Export band labels become range text; JADE grids on their own v4 envelopes (one atomic commit)

**Role:** backend-engineer. Skills as DU-4.1.

**Files:**
- Modify `lib/units/src/bands.ts` — add `bandRangeLabelForDistance`; **delete** `bandLabelOrOverflow`.
- Modify `lib/units/src/__tests__/bands.test.ts` (remove the `bandLabelOrOverflow` case at `:18-21`, add the new helper's cases).
- Modify `artifacts/api-server/src/services/templates.ts` — `JADE_EXPORT_TEMPLATE_VERSION`, JADE builders (`:1960-2125`), import list (`:13`).
- Modify `artifacts/api-server/src/routes/scenarios.ts:816` (JADE envelope version).
- Modify `lib/api-spec/openapi.yaml` — `:702-720` description, `:2461-2509` row descriptions, `:2571-2613` envelopes, `:2668-2683` `ExportEnvelope.oneOf`; regenerate Orval.
- Modify studio `lib/bands.ts` (drop the `bandLabel` re-export, `:14-15`, `:31`, `:50`), `components/workspace/tabs/JadeFlowsTab.tsx:252,268,276`, `lib/jadeFlowsExport.ts` (comment only if it names `Band N`).
- Tests: units `bands.test.ts`; studio `bands.test.ts` (`:236-260` move to the new helper), `bandsSingleSource.test.ts:24-25` (assert the new helper is the shared one), `jadeFlowsExport.test.ts`, `JadeFlowsTab.test.tsx`, `bandLabelSource.test.ts` (comment `:8`); api export tests that assert `"Band N"` / `"Overflow"` or `templateVersion: 3` on JADE (rg `Band [0-9]\|"Overflow"\|templateVersion` under `artifacts/api-server/src/__tests__`); new `__tests__/jadeExportContract.test.ts`.

**Interfaces:**
- Produces (units):
  ```ts
  /** DU-4.2 — the export/client label for one distance: classify on the
   *  CANONICAL distance, then render the range in the display unit. */
  export function bandRangeLabelForDistance(
    distance: number, bands: number[], canonicalUnit: CanonicalUnit, displayUnit: CanonicalUnit,
  ): string {
    return bandRangeLabel(
      assignBandOrOverflow(distance, bands),
      bands.map(b => toDisplay(b, canonicalUnit, displayUnit)),
      displayUnit,
    );
  }
  ```
- Produces (api): `export const JADE_EXPORT_TEMPLATE_VERSION = 4;` in `services/templates.ts`, read by `buildJadeAssignmentRows`, `buildJadeFlowRows` and the JADE branch of the export route only.

- [ ] **Step 1: failing contract test** `artifacts/api-server/src/__tests__/jadeExportContract.test.ts`, modelled on the CH4O cost-summary contract test (rg `COST_SUMMARY_TEMPLATE_VERSION` under `__tests__` for it):
  - builds JADE rows with the **production builders** from a real solved JADE fixture (rg the existing JADE export tests for the fixture they load) — at least one populated row of each grid;
  - asserts every row's `templateVersion === JADE_EXPORT_TEMPLATE_VERSION` (the constant, never the literal `4`);
  - validates the JSON envelope `{ templateVersion: JADE_EXPORT_TEMPLATE_VERSION, entity, unit, rows }` against the regenerated zod `ExportEnvelope` schema from `@workspace/api-zod` and asserts it matches the JADE envelope member, not the generic one;
  - asserts a generic v3 envelope with a JADE row is now **rejected** and a generic envelope with a generic row still parses at v3;
  - asserts a `band` value equals `bandRangeLabelForDistance(...)` for the row's canonical distance, and that no row contains `Band ` or `Overflow`;
  - asserts a `unit=km` export renders the label's boundaries in km.
  Run — FAIL.

- [ ] **Step 2: units helper + delete the old label.** Add `bandRangeLabelForDistance` (above). Delete `bandLabelOrOverflow` (`bands.ts:30-33`). Units tests: first band `≤`, middle `a–b`, overflow `>`, boundary inclusivity (`200` → first band), km conversion (`bands [100]` mi, distance 50, display km → `≤ 160.93 km` — compute the expected text from `formatDistanceNumber(toDisplay(100,"mi","km"))`, never eyeball it).

- [ ] **Step 3: server.** In `templates.ts`:
  - add the constant with a header comment in the `COST_SUMMARY_TEMPLATE_VERSION` style (why grid-local: `OUTPUT_TEMPLATE_VERSION` is read by grids whose rows did not change);
  - JADE assignment rows: `templateVersion: JADE_EXPORT_TEMPLATE_VERSION`, `band: bandRangeLabelForDistance(a.distanceMi, bands, canonicalUnit, requestedUnit)`;
  - JADE flow rows: the same, with each leg's set from `bandsForLeg` (DU-4.1);
  - update the comments at `:1954-1969` and on both interfaces (the label is now the range text).
  `routes/scenarios.ts:816`: `res.json({ templateVersion: JADE_EXPORT_TEMPLATE_VERSION, … })`.

- [ ] **Step 4: OpenAPI.**
  - `JadeAssignmentExportRow` / `JadeFlowExportRow` descriptions: `band` is the range text from the shared label authority (`≤ a u`, `a–b u`, `> z u`), in the requested unit.
  - New `JadeAssignmentsExportEnvelope` and `JadeFlowsExportEnvelope`: `templateVersion: { type: integer, enum: [4] }`, `entity` `assignments` / `flows`, `unit`, `rows` of the JADE row type only; description states it is two-echelon-jade-us only and why the version is grid-local; `example` with `templateVersion: 4`.
  - `AssignmentsExportEnvelope` / `FlowsExportEnvelope`: `rows.items` becomes the generic row `$ref` only (drop the `oneOf`); descriptions drop the JADE clause; `FlowExportRow.description` adds "for two-echelon models, a row's band index is into that leg's band set (inbound legs use inboundDistanceBands when saved)" (Q7).
  - `ExportEnvelope.oneOf` adds the two JADE envelopes; its description lists the v4 JADE family.
  - The export path description (`:702-720`) replaces the `"Band N"` sentence with the range text and the v4 envelope.
  Regenerate Orval; commit spec + output together.

- [ ] **Step 5: studio client export.** `lib/bands.ts`: remove the `bandLabel` re-export and its comment lines. `JadeFlowsTab.tsx:252,268`: `band: bandRangeLabelForDistance(r.distance, <that table's set>, canonicalUnit, displayUnit)` — use the unit values the tab already uses for the Distance column (rg `useDisplayUnit` / `canonicalUnit` in the tab). Update the `:276` comment: the client export band now matches the on-screen label. Tests: `jadeFlowsExport.test.ts` keeps its literal fixtures (they are inputs to the serializer, not labels it computes) unless a case asserts `Band N` text the tab produced; `JadeFlowsTab.test.tsx` export test asserts the downloaded band equals the visible cell text.

- [ ] **Step 6: sweep, gate, changelog, commit.** rg `Band [0-9]`, `"Overflow"`, `bandLabelOrOverflow`, `bandLabel\b`, `enum: \[3\]`, `templateVersion: 3` across `artifacts/` (incl. `e2e/`), `lib/`, `docs/ops/`; each remaining hit is either a generic-v3 path or listed in the changelog. Run the per-task gate (api + studio + units + typecheck + e2e typecheck). Changelog `### DU-4.2 — export band labels + JADE v4 envelopes` records Q6/Q7, the deleted helper, and the version split. Commit `[DU-4.2] export range band labels; move JADE grids to their own v4 envelopes`.

---

### Task DU-4.3: Service Stats "Inbound lanes" table + export section (one atomic commit)

**Role:** backend-engineer (studio file in brief). Skills as DU-4.1.

**Files:**
- Modify `lib/units/src/bands.ts` — `computeInboundBandFlows`.
- Modify `artifacts/api-server/src/services/templates.ts` (`ServiceStatsTemplateRow` :1782-1787, `buildServiceStatsRows` :1808-1829, `serviceStatsRowsToCsv` :1831-1835, `ServiceStatsJsonRow` / `toServiceStatsJsonRow` :1840-1847), `routes/scenarios.ts:822,850-852` (version + lens).
- Modify `lib/api-spec/openapi.yaml` (`ServiceStatsExportRow` :2511-2517, `ServiceStatsExportEnvelope` :2648-2666) + Orval regen.
- Modify studio `components/workspace/tabs/ServiceStatsTab.tsx` (new section between `:354` and `:356`), `pages/Workspace.tsx:4433` (pass `inboundBands`).
- Tests: units `bands.test.ts`; api serviceStats export tests (rg `buildServiceStatsRows\|serviceStats` under `__tests__`) + a contract test in the DU-4.2 style; studio `ServiceStatsTab.test.tsx` (`:547`, `:653` stay green).

**Interfaces:**
- Produces (units):
  ```ts
  export interface InboundBandFlow { band: number; flow: number; percent: number }
  /** DU-4.3 — EXCLUSIVE inbound flow per band (keys = sorted boundaries, then
   *  OVERFLOW_BAND), over edges whose leg is in INBOUND_LEGS, classified with
   *  bandsForLeg. [] when the result has no inbound edges or no boundaries.
   *  percent uses withResidual so the column sums to exactly 100. */
  export function computeInboundBandFlows(
    edges: BandEdge[],
    inputs: { distanceBands: number[]; inboundDistanceBands?: number[] },
    decimals?: number,
  ): InboundBandFlow[];
  ```
- Produces (api): `export const SERVICE_STATS_TEMPLATE_VERSION = 4;`; `ServiceStatsTemplateRow` gains `section: "outbound" | "inbound"` and `flow: number | null`.

- [ ] **Step 1: units — failing tests.** Inbound rows sum `flow` to the total inbound flow; `percent` sums to exactly 100; only inbound legs count (an outbound edge of any distance changes nothing); an edge on a boundary lands in the lower band; the overflow row is always present (0 when empty, like `computeExclusiveBandCoverage`); a legless (single-echelon) edge list returns `[]`; inbound set absent → classified against `distanceBands`. Run — FAIL.

- [ ] **Step 2: implement** with `computeExclusiveBandCoverage`'s structure and the existing `withResidual` (do not write a second rounding rule). Run — PASS.

- [ ] **Step 3: export — failing contract test.** Production `buildServiceStatsRows` on a real solved JADE fixture returns outbound rows identical in `band`/`percent` to today's (assert against the pre-change values captured from `computeCumulativeBandCoverage`), each with `section: "outbound"`, `flow: null`, and inbound rows with `section: "inbound"`, `flow` summing to the fixture's total inbound flow; every row's `templateVersion === SERVICE_STATS_TEMPLATE_VERSION`; a p-median fixture has outbound rows only; the JSON envelope validates against the regenerated zod schema with at least one populated row of each section; CSV header is `template_version,section,band,distance_unit,percent,flow`. Run — FAIL.

- [ ] **Step 4: implement.** `buildServiceStatsRows(result, canonicalUnit, requestedUnit, lens, modelId)` (lens replaces `savedBands`; outbound uses `lens.distanceBands` exactly as today). Inbound rows: `computeInboundBandFlows(result.edges, lens, decimals)`, boundary converted like the outbound rows (overflow never converted), `flow` rounded with `roundForFile`. The route passes `savedLens` (DU-4.1) and the wrapper version for `serviceStats` becomes `SERVICE_STATS_TEMPLATE_VERSION` (`:850-852`). OpenAPI: `ServiceStatsExportRow` gains `section` (`enum: [outbound, inbound]`, required) and `flow` (`type: number, nullable: true`, required), description per Q9; envelope `enum: [4]`, description says why grid-local. Regenerate Orval.

- [ ] **Step 5: studio table.** In `ServiceStatsTab.tsx`, after the band bars (`:354`), when the result has inbound edges (`edges.some(e => isInboundLeg(e.leg))`):

```tsx
<section aria-labelledby="inbound-lanes-heading" data-testid="service-stats-inbound">
  <h3 id="inbound-lanes-heading">Inbound lanes</h3>
  <p>Flow volume on inbound lanes per band, in {demandUnit}.</p>
  <table>…one row per computeInboundBandFlows row:
    <BandLabel index={…} bands={displayInbound} unit={displayUnit} /> · {formatted flow} · {percent}%
  </table>
</section>
```

Use the tab's existing table styling (match the Plant Production `DataTable` or a plain styled table — no new component), the chapter's `demandUnit` via `chapterForModelId(modelId)?.demandUnit ?? "units"`, and `presentationBands` / the new `inboundBands` prop for the lens. Tests: JADE and gold render the section, its flows sum to total inbound flow, the share column sums to 100; p-median renders no section; the outbound bars are unchanged (existing tests `:547`, `:653` green).

- [ ] **Step 6: sweep, gate, changelog, commit.** rg `serviceStats`, `templateVersion: 3`, `band,distance_unit,percent` across `artifacts/` and `lib/`. Per-task gate. Changelog `### DU-4.3 — Service Stats inbound lanes` with Q9. Commit `[DU-4.3] add Service Stats inbound lanes table and export section (v4)`.

---

### Task DU-4.4: Collapse product repetition (studio only)

**Role:** frontend-engineer. Skills as above.

**Files:**
- Modify `components/workspace/tabs/JadeAssignmentsTab.tsx` (rows `:125-196`, columns `:198-239`, table `:254-276`).
- Create `lib/groupAssignments.ts` (pure group-by).
- Modify `components/workspace/tabs/ServiceStatsTab.tsx` (`buildPlantProductionRows` `:95-135`, columns `:163-185`, table `:359-375`).
- Modify `components/workspace/tabs/CapabilityMatrixTab.tsx` (cells `:140-175`).
- Tests: new `__tests__/groupAssignments.test.ts`; `JadeAssignmentsTab.test.tsx`; `ServiceStatsTab.test.tsx` (Plant Production cases); `CapabilityMatrixTab.test.tsx`; rg `e2e/` for `Remaining capacity`, `Assigned Warehouse`, capability capacity testids.

**Interfaces:**
- Produces:
  ```ts
  export interface CustomerAssignmentGroup {
    customerId: string;
    /** One entry per product, sorted by product label. */
    lines: Array<{ productId: string; warehouseId: string; distance: number }>;
    /** The single warehouse when every product goes to it, else null. */
    warehouseId: string | null;
    warehouseCount: number;
  }
  export function groupAssignmentsByCustomer(
    rows: Array<{ customerId: string; productId: string; warehouseId: string; distanceMi: number }>,
  ): CustomerAssignmentGroup[];
  ```

- [ ] **Step 1: group-by — failing tests.** All products to one warehouse → `warehouseId` set, `warehouseCount 1`; two warehouses → `warehouseId null`, `warehouseCount 2`, `lines` complete; order stable; a single-product customer is one line. Implement; PASS.

- [ ] **Step 2: Customer Assignments.** One row per customer. Columns: Customer; Assigned Warehouse (single warehouse label, or a `button` "Split (n warehouses)" with `aria-expanded`, Q10); Products (count); Distance and Distance Band (the single warehouse's values; "—" when split). Pressing the button reveals, inside the row, one line per product: product label → warehouse label · distance · `BandLabel`. Warehouse filter options: each warehouse plus "Split". The export (`download("assignments", …)`) is unchanged — it is the server's flat product-level export. Tests: all-same customer shows the warehouse and no button; split customer shows the button, expands with keyboard (Enter/Space) and click, lists each product; the export request is unchanged; row count equals customer count.

- [ ] **Step 3: Plant Production (Q11).** Keep `buildPlantProductionRows` returning every row; filter in the tab: default hides `capacity === 0` rows, a labelled switch "Show disabled plant-products" (shadcn `Switch`, ≥ 24px target) shows them. Replace the "Remaining capacity" column with "Utilization %": `capacity > 0 ? Math.round((actual / capacity) * 100) + "%" : "—"`. Tests: disabled rows hidden by default and shown when toggled; utilization text for a known fixture row (compute it in the test from the fixture's numbers); the header "Remaining capacity" is gone.

- [ ] **Step 4: Capability Matrix.** Render `{capacity.toLocaleString()}` only when the cell is enabled; a disabled cell shows the checkbox alone. Tests: an enabled cell shows its capacity testid; a disabled one has no capacity text; toggling a cell on shows it.

- [ ] **Step 5: sweep, gate, changelog, commit.** rg studio `src` + `e2e/` for the changed headers/testids. Per-task gate. Changelog `### DU-4.4 — product repetition collapse`. Commit `[DU-4.4] collapse product repetition in assignments, plant production and capability matrix`.

---

### Task DU-4.5: Phase 4 real-browser QA + solver scripts (qa-sdet)

**Role:** qa-sdet (exempt from karpathy/ponytail), reviewed by a separate `fable` reviewer agent.

**Files:** create `artifacts/studio/e2e/design-upgrade-p4.spec.ts`; rewrite affected sibling specs found by the sweep; flake-registry sightings if any.

- [ ] **Step 1: sibling sweep.** rg `artifacts/studio/e2e/` for `Band [0-9]`, `Overflow`, `Distance bands`, `Remaining capacity`, `Assigned Warehouse`, `templateVersion`, `distance_band`, the capability-capacity testids, and every testid DU-4.1–4.4 changed. Rewrite the hits to the new UI and run each changed spec green.
- [ ] **Step 2: new spec** against local servers (`E2E_BASE_URL` set; recipe in `artifacts/studio/e2e/CLAUDE.md`), seeded results (`seedSolvedResult`, as in `design-upgrade-p1/p3.spec.ts`):
  - JADE and gold: Optimization Parameters shows "Customer-facing lanes" and "Inbound lanes" editors, with the fallback hint; editing inbound bands and saving persists across reload, the scenario does **not** turn stale, and only inbound lanes recolour on the Output Map; the legend shows two sections only when the sets differ;
  - p-median: one "Distance bands" editor, no inbound section anywhere;
  - JADE Flows: the Plant→Warehouse band column follows the inbound set; the client download's band text equals the cell text;
  - server exports (JADE assignments + flows, gold flows, serviceStats) download with range-text bands, the v4 envelopes, and the inbound section;
  - Service Stats inbound table on JADE and gold;
  - DU-4.4: split customer expands by keyboard and tap (touch-emulated viewport), Plant Production toggle and Utilization %, Capability Matrix disabled cells without capacity.
- [ ] **Step 3: gates.** `pnpm gate`; `E2E_BASE_URL=… pnpm e2e:gate`; from `artifacts/api-server/src/solver/tests/`: `python3 e2e_accuracy.py` (unmodified, all pass) and `python3 e2e_journey.py <BASE_URL> <section>` for each of `auth dataset pmedian transport delivery brazil`. Record the numbers in the changelog entry; never estimate a number that wasn't measured.
- [ ] **Step 4: commit** `[DU-4.5] Phase 4 real-browser QA and sibling e2e sweep` with changelog.

---

## Phase 4 close-out

1. `superpowers:finishing-a-development-branch`, then `/harness-retro DU-4`, then STOP for merge approval (push and deploy are separate approvals).
2. **Before asking to deploy** (Q12), the user (or a session that can reach the DB) runs, read-only:
   ```sql
   SELECT model_id, count(*) AS rows,
          count(*) FILTER (WHERE inputs ? 'distanceBands') AS has_bands,
          count(*) FILTER (WHERE inputs ? 'inboundDistanceBands') AS has_inbound
   FROM scenarios
   WHERE model_id IN ('two-echelon-jade-us', 'two-echelon-gold-au')
   GROUP BY model_id;
   ```
   Expected `has_inbound = 0` before deploy (the key cannot exist yet). The numbers go in the deploy record.
3. **Deploy needs both services** (render-ops skill): this phase touches `artifacts/api-server/**` and `solvers/*/manifest.json`, so `nos-api` must deploy with `nos-studio`, API first (the studio calls the new route). No schema change (`lib/db/src/schema/` untouched), so no `drizzle-kit push`. `pnpm deploy:preflight -- <deployed-sha>..HEAD` output goes in the deploy approval request.

## Self-review

- **Spec coverage:** §5.4.1 validation (4.1 Steps 3-4), persistence + field route (4.1 Steps 7-9), staleness on both write paths (4.1 Steps 5-8), fallback (units Step 1, editor Q4), one adapter + every consumer (4.1 Steps 2, 10, 13 + inventory in Step 14), editor (4.1 Step 12), Service Stats table + export (4.3); §5.4.2 (4.4); §5.4.3 (4.2: label authority, grid-local version, OpenAPI, Orval, contract tests pinned to the constant with populated production rows); §8 acceptance matrix rows "Inbound bands", "Export contract", "Service Stats", "Group-by" (4.1-4.4 tests); real-browser QA + solver scripts (4.5).
- **Gaps the spec missed, now covered:** the general PATCH path's bands-only rule (`scenarioInputWrite.ts:134`) — without Step 6 an inbound edit through a whole-input save would turn every solved scenario stale; the `INPUT_FIELD_LABELS` coverage test; the shared JADE/generic `AssignmentsExportEnvelope`/`FlowsExportEnvelope` (Q6); the client JADE flows export (DU-4.2 Step 5).
- **Type consistency:** `bandsForLeg`'s `inputs` shape is the lens object used by `buildFlowRows`, `buildJadeFlowRows`, `buildServiceStatsRows` and `computeInboundBandFlows`; `activeInboundBandLens: number[] | null` maps to `inboundDistanceBands?: number[]` via `?? undefined` at every studio call site.
