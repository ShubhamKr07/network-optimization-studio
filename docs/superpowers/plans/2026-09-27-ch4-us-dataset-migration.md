# Chapter 4 US Dataset Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Chapter 4's China dataset with Al's Athletics US data and rename the model `chens-cosmetics-cn` → `max-coverage-us`, so Chapters 3 and 4 differ by the question asked rather than the data.

**Architecture:** Chapter 4 keeps its own copy of the US data (own `version.json`), stores Chapter 3's distances converted to km with **no** circuity transform, and the `× 1.17` multiplication is removed from the solver and moved to the added-entity estimator. The rename is a deregistration plus a registration across all ten registration points in `model-integration-precheck.md` Gate 1.

**Tech Stack:** pnpm monorepo · TypeScript/Express/Drizzle · Zod validators · Orval codegen from `lib/api-spec/openapi.yaml` · Python 3 / PuLP / CBC · vitest + pytest + Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-27-ch4-us-dataset-migration-design.md`](../specs/2026-09-27-ch4-us-dataset-migration-design.md) — approved 2026-09-27. Decision ids (`MIG-n`) below refer to it.

## Global Constraints

- **Never edit generated code.** `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**` come from Orval. Change `lib/api-spec/openapi.yaml`, run codegen, commit spec + output together (hard rule #1, #4).
- **`e2e_accuracy.py` is sacred** and must pass unmodified (hard rule #2). Verified 2026-09-27: it contains no Chapter 4 section, so no task here touches it.
- **Solver changes enter as data, not branches** (hard rule #6). The only solver edit in this plan is the *removal* of a constant multiplication (MIG-1/MIG-6).
- **Do not touch `attached_assets/`** (hard rule #7). The three ChensCosmetics notebooks stay.
- **Public model id:** `max-coverage-us`. **Private wire `modelType`:** `max_coverage_us`. These are different strings and neither is derivable from the other (MIG-21).
- **`p` maximum is 26** for this model, declared in exactly four places (MIG-8).
- **Every commit message** ends with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch:** all work lands on a descriptive branch, never directly on `main` (branch discipline).
- **Verification gate**, run before any task is considered done:
  ```bash
  pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
    && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
  ```

## Deviation from the spec, recorded

MIG-3 requires the rename "in one commit". Task 2 is therefore large. It is **not** split further because every intermediate split leaves the repo red — `StudioModelType` in `artifacts/studio/src/lib/chapters.ts:1` is a union of model ids consumed across ~30 frontend files, so renaming the backend without the frontend fails `pnpm run typecheck`. A reviewer cannot meaningfully approve half a rename. Per hard rule #8 this deviation (one large task rather than several) is noted here and in Task 2's commit body.

## File Structure

**Created**
- `solvers/max-coverage-us/manifest.json` — model manifest, US bounds, `p.maximum: 26`.
- `solvers/max-coverage-us/dataset/{warehouses,customers,distances,version}.json` — Chapter 4's own copy.
- `scripts/src/build-max-coverage-dataset.ts` — one-off generator, kept for provenance.
- `artifacts/api-server/src/validation/inputs/maxCoverage.ts` — renamed from `chens.ts`.
- `artifacts/api-server/src/__tests__/registration.test.ts` — does not exist yet; Gate 1's BLOCKER item.
- `artifacts/api-server/src/solver/tests/test_max_coverage.py` — renamed from `test_chens.py`, goldens regenerated.
- `docs/ops/ch4-migration-runbook.md` — the Stage A–D production runbook.
- `scripts/src/migrate-delete-chens-scenarios.ts` — the gated deletion script.

**Deleted**
- `solvers/chens-cosmetics-cn/` (manifest + dataset + README).
- `scripts/src/extract-chens-dataset.ts`, `scripts/src/geocode-chens.ts`.
- `docs/dataset-audit/chens-geocode-provenance.json`.

**Modified** — the ten registration points plus their consumers; enumerated per task.

---

### Task 1: Build Chapter 4's dataset package

Produces the new data. Nothing references it yet, so the repo stays green.

**Files:**
- Create: `scripts/src/build-max-coverage-dataset.ts`
- Create: `solvers/max-coverage-us/dataset/{warehouses,customers,distances,version}.json`
- Test: `lib/dataset-schema/src/maxCoverageDataset.test.ts`

**Interfaces:**
- Consumes: `solvers/p-median-us/dataset/{warehouses,customers,distances}.json` (read-only; Chapter 3 is untouched).
- Produces: a dataset package keyed by entity id, matching `PACKAGE_SPECS`' `z.record(z.string(), WarehouseEntry)` / `CustomerEntry` / `DistanceMap` shapes, consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `lib/dataset-schema/src/maxCoverageDataset.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { SOLVERS_ROOT } from "../index.js";

const dir = path.join(SOLVERS_ROOT, "max-coverage-us", "dataset");
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
const MI2KM = 1.609344;

describe("max-coverage-us dataset package", () => {
  it("has 26 warehouses and 200 customers, keyed by entity id", () => {
    const w = read("warehouses.json");
    const c = read("customers.json");
    expect(Object.keys(w)).toHaveLength(26);
    expect(Object.keys(c)).toHaveLength(200);
    expect(w["ALN"]).toMatchObject({ id: "ALN", city: "Allentown", state: "PA" });
    expect(c["C1"]).toMatchObject({ id: "C1", city: "Akron", state: "OH", demand: 205375 });
    for (const [key, row] of Object.entries(w)) expect((row as { id: string }).id).toBe(key);
    for (const [key, row] of Object.entries(c)) expect((row as { id: string }).id).toBe(key);
  });

  it("has all 5200 distance pairs, keyed '<warehouseId>,<customerId>' in km", () => {
    const d = read("distances.json");
    const src = read2("distances.json");
    expect(Object.keys(d)).toHaveLength(5200);
    // Chapter 3's ALN->C1 in miles, converted, with NO circuity transform (MIG-6).
    const alnC1Mi = src["1,1"];
    expect(d["ALN,C1"]).toBeCloseTo(alnC1Mi * MI2KM, 6);
  });

  it("preserves co-located pairs rather than recomputing them (MIG-6)", () => {
    const d = read("distances.json");
    const zeros = Object.values(d).filter((v) => v === 0);
    expect(zeros).toHaveLength(4);
    const twos = Object.values(d).filter((v) => Math.abs((v as number) - 2 * MI2KM) < 1e-9);
    expect(twos).toHaveLength(8);
  });

  it("version.json carries version 1 and the computed sha256", () => {
    const v = read("version.json");
    expect(v.version).toBe(1);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

function read2(f: string) {
  return JSON.parse(readFileSync(path.join(SOLVERS_ROOT, "p-median-us", "dataset", f), "utf8"));
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/dataset-schema test -- maxCoverageDataset
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../solvers/max-coverage-us/dataset/warehouses.json'`

- [ ] **Step 3: Write the generator**

Create `scripts/src/build-max-coverage-dataset.ts`:

```ts
// ONE-OFF (Ch4 US migration, MIG-5/MIG-6). Builds Chapter 4's own copy of
// Al's Athletics data from Chapter 3's package. Kept in the tree for
// provenance; not part of any build step.
//
// Two transforms, both deliberate:
//  1. Re-key by entity id. p-median-us keys entities by ordinal ("1","2")
//     with the real id inside the record; Chapter 4's loader keys by id.
//  2. Convert miles to km. NO circuity factor is applied or removed --
//     Chapter 3's matrix is pre-baked and its numbers are used as-is
//     (MIG-6). solve_max_coverage does not multiply.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { createHash } from "crypto";

const MI2KM = 1.609344;
const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "solvers", "p-median-us", "dataset");
const OUT = path.join(ROOT, "solvers", "max-coverage-us", "dataset");

const read = (f: string) => JSON.parse(readFileSync(path.join(SRC, f), "utf8"));

const srcW = read("warehouses.json") as Record<string, { id: string }>;
const srcC = read("customers.json") as Record<string, { id: string }>;
const srcD = read("distances.json") as Record<string, number>;

const warehouses: Record<string, unknown> = {};
for (const row of Object.values(srcW)) warehouses[row.id] = row;

const customers: Record<string, unknown> = {};
for (const row of Object.values(srcC)) customers[row.id] = row;

const distances: Record<string, number> = {};
for (const [key, miles] of Object.entries(srcD)) {
  const [wOrd, cOrd] = key.split(",");
  distances[`${srcW[wOrd].id},${srcC[cOrd].id}`] = miles * MI2KM;
}

mkdirSync(OUT, { recursive: true });
const files: Record<string, unknown> = {
  "customers.json": customers,
  "distances.json": distances,
  "warehouses.json": warehouses,
};
for (const [name, value] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + "\n");
}

// sha256 over the three data files in sorted filename order -- byte-identical
// to lib/dataset-schema's computeSha256(), which version.json is checked
// against at load time.
const hash = createHash("sha256");
for (const name of Object.keys(files).sort()) {
  hash.update(readFileSync(path.join(OUT, name)));
}
writeFileSync(
  path.join(OUT, "version.json"),
  JSON.stringify({ version: 1, sha256: hash.digest("hex") }, null, 2) + "\n",
);

console.log(
  `wrote ${Object.keys(warehouses).length} warehouses, ` +
  `${Object.keys(customers).length} customers, ` +
  `${Object.keys(distances).length} distances`,
);
```

- [ ] **Step 4: Run the generator**

```bash
pnpm --filter @workspace/scripts exec tsx src/build-max-coverage-dataset.ts
```

Expected: `wrote 26 warehouses, 200 customers, 5200 distances`

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @workspace/dataset-schema test -- maxCoverageDataset
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/src/build-max-coverage-dataset.ts solvers/max-coverage-us/dataset \
        lib/dataset-schema/src/maxCoverageDataset.test.ts
git commit -m "$(cat <<'EOF'
[ch4-mig-1] build Chapter 4's own copy of Al's Athletics data

Re-keyed by entity id and converted to km. No circuity transform: Chapter 3's
matrix is pre-baked and its values are used as-is (MIG-6). Co-located pairs --
4 at 0 miles, 8 at 2 miles -- survive because nothing is recomputed from
coordinates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Cutover — rename the model and swap the dataset

The atomic rename. Large by necessity (see "Deviation from the spec"). At the end of this task the old model does not exist and the gate is green.

**Files:**
- Create: `solvers/max-coverage-us/manifest.json`, `artifacts/api-server/src/validation/inputs/maxCoverage.ts`, `artifacts/api-server/src/__tests__/registration.test.ts`
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts:9,31`, `artifacts/api-server/src/routes/scenarios.ts:92-108`, `lib/dataset-schema/src/index.ts:161,275`, `artifacts/api-server/src/solver/pmedian.ts:137-169`, `artifacts/api-server/src/solver/solve.py:169-175,1395-1490`, `artifacts/api-server/src/solver/merge_inputs.py:908`, `lib/api-spec/openapi.yaml:47,172,1427,1631`, every frontend file referencing the old id
- Rename: `artifacts/api-server/src/solver/tests/test_chens.py` → `test_max_coverage.py`
- Delete: `artifacts/api-server/src/validation/inputs/chens.ts`

**Interfaces:**
- Consumes: Task 1's dataset package at `solvers/max-coverage-us/dataset/`.
- Produces: public model id `max-coverage-us`; wire `modelType` `"max_coverage_us"`; `maxCoverageInputsSchema` (same shape as the old `chensInputsSchema`, `p` max raised to 26); Python `solve_max_coverage(inp)` returning the standard envelope; `WAREHOUSES_MAX_COVERAGE` / `CUSTOMERS_MAX_COVERAGE` / `DISTANCE_MAX_COVERAGE` module globals; `build_merged_max_coverage_dataset(...)`.

- [ ] **Step 1: Write the failing registration test**

Create `artifacts/api-server/src/__tests__/registration.test.ts`. This is `model-integration-precheck.md` Gate 1's BLOCKER item and does not exist yet:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { KNOWN_MODEL_IDS } from "../registry/modelRegistry.js";
import { VALID_MODEL_IDS } from "../routes/scenarios.js";
import { MODEL_IDS } from "@workspace/dataset-schema";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");

describe("model registration consistency", () => {
  it("every implemented model is in VALID_MODEL_IDS", () => {
    for (const id of KNOWN_MODEL_IDS) expect(VALID_MODEL_IDS.has(id)).toBe(true);
  });

  it("VALID_MODEL_IDS contains no id without a Zod validator (MIG-22)", () => {
    for (const id of VALID_MODEL_IDS) expect(KNOWN_MODEL_IDS).toContain(id);
  });

  it("every implemented model has a dataset package spec", () => {
    for (const id of KNOWN_MODEL_IDS) expect(MODEL_IDS).toContain(id);
  });

  it("the OpenAPI modelId enum matches the implemented set", () => {
    const yaml = read("lib/api-spec/openapi.yaml");
    for (const id of KNOWN_MODEL_IDS) expect(yaml).toContain(id);
    for (const dead of ["max_coverage", "p_center", "set_cover"]) {
      expect(yaml).not.toContain(`- ${dead}\n`);
    }
  });

  it("buildPayload has a branch for max-coverage-us emitting the declared wire value (MIG-21)", () => {
    const src = read("artifacts/api-server/src/solver/pmedian.ts");
    expect(src).toContain('input.modelId === "max-coverage-us"');
    expect(src).toContain('modelType: "max_coverage_us"');
    expect(src).not.toContain('modelType: "chens"');
  });

  it("solve.py dispatches the declared wire value and no longer knows 'chens'", () => {
    const src = read("artifacts/api-server/src/solver/solve.py");
    expect(src).toContain("if model_type == 'max_coverage_us':");
    expect(src).not.toContain("'chens'");
  });

  it("no source file still references the retired model id", () => {
    const src = read("artifacts/api-server/src/registry/modelRegistry.ts");
    expect(src).not.toContain("chens");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter api-server test -- registration
```

Expected: FAIL — `VALID_MODEL_IDS contains no id without a Zod validator` fails on `max_coverage`, and the `buildPayload` / `solve.py` assertions fail on the old names.

- [ ] **Step 3: Create the manifest**

Create `solvers/max-coverage-us/manifest.json` — copy `solvers/chens-cosmetics-cn/manifest.json` and change exactly five things: `id`, `name`, `datasetDir`, `countryBounds`, and `p.maximum`:

```json
{
  "id": "max-coverage-us",
  "name": "Al's Athletics — Max Coverage",
  "chapter": "Chapter 4",
  "datasetDir": "solvers/max-coverage-us/dataset",
  "distanceUnit": "km",
  "countryBounds": { "sw": [25.78, -123.11], "ne": [47.67, -71.02] },
  "capabilities": {
    "supportsP": true,
    "capacityModes": ["none"],
    "demandEditable": true,
    "supportsFacilityStatus": true,
    "supportsAddedCustomerExclusion": true,
    "supportsReferenceDistances": true,
    "outputGrids": ["openWarehouses", "assignments", "costSummary", "serviceStats"]
  },
  "inputsSchema": { "…": "copy verbatim from the old manifest, changing only p.maximum from 25 to 26" }
}
```

Copy the `inputsSchema` block byte-for-byte from `solvers/chens-cosmetics-cn/manifest.json` and change only `"p": { "type": "integer", "minimum": 1, "maximum": 25 }` → `"maximum": 26`.

- [ ] **Step 4: Rename the validator module and raise the `p` cap**

```bash
git mv artifacts/api-server/src/validation/inputs/chens.ts \
       artifacts/api-server/src/validation/inputs/maxCoverage.ts
git mv artifacts/api-server/src/validation/inputs/__tests__/chens.test.ts \
       artifacts/api-server/src/validation/inputs/__tests__/maxCoverage.test.ts
```

In `maxCoverage.ts`, change exactly two things:
- `export const chensInputsSchema` → `export const maxCoverageInputsSchema`
- `p: z.number().int().min(1).max(25)` → `.max(26)`
- `export type ChensInputs` → `export type MaxCoverageInputs`

Update the imports in `maxCoverage.test.ts` to match.

- [ ] **Step 5: Swap the solver**

In `artifacts/api-server/src/solver/solve.py`:

At lines 169–175, repoint the dataset globals:

```python
_MC_WH_RAW   = _safe_load("max-coverage-us", "warehouses.json", default={})
_MC_CU_RAW   = _safe_load("max-coverage-us", "customers.json", default={})
_MC_DIST_RAW = _safe_load("max-coverage-us", "distances.json", default={})

WAREHOUSES_MAX_COVERAGE = dict(_MC_WH_RAW)
CUSTOMERS_MAX_COVERAGE  = dict(_MC_CU_RAW)
DISTANCE_MAX_COVERAGE   = {(k.split(',')[0], k.split(',')[1]): v for k, v in _MC_DIST_RAW.items()}
```

Rename `def solve_chens(inp):` → `def solve_max_coverage(inp):` and inside it:

- `"chens-cosmetics-cn" in _LOAD_ERRORS` → `"max-coverage-us" in _LOAD_ERRORS`
- `_load_error_envelope("chens-cosmetics-cn")` → `_load_error_envelope("max-coverage-us")`
- `build_merged_chens_dataset(inp, WAREHOUSES_CHENS, CUSTOMERS_CHENS, DISTANCE_CHENS)` → `build_merged_max_coverage_dataset(inp, WAREHOUSES_MAX_COVERAGE, CUSTOMERS_MAX_COVERAGE, DISTANCE_MAX_COVERAGE)`
- `LpProblem("chens", ...)` → `LpProblem("max_coverage", ...)`

**Remove the circuity multiplication (MIG-6).** Replace line 1401:

```python
    adj = {(w, c): m["distance"].get((w, c), 9999) * 1.17 for w in cand for c in custs}
```

with:

```python
    # MIG-6: stored distances ARE the effective distances. Chapter 3's matrix
    # is pre-baked and is used as-is, so there is no circuity factor to apply
    # here -- stored == solved == displayed == exported. The 9999 sentinel
    # keeps its meaning: an added entity with no distance is unreachable.
    adj = {(w, c): m["distance"].get((w, c), 9999) for w in cand for c in custs}
```

In the dispatcher (`solve.py:1474-1490`), replace `if model_type == 'chens': return solve_chens(inp)` with:

```python
    if model_type == 'max_coverage_us':
        return solve_max_coverage(inp)
```

In `artifacts/api-server/src/solver/merge_inputs.py:908`, rename `build_merged_chens_dataset` → `build_merged_max_coverage_dataset` and update its `"chens-cosmetics-cn"` references to `"max-coverage-us"`.

- [ ] **Step 6: Swap the TypeScript registrations**

- `registry/modelRegistry.ts:9` — import `maxCoverageInputsSchema` from `../validation/inputs/maxCoverage.js`; line 31 key becomes `"max-coverage-us"`.
- `routes/scenarios.ts:92-108` — `VALID_MODEL_IDS`: `"chens-cosmetics-cn"` → `"max-coverage-us"`, and **delete** the three dead entries `"max_coverage"`, `"p_center"`, `"set_cover"` (MIG-22).
- `lib/dataset-schema/src/index.ts:161` and `:275` — `"chens-cosmetics-cn"` → `"max-coverage-us"`.
- `solver/pmedian.ts:137` — `input.modelId === "max-coverage-us"`; line 153 — `modelType: "max_coverage_us"`.

- [ ] **Step 7: Update the contract and regenerate**

In `lib/api-spec/openapi.yaml`, at lines 47, 172, 1427 and 1631: replace `chens-cosmetics-cn` with `max-coverage-us` and delete the `max_coverage`, `p_center`, `set_cover` entries.

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: regenerated files under `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/`. **Do not hand-edit them.**

- [ ] **Step 8: Sweep the remaining references**

```bash
grep -rl "chens-cosmetics-cn\|chensInputsSchema\|solve_chens\|CHENS" \
  --include="*.ts" --include="*.tsx" --include="*.py" artifacts lib scripts \
  | grep -v node_modules | grep -v /generated/
```

Replace every hit. `artifacts/studio/src/lib/chapters.ts:1`'s `StudioModelType` union is the one that cascades — changing it is what makes `pnpm run typecheck` pass again. Chapter 4's display copy is Task 5's job; here, change only identifiers.

- [ ] **Step 9: Regenerate the Python goldens**

Rename the test file and regenerate its expected values from the real on-disk dataset:

```bash
git mv artifacts/api-server/src/solver/tests/test_chens.py \
       artifacts/api-server/src/solver/tests/test_max_coverage.py

cd artifacts/api-server/src/solver && echo '{"modelType":"max_coverage_us","p":3,"highServiceDistKm":700,"maxDistKm":5500,"avgServiceDistCapKm":1000,"objective":"coverage","gap":0.0,"timeLimitSec":120,"warehouseOverrides":[],"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}' | python3 solve.py
```

Expected — these values were verified against real CBC on 2026-09-27 and must reproduce exactly:

| Field | Value |
|---|---|
| `status` | `optimal` |
| `details.coveragePct` | `68.4192` |
| `details.coveredDemand` | `53385024` |
| `details.openWarehouseIds` | `{DAL, LA, PIT}` |
| `metrics.weightedAvgDistance` | `635.13` |

**If the run does not reproduce these, stop and report.** A mismatch means Task 1's conversion or Step 5's circuity removal is wrong, and the goldens must not be adjusted to match a broken solve.

Rewrite `test_max_coverage.py` with `BASE = {"modelType": "max_coverage_us", "p": 3, "highServiceDistKm": 700, "maxDistKm": 5500, ...}` and those expected values, replacing every China golden (`66.0639`, `131645389`, `{wh-40, wh-69, wh-102}`, total demand `199269881` → `78026333`).

- [ ] **Step 10: Run the full gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x) \
  && (cd artifacts/api-server/src/solver && python3 e2e_accuracy.py)
```

Expected: all green, including `registration.test.ts`. `e2e_accuracy.py` must be unchanged and passing — it has no Chapter 4 section, so this is a regression check on the other five models.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
[ch4-mig-2] rename chens-cosmetics-cn to max-coverage-us and swap the dataset

All ten registration points in one commit per MIG-3: manifest, dataset
version, Zod schema + KNOWN_SCHEMAS, VALID_MODEL_IDS, PACKAGE_SPECS,
buildPayload, OpenAPI enum + regenerated Orval output, solve.py dispatcher,
override entity registration, map multi-select allowlist.

Wire contract per MIG-21: public id max-coverage-us, private modelType
max_coverage_us. The two are different strings deliberately -- solve.py
dispatches on the wire value, not the model id, so a half-rename would run
perfectly and give no signal it was half-done.

MIG-6: the x1.17 circuity multiplication is REMOVED from the solver. Chapter
3's matrix is pre-baked and used as-is, so stored == solved == displayed ==
exported. Goldens regenerated from the real on-disk dataset: 68.4192% /
53,385,024 / {DAL, LA, PIT}.

MIG-22: the dead max_coverage, p_center and set_cover placeholders are gone
from VALID_MODEL_IDS and the OpenAPI enums. They had no manifest, schema or
dispatcher branch, so a scenario created with one passed the id check and
then failed with "Unknown model_id".

registration.test.ts is new -- Gate 1's BLOCKER item had never been written.

Deviation (hard rule #8): this commit is large because MIG-3 requires the
rename to be atomic and StudioModelType's union makes any partial rename fail
typecheck. Splitting it would leave the repo red.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The floor-zero equivalence check

The only assertion in this migration that is independent of our own solver's output (MIG-11).

**Files:**
- Modify: `artifacts/api-server/src/solver/tests/test_max_coverage.py`

**Interfaces:**
- Consumes: `solve_max_coverage` and `solve_pmedian` from Task 2.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test**

Append to `test_max_coverage.py`:

```python
MI2KM = 1.609344

def test_floor_zero_equals_pmedian():
    """MIG-11 -- min-distance with coverageFloorDemand=0 IS the p-median
    problem: same objective, same p, coverage constraint slack. The two
    reach it through different code and different dataset handling, so a
    mangled distance conversion breaks the equality.

    The assertion is unit-aware: Chapter 4 is km-canonical and Chapter 3 is
    mile-canonical, so the objectives differ by exactly 1.609344. Measured
    2026-09-27: relative difference 9.8e-15, so 1e-9 is ample.
    """
    mc = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 0})
    pm = run({"modelType": "p_median", "pValue": 3, "distanceBands": [200, 400, 800, 1600],
              "capacityMode": "none", "uniformCapacity": None, "warehouseStatuses": [],
              "gap": 0.0, "timeLimitSec": 120, "singleSource": False,
              "capacityInactive": False, "capacityFactor": 1.0})

    assert mc["status"] == "optimal"
    assert pm["status"] == "optimal"
    assert set(mc["details"]["openWarehouseIds"]) == {"BAL", "DAL", "LA"}
    assert set(mc["details"]["openWarehouseIds"]) == set(pm["openWarehouseIds"])
    assert mc["objective"] / MI2KM == pytest.approx(pm["objective"], rel=1e-9)


def test_step2_is_always_feasible():
    """Step 1's own solution satisfies Step 2's constraints by construction:
    same p, same maxDistKm, no average-distance cap, and a floor equal to the
    coverage Step 1 actually achieved. An infeasible Step 2 is a defect.
    """
    step1 = run(BASE)
    floor = step1["details"]["coveredDemand"]
    step2 = run({**BASE, "objective": "min_distance", "coverageFloorDemand": floor})
    assert step2["status"] == "optimal"
    assert step2["details"]["coveredDemand"] >= floor
    assert step2["metrics"]["weightedAvgDistance"] <= step1["metrics"]["weightedAvgDistance"]
```

- [ ] **Step 2: Run to verify**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -k "floor_zero or feasible" -v
```

Expected: PASS. `test_floor_zero_equals_pmedian` yields `{BAL, DAL, LA}` at 616.17 km weighted average; `test_step2_is_always_feasible` yields 635.13 → 624.33 km.

If the open sets differ between the two solvers, **stop** — that is the doubled-distance failure mode this check exists to catch.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/solver/tests/test_max_coverage.py
git commit -m "$(cat <<'EOF'
[ch4-mig-3] assert Ch4 min-distance at floor 0 reproduces p-median

MIG-11. With the coverage constraint slack the two are the same optimization
problem, but they reach it through different code and different dataset
handling -- so this is the one assertion here that is not our solver marking
its own homework. Unit-aware: the objectives differ by exactly 1.609344
because Chapter 4 is km-canonical and Chapter 3 is mile-canonical.

Also pins MIG-21's feasibility invariant: Step 1's own solution is inside
Step 2's feasible set by construction, so an infeasible Step 2 is a defect
rather than a user-facing outcome.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Move the circuity factor to the added-entity estimator

Task 2 removed `× 1.17` from the solver. The estimator was relying on it (MIG-20).

**Files:**
- Modify: `artifacts/api-server/src/services/autoDistance.ts:90-94`
- Test: `artifacts/api-server/src/__tests__/autoDistance.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the renamed model id.
- Produces: added-entity distances on the same footing as the base matrix.

- [ ] **Step 1: Write the failing test**

Add to `artifacts/api-server/src/__tests__/autoDistance.test.ts`:

```ts
it("estimates added-entity distances road-adjusted, matching the base matrix (MIG-20)", () => {
  // Chicago (41.88, -87.63) to Detroit (42.33, -83.05): great-circle ~382 km.
  // The base matrix sits at ~1.18x great-circle, so an added entity must be
  // adjusted too or it lands ~15% closer to everything than a base pair.
  const km = estimateMaxCoverageKm(
    { lat: 41.88, lng: -87.63 },
    { lat: 42.33, lng: -83.05 },
  );
  expect(km).toBeGreaterThan(430);
  expect(km).toBeLessThan(460);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter api-server test -- autoDistance
```

Expected: FAIL — returns ~382, the unadjusted great-circle value.

- [ ] **Step 3: Apply the factor in the estimator**

In `autoDistance.ts`, replace the Chapter 4 estimator's comment and return:

```ts
// MIG-20 -- road-adjustment now happens HERE, at the point distances are
// produced, because solve_max_coverage no longer multiplies (MIG-6). The
// base matrix sits at ~1.1788x true great-circle; 1.17 leaves added
// distances 0.75% below that, which is the same order of inconsistency that
// existed before and reuses the constant already in this file rather than
// introducing 1.1788 as a second magic number.
//
// The rule: distances enter the dataset already road-adjusted. Nothing
// downstream adjusts them again.
const MAX_COVERAGE_CIRCUITY = 1.17;
```

and multiply the haversine-km result by `MAX_COVERAGE_CIRCUITY` before the 2-dp round and the 0.01 floor.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter api-server test -- autoDistance
```

Expected: PASS — ~447 km.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/autoDistance.ts \
        artifacts/api-server/src/__tests__/autoDistance.test.ts
git commit -m "$(cat <<'EOF'
[ch4-mig-4] road-adjust added-entity distances in the estimator

MIG-20. The estimator produced raw great-circle km precisely because
solve_chens multiplied by 1.17; with that multiplication gone (MIG-6), an
added warehouse would land ~15% closer to everything than a comparable base
pair, making it look artificially attractive to the solver.

The factor moves to where distances are produced rather than consumed, which
is also the clearer place for it: distances enter the dataset already
road-adjusted and nothing downstream adjusts them again.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: UI copy, the `p` cap, and the e2e specs

**Files:**
- Modify: `artifacts/studio/src/lib/chapters.ts:50-60`, `artifacts/studio/src/pages/Workspace.tsx:3297,4014`
- Modify: `artifacts/studio/e2e/chens-cosmetics.spec.ts` → renamed, `chen-bands-units-qa.spec.ts`, `nonjade-servicestats-live-coverage.spec.ts`
- Test: `artifacts/studio/src/__tests__/Workspace.test.tsx`

**Interfaces:**
- Consumes: the renamed model id from Task 2.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing `p`-cap test**

Add to `artifacts/studio/src/__tests__/Workspace.test.tsx`:

```tsx
it("caps p at 26 in BOTH pMax declarations for max-coverage-us (MIG-8)", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../pages/Workspace.tsx"), "utf8",
  );
  const caps = [...src.matchAll(/modelId === "max-coverage-us" \? (\d+)/g)].map(m => m[1]);
  // Optimization Parameters tab AND SolveDialog render pMax independently.
  expect(caps).toEqual(["26", "26"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter studio test -- Workspace.test
```

Expected: FAIL — `expected [ '25', '25' ] to equal [ '26', '26' ]`

- [ ] **Step 3: Raise both caps and update the chapter copy**

`Workspace.tsx:3297` and `:4014` — `? 25 :` → `? 26 :`.

`chapters.ts:50-60` — Chapter 4's entry:

```ts
  {
    path: "/chapter-4",
    modelId: "max-coverage-us",
    chapter: "Chapter 4",
    title: "Al's Athletics — Max Coverage",
    description: "Service-level facility location across the United States: open warehouses to maximize the demand served within a target service distance.",
    workspace: true,
    hiddenFromLanding: false,
    labHeaderTitle: "Al's Athletics · Max Coverage Lab",
    labHeaderSubtitle: "Ch 4 · service coverage · US warehouses → customers",
  },
```

- [ ] **Step 4: Rewrite the e2e specs**

```bash
git mv artifacts/studio/e2e/chens-cosmetics.spec.ts artifacts/studio/e2e/max-coverage.spec.ts
```

In all three specs (`max-coverage.spec.ts`, `chen-bands-units-qa.spec.ts`, `nonjade-servicestats-live-coverage.spec.ts`) replace the model id, and replace the hard-coded defaults `highServiceDistKm: 600` / `maxDistKm: 5000` / `distanceBands: [600,1200,2400,5000]` with `700` / `5500` / `[700,1400,2800,5500]`, and the assertions `66.06` → `68.42` and `131645389` → `53385024`.

`max-coverage.spec.ts`'s step 4 switches objective through the UI toggle. That toggle survives this migration — the two-step workflow spec removes it — so leave that step working against the current UI.

- [ ] **Step 5: Run the gate**

```bash
pnpm run typecheck && pnpm --filter studio test
```

Expected: green, including the new `p`-cap assertion.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
[ch4-mig-5] update Chapter 4 UI copy, raise p to 26, rewrite the e2e specs

MIG-8: the p cap is declared in four places and all four now read 26 --
manifest, Zod schema, and TWO independent pMax renders in Workspace.tsx
(Optimization Parameters and SolveDialog). The new test asserts both UI
sites, because changing three of four leaves a surface where p=26 is
rejected with no server involvement and no error naming the real cause.

MIG-22 spec_gap sweep: three e2e specs referenced the old id AND hard-coded
the old defaults, so they break on both axes. Rewritten before merge per the
standing rule -- the unit gate does not run Playwright and would not catch it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Retire the China assets and rewrite the README

**Files:**
- Delete: `solvers/chens-cosmetics-cn/`, `scripts/src/extract-chens-dataset.ts`, `scripts/src/geocode-chens.ts`, `docs/dataset-audit/chens-geocode-provenance.json`
- Modify: `README.md`, `attached_assets/NOTEBOOKS.md`

**Interfaces:**
- Consumes: nothing. Everything here is already unreferenced after Task 2.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing references the assets**

```bash
grep -rn "chens" --include="*.ts" --include="*.tsx" --include="*.py" \
  artifacts lib scripts solvers | grep -v node_modules | grep -v /generated/
```

Expected: no output. **If anything appears, stop** — Task 2's rename was incomplete and this deletion would break it.

- [ ] **Step 2: Delete**

```bash
git rm -r solvers/chens-cosmetics-cn
git rm scripts/src/extract-chens-dataset.ts scripts/src/geocode-chens.ts
git rm docs/dataset-audit/chens-geocode-provenance.json
```

`attached_assets/` is **not** touched (hard rule #7).

- [ ] **Step 3: Rewrite the README's Chapter 4 content (MIG-19)**

Four edits in `README.md`, none of which a grep for the model id would find:

1. The model table row — replace `| **Chen's Cosmetics** \`chens-cosmetics-cn\` | Ch. 4 | Service-level siting in China — … | 25 WH · 197 customers · 4,925 distances (km) | \`solve_chens\` |` with `| **Al's Athletics — Max Coverage** \`max-coverage-us\` | Ch. 4 | Service-level siting in the US — maximize covered demand *or* minimize demand-distance | 26 WH · 200 customers · 5,200 distances (km) | \`solve_max_coverage\` |`
2. The goldens sentence — `Chen's coverage 66.0639% / covered demand 131645389` → `Ch. 4 coverage 68.4192% / covered demand 53385024`.
3. The units passage — rewrite `Chen's model is genuinely metric, which forced distance units to become a first-class, model-derived property` to say Chapter 4 is km-canonical by contract over US data, which is what forced units to be model-derived rather than hardcoded.
4. **Delete the GeoNames attribution** in the closing credits — `Postal codes for Chen's dataset: GeoNames (CC BY 4.0)`. The dataset it credits no longer ships; leaving it is a licensing defect, not a cosmetic one.

Add a line to `attached_assets/NOTEBOOKS.md` noting the three ChensCosmetics notebooks remain as textbook source material but no longer correspond to a shipped dataset.

- [ ] **Step 4: Run the full gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
[ch4-mig-6] remove the China dataset and tooling; rewrite the README

Everything deleted here is unreferenced after the rename; git retains the
history. attached_assets/ is untouched per hard rule #7 -- the notebooks stay
as textbook source material.

MIG-19: the README needed a content rewrite, not a rename sweep. Most of its
Chapter 4 content names no identifier, so a grep for the model id finds only
part of it. The GeoNames CC BY 4.0 attribution is removed because section 7
deletes the dataset it credits -- an attribution for data the project no
longer ships is a licensing defect rather than a cosmetic one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The production deletion runbook and script

Destructive, touches student data, and **is not executed by this plan.** Task 7 writes and tests it; running it is a separate, human-gated operation.

**Files:**
- Create: `docs/ops/ch4-migration-runbook.md`, `scripts/src/migrate-delete-chens-scenarios.ts`
- Test: `artifacts/api-server/src/__tests__/chensDeletion.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: an operator-run script; no runtime code depends on it.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/__tests__/chensDeletion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countAffected, deleteChapter4Data } from "../../../../scripts/src/migrate-delete-chens-scenarios.js";

describe("Chapter 4 deletion scoping", () => {
  it("scopes jobs through the parent scenario, not solve_jobs.model_id (T2)", () => {
    const sql = countAffected.toString();
    expect(sql).toContain("join");
    expect(sql).toContain("scenarios");
    // solve_jobs.model_id is A1 Class-1 nullable -- NULL on every pre-A1 row.
    expect(sql).not.toMatch(/solve_jobs\.model_id\s*=/);
  });

  it("deletes solve_jobs before scenarios, and result_cache, in one transaction", () => {
    const src = deleteChapter4Data.toString();
    const jobsAt = src.indexOf("solveJobsTable");
    const scenariosAt = src.indexOf("scenariosTable");
    expect(jobsAt).toBeGreaterThan(-1);
    expect(jobsAt).toBeLessThan(scenariosAt);
    expect(src).toContain("resultCacheTable");
    expect(src).toContain("transaction");
  });

  it("never issues an ad-hoc job status update", () => {
    const src = deleteChapter4Data.toString() + countAffected.toString();
    expect(src).not.toMatch(/status:\s*["'](succeeded|failed|cancelled)["']/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter api-server test -- chensDeletion
```

Expected: FAIL — `Cannot find module '.../migrate-delete-chens-scenarios.js'`

- [ ] **Step 3: Write the script**

Create `scripts/src/migrate-delete-chens-scenarios.ts` exporting `countAffected(db)` and `deleteChapter4Data(db)`. `countAffected` returns per-objective scenario and job counts using the parent-scenario join; `deleteChapter4Data` runs one `db.transaction` deleting `solve_jobs` (joined through `scenarios`), then `scenarios`, then `result_cache WHERE model_id = 'chens-cosmetics-cn'`. Neither function writes a job status. `deleteChapter4Data` refuses to run unless passed an explicit `{ confirmedCount: number }` that matches a fresh `countAffected` result.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter api-server test -- chensDeletion
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the runbook**

Create `docs/ops/ch4-migration-runbook.md` with the four stages from MIG-16, each with its rollback point:

- **Stage A** — set `capabilities.locked` on the old manifest, deploy `nos-api`, prove a create and a scenario-scoped write both return 403. Rollback: revert the flag, redeploy.
- **Stage B** — keep workers **running** so queued jobs drain through; poll until every affected job is terminal, with an explicit timeout. **SIGTERM is not a queue drain** — `drainForShutdown` stops the dispatcher and waits for *active* jobs only, leaving queued rows untouched. If the timeout expires, stop and report; no forced status write.
- **Stage C** — run `countAffected`, obtain explicit human confirmation against that number, then `deleteChapter4Data`. Point of no return.
- **Stage D** — deploy the rename. Post-deploy: `GET /api/models` lists `max-coverage-us` and not the old id; the Chapter 4 card renders; a fresh scenario solves to 68.4192%.

Note that Stage A needs the old manifest to still exist, so Task 6's deletion is part of the Stage D deployment, not the Stage A one.

- [ ] **Step 6: Commit**

```bash
git add docs/ops/ch4-migration-runbook.md scripts/src/migrate-delete-chens-scenarios.ts \
        artifacts/api-server/src/__tests__/chensDeletion.test.ts
git commit -m "$(cat <<'EOF'
[ch4-mig-7] add the gated Chapter 4 deletion runbook and script

MIG-16. Written and tested here; NOT executed -- running it is a separate
human-gated operation against production student data.

Two findings from review are encoded as tests rather than prose, because both
would otherwise produce a green check over an incomplete population:

- Jobs are scoped through the parent scenario, never solve_jobs.model_id,
  which is A1 Class-1 nullable and therefore NULL on every pre-A1 row --
  exactly the oldest jobs.
- SIGTERM is not a queue drain. drainForShutdown stops the dispatcher and
  waits for ACTIVE jobs, leaving queued rows for the next process, so the
  runbook keeps workers running and polls to terminal instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage.** MIG-1 → T2/T4. MIG-2, MIG-3, MIG-21, MIG-22 → T2. MIG-4 → T2 (`registration.test.ts` asserts the dispatcher). MIG-5, MIG-6 → T1/T2. MIG-7 → T2 (manifest `distanceUnit: "km"` unchanged). MIG-8 → T2 (manifest, Zod) + T5 (both UI sites). MIG-9 → T2 Step 9, T5 Step 4. MIG-10, MIG-11 → T2 Step 9, T3. MIG-12 → recorded in the spec; no code. MIG-13, MIG-16 → T7. MIG-14 → recorded in the two-step spec. MIG-15 → this plan runs first. MIG-17 → T2 Step 8's sweep + T6 Step 1's proof. MIG-18 → already applied to the two-step spec (`b981a6e`). MIG-19 → T6. MIG-20 → T4.

**No gaps.** Two spec statements are deliberately not tasks: MIG-12 (the trade-off is quieter on Al's data) is a recorded finding, and MIG-14 supersedes decisions in the sibling spec.

**One spec correction surfaced while planning.** MIG-3 says `registration.test.ts` "must pass for the new id", which assumes it exists. It does not — Task 2 Step 1 writes it. Worth folding back into the spec at re-review.

**Type consistency.** `maxCoverageInputsSchema` (T2) is the name used in T2's registry import. `solve_max_coverage` (T2) is what T3's tests invoke. `build_merged_max_coverage_dataset` (T2) matches `solve.py`'s call site. `WAREHOUSES_MAX_COVERAGE` / `CUSTOMERS_MAX_COVERAGE` / `DISTANCE_MAX_COVERAGE` are defined and consumed in T2 alone. `countAffected` / `deleteChapter4Data` (T7) match the test's imports. Wire value `max_coverage_us` is identical in `pmedian.ts`, `solve.py`, `registration.test.ts` and every test payload.
