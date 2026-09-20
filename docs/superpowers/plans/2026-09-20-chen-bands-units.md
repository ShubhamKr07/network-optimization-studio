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
- **Hard rule #2 — `e2e_accuracy.py` is sacred.** `artifacts/api-server/src/solver/tests/e2e_accuracy.py` must pass unmodified (99/99). **No task in this plan touches `solve.py`, any `solvers/*/dataset/*`, or any Python file.** `solvers/` edits are limited to **manifest JSON only**, in exactly two tasks and exactly six files (plan-review-5 #1): Task 3 edits `solvers/chens-cosmetics-cn/manifest.json`; Task 3b edits the band-items type in `solvers/p-median-us/manifest.json`, `solvers/p-median-brazil/manifest.json`, `solvers/transport-coal/manifest.json`, `solvers/two-echelon-gold-au/manifest.json`, `solvers/two-echelon-jade-us/manifest.json`. No other `solvers/` path may appear in any commit pathspec.
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
| `lib/units` wiring | `@workspace/units` dep in both consumer `package.json`s + a root `tsconfig.json` project reference (plan-review #1). |
| `artifacts/studio/src/components/UnitToggle.tsx` | The `auto/km/mi` header control. |
| `artifacts/studio/src/hooks/useDistanceDraft.ts` | The draft contract (grammar, toggle behavior, commit) as one reusable hook. **Created in Task 10** so Tasks 12 and 13 can both consume it in parallel. |
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
Wave 0 (parallel, file-disjoint):  T1 units pkg (+monorepo wiring) · T2 db schema · T3 chen validator+manifest
                                   T3b sibling band schemas -> positive numbers   [after T3: same directory]
                                   T4 199M hint
Wave 1 (after W0):                 T1b studio bands.ts re-export · T5 openapi+codegen · T6 jobRunner txn   [T6 needs T2]
Wave 2 (sequential, hot files):    T7 templates.ts  →  T8 import.ts             [need T1, T5]
Wave 3:                            T9 routes/scenarios.ts + distanceBands.ts    [needs T5,T6,T7]
Wave 4 (frontend):                 T10 UnitContext + UnitToggle + AppShell + useDistanceDraft
                                     →  then T11 ∥ T12 ∥ T13 (genuinely file-disjoint, see below)
                                     →  T11b export plumbing (touches all 16 tab files — runs AFTER T11/T12/T13)
                                   T14 Workspace.tsx INT (sole writer, last)
Wave 5:                            T15 QA (real-browser Playwright)
```

**Wave 4 file ownership (plan-review #3 — T11/T12/T13 previously collided).** Split so the three run genuinely in parallel, each the sole writer of its set:

| Task | Owns |
|---|---|
| T10 foundation | `UnitContext`, `UnitToggle`, `AppShell` (Landing mount), `formatObjective`, **`useDistanceDraft`** |
| T11 read-only surfaces | `NetworkMap`, `MapLegend`, `OutputMapTab`, `CostSummaryTab`, `JadeAssignmentsTab`, `JadeFlowsTab`, `ObjectiveBar`, `Landing` recent-solves, validation strings |
| T12 distance editors | `DistancesTab`, `LegDistancesTab`, `LaneCostsTab`, `JadeDistancesTab` |
| T13 Chen + coverage | `OptimizationParametersTab`, **`SolveDialog`**, **`JadeBandEditor`**, `ServiceStatsTab` |
| T11b export plumbing | `ExportContext` (new) + **the 16 export-control tab files** (15 helper-calling files with 24 calls, **plus `JadeFlowsTab`'s two client-CSV controls** — 26 controls total) + `exportEntity.ts` (**T11b is its sole writer**) |

Two rules make the parallelism real (plan-review-2 #1):

1. **The shared draft hook is created in T10, not T12.** T12 and T13 are both *consumers* of `useDistanceDraft`; if T12 created it, T13 would depend on T12 and the three could not run together.
2. **A component with both a read half and a write half has exactly ONE owner, who implements both halves.** `DistancesTab`/`LegDistancesTab`/`JadeDistancesTab` render reference distances *and* accept edits — all of that is T12's. `ServiceStatsTab` renders distances *and* holds the Chen coverage guard — all of that is T13's. No task may reclaim another's file under a phrase like "every reachable component".

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

`pnpm-workspace.yaml` already globs `lib/*`, so no glob change is needed — but the package still has to be **wired in** (plan-review #1); creating the directory alone is not enough under this repo's pnpm + TS-project-references setup.

Add the dependency to **both** consumers:

```jsonc
// artifacts/studio/package.json  AND  artifacts/api-server/package.json — dependencies
"@workspace/units": "workspace:*",
```

Add the project reference to the root `tsconfig.json` (it currently lists `lib/db`, `lib/api-client-react`, `lib/api-zod`, `lib/dataset-schema` — without this entry `pnpm -w run typecheck:libs` never checks the new package):

```jsonc
    { "path": "./lib/units" },
```

Then:

```bash
pnpm install     # regenerates pnpm-lock.yaml — it MUST be committed with this task
```

A missing lockfile update breaks CI and the Docker build with `ERR_PNPM_OUTDATED_LOCKFILE` (this repo has hit that exact failure before).

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
pnpm -w run typecheck:libs     # proves the new project reference is actually wired
git commit -m "[T1] add @workspace/units — pure cross-runtime unit, objective and band contract (+monorepo wiring)" -- \
  lib/units tsconfig.json pnpm-lock.yaml \
  artifacts/studio/package.json artifacts/api-server/package.json
```

---

### Task 1b: Studio re-exports the shared band classifier (no second implementation)

**Files:**
- Modify: `artifacts/studio/src/lib/bands.ts` (**sole writer**)
- Test: `artifacts/studio/src/__tests__/bands.test.ts` + new `artifacts/studio/src/__tests__/bandsSingleSource.test.ts`

**Why this task exists (plan-review #2):** `artifacts/studio/src/lib/bands.ts` currently owns its *own* `OVERFLOW_BAND`, `assignBandOrOverflow`, `bandLabel` and `computeCumulativeBandCoverage`, and is imported by **ten** call sites — `NetworkMap`, `MapLegend`, `OutputMapTab`, `ServiceStatsTab`, `JadeAssignmentsTab`, `JadeFlowsTab` and their tests. Without this task the frontend keeps a parallel copy of the exact logic the API server now shares, and map colours, grid labels and export files can silently drift — the failure mode `@workspace/units` exists to make impossible.

**Interfaces:**
- Consumes: `@workspace/units` (T1).
- Produces: `artifacts/studio/src/lib/bands.ts` as a **thin re-export**, so every existing consumer import keeps working unchanged.

- [ ] **Step 1: Write the single-source guard test**

`bandsSingleSource.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as studioBands from "@/lib/bands";
import * as sharedUnits from "@workspace/units";

// `as never` cannot be indexed; use a plain string-keyed record view of each
// module so the identity comparison actually typechecks (plan-review-2 #5).
const studioShared = studioBands as unknown as Record<string, unknown>;
const packageShared = sharedUnits as unknown as Record<string, unknown>;

describe("the frontend has no second band implementation", () => {
  it.each(["OVERFLOW_BAND", "assignBandOrOverflow", "computeCumulativeBandCoverage", "serviceEdgesFor"])(
    "%s is the SAME binding as @workspace/units", name => {
      expect(studioShared[name]).toBe(packageShared[name]);
    });

  it("bandLabel is the shared classifier itself, merely renamed", () => {
    // Identity, not equal output — an independently written function that
    // happens to return the same strings must still fail this.
    expect(studioBands.bandLabel).toBe(sharedUnits.bandLabelOrOverflow);
  });
});
```

Every assertion is `toBe` (reference identity), never `toEqual` — a copied function with identical behavior must still fail, for **all four** shared exports plus the renamed label helper.

- [ ] **Step 2: Run — expect failure** (`pnpm --filter studio test -- bandsSingleSource`): the two modules currently export distinct function objects.

- [ ] **Step 3: Convert `bands.ts` to a re-export**

```ts
// Plan-review #2 — the band classifier now lives in @workspace/units so the
// map, the grids and the API server's export builders cannot drift apart.
// This module stays as the frontend's import surface (ten call sites depend on
// it) but owns no logic.
export {
  OVERFLOW_BAND,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  serviceEdgesFor,
  type BandEdge,
  type BandCoverageEntry,
} from "@workspace/units";

// The frontend's established name for the shared label helper.
export { bandLabelOrOverflow as bandLabel } from "@workspace/units";
```

**Keep locally** only genuinely frontend-specific helpers that `@workspace/units` deliberately does not own — `DEFAULT_DISTANCE_BANDS`, `computeAutoBands`, `assignBand`, and the legacy **exclusive** `computeBandCoverage` (still used by the older display path). Do not delete them in this task.

- [ ] **Step 4: Run the full studio suite**

```bash
pnpm --filter studio test
```
Expected: PASS, including the ten pre-existing consumers and `bands.test.ts`, with **no call-site edits** — the re-export keeps every import path identical.

- [ ] **Step 5: Commit**

```bash
git commit -m "[T1b] studio/lib/bands re-exports the shared @workspace/units classifier (single source)" -- artifacts/studio/src/lib/bands.ts artifacts/studio/src/__tests__
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

In `lib/db/src/schema/scenarios.ts`. **This IS a circular module import** (plan-review #8): `solve_jobs.ts` already imports `scenariosTable` from `./scenarios.js`, so importing `solveJobsTable` back closes the cycle. Drizzle's documented fix is not "use the callback form" — the callback form is already required — it is to **annotate the callback's return type** so TypeScript can break the inference cycle:

```ts
import { integer, type AnyPgColumn } from "drizzle-orm/pg-core";
import { solveJobsTable } from "./solve_jobs.js";
```

```ts
  // Decision 1g — which solve_jobs row produced this row's current `result`.
  // Written in the SAME transaction as `result` (jobRunner), so the two can
  // never disagree. ON DELETE SET NULL, because scenario deletion removes the
  // child solve_jobs FIRST (routes/scenarios.ts) — a restrictive FK would
  // deadlock that order — and a null pointer is exactly the already-specified
  // "legacy, non-exportable" state.
  // The explicit `: AnyPgColumn` return annotation is REQUIRED — without it
  // TypeScript cannot resolve the scenarios <-> solve_jobs import cycle and
  // fails with an implicit-any / circular-inference error.
  resultRunId: integer("result_run_id").references((): AnyPgColumn => solveJobsTable.id, { onDelete: "set null" }),
```

- [ ] **Step 3: Write the schema-shape test**

`artifacts/api-server/src/__tests__/schemaColumns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// @workspace/db exports exactly two entry points — "." and "./schema".
// Deep subpaths like "@workspace/db/schema/solve_jobs" do NOT resolve.
import { solveJobsTable, scenariosTable } from "@workspace/db/schema";

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

- [ ] **Step 4: Push the schema and verify the FK action**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" psql -c "\d scenarios" | grep result_run_id
```
Expected: the column exists and the FK prints `ON DELETE SET NULL`.

- [ ] **Step 5: Prove the cycle is resolved and the delete order still works**

```bash
pnpm run typecheck                                  # fails loudly if the AnyPgColumn annotation is missing
pnpm --filter api-server test -- routes.test.ts     # scenario-delete integration path
```

Add an integration test asserting **deleting a solved scenario still returns 204, then 404 on refetch** with the new FK in place (plan-review #7) — the existing handler deletes the child `solve_jobs` rows first, and `ON DELETE SET NULL` must let that order stand rather than blocking it.

- [ ] **Step 6: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter api-server test
git commit -m "[T2] add solve_jobs.result + scenarios.result_run_id (nullable, ON DELETE SET NULL)" -- lib/db artifacts/api-server/src/__tests__
```

---

### Task 3: Chen input contract — free bands, no overwrite

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/chens.ts`
- Modify: `solvers/chens-cosmetics-cn/manifest.json`
- Test: `artifacts/api-server/src/validation/inputs/__tests__/chens.test.ts`
- Test: `artifacts/api-server/src/__tests__/routes.test.ts` (create + whole-input PATCH band preservation — Step 5b)
- Test: `artifacts/api-server/src/__tests__/importMultiModelRoundTrip.test.ts` (import-**apply** band preservation — Step 5b). **Not `import.test.ts`**: that file imports `parseAndValidateImport` from the service and exercises the parser, not route application, so it cannot prove imported bands reach scenario storage (plan-review-3 #5). Add `import.test.ts` only if this task also changes parser behavior — it does not.

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

- [ ] **Step 5b: Cover all three write paths (plan-review #7)**

The overwrite lived in the shared validator, so it must be proven gone on **every** route that validates Chen inputs — not just `parse()` in isolation:

```ts
it("POST /scenarios (create) preserves a supplied band array", () => {});
it("PATCH /scenarios/:id (whole-input) preserves a supplied band array", () => {});
// In importMultiModelRoundTrip.test.ts — a ROUTE-level assertion that the
// applied bands actually land in scenario storage, not just parse cleanly.
it("POST /scenarios/:id/import/apply preserves a supplied band array in the stored scenario", () => {});
it.each(["create", "patch", "import-apply"])("%s derives [high,max] only when distanceBands is omitted", () => {});
```

Then run the suites that actually execute them — the validator-only run in Step 5 does **not** cover these (plan-review-2 #3, plan-review-3 #5):

```bash
pnpm --filter api-server test -- routes.test.ts importMultiModelRoundTrip.test.ts
pnpm --filter api-server test
```
Expected: PASS, including the create / whole-input-PATCH / import-apply cases.

- [ ] **Step 6: Commit**

```bash
git commit -m "[T3] Chen bands are free and preserved — stop the [high,max] overwrite, minItems 1, reject maxDist<=high" -- \
  artifacts/api-server/src/validation/inputs \
  artifacts/api-server/src/__tests__ \
  solvers/chens-cosmetics-cn/manifest.json
```

---

### Task 3b: Relax the sibling band schemas to positive numbers

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/pMedian.ts` (line ~90), `transportLp.ts` (~71), `twoEchelon.ts` (~99), `jadeInputs.ts` (~158-163)
- Modify (exact paths, no globs): `solvers/p-median-us/manifest.json`, `solvers/p-median-brazil/manifest.json`, `solvers/transport-coal/manifest.json`, `solvers/two-echelon-gold-au/manifest.json`, `solvers/two-echelon-jade-us/manifest.json` — band items `"type": "integer"` → `"type": "number", "exclusiveMinimum": 0`
- Test: `artifacts/api-server/src/validation/inputs/__tests__/*.test.ts` (per model), `artifacts/api-server/src/registry/__tests__/registration.test.ts`

**Spec status:** this task implements **spec decision 1j**, added to the design doc in `0faa98b`. The spec's Part G previously said JADE's integer rules were unchanged; that line is now amended, so plan and spec agree and the "spec wins" rule resolves cleanly (plan-review-5 #1).

**Why (plan-review-4 #2).** The unit toggle makes band entry lossy-or-illegal otherwise: on a mile-canonical model, typing `500 km` converts to `310.6856 mi`, which today's `z.number().int().positive()` rejects outright. Bands are a **reporting lens** — the integer constraint was never load-bearing, and Chen's new schema (T3) is already `z.number().positive()`. Relaxing makes one rule true app-wide instead of a per-model patchwork.

**Interfaces:**
- Produces: every model's `distanceBands` accepts **positive numbers**. JADE keeps its **fixed cardinality of 4** and strict ascent; only the integrality drops.

- [ ] **Step 1: Failing tests**

```ts
// pMedian / transportLp / twoEchelon
it("accepts a non-integral band produced by a unit conversion", () => {
  expect(() => schema.parse({ ...base, distanceBands: [310.6856, 621.3712] })).not.toThrow();
});
it("still rejects zero and negative bands", () => {});
// These three schemas are bare `z.array(z.number().int().positive()).min(1)` —
// they do NOT reject duplicate or non-ascending arrays today (pMedian.ts:90,
// transportLp.ts:71, twoEchelon.ts:99), and this bundle does not add that
// (plan-review-5 #5). Assert the EXISTING tolerance so a future tightening is
// a deliberate, visible contract change rather than an accident. The shared
// classifier sorts internally, so there is no correctness gap.
it("still ACCEPTS duplicate / non-ascending arrays, exactly as before", () => {
  expect(() => schema.parse({ ...base, distanceBands: [400, 200, 400] })).not.toThrow();
});

// jadeInputs
it("accepts four strictly-ascending POSITIVE NUMBERS (integrality dropped)", () => {
  expect(() => jadeInputsSchema.parse({ ...base, distanceBands: [310.6856, 621.3712, 932.06, 1242.74] })).not.toThrow();
});
it("still requires EXACTLY four, strictly ascending", () => {});
```

- [ ] **Step 2: Run — expect failure** (`pnpm --filter api-server test`): the non-integral cases throw today.

- [ ] **Step 3: Implement** — drop `.int()` in the three array schemas **and change nothing else about them** (no new ordering/uniqueness refinement — see Step 1's note); in `jadeInputs.ts` change the message and predicate from "positive integers" to "positive numbers" while keeping `length === 4` and strict ascent. Update the five enumerated manifests' band-items type.

- [ ] **Step 4: Run — expect pass.** If a manifest-hash fixture pins an edited manifest, update that expected hash in this commit and note it in the body.

- [ ] **Step 5: Commit**

```bash
pnpm --filter api-server test && pnpm --filter @workspace/dataset-schema test
git commit -m "[T3b] relax sibling distanceBands schemas to positive numbers (JADE keeps fixed-4 + strict ascent)" -- \
  artifacts/api-server/src/validation/inputs artifacts/api-server/src/registry \
  solvers/p-median-us/manifest.json solvers/p-median-brazil/manifest.json \
  solvers/transport-coal/manifest.json solvers/two-echelon-gold-au/manifest.json \
  solvers/two-echelon-jade-us/manifest.json
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

- [ ] **Step 4: Export envelope variants — v1 / v2 / v3, NOT a global v3 (plan-review #6)**

One endpoint returns **three different versioned families**, so a single v3 unit-bearing `ExportEnvelope` would misdescribe most of the export surface. Model it as entity/version-specific schemas composed with `oneOf`:

| Family | Entities | Envelope |
|---|---|---|
| **v1, unitless** | `warehouses`, `customers`, `mines`, `stations`, `refineries`, `plants`, `plantCapabilities`, `openWarehouses` | `templateVersion` const `1`; **no `unit` property at all** — do not invent one; output is byte-identical with or without `unit=` |
| **v2, unit-bearing input** | `distances`, `legDistances`, `laneCosts` | `templateVersion` const `2` + `unit`; rows per the spec's input contract (`laneCosts` keeps its `cost` column) |
| **v3, unit-bearing output** | `assignments`, `flows`, `costSummary`, `serviceStats` (+ the JADE assignment/flow variants) | `templateVersion` const `3` + `unit`; the six exact row shapes from the spec's Part E table |

Placement rule, **scoped per family** (plan-review-2 #2 — a blanket "every envelope carries `templateVersion` + `unit`" contradicts the v1 row directly above):
- **v1 envelopes** carry `templateVersion` + `entity` and have **no `unit` property at all**;
- **v2 and v3 envelopes** carry `templateVersion` + `entity` + `unit`;
- **rows in every family carry neither** envelope-level field.

Generated-schema fixtures must **prove the absence** of `unit` on a v1 envelope (e.g. `expect(envelope).not.toHaveProperty("unit")`), not merely its presence on v2/v3. `JadeFlowRow.leg` is `enum: [plant_to_warehouse, warehouse_to_customer]`. `band` is non-nullable on every band-bearing row; `costSummary` has none. Every generated schema **example** must assert `1`, `2`, or `3` per the version matrix — never v3 globally. The entity-specific **CSV** contracts stay documented separately from the JSON envelopes.

- [ ] **Step 5: Regenerate and gate**

```bash
pnpm --filter @workspace/api-spec codegen   # the real script name; it also runs typecheck:libs
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

- [ ] **Step 7b: Objective mapping exercised through the API-SERVER runtime (plan-review #7)**

Test 13 must fail if anyone reintroduces a backend-local mapping, so assert it from **this package**, not only from the pure package and the frontend wrapper:

```ts
it.each([
  ["p-median-us", null], ["p-median-brazil", null], ["transport-coal", null],
  ["two-echelon-gold-au", null], ["two-echelon-jade-us", null],
  ["chens-cosmetics-cn", "coverage"], ["chens-cosmetics-cn", "min_distance"],
])("costSummary objective for %s/%s converts per the shared contract under km AND mi", () => {
  // build the costSummary rows at unit=km and unit=mi and assert the numeric
  // result equals convertObjective(...) from @workspace/units — never a
  // locally-recomputed expectation.
});
```

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
it("OMITTED runId retains the unchanged latest-export behavior byte-for-byte", () => {});
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
it("returns a Scenario whose inputs.distanceBands are the NEW bands", () => {});
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

- [ ] **Step 4d: Provider test strategy (plan-review-6 #2)**

`useExport()` throwing without a provider is what makes a missing Task 14 mount detectable — so every existing test that renders an export-control tab must now supply one. Locked strategy: **a shared helper, not per-file mocks**, so the real context code is exercised everywhere:

```tsx
// __tests__/helpers/renderWithExportProvider.tsx
export function renderWithExportProvider(ui: ReactElement, overrides: Partial<ExportApi> = {}) {
  return render(<ExportProvider value={{ scenarioId: 1, unit: "mi", ...overrides }}>{ui}</ExportProvider>);
}
```

Migrate every affected tab test to it. Keep one **integration** test asserting that rendering an export control **without** a provider throws — that is the regression guard for the production mount.

- [ ] **Step 5: Gate + commit**

```bash
pnpm --filter api-server test && pnpm run typecheck
git commit -m "[T9] export unit=/runId addressing + field-scoped distance-bands PATCH (atomic jsonb_set)" -- artifacts/api-server/src/routes artifacts/api-server/src/app.ts artifacts/api-server/src/__tests__
```

---

### Task 10: `UnitContext` + toggle + objective wrapper

**Files:**
- Create: `artifacts/studio/src/contexts/UnitContext.tsx`, `artifacts/studio/src/components/UnitToggle.tsx`, **`artifacts/studio/src/hooks/useDistanceDraft.ts`**
- Modify: `artifacts/studio/src/main.tsx` (mount `UnitProvider` at the root), `artifacts/studio/src/components/AppShell.tsx` (mount `UnitToggle` in the Landing header), `artifacts/studio/src/lib/formatObjective.ts` (becomes a wrapper) — note the real filename is `formatObjective.ts`, **not** `objectiveFormat.ts`
- Test: `artifacts/studio/src/__tests__/UnitContext.test.tsx`, `artifacts/studio/src/__tests__/formatObjective.test.ts`, **`artifacts/studio/src/__tests__/useDistanceDraft.test.ts`**

**Interfaces:**
- Produces `useDisplayUnit(): UnitApi` exactly as the spec's Part D block defines it, delegating all math to `@workspace/units`.

- [ ] **Step 1: Failing tests** — spec tests 9, 10, 13: `auto` is a no-op; `km`/`mi` convert at the exact factor; `toDisplay∘fromDisplay` round-trips; the pref persists across a remount (localStorage); `formatObjective` produces the right suffix for all six models under both units and **holds no mapping of its own** (assert it calls through by mocking `@workspace/units`).

- [ ] **Step 2: Implement `UnitContext`** — `pref` state seeded from `localStorage`, default `"auto"`; `setPref` writes through; the five methods delegate to `@workspace/units`; **never** infer a unit from `modelId` here.

- [ ] **Step 3: Implement `UnitToggle`** — compact `auto/km/mi` segmented control.

**Mount ownership is split (plan-review #3)**, because the two headers live in different files and `Workspace.tsx` is reserved for Task 14:
- **This task** mounts it in `AppShell.tsx` (the Landing / non-workspace header).
- **Task 14 Step 7a** mounts it in the workspace header inside `Workspace.tsx`.
Neither task edits the other's file.

- [ ] **Step 4: Rewrite `formatObjective.ts` as a wrapper** — it may add locale formatting and the suffix string only; the `(modelId, mode) → dimension` mapping and the numeric conversion both come from `@workspace/units`.

- [ ] **Step 5: Create `useDistanceDraft` here, not in T12 (plan-review-2 #1)**

Both T12 and T13 consume this hook, so it must exist before either starts or they cannot run in parallel. Implement the full draft contract exactly as written in **Task 12 Step 2** (grammar constant, toggle behavior, commit behavior).

Ship it with `artifacts/studio/src/__tests__/useDistanceDraft.test.ts` (plan-review-3 #4 — previously promised but never named, committed, or gated), covering:

```ts
it("seeds the draft from the canonical value rendered in the effective display unit", () => {});
it("commits a display-unit entry back to canonical (500 mi -> 804.672 km)", () => {});
it("converts a COMPLETE draft in place on a unit toggle", () => {});
it("DISCARDS an incomplete draft on toggle and reseeds from the stored value in the new unit", () => {});
it.each(["", "-", ".", "5.", "5e", "5e+", "--5"])("%s is incomplete and never commits", () => {});
it("is disabled / commits nothing while the canonical unit is unresolved", () => {});
```

- [ ] **Step 6: Gate + commit**

```bash
pnpm --filter studio test -- UnitContext formatObjective useDistanceDraft
git commit -m "[T10] UnitContext + UnitToggle + AppShell mount + formatObjective wrapper + useDistanceDraft" -- \
  artifacts/studio/src/contexts artifacts/studio/src/components/UnitToggle.tsx \
  artifacts/studio/src/components/AppShell.tsx artifacts/studio/src/hooks/useDistanceDraft.ts \
  artifacts/studio/src/lib/formatObjective.ts artifacts/studio/src/main.tsx \
  artifacts/studio/src/__tests__
```

---

### Task 11: Read-path de-hardcoding (no fallback unit)

**Files — exactly the T11 row of the Wave 4 ownership table, nothing else:**
- Modify: `artifacts/studio/src/components/NetworkMap.tsx`, `components/workspace/map/MapLegend.tsx`, `components/workspace/tabs/OutputMapTab.tsx`, `components/workspace/tabs/CostSummaryTab.tsx`, `components/workspace/tabs/JadeAssignmentsTab.tsx`, `components/workspace/tabs/JadeFlowsTab.tsx`, `components/ObjectiveBar.tsx`, `pages/Landing.tsx` (recent-solves rows only)
- Test: the matching `__tests__` files

Also owns the two output grids that were missing from this list (plan-review-4 #3): **`components/workspace/tabs/AssignmentsTab.tsx`** (defaults `distanceUnit = "mi"` at line 107, renders `Distance ({distanceUnit})` at 137) and **`components/workspace/tabs/FlowsTab.tsx`** (hardcodes `Distance (mi)` at line 78), plus `AssignmentsTab.test.tsx` and `FlowsTab.test.tsx`. Both must appear in this task's implementation step, grep guard, gate and commit pathspec.

**Explicitly NOT this task's files:** `DistancesTab`, `LegDistancesTab`, `JadeDistancesTab`, `LaneCostsTab` (T12 owns both their read and write halves); `ServiceStatsTab`, `OptimizationParametersTab`, `SolveDialog`, `JadeBandEditor` (T13 owns both halves). Export **button** wiring in any tab belongs to T11b, not here — T11 changes only distance rendering. **`Studio.tsx` is excluded entirely (dead code).**

- [ ] **Step 1: Failing tests** — spec tests 11b, 12: a delayed-manifest Chen **read** renders a placeholder, never a number or an `mi` label, until the canonical unit is authoritative; non-distance fields (demand, `coverageFloorDemand`, `p`, gap, time, JADE monetary objective) are untouched by the toggle.

- [ ] **Step 2: Replace every `"(km)"`/`"(mi)"` literal and every `distanceUnit === …` / `modelId`-based unit branch** with `useDisplayUnit()`'s `format`. Delete any `?? "mi"` fallback **in this task's own files** (e.g. the `CostSummaryTab` / `JadeFlowsTab` unit props) and gate on "canonical resolved" instead.

> **Do not touch `ServiceStatsTab.tsx`** — it is Task 13's file, both halves (plan-review-3 #2). An earlier draft of this plan used it as the example here; that was a cross-owned instruction and is now corrected. `Workspace.tsx`'s five fallbacks belong to Task 14 Step 6a.

- [ ] **Step 3: Add a grep-guard test** asserting no hardcoded `(km)`/`(mi)` label literal and no `?? "mi"` fallback remains in **this task's** enumerated components — `FlowsTab.tsx:78`'s literal `Distance (mi)` and `AssignmentsTab.tsx:107`'s `distanceUnit = "mi"` default are the two that must specifically disappear.

- [ ] **Step 4: Gate + commit**

```bash
pnpm --filter studio test -- NetworkMap MapLegend OutputMapTab CostSummaryTab JadeAssignmentsTab JadeFlowsTab ObjectiveBar Landing AssignmentsTab FlowsTab
pnpm run typecheck
git commit -m "[T11] route every read-path distance and unit label through useDisplayUnit; no mi fallbacks" -- \
  artifacts/studio/src/components/NetworkMap.tsx \
  artifacts/studio/src/components/workspace/map/MapLegend.tsx \
  artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx \
  artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx \
  artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/AssignmentsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx \
  artifacts/studio/src/components/ObjectiveBar.tsx artifacts/studio/src/pages/Landing.tsx \
  artifacts/studio/src/__tests__
```

---

### Task 11b: Export plumbing — every download control gets `unit` and `runId`

**Files:**
- Create: `artifacts/studio/src/contexts/ExportContext.tsx`
- Modify: `artifacts/studio/src/lib/exportEntity.ts`
- Modify: **the 15 production tab files holding the 24 `downloadEntityExport` calls** — `AssignmentsTab`, `FlowsTab`, `ServiceStatsTab`, `CostSummaryTab`, `OpenWarehousesTab`, `JadeAssignmentsTab`, `DistancesTab`, `LegDistancesTab`, `JadeDistancesTab`, `LaneCostsTab`, `WarehousesTab`, `CustomersTab`, `MinesTab`, `StationsTab`, `PlantsTab`
- Modify: **`JadeFlowsTab.tsx` — the two exceptional client-generated CSV controls** (`handleDownloadPw`, `handleDownloadWc`, built on a local `downloadClientCsv`, lines ~136/210/218). It calls `downloadEntityExport` **nowhere**, so a mechanical helper-conversion would silently leave both JADE flow downloads bypassing server-owned conversion, `unit=`, `runId`, the v3 schema and history addressing (plan-review-5 #3).
- Create: `artifacts/studio/src/__tests__/helpers/renderWithExportProvider.tsx`
- Test: `artifacts/studio/src/__tests__/ExportContext.test.tsx` + **every existing test that renders one of the 16 export-control tabs** — at minimum `AssignmentsTab`, `FlowsTab`, `JadeFlowsTab`, `ServiceStatsTab`, `CostSummaryTab`, `OpenWarehousesTab`, `JadeAssignmentsTab`, `DistancesTab`, `LegDistancesTab`, `JadeDistancesTab`, `LaneCostsTab`, `WarehousesTab`, `CustomersTab`, `MinesTab`, `StationsTab`, `PlantsTab` tests (plan-review-6 #2)

**Why this task exists (plan-review-4 #1).** `downloadEntityExport` takes only `(scenarioId, entity, format)`, and **the export buttons live in the tabs** — **24 direct call sites across 15 production files, plus JADE's two client-generated CSVs** (26 controls total) — not in `Workspace`. T14 owns only `Workspace.tsx` — **`exportEntity.ts` is this task's file** — so T14 cannot reach those controls. Without this task nothing can supply: the effective unit when `pref === "auto"` (needs the model's canonical unit), the displayed history entry's `runId`, or whether *this* control must be disabled because the selected entry is unaddressable.

**Design (locked): a context, not prop-threading.** Prop-threading `{unit, runId, disabledReason}` through 16 components is exactly the per-call-site allowlist this repo keeps regressing on. `Workspace` (T14) populates one `ExportProvider`; every control reads it.

**Interfaces:**
- Consumes: `useDisplayUnit()` (T10).
- Produces — **the single complete contract; Task 14 populates this verbatim** (plan-review-6 #1: an earlier draft declared a non-null `unit`, one `disabledReason` and no `scenarioId` here while Task 14 supplied `null` and two reasons — two incompatible snippets that could not typecheck, and whose `download()` could not call `downloadEntityExport(scenarioId, …)`):

  ```ts
  export type ExportUnit = "km" | "mi" | null;   // null === manifest unresolved

  /** The ten input entities. Exported so classification lives HERE, once —
   *  never as 16 component-local checks. */
  export const INPUT_ENTITIES = [
    "warehouses", "customers", "mines", "stations", "refineries",
    "distances", "laneCosts", "legDistances", "plants", "plantCapabilities",
  ] as const;

  /** The five result entities. INPUT_ENTITIES ∪ RESULT_ENTITIES === ExportEntity. */
  export const RESULT_ENTITIES = [
    "assignments", "openWarehouses", "costSummary", "serviceStats", "flows",
  ] as const;

  export interface ExportApi {
    /** null when no scenario is selected — download() refuses to fire. */
    scenarioId: number | null;
    /** null until the active model's canonical unit resolves — no fallback. */
    unit: ExportUnit;
    /** The displayed history entry's run id; undefined on the latest entry. */
    runId?: number;
    /** Set only for an UNADDRESSABLE historical entry (spec 1g). */
    resultDisabledReason?: string;
    /** Set for ANY historical entry (spec decision 1k). */
    inputDisabledReason?: string;
    /** The one classification point: routes an entity to its family's reason,
     *  and reports the unresolved-state reason ahead of either. */
    disabledReasonFor(entity: ExportEntity): string | undefined;
    download(entity: ExportEntity, format: "csv" | "json"): Promise<void>;
  }
  ```

  `download()` is a **hard guard**: it returns without firing when `scenarioId == null`, `unit == null`, or `disabledReasonFor(entity) != null`. A type-level assertion pins the partition:

  ```ts
  const _exhaustive: ExportEntity[] = [...INPUT_ENTITIES, ...RESULT_ENTITIES];
  ```

- [ ] **Step 1: Failing tests**

```ts
it("appends unit= on EVERY entity, including non-distance ones", () => {});          // spec 14b
it("auto resolves to the model's canonical unit (km for Chen, mi for the rest)", () => {});
it("forced km/mi overrides canonical on every entity", () => {});
it("omits runId on the latest entry", () => {});
it("sends the displayed entry's runId while browsing addressable history", () => {});
it("disables + labels result downloads when the selected entry is unaddressable", () => {});
it("DISABLES every input-entity download while browsing history, addressable or not", () => {});  // spec 1k
it("re-enables every control once the latest entry is selected again", () => {});
it("JadeFlowsTab's two inner tabs download the combined server flows artifact, not a client CSV", () => {});
```
Cover at least one distance output (`assignments`), one input export (`distances`), and one non-distance entity (`warehouses`) across `auto` / forced `km` / forced `mi` / addressable history / unaddressable history.

- [ ] **Step 2: Implement `ExportContext`** — `download()` calls `downloadEntityExport(scenarioId, entity, format, { unit, runId })` with `unit` always appended and `runId` appended only when defined, after the hard guard above. `disabledReasonFor` is the sole family classifier:

```ts
disabledReasonFor(entity) {
  if (scenarioId == null || unit == null) return "Loading…";
  return (INPUT_ENTITIES as readonly string[]).includes(entity)
    ? inputDisabledReason
    : resultDisabledReason;
}
```

`useExport()` **throws without a provider** — that is deliberate, so a missing production mount fails loudly rather than silently exporting canonical units (see Step 4d).

- [ ] **Step 3: Extend `downloadEntityExport`** to `(scenarioId, entity, format, opts?: { unit?: "km"|"mi"; runId?: number })`, appending both as query params.

- [ ] **Step 4: Convert all 24 helper call sites** in the 15 tabs to `useExport().download(entity, format)`. Result-export controls additionally bind `disabled`/label to `disabledReason`.

- [ ] **Step 4b: Replace JADE's two client-generated CSVs (plan-review-5 #3)**

**Delete `downloadClientCsv`, `handleDownloadPw` and `handleDownloadWc`** from `JadeFlowsTab.tsx`. Both inner tabs now download the **combined server `flows` artifact** through `useExport()`. That is the already-correct target: the file's own comment (line ~129) records that the backend serves both legs at once, and the locked v3 JADE flows CSV carries a `leg` column, so the leg-specific client files are redundant *and* they bypass `unit=`/`runId`/v3/versioning. The server contract is **not** expanded with leg-specific artifacts.

```bash
# No .tsx component may call the helper directly — only ExportContext.tsx does,
# and exportEntity.ts is .ts, so this must return NOTHING.
grep -rn "downloadEntityExport(" artifacts/studio/src --include="*.tsx" | grep -v ExportContext.tsx
# JADE's client CSV helpers must be gone entirely — NO matches.
grep -rn "downloadClientCsv\|handleDownloadPw\|handleDownloadWc" artifacts/studio/src
```
Add a guard test asserting **no result CSV is generated client-side** anywhere after this task.

- [ ] **Step 4c: Input exports are disabled while browsing history (spec decision 1k)**

`solve_jobs.result` stores only the run's **result**; its *inputs* snapshot is client-side and unaddressable (spec Part F). An input-entity download at an older index would therefore emit the scenario's **current** inputs while the screen shows a historical snapshot. So `ExportApi` distinguishes the two families:

```ts
// result entities  -> runId addressing; disabled only when the entry is unaddressable
// input  entities  -> DISABLED whenever isBrowsingHistory, with a label
//                     ("input exports reflect the current scenario")
```

- [ ] **Step 4d: Provider test strategy (plan-review-6 #2)**

`useExport()` throwing without a provider is what makes a missing Task 14 mount detectable — so every existing test that renders an export-control tab must now supply one. Locked strategy: **a shared helper, not per-file mocks**, so the real context code is exercised everywhere:

```tsx
// __tests__/helpers/renderWithExportProvider.tsx
export function renderWithExportProvider(ui: ReactElement, overrides: Partial<ExportApi> = {}) {
  return render(<ExportProvider value={{ scenarioId: 1, unit: "mi", ...overrides }}>{ui}</ExportProvider>);
}
```

Migrate every affected tab test to it. Keep one **integration** test asserting that rendering an export control **without** a provider throws — that is the regression guard for the production mount.

- [ ] **Step 5: Gate + commit**

```bash
# The gate must cover every migrated tab test, including JadeFlowsTab (client-CSV
# removal) and an input exporter such as DistancesTab (spec 1k disabling).
pnpm --filter studio test -- ExportContext AssignmentsTab FlowsTab JadeFlowsTab ServiceStatsTab \
  CostSummaryTab OpenWarehousesTab JadeAssignmentsTab DistancesTab LegDistancesTab \
  JadeDistancesTab LaneCostsTab WarehousesTab CustomersTab MinesTab StationsTab PlantsTab
pnpm --filter studio test && pnpm run typecheck
git commit -m "[T11b] route all 26 export controls through ExportContext (24 helper calls in 15 files + JADE's 2 client CSVs)" -- \
  artifacts/studio/src/contexts/ExportContext.tsx artifacts/studio/src/lib/exportEntity.ts \
  artifacts/studio/src/components/workspace/tabs artifacts/studio/src/__tests__
```

---

### Task 12: Write-path draft contract

**Files — exactly the T12 row of the Wave 4 ownership table:**
- Modify: `components/workspace/tabs/DistancesTab.tsx`, `LegDistancesTab.tsx`, `LaneCostsTab.tsx`, `JadeDistancesTab.tsx` — **both halves of each**: the reference/existing-row *display* cells and the edit/add *write* paths
- Test: the matching `__tests__` files

`useDistanceDraft` is **created in T10** and merely consumed here (plan-review-2 #1). `OptimizationParametersTab`, `SolveDialog` and `JadeBandEditor` belong to T13. Export **button** wiring belongs to T11b.

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

- [ ] **Step 2: The hook's contract (implemented in T10 Step 5; this is the normative definition both T12 and T13 code against)**

```ts
export const COMPLETE_NUMBER = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
export const isComplete = (text: string) => COMPLETE_NUMBER.test(text);
```

Toggle: complete → convert text in place; **incomplete → discard** (field reverts to the stored value rendered in the new unit). Commit (blur/Enter): parse, `fromDisplay` from the **current effective unit** → canonical, write, clear. Esc and scenario-switch discard. A draft is therefore always in the unit on screen — `authoredUnit` does not exist.

- [ ] **Step 3: Adopt the hook in this task's FOUR owned editors** — `DistancesTab`, `LegDistancesTab`, `LaneCostsTab`, `JadeDistancesTab` (plan-review-3 #2; an earlier draft said "all six", which reclaimed Task 13's two files). Transport's `laneCostOverrides.cost` values **are** distances and convert. `OptimizationParametersTab` and `SolveDialog` adopt the same hook in **Task 13 Step 3b**.

- [ ] **Step 4: Gate + commit**

```bash
pnpm --filter studio test -- DistancesTab LegDistancesTab LaneCostsTab JadeDistancesTab
pnpm run typecheck
git commit -m "[T12] adopt the display-unit draft contract in the four distance editors (both read and write halves)" -- \
  artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx \
  artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx \
  artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx \
  artifacts/studio/src/__tests__
```

---

### Task 13: Chen band editor + live coverage

**Files — exactly the T13 row of the Wave 4 ownership table:**
- Modify: `components/workspace/tabs/OptimizationParametersTab.tsx` (band editor + its high/max/avg-cap distance inputs), **`components/workspace/SolveDialog.tsx` (its SEPARATE band editor + avg-cap input)**, **`components/workspace/tabs/JadeBandEditor.tsx`**, `components/workspace/tabs/ServiceStatsTab.tsx` (**both halves** — its distance/unit read paths and the Chen coverage guard)
- Test: `__tests__/OptimizationParametersTab.test.tsx`, `SolveDialog.test.tsx`, `JadeBandEditor.test.tsx`, `ServiceStatsTab.test.tsx`
- Create (if the shared editor is extracted): `components/workspace/tabs/BandChipEditor.tsx` + `__tests__/BandChipEditor.test.tsx` — **named here so it is never an unowned file**

**`JadeBandEditor` is a third band write surface (plan-review-4 #4).** Both parents delegate JADE bands to `components/workspace/tabs/JadeBandEditor.tsx`, which defaults `distanceUnit = "mi"` (line 87), holds its **own** `draft` state (line 89), and publishes upward when the 4-tuple is valid rather than on blur/Enter. Editing only the parents cannot deliver the completeness grammar, toggle convert/discard, blur/Enter commit, Esc/scenario-switch discard, or unresolved-unit gating for JADE. It must adopt `useDistanceDraft` like the others.

Its cardinality rules are unchanged — **exactly four, strictly ascending** — but **integrality is dropped by Task 3b**, so a converted value such as `310.6856` is now valid and the editor must accept it. Test the full draft contract under both the canonical and a converted display unit.

This task **consumes** T10's `useDistanceDraft` for its own three files' distance inputs; it does not create it.

**Why `SolveDialog` is in this task (plan-review #5):** it has its own `addBand`/`removeBand` (`SolveDialog.tsx:165-175`), and its `removeBand` is a bare `filter` with **no minimum guard** — re-enabling Chen's editor without touching it would let a user delete the last boundary, violating the locked `minItems: 1` rule, and would leave two band editors free to drift. Prefer **extracting one shared `<BandChipEditor>`** used by both surfaces; including both files in this one serialized task is the acceptable fallback.

Both surfaces must: edit the **dedicated active lens** (never an independent `localInputs.distanceBands` copy), reject non-positive and duplicate additions, **block removal of the last boundary**, apply T12's display-unit draft/commit behavior, and be covered by parallel component tests driven from **one** state source.

> **Ownership note:** `defaultInputsForModel` lives in `Workspace.tsx`, which is **Task 14's** sole-writer file. The default band array `[600,1200,2400,5000]` is therefore changed in **Task 14 Step 2a**, not here. This task owns the editor component and `ServiceStatsTab` only, and its default-bands test asserts against the editor's rendered chips given seeded inputs.

- [ ] **Step 1: Failing tests** — spec tests 1, 3, 5, and the Service Stats half of 7: editor renders for Chen; add/remove works; removal blocked at the last boundary; a high-service edit retargets a band equal to the **old** high (only if present) then dedupes+re-sorts; removing the high band makes later high edits leave bands untouched; add rejects `≤0` and duplicates.

- [ ] **Step 2: Re-enable the editor for Chen**; implement free-band add/remove and the conditional high-link retarget. No maxDist coupling, no locked chip, no prune logic.

- [ ] **Step 3: Wire Chen into `presentationBands` and delete the deliberate Chen guard** (`ServiceStatsTab.tsx:~191-230`) so Chen computes live like its five siblings, cumulative labels plus an `Overflow` row. Chen's `details.coveragePct` KPIs are untouched.

- [ ] **Step 3b: Operationalize the unit rules in this task's three files (plan-review-3 #3)**

The file list claims both halves of these components; these are the steps that actually deliver them.

- **`ServiceStatsTab` — read half.** Every band boundary, distance and unit label routes through `useDisplayUnit()`'s `toDisplay`/`format`. The `serviceStats` boundary is a **distance** and converts; the `OVERFLOW_BAND = -1` row is a categorical sentinel and **never** converts. Delete the `?? "mi"` fallback at `ServiceStatsTab.tsx:27-31`.
- **`OptimizationParametersTab` + `SolveDialog` — write half.** Their distance inputs (high-service, max, avg-cap, and the band-chip add field) adopt **T10's `useDistanceDraft`**: seed from canonical → display, commit display → canonical, discard an incomplete draft on toggle. Non-distance inputs in the same forms (`p`, gap, time-limit, `coverageFloorDemand`) must **not** convert.
- **Unresolved-unit gating, all three files.** No distance value or unit label renders, and no distance editor is enabled, until the canonical unit is authoritative — no fallback anywhere.

Tests:
```ts
it("ServiceStatsTab renders boundaries in the display unit; the -1 overflow row is never converted", () => {});
it("OptimizationParametersTab commits a value typed in mi as canonical km for Chen", () => {});
it("SolveDialog does the same through the identical hook (one state source, not a parallel copy)", () => {});
it("p / gap / timeLimitSec / coverageFloorDemand are untouched by the toggle", () => {});
it.each(["ServiceStatsTab", "OptimizationParametersTab", "SolveDialog"])(
  "%s renders a placeholder and disables editing until the Chen manifest resolves", () => {});
```

- [ ] **Step 4: Gate + commit**

```bash
pnpm --filter studio test -- OptimizationParametersTab SolveDialog JadeBandEditor BandChipEditor ServiceStatsTab
pnpm run typecheck
git commit -m "[T13] Chen free-band editor, live cumulative coverage, and the display-unit contract across all three band surfaces" -- \
  artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx \
  artifacts/studio/src/components/workspace/SolveDialog.tsx \
  artifacts/studio/src/components/workspace/tabs/JadeBandEditor.tsx \
  artifacts/studio/src/components/workspace/tabs/BandChipEditor.tsx \
  artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx \
  artifacts/studio/src/__tests__
```
(Drop the `BandChipEditor.tsx` path if the shared editor is not extracted.)

---

### Task 14: `Workspace.tsx` integration (sole writer, last)

**Files:** modify `artifacts/studio/src/pages/Workspace.tsx`; create `artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx`.

> `exportEntity.ts` is **not** this task's file — **T11b is its sole writer** (plan-review-5 #4). This task only *populates* the provider T11b defines.

This task owns every cross-cutting behavior: the band-lens state, the history action matrix, the dirty-nav prompt, the shared payload builder, `Save as scenario`, and run-id threading.

- [ ] **Step 1: Failing tests** — spec tests 7, 7e, 7g, 7h, 7i, and the client half of 7c/14b. Plus these two written out explicitly, because a spec-group reference is too weak to pin them (plan-review-2 #4/#6):

```ts
it("dirty-nav prompt: a REJECTED Save leaves everything exactly as it was", async () => {
  // ordinaryDirty on the latest entry -> click Back -> prompt -> Save -> mutation rejects.
  expect(resultHistoryIndex()).toBe(indexBeforeClick);   // index unchanged
  expect(localInputsNow()).toEqual(draftBeforeClick);    // ordinary draft unchanged
  expect(stepResultBackEffectFired()).toBe(false);       // no navigation occurred
  expect(screen.getByTestId("save-error")).toBeVisible();// the save error is still reported
});

it("legacy LATEST result stays exportable; the same entry goes non-exportable once it is history", async () => {
  // resultRunId === null while it IS the latest:
  expect(downloadControl()).toBeEnabled();
  expect(lastExportRequest().searchParams.has("runId")).toBe(false);
  // after a newer solve makes it a historical entry:
  expect(downloadControl()).toBeDisabled();
  expect(downloadControl()).toHaveAccessibleDescription(/wasn't retained/i);
});
```

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

- [ ] **Step 5: Dirty-nav prompt (decision 1i)** — guard `stepResultBack`/`stepResultForward` **themselves**, not just the buttons. `ordinaryDirty` → Save / Discard / Cancel before the index changes; `lensDirty` alone never prompts. **A failing Save leaves the index AND the draft unchanged** (plan-review #7) — navigation proceeds only after the save resolves successfully, so a rejected input can never cost the user both the edit and their place.

- [ ] **Step 6: `Save as scenario`** → `{ ...entry.inputs, distanceBands: activeBandLens }` (active **draft** lens).

- [ ] **Step 6a: Remove every `?? "mi"` fallback from `Workspace.tsx` (plan-review-3 #1)**

`Workspace.tsx` holds **five** `activeModelManifest?.distanceUnit ?? "mi"` fallbacks — at the reviewed revision lines **2935, 3311, 3326, 3357, 3599**. Task 11 explicitly excludes this file and Task 14 owns it, so without this step the app's single most important file would keep violating the approved no-fallback rule: a Chen (km) value would transiently render, and could be *committed*, as miles.

```bash
# must return nothing when this step is done
grep -n 'distanceUnit ?? "mi"' artifacts/studio/src/pages/Workspace.tsx
```

Required behavior at all five call sites:
- **Delete the `?? "mi"` fallback outright.** Never substitute another default.
- Derive one `canonicalUnit: "km" | "mi" | null` from `activeModelManifest`; pass it to a child **only once it is authoritative** (non-null).
- While it is `null`, **gate both halves**: distance reads render the loading placeholder (no number, no unit label) and distance editors are disabled — matching the rule Tasks 11/12/13 apply in their own files.

Tests (delayed-manifest, Chen):
```ts
it("renders no distance value and no unit label until the Chen manifest resolves", () => {});
it("disables every distance editor until the Chen manifest resolves", () => {});
it("never labels or commits a Chen km value as mi at any point during manifest load", () => {});
```

- [ ] **Step 7a: Mount `UnitToggle` in the workspace header** — the counterpart of Task 10's `AppShell` mount (plan-review #3). Task 10 owns the Landing header; this task owns the model-page header because `Workspace.tsx` renders its own and is this task's sole-writer file.

- [ ] **Step 7b: Mount and populate `ExportProvider` (plan-review-5 #4)**

T11b defines the provider; nothing mounts it without this step. `Workspace` wraps its tab area and supplies the state only it has:

```ts
// `unit` is null until the model manifest resolves — export controls are
// DISABLED in that state, never given a fallback (the same no-fallback rule
// Step 6a applies to every other distance path).
const canonicalUnit = activeModelManifest?.distanceUnit ?? null;   // "km" | "mi" | null
const exportValue: ExportApi = {
  scenarioId: currentScenario?.id ?? null,        // null => download() refuses to fire
  unit: canonicalUnit == null ? null : effectiveUnit(pref, canonicalUnit),
  runId: isBrowsingHistory ? displayedEntry?.runId : undefined,
  resultDisabledReason: isBrowsingHistory && displayedEntry?.runId == null
    ? "This solve's result wasn't retained"
    : undefined,
  inputDisabledReason: isBrowsingHistory
    ? "Input exports reflect the current scenario"      // spec decision 1k
    : undefined,
};
```

This object matches T11b's `ExportApi` **exactly** — `scenarioId`, `unit: ExportUnit`, `runId`, both family reasons; `disabledReasonFor` and `download` come from the provider itself. `download()` refuses to fire while `scenarioId` or `unit` is `null`.

Tests:
```ts
it("passes the effective unit (auto -> canonical; forced km/mi overrides)", () => {});
it("passes runId only while browsing history, never on the latest entry", () => {});
it("sets resultDisabledReason only for an unaddressable historical entry", () => {});
it("sets inputDisabledReason for ANY historical entry", () => {});
it("disables export controls entirely while the manifest is unresolved (no fallback unit)", () => {});
it("passes scenarioId, and disables everything when no scenario is selected", () => {});
it("supplies a value matching ExportApi exactly (shape assertion, not a subset)", () => {});
```

- [ ] **Step 7: Run-id threading** — `ResultHistoryEntry` gains `runId?: number`; the seed takes `currentScenario.resultRunId`; a new solve attaches the polling job id **independently of `timing`**; **an entry with no `runId` is non-exportable ONLY once it is no longer the latest** (plan-review #4). A legacy *latest* result must still export through the existing latest-result path with `runId` omitted — the spec's Part F rule is narrower than "any null runId is disabled". Lock it as:

```ts
// Non-exportable only when we are BROWSING HISTORY and this entry has no
// addressable run. A legacy latest result stays exportable via the
// latest-result path (runId omitted) exactly as before this bundle.
const unaddressableHistoricalEntry = isBrowsingHistory && entry.runId == null;
```

Disable and label the download in **that** state only. Test **both** branches: legacy entry while it is latest → export request fires with **no** `runId`; the same entry after a newer solve → download disabled + labelled. The `downloadEntityExport` signature change itself belongs to **T11b**; this task only feeds the provider.

- [ ] **Step 8: Gate + commit**

```bash
pnpm --filter studio test -- Workspace DirtyNavPrompt
pnpm run typecheck && pnpm --filter studio test
git commit -m "[T14] Workspace integration — band lens, history action matrix, dirty-nav prompt, shared payload builder, ExportProvider, run-id threading" -- \
  artifacts/studio/src/pages/Workspace.tsx \
  artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx \
  artifacts/studio/src/__tests__
```

### Task 15: QA — real browser (standing plan rule)

**Files:** create `artifacts/studio/e2e/chen-bands-units.spec.ts`.

Dispatch to `qa-sdet`. Run against real local dev servers (api-server + studio with `API_PROXY_TARGET`), **excluding `labs.spec.ts`** (known pre-D0 debt).

- [ ] **Step 1: Cover, for real** — Chen band add/remove + live recolor + overflow; the high-link retarget; lens Save while browsing history leaving other inputs untouched; the dirty-nav prompt's three outcomes; Run Optimizer disabled in history; `Save as scenario` carrying the on-screen lens; the unit toggle converting inputs *and* outputs with persistence across reload; the `5.`-toggle draft-discard; a historical export matching the displayed tab; and — stronger than "two files differ" (plan-review #7) — a full **input** round trip (export `distances` at `unit=mi` → edit a value → re-import → the stored canonical value matches within `abs ≤ 0.001 / rel ≤ 1e-5`) plus **output** downloads at both `unit=km` and `unit=mi` whose distance columns differ by exactly the conversion factor while the overflow sentinel stays `-1`.

- [ ] **Step 2: Run twice green.** Report product bugs back rather than fixing them inside the QA task.

- [ ] **Step 3: Full final gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && pnpm --filter @workspace/units test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x) \
  && (cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```
Expected: all green; **`e2e_accuracy.py` 99/99 unmodified**; the default Chen scenario still solves to 66.0639%.

- [ ] **Step 4: Commit**

```bash
git commit -m "[T15] real-browser QA for Chen bands, the unit toggle, history actions and export round-trips" -- \
  artifacts/studio/e2e/chen-bands-units.spec.ts
```

---

## Post-merge

Run `/harness-retro chen-bands-units` — a branch is not finished until it has.

**Deploy is outward-facing:** surface the deploy step and get explicit confirmation before triggering. Note that `autoDeploy` does **not** fire for this repo — both `nos-api` and `nos-studio` need a manual `trigger_deploy`.

## Known out-of-scope items (recorded, deliberately not fixed here)

- Gold's generic `buildAssignmentRows` maps **all** edges with no leg filter, so its assignments export includes `mine_to_refinery` rows. Pre-existing defect; this bundle changes only the `band` value, never a row source.
- Restoring an older entry's inputs (the behavior decision 1h removes) would need its own explicit action. `Save as scenario` covers the real use case.
- JSON import remains out of scope — import stays CSV-only.

---

## Appendix — approval re-review comments (2026-09-20, `2f69f76`, verbatim; all folded into the tasks above)

**Original decision: NOT APPROVED.** *(All eight are now folded into the normative tasks — see the per-item `plan-review #N` markers throughout.)* The plan is directionally strong, but the following blockers and high-severity contract gaps must be folded into the normative tasks before implementation begins.

### 1. BLOCKER — `@workspace/units` is not wired into the monorepo

Task 1 creates and commits only `lib/units`. That is insufficient under this repository's pnpm and TypeScript-project setup. Task 1 must also:

- add `"@workspace/units": "workspace:*"` to both `artifacts/studio/package.json` and `artifacts/api-server/package.json`;
- add `./lib/units` to the root `tsconfig.json` project references so `pnpm run typecheck:libs` actually checks it;
- run `pnpm install` and commit the resulting `pnpm-lock.yaml`; and
- include those files in Task 1's explicit commit pathspec.

Without this wiring, consumer imports may fail under pnpm's strict workspace resolution and the advertised root typecheck does not validate the new library.

### 2. BLOCKER — the frontend would retain a second band implementation

The approved spec requires Studio to re-export the shared band classifier so frontend and backend cannot drift. The plan never assigns a task to modify `artifacts/studio/src/lib/bands.ts`, which currently owns separate definitions of `OVERFLOW_BAND`, `assignBandOrOverflow`, `bandLabel`, and `computeCumulativeBandCoverage` and is still imported by `NetworkMap` and `ServiceStatsTab`.

Add an explicit file owner and step that imports/re-exports the locked functions from `@workspace/units` (aliasing `bandLabelOrOverflow` to the existing frontend name if desired). Retain locally only genuinely frontend-specific helpers such as the legacy exclusive coverage function. Add a guard test proving map, Service Stats, and API export resolve the shared implementation rather than duplicate copies.

### 3. BLOCKER — Wave 4 has conflicting writers and incomplete toggle placement

The dependency map declares Task 13 parallel with Tasks 11/12, but the tasks overlap:

- Tasks 11 and 13 both modify `ServiceStatsTab.tsx`;
- Tasks 12 and 13 both modify `OptimizationParametersTab.tsx`; and
- Tasks 12 and 13 also need coordinated ownership of `SolveDialog.tsx` once Chen's band editor is restored.

This contradicts the plan's single-writer rule. Serialize these tasks or split their file ownership into genuinely disjoint commits.

Task 10 also says to render `UnitToggle` in the app header on model screens and Landing, but its file list includes neither header owner. Landing is wrapped by `AppShell.tsx`, while workspace-enabled model pages render their own header in `Workspace.tsx`, which is reserved for Task 14. Assign the Landing mount to `AppShell.tsx` in Task 10 and the model-page mount explicitly to Task 14 (or define another conflict-free ownership split).

### 4. HIGH — legacy latest-result export is incorrectly disabled

Task 14 currently says that any history entry without a `runId` renders its download disabled. The approved Part F contract is narrower: a null-`runId` entry is non-exportable only **once it is no longer the latest**. A legacy latest result must remain exportable through the existing latest-result path with `runId` omitted.

Lock the UI rule as:

```ts
const unaddressableHistoricalEntry = isBrowsingHistory && entry.runId == null;
```

Disable and label the download only in that state. Add both branches to the client test: legacy latest → export request without `runId`; the same entry after a newer solve → disabled and labelled.

### 5. HIGH — the Chen rules do not cover `SolveDialog`'s band editor

Task 13 owns only `OptimizationParametersTab.tsx` and `ServiceStatsTab.tsx`, while `SolveDialog.tsx` has a separate band editor and separate add/remove implementation. Its current `removeBand` permits deleting the last boundary. Simply re-enabling that editor for Chen would violate the locked `minItems: 1` UI rule and leave the two surfaces free to drift.

Either extract one shared band-editor component or include `SolveDialog.tsx` in the same serialized task. Both surfaces must:

- edit the dedicated active lens rather than an independent `localInputs.distanceBands` copy;
- reject non-positive and duplicate additions;
- block removal of the last boundary;
- apply the same display-unit draft/commit behavior; and
- be covered by parallel component tests against one state source.

### 6. HIGH — the OpenAPI export-envelope version variants are underspecified

Task 5 describes replacing `ExportEnvelope` with exact v3 output shapes, but the same endpoint also returns v1 non-distance entities and v2 importable distance entities. A single `templateVersion: 3`/unit-bearing envelope would misdescribe most of the export surface.

Specify the OpenAPI representation explicitly, preferably as entity/version-specific schemas composed through `oneOf`:

- v1 non-distance envelopes, with no invented unit and byte-identical output;
- v2 `distances`/`legDistances`/`laneCosts` envelopes with `unit` on the envelope and exact rows; and
- the six exact v3 output variants from the spec.

Preserve the entity-specific CSV contracts separately. Generated schemas/examples must assert `1`, `2`, or `3` according to the locked version matrix rather than applying v3 globally.

### 7. MEDIUM — required verification cases are missing or only implied

Add explicit test steps for:

- Chen create, whole-input PATCH, and import-apply preserving a supplied band array and deriving `[high,max]` only when omitted;
- deleting a solved scenario still returning 204→404 with the circular FK in place, including `ON DELETE SET NULL` behavior;
- omitted `runId` retaining the unchanged latest-export behavior;
- the full six-model objective mapping under both units through the API-server runtime, not only the pure package/frontend wrapper;
- the field-scoped route returning a Scenario containing the new bands;
- the dirty-navigation Save failure leaving the index and draft unchanged;
- both band-editor surfaces enforcing the same minimum/add/remove rules; and
- real-browser input export→import round trips as well as output downloads at `unit=km` and `unit=mi`.

The final Playwright step currently proves only that two export files differ; that is weaker than the spec's input-and-output round-trip gate.

### 8. MEDIUM — executable references and the circular-FK instruction need correction

- The existing Studio files are `artifacts/studio/src/lib/formatObjective.ts` and `artifacts/studio/src/__tests__/formatObjective.test.ts`, not `objectiveFormat.ts` / `objectiveFormat.test.ts`.
- `@workspace/api-spec` exposes the script `codegen`, not `generate`; use `pnpm --filter @workspace/api-spec codegen`.
- Task 2 says to use Drizzle's callback form if the new back-reference creates an import cycle, but its shown `.references(() => solveJobsTable.id)` is already callback form. Specify the actual circular-schema solution, including an explicit `AnyPgColumn` callback return type where TypeScript inference requires it, then prove it with `pnpm run typecheck`, `drizzle-kit push`, FK introspection, and the scenario-deletion integration test.

### Re-review exit criteria

Approval requires all eight comments to be folded into the task file lists, dependency map, commands, and acceptance tests—not merely acknowledged in this appendix. Re-run `git diff --check` after the rewrite and re-review the resulting task graph against the approved design before implementation starts.

---

## Appendix — second approval re-review comments (2026-09-20, `39e76ef`, verbatim; all folded into the tasks above)

**Original decision: NOT APPROVED.** *(All six are now folded into the normative plan — see the per-item `plan-review-2 #N` markers throughout.)* Most first-review findings were addressed, but the following corrections were only partially folded into the normative plan.

### 1. BLOCKER — Wave 4 is still not file-disjoint or executable in parallel

The Wave 4 ownership table assigns the shared draft hook to T12 and says T13 applies that hook, so T13 depends on T12 and cannot run alongside it. The detailed task inventories also still contradict the ownership table:

- T11 still claims `DistancesTab`, `LegDistancesTab`, `JadeDistancesTab`, and `ServiceStatsTab`;
- T12 still claims `OptimizationParametersTab` and `SolveDialog`; and
- T13 claims `OptimizationParametersTab`, `SolveDialog`, and `ServiceStatsTab` while consuming the hook created by T12.

Make T12 precede T13, or move creation of the shared hook into an earlier task that both can consume. Rewrite the T11/T12/T13 file inventories and implementation steps to match the ownership table exactly. Components containing both read and write paths must have one owner that implements **both** halves; broad wording such as "every reachable component" must not silently reclaim another task's files.

### 2. HIGH — the OpenAPI envelope rule contradicts its v1 table

Task 5's v1 row correctly states that unitless envelopes have no `unit` property, but the immediately following general rule says every envelope carries `templateVersion + unit`. Scope the placement rule explicitly:

- v1 envelopes carry `templateVersion` and `entity`, with **no** `unit`;
- v2/v3 envelopes carry `templateVersion`, `entity`, and `unit`; and
- rows in every family carry neither envelope-level field.

The generated-schema fixtures must prove the absence of `unit` on v1, not merely its presence on v2/v3.

### 3. HIGH — Task 3's new route tests would not be committed

Task 3 Step 5b adds create/PATCH/import-apply tests, but the task's file list names only `chens.test.ts`, its explicit commit path includes only the validator directory and manifest, and no test gate runs after Step 5b.

Add the concrete route/import test files to Task 3's `Files` section and explicit commit pathspec. Run the API test suite **after** the Step 5b tests are added. The task must not finish with those tests untracked or outside its commit.

### 4. MEDIUM — Task 2 shows invalid package subpath imports

The schema test imports `@workspace/db/schema/solve_jobs` and `@workspace/db/schema/scenarios`, but `@workspace/db` exports only `.` and `./schema`. Replace the snippet with the real public import:

```ts
import { solveJobsTable, scenariosTable } from "@workspace/db/schema";
```

Do not leave an invalid concrete snippet followed by a note telling the implementer to discover the correct form.

### 5. MEDIUM — the T1b guard test contains an invalid TypeScript cast and does not identity-check the label alias

`(studioBands as never)[name]` cannot be safely indexed. Use a typed record, direct assertions, or a helper whose key type is the intersection of both module surfaces. For example:

```ts
const studioShared = studioBands as Record<string, unknown>;
const packageShared = sharedUnits as Record<string, unknown>;
expect(studioShared[name]).toBe(packageShared[name]);
```

The label assertion should also prove binding identity rather than only equal output:

```ts
expect(studioBands.bandLabel).toBe(sharedUnits.bandLabelOrOverflow);
```

That makes the test enforce the stated "no copied implementation" rule for all four shared exports.

### 6. MEDIUM — dirty-navigation Save failure is specified but not explicitly added to the test list

Task 14 now states the correct behavior—a failing Save leaves the history index and ordinary draft unchanged—but its failing-test step only references broad spec groups. Add an explicit test case that rejects the prompt's Save mutation and asserts:

- the selected history index is unchanged;
- the ordinary draft is unchanged;
- no navigation occurs; and
- the existing save error remains visible/reported.

### Second re-review exit criteria

Approval requires these six comments to be folded into the normative dependency map, file lists, code snippets, commit pathspecs, and explicit tests. Remove the stray empty fenced block beneath the Wave 4 ownership table while editing, then run `git diff --check` and perform another approval review against the approved design.

---

## Appendix — third approval re-review comments (2026-09-20, `7775903`, verbatim; all folded into the tasks above)

**Original decision: NOT APPROVED.** *(All five are now folded — see the per-item `plan-review-3 #N` markers throughout.)* The six second-review findings were substantially addressed, the worktree was clean, and `git diff --check 39e76ef..7775903` passed. The following remaining execution and ownership gaps must be folded into the normative tasks before implementation begins.

### 1. BLOCKER — `Workspace` unit fallbacks remain unowned

`Workspace.tsx` currently contains five `activeModelManifest?.distanceUnit ?? "mi"` fallbacks (at the reviewed revision: lines 2935, 3311, 3326, 3357, and 3599). These conflict with the approved design's rule that no distance value or label renders, and no distance write is enabled, until the authoritative model unit resolves.

Task 11 excludes `Workspace.tsx`. Task 14 owns it, but does not explicitly remove these fallbacks or define the unresolved-unit behavior at these call sites. Add a Task 14 requirement to:

- remove every `?? "mi"` fallback from the `Workspace` distance paths;
- pass the resolved canonical unit to each child only after it is authoritative;
- gate all affected distance reads and writes while the manifest is unresolved; and
- add delayed-manifest tests proving that Chen values are never transiently displayed, labelled, or committed as miles before its canonical unit resolves.

### 2. HIGH — the detailed Task 11/12 instructions still contradict the Wave 4 ownership table

The ownership table is now file-disjoint, but stale detailed instructions reclaim other tasks' files:

- Task 11 Step 2 cites `ServiceStatsTab.tsx` as its fallback-removal example, although that file belongs exclusively to Task 13.
- Task 12 Step 3 says to adopt the hook in "all six editors", although Task 12 owns only `DistancesTab`, `LegDistancesTab`, `LaneCostsTab`, and `JadeDistancesTab`. `OptimizationParametersTab` and `SolveDialog` belong to Task 13.

Replace the Task 11 example with one of its owned components. Limit Task 12 explicitly to its four owned editors. State in Task 13 that it adopts `useDistanceDraft` in its two editor surfaces and owns the complete read/write behavior of `ServiceStatsTab`.

### 3. HIGH — Task 13's unit responsibilities are listed but not operationalized

Task 13's file list mentions both halves of `ServiceStatsTab` and the distance inputs in `OptimizationParametersTab` and `SolveDialog`, but its normative steps cover the band editor, high-distance link, and coverage behavior without explicitly implementing those files' display conversion, draft conversion, unresolved-unit gating, or fallback removal.

Add explicit Task 13 implementation steps and tests for:

- display-value and label conversion in `ServiceStatsTab`;
- display-to-canonical draft conversion in `OptimizationParametersTab` and `SolveDialog` through `useDistanceDraft`;
- no fallback labels or values before the canonical unit resolves; and
- delayed-manifest behavior for both of Task 13's editing surfaces and the Service Stats read surface.

### 4. MEDIUM — Task 10 promises hook tests without naming or committing a test file

Task 10 says `useDistanceDraft` ships with its own unit tests, but its `Files` list names only the hook and the `UnitContext`/`formatObjective` tests. No concrete hook-test path is included in the task's commit scope or gate.

Add a concrete test file such as `artifacts/studio/src/__tests__/useDistanceDraft.test.ts` to Task 10's `Files` list and explicit commit pathspec. Its test step must cover canonical-to-display seeding, display-to-canonical commit, unit-toggle draft discard/reseed, invalid partial drafts, and unresolved-unit gating, and the file must be exercised by Task 10's test command.

### 5. MEDIUM — Task 3 assigns import-apply behavior to a misleading test target

Task 3 lists `artifacts/api-server/src/__tests__/import.test.ts` for the import-apply case, but that file exercises the import service/parser rather than route application. The create/PATCH/import-apply contract needs a route-level or round-trip test that proves the imported bands reach scenario storage.

Place the import-apply assertion in `routes.test.ts` or `importMultiModelRoundTrip.test.ts`, then make the `Files` list, commit pathspec, and post-Step-5b gate name that actual test target. Keep `import.test.ts` only if this task also changes and tests parser behavior there.

### Third re-review exit criteria

Approval requires all five comments to be folded into the normative file ownership, detailed task steps, test-file inventories, commit pathspecs, and explicit gates—not merely acknowledged in this appendix. Run `git diff --check`, verify that Tasks 11–13 contain no cross-owned examples or instructions, search `Workspace.tsx` for every distance-unit fallback, and re-review the resulting plan against the approved no-fallback design before implementation starts.

---

## Appendix — fourth approval re-review comments (2026-09-20, `afa2545`, verbatim; all folded into the tasks above)

**Original decision: NOT APPROVED.** *(All five are now folded — see the per-item `plan-review-4 #N` markers throughout; #2 was resolved by an explicit decision to relax the schemas, now Task 3b.)* The five third-review findings are correctly folded into the normative tasks, the worktree was clean, and `git diff --check 7775903..afa2545` passed. The broader approval pass found the following two blockers and three execution gaps.

### 1. BLOCKER — export `unit` and `runId` cannot reach the actual download buttons

Task 14 owns only `Workspace.tsx`, `exportEntity.ts`, and `DirtyNavPrompt.tsx`, then says `downloadEntityExport` gains the current display unit and historical `runId`. In the current application, however, **15 component files contain 24 direct calls** to `downloadEntityExport`; those controls invoke the helper themselves rather than delegating through `Workspace`.

The helper currently receives only `scenarioId`, `entity`, and `format`. It cannot derive:

- the effective unit for `pref === "auto"` without the active model's canonical unit;
- the displayed history entry's `runId`; or
- whether an unaddressable historical entry must disable and label that particular download control.

Define one executable propagation design and assign every affected file. Acceptable examples are an export context/hook populated by `Workspace`, or explicit `{ unit, runId, disabledReason }` props threaded to each export control. Whichever design is chosen must:

- update all 15 call-site components, not only the distance-bearing subset, because the approved spec requires `unit=` on **every** invocation;
- pass the displayed entry's `runId` to every result-export control and omit it only on the latest path;
- disable and label every affected result download when the selected historical entry is unaddressable;
- include the concrete files in Wave 4 ownership, task inventories, tests, and explicit commit pathspecs; and
- test at least one distance output, one input export, and one non-distance entity under `auto`, forced `km`/`mi`, addressable history, and unaddressable history.

### 2. BLOCKER — converted band drafts conflict with the unchanged integer schemas

Task 13 requires band editors to commit display values back to canonical values through `useDistanceDraft`. For a canonical-mile model, entering `500 km` converts to `310.6856 mi`. The existing non-Chen validators reject that value because their band schemas remain integer-only:

- `pMedian.ts`: `z.number().int().positive()`;
- `transportLp.ts`: `z.number().int().positive()`;
- `twoEchelon.ts`: `z.number().int().positive()`; and
- `jadeInputs.ts`: exactly four strictly ascending positive integers.

The plan cannot simultaneously promise arbitrary app-wide display-unit editing, exact conversion back to canonical, and unchanged integer band validation. Lock one policy in the normative design and plan: relax the sibling schemas to positive numbers, round canonical bands by an explicit deterministic rule, reject non-integral canonical conversions with clear UX, or restrict band editing to the canonical display unit. Then enumerate every affected validator/manifest/editor and add round-trip plus boundary tests. Do not leave this to implementation judgment.

### 3. HIGH — reachable `AssignmentsTab` and `FlowsTab` are absent from unit ownership

Task 11's supposedly exact read-surface list omits two reachable output grids:

- `AssignmentsTab.tsx` defaults `distanceUnit` to `"mi"` and renders `Distance ({distanceUnit})`.
- `FlowsTab.tsx` hardcodes `Distance (mi)`.

The approved design requires every distance label, KPI, table cell, map popup, and output grid to use the display-unit contract. Add `AssignmentsTab.tsx`, `FlowsTab.tsx`, and their matching tests to T11's ownership row, file list, implementation step, grep guard, gate, and commit pathspec.

### 4. HIGH — `JadeBandEditor` is an unowned write surface

T13 owns `OptimizationParametersTab` and `SolveDialog`, but both delegate JADE bands to `JadeBandEditor.tsx`, which is absent from every task inventory. That child defaults to `"mi"`, owns its own raw drafts, and publishes a valid array on every keystroke rather than committing on blur/Enter. Editing only the parents cannot implement the approved completeness grammar, toggle conversion/discard, blur/Enter commit, Esc/scenario-switch discard, or unresolved-unit gating for the JADE editor.

Assign `JadeBandEditor.tsx` and `JadeBandEditor.test.tsx` to exactly one Wave 4 task—most naturally T13, alongside both parents. Specify how its fixed-four/integer rules interact with the policy chosen for comment 2, and add the full draft-contract tests under canonical and converted display units.

If T13 extracts the suggested shared `BandChipEditor`, name the new component and test files explicitly in its inventory and commit pathspec; do not leave an optional unnamed file outside the ownership table.

### 5. MEDIUM — the final frontend tasks still lack executable gates and commit pathspecs

Tasks 11, 12, 13, and 14 end with only `Gate + commit`, while Task 15 ends with only `Commit`. No targeted command, commit message, or explicit pathspec is provided. This conflicts with the plan's global one-task/one-commit rule and its branch-discipline requirement that every commit use `git commit ... -- <paths>`.

For Tasks 11–15, add:

- the concrete targeted test command(s) that exercise the task's named tests;
- the required typecheck or broader suite where appropriate;
- the exact `[Tn]` commit message; and
- an explicit pathspec containing every production and test file owned by that task, including the export-call-site files added for comment 1.

### Fourth re-review exit criteria

Approval requires all five comments to be folded into the normative architecture, Wave 4 ownership table, task file lists, detailed steps, tests, gates, and commit pathspecs—not merely acknowledged here. Before re-review, enumerate all `downloadEntityExport(` call sites and prove each receives the effective unit and correct history addressing state; enumerate every editable band surface and reconcile display conversion with the backend integer contracts; run `git diff --check`; then re-review the complete task graph against Parts D–F of the approved design.

---

## Appendix — fifth approval re-review comments (2026-09-20, `e6723bb`, verbatim; all folded into the spec and tasks above)

**Original decision: NOT APPROVED.** *(All six folded — see `plan-review-5 #N` markers; #1 and #2 required spec amendments, committed as `0faa98b`.)* The fourth-review findings were substantially addressed, the worktree was clean, and `git diff --check afa2545..e6723bb` passed. The revision introduces the following two blockers and four execution/consistency gaps.

### 1. BLOCKER — Task 3b contradicts the normative spec and a global hard rule

Task 3b relaxes every sibling model's `distanceBands` from integers to positive numbers. The plan cannot authorize that change while both of these statements remain normative:

- The approved spec's Part G says JADE's cardinality/**integer** rules are unchanged.
- This plan's Hard rule #2 says the Chen manifest is the only `solvers/` edit anywhere in the bundle.

The plan also states that the spec wins whenever plan and spec disagree. An implementer following that instruction must reject Task 3b's JADE change, while an implementer following Task 3b must violate the spec and the plan's global constraint.

First amend the normative spec to record the selected positive-number policy for every affected model, including Part G, the write-path contract, required tests, and any resolution text that preserves integer rules. Then update Hard rule #2 and enumerate the exact sibling manifest paths—`p-median-us`, `p-median-brazil`, `transport-coal`, `two-echelon-gold-au`, and `two-echelon-jade-us`—rather than using `solvers/*` or a broad `solvers` commit pathspec.

### 2. BLOCKER — historical input exports cannot match the displayed history entry

Task 11b explicitly leaves input-entity downloads enabled on an unaddressable historical entry and sends the selected `runId` when one exists. But the persisted `solve_jobs` row contains only the run's **result envelope**. The stepper's historical `inputs` snapshot remains client-side and is not addressable by the export route.

Consequently, a user viewing historical inputs can click a `distances`, `legDistances`, or `laneCosts` download and receive the scenario's current saved inputs rather than the inputs displayed on screen. Supplying `runId` cannot repair this because no historical inputs are stored behind that id.

Choose one executable contract and reflect it in the spec, context, controls, and tests:

- disable and label every input-entity export whenever `isBrowsingHistory` is true; or
- persist/address each run's inputs and make the server export those historical inputs.

Do not keep input downloads silently enabled with current-scenario semantics while the screen displays a historical snapshot.

### 3. HIGH — the export inventory is incorrect and misses JADE's client-generated exports

The repository has **24 direct `downloadEntityExport` calls across 15 tab files**, plus **two client-generated CSV controls** in `JadeFlowsTab.tsx` (`handleDownloadPw` and `handleDownloadWc`). Task 11b instead claims 25 direct calls across 16 files and instructs the implementer only to convert `downloadEntityExport` calls.

Because `JadeFlowsTab` never calls that helper today, the stated mechanical conversion can leave both JADE flow downloads on `downloadClientCsv`, bypassing the locked server-owned conversion, `unit=`, `runId`, v3 schema, and historical-addressing behavior.

Correct the inventory to 15 helper-calling files / 24 helper calls plus the two exceptional JADE controls. Explicitly remove or replace `downloadClientCsv`, `handleDownloadPw`, and `handleDownloadWc`. Also lock the resulting UX: either both inner tabs download the combined server `flows` artifact, or the server contract is deliberately expanded to preserve leg-specific artifacts. Add a guard/test proving no result CSV is generated client-side after this task.

### 4. HIGH — `ExportProvider` is designed but never mounted

Task 11b says `Workspace` populates one `ExportProvider`, but Task 14 has no step that imports, mounts, or populates it. Task 14 also still lists `exportEntity.ts` as one of its files and repeats the instruction that `downloadEntityExport` gains `runId`/`unit`, even though T11b now owns and commits that file.

Add an explicit Task 14 provider-integration step and tests that lock:

```ts
unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
runId = isBrowsingHistory ? displayedEntry.runId : undefined;
disabledReason = isBrowsingHistory && displayedEntry.runId == null
  ? "This solve's result wasn't retained"
  : undefined;
```

While `unit` is unresolved, export controls must be disabled rather than receiving a fallback. Define the context type/state for that condition. Remove `exportEntity.ts` from Task 14's Files list and remove the stale helper-change instruction so T11b remains its sole writer.

### 5. MEDIUM — Task 3b's tests assert invariants its implementation does not provide

The p-median, transport, and two-echelon schemas currently require only an array of positive integers; unlike JADE and the new Chen contract, they do **not** reject duplicates or non-ascending band arrays. Task 3b says those cases "still reject", but Step 3 only removes `.int()` and adds no ordering/uniqueness refinement.

Choose explicitly:

- preserve the sibling models' actual existing behavior and test only positivity/non-integral acceptance; or
- add unique/strict-ascent validation to those schemas and manifests as a deliberate new contract change, with corresponding spec text and compatibility tests.

The failing-test list and implementation steps must describe the same behavior.

### 6. MEDIUM — the Task 15 heading was removed

After Task 14's commit block, the document jumps directly to `**Files:** create artifacts/studio/e2e/chen-bands-units.spec.ts` without a `### Task 15` heading. Restore `### Task 15: QA — real browser (standing plan rule)` so the browser suite, final gate, and `[T15]` commit remain a distinct task rather than appearing to be part of Task 14.

### Fifth re-review exit criteria

Approval requires all six comments to be folded into the normative spec and plan where applicable—not merely acknowledged here. Reconcile the sibling band-number policy with the approved spec and global constraints; define honest historical input-export behavior; inventory all 26 export controls including JADE's two client CSV handlers; mount and test `ExportProvider` from `Workspace`; align Task 3b's tests with its implementation; restore the Task 15 boundary; run `git diff --check`; and re-review the resulting task graph before implementation begins.

---

## Appendix — sixth approval re-review comments (2026-09-20, `9416bd9`, verbatim; all folded into the tasks above)

**Original decision: NOT APPROVED.** *(All three folded — see `plan-review-6 #N` markers.)* The six fifth-review findings are resolved in both the spec and plan, the worktree was clean, and `git diff --check e6723bb..9416bd9` passed. The new export-context contract still has one implementation blocker plus two execution inconsistencies.

### 1. BLOCKER — `ExportApi` and the Task 14 provider value are incompatible

Task 11b declares an `ExportApi` with:

- `unit: "km" | "mi"` (non-null);
- one `disabledReason?: string`;
- no `scenarioId`; and
- `download(entity, format)` with no scenario argument.

Task 14 supplies a different object:

- `unit: "km" | "mi" | null` while the manifest is unresolved;
- `resultDisabledReason` and `inputDisabledReason`, neither declared by `ExportApi`; and
- still no source for `scenarioId`.

At the same time, `downloadEntityExport` still requires `(scenarioId, entity, format, opts)`. The proposed context cannot typecheck and its `download()` method cannot call the helper.

Define one complete contract in T11b and make Task 14 use it verbatim. For example:

```ts
type ExportUnit = "km" | "mi" | null;

interface ExportApi {
  scenarioId: number | null;
  unit: ExportUnit;
  runId?: number;
  resultDisabledReason?: string;
  inputDisabledReason?: string;
  disabledReasonFor(entity: ExportEntity): string | undefined;
  download(entity: ExportEntity, format: "csv" | "json"): Promise<void>;
}
```

An equivalent provider-props design is acceptable, but it must explicitly lock:

- where `scenarioId` comes from and what happens when no scenario is selected;
- `unit === null` while the manifest is unresolved;
- `download()` refusing to fire when `scenarioId`/`unit` is unresolved or the entity is disabled;
- one central entity-family classification, not 16 component-local checks; and
- the exact ten input entities (`warehouses`, `customers`, `mines`, `stations`, `refineries`, `distances`, `laneCosts`, `legDistances`, `plants`, `plantCapabilities`) versus the five result entities (`assignments`, `openWarehouses`, `costSummary`, `serviceStats`, `flows`).

Tests must assert the complete value shape passed by `Workspace`, the guard behavior, and both entity families. Do not leave the provider value and public interface as two incompatible snippets.

### 2. HIGH — Task 11b does not account for all affected component tests

All 16 export-control components will begin calling `useExport()`, but Task 11b's Files section names only `ExportContext.test.tsx` plus six existing tab tests. Existing component tests render these tabs directly. If `useExport()` requires a provider—as it should to catch a missing production mount—every affected test needs an `ExportProvider` wrapper or a deliberate context mock. If the context silently supplies a no-provider default, the plan must specify that behavior and explain how the Task 14 mount regression remains detectable.

Choose one test strategy and enumerate it:

- add a shared `renderWithExportProvider` test helper and migrate all affected tab tests; or
- mock `useExport()` consistently in all affected tests while keeping an integration test that throws/fails without the provider.

The T11b gate must execute the complete affected test set, including `JadeFlowsTab` and at least one input exporter such as `DistancesTab`, not only the current seven name filters.

### 3. MEDIUM — T11b retains stale inventory, ownership, guard, and commit text

The detailed task now correctly identifies 24 helper calls in 15 files plus two exceptional JADE controls (26 total), but several older statements still disagree:

- the Wave 4 ownership row says all 16 tab files call `downloadEntityExport`;
- T11b's rationale still says T14 owns `Workspace.tsx`/**`exportEntity.ts`**, even though T11b is now `exportEntity.ts`'s sole writer;
- the `[T11b]` commit message still says "25 call sites";
- the targeted gate omits `JadeFlowsTab` and an input-export component despite their new behavior-specific tests; and
- the grep comment says both commands return `exportEntity.ts` / `ExportContext.tsx`, although the client-CSV grep must return **no matches** and the `--include="*.tsx"` helper grep cannot return `exportEntity.ts`.

Update every inventory/reference to one consistent statement: **16 export-control tab files, comprising 15 helper-calling files with 24 calls plus `JadeFlowsTab`'s two client CSV controls; 26 controls total**. Make the guard expectations and commit message match that inventory.

### Sixth re-review exit criteria

Approval requires the `ExportApi`/provider contract to be one type-correct, fully sourced design; every affected component test to have a declared provider strategy and be included in the gate; and all stale T11b inventory/ownership/count/guard text to be corrected. Run `git diff --check`, verify the final context contract against the actual `downloadEntityExport` signature and all 16 export-control tabs, then re-review for approval.
