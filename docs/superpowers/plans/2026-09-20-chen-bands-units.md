# Chen Bands, Service-Distance Params & App-Wide Unit Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-19-chen-bands-units-design.md` (nine review rounds, approved). The spec is normative — when this plan and the spec disagree, the spec wins and the deviation gets noted in the commit body.

**Goal:** Make Chen's distance bands an editable live reporting lens, give the app an end-to-end km/mi display-unit toggle with server-owned export conversion, and make solve history durably addressable so a historical export matches what's on screen.

**Architecture:** A new pure `@workspace/units` package becomes the single cross-runtime authority for unit conversion, the six-model objective-dimension mapping, cumulative+overflow coverage, and per-edge band assignment — consumed identically by `artifacts/studio` (wrapped for presentation) and `artifacts/api-server` (called directly by export builders). Two additive nullable DB columns make each solve run durably addressable. A field-scoped `jsonb_set` PATCH lets the band lens persist without ever touching other inputs.

**Tech Stack:** pnpm monorepo, TypeScript, Express 5 + Drizzle (Postgres), React 19 + Vite + TanStack Query + Radix + Leaflet, Zod, vitest + RTL, Playwright, OpenAPI + Orval codegen.

**How to use this plan with the spec.** Novel or subtle logic is written out in full here (the units package, the `markSucceeded` transaction, the Part G endpoint, the draft grammar, the payload builder). For the **exact wire shapes** — the v3 CSV headers, JSON envelopes and camelCase JSON rows, the version matrix, the six-model objective table, the history action matrix — this plan points at the spec's tables rather than re-typing them, because a re-typed copy is a second source of truth that can drift. Open the named spec section and copy from it verbatim.

## Global Constraints

Every task's requirements implicitly include these.

- **Hard rule #1 — never edit generated code.** `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**` come from codegen. Change `lib/api-spec/openapi.yaml`, re-run Orval, commit spec + regenerated output **in the same commit**.
- **Hard rule #2 — `e2e_accuracy.py` is sacred.** `artifacts/api-server/src/solver/tests/e2e_accuracy.py` must pass unmodified (99/99). **No task in this plan touches `solve.py`, any `solvers/*/dataset/*`, or any Python file.** The only `solvers/` edit anywhere is one manifest JSON in Task 3.
- **Hard rule #3 — NOT NULL protocol.** Not triggered: both new columns are nullable, so plain `drizzle-kit push` is correct.
- **Hard rule #4 — one task = one commit**, message `[<task-id>] <imperative summary>`. Codegen output ships in the same commit as its spec change.
- **Hard rule #5 — ownership is security-critical.** Every scenario-scoped query filters by authenticated `user_id`; non-owned or missing → **404, never 403**.
- **Hard rule #6 — solver changes enter as data, not branches.** Not triggered — no solver change here.
- **Hard rule #8 — trust the repo.** If the plan's quoted code no longer matches the file, make the smallest correct fix and note the deviation in the commit body.
- **Branch discipline.** All work lands on the existing `chen-bands-units` branch (worktree `/private/tmp/chen-bands-units`). Never commit to `main`. In a shared worktree **always commit with an explicit pathspec**: `git commit -m "..." -- <paths>`, never bare.
- **Base guard (standing agent-team rule).** Before starting, every agent runs `git merge-base --is-ancestor <branch-tip> HEAD && echo BASE_OK`. If it fails, stop and report — do not rebase silently.
- **Conversion constant:** `1 mi = 1.609344 km`, exactly, defined once in `@workspace/units`.
- **`OVERFLOW_BAND = -1` is a categorical sentinel** — never a distance, never unit-converted, in any schema or runtime.
- **Classify before rounding.** Band assignment and coverage bucketing run on **canonical** distances/boundaries, before the 4-decimal output serialization.
- **DB for local runs:** prefix DB-touching commands with `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`.
- **Verification gate (run before calling any task done):**
  ```bash
  pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
    && pnpm --filter @workspace/units test \
    && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
  ```
  Solver pytest is a no-regression confirmation only (no Python is touched). Run `python3 e2e_accuracy.py` once at Task 15.

## File Structure

New files, and what each owns:

| File | Responsibility |
|---|---|
| `lib/units/package.json`, `tsconfig.json`, `vitest.config.ts` | New pure workspace package `@workspace/units`. Zero React, zero DB, zero I/O. |
| `lib/units/src/convert.ts` | The conversion constant, `effectiveUnit`, `toDisplay`, `fromDisplay`, `roundForFile`. |
| `lib/units/src/objective.ts` | `(modelId, objectiveMode) → ObjectiveDimension` mapping + `convertObjective`. The ONLY place `modelId` drives unit semantics. |
| `lib/units/src/bands.ts` | `OVERFLOW_BAND`, `assignBandOrOverflow`, `bandLabelOrOverflow`, `computeCumulativeBandCoverage`, `serviceEdgesFor`. Ported verbatim-in-behavior from `artifacts/studio/src/lib/bands.ts`. |
| `lib/units/src/index.ts` | Public surface re-export. |
| `artifacts/studio/src/contexts/UnitContext.tsx` | `UnitProvider` + `useDisplayUnit()`; localStorage persistence; wraps `@workspace/units`. |
| `artifacts/studio/src/components/UnitToggle.tsx` | The `auto/km/mi` header control. |
| `artifacts/studio/src/hooks/useDistanceDraft.ts` | The draft contract (grammar, toggle behavior, commit) as one reusable hook. |
| `artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx` | Save / Discard / Cancel dialog for decision 1i. |
| `artifacts/api-server/src/routes/distanceBands.ts` | Part G field-scoped PATCH (kept out of the already-huge `scenarios.ts`). |

Modified files with a **single writer** (never assign two concurrent tasks to the same one):

| File | Sole writer |
|---|---|
| `lib/api-spec/openapi.yaml` (+ regenerated clients) | Task 5 |
| `artifacts/api-server/src/services/templates.ts` | Task 7 |
| `artifacts/api-server/src/services/import.ts` | Task 8 |
| `artifacts/api-server/src/routes/scenarios.ts` | Task 9 |
| `artifacts/studio/src/pages/Workspace.tsx` | Task 14 |

## Wave / dependency map

```
Wave 0 (parallel, file-disjoint):  T1 units pkg · T2 db schema · T3 chen validator+manifest · T4 199M hint
Wave 1 (after W0):                 T5 openapi+codegen · T6 jobRunner txn        [T6 needs T2]
Wave 2 (sequential, hot files):    T7 templates.ts  →  T8 import.ts             [need T1, T5]
Wave 3:                            T9 routes/scenarios.ts + distanceBands.ts    [needs T5,T6,T7]
Wave 4 (frontend):                 T10 UnitContext → T11 read paths → T12 write paths
                                   T13 Chen band editor + live coverage         [parallel with T11/T12]
                                   T14 Workspace.tsx INT (sole writer, last)
Wave 5:                            T15 QA (real-browser Playwright)
```

---

### Task 1: `@workspace/units` — the pure cross-runtime contract

**Files:**
- Create: `lib/units/package.json`, `lib/units/tsconfig.json`, `lib/units/vitest.config.ts`
- Create: `lib/units/src/convert.ts`, `lib/units/src/objective.ts`, `lib/units/src/bands.ts`, `lib/units/src/index.ts`
- Test: `lib/units/src/__tests__/convert.test.ts`, `objective.test.ts`, `bands.test.ts`

**Interfaces:**
- Consumes: nothing (leaf package, zero dependencies beyond devDeps).
- Produces — every later task imports from here:
  ```ts
  export type CanonicalUnit = "km" | "mi";
  export type DisplayUnitPref = "auto" | CanonicalUnit;
  export const KM_PER_MI = 1.609344;
  export function effectiveUnit(pref: DisplayUnitPref, canonical: CanonicalUnit): CanonicalUnit;
  export function toDisplay(canonicalValue: number, canonical: CanonicalUnit, target: CanonicalUnit): number;
  export function fromDisplay(displayValue: number, display: CanonicalUnit, canonical: CanonicalUnit): number;
  export function roundForFile(value: number): number;                 // 4 dp

  export type ObjectiveDimension =
    | "demand-distance" | "flow-distance" | "truckload-distance"
    | "distance" | "monetary" | "percent" | "opaque";
  export function objectiveDimension(modelId: string, objectiveMode: string | null): ObjectiveDimension;
  export function objectiveConverts(dim: ObjectiveDimension): boolean;
  export function convertObjective(value: number, dim: ObjectiveDimension, canonical: CanonicalUnit, target: CanonicalUnit): number;

  export const OVERFLOW_BAND = -1;
  export interface BandEdge { distance: number; flow: number; leg?: string | null }
  export interface BandCoverageEntry { band: number; percent: number }
  export function assignBandOrOverflow(distance: number, bands: number[]): number;
  export function bandLabelOrOverflow(distance: number, bands: number[]): string;  // "Band N" | "Overflow"
  export function serviceEdgesFor(edges: BandEdge[]): BandEdge[];                   // outbound-leg filter
  export function computeCumulativeBandCoverage(edges: BandEdge[], bands: number[]): BandCoverageEntry[];
  ```

- [ ] **Step 1: Scaffold the package**

Create `lib/units/package.json` (mirrors `lib/dataset-schema/package.json`, minus zod — this package has no runtime deps):

```json
{
  "name": "@workspace/units",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "vitest": "^3.2.4"
  }
}
```

Create `lib/units/tsconfig.json` — byte-identical to `lib/dataset-schema/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

Create `lib/units/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

`pnpm-workspace.yaml` already globs `lib/*` — **no workspace config change needed**.

- [ ] **Step 2: Write the failing conversion test**

`lib/units/src/__tests__/convert.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KM_PER_MI, effectiveUnit, toDisplay, fromDisplay, roundForFile } from "../convert.js";

describe("convert", () => {
  it("uses the exact factor", () => expect(KM_PER_MI).toBe(1.609344));

  it("effectiveUnit: auto falls through to canonical", () => {
    expect(effectiveUnit("auto", "km")).toBe("km");
    expect(effectiveUnit("auto", "mi")).toBe("mi");
    expect(effectiveUnit("mi", "km")).toBe("mi");
  });

  it("same unit is a no-op (never re-quantized)", () => {
    expect(toDisplay(804.672, "km", "km")).toBe(804.672);
    expect(fromDisplay(500, "mi", "mi")).toBe(500);
  });

  it("km canonical shown as mi", () => {
    expect(toDisplay(804.672, "km", "mi")).toBeCloseTo(500, 9);
  });

  it("typing 500 mi against a km-canonical model stores 804.672", () => {
    expect(fromDisplay(500, "mi", "km")).toBeCloseTo(804.672, 9);
  });

  it("round-trips without drift", () => {
    const canonical = 1234.5678;
    expect(fromDisplay(toDisplay(canonical, "km", "mi"), "mi", "km")).toBeCloseTo(canonical, 9);
  });

  it("roundForFile is 4 dp", () => expect(roundForFile(124.27423844746679)).toBe(124.2742));
});
```

- [ ] **Step 3: Run it — expect failure**

```bash
pnpm --filter @workspace/units test
```
Expected: FAIL — `Cannot find module '../convert.js'`.

- [ ] **Step 4: Implement `convert.ts`**

```ts
export type CanonicalUnit = "km" | "mi";
export type DisplayUnitPref = "auto" | CanonicalUnit;

/** Exact, by definition. The single source of this constant in the whole repo. */
export const KM_PER_MI = 1.609344;

export function effectiveUnit(pref: DisplayUnitPref, canonical: CanonicalUnit): CanonicalUnit {
  return pref === "auto" ? canonical : pref;
}

/** canonical value -> the unit we want to SHOW it in. Identity when they match. */
export function toDisplay(canonicalValue: number, canonical: CanonicalUnit, target: CanonicalUnit): number {
  if (canonical === target) return canonicalValue;
  return canonical === "km" ? canonicalValue / KM_PER_MI : canonicalValue * KM_PER_MI;
}

/** a number the user TYPED (in `display`) -> the model's canonical unit. Identity when they match. */
export function fromDisplay(displayValue: number, display: CanonicalUnit, canonical: CanonicalUnit): number {
  if (display === canonical) return displayValue;
  return display === "km" ? displayValue / KM_PER_MI : displayValue * KM_PER_MI;
}

/** Spec Part E: exported distances serialize at 4 decimal places. */
export function roundForFile(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm --filter @workspace/units test
```
Expected: PASS (7 tests).

- [ ] **Step 6: Write the failing objective test**

`lib/units/src/__tests__/objective.test.ts` — one case per row of the spec's six-model table:

```ts
import { describe, it, expect } from "vitest";
import { objectiveDimension, objectiveConverts, convertObjective } from "../objective.js";

describe("objectiveDimension — the six-model contract", () => {
  const cases: Array<[string, string | null, string, boolean]> = [
    ["p-median-us",          null,           "demand-distance",   true],
    ["p-median-brazil",      null,           "demand-distance",   true],
    ["transport-coal",       null,           "flow-distance",     true],
    ["two-echelon-gold-au",  null,           "truckload-distance",true],
    ["two-echelon-jade-us",  null,           "monetary",          false],
    ["chens-cosmetics-cn",   "coverage",     "percent",           false],
    ["chens-cosmetics-cn",   "min_distance", "demand-distance",   true],
  ];
  it.each(cases)("%s / %s -> %s (converts: %s)", (modelId, mode, dim, converts) => {
    expect(objectiveDimension(modelId, mode)).toBe(dim);
    expect(objectiveConverts(objectiveDimension(modelId, mode))).toBe(converts);
  });

  it("an unknown model is opaque and never converts", () => {
    expect(objectiveDimension("not-a-model", null)).toBe("opaque");
    expect(objectiveConverts("opaque")).toBe(false);
  });

  it("converting dimensions scale linearly with distance", () => {
    expect(convertObjective(1000, "demand-distance", "km", "mi")).toBeCloseTo(1000 / 1.609344, 9);
  });

  it("non-converting dimensions pass through untouched", () => {
    expect(convertObjective(66.0639, "percent", "km", "mi")).toBe(66.0639);
    expect(convertObjective(12345, "monetary", "mi", "km")).toBe(12345);
  });
});
```

- [ ] **Step 7: Implement `objective.ts`**

```ts
import { type CanonicalUnit, toDisplay } from "./convert.js";

export type ObjectiveDimension =
  | "demand-distance"
  | "flow-distance"
  | "truckload-distance"
  | "distance"
  | "monetary"
  | "percent"
  | "opaque";

/**
 * The ONLY place in the repo where `modelId` determines unit semantics.
 * Verified against solve.py: p-median demand*distance (270-271, 614-619);
 * transport lane value*flow where lane values are geographic miles (439,
 * transportLp.ts:18-25); gold distance*flow/truckload-kg (792-793); jade
 * $/ton-mile + minimum charges (991-1010) — genuinely monetary; Chen
 * coverage % vs min_distance demand*distance.
 */
export function objectiveDimension(modelId: string, objectiveMode: string | null): ObjectiveDimension {
  switch (modelId) {
    case "p-median-us":
    case "p-median-brazil":
      return "demand-distance";
    case "transport-coal":
      return "flow-distance";
    case "two-echelon-gold-au":
      return "truckload-distance";
    case "two-echelon-jade-us":
      return "monetary";
    case "chens-cosmetics-cn":
      return objectiveMode === "coverage" ? "percent" : "demand-distance";
    default:
      return "opaque";
  }
}

const CONVERTING: ReadonlySet<ObjectiveDimension> = new Set([
  "demand-distance", "flow-distance", "truckload-distance", "distance",
]);

export function objectiveConverts(dim: ObjectiveDimension): boolean {
  return CONVERTING.has(dim);
}

/** Every converting dimension is linear in distance, so one scale factor serves all. */
export function convertObjective(
  value: number, dim: ObjectiveDimension, canonical: CanonicalUnit, target: CanonicalUnit,
): number {
  return objectiveConverts(dim) ? toDisplay(value, canonical, target) : value;
}
```

- [ ] **Step 8: Write the failing bands test**

`lib/units/src/__tests__/bands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  OVERFLOW_BAND, assignBandOrOverflow, bandLabelOrOverflow,
  computeCumulativeBandCoverage, serviceEdgesFor,
} from "../bands.js";

const BANDS = [200, 400, 800];

describe("assignBandOrOverflow", () => {
  it("a distance exactly on a boundary lands in THAT band, not the next", () => {
    expect(assignBandOrOverflow(200, BANDS)).toBe(0);
    expect(assignBandOrOverflow(400, BANDS)).toBe(1);
  });
  it("beyond the last boundary is the overflow sentinel, never the last band", () => {
    expect(assignBandOrOverflow(800.0001, BANDS)).toBe(OVERFLOW_BAND);
  });
  it("labels render the sentinel categorically", () => {
    expect(bandLabelOrOverflow(150, BANDS)).toBe("Band 1");
    expect(bandLabelOrOverflow(9999, BANDS)).toBe("Overflow");
  });
});

describe("computeCumulativeBandCoverage", () => {
  it("rows are keyed by the BOUNDARY value, cumulative, and omit a zero overflow", () => {
    const edges = [{ distance: 100, flow: 50 }, { distance: 300, flow: 50 }];
    expect(computeCumulativeBandCoverage(edges, BANDS)).toEqual([
      { band: 200, percent: 50 }, { band: 400, percent: 100 }, { band: 800, percent: 100 },
    ]);
  });
  it("appends the overflow row only when there IS overflow", () => {
    const edges = [{ distance: 100, flow: 50 }, { distance: 9999, flow: 50 }];
    const rows = computeCumulativeBandCoverage(edges, BANDS);
    expect(rows.at(-1)).toEqual({ band: OVERFLOW_BAND, percent: 50 });
  });
  it("zero total flow yields 0% rows, never NaN", () => {
    expect(computeCumulativeBandCoverage([{ distance: 100, flow: 0 }], BANDS))
      .toEqual([{ band: 200, percent: 0 }, { band: 400, percent: 0 }, { band: 800, percent: 0 }]);
  });
});

describe("serviceEdgesFor", () => {
  it("two-echelon data keeps only the outbound/customer-serving leg", () => {
    const edges = [
      { distance: 10, flow: 1, leg: "plant_to_warehouse" },
      { distance: 20, flow: 2, leg: "warehouse_to_customer" },
      { distance: 30, flow: 3, leg: "refinery_to_customer" },
    ];
    expect(serviceEdgesFor(edges).map(e => e.distance)).toEqual([20, 30]);
  });
  it("single-echelon data (no leg tags) passes through untouched", () => {
    const edges = [{ distance: 10, flow: 1 }, { distance: 20, flow: 2 }];
    expect(serviceEdgesFor(edges)).toHaveLength(2);
  });
});
```

- [ ] **Step 9: Implement `bands.ts`**

Behavior is ported from `artifacts/studio/src/lib/bands.ts` — do **not** invent new semantics.

```ts
export const OVERFLOW_BAND = -1;

export interface BandEdge { distance: number; flow: number; leg?: string | null }
export interface BandCoverageEntry { band: number; percent: number }

const OUTBOUND_LEGS = new Set(["warehouse_to_customer", "refinery_to_customer"]);

/**
 * Two-echelon models tag every edge with a `leg`; only the outbound/
 * customer-serving leg is a service distance (an inbound plant/mine leg would
 * double-count throughput). Single-echelon models tag nothing, so every edge
 * already IS the service leg.
 */
export function serviceEdgesFor<T extends BandEdge>(edges: T[]): T[] {
  const hasLegs = edges.some(e => e.leg != null);
  return hasLegs ? edges.filter(e => e.leg != null && OUTBOUND_LEGS.has(e.leg)) : edges;
}

/** First boundary the distance fits under, else the explicit overflow sentinel. */
export function assignBandOrOverflow(distance: number, bands: number[]): number {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = sorted.findIndex(b => distance <= b);
  return idx === -1 ? OVERFLOW_BAND : idx;
}

export function bandLabelOrOverflow(distance: number, bands: number[]): string {
  const i = assignBandOrOverflow(distance, bands);
  return i === OVERFLOW_BAND ? "Overflow" : `Band ${i + 1}`;
}

/**
 * CUMULATIVE rollup keyed by the BOUNDARY VALUE (not an index) — each row is
 * the share of flow at or under that boundary — plus a separately labelled
 * overflow row, omitted entirely when there is none.
 */
export function computeCumulativeBandCoverage(edges: BandEdge[], bands: number[]): BandCoverageEntry[] {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const totalFlow = edges.reduce((s, e) => s + e.flow, 0);
  const rows = sorted.map(band => {
    if (totalFlow === 0) return { band, percent: 0 };
    const within = edges.filter(e => e.distance <= band).reduce((s, e) => s + e.flow, 0);
    return { band, percent: Math.round((within * 100) / totalFlow) };
  });
  const maxBoundary = sorted[sorted.length - 1];
  const overflowFlow = edges.filter(e => e.distance > maxBoundary).reduce((s, e) => s + e.flow, 0);
  if (overflowFlow > 0) {
    rows.push({ band: OVERFLOW_BAND, percent: totalFlow === 0 ? 0 : Math.round((overflowFlow * 100) / totalFlow) });
  }
  return rows;
}
```

- [ ] **Step 10: `index.ts` + full run**

```ts
export * from "./convert.js";
export * from "./objective.js";
export * from "./bands.js";
```

```bash
pnpm install && pnpm --filter @workspace/units test && pnpm run typecheck
```
Expected: all `@workspace/units` tests pass; workspace typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add lib/units && git commit -m "[T1] add @workspace/units — pure cross-runtime unit, objective and band contract" -- lib/units
```

---

### Task 2: DB schema — durable run results + run pointer

**Files:**
- Modify: `lib/db/src/schema/solve_jobs.ts`, `lib/db/src/schema/scenarios.ts`
- Test: `artifacts/api-server/src/__tests__/schemaColumns.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `solveJobsTable.result` (nullable jsonb), `scenariosTable.resultRunId` (nullable int, FK → `solve_jobs.id`, `ON DELETE SET NULL`).

- [ ] **Step 1: Add `solve_jobs.result`**

In `lib/db/src/schema/solve_jobs.ts`, beside the existing `resultSummary`:

```ts
  // Part F — the run's FULL result envelope, so a historical export can be
  // addressed by run id. Deliberately NOT a join to result_cache: that table's
  // contract is a cache, and adding eviction later would silently break
  // historical export. Nullable: pre-migration rows have none.
  result: jsonb("result").$type<Record<string, unknown> | null>(),
```

- [ ] **Step 2: Add `scenarios.result_run_id`**

In `lib/db/src/schema/scenarios.ts` (import `solveJobsTable`; if that creates an import cycle, declare the FK with Drizzle's callback form instead of a direct reference):

```ts
  // Decision 1g — which solve_jobs row produced this row's current `result`.
  // Written in the SAME transaction as `result` (jobRunner), so the two can
  // never disagree. ON DELETE SET NULL, because scenario deletion removes the
  // child solve_jobs FIRST (routes/scenarios.ts) — a restrictive FK would
  // deadlock that order — and a null pointer is exactly the already-specified
  // "legacy, non-exportable" state.
  resultRunId: integer("result_run_id").references(() => solveJobsTable.id, { onDelete: "set null" }),
```

- [ ] **Step 3: Write the schema-shape test**

`artifacts/api-server/src/__tests__/schemaColumns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { solveJobsTable } from "@workspace/db/schema/solve_jobs";
import { scenariosTable } from "@workspace/db/schema/scenarios";

describe("Part F schema additions", () => {
  it("solve_jobs.result exists and is nullable", () => {
    expect(solveJobsTable.result).toBeDefined();
    expect(solveJobsTable.result.notNull).toBe(false);
  });
  it("scenarios.result_run_id exists and is nullable", () => {
    expect(scenariosTable.resultRunId).toBeDefined();
    expect(scenariosTable.resultRunId.notNull).toBe(false);
  });
});
```

(Import paths must match this repo's existing `@workspace/db` export style — copy whatever a current api-server test already uses.)

- [ ] **Step 4: Push the schema and verify the FK action**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" psql -c "\d scenarios" | grep result_run_id
```
Expected: the column exists and the FK prints `ON DELETE SET NULL`.

- [ ] **Step 5: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter api-server test
git commit -m "[T2] add solve_jobs.result + scenarios.result_run_id (nullable, ON DELETE SET NULL)" -- lib/db artifacts/api-server/src/__tests__/schemaColumns.test.ts
```

---

### Task 3: Chen input contract — free bands, no overwrite

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/chens.ts`
- Modify: `solvers/chens-cosmetics-cn/manifest.json`
- Test: `artifacts/api-server/src/validation/inputs/__tests__/chens.test.ts`

**Interfaces:**
- Produces: `chensInputsSchema` that **preserves** a supplied `distanceBands`, and a manifest declaring `minItems: 1` with no `maxItems`.

- [ ] **Step 1: Write the failing validator tests**

Append to `chens.test.ts`:

```ts
const base = { /* copy the existing valid Chen inputs fixture from this file */ };

it("preserves a supplied band array verbatim (no [high,max] overwrite)", () => {
  const r = chensInputsSchema.parse({ ...base, distanceBands: [600, 1200, 2400, 5000] });
  expect(r.distanceBands).toEqual([600, 1200, 2400, 5000]);
});

it("derives [high,max] ONLY when distanceBands is omitted (legacy payload)", () => {
  const { distanceBands: _omit, ...withoutBands } = { ...base, distanceBands: [1] };
  const r = chensInputsSchema.parse(withoutBands);
  expect(r.distanceBands).toEqual([withoutBands.highServiceDistKm, withoutBands.maxDistKm]);
});

it("accepts a single band (minItems 1)", () => {
  expect(chensInputsSchema.parse({ ...base, distanceBands: [600] }).distanceBands).toEqual([600]);
});

it.each([
  ["empty",         []],
  ["non-ascending", [800, 400]],
  ["duplicate",     [400, 400]],
  ["zero",          [0, 400]],
  ["negative",      [-1, 400]],
])("rejects %s band arrays at the API boundary", (_label, bands) => {
  expect(() => chensInputsSchema.parse({ ...base, distanceBands: bands })).toThrow();
});

it("rejects maxDistKm <= highServiceDistKm", () => {
  expect(() => chensInputsSchema.parse({ ...base, highServiceDistKm: 600, maxDistKm: 600 })).toThrow();
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter api-server test -- chens.test.ts
```
Expected: the preserve/minItems/ordering cases FAIL (the schema currently overwrites).

- [ ] **Step 3: Implement**

In `chens.ts` replace the band field and the overwrite:

```ts
const distanceBandsSchema = z.array(z.number().positive())
  .min(1, "distanceBands must contain at least one boundary")
  .refine(b => b.every((v, i) => i === 0 || v > b[i - 1]),
          { message: "distanceBands must be strictly ascending and unique" });
```

Make it **optional** on the object, then in the existing `.transform(...)`/`superRefine` block that currently always assigns `[high, max]`:

```ts
  // D19 SUPERSEDED (spec Part A): bands are a free, user-editable reporting
  // lens. Derive [high,max] ONLY for a legacy payload that omits the field;
  // a supplied valid array is preserved verbatim.
  distanceBands: input.distanceBands ?? [input.highServiceDistKm, input.maxDistKm],
```

Add the solver-parameter invariant (independent of bands):

```ts
  .refine(v => v.maxDistKm > v.highServiceDistKm,
          { path: ["maxDistKm"], message: "maxDistKm must be greater than highServiceDistKm" })
```

- [ ] **Step 4: Update the manifest**

`solvers/chens-cosmetics-cn/manifest.json` line ~29:

```json
      "distanceBands": { "type": "array", "items": { "type": "number", "exclusiveMinimum": 0 }, "minItems": 1 },
```

(`maxItems` removed; still listed in `required`.)

- [ ] **Step 5: Run — expect pass**

```bash
pnpm --filter api-server test && pnpm --filter @workspace/dataset-schema test
```
Expected: PASS. If a manifest-hash fixture asserts the old file, update that expected hash in the same commit and say so in the body.

- [ ] **Step 6: Commit**

```bash
git commit -m "[T3] Chen bands are free and preserved — stop the [high,max] overwrite, minItems 1, reject maxDist<=high" -- artifacts/api-server/src/validation/inputs solvers/chens-cosmetics-cn/manifest.json
```

---

### Task 4: Remove the hardcoded 199M hint (both surfaces)

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` (delete lines ~275-277)
- Modify: `artifacts/studio/src/components/workspace/SolveDialog.tsx` (delete lines ~227-229)
- Test: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`, `SolveDialog.test.tsx`, and a new `artifacts/studio/src/__tests__/noHardcodedDemandHint.test.ts`

- [ ] **Step 1: Write the grep-guard test**

`noHardcodedDemandHint.test.ts` — assert the **phrase and test-ids**, never a bare `199` (`lib/gazetteer-us.json` legitimately contains many):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("199M coverage-floor hint is gone", () => {
  const files = walk(join(process.cwd(), "src"));
  it.each(["total demand 199M", "coverage-floor-hint", "solve-coverage-floor-hint"])(
    "no source file contains %s", needle => {
      const hits = files.filter(f => readFileSync(f, "utf8").includes(needle));
      expect(hits).toEqual([]);
    });
});
```

- [ ] **Step 2: Run — expect failure** (`pnpm --filter studio test -- noHardcodedDemandHint`), listing both component files.

- [ ] **Step 3: Delete both blocks**, plus any assertion referencing those two test-ids in the two component test files.

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter studio test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "[T4] remove the hardcoded 199M coverage-floor hint from both surfaces" -- artifacts/studio/src
```

---

### Task 5: OpenAPI contract + codegen (sole writer of `openapi.yaml`)

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerate: `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`

**Interfaces:**
- Consumes: the exact v3 shapes from the spec's Part E table (copy them verbatim — do not re-derive).
- Produces: `Scenario.resultRunId`; export `unit` + `runId` query params; `PATCH /scenarios/{scenarioId}/distance-bands`; v3 `ExportEnvelope`/entity-row schemas.

- [ ] **Step 1: `Scenario` gains a read-only run pointer**

```yaml
        resultRunId:
          type: integer
          nullable: true
          readOnly: true
          description: >-
            The solve_jobs id that produced this scenario's current `result`.
            Null for pre-migration solves, whose full result was not retained —
            such a history entry is non-exportable.
```

- [ ] **Step 2: Export operation gains two query params**

On `GET /scenarios/{scenarioId}/export`:

```yaml
        - name: unit
          in: query
          required: false
          schema: { type: string, enum: [km, mi] }
          description: >-
            Unit for distance-dimension values in the emitted file. Validated for
            EVERY entity; an unknown value is 400 even for a non-distance entity.
            Ignored (byte-identical output) for non-distance entities. Omitted =
            each model's canonical unit.
        - name: runId
          in: query
          required: false
          schema: { type: integer, minimum: 1 }
          description: >-
            Export a specific solve run (a solve_jobs id owned by the caller AND
            belonging to this scenario) instead of the scenario's latest result.
```

Add `400` (invalid `unit`/`runId`) and keep the existing `404`/`422` on that operation.

- [ ] **Step 3: Part G route**

```yaml
  /scenarios/{scenarioId}/distance-bands:
    patch:
      operationId: updateDistanceBands
      summary: Field-scoped update of a scenario's distance bands (reporting lens only)
      parameters:
        - name: scenarioId
          in: path
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [distanceBands]
              properties:
                distanceBands:
                  type: array
                  minItems: 1
                  items: { type: number, exclusiveMinimum: 0 }
      responses:
        '200': { description: Updated scenario, content: { application/json: { schema: { $ref: '#/components/schemas/Scenario' } } } }
        '400': { description: Invalid or missing body, or a model-invalid band array }
        '404': { description: Not found (also returned for a scenario owned by another user) }
```

- [ ] **Step 4: v3 output entity rows**

Add/replace the `ExportEnvelope` + row schemas to match the spec table **exactly** — envelope carries `templateVersion` (const `3` for changed outputs) + `unit`; rows carry neither. `JadeFlowRow.leg` is `enum: [plant_to_warehouse, warehouse_to_customer]`. `band` is non-nullable on every band-bearing row; `costSummary` has no band.

- [ ] **Step 5: Regenerate and gate**

```bash
pnpm --filter @workspace/api-spec run generate   # or the repo's documented orval command
pnpm run typecheck
```
Expected: generated files change; typecheck clean. **Never hand-edit generated output.**

- [ ] **Step 6: Commit spec + codegen together**

```bash
git commit -m "[T5] OpenAPI: resultRunId, export unit/runId params, distance-bands PATCH, v3 output schemas (+regen)" -- lib/api-spec lib/api-zod lib/api-client-react
```

---

### Task 6: `jobRunner` — one transaction, durable result, run pointer

**Files:**
- Modify: `artifacts/api-server/src/solver/jobRunner.ts` (`markSucceeded`, ~283-310)
- Test: `artifacts/api-server/src/__tests__/jobRunner.test.ts`

**Interfaces:**
- Consumes: T2's two columns.
- Produces: an invariant later tasks rely on — a committed `scenario.result` and `scenario.resultRunId` always identify the same committed `solve_jobs.result`.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes job + scenario in ONE transaction on the normal solver path", async () => { /* assert db.transaction used, both .set payloads captured */ });
it("cache-hit path commits both sides identically", async () => { /* same assertion via the cached branch */ });
it("persists the full envelope on solve_jobs.result and the job id on scenarios.resultRunId", async () => {});
it("a forced mid-transaction failure writes NEITHER side", async () => {});
it("a solve completing after its scenario was deleted is a 0-row no-op, not an error", async () => {});
```

- [ ] **Step 2: Run — expect failure** (today it is two independent `db.update` calls).

- [ ] **Step 3: Implement**

```ts
async function markSucceeded(jobId: number, scenarioId: number, modelId: string, envelope: ResultEnvelope): Promise<void> {
  const objectiveMode = typeof envelope.details.objective === "string" ? envelope.details.objective : null;
  const distanceUnit = getManifest(modelId)?.distanceUnit ?? "mi";

  // Sixth-review #5: these two writes must be ATOMIC. Split across two
  // statements, a partial failure leaves an addressable succeeded run whose
  // scenario still points at an older result (or a result with no pointer).
  // Both statements are id-scoped, so a scenario deleted mid-solve simply
  // matches 0 rows and the transaction commits as a no-op.
  await db.transaction(async (tx) => {
    await tx.update(solveJobsTable)
      .set({
        status: "succeeded",
        result: envelope as unknown as Record<string, unknown>,
        resultSummary: { /* unchanged existing shape */ },
        finishedAt: new Date(),
      })
      .where(eq(solveJobsTable.id, jobId));

    await tx.update(scenariosTable)
      .set({
        result: envelope as unknown as Record<string, unknown>,
        resultRunId: jobId,
        solvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scenariosTable.id, scenarioId));
  });
}
```

- [ ] **Step 4: Run — expect pass**, then gate + commit.

```bash
pnpm --filter api-server test
git commit -m "[T6] markSucceeded writes job result + scenario result/resultRunId in one transaction" -- artifacts/api-server/src/solver/jobRunner.ts artifacts/api-server/src/__tests__/jobRunner.test.ts
```

---

### Task 7: `services/templates.ts` — v2 input files, v3 output files, band recompute

**Files:**
- Modify: `artifacts/api-server/src/services/templates.ts` (**sole writer**)
- Test: `artifacts/api-server/src/__tests__/templates.test.ts` + new fixtures under `__tests__/fixtures/exports/`

**Interfaces:**
- Consumes: `@workspace/units` (`assignBandOrOverflow`, `bandLabelOrOverflow`, `computeCumulativeBandCoverage`, `serviceEdgesFor`, `toDisplay`, `roundForFile`, `objectiveDimension`, `convertObjective`, `OVERFLOW_BAND`).
- Produces: `DISTANCE_TEMPLATE_VERSION = 2`, `OUTPUT_TEMPLATE_VERSION = 3`, per-entity CSV writers, JSON row projectors, and builders that take `(result, canonicalUnit, requestedUnit, savedBands)`.

- [ ] **Step 1: Version constants**

```ts
export const TEMPLATE_VERSION = 1;               // input entities — UNCHANGED
export const DISTANCE_TEMPLATE_VERSION = 2;      // distances / legDistances / laneCosts only
export const OUTPUT_TEMPLATE_VERSION = 3;        // was 2 — see the spec's v3 matrix
```

- [ ] **Step 2: Failing tests for the v3 matrix**

One test per row of the spec's matrix, asserting the emitted artifact (not an intermediate object):

```ts
it.each([
  ["assignments", 3], ["flows", 3], ["costSummary", 3], ["serviceStats", 3], ["openWarehouses", 1],
])("%s CSV rows and JSON envelope both emit version %i", (entity, version) => { /* ... */ });
```

- [ ] **Step 3: Input entities → v2 with a `unit` column**

`distances`/`legDistances` header `template_version,unit,from_id,to_id,distance`; **`laneCosts` keeps `cost`** → `template_version,unit,from_id,to_id,cost`. Parameterize the value-column name per entity; every row including blank stubs carries the same `unit` + version. JSON envelope `{templateVersion: 2, entity, unit, rows}` with `unit` on the **envelope only**.

- [ ] **Step 4: Output entities → v3, exact shapes**

Implement the six artifacts exactly as the spec's table specifies. Key rules:

```ts
// Band recompute: apply the shared classifier to EACH BUILDER ROW'S OWN
// canonical distance. Never re-derive rows from result.edges — JADE
// assignments are product-level rows from details.assignments, gold keeps its
// builder, flows keep theirs.
band: assignBandOrOverflow(row.canonicalDistance, savedBands),          // generic: numeric index, -1 overflow
band: bandLabelOrOverflow(row.canonicalDistance, savedBands),           // JADE: "Band N" | "Overflow"
```

```ts
// serviceStats band is the BOUNDARY VALUE converted to the requested unit —
// not an index — while the overflow sentinel stays categorical.
rows.map(r => ({
  band: r.band === OVERFLOW_BAND ? OVERFLOW_BAND : roundForFile(toDisplay(r.band, canonical, requested)),
  percent: r.percent,
}))
```

```ts
// costSummary objective converts via the SHARED mapping — no second table here.
const dim = objectiveDimension(modelId, objectiveMode);
objective: result.objective == null ? null : roundForFile(convertObjective(result.objective, dim, canonical, requested)),
```

Order of operations everywhere: **classify on canonical → convert → `roundForFile`**.

- [ ] **Step 5: JADE serializers become self-describing**

`jadeAssignmentRowsToCsv` header → `template_version,product,customer,assigned_warehouse,distance,distance_unit,distance_band`; `jadeFlowRowsToCsv` header → `template_version,leg,from_id,to_id,distance,distance_unit,distance_band,flows`; add `distanceUnit` to `JadeFlowTemplateRow`; type `leg` as the closed union.

- [ ] **Step 6: JSON row projectors**

JSON rows are **not** the builder rows — project away `templateVersion`/`distanceUnit` (including on `costSummary`), matching the spec's camelCase row column exactly.

- [ ] **Step 7: Fixtures**

CSV **and** JSON, at `unit=km` **and** `unit=mi`, for all six artifacts; plus boundary-equality, overflow-present, overflow-absent, zero-flow, and the `serviceStats` fixture whose boundary visibly differs between units while overflow stays `-1`. `costSummary` fixtures cover Chen coverage / Chen min-distance / JADE monetary / one converting distance objective.

- [ ] **Step 8: Gate + commit**

```bash
pnpm --filter api-server test && pnpm run typecheck
git commit -m "[T7] templates: v2 unit-labeled input files, v3 output files, shared band recompute per row source" -- artifacts/api-server/src/services/templates.ts artifacts/api-server/src/__tests__
```

---

### Task 8: `services/import.ts` — read the unit, convert to canonical

**Files:**
- Modify: `artifacts/api-server/src/services/import.ts` (**sole writer**)
- Test: `artifacts/api-server/src/__tests__/fixtures/imports/*` + `import.test.ts`

- [ ] **Step 1: Failing tests, one per locked rule**

```ts
it("v1 unitless file still imports, interpreted as canonical", () => {});
it("v2 file in the model's canonical unit imports unchanged", () => {});
it("v2 mi file into a km-canonical model is ACCEPTED and converted", () => {});
it("mixed units inside one file → format-class error", () => {});
it("mixed template_version inside one file → format-class error", () => {});
it("unknown unit → format-class error", () => {});
it("laneCosts v2 keeps its `cost` column", () => {});
it("round-trips export→import within abs 0.001 / rel 1e-5 over repeated cycles", () => {});
```

- [ ] **Step 2: Implement** — accept both the v1 and v2 headers per entity; on v2 read `unit` per row, reject mixed/unknown, then `fromDisplay(value, fileUnit, canonicalUnit)` before storing. Storage stays canonical always.

- [ ] **Step 3: Gate + commit**

```bash
pnpm --filter api-server test
git commit -m "[T8] import: v2 unit-labeled parsing, convert to canonical, reject mixed/unknown units" -- artifacts/api-server/src/services/import.ts artifacts/api-server/src/__tests__
```

---

### Task 9: Routes — `unit=`, `runId`, and the field-scoped bands PATCH

**Files:**
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (**sole writer**)
- Create: `artifacts/api-server/src/routes/distanceBands.ts`
- Modify: `artifacts/api-server/src/app.ts` (mount the new router)
- Test: `artifacts/api-server/src/__tests__/routes.test.ts`, new `distanceBands.test.ts`

**Interfaces:** consumes T5 (contract), T6 (invariant), T7 (builders).

- [ ] **Step 1: Failing route tests** — spec tests 7c, 7d, 14b:

```ts
// unit=
it("rejects an unknown unit with 400 on ANY entity, distance-bearing or not", () => {});
it("a valid unit on a non-distance entity yields byte-identical output to omitting it", () => {});
it("omitted unit = canonical (default)", () => {});
// runId
it("exports the addressed run, not the latest", () => {});
it("cross-user runId → 404", () => {});
it("cross-scenario runId → 404", () => {});
it("stale scenario + explicit runId → 200 (stale-gate is latest-path only)", () => {});
it("legacy null solve_jobs.result → 422", () => {});
it("malformed stored envelope → 422, never a throw", () => {});
it.each([0, -1, 1.5, "abc"])("runId %s → 400", () => {});
// Part G
it("PATCH distance-bands changes ONLY distanceBands (other keys byte-identical after a concurrent write)", () => {});
it("404 for non-owned and missing", () => {});
it("400 for invalid/missing body and a model-invalid array", () => {});
it("does not flip `stale`", () => {});
```

- [ ] **Step 2: Implement `unit=`** — validate first, before any entity dispatch, so an unknown value is 400 everywhere. Thread the requested unit into T7's builders; ignore it for the non-distance entity list.

- [ ] **Step 3: Implement `runId`** — validate finite positive integer (400); look up `solve_jobs` scoped by `id AND userId AND scenarioId` (404); `result == null` → 422; `ResultEnvelopeSchema.safeParse` → 422 on failure; skip the stale-gate on this path.

- [ ] **Step 4: Implement Part G** in `routes/distanceBands.ts`:

```ts
router.patch("/scenarios/:scenarioId/distance-bands", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const parsed = z.object({ distanceBands: z.array(z.number().positive()).min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid distanceBands" }); return; }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }   // never 403

  // Per-model rules (Chen ascending/unique/positive; JADE's own cardinality)
  const check = validateInputsForModel(scenario.modelId, { ...(scenario.inputs as object), distanceBands: parsed.data.distanceBands });
  if (!check.success) { res.status(400).json({ error: "Invalid distanceBands for this model" }); return; }

  // ATOMIC: no select-merge-write, so a concurrent update to any other key in
  // `inputs` cannot be lost. Deliberately does NOT bump inputsUpdatedAt — a
  // bands-only change is non-geometric and must not flip `stale`.
  const [row] = await db.update(scenariosTable)
    .set({ inputs: sql`jsonb_set(${scenariosTable.inputs}, '{distanceBands}', ${JSON.stringify(parsed.data.distanceBands)}::jsonb)` })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();
  res.json(toApiScenario(row));
});
```

- [ ] **Step 5: Gate + commit**

```bash
pnpm --filter api-server test && pnpm run typecheck
git commit -m "[T9] export unit=/runId addressing + field-scoped distance-bands PATCH (atomic jsonb_set)" -- artifacts/api-server/src/routes artifacts/api-server/src/app.ts artifacts/api-server/src/__tests__
```

---

### Task 10: `UnitContext` + toggle + objective wrapper

**Files:**
- Create: `artifacts/studio/src/contexts/UnitContext.tsx`, `artifacts/studio/src/components/UnitToggle.tsx`
- Modify: `artifacts/studio/src/main.tsx` (mount `UnitProvider` at the root), `artifacts/studio/src/lib/objectiveFormat.ts` (becomes a wrapper)
- Test: `artifacts/studio/src/__tests__/UnitContext.test.tsx`, `objectiveFormat.test.ts`

**Interfaces:**
- Produces `useDisplayUnit(): UnitApi` exactly as the spec's Part D block defines it, delegating all math to `@workspace/units`.

- [ ] **Step 1: Failing tests** — spec tests 9, 10, 13: `auto` is a no-op; `km`/`mi` convert at the exact factor; `toDisplay∘fromDisplay` round-trips; the pref persists across a remount (localStorage); `objectiveFormat` produces the right suffix for all six models under both units and **holds no mapping of its own** (assert it calls through by mocking `@workspace/units`).

- [ ] **Step 2: Implement `UnitContext`** — `pref` state seeded from `localStorage`, default `"auto"`; `setPref` writes through; the five methods delegate to `@workspace/units`; **never** infer a unit from `modelId` here.

- [ ] **Step 3: Implement `UnitToggle`** — compact `auto/km/mi` segmented control; render it in the app header (model screens + Landing).

- [ ] **Step 4: Rewrite `objectiveFormat.ts` as a wrapper** — it may add locale formatting and the suffix string only; the `(modelId, mode) → dimension` mapping and the numeric conversion both come from `@workspace/units`.

- [ ] **Step 5: Gate + commit.**

---

### Task 11: Read-path de-hardcoding (no fallback unit)

**Files:** every reachable component that renders a distance or a unit label — output grids/KPIs, `NetworkMap` popups + `MapLegend`, `DistancesTab`/`LegDistancesTab`/`JadeDistancesTab` display cells, `CostSummaryTab`, `ServiceStatsTab`, `ObjectiveBar`, Landing recent-solves, validation strings. **`Studio.tsx` is excluded (dead code).**

- [ ] **Step 1: Failing tests** — spec tests 11b, 12: a delayed-manifest Chen **read** renders a placeholder, never a number or an `mi` label, until the canonical unit is authoritative; non-distance fields (demand, `coverageFloorDemand`, `p`, gap, time, JADE monetary objective) are untouched by the toggle.

- [ ] **Step 2: Replace every `"(km)"`/`"(mi)"` literal and every `distanceUnit === …` / `modelId`-based unit branch** with `useDisplayUnit()`'s `format`. Delete the `?? "mi"` fallbacks (e.g. `ServiceStatsTab.tsx:27-31`) — gate on "canonical resolved" instead.

- [ ] **Step 3: Add a grep-guard test** asserting no hardcoded `(km)`/`(mi)` label literal remains in the enumerated components.

- [ ] **Step 4: Gate + commit.**

---

### Task 12: Write-path draft contract

**Files:** create `artifacts/studio/src/hooks/useDistanceDraft.ts`; modify `OptimizationParametersTab`, `SolveDialog`, `DistancesTab`, `LegDistancesTab`, `LaneCostsTab`, `JadeDistancesTab`.

- [ ] **Step 1: Failing tests** — spec tests 11, 11b, 11c. Each grammar token explicitly:

```ts
it.each(["", "-", ".", "5.", "5e", "5e+", "--5"])("%s is INCOMPLETE", t => expect(isComplete(t)).toBe(false));
it.each(["5", "-5.5", ".5", "5e3", "5e-3"])("%s is COMPLETE", t => expect(isComplete(t)).toBe(true));
it("a complete draft converts in place on toggle", () => {});
it("an incomplete draft is DISCARDED on toggle; the field visibly reverts in the new unit", () => {});
it("display and commit units can never diverge: `5.` under km → toggle to mi → type `5`", () => {});
it("toggling never mutates localInputs, never marks dirty, never changes a payload", () => {});
it("the editor is disabled until the canonical unit resolves (delayed manifest)", () => {});
```

- [ ] **Step 2: Implement the hook**

```ts
export const COMPLETE_NUMBER = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
export const isComplete = (text: string) => COMPLETE_NUMBER.test(text);
```

Toggle: complete → convert text in place; **incomplete → discard** (field reverts to the stored value rendered in the new unit). Commit (blur/Enter): parse, `fromDisplay` from the **current effective unit** → canonical, write, clear. Esc and scenario-switch discard. A draft is therefore always in the unit on screen — `authoredUnit` does not exist.

- [ ] **Step 3: Adopt the hook in all six editors** (transport's `laneCostOverrides.cost` values **are** distances and convert).

- [ ] **Step 4: Gate + commit.**

---

### Task 13: Chen band editor + live coverage

**Files:** modify `OptimizationParametersTab.tsx` (band editor), `ServiceStatsTab.tsx` (remove the Chen guard).

> **Ownership note:** `defaultInputsForModel` lives in `Workspace.tsx`, which is **Task 14's** sole-writer file. The default band array `[600,1200,2400,5000]` is therefore changed in **Task 14 Step 2a**, not here. This task owns the editor component and `ServiceStatsTab` only, and its default-bands test asserts against the editor's rendered chips given seeded inputs.

- [ ] **Step 1: Failing tests** — spec tests 1, 3, 5, and the Service Stats half of 7: editor renders for Chen; add/remove works; removal blocked at the last boundary; a high-service edit retargets a band equal to the **old** high (only if present) then dedupes+re-sorts; removing the high band makes later high edits leave bands untouched; add rejects `≤0` and duplicates.

- [ ] **Step 2: Re-enable the editor for Chen**; implement free-band add/remove and the conditional high-link retarget. No maxDist coupling, no locked chip, no prune logic.

- [ ] **Step 3: Wire Chen into `presentationBands` and delete the deliberate Chen guard** (`ServiceStatsTab.tsx:~191-230`) so Chen computes live like its five siblings, cumulative labels plus an `Overflow` row. Chen's `details.coveragePct` KPIs are untouched.

- [ ] **Step 4: Gate + commit.**

---

### Task 14: `Workspace.tsx` integration (sole writer, last)

**Files:** modify `artifacts/studio/src/pages/Workspace.tsx`, `artifacts/studio/src/lib/exportEntity.ts`; create `artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx`.

This task owns every cross-cutting behavior: the band-lens state, the history action matrix, the dirty-nav prompt, the shared payload builder, `Save as scenario`, and run-id threading.

- [ ] **Step 1: Failing tests** — spec tests 7, 7e, 7g, 7h, 7i, and the client half of 7c/14b.

- [ ] **Step 2a: Chen defaults (spec Part A + Part B)**

In `defaultInputsForModel`'s Chen branch (`Workspace.tsx` ~L115):

```ts
        distanceBands: [600, 1200, 2400, 5000],   // 600 == the default highServiceDistKm
```

**Verify — do not change — the two service-distance defaults** (spec Part B): `highServiceDistKm: 600` and `avgServiceDistCapKm: 1000` must stay exactly as they are. They are deliberately **not** seeded to the same value: making the avg cap 600 would tighten the default solve from the frozen 66.0639% / `{wh-40, wh-69, wh-102}` golden to 64.8234% / `{wh-40, wh-102, wh-147}` and break `e2e/chens-cosmetics.spec.ts`. Add a test asserting both defaults, so a future "tidy-up" cannot silently change the golden.

Existing Chen scenarios keep their stored `[high, max]` — still valid (≥1, ascending). **No backfill.**

- [ ] **Step 2b: Band-lens state** — a dedicated lens state with its **own** saved ref and dirty flag, seeded from the active scenario's bands. History stepping must **not** touch it. Lens dirtiness must **not** feed the generic `isDirty`.

- [ ] **Step 3: `buildWholeInputPayload()`**

```ts
// Ninth-review #2 — EVERY whole-input writer calls this immediately before
// validation/PATCH. handleSolve's save-before-solve branch is a second writer;
// without this it would persist localInputs' stale bands over the active lens.
const buildWholeInputPayload = () => ({ ...localInputs, distanceBands: activeBandLens });
```

Use it in the Save control **and** in `handleSolve`'s save-before-solve branch.

- [ ] **Step 4: History action matrix** — implement the spec's table exactly. Ordinary editors disabled at an older index; the whole-input PATCH unreachable there; Save enabled and labelled **"Save bands"** when the lens is dirty, firing only the field-scoped route; `Run Optimizer` disabled at an older index **and** `handleSolve` itself rejecting a historical position.

- [ ] **Step 5: Dirty-nav prompt (decision 1i)** — guard `stepResultBack`/`stepResultForward` **themselves**, not just the buttons. `ordinaryDirty` → Save / Discard / Cancel before the index changes; `lensDirty` alone never prompts.

- [ ] **Step 6: `Save as scenario`** → `{ ...entry.inputs, distanceBands: activeBandLens }` (active **draft** lens).

- [ ] **Step 7: Run-id threading** — `ResultHistoryEntry` gains `runId?: number`; the seed takes `currentScenario.resultRunId`; a new solve attaches the polling job id **independently of `timing`**; an entry with no `runId` renders its download disabled and labelled. `downloadEntityExport` gains optional `runId` and appends the current display `unit` **universally**.

- [ ] **Step 8: Gate + commit.**

---

### Task 15: QA — real browser (standing plan rule)

**Files:** create `artifacts/studio/e2e/chen-bands-units.spec.ts`.

Dispatch to `qa-sdet`. Run against real local dev servers (api-server + studio with `API_PROXY_TARGET`), **excluding `labs.spec.ts`** (known pre-D0 debt).

- [ ] **Step 1: Cover, for real** — Chen band add/remove + live recolor + overflow; the high-link retarget; lens Save while browsing history leaving other inputs untouched; the dirty-nav prompt's three outcomes; Run Optimizer disabled in history; `Save as scenario` carrying the on-screen lens; the unit toggle converting inputs *and* outputs with persistence across reload; the `5.`-toggle draft-discard; a historical export matching the displayed tab; `unit=km` vs `unit=mi` export files differing.

- [ ] **Step 2: Run twice green.** Report product bugs back rather than fixing them inside the QA task.

- [ ] **Step 3: Full final gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && pnpm --filter @workspace/units test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x) \
  && (cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```
Expected: all green; **`e2e_accuracy.py` 99/99 unmodified**; the default Chen scenario still solves to 66.0639%.

- [ ] **Step 4: Commit.**

---

## Post-merge

Run `/harness-retro chen-bands-units` — a branch is not finished until it has.

**Deploy is outward-facing:** surface the deploy step and get explicit confirmation before triggering. Note that `autoDeploy` does **not** fire for this repo — both `nos-api` and `nos-studio` need a manual `trigger_deploy`.

## Known out-of-scope items (recorded, deliberately not fixed here)

- Gold's generic `buildAssignmentRows` maps **all** edges with no leg filter, so its assignments export includes `mine_to_refinery` rows. Pre-existing defect; this bundle changes only the `band` value, never a row source.
- Restoring an older entry's inputs (the behavior decision 1h removes) would need its own explicit action. `Save as scenario` covers the real use case.
- JSON import remains out of scope — import stays CSV-only.
