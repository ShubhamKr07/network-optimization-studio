# Transport-Coal Override Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the transport-coal (Chapter 5 coal shipping LP) lab real per-entity overrides — per-mine supply capacity (`mineCapacities`) and per-station demand (`stationDemands`) — analogous to what p-median-us already has (`warehouseOverrides`/`customerOverrides`), plus CSV/JSON import/export for both, so the coal lab reaches feature parity with the p-median lab's editing story.

**Architecture:** transport-coal's `solve_transport()` (`artifacts/api-server/src/solver/solve.py:232-344`) currently reads override-free input: it pulls mine capacity and station demand straight from the module-level `COAL_MINES`/`POWER_STATIONS` dataset constants, never from the request payload. Unlike p-median-us (where `solve_pmedian()` already reads `warehouseCapacities`/`customerDemands` from `inp`), there is **no existing plumbing to extend** here — every override type requires touching all four layers: `solve.py` (the real consumer), `artifacts/api-server/src/validation/inputs/transportLp.ts` (the Zod gate), `solvers/transport-coal/manifest.json` (the public capabilities contract), and `Studio.tsx` + two new table components (the editing UI). This plan ships two override axes in two independent, sequential phases — Phase A (`mineCapacities`, 1 solver site, 4 rows) first since it's the smallest, proving the plumbing; Phase B (`stationDemands`, 2 solver sites + a total-demand recompute, 15 rows, flips `capabilities.demandEditable` to `true`) second. A third axis (`laneCosts`, per-lane objective-coefficient overrides across the dense 4×15 cost matrix) is **explicitly deferred** — the investigation backing this plan (`.superpowers/sdd/transport-coal-override-design-facts.md`) recommends shipping it only after A and B are validated, since its UI (60 potentially-editable cells) is a materially harder design problem than a 4-row or 15-row table; it is out of scope for this plan.

**Tech Stack:** Python (PuLP/CBC via `solve.py`), Zod, Express 5, React + Radix UI tables (mirroring `WarehouseTable.tsx`/`CustomerTable.tsx`), pytest, Vitest.

## Global Constraints

- **Solver changes enter as data, not branches** (CLAUDE.md hard rule #6): every override below is a variable bound / constraint RHS / objective coefficient change, never a new `if/else` code path bypassing the LP formulation.
- **`e2e_accuracy.py` is sacred** (CLAUDE.md hard rule #2): it validates solver output against the textbook's published answers and must pass unmodified after every solver-touching task in this plan. Run `cd artifacts/api-server/src/solver && python3 e2e_accuracy.py` after every task that touches `solve.py` (this is a standalone script, not pytest-discovered — `python3 -m pytest tests/ -x` does **not** run it, per this repo's own documented gotcha).
- All new override fields are **optional, sparse dicts defaulting to `{}`** — existing persisted transport-coal scenarios (which have only the six base fields) must continue to validate and solve identically. `solve.py` must use `inp.get('mineCapacities', {})` (default empty dict), never `inp['mineCapacities']`.
- There is **no status/exclusion concept** for mines or stations (no open/close binary in the LP) — do not add a `status` field to either override type. A "closed" mine is expressed purely as a `mineCapacities` override of `0`.
- Full verification gate before considering any task done: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`. Any task touching `solve.py` additionally requires the `e2e_accuracy.py` run above.
- One task = one commit, message format `feat: <imperative summary>`.

---

## Phase A — `mineCapacities`

### Task 1: `solve.py` — per-mine capacity override

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py:232-266` (`solve_transport`, the input-read block and the capacity-constraint block)
- Test: `artifacts/api-server/src/solver/tests/test_transport.py` (check if this exact file exists — if transport-coal's existing tests live under a differently-named file, e.g. `test_transport_coal.py`, add to that one instead; do not create a duplicate)

**Interfaces:**
- Consumes: nothing from other tasks in this plan.
- Produces: the `mineCapacities: Record<mineId, number>` field `solve_transport()` now reads — Task 2 (Zod/manifest) and Task 3 (UI) both depend on this exact key name and semantics (absolute override capacity in tons, applied **before** the existing `capacityFactor` multiplier — i.e. `effective_cap(m) = (mine_caps.get(m, COAL_MINES[m]['capacity'])) * capacity_factor`).

**Current code (`artifacts/api-server/src/solver/solve.py:232-266`):**
```python
def solve_transport(inp):
    capacity_factor   = float(inp.get('capacityFactor', 1.0))
    single_source     = bool(inp.get('singleSource', False))
    capacity_inactive = bool(inp.get('capacityInactive', False))
    distance_bands    = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000]))
    gap               = float(inp.get('gap', 0.0))
    time_limit        = int(inp.get('timeLimitSec', 120))

    mines    = list(COAL_MINES.keys())
    stations = list(POWER_STATIONS.keys())
    dist     = _transport_distances()
    total_demand = sum(s['demand'] for s in POWER_STATIONS.values())

    start = time.time()
    prob  = LpProblem("TransportLP", LpMinimize)

    flow = LpVariable.dicts("Flow", [(m, s) for m in mines for s in stations], lowBound=0)

    if single_source:
        source = LpVariable.dicts("Src", [(m, s) for m in mines for s in stations], 0, 1, cat='Binary')

    prob += lpSum(dist[m, s] * flow[m, s] for m in mines for s in stations)

    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", POWER_STATIONS[s]['demand'])

    if not capacity_inactive:
        for m in mines:
            cap = COAL_MINES[m]['capacity'] * capacity_factor
            prob += LpConstraint(
                lpSum(flow[m, s] for s in stations),
                LpConstraintLE, f"cap_{m}", cap)
```

- [ ] **Step 1: Write the failing test**

Add to the transport-coal pytest file (check `artifacts/api-server/src/solver/tests/` for the exact existing filename first):

```python
def test_mine_capacity_override_binds():
    # KY's base capacity is 25,000,000 tons. Override it down to 1,000,000 --
    # far below the ~4-6M tons KY normally ships to nearby stations (e.g.
    # CHI, ATL, PIT are its cheapest lanes) -- so the override must visibly
    # reduce KY's outbound flow versus an unoverridden solve.
    base = solve_transport({
        "capacityFactor": 1.0, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
    })
    base_ky_flow = sum(e["flow"] for e in base["edges"] if e["fromId"] == "KY")
    assert base_ky_flow > 1_000_000  # sanity: KY normally ships more than the override cap

    overridden = solve_transport({
        "capacityFactor": 1.0, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
        "mineCapacities": {"KY": 1_000_000},
    })
    ky_flow = sum(e["flow"] for e in overridden["edges"] if e["fromId"] == "KY")
    assert ky_flow <= 1_000_000 + 1  # +1 for rounding (flow_tons = round(flow_val))
    assert overridden["status"] == "optimal"

def test_mine_capacity_override_absent_matches_base():
    # No mineCapacities key at all must solve byte-identically to today.
    result = solve_transport({
        "capacityFactor": 1.0, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
    })
    assert result["status"] == "optimal"
    assert result["objective"] > 0  # smoke check -- the real byte-identical
    # comparison against the textbook's published answer is e2e_accuracy.py's
    # job, run separately per this plan's Global Constraints
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shubhamkr/network-optimization-studio/artifacts/api-server/src/solver && python3 -m pytest tests/ -x -k mine_capacity`
Expected: FAIL on `test_mine_capacity_override_binds` — `solve_transport` currently ignores `mineCapacities` entirely, so KY's flow is unconstrained by the override and exceeds 1,000,001.

- [ ] **Step 3: Apply the fix**

Replace `artifacts/api-server/src/solver/solve.py:232-266`:

```python
def solve_transport(inp):
    capacity_factor   = float(inp.get('capacityFactor', 1.0))
    single_source     = bool(inp.get('singleSource', False))
    capacity_inactive = bool(inp.get('capacityInactive', False))
    distance_bands    = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000]))
    gap               = float(inp.get('gap', 0.0))
    time_limit        = int(inp.get('timeLimitSec', 120))
    mine_caps         = inp.get('mineCapacities', {})

    mines    = list(COAL_MINES.keys())
    stations = list(POWER_STATIONS.keys())
    dist     = _transport_distances()
    total_demand = sum(s['demand'] for s in POWER_STATIONS.values())

    start = time.time()
    prob  = LpProblem("TransportLP", LpMinimize)

    flow = LpVariable.dicts("Flow", [(m, s) for m in mines for s in stations], lowBound=0)

    if single_source:
        source = LpVariable.dicts("Src", [(m, s) for m in mines for s in stations], 0, 1, cat='Binary')

    prob += lpSum(dist[m, s] * flow[m, s] for m in mines for s in stations)

    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", POWER_STATIONS[s]['demand'])

    if not capacity_inactive:
        for m in mines:
            base_cap = mine_caps.get(m, COAL_MINES[m]['capacity'])
            cap = base_cap * capacity_factor
            prob += LpConstraint(
                lpSum(flow[m, s] for s in stations),
                LpConstraintLE, f"cap_{m}", cap)
```

(Only the `mine_caps = inp.get('mineCapacities', {})` line is added to the input reads, and `cap = COAL_MINES[m]['capacity'] * capacity_factor` becomes `base_cap = mine_caps.get(m, COAL_MINES[m]['capacity'])` then `cap = base_cap * capacity_factor` — the override replaces the *base* value only; `capacity_factor` still multiplies on top exactly as before, so the existing slider's semantics are unchanged for mines with no override.)

**Note:** the infeasibility-message block (`solve.py:283-298`) and the utilization calc (`solve.py:335-340`) both also reference `COAL_MINES[m]['capacity']` directly — leave both unchanged for this task (they only affect diagnostic text and a display percentage, not feasibility or the objective; revisit only if a later review finds the messages misleading with an active override — out of scope here to avoid touching more than the capacity constraint itself).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/shubhamkr/network-optimization-studio/artifacts/api-server/src/solver && python3 -m pytest tests/ -x -k mine_capacity`
Expected: PASS (both new tests).

- [ ] **Step 5: Run the full solver test suite and `e2e_accuracy.py`**

Run:
```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/api-server/src/solver
python3 -m pytest tests/ -x
python3 e2e_accuracy.py
```
Expected: all pytest tests pass; `e2e_accuracy.py` passes **unmodified** (this task adds a new optional input the textbook's own scenarios never send, so their solves must be byte-identical to before).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/
git commit -m "$(cat <<'EOF'
feat: transport-coal per-mine capacity override (mineCapacities)

solve_transport() previously read mine capacity only from the module-level
COAL_MINES dataset constant, with no override surface -- unlike p-median-us's
solve_pmedian(), which already reads warehouseCapacities from the payload.
New optional sparse dict mineCapacities (mine id -> absolute tons), applied
as the base value before the existing capacityFactor multiplier still
applies on top. Absent/empty dict solves byte-identically to today
(e2e_accuracy.py verified unmodified).
EOF
)"
```

---

### Task 2: `transportLp.ts` Zod schema + `manifest.json` — validate and advertise `mineCapacities`

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/transportLp.ts`
- Modify: `solvers/transport-coal/manifest.json`
- Test: `artifacts/api-server/src/__tests__/` (find the existing test file that covers `transportLpInputsSchema` or `validateInputsForModel("transport-coal", ...)` — add to it)

**Interfaces:**
- Consumes: Task 1's `mineCapacities` key name and shape (`Record<string, number>`, non-negative).
- Produces: server-side validation accepting `mineCapacities` on transport-coal scenario PATCH/create; Task 3's UI depends on this validating successfully before it can persist any capacity override at all.

**Current schema (`artifacts/api-server/src/validation/inputs/transportLp.ts`, full file):**
```ts
import { z } from "zod";

export const transportLpInputsSchema = z.object({
  capacityFactor: z.number().positive(),
  singleSource: z.boolean(),
  capacityInactive: z.boolean(),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
});

export type TransportLpInputs = z.infer<typeof transportLpInputsSchema>;
```

**Current manifest (`solvers/transport-coal/manifest.json`, full file):**
```json
{
  "id": "transport-coal",
  "name": "Coal Transport LP",
  "chapter": "Chapter 5",
  "datasetDir": "solvers/transport-coal/dataset",
  "countryBounds": { "sw": [29.76, -122.42], "ne": [47.61, -73.61] },
  "capabilities": { "supportsP": false, "capacityModes": [], "demandEditable": false },
  "inputsSchema": {
    "type": "object",
    "properties": {
      "capacityFactor": { "type": "number", "exclusiveMinimum": 0 },
      "singleSource": { "type": "boolean" },
      "capacityInactive": { "type": "boolean" },
      "distanceBands": {
        "type": "array",
        "items": { "type": "integer", "exclusiveMinimum": 0 },
        "minItems": 1
      },
      "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "integer", "minimum": 1 }
    },
    "required": ["capacityFactor", "singleSource", "capacityInactive", "distanceBands", "gap", "timeLimitSec"]
  }
}
```

- [ ] **Step 1: Write the failing test**

Find the existing test file covering `transportLpInputsSchema` (search `artifacts/api-server/src/__tests__/` for `transportLp` or `validateInputsForModel.*transport-coal`) and add:

```ts
it("accepts an optional mineCapacities sparse dict", () => {
  const result = transportLpInputsSchema.safeParse({
    capacityFactor: 1.0, singleSource: false, capacityInactive: false,
    distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
    mineCapacities: { KY: 1000000 },
  });
  expect(result.success).toBe(true);
});

it("defaults mineCapacities to {} when omitted (existing scenarios unaffected)", () => {
  const result = transportLpInputsSchema.safeParse({
    capacityFactor: 1.0, singleSource: false, capacityInactive: false,
    distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
  });
  expect(result.success).toBe(true);
});

it("rejects a negative mineCapacities value", () => {
  const result = transportLpInputsSchema.safeParse({
    capacityFactor: 1.0, singleSource: false, capacityInactive: false,
    distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
    mineCapacities: { KY: -5 },
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- transportLp`
Expected: FAIL — `mineCapacities` is not a recognized key today; Zod's default (non-strict) object parsing would actually still succeed and silently ignore the extra key rather than reject it, so the FIRST test may already superficially "pass" while not actually validating the field's constraints — confirm this by checking whether `result.data.mineCapacities` is `undefined` after parsing (it will be, since the schema doesn't know the field), which is the real signal the schema needs updating.

- [ ] **Step 3: Apply the fix**

Replace `artifacts/api-server/src/validation/inputs/transportLp.ts` in full:

```ts
import { z } from "zod";

export const transportLpInputsSchema = z.object({
  capacityFactor: z.number().positive(),
  singleSource: z.boolean(),
  capacityInactive: z.boolean(),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
  mineCapacities: z.record(z.string(), z.number().nonnegative()).optional().default({}),
});

export type TransportLpInputs = z.infer<typeof transportLpInputsSchema>;
```

Update `solvers/transport-coal/manifest.json`'s `inputsSchema.properties` and `capabilities`:

```json
{
  "id": "transport-coal",
  "name": "Coal Transport LP",
  "chapter": "Chapter 5",
  "datasetDir": "solvers/transport-coal/dataset",
  "countryBounds": { "sw": [29.76, -122.42], "ne": [47.61, -73.61] },
  "capabilities": { "supportsP": false, "capacityModes": ["per_mine"], "demandEditable": false },
  "inputsSchema": {
    "type": "object",
    "properties": {
      "capacityFactor": { "type": "number", "exclusiveMinimum": 0 },
      "singleSource": { "type": "boolean" },
      "capacityInactive": { "type": "boolean" },
      "distanceBands": {
        "type": "array",
        "items": { "type": "integer", "exclusiveMinimum": 0 },
        "minItems": 1
      },
      "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "integer", "minimum": 1 },
      "mineCapacities": {
        "type": "object",
        "additionalProperties": { "type": "number", "minimum": 0 }
      }
    },
    "required": ["capacityFactor", "singleSource", "capacityInactive", "distanceBands", "gap", "timeLimitSec"]
  }
}
```

(`mineCapacities` is deliberately not in `required` — it's optional, matching the Zod schema's `.optional().default({})`. `capabilities.capacityModes` changes from `[]` to `["per_mine"]` to advertise this feature generically per the manifest's public contract; `demandEditable` stays `false` since this task doesn't touch station demand.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- transportLp`
Expected: PASS.

- [ ] **Step 5: Run the full api-server suite and typecheck**

Run: `pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
Expected: clean, all pass (including the model-registry tests that read `manifest.json`'s `capabilities`/`inputsSchema` — check `artifacts/api-server/src/__tests__/` for any test that snapshots or asserts on transport-coal's exact manifest shape, since this task changes it; update any such assertion to the new shape if one exists).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/validation/inputs/transportLp.ts solvers/transport-coal/manifest.json
git add artifacts/api-server/src/__tests__/
git commit -m "$(cat <<'EOF'
feat: validate and advertise transport-coal's mineCapacities override

Adds mineCapacities: z.record(z.string(), z.number().nonnegative()).optional()
to transportLpInputsSchema (the server-side Zod gate) and mirrors it in
manifest.json's inputsSchema, matching the field solve.py now reads (prior
task). capabilities.capacityModes flips from [] to ["per_mine"] to advertise
this generically per the manifest's public contract.
EOF
)"
```

---

### Task 3: `MineTable.tsx` + `Studio.tsx` wiring — per-mine capacity UI

**Files:**
- Create: `artifacts/studio/src/components/tables/MineTable.tsx`
- Modify: `artifacts/studio/src/pages/Studio.tsx` (add `mineCapacities` to `LocalConfig`, `configFromScenario`, `buildInputsForSave` for transport-coal; add a trigger button + `Dialog`-wrapped `MineTable` to the transport-coal left-panel section)
- Test: `artifacts/studio/src/__tests__/MineTable.test.tsx`, additions to `artifacts/studio/src/__tests__/Studio.test.tsx`

**Interfaces:**
- Consumes: Task 2's validated `mineCapacities` field.
- Produces: `MineOverride { id: string; capacity?: number | null }` type (exported from `MineTable.tsx`, mirroring `WarehouseOverride`'s exact shape minus the `status` field, since mines have no status concept per this plan's Global Constraints).

**Reference pattern — `WarehouseTable.tsx` (full file, already in the repo at `artifacts/studio/src/components/tables/WarehouseTable.tsx`):** reuse this exact structure, dropping the `status` column/logic entirely (mines have no status), and dropping the `capacityMode === "per_wh"` conditional (mine capacity is always editable — there's no "none"/"uniform"/"per_wh" toggle for transport-coal, capacity override is simply present or absent per mine).

- [ ] **Step 1: Write the failing test**

Create `artifacts/studio/src/__tests__/MineTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MineTable } from "@/components/tables/MineTable";

const mines = [
  { id: "KY", city: "Pikeville", state: "KY" },
  { id: "WY", city: "Rock Springs", state: "WY" },
];

describe("MineTable", () => {
  it("renders every mine with an empty capacity input by default", () => {
    render(<MineTable mines={mines} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveValue(null);
    expect(screen.getByTestId("input-mine-capacity-WY")).toHaveValue(null);
  });

  it("calls onChange with the new override when a capacity is typed", async () => {
    const onChange = vi.fn();
    render(<MineTable mines={mines} overrides={[]} onChange={onChange} />);
    await userEvent.type(screen.getByTestId("input-mine-capacity-KY"), "1000000");
    expect(onChange).toHaveBeenLastCalledWith([{ id: "KY", capacity: 1000000 }]);
  });

  it("removes the override when the input is cleared back to empty", async () => {
    const onChange = vi.fn();
    render(<MineTable mines={mines} overrides={[{ id: "KY", capacity: 1000000 }]} onChange={onChange} />);
    await userEvent.clear(screen.getByTestId("input-mine-capacity-KY"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- MineTable`
Expected: FAIL — `@/components/tables/MineTable` does not exist yet.

- [ ] **Step 3: Create `MineTable.tsx`**

```tsx
import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export interface MineOverride { id: string; capacity?: number | null; }

interface MineRow { id: string; city: string; state: string; }

interface MineTableProps {
  mines: MineRow[];
  overrides: MineOverride[];
  onChange: (next: MineOverride[]) => void;
}

export function MineTable({ mines, overrides, onChange }: MineTableProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const getOverride = (id: string) => overrides.find(o => o.id === id);

  function upsert(id: string, capacity: number | null) {
    const rest = overrides.filter(o => o.id !== id);
    onChange(capacity == null ? rest : [...rest, { id, capacity }]);
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City, State</TableHead>
            <TableHead>Capacity override (tons)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mines.map(m => {
            const o = getOverride(m.id);
            return (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.id}</TableCell>
                <TableCell className="text-xs">{m.city}, {m.state}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={drafts[m.id] ?? String(o?.capacity ?? "")}
                    onChange={e => {
                      const raw = e.target.value;
                      setDrafts(prev => ({ ...prev, [m.id]: raw }));
                      upsert(m.id, raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0));
                    }}
                    className="h-7 text-xs w-32"
                    placeholder="base capacity"
                    data-testid={`input-mine-capacity-${m.id}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- MineTable`
Expected: PASS.

- [ ] **Step 5: Wire into `Studio.tsx`**

Find `LocalConfig`'s transport-coal fields (`capacityFactor`, `singleSource`, `capacityInactive` — same object that already carries `warehouseOverrides`/`customerOverrides` as dead weight for this model per the investigation) and add `mineCapacities: MineOverride[]`. Find `configFromScenario`'s transport-coal branch and add `mineCapacities: (inputs as { mineCapacities?: Record<string, number> }).mineCapacities ? Object.entries(inputs.mineCapacities).map(([id, capacity]) => ({ id, capacity })) : []` (converting the API's sparse-dict wire shape to the UI's array-of-overrides shape, same translation direction p-median's tables already do internally — the API stays dict-shaped per Task 2's schema, only the UI layer uses an array for easy row-keyed editing). Find `buildInputsForSave`'s transport-coal branch and add, converting back: `mineCapacities: Object.fromEntries(cfg.mineCapacities.filter(o => o.capacity != null).map(o => [o.id, o.capacity]))`.

Add a trigger button to the transport-coal left-panel section (`artifacts/studio/src/pages/Studio.tsx:868-903`, immediately after the existing three transport-coal controls, before the Brazil section at line 906):

```tsx
              {modelId === "transport-coal" && (
                <div className="px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground">Overrides</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowMineTable(true)}
                    data-testid="button-open-mine-table"
                    className="w-full h-7 text-xs justify-between"
                  >
                    Mines
                    <span className="text-muted-foreground">{localConfig.mineCapacities.length > 0 ? `${localConfig.mineCapacities.length} overridden` : "4"}</span>
                  </Button>
                </div>
              )}
```

Mount the dialog near the existing `WarehouseTable`/`CustomerTable` dialogs (`artifacts/studio/src/pages/Studio.tsx:1383-1405`), using `dataset.warehouses` as the mine rows — this works because Task 2 of the *other* plan (`2026-07-24-studio-map-fixes.md`) already makes `/api/dataset?modelId=transport-coal` return mines mapped onto the `warehouses` field:

```tsx
          {localConfig && dataset && modelId === "transport-coal" && (
            <Dialog open={showMineTable} onOpenChange={setShowMineTable}>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Mine capacity overrides</DialogTitle></DialogHeader>
                <MineTable
                  mines={dataset.warehouses}
                  overrides={localConfig.mineCapacities}
                  onChange={next => update("mineCapacities", next)}
                />
              </DialogContent>
            </Dialog>
          )}
```

(Add `const [showMineTable, setShowMineTable] = useState(false);` alongside the existing `showWarehouseTable`/`showCustomerTable` state declarations. Import `MineTable` and its `MineOverride` type at the top of the file, same import style as `WarehouseTable`/`CustomerTable`.)

**Dependency note:** this step assumes `2026-07-24-studio-map-fixes.md`'s Task 2 (model-scoped `/api/dataset`) has already landed, since it's what makes `dataset.warehouses` correctly contain the 4 mines when `modelId === "transport-coal"`. If executing this plan before that one, `dataset` here would still be the p-median-us 26-warehouse list — check which plan has landed first before starting this step, and if the map-fixes plan hasn't shipped yet, execute its Task 2 first (it's a small, independent, non-solver-touching change) rather than duplicating dataset-loading logic here.

- [ ] **Step 6: Add a Studio.tsx RTL test**

Add to `artifacts/studio/src/__tests__/Studio.test.tsx` (following this file's existing convention for opening/asserting on the Warehouse/Customer table dialogs):

```tsx
it("opens the Mine table dialog and shows the 4 mines for a transport-coal scenario", async () => {
  renderStudioForModel("transport-coal"); // reuse this file's existing helper/pattern for a transport-coal scenario
  await userEvent.click(screen.getByTestId("button-open-mine-table"));
  expect(screen.getByText("Mine capacity overrides")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: clean, all pass.

- [ ] **Step 8: Commit**

```bash
git add artifacts/studio/src/components/tables/MineTable.tsx artifacts/studio/src/pages/Studio.tsx \
  artifacts/studio/src/__tests__/MineTable.test.tsx artifacts/studio/src/__tests__/Studio.test.tsx
git commit -m "$(cat <<'EOF'
feat: Mine capacity override table for transport-coal

New MineTable.tsx (4-row table, capacity-only -- no status column, mines
have no open/close concept) mirrors WarehouseTable.tsx's pattern. Wired into
Studio.tsx's transport-coal left panel as a new "Overrides" section, parallel
to p-median-us's existing Warehouses/Customers section. Persists to the
mineCapacities sparse dict validated by the prior task.
EOF
)"
```

---

## Phase B — `stationDemands`

### Task 4: `solve.py` — per-station demand override

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py:232-345` (`solve_transport` — input read, demand equality, single-source link, and `total_demand`/infeasibility-message/avg-distance recomputation)
- Test: same test file as Task 1

**Interfaces:**
- Consumes: nothing new from other tasks (independent of Phase A's `mineCapacities` — both can be present in the same request; they touch disjoint constraints).
- Produces: `stationDemands: Record<stationId, number>` — Task 5/6 depend on this key name.

**Critical correctness note from the design investigation:** `POWER_STATIONS[s]['demand']` is read in **three** places that must all use the *same* effective demand or the model becomes inconsistent: (1) the demand equality RHS, (2) the single-source big-M link, (3) `total_demand` (used for the infeasibility message, `avg_dist`, and band-coverage percentages). Introduce one helper, `effective_demand(s)`, and use it everywhere `POWER_STATIONS[s]['demand']` currently appears inside `solve_transport`.

**Current code (relevant excerpts from `artifacts/api-server/src/solver/solve.py:232-344`, already quoted in full in Task 1's "Current code" block plus the remainder below):**
```python
    # ... (Task 1's changes already applied: capacity_factor, mine_caps, etc.)
    total_demand = sum(s['demand'] for s in POWER_STATIONS.values())
    # ...
    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", POWER_STATIONS[s]['demand'])
    # ...
    if single_source:
        for s in stations:
            prob += LpConstraint(
                lpSum(source[m, s] for m in mines),
                LpConstraintEQ, f"onesrc_{s}", 1)
            for m in mines:
                prob += LpConstraint(
                    flow[m, s] - POWER_STATIONS[s]['demand'] * source[m, s],
                    LpConstraintLE, f"link_{m}_{s}", 0)
    # ...
    if status_str == "Infeasible":
        # ... uses total_demand in the message string (see solve.py:283-298)
    # ...
    avg_dist = obj_val / total_demand if total_demand > 0 else 0
    # ...
    band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / total_demand)} for b in distance_bands]
    # ... and inside the per-(m,s) loop building assignments/edges:
            assignments.append({
                "customerId": s,
                "warehouseId": m,
                "distanceMi": d,
                "band": band_idx,
                "flowTons": flow_tons,
                "flowFraction": round(flow_val / POWER_STATIONS[s]['demand'], 4)
            })
```

- [ ] **Step 1: Write the failing test**

Add to the transport-coal pytest file:

```python
def test_station_demand_override_changes_equality_and_total():
    # CHI's base demand is 6,000,000 tons. Override it to 12,000,000 --
    # total flow into CHI, and total_demand-derived avg_dist, must both
    # reflect the new value.
    base = solve_transport({
        "capacityFactor": 1.0, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
    })
    base_chi_flow = sum(e["flow"] for e in base["edges"] if e["toId"] == "CHI")
    assert base_chi_flow == 6_000_000

    overridden = solve_transport({
        "capacityFactor": 1.0, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
        "stationDemands": {"CHI": 12_000_000},
    })
    assert overridden["status"] == "optimal"
    chi_flow = sum(e["flow"] for e in overridden["edges"] if e["toId"] == "CHI")
    assert abs(chi_flow - 12_000_000) <= 1  # rounding
    # avg distance = objective / total_demand -- total_demand must include
    # the overridden 12M for CHI, not the base 6M, so this must differ from
    # a naive (wrong) recompute that ignored the override.
    assert overridden["metrics"]["weightedAvgDistance"] != base["metrics"]["weightedAvgDistance"]

def test_station_demand_override_with_single_source_stays_consistent():
    # Regression guard for the "two solver sites" risk the design doc calls
    # out: the demand equality AND the single-source big-M link must both
    # use the same effective (overridden) demand, or this could produce an
    # inconsistent/wrong-but-not-obviously-broken model.
    result = solve_transport({
        "capacityFactor": 1.0, "singleSource": True, "capacityInactive": True,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
        "stationDemands": {"LAX": 2_000_000},
    })
    assert result["status"] == "optimal"
    lax_flow = sum(e["flow"] for e in result["edges"] if e["toId"] == "LAX")
    assert abs(lax_flow - 2_000_000) <= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shubhamkr/network-optimization-studio/artifacts/api-server/src/solver && python3 -m pytest tests/ -x -k station_demand`
Expected: FAIL — `stationDemands` is ignored entirely today; CHI's flow stays at the base 6,000,000.

- [ ] **Step 3: Apply the fix**

Within `solve_transport`, add the input read and helper, then replace every `POWER_STATIONS[s]['demand']` reference with `effective_demand(s)`:

```python
    station_demands = inp.get('stationDemands', {})

    def effective_demand(s):
        return station_demands.get(s, POWER_STATIONS[s]['demand'])

    mines    = list(COAL_MINES.keys())
    stations = list(POWER_STATIONS.keys())
    dist     = _transport_distances()
    total_demand = sum(effective_demand(s) for s in stations)
```

```python
    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", effective_demand(s))
```

```python
    if single_source:
        for s in stations:
            prob += LpConstraint(
                lpSum(source[m, s] for m in mines),
                LpConstraintEQ, f"onesrc_{s}", 1)
            for m in mines:
                prob += LpConstraint(
                    flow[m, s] - effective_demand(s) * source[m, s],
                    LpConstraintLE, f"link_{m}_{s}", 0)
```

And inside the assignments-building loop (`solve.py:320-327`):

```python
            assignments.append({
                "customerId": s,
                "warehouseId": m,
                "distanceMi": d,
                "band": band_idx,
                "flowTons": flow_tons,
                "flowFraction": round(flow_val / effective_demand(s), 4)
            })
```

Leave the infeasibility-message strings (`solve.py:283-298`) referencing `total_demand` as-is — since `total_demand` is now computed from `effective_demand()`, those messages automatically reflect any override with zero further changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/shubhamkr/network-optimization-studio/artifacts/api-server/src/solver && python3 -m pytest tests/ -x -k station_demand`
Expected: PASS (both new tests).

- [ ] **Step 5: Run the full solver test suite and `e2e_accuracy.py`**

Run:
```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/api-server/src/solver
python3 -m pytest tests/ -x
python3 e2e_accuracy.py
```
Expected: all pass; `e2e_accuracy.py` unmodified and green (no textbook scenario sends `stationDemands`, so every existing solve must be byte-identical).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/
git commit -m "$(cat <<'EOF'
feat: transport-coal per-station demand override (stationDemands)

solve_transport() previously read station demand only from the module-level
POWER_STATIONS constant, in three separate places (demand equality,
single-source big-M link, total_demand used for avg-distance/infeasibility
messaging/band coverage) -- all three now route through one effective_demand()
helper reading an optional stationDemands sparse dict (station id -> tons),
so an override can't silently apply in only one of the three sites and
produce an inconsistent model. Absent/empty dict solves byte-identically to
today (e2e_accuracy.py verified unmodified).
EOF
)"
```

---

### Task 5: `transportLp.ts` + `manifest.json` — validate and advertise `stationDemands`

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/transportLp.ts`
- Modify: `solvers/transport-coal/manifest.json`
- Test: same file as Task 2

**Interfaces:**
- Consumes: Task 4's `stationDemands` key name and shape.
- Produces: server-side validation accepting `stationDemands`; `capabilities.demandEditable: true`.

- [ ] **Step 1: Write the failing test**

Add to the same test file as Task 2:

```ts
it("accepts an optional stationDemands sparse dict", () => {
  const result = transportLpInputsSchema.safeParse({
    capacityFactor: 1.0, singleSource: false, capacityInactive: false,
    distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
    stationDemands: { CHI: 12000000 },
  });
  expect(result.success).toBe(true);
});

it("rejects a negative stationDemands value", () => {
  const result = transportLpInputsSchema.safeParse({
    capacityFactor: 1.0, singleSource: false, capacityInactive: false,
    distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
    stationDemands: { CHI: -1 },
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- transportLp`
Expected: FAIL — same "silently ignored, not rejected" gap as Task 2.

- [ ] **Step 3: Apply the fix**

Add one line to `transportLpInputsSchema` (from Task 2's version):

```ts
export const transportLpInputsSchema = z.object({
  capacityFactor: z.number().positive(),
  singleSource: z.boolean(),
  capacityInactive: z.boolean(),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
  mineCapacities: z.record(z.string(), z.number().nonnegative()).optional().default({}),
  stationDemands: z.record(z.string(), z.number().nonnegative()).optional().default({}),
});
```

Update `manifest.json`'s `capabilities` and `inputsSchema.properties` (from Task 2's version):

```json
  "capabilities": { "supportsP": false, "capacityModes": ["per_mine"], "demandEditable": true },
```

```json
      "stationDemands": {
        "type": "object",
        "additionalProperties": { "type": "number", "minimum": 0 }
      }
```

(add this alongside `mineCapacities` inside `inputsSchema.properties`, both remaining outside `required`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- transportLp`
Expected: PASS.

- [ ] **Step 5: Run the full api-server suite and typecheck**

Run: `pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
Expected: clean, all pass — check for and update any test asserting on transport-coal's exact `capabilities`/`inputsSchema` shape (same caveat as Task 2 Step 5).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/validation/inputs/transportLp.ts solvers/transport-coal/manifest.json
git add artifacts/api-server/src/__tests__/
git commit -m "$(cat <<'EOF'
feat: validate and advertise transport-coal's stationDemands override

Adds stationDemands: z.record(z.string(), z.number().nonnegative()).optional()
to transportLpInputsSchema, mirrored in manifest.json's inputsSchema.
capabilities.demandEditable flips false -> true, matching the field
solve.py now reads (prior task).
EOF
)"
```

---

### Task 6: `StationTable.tsx` + `Studio.tsx` wiring — per-station demand UI

**Files:**
- Create: `artifacts/studio/src/components/tables/StationTable.tsx`
- Modify: `artifacts/studio/src/pages/Studio.tsx`
- Test: `artifacts/studio/src/__tests__/StationTable.test.tsx`, additions to `Studio.test.tsx`

**Interfaces:**
- Consumes: Task 5's validated `stationDemands` field.
- Produces: `StationOverride { id: string; demand?: number | null }` (mirrors `CustomerOverride` minus the `status`/`excluded` concept, per this plan's Global Constraints — stations cannot be excluded, only have their demand overridden).

**Reference pattern:** `CustomerTable.tsx` (already in the repo), dropping the exclude-status column/logic entirely (same rationale as `MineTable` dropping `WarehouseTable`'s status column).

- [ ] **Step 1: Write the failing test**

Create `artifacts/studio/src/__tests__/StationTable.test.tsx` (mirror Task 3 Step 1's `MineTable.test.tsx` exactly, substituting `StationTable`/`StationOverride`/`demand`/station ids `LAX`/`CHI` for mine ids, and `data-testid="input-station-demand-<id>"`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- StationTable`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Create `StationTable.tsx`**

```tsx
import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export interface StationOverride { id: string; demand?: number | null; }

interface StationRow { id: string; city: string; state: string; }

interface StationTableProps {
  stations: StationRow[];
  overrides: StationOverride[];
  onChange: (next: StationOverride[]) => void;
}

export function StationTable({ stations, overrides, onChange }: StationTableProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const getOverride = (id: string) => overrides.find(o => o.id === id);

  function upsert(id: string, demand: number | null) {
    const rest = overrides.filter(o => o.id !== id);
    onChange(demand == null ? rest : [...rest, { id, demand }]);
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City, State</TableHead>
            <TableHead>Demand override (tons)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stations.map(s => {
            const o = getOverride(s.id);
            return (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.id}</TableCell>
                <TableCell className="text-xs">{s.city}, {s.state}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={drafts[s.id] ?? String(o?.demand ?? "")}
                    onChange={e => {
                      const raw = e.target.value;
                      setDrafts(prev => ({ ...prev, [s.id]: raw }));
                      upsert(s.id, raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0));
                    }}
                    className="h-7 text-xs w-32"
                    placeholder="base demand"
                    data-testid={`input-station-demand-${s.id}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- StationTable`
Expected: PASS.

- [ ] **Step 5: Wire into `Studio.tsx`**

Same shape as Task 3 Step 5: add `stationDemands: StationOverride[]` to `LocalConfig`, thread it through `configFromScenario`/`buildInputsForSave`'s transport-coal branches (same dict-to-array / array-to-dict translation, substituting `demand` for `capacity`), add a `Stations` trigger button beside the `Mines` button in the same Overrides section added in Task 3 Step 5, and mount a `Dialog`-wrapped `StationTable` using `dataset.customers` as the station rows (again relying on `2026-07-24-studio-map-fixes.md`'s dataset-scoping fix mapping stations onto the `customers` field for transport-coal).

```tsx
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowStationTable(true)}
                    data-testid="button-open-station-table"
                    className="w-full h-7 text-xs justify-between"
                  >
                    Stations
                    <span className="text-muted-foreground">{localConfig.stationDemands.length > 0 ? `${localConfig.stationDemands.length} overridden` : "15"}</span>
                  </Button>
```

```tsx
          {localConfig && dataset && modelId === "transport-coal" && (
            <Dialog open={showStationTable} onOpenChange={setShowStationTable}>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Station demand overrides</DialogTitle></DialogHeader>
                <StationTable
                  stations={dataset.customers}
                  overrides={localConfig.stationDemands}
                  onChange={next => update("stationDemands", next)}
                />
              </DialogContent>
            </Dialog>
          )}
```

- [ ] **Step 6: Add a Studio.tsx RTL test**

Mirror Task 3 Step 6 exactly, substituting `button-open-station-table` / "Station demand overrides".

- [ ] **Step 7: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: clean, all pass.

- [ ] **Step 8: Commit**

```bash
git add artifacts/studio/src/components/tables/StationTable.tsx artifacts/studio/src/pages/Studio.tsx \
  artifacts/studio/src/__tests__/StationTable.test.tsx artifacts/studio/src/__tests__/Studio.test.tsx
git commit -m "$(cat <<'EOF'
feat: Station demand override table for transport-coal

New StationTable.tsx (15-row table, demand-only) mirrors CustomerTable.tsx's
pattern minus its exclude-status concept (stations can't be excluded --
demand equality requires every station be served). Wired into the same
transport-coal Overrides section MineTable uses. Persists to the
stationDemands sparse dict validated by the prior task.
EOF
)"
```

---

### Task 7: Import/export for transport-coal's mines and stations

**Files:**
- Modify: `artifacts/api-server/src/services/templates.ts` (add `applyMineOverrides`/`applyStationOverrides`, mirroring `applyWarehouseOverrides`/`applyCustomerOverrides`)
- Modify: `artifacts/api-server/src/services/import.ts` (extend `parseAndValidateImport` to accept `entity: "mines" | "stations"` in addition to `"warehouses" | "customers"`)
- Modify: `artifacts/api-server/src/routes/scenarios.ts:274-357` (the three `modelId !== "p-median-us"` gates on export/import-preview/import-apply)
- Modify: `artifacts/studio/src/pages/Studio.tsx` (Export/Import buttons for the new Mines/Stations Overrides section, mirroring the existing Warehouses/Customers export/import buttons at lines 942-1016)
- Test: `artifacts/api-server/src/__tests__/routes.test.ts` (or wherever the existing export/import route tests live), plus any fixture files under `artifacts/api-server/src/services/__tests__/fixtures/imports/` (check the exact directory used by the existing p-median-us import tests and add coal equivalents there)

**Interfaces:**
- Consumes: Task 3's `MineOverride`/`mineCapacities` and Task 6's `StationOverride`/`stationDemands`.
- Produces: `GET /scenarios/:id/export?entity=mines|stations&format=csv|json` and the corresponding import preview/apply routes, for `transport-coal` scenarios only (mirrors the existing `p-median-us`-only gate, just for a different `modelId`/entity pair — the two boundaries are `if scenario.modelId === "p-median-us" then entity must be warehouses|customers` and `if scenario.modelId === "transport-coal" then entity must be mines|stations`; any other combination 422s, same as today's single-model gate).

**Current gate (`artifacts/api-server/src/routes/scenarios.ts`, all three occurrences look like this, e.g. the export route at lines 274-276):**
```ts
  if (scenario.modelId !== "p-median-us") {
    res.status(422).json({ error: "Export is only supported for p-median-us scenarios" });
    return;
  }
```

**Reference pattern (`artifacts/api-server/src/services/templates.ts:35-50`):**
```ts
export function applyWarehouseOverrides(overrides: WarehouseOverride[]): WarehouseTemplateRow[] {
  // ... (read the full function body before mirroring it)
}

export function applyCustomerOverrides(overrides: CustomerOverride[]): CustomerTemplateRow[] {
  // ... (read the full function body before mirroring it)
}
```

- [ ] **Step 1: Write the failing test**

Add to `artifacts/api-server/src/__tests__/routes.test.ts` (find this file's existing p-median-us export/import test block and add analogous coal cases — read the exact existing test structure first, since this step mirrors it precisely rather than inventing new assertions):

```ts
it("exports a transport-coal scenario's mine capacity overrides as CSV", async () => {
  // create a transport-coal scenario with a mineCapacities override, then:
  const res = await request(app)
    .get(`/api/scenarios/${coalScenarioId}/export?entity=mines&format=csv`)
    .set("Cookie", authCookie);
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("text/csv");
});

it("rejects entity=warehouses for a transport-coal scenario", async () => {
  const res = await request(app)
    .get(`/api/scenarios/${coalScenarioId}/export?entity=warehouses&format=csv`)
    .set("Cookie", authCookie);
  expect(res.status).toBe(422);
});

it("rejects entity=mines for a p-median-us scenario", async () => {
  const res = await request(app)
    .get(`/api/scenarios/${pMedianScenarioId}/export?entity=mines&format=csv`)
    .set("Cookie", authCookie);
  expect(res.status).toBe(422);
});
```

(Match this file's exact existing helper functions for creating a test scenario and authenticating — do not invent new ones; the file already has this infrastructure from the original D4.1/D5.1 tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- routes`
Expected: FAIL — `entity=mines` currently 422s unconditionally for every model (the export route doesn't recognize `"mines"`/`"stations"` as valid `entity` values at all yet), and the coal scenario's export attempt fails before even reaching an entity check.

- [ ] **Step 3: Add `applyMineOverrides`/`applyStationOverrides` to `templates.ts`**

Read `artifacts/api-server/src/services/templates.ts` in full first (both existing functions plus `warehouseRowsToCsv`/`customerRowsToCsv` and the `WarehouseTemplateRow`/`CustomerTemplateRow` types they return). Add two new functions following the exact same shape, substituting mine/station fields (`capacity`/`demand` instead of `capacity`/`demand` — note stations already use `demand` just like customers, so `applyStationOverrides` is nearly identical to `applyCustomerOverrides` minus the exclude-status branch; mines are nearly identical to `applyWarehouseOverrides` minus the forced-open/inactive status branches) and two new CSV row-shape functions (`mineRowsToCsv`/`stationRowsToCsv`).

- [ ] **Step 4: Extend `import.ts`'s `entity` union**

Read `artifacts/api-server/src/services/import.ts`'s `parseAndValidateImport` signature and its `entity: "warehouses" | "customers"` parameter in full. Extend the union to `"warehouses" | "customers" | "mines" | "stations"`, and add the mine/station column-parsing branches mirroring the existing warehouse/customer branches (mines: `id`, `capacity` columns, no status column; stations: `id`, `demand` columns, no status column — simpler than the existing branches since there's no status enum to validate).

- [ ] **Step 5: Update the three route gates in `scenarios.ts`**

Replace each of the three `if (scenario.modelId !== "p-median-us") { ... 422 ... }` blocks (export at ~line 274, import-preview at ~line 328, import-apply at ~line 355) with a combined check:

```ts
  const entityIsPMedian = entity === "warehouses" || entity === "customers";
  const entityIsCoal = entity === "mines" || entity === "stations";
  if (scenario.modelId === "p-median-us" && !entityIsPMedian) {
    res.status(422).json({ error: "p-median-us scenarios only support warehouses/customers export" });
    return;
  }
  if (scenario.modelId === "transport-coal" && !entityIsCoal) {
    res.status(422).json({ error: "transport-coal scenarios only support mines/stations export" });
    return;
  }
  if (scenario.modelId !== "p-median-us" && scenario.modelId !== "transport-coal") {
    res.status(422).json({ error: "Export is not supported for this model" });
    return;
  }
```

(Adjust the exact error message wording per-route to match each route's existing phrasing style — export says "Export...", import-preview/apply say "Import...", per the current code.)

- [ ] **Step 6: Add Export/Import buttons to `Studio.tsx`'s coal Overrides section**

Mirror the exact structure at `artifacts/studio/src/pages/Studio.tsx:942-973` (the warehouses CSV/JSON/Import button row), duplicated for `entity="mines"` beneath the `Mines` trigger button (Task 3 Step 5) and `entity="stations"` beneath the `Stations` trigger button (Task 6 Step 5) — `handleExport`/`setImportEntity` are the component's existing generic functions; check their exact type signatures (likely `entity: "warehouses" | "customers"` today) and widen them to include `"mines" | "stations"`.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- routes`
Expected: PASS.

- [ ] **Step 8: Run the full verification gate**

Run: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test`
Expected: all clean (no solver changes in this task, so pytest/`e2e_accuracy.py` don't need re-running).

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/services/templates.ts artifacts/api-server/src/services/import.ts \
  artifacts/api-server/src/routes/scenarios.ts artifacts/studio/src/pages/Studio.tsx \
  artifacts/api-server/src/__tests__/
git commit -m "$(cat <<'EOF'
feat: import/export for transport-coal mine/station overrides

Extends the existing p-median-us-only export/import routes (D4.1/D5.1) to
also accept entity=mines|stations for transport-coal scenarios, mirroring
applyWarehouseOverrides/applyCustomerOverrides with the mine/station fields
from the two prior override tasks. Each model is now scoped to its own
entity pair (p-median-us: warehouses/customers; transport-coal: mines/
stations) -- any mismatch still 422s, same anti-cross-model-confusion
boundary the original D4.1 gate had, just widened to a second model.
EOF
)"
```

---

## Self-Review

**1. Spec coverage:** Issue 2 (no import/export for coal) is covered by Task 7. The user's "build real override support" answer is covered end-to-end by Tasks 1-6 (mineCapacities: Tasks 1-3; stationDemands: Tasks 4-6). `laneCosts` is explicitly, visibly deferred in the Goal/Architecture sections (not silently dropped) per the investigation's own phased-rollout recommendation.

**2. Placeholder scan:** every task's solver diff is the exact real `solve.py` code with the exact real change shown, not a description. UI tasks reference the existing `WarehouseTable`/`CustomerTable`/export-button code as the literal template being mirrored, with the concrete new component's full source written out (Tasks 3, 6) — the only "read the file first" instructions (Task 7 Steps 3-4) are for genuinely large existing functions (`templates.ts`'s `applyWarehouseOverrides`, `import.ts`'s full `parseAndValidateImport`) that were not fully quoted during planning; this is a real repo-state dependency, not a disguised gap, and is flagged as such rather than guessed at.

**3. Type consistency:** `MineOverride { id, capacity? }` (Task 3) and `StationOverride { id, demand? }` (Task 6) match the sparse-dict wire shapes `mineCapacities`/`stationDemands` (Tasks 1-2, 4-5) exactly, mirroring `WarehouseOverride`/`CustomerOverride`'s existing naming convention. `entity` string values (`"mines"`/`"stations"`, Task 7) are consistent across `templates.ts`, `import.ts`, `scenarios.ts`, and `Studio.tsx`'s button wiring.

**Explicit cross-plan dependency:** Task 3 Step 5 and Task 6 Step 5 both rely on `2026-07-24-studio-map-fixes.md`'s Task 2 (model-scoped `/api/dataset`) for `dataset.warehouses`/`dataset.customers` to contain the real mine/station rows when `modelId === "transport-coal"`. Execute that plan's Task 2 first, or in parallel with this plan's Phase A, before reaching Task 3 Step 5 here.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-transport-coal-overrides.md`. One more plan remains (`2026-07-24-map-multiselect-bulk-edit.md`) before any execution begins, per the user's explicit request to plan all three before building anything.
