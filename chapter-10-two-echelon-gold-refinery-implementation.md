# Technical implementation plan — `two-echelon-gold-au`

Executable companion to `MINING_MODEL_INTEGRATION_PLAN.md` (strategy) and
`FAILURE_MODES_AND_HARDENING.md` (risk). Failure-mode IDs referenced inline as `[S1]`, `[C4]`, etc.

**Model id:** `two-echelon-gold-au` · **Wire `modelType`:** `two_echelon` · **Chapter:** 10

---

## Phase H — Hardening (land first, no new model)

Ship this phase alone and verify all existing tests pass. It touches shared infrastructure only.

### H2 — Capture solver stderr `[R1, R2]`

`artifacts/api-server/src/solver/jobRunner.ts`

```ts
interface SpawnResult {
  stdout: string;
  stderr: string;          // NEW
  code: number | null;
  timedOut: boolean;
  spawnError: string | null;
}

function runSolverProcess(payload: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn("python3", [SOLVER_PY], { cwd: os.tmpdir() });  // cwd guards [C6]
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    // ... existing timeout / error / close wiring, threading `stderr` through finish()
  });
}
```

Then in the solve wrapper, make failures diagnosable:

```ts
raw = JSON.parse(lastJsonLine(stdout));
} catch {
  await markFailed(
    jobId,
    `Failed to parse solver output. stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 500)}`,
  );
}
```

```ts
// Solver contract: stdout's last non-empty line is the JSON envelope.
// Tolerates stray banner output without silently accepting garbage.
function lastJsonLine(raw: string): string {
  const lines = raw.trim().split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("empty solver stdout");
  return lines[lines.length - 1];
}
```

**Test:** `jobRunner` unit test where a stub script prints a banner then JSON → parses correctly;
another that prints only a banner → fails with stderr included in the message.

### H3 — Solver-code hash in the cache key `[S2]`

```ts
import { createHash } from "crypto";
import { readFileSync } from "fs";

// Cache key must change when solver logic changes, not just when the dataset
// version bumps — otherwise a fixed solver returns the pre-fix cached result.
const SOLVER_CODE_HASH = createHash("sha256")
  .update(readFileSync(SOLVER_PY))
  .digest("hex")
  .slice(0, 12);
```

Include `SOLVER_CODE_HASH` alongside `datasetVersion` in the `inputsHash` computation.

### H4 — Contain dataset-load blast radius `[R3]`

`artifacts/api-server/src/solver/solve.py` — replace bare module-level loads:

```python
_LOAD_ERRORS = {}

def _safe_load(model_id, filename, default=None):
    """A malformed dataset for one model must not break the other three."""
    try:
        return _load_json(model_id, filename)
    except Exception as e:
        _LOAD_ERRORS[model_id] = str(e)
        return default if default is not None else {}
```

Each `solve_*` entry point checks `_LOAD_ERRORS.get(<its model_id>)` and returns an `error` envelope
naming the file, instead of the whole module failing to import.

### H5 — Contain manifest blast radius `[R4]`

`artifacts/api-server/src/registry/modelRegistry.ts`

```ts
for (const entry of fs.readdirSync(SOLVERS_ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(SOLVERS_ROOT, entry.name, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  try {
    map.set(entry.name, ManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8"))));
  } catch (err) {
    console.error(`[registry] skipping ${entry.name}: ${(err as Error).message}`);
  }
}
```

### H1 — Registration consistency test `[§1 miss-one table]`

`artifacts/api-server/src/registry/__tests__/registration.test.ts`

```ts
// Guards the 8-point registration surface. Any model registered in one place
// but not the others fails here rather than at runtime with an opaque symptom.
const SOLVABLE = ["p-median-us", "transport-coal", "p-median-brazil", "two-echelon-gold-au"];

it("every solvable model is registered at all four points", () => {
  for (const id of SOLVABLE) {
    expect(getManifest(id), `${id}: missing manifest`).toBeDefined();
    expect(validateInputs(id, {}).error, `${id}: missing Zod schema`).not.toMatch(/Unknown model_id/);
    expect(VALID_MODEL_IDS.has(id), `${id}: missing from routes allowlist`).toBe(true);
    expect(PACKAGE_SPECS.some((s) => s.modelId === id), `${id}: missing package spec`).toBe(true);
    expect(() => readVersion(id), `${id}: missing version.json`).not.toThrow();
  }
});
```

> Export `VALID_MODEL_IDS` from `routes/scenarios.ts` to make it testable. Note the existing
> allowlist also contains `max_coverage`, `p_center`, `set_cover`, which have no manifests — assert
> over `SOLVABLE`, not over the whole set, or the test fails on `main` immediately.

### H6 — CI guards `[R1, C6]`

```bash
grep -nE '^\s*print\(' artifacts/api-server/src/solver/solve.py \
  | grep -v 'print(json.dumps(result))' && { echo "stray print() in solve.py"; exit 1; }
grep -n 'writeLP(' artifacts/api-server/src/solver/solve.py && { echo "writeLP() forbidden"; exit 1; }
exit 0
```

**Phase H exit:** all existing tests green; no new model present.

---

## Phase M0 — Dataset extraction

### M0.1 Extraction script

`scripts/extract-mining-dataset.py` — one-off, committed for reproducibility.

Slug mapping (`[D1]` — eliminates the id-4 gap and the refinery/customer id collision):

| Notebook key | Slug | Role |
|---|---|---|
| plant 1 | `kalgoorlie` | mine |
| refinery 3 | `daggar-hills` | refinery |
| refinery 4 | `cunnamulla` | refinery |
| customer 1,2,3,5,6,7,8,9,10,11 | `sydney`, `melbourne`, `brisbane`, `adelaide`, `canberra`, `newcastle`, `sunshine-coast`, `townsville`, `cairns`, `bendigo` | customer |

Output files under `solvers/two-echelon-gold-au/dataset/`:

```
mines.json        {"kalgoorlie": {"id":"kalgoorlie","city":"Kalgoorlie","state":"WA","lat":-30.7495,"lng":121.4667}}
refineries.json   daggar-hills (WA), cunnamulla (QLD)
customers.json    10 records, each {id, city, state, lat, lng, demand}
distances.json    {"kalgoorlie,daggar-hills": 293.664297837559, ...}
version.json      {"version": 1, "sha256": "<computeSha256 output>"}   ← mandatory [S3]
```

**Note `lng` not `lon`** `[D5]` — matches `WarehouseEntry`. **`state` is required** by that schema;
supply real Australian states rather than omitting the field.

`version.json`'s `sha256` must be produced by the repo's own `computeSha256()` helper `[D2]`, never
typed by hand.

### M0.2 Extraction assertions

```python
assert len(customers) == 10
assert sum(c["demand"] for c in customers.values()) == 7_400_000       # [D7]
assert len(refineries) == 2 and len(mines) == 1
assert len(distances) == 22                                            # 2 mine→ref + 20 ref→cust
assert all(-38.5 <= v["lat"] <= -16.0 for v in all_nodes)              # [D6]
assert all(113.0 <= v["lng"] <= 155.0 for v in all_nodes)              # [D6]
```

**Exit:** files exist; assertions pass; `sha256` matches `computeSha256()`.

---

## Phase M1 — Registration (listable, not solvable)

### M1.1 `solvers/two-echelon-gold-au/manifest.json`

Band defaults sized for Australian distances `[C4]` — the max leg is 2,544 km, so a 2,000 km
ceiling would silently absorb every long leg into the top bucket:

```json
{
  "id": "two-echelon-gold-au",
  "name": "Gold Refinery Siting — Two-Echelon",
  "chapter": "Chapter 10",
  "datasetDir": "solvers/two-echelon-gold-au/dataset",
  "countryBounds": { "sw": [-38.5, 113.0], "ne": [-16.0, 154.5] },
  "capabilities": { "supportsP": false, "capacityModes": [], "demandEditable": true },
  "inputsSchema": {
    "type": "object",
    "properties": {
      "bomRatio": { "type": "number", "exclusiveMinimum": 1 },
      "refineryOverrides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "status": { "type": "string", "enum": ["active", "forced_open", "inactive"] }
          },
          "required": ["id", "status"]
        }
      },
      "customerOverrides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "demand": { "type": ["number", "null"], "minimum": 0 },
            "status": { "type": "string", "enum": ["active", "excluded"] }
          },
          "required": ["id", "status"]
        }
      },
      "distanceBands": {
        "type": "array",
        "items": { "type": "integer", "exclusiveMinimum": 0 },
        "minItems": 1,
        "default": [500, 1000, 1500, 2000, 2600]
      },
      "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "integer", "minimum": 1 }
    },
    "required": ["bomRatio", "distanceBands", "gap", "timeLimitSec"]
  }
}
```

### M1.2 `PACKAGE_SPECS` entry `[#5]`

`lib/dataset-schema/src/index.ts` — add entry schemas and register:

```ts
export const RefineryEntry = z.object({
  id: z.string(), city: z.string(), state: z.string(),
  lat: z.number(), lng: z.number(),
});
export const GoldMineEntry = RefineryEntry;                    // no capacity in v1
export const GoldCustomerEntry = RefineryEntry.extend({ demand: z.number() });

PACKAGE_SPECS.push({
  modelId: "two-echelon-gold-au",
  files: {
    "mines.json": z.record(z.string(), GoldMineEntry),
    "refineries.json": z.record(z.string(), RefineryEntry),
    "customers.json": z.record(z.string(), GoldCustomerEntry),
    "distances.json": DistanceMap,
  },
});
```

> Reusing the existing `MineEntry` is wrong here — it requires `capacity`, which this model has no
> notion of in v1.

**Exit:** `GET /api/models` returns 4 entries; `POST /scenarios` still 422s (expected — schema and
allowlist land in M3).

---

## Phase M2 — Solver

`artifacts/api-server/src/solver/solve.py`

### M2.1 Dataset loading (via `_safe_load` from H4)

```python
TRUCKLOAD_KG = 44000  # notebook's cost divisor: kg → truckloads [D4]

GOLD_MINES      = _safe_load("two-echelon-gold-au", "mines.json")
GOLD_REFINERIES = _safe_load("two-echelon-gold-au", "refineries.json")
GOLD_CUSTOMERS  = _safe_load("two-echelon-gold-au", "customers.json")
_GOLD_DIST_RAW  = _safe_load("two-echelon-gold-au", "distances.json")

def _gold_distances():
    return {(k.split(',')[0], k.split(',')[1]): v for k, v in _GOLD_DIST_RAW.items()}
```

### M2.2 `solve_two_echelon(inp)`

```python
def solve_two_echelon(inp):
    if _LOAD_ERRORS.get("two-echelon-gold-au"):
        return _envelope("error", "error", 0, 0, [], _EMPTY_METRICS, _EMPTY_DETAILS,
                         f"Dataset load failed: {_LOAD_ERRORS['two-echelon-gold-au']}")

    bom            = float(inp.get('bomRatio', 1.1))
    distance_bands = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000, 2600]))
    gap            = float(inp.get('gap', 0.0))
    time_limit     = int(inp.get('timeLimitSec', 120))
    ref_status     = {o['refineryId']: o['status'] for o in inp.get('refineryStatuses', [])}
    excluded       = set(inp.get('excludedCustomerIds', []))
    demand_over    = inp.get('customerDemands', {})

    mines      = list(GOLD_MINES.keys())
    refineries = list(GOLD_REFINERIES.keys())
    customers  = [c for c in GOLD_CUSTOMERS if c not in excluded]
    dist       = _gold_distances()
    demands    = {c: float(demand_over.get(c, GOLD_CUSTOMERS[c]['demand'])) for c in customers}
    total_demand = sum(demands.values())

    start = time.time()
    prob  = LpProblem("TwoEchelonGold", LpMinimize)

    x    = LpVariable.dicts("MineToRef",  [(p, r) for p in mines for r in refineries], lowBound=0)
    y    = LpVariable.dicts("RefToCust",  [(r, c) for r in refineries for c in customers], lowBound=0)
    open_r = LpVariable.dicts("Open", refineries, cat="Binary")

    prob += (lpSum(dist[p, r] * x[p, r] / TRUCKLOAD_KG for p in mines for r in refineries)
             + lpSum(dist[r, c] * y[r, c] / TRUCKLOAD_KG for r in refineries for c in customers))

    # C1 — every customer's demand met exactly
    for c in customers:
        prob += LpConstraint(lpSum(y[r, c] for r in refineries),
                             LpConstraintEQ, f"demand_{c}", demands[c])

    # C2 — exactly one refinery open, honouring forced_open / inactive
    for r in refineries:
        if ref_status.get(r) == "inactive":
            prob += LpConstraint(open_r[r], LpConstraintEQ, f"inactive_{r}", 0)
        elif ref_status.get(r) == "forced_open":
            prob += LpConstraint(open_r[r], LpConstraintEQ, f"forced_{r}", 1)
    prob += LpConstraint(lpSum(open_r[r] for r in refineries), LpConstraintEQ, "total_open", 1)

    # C3 — big-M: no outflow from a closed refinery
    for r in refineries:
        prob += LpConstraint(lpSum(y[r, c] for c in customers) - total_demand * open_r[r],
                             LpConstraintLE, f"open_link_{r}", 0)

    # C4 — BOM flow balance, summed over mines.
    # The notebook constrains this per (p,r) pair, which is correct only for a
    # single mine; with two it forces each mine to supply the full requirement
    # independently, doubling raw inflow with no error raised. [C1]
    for r in refineries:
        prob += LpConstraint(lpSum(x[p, r] for p in mines) - bom * lpSum(y[r, c] for c in customers),
                             LpConstraintEQ, f"bom_balance_{r}", 0)

    prob.solve(PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False))
    run_time   = time.time() - start
    status_str = LpStatus[prob.status]
```

Infeasibility handling, in the house's pedagogical style:

```python
    if status_str == "Infeasible":
        active = [r for r in refineries if ref_status.get(r) != "inactive"]
        forced = [r for r in refineries if ref_status.get(r) == "forced_open"]
        if not active:
            reason = ("Every refinery is marked inactive, but exactly one must be open to "
                      "refine gold. Re-activate at least one refinery.")
        elif len(forced) > 1:
            reason = (f"{len(forced)} refineries are forced open, but this model builds exactly "
                      "one. Force at most one open, or leave them all active.")
        else:
            reason = f"No feasible assignment for total demand of {total_demand:,.0f} kg."
        return _envelope("infeasible", status_str, 0, run_time, [],
                         _EMPTY_METRICS, {"openWarehouseIds": [], "assignments": []}, reason)
```

### M2.3 Results — per-leg metrics and tagged edges `[S1, C2, C4, C5]`

```python
    EPS = max(total_demand * 1e-9, 1e-6)          # relative, not absolute [C7]
    open_ids = [r for r in refineries if (open_r[r].varValue or 0) > 0.5]   # [C2]

    edges, assignments = [], []
    leg_dist_flow = {"mine_to_refinery": 0.0, "refinery_to_customer": 0.0}
    leg_flow      = {"mine_to_refinery": 0.0, "refinery_to_customer": 0.0}
    band_flow     = {b: 0.0 for b in distance_bands}
    band_overflow = 0.0

    def _band(d):
        """Returns None for distances past the last band rather than absorbing
        them into it — the existing models' `len(bands)-1` fallback silently
        misreports coverage on this dataset, whose longest leg is 2,544 km. [C4]"""
        for i, b in enumerate(distance_bands):
            if d <= b:
                return i
        return None

    for p in mines:
        for r in refineries:
            f = x[p, r].varValue or 0
            if f <= EPS:
                continue
            d = dist[p, r]
            leg_dist_flow["mine_to_refinery"] += d * f
            leg_flow["mine_to_refinery"]      += f
            edges.append({"fromId": p, "toId": r, "flow": round(f), "distance": d,
                          "band": _band(d) if _band(d) is not None else len(distance_bands),
                          "leg": "mine_to_refinery"})

    for r in refineries:
        for c in customers:
            f = y[r, c].varValue or 0
            if f <= EPS:
                continue
            d  = dist[r, c]
            bi = _band(d)
            leg_dist_flow["refinery_to_customer"] += d * f
            leg_flow["refinery_to_customer"]      += f
            if bi is None:
                band_overflow += f
            else:
                for b in distance_bands:
                    if d <= b:
                        band_flow[b] += f
            edges.append({"fromId": r, "toId": c, "flow": round(f), "distance": d,
                          "band": bi if bi is not None else len(distance_bands),
                          "leg": "refinery_to_customer"})
            assignments.append({"customerId": c, "warehouseId": r, "distanceMi": d,
                                "band": bi if bi is not None else len(distance_bands),
                                "flowKg": round(f),
                                "flowFraction": round(f / demands[c], 4) if demands[c] else 0})

    def _avg(leg):
        return round(leg_dist_flow[leg] / leg_flow[leg], 1) if leg_flow[leg] > 0 else 0   # [F5]

    # Averages come from flows, never from the objective — the objective is
    # divided by TRUCKLOAD_KG, so obj/total_demand understates distance 44,000x. [C5]
    avg_by_leg = [{"leg": leg, "avgDistance": _avg(leg), "totalFlow": round(leg_flow[leg])}
                  for leg in ("mine_to_refinery", "refinery_to_customer")]

    total_flow = sum(leg_flow.values())
    blended = round(sum(leg_dist_flow.values()) / total_flow, 1) if total_flow else 0

    band_coverage = [{"band": b, "percent": round(band_flow[b] * 100 / total_demand)}
                     for b in distance_bands]
    if band_overflow > 0:
        band_coverage.append({"band": -1,
                              "percent": round(band_overflow * 100 / total_demand)})

    utilization = [{"warehouseId": r, "city": GOLD_REFINERIES[r]['city'],
                    "utilization": 100 if r in open_ids else 0} for r in refineries]

    return _envelope("optimal", status_str, round(value(prob.objective) or 0, 2), run_time, edges,
                     {"utilizationByNode": utilization,
                      "bandCoverage": band_coverage,
                      "weightedAvgDistance": blended,
                      "avgDistanceByLeg": avg_by_leg},
                     {"openWarehouseIds": open_ids, "assignments": assignments,
                      "bomRatio": bom})
```

### M2.4 Dispatcher `[#8]`

```python
def solve(inp):
    model_type = inp.get('modelType', 'p_median')
    if model_type == 'transport':            return solve_transport(inp)
    if model_type == 'capacitated_pmedian':  return solve_capacitated_pmedian(inp)
    if model_type == 'two_echelon':          return solve_two_echelon(inp)
    return solve_pmedian(inp)
```

> Consider making an unrecognised `modelType` an explicit error rather than falling through to
> p-median. The current fallback turns a registration typo into a plausible wrong answer.

**No `writeLP()`. No `print()`. No `plotly`. No `!pip install`.** `[R1, C6]`

**Exit:** `echo '{"modelType":"two_echelon","bomRatio":1.1,...}' | python3 solve.py` reproduces
notebook objectives for both scenarios.

---

## Phase M3 — API contract

### M3.1 Envelope schema — same commit as M2 `[S1 — CRITICAL]`

`artifacts/api-server/src/solver/resultEnvelope.ts`

```ts
export const EdgeSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  flow: z.number(),
  distance: z.number(),
  band: z.number().optional(),
  // Two-echelon models tag each edge with its leg so the map can style
  // mine→refinery and refinery→customer differently. Optional: single-echelon
  // models omit it. Without this field here, Zod strips it silently. [S1]
  leg: z.enum(["mine_to_refinery", "refinery_to_customer"]).optional(),
});

export const MetricsSchema = z.object({
  utilizationByNode: z.array(z.object({
    warehouseId: z.string(), city: z.string(), utilization: z.number(),
  })).optional(),
  bandCoverage: z.array(z.object({ band: z.number(), percent: z.number() })).optional(),
  weightedAvgDistance: z.number().optional(),
  avgDistanceByLeg: z.array(z.object({
    leg: z.string(), avgDistance: z.number(), totalFlow: z.number(),
  })).optional(),
});
```

### M3.2 Input schema

`artifacts/api-server/src/validation/inputs/twoEchelon.ts`

```ts
import { z } from "zod";

export const twoEchelonInputsSchema = z.object({
  // .gt(1), not .positive(): a ratio at or below 1 means refining creates mass.
  // Rejecting at the edge beats debugging a nonsensical optimum later.
  bomRatio: z.number().gt(1).max(10),
  refineryOverrides: z.array(z.object({
    id: z.string(),
    status: z.enum(["active", "forced_open", "inactive"]),
  })).default([]),
  customerOverrides: z.array(z.object({
    id: z.string(),
    demand: z.number().min(0).nullable().optional(),
    status: z.enum(["active", "excluded"]),
  })).default([]),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),   // required — NaN here kills every solve [R5]
});

export type TwoEchelonInputs = z.infer<typeof twoEchelonInputsSchema>;
```

### M3.3 Registry + allowlist `[#3, #4]`

```ts
// modelRegistry.ts
const KNOWN_SCHEMAS: Record<string, ZodType> = {
  "p-median-us": pMedianInputsSchema,
  "p-median-brazil": pMedianInputsSchema,
  "transport-coal": transportLpInputsSchema,
  "two-echelon-gold-au": twoEchelonInputsSchema,
};

// routes/scenarios.ts — separate source of truth; H1 guards the divergence
export const VALID_MODEL_IDS = new Set([
  "p-median-us", "transport-coal", "p-median-brazil",
  "two-echelon-gold-au",
  "max_coverage", "p_center", "set_cover",
]);
```

### M3.4 Payload builder `[#6]`

`artifacts/api-server/src/solver/pmedian.ts`

```ts
export type SolveInput =
  | { modelId: "p-median-us" | "p-median-brazil"; inputs: PMedianInputs }
  | { modelId: "transport-coal"; inputs: TransportLpInputs }
  | { modelId: "two-echelon-gold-au"; inputs: TwoEchelonInputs };

// inside buildPayload()
if (input.modelId === "two-echelon-gold-au") {
  const i = input.inputs;
  return {
    modelType: "two_echelon",
    bomRatio: i.bomRatio,
    refineryStatuses: i.refineryOverrides
      .filter((o) => o.status !== "active")
      .map((o) => ({ refineryId: o.id, status: o.status })),
    excludedCustomerIds: i.customerOverrides
      .filter((o) => o.status === "excluded").map((o) => o.id),
    customerDemands: Object.fromEntries(
      i.customerOverrides.filter((o) => o.demand != null).map((o) => [o.id, o.demand as number]),
    ),
    distanceBands: i.distanceBands,
    gap: i.gap,
    timeLimitSec: i.timeLimitSec,
  };
}
```

### M3.5 OpenAPI + codegen `[#7]`

- Add `two-echelon-gold-au` to the `modelId` enum in `lib/api-spec/openapi.yaml`
- Mirror the M3.1 optional fields into the spec's result schemas
- `pnpm --filter @workspace/api-spec run codegen`
- **Review the generated diff; never hand-edit** `lib/api-client-react` or `lib/api-zod`

**Exit:** `pnpm run typecheck` clean; full solve round-trip returns `leg` and `avgDistanceByLeg`
intact (assert this explicitly — it's the S1 regression guard).

---

## Phase M4 — Frontend

- **M4.1** Generalize `NetworkMap` to take `countryBounds` from the manifest rather than adding a
  third country-specific map component `[F3]`.
- **M4.2** Colour edges by `edge.leg`; default unknown/absent to neutral styling rather than
  throwing `[F2]`. Distinct markers for mine / refinery / customer.
- **M4.3** BOM slider, range 1.0–3.0, step 0.1, rounded before send `[F6]`. A slider invites
  sweeping for the flip point; a number field does not.
- **M4.4** Per-leg metrics panel, rendered only when `avgDistanceByLeg?.length` `[F1]`.
- **M4.5** Copy layer maps `openWarehouseIds` → "Refinery selected" for this model `[F4]`.
- **M4.6** Verify `Compare.tsx` rejects cross-model comparison `[P3]`.

---

## Phase M5 — Arcadia quest

Quest "The Refinery Dilemma": solve at BOM 1.1 → record winner; re-solve at 2.0 → record flip;
answer why. Badge for locating the flip threshold via the slider.

---

## Test matrix

| Layer | Test | Guards |
|---|---|---|
| pytest | `test_scenario_1_selects_cunnamulla` | baseline |
| pytest | `test_scenario_2_selects_daggar_hills` | baseline |
| pytest | `test_objective_matches_notebook` (both, rel 1e-6) | `[D3, D4]` |
| pytest | `test_flow_balance_generalizes` (synthetic 2nd mine) | `[C1]` |
| pytest | `test_leg_averages_move_oppositely` | the exercise's actual answer |
| pytest | `test_bom_flip_threshold` (bracket, not point) | `[C3]` |
| pytest | `test_band_overflow_not_absorbed` (2,544 km leg) | `[C4]` |
| pytest | `test_avg_distance_not_derived_from_objective` | `[C5]` |
| pytest | `test_all_refineries_inactive_infeasible` | messaging |
| pytest | `test_two_forced_open_infeasible` | messaging |
| vitest | envelope **retains** `leg` + `avgDistanceByLeg` | `[S1]` |
| vitest | `bomRatio: 0.5` → 422 | schema |
| vitest | missing `timeLimitSec` → 422 (never reaches runner) | `[R5]` |
| vitest | registration consistency (H1) | `[§1]` |
| vitest | banner-then-JSON stdout parses; banner-only fails with stderr | `[R1, R2]` |
| RTL | per-leg panel absent when field absent | `[F1]` |
| RTL | edge colouring keys off `leg` | `[F2]` |
| Playwright | build → solve → clone → change BOM → solve → compare | end-to-end |
| **pytest** | **existing `e2e_accuracy.py` + `e2e_journey.py` unchanged** | **merge gate** |

---

## Commit sequence

1. `fix(solver): capture stderr, parse last stdout line, set subprocess cwd` (H2)
2. `fix(cache): include solver code hash in cache key` (H3)
3. `fix(registry): contain dataset and manifest load failures` (H4, H5)
4. `test(registry): assert model registration consistency` (H1)
5. `ci: forbid stray print() and writeLP() in solve.py` (H6)
6. `feat(data): extract Ch.10 mining dataset with slug ids` (M0)
7. `feat(registry): register two-echelon-gold-au manifest and package spec` (M1)
8. `feat(solver)!: two-echelon refinery siting + envelope leg/per-leg metrics` (M2 + M3.1 — **one commit** `[S1]`)
9. `feat(api): zod schema, allowlist, payload builder, openapi codegen` (M3.2–M3.5)
10. `feat(studio): australia bounds, two-leg edges, BOM slider, per-leg panel` (M4)
11. `feat(arcadia): The Refinery Dilemma quest` (M5)
12. `test: solver, api, and e2e coverage for two-echelon model`

**Commit 8 must not be split.** Solver output and envelope schema are a single contract; separating
them produces a working solver whose new fields are silently discarded.
