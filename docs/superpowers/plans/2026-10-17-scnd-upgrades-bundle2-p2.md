# SCND Upgrades — Bundle 2 Phase P2 Implementation Plan (import-schema, JSON import, deliveryCosts)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (gate run, Orval no-diff check, Docker build, `e2e_accuracy.py`, `e2e_journey.py` delivery + transport, e2e sweep, changelog entry), per the standing ledger rule.

**Goal:** Ship spec B2.5–B2.7: a new `@workspace/import-schema` workspace package that is the single source of every importable entity's file layout, a JSON import path that accepts the export envelope unchanged (with a 2 MB body limit and a 20,000-row cap), and a new sparse `deliveryCosts` import/export entity for `delivery-teaching-us`.

**Architecture:** `lib/import-schema` holds the per-entity field descriptors (CSV header ↔ JSON key, type, required-for-add/update, enum, bounds, unit family, example, model applicability), the template-version constants and the import limits. The api-server reads its column lists and version numbers from it with no column change. JSON import does not get a second validator: it checks the envelope and the row keys/types against the descriptors, turns the rows into CSV text, and runs the existing CSV validator. Errors and changes are then mapped back to `rowIndex`. `deliveryCosts` is one closed-union change across the package, OpenAPI, regenerated client, server and studio unions. The studio side is plumbing only (ImportDialog `format`, client 2 MB guard, entity unions); the table UI is P3/P4.

**Tech Stack:** pnpm monorepo; Express 5 + body-parser 2.2.2 + papaparse in `artifacts/api-server`; vitest + supertest (real Postgres for route tests); Orval 8.9.1 codegen from `lib/api-spec/openapi.yaml`; React + RTL in `artifacts/studio`; Docker for `nos-api`.

**Spec (source of truth):** `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` (rev 2), sections B2.5, B2.6, B2.7, decision D1, "Verification gate". P1/P3/P4 are out of scope.

## Global Constraints

- **Workdir / branch:** bundle branch `scnd-upgrades` in `/Users/shubhamkr/nos-scnd-upgrades`. Never touch `/Users/shubhamkr/network-optimization-studio`. Each task runs in its own pre-created locked worktree (see "Execution topology"). The task's first Bash command is `cd <its worktree> && git rev-parse --abbrev-ref HEAD`, and it must print `scu-2.p2.N-work`; otherwise STOP.
- **Fresh worktrees have no `node_modules`** (measured: `ls /Users/shubhamkr/nos-scnd-upgrades/node_modules` → "No such file or directory"). Step 1 of every task runs `pnpm install --frozen-lockfile` (SCU-2.P2.1 runs a non-frozen `pnpm install` after its `package.json` edits, to update the lockfile).
- **Before every `git commit`:** `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1`. Run it alone, read its output, then commit **with an explicit pathspec** (`git commit <paths> -m …`). `git add` new/deleted files first (a pathspec commit cannot pick up untracked files). Never pipe a state-changing git command.
- **One task = one commit.** Message `[SCU-2.P2.N] <imperative summary>`; the body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. A contract change (OpenAPI + Orval regen + server + client unions) is ONE task and ONE commit (hard rules #1, #4; closed-union gotcha).
- **Changelog in the same commit (hard rule #9).** SCU-2.P2.1 appends the heading `## SCU-B2.P2 — SCND upgrades Bundle 2 Phase P2 (2026-10-16 spec)` at the bottom of `docs/CHANGELOG-implementation.md`; every task appends `### SCU-2.P2.N — <title>`. Numbers are measured in that task's run; an underivable value is the literal `unknown`.
- **Hard rule #12:** every task's owner is **backend-engineer**. Step 0 of each task: invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`, via the Skill tool, and say so in the report. Review: latest Opus + `ponytail:ponytail-review`. No Dockerfile/`render.yaml` edit is needed (grounding fact 7), so no devops-engineer review; the Docker build is still a mandatory step of SCU-2.P2.1.
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). Regenerate with `pnpm --filter @workspace/api-spec codegen` and commit spec + output together.
- **No `lib/db` schema change in this phase.** Each task asserts `git diff --stat "$BASE"..HEAD -- lib/db/src/schema/` prints nothing.
- **Ownership:** every import/export route keeps `scenarios.user_id = req.userId`; a non-owned scenario is **404, never 403** (hard rule #5).
- **Spec values, verbatim:**
  - Body limit `express.json({ limit: "2mb" })` (implemented as `MAX_IMPORT_BYTES = 2 * 1024 * 1024` = 2,097,152 bytes, which is what body-parser's `bytes` parses `"2mb"` to). Over the limit → **413 `{ error: "payload_too_large" }`**.
  - Max **20,000** rows per import (CSV data rows or JSON `document.rows`).
  - Malformed JSON → **400 with `errorClass: "malformed"`**.
  - `ImportRequest` is `oneOf`: `{ entity, format: "csv", csvText }` with **`format` optional, defaulting to `csv`**, or `{ entity, format: "json", document }`.
  - **The JSON `document` is the export envelope** `{ templateVersion, entity, unit?, rows }` with JSON keys; an exported JSON file round-trips unchanged.
  - `document.entity` must equal `entity`; `templateVersion` must be supported; unknown keys → error; duplicate ids → the existing duplicate rule.
  - `ImportError` gains optional `rowIndex` (0-based, JSON) and `field`; CSV keeps `line`.
  - The apply 422 `{ error, preview }` (`scenarios.ts:1749`) is documented in OpenAPI as-is.
  - **`deliveryCosts` (D1): sparse overrides of `inputs.laneCostOverrides`; rows `{ fromId, toId, cost }`; `cost` = billable miles, no unit conversion, no `unit` field.** Export emits only overridden pairs; import upserts; pairs must exist in the base matrix; a row whose cost equals base removes the override.
  - Header matching stays exact; blank `id` = add mode.
- **Gate (every task; scripts verified: `artifacts/studio/package.json:11` has `typecheck:e2e`; `lib/import-schema` gets `test` in SCU-2.P2.1).** Run each separately, judge by its own exit status:
  1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]` — alone, never chained with `&&`.
  2. `pnpm --filter @workspace/import-schema test`
  3. `pnpm run typecheck && pnpm --filter studio typecheck:e2e && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
- **Flakes:** check `docs/superpowers/flake-registry.md` by test **name** and re-run a failing file twice in isolation before calling it a regression. `nos_dev` is shared with other sessions; these tests never solve, so no dispatcher interaction is expected.
- **e2e sweep:** each task greps `artifacts/studio/e2e/` for every string/testid it changes. Measured at `46d2f98`: `entity must be` 0 files, `csvText is required` 0, `only support` 0, `Could not parse file` 0, `Import failed` 0, `import-preview-error` 0, `import-error-row` 0, `import-change-row` 0, `payload_too_large` 0, `deliveryCosts` 1 (`delivery-teaching.spec.ts:188,240`, the sidebar testid `sidebar-input-deliveryCosts`, untouched). No spec rewrite is expected; record `e2e: sweep 0 hits` in the changelog, never "green".
- **No merge, no push, no deploy in this plan.** P2.1 changes root build inputs (`pnpm-lock.yaml`, root `tsconfig.json`), which by the `deploy_config` gate touch both services; that matters only at bundle deploy time.
- **Line numbers are from `46d2f98`.** Earlier tasks shift them; locate by the quoted text, verify, then edit.

## Spec deviations and grounding facts (read before any task)

Each is the smallest correct reading where the spec and the repo disagree (hard rule #8). Every commit that implements one names it in its body.

1. **Malformed JSON is a separate 400 body, not a new `ImportError.errorClass`.** A body that is not JSON never reaches a route, because `express.json` rejects it first. Measured today (2026-10-17, probe against `5ba7c4c` with `supertest`): a malformed body returns **500 `{"error":"Internal server error"}`**, and so does a 150 kB body (body-parser's 100 kB default). Plan: an error middleware right after the body parsers answers `entity.parse.failed` with **400 `{ error: "Request body is not valid JSON.", errorClass: "malformed" }`** and `entity.too.large` with **413 `{ error: "payload_too_large" }`** (type strings verified in `raw-body@3.0.2/index.js:167` and `body-parser@2.2.2/lib/read.js:166`). A `format: "json"` request whose `document` is not an object with a `rows` array gets the same 400 shape from the route. Everything inside a well-formed document (entity mismatch, unsupported version, unknown key, wrong type, too many rows) is a normal preview error, so preview and all-or-nothing apply return the same envelope. `ImportErrorClass` stays `format | syntax | logic`.
2. **`ImportRowChange` also gains `rowIndex`.** The spec gives `rowIndex` to errors only. A JSON change still needs its row, and `ImportRowChange.line` is a required integer in the contract. Plan: JSON changes carry `rowIndex` and `line = rowIndex + 2` (the CSV-equivalent line, documented). JSON errors carry `line: null` plus `rowIndex`, as the spec says.
3. **Do not replace `canAdd` or the route guards with the package.** `parseAndValidateImport`'s `canAdd` (`import.ts:652-654`) allows mines/stations/refineries/plants adds for *any* `modelId`, and `import.test.ts:406-524,645-684` calls it with the default `"p-median-us"`. Driving it from `addModels` would break those tests. Plan: keep `canAdd` and the route guards unchanged. Pin the package to them instead: `importSchemaParity.test.ts` (add-mode, required-ness, bounds, enums against the real validator) and `importSchemaRouteParity.test.ts` (entity × model 200/422 against the real routes).
4. **Template-version constants move into the package.** `TEMPLATE_VERSION = 1` and `DISTANCE_TEMPLATE_VERSION = 2` (`templates.ts:28,38`) become `@workspace/import-schema` exports. `templates.ts` imports and re-exports them, so every existing importer keeps compiling. `OUTPUT_TEMPLATE_VERSION` / `COST_SUMMARY_TEMPLATE_VERSION` stay in `templates.ts`.
5. **Export JSON rows carry keys import must accept.** Single-id input rows carry a per-row `templateVersion` and an `overridden` flag (`templates.ts:125-200`), and distance rows carry `overridden: true` (`templates.ts:1042-1049`). Plan: per-row `templateVersion` is a field (`envelopeKey: "templateVersion"`, so a row may omit it), `unit` is a field with `envelopeKey: "unit"` (export puts it only on the envelope, `templates.ts:1148-1151`), and `overridden` is listed in `exportOnlyJsonKeys` (accepted, ignored).
6. **`deliveryCosts` blank cost needs an explicit check.** `Number("") === 0` and 0 is a legal delivery cost (`delivery.ts:6` `nonnegative`; 33 of the 10,329 base lanes are 0, measured from `costs.json`). Unlike `laneCosts`, which rejects 0, a blank cell would silently become a 0 override. Plan: a blank cost is an error. `importSchemaParity.test.ts`'s required-for-update case pins this.
7. **No Dockerfile or `render.yaml` change is needed.** The Dockerfile `COPY . .` (and `.dockerignore` excludes only `node_modules`/`dist`), installs the whole workspace, and builds `pnpm --filter api-server...`. esbuild bundles workspace sources, and `import-schema` has no build step, like `@workspace/units`. The studio Render build is `pnpm --filter studio...` → `vite build`. Proven by the filtered builds plus a local `docker build` in SCU-2.P2.1.
8. **tsconfig references.** The spec asks for references in the root, api-server and studio tsconfigs. The `@workspace/units` precedent (`6b01f03`) added only the root one. Plan: follow the spec, as `lib/db`/`lib/api-zod` already do. The gate's `pnpm run typecheck` runs `tsc --build` first, which emits `lib/import-schema/dist/*.d.ts` before the per-package checks.
9. **No field has a `max`.** The spec lists `min?`/`max?`. The validator enforces only non-negative capacity/demand/delivery cost and strictly positive distance/lane cost. Plan: `min` + `exclusiveMin`, and no `max` (YAGNI). Bounds mirror the import validator, which accepts capacity 0 even though `pMedian.ts:5` `capacity.positive()` later rejects it at apply-revalidate. That is pre-existing and not changed here.
10. **2 MB file vs 2 MB body.** The client guard checks file size, and the server limit is on the JSON body. JSON escaping adds about one byte per CSV line (`\n` → `\\n`), so a file just under 2 MB can still get a 413. Plan: keep both values verbatim. ImportDialog maps a 413 to the same sentence as the client guard, so the user never sees the raw code. **Open question for the user:** if near-limit files matter, the server limit could get headroom (e.g. 2.1 MB) — not done here.
11. **Route guard messages change for import/apply entity validation only.** The 10-name `entity !== …` chains at `scenarios.ts:1603-1605,1686-1688` become `isImportEntity` from the package (so B2.7 cannot forget them). The 422 text becomes `entity must be one of: …`. No test or e2e asserts the old text (measured, 0 hits). The export chain (`scenarios.ts:618-620`) is edited in place in SCU-2.P2.3.
12. **ImportDialog gets two display one-liners.** For JSON, errors show `row N` instead of `—`, and changes show `row N` instead of the synthetic line. Without them, the `format` param this phase adds would show nothing useful. The expected-fields panel and the Upload ▾ menu stay P4.

## File Structure

| Path | Change | Task |
|---|---|---|
| `lib/import-schema/package.json`, `tsconfig.json`, `vitest.config.ts` | **new** package | 2.P2.1 |
| `lib/import-schema/src/index.ts` | **new** — descriptors, constants, helpers | 2.P2.1 (+ `deliveryCosts` in 2.P2.3) |
| `lib/import-schema/src/__tests__/importSchema.test.ts` | **new** | 2.P2.1, 2.P2.3 |
| `tsconfig.json`, `artifacts/api-server/tsconfig.json`, `artifacts/studio/tsconfig.json` | add reference | 2.P2.1 |
| `artifacts/api-server/package.json`, `artifacts/studio/package.json`, `pnpm-lock.yaml` | add dependency | 2.P2.1 |
| `artifacts/api-server/src/services/templates.ts` | version constants from package; writer headers from `csvColumns` (2.P2.1); `deliveryCosts` export (2.P2.3) | 2.P2.1, 2.P2.3 |
| `artifacts/api-server/src/services/import.ts` | column lists + `ImportEntity` from package (2.P2.1); JSON path, request reader, row cap (2.P2.2); `deliveryCosts` parser (2.P2.3) | all |
| `artifacts/api-server/src/__tests__/importSchemaParity.test.ts` | **new** — package ↔ validator | 2.P2.1 |
| `artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts` | **new** — real-DB, package ↔ route guards | 2.P2.1 |
| `artifacts/api-server/src/app.ts` | 2 MB limit + body-parser error handler | 2.P2.2 |
| `artifacts/api-server/src/routes/scenarios.ts` | import/apply read `format` (2.P2.2); `deliveryCosts` guards/export/apply (2.P2.3) | 2.P2.2, 2.P2.3 |
| `lib/api-spec/openapi.yaml` + regenerated `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**` | import oneOf, errors, limits (2.P2.2); `deliveryCosts` enums (2.P2.3) | 2.P2.2, 2.P2.3 |
| `artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts` | **new** — real-DB JSON contract | 2.P2.2 (+ case in 2.P2.3) |
| `artifacts/api-server/src/__tests__/importSchemaContract.test.ts` | **new** — generated contract pinned to constants | 2.P2.2, 2.P2.3 |
| `artifacts/studio/src/components/ImportDialog.tsx` + `src/__tests__/ImportDialog.test.tsx` | `format`, 2 MB guard, 413 text, `ImportEntity` from package | 2.P2.2 |
| `artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts` | **new** — pure | 2.P2.3 |
| `artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts` | **new** — real-DB | 2.P2.3 |
| `artifacts/studio/src/lib/exportEntity.ts`, `src/contexts/ExportContext.tsx`, `src/__tests__/ExportContext.test.tsx` | `deliveryCosts` in unions | 2.P2.3 |
| `docs/CHANGELOG-implementation.md` | per-task entries | all |

## Execution topology

Strictly sequential, because every task edits `services/import.ts` and two of them edit `openapi.yaml`: **2.P2.1 → 2.P2.2 → 2.P2.3**. This phase touches no Workspace table component, so it can run in parallel with Bundle 2 P1 (studio `components/data-table/**`). The only shared file is `docs/CHANGELOG-implementation.md`, and a conflict that is purely two bottom-appended blocks is resolved by keeping both, in task-id order. Do **not** rely on `isolation: "worktree"` (root CLAUDE.md gotcha). For each task the controller pre-creates a locked worktree from the current bundle tip:

```bash
BASE=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse scnd-upgrades)
git -C /Users/shubhamkr/nos-scnd-upgrades worktree add --lock /Users/shubhamkr/nos-scu-2.p2.N -b scu-2.p2.N-work "$BASE"
```

It dispatches without `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-scu-2.p2.N && git rev-parse --abbrev-ref HEAD` (must print `scu-2.p2.N-work`), then `git merge-base --is-ancestor "$BASE" HEAD`. The controller cherry-picks the task commit onto `scnd-upgrades` and re-runs the gate there before creating the next worktree.

---

## Task SCU-2.P2.1: `@workspace/import-schema` package + full wiring (B2.5)

**Owner role:** backend-engineer. **Spec:** B2.5. **Deviations:** 3, 4, 7, 8, 9.

**Files:**
- Create: `lib/import-schema/package.json`, `lib/import-schema/tsconfig.json`, `lib/import-schema/vitest.config.ts`, `lib/import-schema/src/index.ts`, `lib/import-schema/src/__tests__/importSchema.test.ts`
- Create: `artifacts/api-server/src/__tests__/importSchemaParity.test.ts`, `artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts`
- Modify: `tsconfig.json` (references), `artifacts/api-server/tsconfig.json` (references), `artifacts/studio/tsconfig.json` (references), `artifacts/api-server/package.json` + `artifacts/studio/package.json` (dependency), `pnpm-lock.yaml`
- Modify: `artifacts/api-server/src/services/templates.ts:28,38` (constants) and the 9 writer headers at `:689,697,711,719,731,878,932,1134,1264`
- Modify: `artifacts/api-server/src/services/import.ts:81` (`ImportEntity`), `:100,106,121,124,131,202-211` (column lists)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing from this plan.
- Produces (P2.2, P2.3, P3 and P4 rely on these exact names — `lib/import-schema/src/index.ts`):

```ts
export const TEMPLATE_VERSION = 1;
export const DISTANCE_TEMPLATE_VERSION = 2;
export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MODEL_IDS: readonly ["p-median-us", "p-median-brazil", "transport-coal", "two-echelon-gold-au", "two-echelon-jade-us", "max-coverage-us", "delivery-teaching-us"];
export type ModelId = (typeof MODEL_IDS)[number];
export const IMPORT_ENTITIES: readonly ["warehouses", "customers", "mines", "stations", "refineries", "distances", "laneCosts", "legDistances", "plants", "plantCapabilities"]; // + "deliveryCosts" in 2.P2.3
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];
export type ImportFieldType = "string" | "number" | "boolean" | "enum";
export interface ImportFieldDescriptor {
  readonly csvHeader: string;            // e.g. "from_id"
  readonly jsonKey: string;              // e.g. "fromId" (camelCase of csvHeader)
  readonly type: ImportFieldType;
  readonly nullable: boolean;            // === !(requiredForAdd && requiredForUpdate)
  readonly requiredForAdd: boolean;      // non-blank required on a blank-id (add) row
  readonly requiredForUpdate: boolean;   // non-blank required on an update row / any pair-entity row
  readonly enum?: readonly string[];
  readonly min?: number;
  readonly exclusiveMin?: true;
  readonly unitFamily?: "distance";
  readonly envelopeKey?: "templateVersion" | "unit";
  readonly example: string;              // CSV cell text; "" = blank
  readonly models?: readonly ModelId[];  // models whose importer persists it; omitted = all of the entity's models
}
export interface ImportTemplateVersion { readonly templateVersion: number; readonly fields: readonly ImportFieldDescriptor[] }
export interface ImportEntitySchema {
  readonly entity: ImportEntity;
  readonly models: readonly ModelId[];
  readonly addModels: readonly ModelId[];      // blank id = add; [] for pair entities
  readonly versions: readonly ImportTemplateVersion[]; // oldest first; last = what export emits
  readonly exportOnlyJsonKeys: readonly string[];
}
export interface ImportJsonDocument { templateVersion: number; entity: ImportEntity; unit?: "km" | "mi"; rows: Record<string, unknown>[] }
export const IMPORT_SCHEMAS: Readonly<Record<ImportEntity, ImportEntitySchema>>;
export function isImportEntity(value: unknown): value is ImportEntity;
export function findTemplateVersion(entity: ImportEntity, templateVersion: number): ImportTemplateVersion | undefined;
export function csvColumns(entity: ImportEntity, templateVersion: number): string[]; // throws on an unknown version
export function exampleCsv(entity: ImportEntity): string;                 // header + one example line, latest version, "\n"-terminated
export function exampleJsonDocument(entity: ImportEntity): ImportJsonDocument;
```

- [ ] **Step 0: Skills.** Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail` (Skill tool).

- [ ] **Step 1: Worktree check + install**

```bash
cd /Users/shubhamkr/nos-scu-2.p2.1 && git rev-parse --abbrev-ref HEAD
```
Expected: `scu-2.p2.1-work`. Then `git merge-base --is-ancestor "$BASE" HEAD && echo ok` and `pnpm install --frozen-lockfile`.

- [ ] **Step 2: Create the package skeleton**

`lib/import-schema/package.json`:
```json
{
  "name": "@workspace/import-schema",
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

`lib/import-schema/tsconfig.json`:
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

`lib/import-schema/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 3: Write the failing package test**

`lib/import-schema/src/__tests__/importSchema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  IMPORT_ENTITIES, IMPORT_SCHEMAS, MODEL_IDS, TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION,
  MAX_IMPORT_ROWS, MAX_IMPORT_BYTES, csvColumns, exampleCsv, exampleJsonDocument,
  findTemplateVersion, isImportEntity,
} from "../index.js";

// The "no column change" anchor (spec B2.5): today's literal column lists from
// artifacts/api-server/src/services/import.ts:100-211 at 46d2f98. Written out
// by hand on purpose — a test that derived these from the package could not fail.
const LITERAL_COLUMNS: Record<string, Record<number, string[]>> = {
  warehouses: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "capacity", "status"] },
  customers: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "demand", "status"] },
  mines: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "capacity"] },
  stations: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "demand"] },
  refineries: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "status"] },
  plants: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng"] },
  distances: { 1: ["template_version", "from_id", "to_id", "distance"], 2: ["template_version", "unit", "from_id", "to_id", "distance"] },
  legDistances: { 1: ["template_version", "from_id", "to_id", "distance"], 2: ["template_version", "unit", "from_id", "to_id", "distance"] },
  laneCosts: { 1: ["template_version", "from_id", "to_id", "cost"], 2: ["template_version", "unit", "from_id", "to_id", "cost"] },
  plantCapabilities: { 1: ["template_version", "plant_id", "product_id", "enabled"] },
};

describe("constants", () => {
  it("pins the spec values", () => {
    expect(TEMPLATE_VERSION).toBe(1);
    expect(DISTANCE_TEMPLATE_VERSION).toBe(2);
    expect(MAX_IMPORT_ROWS).toBe(20000);
    expect(MAX_IMPORT_BYTES).toBe(2097152); // what body-parser parses "2mb" to
  });
});

describe("IMPORT_SCHEMAS", () => {
  it("has exactly one schema per entity, keyed by its own name", () => {
    expect(Object.keys(IMPORT_SCHEMAS).sort()).toEqual([...IMPORT_ENTITIES].sort());
    for (const entity of IMPORT_ENTITIES) expect(IMPORT_SCHEMAS[entity].entity).toBe(entity);
  });

  it.each(Object.entries(LITERAL_COLUMNS))("%s: CSV columns equal today's literal header for every version", (entity, byVersion) => {
    const schema = IMPORT_SCHEMAS[entity as keyof typeof IMPORT_SCHEMAS];
    expect(schema.versions.map(v => v.templateVersion)).toEqual(Object.keys(byVersion).map(Number));
    for (const [version, columns] of Object.entries(byVersion)) {
      expect(csvColumns(schema.entity, Number(version))).toEqual(columns);
    }
  });

  it("every entity is covered by the literal table", () => {
    expect(Object.keys(LITERAL_COLUMNS).sort()).toEqual([...IMPORT_ENTITIES].sort());
  });

  it("jsonKey is the camelCase of csvHeader (from_id ↔ fromId)", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) for (const f of v.fields) {
      expect(f.jsonKey).toBe(f.csvHeader.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()));
    }
    const distances = findTemplateVersion("distances", DISTANCE_TEMPLATE_VERSION)!;
    expect(distances.fields.map(f => f.jsonKey)).toEqual(["templateVersion", "unit", "fromId", "toId", "distance"]);
  });

  it("nullable is exactly !(requiredForAdd && requiredForUpdate)", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) for (const f of v.fields) {
      expect(f.nullable).toBe(!(f.requiredForAdd && f.requiredForUpdate));
    }
  });

  it("examples are well-typed: enum examples are members, number examples parse, booleans are true/false", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) for (const f of v.fields) {
      if (f.type === "enum") { expect(f.enum!.length).toBeGreaterThan(0); expect(f.enum).toContain(f.example); }
      if (f.type === "number" && f.example !== "") expect(Number.isFinite(Number(f.example))).toBe(true);
      if (f.type === "boolean") expect(["true", "false"]).toContain(f.example);
      if (f.exclusiveMin) expect(f.min).toBeDefined();
    }
  });

  it("models: entity models are known; addModels and field models are subsets", () => {
    for (const entity of IMPORT_ENTITIES) {
      const s = IMPORT_SCHEMAS[entity];
      expect(s.models.length).toBeGreaterThan(0);
      for (const m of s.models) expect(MODEL_IDS).toContain(m);
      for (const m of s.addModels) expect(s.models).toContain(m);
      for (const v of s.versions) for (const f of v.fields) for (const m of f.models ?? []) expect(s.models).toContain(m);
    }
  });

  it("pair entities have no id column and no add mode; single-id entities have both", () => {
    for (const entity of IMPORT_ENTITIES) {
      const s = IMPORT_SCHEMAS[entity];
      const hasId = s.versions.every(v => v.fields.some(f => f.csvHeader === "id"));
      if (!hasId) expect(s.addModels).toEqual([]);
      else expect(s.addModels.length).toBeGreaterThan(0);
    }
  });

  it("unit-bearing versions carry a unit field fed from the envelope; templateVersion is always envelope-backed", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) {
      expect(v.fields[0]).toMatchObject({ csvHeader: "template_version", envelopeKey: "templateVersion", example: String(v.templateVersion) });
      const unit = v.fields.find(f => f.csvHeader === "unit");
      expect(unit === undefined).toBe(v.templateVersion !== DISTANCE_TEMPLATE_VERSION);
      if (unit) expect(unit).toMatchObject({ envelopeKey: "unit", enum: ["km", "mi"] });
    }
  });
});

describe("helpers", () => {
  it("csvColumns throws on an unknown version", () => {
    expect(() => csvColumns("warehouses", 99)).toThrow(/warehouses/);
  });

  it("exampleCsv is the latest version's header + example line", () => {
    for (const entity of IMPORT_ENTITIES) {
      const versions = IMPORT_SCHEMAS[entity].versions;
      const latest = versions[versions.length - 1]!;
      expect(exampleCsv(entity)).toBe(`${latest.fields.map(f => f.csvHeader).join(",")}\n${latest.fields.map(f => f.example).join(",")}\n`);
    }
  });

  it("exampleJsonDocument is an export-shaped envelope with one populated row", () => {
    const doc = exampleJsonDocument("distances");
    expect(doc).toEqual({ templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "mi", rows: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] });
    const wh = exampleJsonDocument("warehouses");
    expect(wh.unit).toBeUndefined();
    expect(wh.rows[0]).toMatchObject({ id: "ALN", displayCode: null, capacity: null, status: "forced_open", lat: 40.602812 });
    expect(exampleJsonDocument("plantCapabilities").rows[0]).toEqual({ plantId: "plant-1", productId: "product-2", enabled: true });
  });

  it("isImportEntity", () => {
    expect(isImportEntity("warehouses")).toBe(true);
    expect(isImportEntity("assignments")).toBe(false);
    expect(isImportEntity(7)).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @workspace/import-schema test`
Expected: FAIL — `Failed to resolve import "../index.js"` (the module does not exist yet).

- [ ] **Step 5: Write the package**

`lib/import-schema/src/index.ts`:
```ts
/**
 * @workspace/import-schema — SCND upgrades B2.5. The single source of every
 * importable input entity's FILE LAYOUT: CSV header ↔ JSON key, value type,
 * required-ness for add/update rows, enum values, numeric bounds, unit family,
 * an example, and which models the entity (or field) applies to. Shared by the
 * api-server's importer/exporter and the studio's upload/download UI.
 *
 * Validation RULES stay in artifacts/api-server/src/services/import.ts. Every
 * descriptor value that restates a rule (requiredFor*, min, enum, addModels,
 * models) is pinned to the real validator / route guards by api-server's
 * importSchemaParity.test.ts and importSchemaRouteParity.test.ts, so this file
 * cannot drift from what the server actually does without a red test.
 */

/** Input-entity template version (every non-distance entity, and distance v1). */
export const TEMPLATE_VERSION = 1;
/** v2 of the unit-bearing entities (distances, legDistances, laneCosts): adds a `unit` column. */
export const DISTANCE_TEMPLATE_VERSION = 2;
/** Max data rows per import (CSV data lines or JSON document.rows). */
export const MAX_IMPORT_ROWS = 20_000;
/** 2 MB — the server's express.json limit AND the client's file-size guard. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const MODEL_IDS = [
  "p-median-us",
  "p-median-brazil",
  "transport-coal",
  "two-echelon-gold-au",
  "two-echelon-jade-us",
  "max-coverage-us",
  "delivery-teaching-us",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

/** Same order as the OpenAPI ImportEntity enum (importSchemaContract.test.ts pins the two). */
export const IMPORT_ENTITIES = [
  "warehouses",
  "customers",
  "mines",
  "stations",
  "refineries",
  "distances",
  "laneCosts",
  "legDistances",
  "plants",
  "plantCapabilities",
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportFieldType = "string" | "number" | "boolean" | "enum";

export interface ImportFieldDescriptor {
  readonly csvHeader: string;
  readonly jsonKey: string;
  readonly type: ImportFieldType;
  /** A blank CSV cell / JSON null is legal in at least one mode. Always !(requiredForAdd && requiredForUpdate). */
  readonly nullable: boolean;
  /** Must be non-blank on an ADD row (blank `id`). */
  readonly requiredForAdd: boolean;
  /** Must be non-blank on an UPDATE row (non-blank `id`), and on every row of a pair entity. */
  readonly requiredForUpdate: boolean;
  readonly enum?: readonly string[];
  readonly min?: number;
  /** true → the value must be strictly greater than `min`. */
  readonly exclusiveMin?: true;
  readonly unitFamily?: "distance";
  /** JSON only: when the row omits this key, the envelope's key supplies it. */
  readonly envelopeKey?: "templateVersion" | "unit";
  /** CSV cell text; "" means blank. */
  readonly example: string;
  /** Models whose importer persists this field; omitted = every model of the entity. */
  readonly models?: readonly ModelId[];
}

export interface ImportTemplateVersion {
  readonly templateVersion: number;
  readonly fields: readonly ImportFieldDescriptor[];
}

export interface ImportEntitySchema {
  readonly entity: ImportEntity;
  readonly models: readonly ModelId[];
  /** Models where a blank `id` adds a new entity (the blank-id = add-mode rule). [] for pair entities. */
  readonly addModels: readonly ModelId[];
  /** Oldest first; the last one is what export emits. CSV header matching is exact. */
  readonly versions: readonly ImportTemplateVersion[];
  /** Keys a JSON export row carries that import accepts and ignores. */
  readonly exportOnlyJsonKeys: readonly string[];
}

/** The JSON export envelope, accepted back unchanged by POST /import with format "json". */
export interface ImportJsonDocument {
  templateVersion: number;
  entity: ImportEntity;
  unit?: "km" | "mi";
  rows: Record<string, unknown>[];
}

type FieldSpec = Omit<ImportFieldDescriptor, "jsonKey" | "nullable">;

function field(spec: FieldSpec): ImportFieldDescriptor {
  return {
    ...spec,
    jsonKey: spec.csvHeader.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()),
    nullable: !(spec.requiredForAdd && spec.requiredForUpdate),
  };
}

const ALWAYS = { requiredForAdd: true, requiredForUpdate: true } as const;
const ADD_ONLY = { requiredForAdd: true, requiredForUpdate: false } as const;
const OPTIONAL = { requiredForAdd: false, requiredForUpdate: false } as const;

const FACILITY_STATUSES = ["active", "forced_open", "inactive"] as const;
const CUSTOMER_STATUSES = ["active", "excluded"] as const;

const templateVersionField = (templateVersion: number) =>
  field({ csvHeader: "template_version", type: "number", ...ALWAYS, envelopeKey: "templateVersion", example: String(templateVersion) });

const UNIT_FIELD = field({ csvHeader: "unit", type: "enum", ...ALWAYS, enum: ["km", "mi"], envelopeKey: "unit", example: "mi" });

/** template_version, id, display_code, city, state, lat, lng, then the entity's own tail columns. */
function singleIdFields(example: { id: string; city: string; state: string; lat: string; lng: string }, tail: ImportFieldDescriptor[]): ImportFieldDescriptor[] {
  return [
    templateVersionField(TEMPLATE_VERSION),
    // Blank id = ADD (the server mints the uid); non-blank = UPDATE of a base or added entity.
    field({ csvHeader: "id", type: "string", requiredForAdd: false, requiredForUpdate: true, example: example.id }),
    field({ csvHeader: "display_code", type: "string", ...OPTIONAL, example: "" }),
    field({ csvHeader: "city", type: "string", ...ADD_ONLY, example: example.city }),
    field({ csvHeader: "state", type: "string", ...ADD_ONLY, example: example.state }),
    field({ csvHeader: "lat", type: "number", ...ADD_ONLY, example: example.lat }),
    field({ csvHeader: "lng", type: "number", ...ADD_ONLY, example: example.lng }),
    ...tail,
  ];
}

/** v1 (template_version, from_id, to_id, value) and, when unit-bearing, v2 (… unit …). */
function pairVersions(fromId: string, toId: string, value: ImportFieldDescriptor, unitBearing: boolean): ImportTemplateVersion[] {
  const pair = [
    field({ csvHeader: "from_id", type: "string", ...ALWAYS, example: fromId }),
    field({ csvHeader: "to_id", type: "string", ...ALWAYS, example: toId }),
  ];
  const v1: ImportTemplateVersion = { templateVersion: TEMPLATE_VERSION, fields: [templateVersionField(TEMPLATE_VERSION), ...pair, value] };
  if (!unitBearing) return [v1];
  return [v1, { templateVersion: DISTANCE_TEMPLATE_VERSION, fields: [templateVersionField(DISTANCE_TEMPLATE_VERSION), UNIT_FIELD, ...pair, value] }];
}

const distanceValue = (example: string) =>
  field({ csvHeader: "distance", type: "number", ...ALWAYS, min: 0, exclusiveMin: true, unitFamily: "distance", example });

export const IMPORT_SCHEMAS: Readonly<Record<ImportEntity, ImportEntitySchema>> = {
  warehouses: {
    entity: "warehouses",
    models: ["p-median-us", "p-median-brazil", "two-echelon-jade-us", "max-coverage-us", "delivery-teaching-us"],
    addModels: ["p-median-us", "p-median-brazil", "two-echelon-jade-us", "max-coverage-us"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "ALN", city: "Allentown", state: "PA", lat: "40.602812", lng: "-75.470433" }, [
        field({ csvHeader: "capacity", type: "number", ...OPTIONAL, min: 0, example: "", models: ["p-median-us", "p-median-brazil"] }),
        field({ csvHeader: "status", type: "enum", ...ALWAYS, enum: FACILITY_STATUSES, example: "forced_open" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  customers: {
    entity: "customers",
    models: ["p-median-us", "p-median-brazil", "two-echelon-gold-au", "two-echelon-jade-us", "max-coverage-us", "delivery-teaching-us"],
    addModels: ["p-median-us", "p-median-brazil", "two-echelon-gold-au", "max-coverage-us"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "C1", city: "Akron", state: "OH", lat: "41.08", lng: "-81.52" }, [
        // JADE's per-product demand is not a CSV/JSON concern: its scalar demand is read-only (routes drop it).
        field({ csvHeader: "demand", type: "number", ...ADD_ONLY, min: 0, example: "205375", models: ["p-median-us", "p-median-brazil", "two-echelon-gold-au", "max-coverage-us", "delivery-teaching-us"] }),
        field({ csvHeader: "status", type: "enum", ...ALWAYS, enum: CUSTOMER_STATUSES, example: "active" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  mines: {
    entity: "mines",
    models: ["transport-coal"],
    addModels: ["transport-coal"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "KY", city: "Pikeville", state: "KY", lat: "37.54", lng: "-82.75" }, [
        field({ csvHeader: "capacity", type: "number", ...OPTIONAL, min: 0, example: "25000000" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  stations: {
    entity: "stations",
    models: ["transport-coal"],
    addModels: ["transport-coal"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "LAX", city: "Los Angeles", state: "CA", lat: "33.974044", lng: "-118.248849" }, [
        field({ csvHeader: "demand", type: "number", ...ADD_ONLY, min: 0, example: "8000000" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  refineries: {
    entity: "refineries",
    models: ["two-echelon-gold-au"],
    addModels: ["two-echelon-gold-au"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: "-28.0716", lng: "145.6695" }, [
        field({ csvHeader: "status", type: "enum", ...ALWAYS, enum: FACILITY_STATUSES, example: "forced_open" }),
      ]),
    }],
    exportOnlyJsonKeys: [],
  },
  distances: {
    entity: "distances",
    models: ["p-median-us", "p-median-brazil", "max-coverage-us"],
    addModels: [],
    versions: pairVersions("ALN", "C1", distanceValue("123.4"), true),
    exportOnlyJsonKeys: ["overridden"],
  },
  laneCosts: {
    entity: "laneCosts",
    models: ["transport-coal"],
    addModels: [],
    // transport-coal's lane "cost" IS a geographic distance, so it converts under unit= (templates.ts:1171-1191).
    versions: pairVersions("KY", "LAX", field({ csvHeader: "cost", type: "number", ...ALWAYS, min: 0, exclusiveMin: true, unitFamily: "distance", example: "2100" }), true),
    exportOnlyJsonKeys: ["overridden"],
  },
  legDistances: {
    entity: "legDistances",
    models: ["two-echelon-gold-au", "two-echelon-jade-us"],
    addModels: [],
    versions: pairVersions("kalgoorlie", "cunnamulla", distanceValue("1500"), true),
    exportOnlyJsonKeys: ["overridden"],
  },
  plants: {
    entity: "plants",
    models: ["two-echelon-jade-us"],
    addModels: ["two-echelon-jade-us"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "plant-1", city: "Ashland", state: "KY", lat: "38.448338", lng: "-82.66621175" }, []),
    }],
    exportOnlyJsonKeys: [],
  },
  plantCapabilities: {
    entity: "plantCapabilities",
    models: ["two-echelon-jade-us"],
    addModels: [],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: [
        templateVersionField(TEMPLATE_VERSION),
        field({ csvHeader: "plant_id", type: "string", ...ALWAYS, example: "plant-1" }),
        field({ csvHeader: "product_id", type: "string", ...ALWAYS, example: "product-2" }),
        field({ csvHeader: "enabled", type: "boolean", ...ALWAYS, example: "true" }),
      ],
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
};

export function isImportEntity(value: unknown): value is ImportEntity {
  return typeof value === "string" && (IMPORT_ENTITIES as readonly string[]).includes(value);
}

export function findTemplateVersion(entity: ImportEntity, templateVersion: number): ImportTemplateVersion | undefined {
  return IMPORT_SCHEMAS[entity].versions.find(v => v.templateVersion === templateVersion);
}

export function csvColumns(entity: ImportEntity, templateVersion: number): string[] {
  const version = findTemplateVersion(entity, templateVersion);
  if (!version) throw new Error(`import-schema: ${entity} has no template version ${templateVersion}`);
  return version.fields.map(f => f.csvHeader);
}

function latestVersion(entity: ImportEntity): ImportTemplateVersion {
  const versions = IMPORT_SCHEMAS[entity].versions;
  return versions[versions.length - 1]!;
}

export function exampleCsv(entity: ImportEntity): string {
  const { fields } = latestVersion(entity);
  return `${fields.map(f => f.csvHeader).join(",")}\n${fields.map(f => f.example).join(",")}\n`;
}

export function exampleJsonDocument(entity: ImportEntity): ImportJsonDocument {
  const { templateVersion, fields } = latestVersion(entity);
  const row: Record<string, unknown> = {};
  let unit: "km" | "mi" | undefined;
  for (const f of fields) {
    if (f.envelopeKey === "unit") { unit = f.example as "km" | "mi"; continue; }
    if (f.envelopeKey === "templateVersion") continue; // the envelope carries it
    row[f.jsonKey] = f.example === "" ? null
      : f.type === "number" ? Number(f.example)
      : f.type === "boolean" ? f.example === "true"
      : f.example;
  }
  return { templateVersion, entity, ...(unit ? { unit } : {}), rows: [row] };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @workspace/import-schema test`
Expected: PASS (all tests in `importSchema.test.ts`).

- [ ] **Step 7: Wire the package**

Root `tsconfig.json` `references`: append `{ "path": "./lib/import-schema" }` after `{ "path": "./lib/units" }`.
`artifacts/api-server/tsconfig.json` `references`: append `{ "path": "../../lib/import-schema" }`.
`artifacts/studio/tsconfig.json` `references`: append `{ "path": "../../lib/import-schema" }`.
`artifacts/api-server/package.json` `dependencies` and `artifacts/studio/package.json` `dependencies`: add `"@workspace/import-schema": "workspace:*"` (alphabetical, before `@workspace/units`).

Then update the lockfile:
```bash
pnpm install
```
Expected: `pnpm-lock.yaml` gains an `lib/import-schema` importer and a `link:../../lib/import-schema` entry under both `artifacts/api-server` and `artifacts/studio`. Run `git diff --stat pnpm-lock.yaml` and confirm only those hunks changed.

- [ ] **Step 8: Write the failing parity tests**

`artifacts/api-server/src/__tests__/importSchemaParity.test.ts`:
```ts
// SCU-2.P2.1 (B2.5) — pins every descriptor value that RESTATES a validator
// rule to the real validator (services/import.ts's parseAndValidateImport).
// The package is metadata for the upload/download UI; this file is what stops
// that metadata from describing a validator that no longer exists.
import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { IMPORT_ENTITIES, IMPORT_SCHEMAS } from "@workspace/import-schema";
import type { ImportEntity, ImportFieldDescriptor, ModelId } from "@workspace/import-schema";
import { parseAndValidateImport } from "../services/import.js";

const P = 3;

function latest(entity: ImportEntity) {
  const versions = IMPORT_SCHEMAS[entity].versions;
  return versions[versions.length - 1]!;
}

function errorsFor(entity: ImportEntity, fields: readonly ImportFieldDescriptor[], cells: string[], modelId: ModelId) {
  const csv = Papa.unparse([fields.map(f => f.csvHeader), cells], { newline: "\n" });
  return parseAndValidateImport(entity, csv, {}, P, modelId).errors;
}

const exampleCells = (fields: readonly ImportFieldDescriptor[]) => fields.map(f => f.example);
const isSingleId = (entity: ImportEntity) => latest(entity).fields.some(f => f.csvHeader === "id");

// An ADD row: blank id, a fresh display code, status "active" (the only status
// an added customer may have; legal for every facility enum too).
const addRowCells = (fields: readonly ImportFieldDescriptor[]) =>
  fields.map(f => (f.csvHeader === "id" ? "" : f.csvHeader === "display_code" ? "PARITY-1" : f.csvHeader === "status" ? "active" : f.example));

const withCell = (fields: readonly ImportFieldDescriptor[], cells: string[], target: ImportFieldDescriptor, value: string) =>
  cells.map((c, i) => (fields[i] === target ? value : c));

describe("every template version's example row validates cleanly", () => {
  for (const entity of IMPORT_ENTITIES) {
    const schema = IMPORT_SCHEMAS[entity];
    for (const version of schema.versions) {
      it(`${entity} v${version.templateVersion} on ${schema.models[0]}`, () => {
        expect(errorsFor(entity, version.fields, exampleCells(version.fields), schema.models[0]!)).toEqual([]);
      });
    }
  }
});

describe("addModels matches the validator's add mode (blank id)", () => {
  for (const entity of IMPORT_ENTITIES.filter(isSingleId)) {
    for (const model of IMPORT_SCHEMAS[entity].models) {
      const expected = IMPORT_SCHEMAS[entity].addModels.includes(model);
      it(`${entity} on ${model}: add ${expected ? "accepted" : "rejected"}`, () => {
        const { fields } = latest(entity);
        expect(errorsFor(entity, fields, addRowCells(fields), model).length === 0).toBe(expected);
      });
    }
  }
});

describe("requiredForAdd matches the validator", () => {
  for (const entity of IMPORT_ENTITIES.filter(isSingleId)) {
    const { fields } = latest(entity);
    const model = IMPORT_SCHEMAS[entity].addModels[0]!;
    for (const f of fields.filter(f => f.csvHeader !== "id")) {
      it(`${entity}.${f.csvHeader} blank on an add row → ${f.requiredForAdd ? "error" : "accepted"}`, () => {
        expect(errorsFor(entity, fields, withCell(fields, addRowCells(fields), f, ""), model).length > 0).toBe(f.requiredForAdd);
      });
    }
  }
});

describe("requiredForUpdate matches the validator", () => {
  for (const entity of IMPORT_ENTITIES) {
    const { fields } = latest(entity);
    const model = IMPORT_SCHEMAS[entity].models[0]!;
    for (const f of fields.filter(f => f.csvHeader !== "id")) {
      it(`${entity}.${f.csvHeader} blank on an update row → ${f.requiredForUpdate ? "error" : "accepted"}`, () => {
        expect(errorsFor(entity, fields, withCell(fields, exampleCells(fields), f, ""), model).length > 0).toBe(f.requiredForUpdate);
      });
    }
  }
});

describe("numeric bounds and enums match the validator", () => {
  for (const entity of IMPORT_ENTITIES) {
    const { fields } = latest(entity);
    const model = IMPORT_SCHEMAS[entity].models[0]!;
    const at = (f: ImportFieldDescriptor, v: string) => errorsFor(entity, fields, withCell(fields, exampleCells(fields), f, v), model);
    for (const f of fields.filter(f => f.min !== undefined)) {
      it(`${entity}.${f.csvHeader}: ${f.min! - 1} rejected, ${f.min} ${f.exclusiveMin ? "rejected" : "accepted"}`, () => {
        expect(at(f, String(f.min! - 1)).length).toBeGreaterThan(0);
        expect(at(f, String(f.min!)).length > 0).toBe(f.exclusiveMin === true);
      });
    }
    for (const f of fields.filter(f => f.type === "enum")) {
      it(`${entity}.${f.csvHeader}: a non-member is rejected`, () => {
        expect(at(f, "not-a-member").length).toBeGreaterThan(0);
      });
    }
  }
});
```

`artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts` (real Postgres, no mocks — same convention as `deliveryPrecheckIntegration.test.ts`):
```ts
// SCU-2.P2.1 (B2.5) — pins import-schema's entity `models` to the route
// guards in routes/scenarios.ts (import + export), for every entity × model.
// model-integration-precheck.md Gate 7: "correct entity accepted, sibling
// models' entities rejected (422)". Real DB; never solves.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { IMPORT_ENTITIES, IMPORT_SCHEMAS, MODEL_IDS, exampleCsv } from "@workspace/import-schema";
import type { ModelId } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";

beforeEach(() => { setLockedModelsForTests([]); });

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

const PMEDIAN = { p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30, addedWarehouses: [], addedCustomers: [], distanceOverrides: [] };
const MODEL_INPUTS: Record<ModelId, Record<string, unknown>> = {
  "p-median-us": PMEDIAN,
  "p-median-brazil": PMEDIAN,
  "transport-coal": { distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120, capacityFactor: 1.0, singleSource: false, capacityInactive: false },
  "two-echelon-gold-au": { bomRatio: 1.1, refineryOverrides: [], customerOverrides: [], distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120 },
  "two-echelon-jade-us": { p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120, warehouseOverrides: [], customerOverrides: [], plantProductCapability: [], addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "max-coverage-us": { p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, coverageFloorDemand: 0, gap: 0, timeLimitSec: 120, capacityMode: "none", distanceBands: [450, 3400], warehouseOverrides: [], customerOverrides: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "delivery-teaching-us": { p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120, costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [], warehouseOverrides: [], customerOverrides: [] },
};

let cookie = "";
const scenarioByModel = new Map<ModelId, number>();

beforeAll(async () => {
  const email = `scu-p2-1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const reg = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(reg.status).toBe(201);
  userIds.push(reg.body.user.id);
  cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  for (const modelId of MODEL_IDS) {
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({ name: `scu-p2-1 ${modelId}`, modelId, inputs: MODEL_INPUTS[modelId] });
    expect(res.status).toBe(201);
    scenarioIds.push(res.body.id);
    scenarioByModel.set(modelId, res.body.id);
  }
});

describe("import-schema models ↔ route guards", () => {
  for (const entity of IMPORT_ENTITIES) {
    for (const modelId of MODEL_IDS) {
      const supported = IMPORT_SCHEMAS[entity].models.includes(modelId);
      it(`${modelId} × ${entity}: import + export ${supported ? "accepted" : "422"}`, async () => {
        const id = scenarioByModel.get(modelId)!;
        const imp = await request(app).post(`/api/scenarios/${id}/import`).set("Cookie", cookie).send({ entity, csvText: exampleCsv(entity) });
        expect(imp.status).toBe(supported ? 200 : 422);
        const exp = await request(app).get(`/api/scenarios/${id}/export`).query({ entity, format: "json" }).set("Cookie", cookie);
        expect(exp.status).toBe(supported ? 200 : 422);
      });
    }
  }
});
```

- [ ] **Step 9: Run them to verify they fail**

Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/importSchemaParity.test.ts src/__tests__/importSchemaRouteParity.test.ts`
Expected: they should **PASS** as soon as the package resolves, because these tests describe *today's* behavior and the descriptors were written to match it. If anything fails here, the descriptor is wrong, not the validator: fix `lib/import-schema/src/index.ts` (never `import.ts`) and record the correction in the changelog. They are the regression net for Step 10. (Before Step 7's install they FAIL with `Failed to resolve import "@workspace/import-schema"`; that is the red state.)

- [ ] **Step 10: Switch the server to the package with no column change**

In `artifacts/api-server/src/services/templates.ts`, replace lines 28 and 38 (`export const TEMPLATE_VERSION = 1;` / `export const DISTANCE_TEMPLATE_VERSION = 2;`; keep the comment blocks above each) with one import near the top plus a re-export:
```ts
import { TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
// SCU-2.P2.1 (B2.5) — the input template versions now live in
// @workspace/import-schema (one source for the server and the studio);
// re-exported so every existing `from "./templates.js"` import keeps working.
export { TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION };
```
Then replace each writer's header literal:

| Line | Old | New |
|---|---|---|
| 689 `warehouseRowsToCsv` | `"template_version,id,display_code,city,state,lat,lng,capacity,status"` | `csvColumns("warehouses", TEMPLATE_VERSION).join(",")` |
| 697 `customerRowsToCsv` | `"…,demand,status"` | `csvColumns("customers", TEMPLATE_VERSION).join(",")` |
| 711 `mineRowsToCsv` | `"…,capacity"` | `csvColumns("mines", TEMPLATE_VERSION).join(",")` |
| 719 `stationRowsToCsv` | `"…,demand"` | `csvColumns("stations", TEMPLATE_VERSION).join(",")` |
| 731 `refineryRowsToCsv` | `"…,status"` | `csvColumns("refineries", TEMPLATE_VERSION).join(",")` |
| 878 `plantRowsToCsv` | `"template_version,id,display_code,city,state,lat,lng"` | `csvColumns("plants", TEMPLATE_VERSION).join(",")` |
| 932 `plantCapabilityRowsToCsv` | `"template_version,plant_id,product_id,enabled"` | `csvColumns("plantCapabilities", TEMPLATE_VERSION).join(",")` |
| 1134 `distanceRowsToCsv` | `"template_version,unit,from_id,to_id,distance"` | `csvColumns("distances", DISTANCE_TEMPLATE_VERSION).join(",")` |
| 1264 `laneCostRowsToCsv` | `"template_version,unit,from_id,to_id,cost"` | `csvColumns("laneCosts", DISTANCE_TEMPLATE_VERSION).join(",")` |

(Output-entity headers at `:1413` onward are not import entities and stay literal.)

In `artifacts/api-server/src/services/import.ts`:
- Line 81: replace `export type ImportEntity = "warehouses" | … | "plantCapabilities";` with
```ts
// SCU-2.P2.1 (B2.5) — single source: @workspace/import-schema's IMPORT_ENTITIES.
import type { ImportEntity } from "@workspace/import-schema";
export type { ImportEntity };
```
- Add `import { csvColumns } from "@workspace/import-schema";` beside the other imports. Then replace the literal arrays (keep each comment block):
```ts
const DISTANCES_COLUMNS = csvColumns("distances", TEMPLATE_VERSION);
const DISTANCES_COLUMNS_V2 = csvColumns("distances", DISTANCE_TEMPLATE_VERSION);
const LANE_COST_COLUMNS = csvColumns("laneCosts", TEMPLATE_VERSION);
const LANE_COST_COLUMNS_V2 = csvColumns("laneCosts", DISTANCE_TEMPLATE_VERSION);
const PLANT_CAPABILITY_COLUMNS = csvColumns("plantCapabilities", TEMPLATE_VERSION);
```
and the `COLUMNS` record at `:202-211`:
```ts
const COLUMNS: Record<SingleIdEntity, string[]> = {
  warehouses: csvColumns("warehouses", TEMPLATE_VERSION),
  customers: csvColumns("customers", TEMPLATE_VERSION),
  mines: csvColumns("mines", TEMPLATE_VERSION),
  stations: csvColumns("stations", TEMPLATE_VERSION),
  refineries: csvColumns("refineries", TEMPLATE_VERSION),
  plants: csvColumns("plants", TEMPLATE_VERSION),
};
```
`canAdd`, the per-row loop and every route guard stay byte-identical (deviation 3).

- [ ] **Step 11: Run the import/template regression net + parity**

Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/import.test.ts src/__tests__/templates.test.ts src/__tests__/importMultiModelRoundTrip.test.ts src/__tests__/importSchemaParity.test.ts src/__tests__/importSchemaRouteParity.test.ts`
Expected: PASS, all five files.

- [ ] **Step 12: Filtered builds + Docker build of `nos-api`** (spec B2.5 wiring; deviation 7)

```bash
pnpm --filter api-server... build
```
Expected: exit 0; `artifacts/api-server/dist/index.mjs` written.
```bash
pnpm --filter studio... build
```
Run it as `PORT=5180 BASE_PATH=/ pnpm --filter studio... build` (`vite.config.ts:7-25` throws without both). Expected: exit 0.
```bash
docker build -t nos-api-scu-2-p2-1 .
```
Expected: exit 0.
```bash
docker run --rm --entrypoint sh nos-api-scu-2-p2-1 -c 'grep -c exportOnlyJsonKeys artifacts/api-server/dist/index.mjs'
```
Expected: a count ≥ 1. The property name exists only in `lib/import-schema`, so this proves the package was bundled into the image. Record the image build time and the count in the changelog. Then `docker rmi nos-api-scu-2-p2-1`.

- [ ] **Step 13: e2e sweep**

No UI string or testid changes in this task. Record `e2e: n/a (no UI change)`.

- [ ] **Step 14: Gate** — the three Global Constraints gate commands, each separately. Then `git diff --stat "$BASE"..HEAD -- lib/db/src/schema/` → empty.

- [ ] **Step 15: Changelog** — append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

## SCU-B2.P2 — SCND upgrades Bundle 2 Phase P2 (2026-10-16 spec)

Plan: `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p2.md`. Spec: `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` (rev 2), B2.5–B2.7 + D1.

### SCU-2.P2.1 — `@workspace/import-schema` package + wiring (B2.5)

- New `lib/import-schema`: per-entity field descriptors (CSV header ↔ JSON key, type, requiredForAdd/Update, enum, min/exclusiveMin, unitFamily, envelopeKey, example, models), `IMPORT_SCHEMAS`, `TEMPLATE_VERSION`/`DISTANCE_TEMPLATE_VERSION` (moved from templates.ts, re-exported there), `MAX_IMPORT_ROWS` 20000, `MAX_IMPORT_BYTES` 2097152, `csvColumns`/`exampleCsv`/`exampleJsonDocument`/`isImportEntity`.
- Server reads column lists, `ImportEntity` and the 9 input writer headers from it — no column change (literal-pin test + existing import/template suites green).
- Deviation 3: `canAdd` and route guards unchanged (driving them from `addModels` breaks `import.test.ts`'s default-modelId calls); pinned instead by `importSchemaParity.test.ts` (<N> cases) and real-DB `importSchemaRouteParity.test.ts` (70 entity×model cases).
- Wiring: references in root/api-server/studio tsconfig; dependency in api-server + studio; lockfile. `pnpm --filter api-server... build` ok; `pnpm --filter studio... build` ok; `docker build` ok (<duration>), `exportOnlyJsonKeys` found <count>× in the image bundle. No Dockerfile/render.yaml change (deviation 7).
- Gate: import-schema <N>, studio <N>, api-server <N>, pytest <N> — measured this run. e2e: n/a (no UI change). lib/db schema: unchanged.
```
Replace each `<…>` with the value printed by this run, or `unknown`.

- [ ] **Step 16: Commit**

```bash
git add lib/import-schema artifacts/api-server/src/__tests__/importSchemaParity.test.ts artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts
```
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit lib/import-schema tsconfig.json artifacts/api-server/tsconfig.json artifacts/studio/tsconfig.json artifacts/api-server/package.json artifacts/studio/package.json pnpm-lock.yaml artifacts/api-server/src/services/templates.ts artifacts/api-server/src/services/import.ts artifacts/api-server/src/__tests__/importSchemaParity.test.ts artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P2.1] add @workspace/import-schema and wire server to it" -m "No column change. Deviation 3: canAdd/route guards kept; package pinned by parity tests. Deviation 4: template-version constants moved into the package. Deviation 7: no Docker/render change; docker build verified." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P2.2: JSON import contract — OpenAPI oneOf + regen + server + ImportDialog (B2.6)

**Owner role:** backend-engineer. **Spec:** B2.6. **Deviations:** 1, 2, 10, 11, 12. **Depends on:** SCU-2.P2.1.

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (paths `/scenarios/{scenarioId}/import` `:403-432`, `/import/apply` `:434-463`; schemas `ImportRequest`…`ImportApplyRequest` `:1942-2005`)
- Regenerate: `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**` (removes `importRequestEntity.ts`, `importApplyRequestEntity.ts`, `importApplyRequestMode.ts`; adds `importEntity.ts`, `importDocument.ts`, `importCsvRequest.ts`, `importJsonRequest.ts`, `importCsvApplyRequest.ts`, `importJsonApplyRequest.ts`, `importApplyMode.ts`, `importMalformedError.ts`, `payloadTooLargeError.ts`, `importApplyRejection.ts` and their enum files — verified by a scratch Orval 8.9.1 run of this exact YAML)
- Modify: `artifacts/api-server/src/app.ts:68-69`
- Modify: `artifacts/api-server/src/services/import.ts` (`ImportError`, `ImportRowChange`, row cap, new exports)
- Modify: `artifacts/api-server/src/routes/scenarios.ts:1599-1612,1676-1680` (preview) and `:1682-1696,1744-1745` (apply)
- Modify: `artifacts/studio/src/components/ImportDialog.tsx`, `artifacts/studio/src/__tests__/ImportDialog.test.tsx`
- Create: `artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts`, `artifacts/api-server/src/__tests__/importSchemaContract.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `IMPORT_ENTITIES`, `IMPORT_SCHEMAS`, `isImportEntity`, `findTemplateVersion`, `MAX_IMPORT_ROWS`, `MAX_IMPORT_BYTES`, `TEMPLATE_VERSION`, `DISTANCE_TEMPLATE_VERSION`, `csvColumns`, `ImportEntity`, `ImportFieldDescriptor` (SCU-2.P2.1).
- Produces — generated client types (P3/P4 consume from `@workspace/api-client-react`):
```ts
export type ImportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries" | "distances" | "laneCosts" | "legDistances" | "plants" | "plantCapabilities";
export interface ImportDocument { templateVersion: number; entity: string; unit?: "km" | "mi"; rows: { [key: string]: unknown }[] }
export interface ImportCsvRequest { entity: ImportEntity; format?: "csv"; csvText: string }
export interface ImportJsonRequest { entity: ImportEntity; format: "json"; document: ImportDocument }
export type ImportRequest = ImportCsvRequest | ImportJsonRequest;
export type ImportApplyMode = "all_or_nothing" | "partial";
export interface ImportCsvApplyRequest { entity: ImportEntity; format?: "csv"; csvText: string; mode?: ImportApplyMode }
export interface ImportJsonApplyRequest { entity: ImportEntity; format: "json"; document: ImportDocument; mode?: ImportApplyMode }
export type ImportApplyRequest = ImportCsvApplyRequest | ImportJsonApplyRequest;
export interface ImportError { errorClass: "format" | "syntax" | "logic"; line: number | null; rowIndex?: number; field?: string; message: string }
export interface ImportRowChange { id: string; line: number; rowIndex?: number; before: object; after: object }
export interface ImportMalformedError { error: string; errorClass: "malformed" }
export interface PayloadTooLargeError { error: "payload_too_large" }
export interface ImportApplyRejection { error: string; preview?: ImportPreview }
```
- Produces — server (`services/import.ts`):
```ts
export interface ImportError { errorClass: ImportErrorClass; line: number | null; message: string; rowIndex?: number; field?: string }
// ImportRowChange gains: rowIndex?: number
export interface UntrustedImportDocument { templateVersion?: unknown; entity?: unknown; unit?: unknown; rows: unknown[] }
export type ImportPayload = { format: "csv"; csvText: string } | { format: "json"; document: UntrustedImportDocument };
export type ReadImportRequestResult =
  | { ok: true; entity: ImportEntity; payload: ImportPayload; mode: unknown }
  | { ok: false; status: 400 | 422; body: { error: string; errorClass?: "malformed" } };
export function readImportRequest(body: unknown): ReadImportRequestResult;
export function parseAndValidateJsonImport(entity: ImportEntity, document: UntrustedImportDocument, currentOverrides: ImportCurrentOverrides, pValue: number, modelId?: string): ImportPreview;
export function previewImport(entity: ImportEntity, payload: ImportPayload, currentOverrides: ImportCurrentOverrides, pValue: number, modelId: string): ImportPreview;
```
- Produces — studio: `ImportDialog` props `{ open; onOpenChange; scenarioId; entity: ImportEntity /* from @workspace/import-schema */; format?: "csv" | "json" /* default "csv" */; onApplied?; enableFilters? }`; new testid `import-file-error`.

- [ ] **Step 0: Skills.** `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Worktree check + install** — `cd /Users/shubhamkr/nos-scu-2.p2.2 && git rev-parse --abbrev-ref HEAD` → `scu-2.p2.2-work`; base guard; `pnpm install --frozen-lockfile`.

- [ ] **Step 2: Write the failing real-DB contract test**

`artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts`:
```ts
// SCU-2.P2.2 (B2.6) — JSON import contract through the real routes and a real
// Postgres (no vi.mock): export JSON → import JSON → identical export, for a
// populated row of every entity, plus the limit/ownership/error envelope.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";

beforeEach(() => { setLockedModelsForTests([]); });

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function register(tag: string): Promise<string> {
  const email = `scu-p2-2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  userIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

const BASE: Record<string, Record<string, unknown>> = {
  "p-median-us": { p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30, addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "transport-coal": { distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120, capacityFactor: 1.0, singleSource: false, capacityInactive: false },
  "two-echelon-gold-au": { bomRatio: 1.1, refineryOverrides: [], customerOverrides: [], distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120 },
  "two-echelon-jade-us": { p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120, warehouseOverrides: [], customerOverrides: [], plantProductCapability: [], addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "delivery-teaching-us": { p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120, costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [], warehouseOverrides: [], customerOverrides: [] },
};

// One populated override per entity (real dataset ids). `expectChanges: false`
// only for plants: base plants have no override concept, and an added plant's
// opaque uid is scenario-local, so it cannot move between scenarios.
export const ROUND_TRIP_CASES: Array<{ name: string; modelId: string; entity: string; overrides: Record<string, unknown>; expectChanges: boolean }> = [
  { name: "p-median-us warehouses", modelId: "p-median-us", entity: "warehouses", overrides: { warehouseOverrides: [{ id: "ATL", status: "forced_open" }] }, expectChanges: true },
  { name: "p-median-us customers", modelId: "p-median-us", entity: "customers", overrides: { customerOverrides: [{ id: "C1", demand: 1000, status: "active" }] }, expectChanges: true },
  { name: "p-median-us distances", modelId: "p-median-us", entity: "distances", overrides: { distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] }, expectChanges: true },
  { name: "transport-coal mines", modelId: "transport-coal", entity: "mines", overrides: { mineCapacities: { KY: 1000 } }, expectChanges: true },
  { name: "transport-coal stations", modelId: "transport-coal", entity: "stations", overrides: { stationDemands: { LAX: 500 } }, expectChanges: true },
  { name: "transport-coal laneCosts", modelId: "transport-coal", entity: "laneCosts", overrides: { laneCostOverrides: [{ fromId: "KY", toId: "LAX", cost: 999 }] }, expectChanges: true },
  { name: "gold refineries", modelId: "two-echelon-gold-au", entity: "refineries", overrides: { refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }] }, expectChanges: true },
  { name: "gold customers", modelId: "two-echelon-gold-au", entity: "customers", overrides: { customerOverrides: [{ id: "sydney", demand: 1, status: "active" }] }, expectChanges: true },
  { name: "gold legDistances", modelId: "two-echelon-gold-au", entity: "legDistances", overrides: { distanceOverrides: [{ fromId: "kalgoorlie", toId: "cunnamulla", distance: 1500 }] }, expectChanges: true },
  { name: "jade warehouses", modelId: "two-echelon-jade-us", entity: "warehouses", overrides: { warehouseOverrides: [{ id: "wh-1", status: "inactive" }] }, expectChanges: true },
  { name: "jade customers", modelId: "two-echelon-jade-us", entity: "customers", overrides: { customerOverrides: [{ id: "customer-1", status: "excluded" }] }, expectChanges: true },
  { name: "jade plants", modelId: "two-echelon-jade-us", entity: "plants", overrides: {}, expectChanges: false },
  { name: "jade plantCapabilities", modelId: "two-echelon-jade-us", entity: "plantCapabilities", overrides: { plantProductCapability: [{ plantId: "plant-1", productId: "product-2", enabled: true }] }, expectChanges: true },
  { name: "jade legDistances", modelId: "two-echelon-jade-us", entity: "legDistances", overrides: { distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 321 }] }, expectChanges: true },
  { name: "delivery warehouses", modelId: "delivery-teaching-us", entity: "warehouses", overrides: { warehouseOverrides: [{ id: "W1", status: "inactive" }] }, expectChanges: true },
  { name: "delivery customers", modelId: "delivery-teaching-us", entity: "customers", overrides: { customerOverrides: [{ id: "C269", demand: 5, status: "active" }] }, expectChanges: true },
];

let owner = "";
let stranger = "";
beforeAll(async () => {
  owner = await register("owner");
  stranger = await register("stranger");
});

async function createScenario(cookie: string, modelId: string, inputs: Record<string, unknown>): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({ name: `scu-p2-2 ${modelId}`, modelId, inputs });
  expect(res.status).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}

async function exportJson(cookie: string, id: number, entity: string) {
  const res = await request(app).get(`/api/scenarios/${id}/export`).query({ entity, format: "json" }).set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.body as { templateVersion: number; entity: string; unit?: string; rows: Record<string, unknown>[] };
}

const preview = (cookie: string, id: number, body: unknown) => request(app).post(`/api/scenarios/${id}/import`).set("Cookie", cookie).send(body as object);
const apply = (cookie: string, id: number, body: unknown) => request(app).post(`/api/scenarios/${id}/import/apply`).set("Cookie", cookie).send(body as object);

describe("JSON import round-trips the export envelope unchanged", () => {
  for (const c of ROUND_TRIP_CASES) {
    it(`${c.name}: export JSON → import JSON → identical export`, async () => {
      const sourceId = await createScenario(owner, c.modelId, { ...BASE[c.modelId], ...c.overrides });
      const targetId = await createScenario(owner, c.modelId, BASE[c.modelId]!);
      const document = await exportJson(owner, sourceId, c.entity);
      expect(document.rows.length).toBeGreaterThan(0); // populated, never rows: []

      const p = await preview(owner, targetId, { entity: c.entity, format: "json", document });
      expect(p.status).toBe(200);
      expect(p.body.errors).toEqual([]);
      if (c.expectChanges) {
        expect(p.body.changes.length).toBeGreaterThan(0);
        for (const change of p.body.changes) expect(change.line).toBe(change.rowIndex + 2);
      } else {
        expect(p.body.changes).toEqual([]);
      }

      const a = await apply(owner, targetId, { entity: c.entity, format: "json", document, mode: "all_or_nothing" });
      expect(a.status).toBe(200);
      expect(a.body.errors).toEqual([]);
      expect(await exportJson(owner, targetId, c.entity)).toEqual(document);
    });
  }
});

describe("import request contract", () => {
  const headerOf = (entity: "warehouses") => csvColumns(entity, TEMPLATE_VERSION).join(",");

  it("format omitted is CSV (backward compatible) and CSV keeps line, not rowIndex", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const csvText = `${headerOf("warehouses")}\n${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.753693,-84.389544,,forced_open\n`;
    const res = await preview(owner, id, { entity: "warehouses", csvText });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toEqual([expect.objectContaining({ id: "ATL", line: 2, after: { status: "forced_open", value: null } })]);
    expect(res.body.changes[0].rowIndex).toBeUndefined();
  });

  it("a non-owner's JSON preview and apply are both 404 (never 403) and change nothing", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const document = await exportJson(owner, id, "warehouses");
    document.rows[1] = { ...document.rows[1], status: "forced_open" };
    const body = { entity: "warehouses", format: "json", document };
    expect((await preview(stranger, id, body)).status).toBe(404);
    expect((await apply(stranger, id, { ...body, mode: "partial" })).status).toBe(404);
    expect((await exportJson(owner, id, "warehouses")).rows[1]!.status).toBe("active");
  });

  it("a body over 2 MB is 413 payload_too_large", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const res = await preview(owner, id, { entity: "warehouses", csvText: "x".repeat(MAX_IMPORT_BYTES) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });

  it("a 150 kB body is accepted (it was a 500 under the 100 kB default)", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const res = await preview(owner, id, { entity: "warehouses", csvText: "x".repeat(150 * 1024) });
    expect(res.status).toBe(200);
    expect(res.body.errors[0].errorClass).toBe("format");
  });

  it("a body that is not JSON is 400 malformed", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const res = await request(app).post(`/api/scenarios/${id}/import`).set("Cookie", owner).set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Request body is not valid JSON.", errorClass: "malformed" });
  });

  it("format json without a rows array is 400 malformed on preview and apply", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const body = { entity: "warehouses", format: "json", document: { templateVersion: TEMPLATE_VERSION, entity: "warehouses" } };
    for (const res of [await preview(owner, id, body), await apply(owner, id, body)]) {
      expect(res.status).toBe(400);
      expect(res.body.errorClass).toBe("malformed");
    }
  });

  it("an unknown format is 422", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    expect((await preview(owner, id, { entity: "warehouses", format: "xml", csvText: "" })).status).toBe(422);
  });

  it("document.entity must equal entity", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const document = await exportJson(owner, id, "warehouses");
    const res = await preview(owner, id, { entity: "customers", format: "json", document });
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([]);
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", line: null, field: "entity" })]);
  });

  it("an unsupported templateVersion is a format error on templateVersion", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const document = await exportJson(owner, id, "warehouses");
    const res = await preview(owner, id, { entity: "warehouses", format: "json", document: { ...document, templateVersion: TEMPLATE_VERSION + 98 } });
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", field: "templateVersion" })]);
  });

  it("unknown keys, wrong types and duplicate ids are per-row errors with rowIndex; partial apply keeps only the good row; all-or-nothing 422 carries the preview", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const document = await exportJson(owner, id, "warehouses");
    const at = (rowId: string) => document.rows.findIndex(r => r.id === rowId);
    const aln = at("ALN"), atl = at("ATL");
    document.rows[aln] = { ...document.rows[aln], bogus: 1 };
    document.rows[atl] = { ...document.rows[atl], status: "forced_open" };
    const lat = at("BAL"); // third base warehouse (dataset order ALN, ATL, BAL, BOS…)
    document.rows[lat] = { ...document.rows[lat], lat: "40" };
    document.rows.push({ ...document.rows[atl] });
    const dupIndex = document.rows.length - 1;
    const body = { entity: "warehouses", format: "json", document };

    const p = await preview(owner, id, body);
    expect(p.status).toBe(200);
    expect(p.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorClass: "syntax", line: null, rowIndex: aln, field: "bogus" }),
      expect.objectContaining({ errorClass: "syntax", line: null, rowIndex: lat, field: "lat" }),
      expect.objectContaining({ errorClass: "logic", line: null, rowIndex: dupIndex, message: expect.stringContaining("Duplicate id") }),
    ]));
    expect(p.body.changes).toEqual([expect.objectContaining({ id: "ATL", rowIndex: atl, line: atl + 2 })]);

    const strict = await apply(owner, id, { ...body, mode: "all_or_nothing" });
    expect(strict.status).toBe(422);
    expect(strict.body.preview.errors.length).toBe(p.body.errors.length);

    const partial = await apply(owner, id, { ...body, mode: "partial" });
    expect(partial.status).toBe(200);
    expect(partial.body.applied).toBe(1);
    expect((await exportJson(owner, id, "warehouses")).rows[atl]!.status).toBe("forced_open");
  });

  it("more than MAX_IMPORT_ROWS JSON rows is a format error", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const document = { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({})) };
    const res = await preview(owner, id, { entity: "warehouses", format: "json", document });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", message: expect.stringContaining(String(MAX_IMPORT_ROWS)) })]);
  });

  it("more than MAX_IMPORT_ROWS CSV data rows is the same format error", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const line = `${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.75,-84.39,,active`;
    const csvText = `${headerOf("warehouses")}\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => line).join("\n")}\n`;
    const res = await preview(owner, id, { entity: "warehouses", csvText });
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", line: null, message: expect.stringContaining(String(MAX_IMPORT_ROWS)) })]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/importJsonRoundTrip.test.ts`
Expected: FAIL. The round-trip cases get 422 `csvText is required`; the 413 and 150 kB cases get 500; the malformed case gets 500 (matches the measured probe, deviation 1).

- [ ] **Step 4: OpenAPI — replace the import schemas**

In `lib/api-spec/openapi.yaml`, replace the whole `ImportRequest:` block (`:1942-1950`) with:
```yaml
    ImportEntity:
      type: string
      description: Importable input entities. Single source is lib/import-schema (IMPORT_ENTITIES); importSchemaContract.test.ts pins the two together.
      enum: [warehouses, customers, mines, stations, refineries, distances, laneCosts, legDistances, plants, plantCapabilities]

    ImportDocument:
      type: object
      description: >-
        The JSON envelope GET /scenarios/{scenarioId}/export?format=json emits,
        accepted back unchanged. Row keys are the entity's JSON keys
        (lib/import-schema). A row may omit templateVersion (it defaults to
        the envelope's). unit is present exactly for templateVersion 2 of a
        unit-bearing entity.
      example: { templateVersion: 1, entity: warehouses, rows: [{ templateVersion: 1, id: ALN, displayCode: null, city: Allentown, state: PA, lat: 40.602812, lng: -75.470433, capacity: null, status: forced_open, overridden: true }] }
      properties:
        templateVersion:
          type: integer
        entity:
          type: string
        unit:
          type: string
          enum: [km, mi]
        rows:
          type: array
          items:
            type: object
      required: [templateVersion, entity, rows]

    ImportCsvRequest:
      type: object
      properties:
        entity:
          $ref: "#/components/schemas/ImportEntity"
        format:
          type: string
          enum: [csv]
          description: Optional; omitted means csv (backward compatible).
        csvText:
          type: string
      required: [entity, csvText]

    ImportJsonRequest:
      type: object
      properties:
        entity:
          $ref: "#/components/schemas/ImportEntity"
        format:
          type: string
          enum: [json]
        document:
          $ref: "#/components/schemas/ImportDocument"
      required: [entity, format, document]

    ImportRequest:
      oneOf:
        - $ref: "#/components/schemas/ImportCsvRequest"
        - $ref: "#/components/schemas/ImportJsonRequest"

```
In `ImportError`, replace the `line`/`message` properties with:
```yaml
        line:
          type: ["integer", "null"]
          description: CSV only — 1-based file line (header = 1). null for JSON imports and whole-file errors.
        rowIndex:
          type: integer
          minimum: 0
          description: JSON only — 0-based index into document.rows.
        field:
          type: string
          description: JSON only — the row key (or envelope key) the error is about, when one key is to blame.
        message:
          type: string
```
In `ImportRowChange`, replace `line: { type: integer }` with:
```yaml
        line:
          type: integer
          description: CSV-equivalent line (rowIndex + 2 for a JSON import).
        rowIndex:
          type: integer
          minimum: 0
          description: JSON only — 0-based index into document.rows.
```
Replace the whole `ImportApplyRequest:` block (`:1994-2005`) with:
```yaml
    ImportApplyMode:
      type: string
      enum: [all_or_nothing, partial]

    ImportCsvApplyRequest:
      type: object
      properties:
        entity:
          $ref: "#/components/schemas/ImportEntity"
        format:
          type: string
          enum: [csv]
        csvText:
          type: string
        mode:
          $ref: "#/components/schemas/ImportApplyMode"
      required: [entity, csvText]

    ImportJsonApplyRequest:
      type: object
      properties:
        entity:
          $ref: "#/components/schemas/ImportEntity"
        format:
          type: string
          enum: [json]
        document:
          $ref: "#/components/schemas/ImportDocument"
        mode:
          $ref: "#/components/schemas/ImportApplyMode"
      required: [entity, format, document]

    ImportApplyRequest:
      oneOf:
        - $ref: "#/components/schemas/ImportCsvApplyRequest"
        - $ref: "#/components/schemas/ImportJsonApplyRequest"

    ImportMalformedError:
      type: object
      properties:
        error:
          type: string
        errorClass:
          type: string
          enum: [malformed]
      required: [error, errorClass]

    PayloadTooLargeError:
      type: object
      properties:
        error:
          type: string
          enum: [payload_too_large]
      required: [error]

    ImportApplyRejection:
      type: object
      description: 422 from import/apply. preview is present only for an all_or_nothing rejection.
      properties:
        error:
          type: string
        preview:
          $ref: "#/components/schemas/ImportPreview"
      required: [error]

```
In the `/scenarios/{scenarioId}/import` path, replace its `"401"`…`"422"` responses with:
```yaml
        "400":
          description: The request body is not valid JSON, or a format=json request carries no document object with a rows array
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ImportMalformedError"
        "401":
          description: Not authenticated
        "404":
          description: Not found (also a scenario owned by another user — never 403)
        "413":
          description: Request body exceeds the 2 MB limit
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PayloadTooLargeError"
        "422":
          description: Invalid entity or format, csvText missing for a CSV import, or this scenario's model doesn't support the entity
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```
In `/scenarios/{scenarioId}/import/apply`, the same `400`/`401`/`404`/`413`, and a `422` of:
```yaml
        "422":
          description: Invalid entity or format, model unsupported, merged inputs failed validation, or (all_or_nothing mode) the import had errors and nothing was applied — the last case carries the preview
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ImportApplyRejection"
```
Also change both summaries from "a CSV import" to "a CSV or JSON import".

- [ ] **Step 5: Regenerate and prove the regen is stable**

```bash
pnpm --filter @workspace/api-spec codegen
```
Expected: two `🎉 … converted` lines, then `typecheck:libs` exit 0. (A scratch Orval 8.9.1 run of exactly this YAML, made while writing this plan, generated cleanly, and the regenerated api-zod index typechecked with no ambiguous-export error.)
```bash
mkdir -p .harness && find lib/api-zod/src/generated lib/api-client-react/src/generated -type f -print0 | sort -z | xargs -0 shasum > .harness/gen1.sha
pnpm --filter @workspace/api-spec codegen
find lib/api-zod/src/generated lib/api-client-react/src/generated -type f -print0 | sort -z | xargs -0 shasum > .harness/gen2.sha
diff .harness/gen1.sha .harness/gen2.sha && echo REGEN-STABLE
```
Expected: `REGEN-STABLE`. Then `git status --short lib/api-zod/src/generated lib/api-client-react/src/generated` lists the three deleted `importRequestEntity.ts`/`importApplyRequestEntity.ts`/`importApplyRequestMode.ts` per package and the new files from the Files list.

- [ ] **Step 6: Write the failing contract test (generated code pinned to constants)**

`artifacts/api-server/src/__tests__/importSchemaContract.test.ts`:
```ts
// SCU-2.P2.2 (B2.6) — the regenerated contract, exercised with POPULATED rows
// built by the production writers and versions read from the CONSTANTS (never
// literals): root CLAUDE.md "contract-version" + "hand-authored fixture" gotchas.
import { describe, it, expect } from "vitest";
import {
  PreviewScenarioImportBody,
  ApplyScenarioImportBody,
  PreviewScenarioImportResponse,
  ImportEntity as GeneratedImportEntity,
  ExportScenarioEntity,
} from "@workspace/api-zod";
import { IMPORT_ENTITIES, TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION } from "@workspace/import-schema";
import { applyWarehouseOverrides, applyDistanceOverrides, toDistanceJsonRow } from "../services/templates.js";
import { parseAndValidateJsonImport } from "../services/import.js";

describe("import contract", () => {
  it("the OpenAPI ImportEntity enum is exactly import-schema's IMPORT_ENTITIES", () => {
    expect(Object.values(GeneratedImportEntity).sort()).toEqual([...IMPORT_ENTITIES].sort());
  });

  it("every import entity is also an export entity", () => {
    for (const e of IMPORT_ENTITIES) expect(Object.values(ExportScenarioEntity)).toContain(e);
  });

  it("a JSON request built from real export rows parses as preview and apply bodies", () => {
    const rows = applyWarehouseOverrides([{ id: "ATL", status: "forced_open" }]);
    expect(rows.length).toBeGreaterThan(0);
    const body = { entity: "warehouses", format: "json", document: { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows } };
    expect(PreviewScenarioImportBody.safeParse(body).success).toBe(true);
    expect(ApplyScenarioImportBody.safeParse({ ...body, mode: "partial" }).success).toBe(true);
  });

  it("a v2 distance document parses with its unit", () => {
    const rows = applyDistanceOverrides([{ fromId: "ALN", toId: "C1", distance: 12 }], "mi").map(toDistanceJsonRow);
    const body = { entity: "distances", format: "json", document: { templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "mi", rows } };
    expect(PreviewScenarioImportBody.safeParse(body).success).toBe(true);
  });

  it("format omitted still parses (the CSV branch)", () => {
    expect(PreviewScenarioImportBody.safeParse({ entity: "warehouses", csvText: "x" }).success).toBe(true);
  });

  it("a real JSON preview carrying rowIndex/field errors AND changes survives the response schema unchanged", () => {
    const rows: Record<string, unknown>[] = applyWarehouseOverrides([]).map(r => ({ ...r }));
    rows[0] = { ...rows[0], bogus: 1 };
    rows[1] = { ...rows[1], status: "forced_open" };
    const preview = parseAndValidateJsonImport("warehouses", { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows }, {}, 3, "p-median-us");
    expect(preview.errors[0]).toMatchObject({ errorClass: "syntax", line: null, rowIndex: 0, field: "bogus" });
    expect(preview.changes).toEqual([expect.objectContaining({ rowIndex: 1, line: 3 })]);
    expect(PreviewScenarioImportResponse.parse(preview)).toEqual(preview);
  });
});
```
Run: `cd artifacts/api-server && pnpm exec vitest run src/__tests__/importSchemaContract.test.ts`
Expected: FAIL — `parseAndValidateJsonImport` is not exported yet (the generated names exist after Step 5).

- [ ] **Step 7: Server — `services/import.ts`**

Extend the two interfaces (`:19-23`, `:25`):
```ts
export interface ImportError {
  errorClass: ImportErrorClass;
  line: number | null; // null for whole-file format errors (no single row to blame) and for every JSON-import error
  message: string;
  // SCU-2.P2.2 (B2.6) — JSON imports only: the 0-based document.rows index, and the key to blame.
  rowIndex?: number;
  field?: string;
}
```
and add to `ImportRowChange` right after `line: number;`:
```ts
  // SCU-2.P2.2 (B2.6) — JSON imports only; `line` is then rowIndex + 2 (the CSV-equivalent line).
  rowIndex?: number;
```
Extend the package import:
```ts
import { csvColumns, IMPORT_ENTITIES, IMPORT_SCHEMAS, MAX_IMPORT_ROWS, findTemplateVersion, isImportEntity } from "@workspace/import-schema";
import type { ImportFieldDescriptor } from "@workspace/import-schema";
```
Row cap in `parseAndValidateImport`, right after `const rows = parsed.data;`:
```ts
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    errors.push(tooManyRowsError(rows.length - 1));
    return { errors, changes, warnings };
  }
```
Append to the end of the file:
```ts
// ---------------------------------------------------------------------------
// SCU-2.P2.2 (B2.6) — JSON import. The JSON document is the export envelope.
// It gets NO second validator: the envelope and each row's keys/types are
// checked against @workspace/import-schema, the rows become CSV text in the
// entity's own header order, and the existing CSV validator above decides
// everything else (ids, duplicates, values, add mode). Its line numbers are
// then mapped back to document.rows indexes.
// ---------------------------------------------------------------------------

function tooManyRowsError(count: number): ImportError {
  return { errorClass: "format", line: null, message: `File has ${count} data rows; the maximum is ${MAX_IMPORT_ROWS} per import.` };
}

/** An import document straight off the wire — every field untrusted. */
export interface UntrustedImportDocument {
  templateVersion?: unknown;
  entity?: unknown;
  unit?: unknown;
  rows: unknown[];
}

export type ImportPayload =
  | { format: "csv"; csvText: string }
  | { format: "json"; document: UntrustedImportDocument };

export type ReadImportRequestResult =
  | { ok: true; entity: ImportEntity; payload: ImportPayload; mode: unknown }
  | { ok: false; status: 400 | 422; body: { error: string; errorClass?: "malformed" } };

/** Shared by POST /import and /import/apply. Runs BEFORE the ownership lookup, like the checks it replaces. */
export function readImportRequest(body: unknown): ReadImportRequestResult {
  const b = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isImportEntity(b.entity)) {
    return { ok: false, status: 422, body: { error: `entity must be one of: ${IMPORT_ENTITIES.join(", ")}` } };
  }
  const format = b.format ?? "csv";
  if (format === "csv") {
    if (typeof b.csvText !== "string") return { ok: false, status: 422, body: { error: "csvText is required" } };
    return { ok: true, entity: b.entity, payload: { format, csvText: b.csvText }, mode: b.mode };
  }
  if (format === "json") {
    const doc = b.document;
    if (doc === null || typeof doc !== "object" || Array.isArray(doc) || !Array.isArray((doc as { rows?: unknown }).rows)) {
      return { ok: false, status: 400, body: { error: "document must be a JSON object with a rows array", errorClass: "malformed" } };
    }
    return { ok: true, entity: b.entity, payload: { format, document: doc as UntrustedImportDocument }, mode: b.mode };
  }
  return { ok: false, status: 422, body: { error: "format must be 'csv' or 'json'" } };
}

export function previewImport(
  entity: ImportEntity,
  payload: ImportPayload,
  currentOverrides: ImportCurrentOverrides,
  pValue: number,
  modelId: string,
): ImportPreview {
  return payload.format === "csv"
    ? parseAndValidateImport(entity, payload.csvText, currentOverrides, pValue, modelId)
    : parseAndValidateJsonImport(entity, payload.document, currentOverrides, pValue, modelId);
}

const JSON_TYPE_PHRASE = { string: "a string", enum: "a string", number: "a number", boolean: "true or false" } as const;

/** One JSON value → its CSV cell text; undefined = wrong JSON type. null/absent → blank cell. */
function jsonCell(value: unknown, field: ImportFieldDescriptor): string | undefined {
  if (value === null || value === undefined) return "";
  if (field.type === "number") return typeof value === "number" ? String(value) : undefined;
  if (field.type === "boolean") return typeof value === "boolean" ? String(value) : undefined;
  return typeof value === "string" ? value : undefined;
}

export function parseAndValidateJsonImport(
  entity: ImportEntity,
  document: UntrustedImportDocument,
  currentOverrides: ImportCurrentOverrides,
  pValue: number,
  modelId: string = "p-median-us",
): ImportPreview {
  const formatError = (field: string, message: string): ImportPreview =>
    ({ errors: [{ errorClass: "format", line: null, field, message }], changes: [], warnings: [] });

  if (document.entity !== entity) {
    return formatError("entity", `Document entity ${JSON.stringify(document.entity)} does not match the import target "${entity}".`);
  }
  const schema = IMPORT_SCHEMAS[entity];
  const version = typeof document.templateVersion === "number" ? findTemplateVersion(entity, document.templateVersion) : undefined;
  if (!version) {
    return formatError("templateVersion", `templateVersion ${JSON.stringify(document.templateVersion)} is not supported for ${entity} (expected ${schema.versions.map(v => v.templateVersion).join(" or ")}).`);
  }
  const takesUnit = version.fields.some(f => f.envelopeKey === "unit");
  if (takesUnit && document.unit === undefined) return formatError("unit", `unit is required for ${entity} templateVersion ${version.templateVersion}.`);
  if (!takesUnit && document.unit !== undefined) return formatError("unit", `unit is not allowed for ${entity} templateVersion ${version.templateVersion}.`);
  if (document.rows.length > MAX_IMPORT_ROWS) return { errors: [tooManyRowsError(document.rows.length)], changes: [], warnings: [] };

  const allowedKeys = new Set<string>([...version.fields.map(f => f.jsonKey), ...schema.exportOnlyJsonKeys]);
  const shapeErrors: ImportError[] = [];
  const csvRows: string[][] = [];
  const rowIndexByLine = new Map<number, number>(); // CSV line (header = 1) → document.rows index

  document.rows.forEach((row, rowIndex) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      shapeErrors.push({ errorClass: "syntax", line: null, rowIndex, message: "Row must be a JSON object." });
      return;
    }
    const record = row as Record<string, unknown>;
    const unknownKey = Object.keys(record).find(k => !allowedKeys.has(k));
    if (unknownKey !== undefined) {
      shapeErrors.push({ errorClass: "syntax", line: null, rowIndex, field: unknownKey, message: `Unknown field "${unknownKey}".` });
      return;
    }
    const cells: string[] = [];
    for (const f of version.fields) {
      const value = f.jsonKey in record ? record[f.jsonKey] : f.envelopeKey ? document[f.envelopeKey] : null;
      const cell = jsonCell(value, f);
      if (cell === undefined) {
        shapeErrors.push({ errorClass: "syntax", line: null, rowIndex, field: f.jsonKey, message: `${f.jsonKey} must be ${JSON_TYPE_PHRASE[f.type]}${f.nullable ? " or null" : ""}.` });
        return;
      }
      cells.push(cell);
    }
    rowIndexByLine.set(csvRows.length + 2, rowIndex);
    csvRows.push(cells);
  });

  const csvText = Papa.unparse([version.fields.map(f => f.csvHeader), ...csvRows], { newline: "\n" });
  const csvPreview = parseAndValidateImport(entity, csvText, currentOverrides, pValue, modelId);

  const mapped: ImportError[] = csvPreview.errors.map(e => {
    const rowIndex = e.line === null ? undefined : rowIndexByLine.get(e.line);
    return rowIndex === undefined ? { ...e, line: null } : { ...e, line: null, rowIndex };
  });
  const errors = [...shapeErrors, ...mapped].sort((a, b) => (a.rowIndex ?? -1) - (b.rowIndex ?? -1));
  const changes = csvPreview.changes.map(c => {
    const rowIndex = rowIndexByLine.get(c.line)!;
    return { ...c, line: rowIndex + 2, rowIndex };
  });
  return { errors, changes, warnings: csvPreview.warnings };
}
```

- [ ] **Step 8: Server — routes + app**

`routes/scenarios.ts` imports: change `import { parseAndValidateImport } from "../services/import.js";` to `import { previewImport, readImportRequest } from "../services/import.js";` (`ImportEntity` stays imported as a type only if still referenced; remove it if unused).

Preview route (`:1599-1612`): replace the body destructure, the entity chain and the `csvText` check with:
```ts
router.post("/scenarios/:scenarioId/import", async (req, res) => {
  const id = Number(req.params.scenarioId);
  // SCU-2.P2.2 (B2.6) — entity (import-schema's list), format (default csv) and payload shape, before ownership.
  const parsedRequest = readImportRequest(req.body);
  if (!parsedRequest.ok) { res.status(parsedRequest.status).json(parsedRequest.body); return; }
  const { entity, payload } = parsedRequest;
```
and replace the final `parseAndValidateImport(...)` call (`:1678`) with:
```ts
  const preview = previewImport(entity, payload, inputs as Parameters<typeof previewImport>[2], inputs.p ?? 0, scenario.modelId);
```
Apply route (`:1682-1696`): the same three lines plus
```ts
  const applyMode = parsedRequest.mode === "partial" ? "partial" : "all_or_nothing";
```
replacing the old destructure, entity chain, `csvText` check and `applyMode` line; and replace `:1745`'s `parseAndValidateImport(...)` with the same `previewImport(...)` call. The model guards, the merge branches and `applyScenarioInputWrite` are unchanged. Remove any `entity as ImportEntity` casts that no longer compile (now redundant: `entity` is already `ImportEntity`).

`app.ts`: add `import { MAX_IMPORT_BYTES } from "@workspace/import-schema";` and replace `:68-69` with:
```ts
// SCU-2.P2.2 (B2.6) — 2 MB (was body-parser's 100 kB default). One constant
// shared with the studio's file-size guard.
app.use(express.json({ limit: MAX_IMPORT_BYTES }));
app.use(express.urlencoded({ extended: true }));

// Body-parser failures happen BEFORE any route, so they are answered here.
// Unhandled they fell through to the catch-all 500 below (measured 2026-10-17:
// a malformed body and a 150 kB body both returned 500). Placed before the
// router, so route errors never reach it.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.too.large") { res.status(413).json({ error: "payload_too_large" }); return; }
  if (type === "entity.parse.failed") { res.status(400).json({ error: "Request body is not valid JSON.", errorClass: "malformed" }); return; }
  next(err);
});
```

- [ ] **Step 9: Run the server tests to verify they pass**

Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/importJsonRoundTrip.test.ts src/__tests__/importSchemaContract.test.ts src/__tests__/import.test.ts src/__tests__/importMultiModelRoundTrip.test.ts src/__tests__/routes.test.ts src/__tests__/error-handling.test.ts src/__tests__/importSchemaRouteParity.test.ts`
Expected: PASS.

- [ ] **Step 10: Write the failing ImportDialog tests**

Append to `artifacts/studio/src/__tests__/ImportDialog.test.tsx` (it already has `fetchMock`, `jsonResponse`, `errorResponse`, `mockFetchRoutes`, `renderDialog`, `uploadFile`). Add `import { MAX_IMPORT_BYTES } from "@workspace/import-schema";` to the imports:
```tsx
describe("ImportDialog — JSON format and the 2 MB limit (SCU-2.P2.2)", () => {
  const document = {
    templateVersion: 1,
    entity: "warehouses",
    rows: [{ templateVersion: 1, id: "ATL", displayCode: null, city: "Atlanta", state: "GA", lat: 33.75, lng: -84.39, capacity: null, status: "forced_open", overridden: true }],
  };
  const sentBody = (call = 0) => JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body));
  const LIMIT = "File is larger than the 2 MB import limit.";

  it("csv (default) keeps accept=.csv and still sends { entity, csvText } with no format key", async () => {
    mockFetchRoutes({ errors: [], changes: [], warnings: [] });
    renderDialog();
    expect(screen.getByTestId("input-import-file-warehouses")).toHaveAttribute("accept", ".csv,text/csv");
    await uploadFile();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ entity: "warehouses", csvText: "id,line\nCHI,2" });
  });

  it("json sends { entity, format: 'json', document } and re-sends it with the mode on apply", async () => {
    mockFetchRoutes(
      { errors: [], changes: [{ id: "ATL", line: 2, rowIndex: 0, before: { status: "active", value: null }, after: { status: "forced_open", value: null } }], warnings: [] },
      { applied: 1, errors: [] },
    );
    renderDialog({ format: "json" });
    const input = screen.getByTestId("input-import-file-warehouses");
    expect(input).toHaveAttribute("accept", ".json,application/json");
    await userEvent.upload(input, new File([JSON.stringify(document)], "warehouses.json", { type: "application/json" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(0)).toEqual({ entity: "warehouses", format: "json", document });
    await userEvent.click(await screen.findByTestId("button-import-confirm"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody(1)).toEqual({ entity: "warehouses", format: "json", document, mode: "all_or_nothing" });
  });

  it("a file that is not a JSON document is rejected before any request", async () => {
    renderDialog({ format: "json" });
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), new File(["{not json"], "bad.json", { type: "application/json" }));
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent("not a valid import document");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a file over 2 MB is rejected before any request, naming the limit", async () => {
    renderDialog();
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), new File(["x".repeat(MAX_IMPORT_BYTES + 1)], "big.csv", { type: "text/csv" }));
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent(LIMIT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a server 413 shows the limit sentence, never the raw code", async () => {
    fetchMock.mockImplementation(async () => errorResponse({ error: "payload_too_large" }, 413, "Payload Too Large"));
    renderDialog();
    await uploadFile();
    const shown = await screen.findByTestId("import-preview-error");
    expect(shown).toHaveTextContent(LIMIT);
    expect(shown).not.toHaveTextContent("payload_too_large");
  });

  it("JSON errors and changes show their row index", async () => {
    mockFetchRoutes({
      errors: [{ errorClass: "syntax", line: null, rowIndex: 3, field: "bogus", message: 'Unknown field "bogus".' }],
      changes: [{ id: "ATL", line: 3, rowIndex: 1, before: { status: "active", value: null }, after: { status: "forced_open", value: null } }],
      warnings: [],
    });
    renderDialog({ format: "json" });
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), new File([JSON.stringify(document)], "w.json", { type: "application/json" }));
    expect(await screen.findByTestId("import-error-row-0")).toHaveTextContent("row 3");
    expect(screen.getByTestId("import-change-row-0")).toHaveTextContent("row 1");
  });
});
```
Run: `pnpm --filter studio exec vitest run src/__tests__/ImportDialog.test.tsx`
Expected: FAIL (no `format` prop, no `import-file-error`, raw `payload_too_large` shown). The pre-existing tests in the file still pass.

- [ ] **Step 11: Rewrite `ImportDialog.tsx`**

Replace lines 1–74 (imports through `handleConfirm`) with:
```tsx
import { useState } from "react";
import {
  usePreviewScenarioImport,
  useApplyScenarioImport,
} from "@workspace/api-client-react";
import type { Scenario, ImportApplyMode, ImportDocument, ImportError, ImportRequest, ImportRowChange } from "@workspace/api-client-react";
import { MAX_IMPORT_BYTES, type ImportEntity } from "@workspace/import-schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { describeWriteError } from "@/lib/describeWriteError";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarioId: number;
  // SCU-2.P2.2 — @workspace/import-schema's IMPORT_ENTITIES, the list the OpenAPI
  // ImportEntity enum is pinned to (importSchemaContract.test.ts). Passing it
  // into the generated request type is a compile-time check of the same thing.
  entity: ImportEntity;
  /** SCU-2.P2.2 (B2.6) — which file the user picks. Defaults to csv (every existing caller). */
  format?: "csv" | "json";
  onApplied?: (scenario: Scenario) => void;
  /** B7 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in gate for the shared
   * A3 `FilterMenu`/`useTableFilters`, wired into the Errors and Changes
   * preview grids as TWO SEPARATE tables — each shows/hides its own
   * FilterMenu by its own unfiltered row count (spec §10's explicit call-
   * out). Defaults `false`: every existing caller (every non-JADE
   * ImportDialog usage) is byte-identical to before this task. */
  enableFilters?: boolean;
}

const LIMIT_MESSAGE = `File is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB import limit.`;

/** A 413 is the body limit; say it the way the client-side guard does, never as the raw code. */
function describeImportError(err: unknown, fallback: string): string {
  return (err as { status?: unknown } | null)?.status === 413 ? LIMIT_MESSAGE : describeWriteError(err, fallback);
}

/** null unless the text is a JSON object with a rows array (anything else the server would 400). */
function parseJsonDocument(text: string): ImportDocument | null {
  try {
    const doc: unknown = JSON.parse(text);
    if (doc !== null && typeof doc === "object" && !Array.isArray(doc) && Array.isArray((doc as { rows?: unknown }).rows)) {
      return doc as ImportDocument;
    }
  } catch {
    // not JSON — fall through
  }
  return null;
}

const rowLabel = (rowIndex: number | undefined) => (rowIndex === undefined ? undefined : `row ${rowIndex}`);

export function ImportDialog({ open, onOpenChange, scenarioId, entity, format = "csv", onApplied, enableFilters = false }: ImportDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportApplyMode>("all_or_nothing");

  const previewMutation = usePreviewScenarioImport();
  const applyMutation = useApplyScenarioImport();

  function reset() {
    setFileName(null);
    setRequest(null);
    setFileError(null);
    setMode("all_or_nothing");
    previewMutation.reset();
    applyMutation.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    applyMutation.reset();
    previewMutation.reset();
    setRequest(null);
    setFileName(file.name);
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError(LIMIT_MESSAGE);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      let next: ImportRequest;
      if (format === "json") {
        const document = parseJsonDocument(text);
        if (!document) {
          setFileError("File is not a valid import document (a JSON object with a rows array).");
          return;
        }
        next = { entity, format: "json", document };
      } else {
        next = { entity, csvText: text };
      }
      setFileError(null);
      setRequest(next);
      previewMutation.mutate({ scenarioId, data: next });
    };
    reader.readAsText(file);
  }

  function handleConfirm() {
    if (!request) return;
    applyMutation.mutate(
      { scenarioId, data: { ...request, mode } },
      {
        onSuccess: (result) => {
          toast({
            title: "Import applied",
            description: `${result.applied} change${result.applied === 1 ? "" : "s"} applied${
              result.errors.length ? `, ${result.errors.length} row(s) skipped` : ""
            }.`,
          });
          if (result.scenario) onApplied?.(result.scenario);
          handleOpenChange(false);
        },
      }
    );
  }
```
In the JSX below it:
- the file input: `accept={format === "json" ? ".json,application/json" : ".csv,text/csv"}` (testid unchanged);
- right after the `{fileName && …}` span's parent `div`, add
```tsx
          {fileError && (
            <p className="text-xs text-destructive" data-testid="import-file-error">{fileError}</p>
          )}
```
- `describeWriteError(previewMutation.error, "Could not parse file.")` → `describeImportError(previewMutation.error, "Could not parse file.")`, and the same for `applyMutation.error, "Import failed."`;
- error Line cell: `{err.line ?? rowLabel(err.rowIndex) ?? "—"}`;
- change Line cell: `{rowLabel(c.rowIndex) ?? c.line}`.

- [ ] **Step 12: Run studio tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/ImportDialog.test.tsx`
Expected: PASS (old and new tests).

- [ ] **Step 13: e2e sweep**

```bash
grep -rln "input-import-file\|import-preview-error\|import-error-row\|import-change-row\|Could not parse file\|Import failed\|entity must be\|csvText is required" artifacts/studio/e2e
```
Expected hits: `import.spec.ts`, `input-map-v2.spec.ts`, `jade-two-echelon.spec.ts`, `max-coverage.spec.ts`, `workspace-fixups.spec.ts` (all for `input-import-file-*`, whose testid and CSV `accept` are unchanged); none for the other strings. Open each hit and confirm that it uploads a `.csv`, so no rewrite is needed. If the local two-server setup is up, run `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/import.spec.ts`; otherwise record `e2e: not run — sweep only`.

- [ ] **Step 14: Gate** — the three gate commands, each separately; `git diff --stat "$BASE"..HEAD -- lib/db/src/schema/` → empty.

- [ ] **Step 15: Changelog** — append `### SCU-2.P2.2 — JSON import contract (B2.6)`. Record: the oneOf request shapes; the 2 MB limit + 413/400 handler (measured before: 500 for both); the 20,000-row cap for CSV and JSON; `rowIndex`/`field`; deviations 1, 2, 10, 11, 12; `REGEN-STABLE`; the round-trip case count (16); the gate counts from this run; the e2e sweep result.

- [ ] **Step 16: Commit**

```bash
git add -A lib/api-zod/src/generated lib/api-client-react/src/generated
git add artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts artifacts/api-server/src/__tests__/importSchemaContract.test.ts
```
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated artifacts/api-server/src/app.ts artifacts/api-server/src/services/import.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts artifacts/api-server/src/__tests__/importSchemaContract.test.ts artifacts/studio/src/components/ImportDialog.tsx artifacts/studio/src/__tests__/ImportDialog.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P2.2] accept the JSON export envelope on import (oneOf, 2 MB, 20k rows)" -m "Deviations 1 (400 malformed / 413 via body-parser handler), 2 (rowIndex on changes), 11 (entity check from import-schema), 12 (ImportDialog row labels). Spec + regenerated client in one commit." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P2.3: `deliveryCosts` entity — closed-union change (B2.7, D1)

**Owner role:** backend-engineer. **Spec:** B2.7, D1. **Deviation:** 6. **Depends on:** SCU-2.P2.2.

**Files:**
- Modify: `lib/import-schema/src/index.ts` (+ `src/__tests__/importSchema.test.ts`)
- Modify: `lib/api-spec/openapi.yaml` (`ImportEntity` enum; export `entity` query enum `:522`; `ExportEnvelopeV1` description + enum `:2027-2047`; `ExportEnvelope` description `:2270-2277`) + regenerated `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`
- Modify: `artifacts/api-server/src/services/import.ts` (`SingleIdEntity`, header check, dispatch, parser, `deliveryBaseCost`)
- Modify: `artifacts/api-server/src/services/templates.ts` (`DeliveryCostRow`, `applyDeliveryCostOverrides`, `deliveryCostRowsToCsv`)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (export allowlist `:618-620`; delivery guard in export `:894,915-916`, import `:1655,1658-1659`, apply `:1731,1734-1735`; delivery export branch `:1282`; apply merge branch before the refineries `else`)
- Modify: `artifacts/studio/src/lib/exportEntity.ts:9`, `artifacts/studio/src/contexts/ExportContext.tsx:20-38`, `artifacts/studio/src/__tests__/ExportContext.test.tsx`
- Create: `artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts`, `artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts`
- Modify: `artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts` (one case), `artifacts/api-server/src/__tests__/importSchemaContract.test.ts` (two tests)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: everything SCU-2.P2.1/2.P2.2 produce.
- Produces:
```ts
// lib/import-schema
IMPORT_ENTITIES // now ends with "deliveryCosts"
IMPORT_SCHEMAS.deliveryCosts // models ["delivery-teaching-us"], addModels [], one v1 version:
// template_version, from_id, to_id, cost (number, min 0 inclusive, NO unitFamily), exportOnlyJsonKeys []
// services/templates.ts
export interface DeliveryCostRow { fromId: string; toId: string; cost: number } // cost = billable miles, no unit
export function applyDeliveryCostOverrides(overrides: Array<{ fromId: string; toId: string; cost: number }>): DeliveryCostRow[];
export function deliveryCostRowsToCsv(rows: DeliveryCostRow[]): string; // header "template_version,from_id,to_id,cost"
// services/import.ts
export function deliveryBaseCost(fromId: string, toId: string): number | undefined;
// wire: GET /export?entity=deliveryCosts&format=json → { templateVersion: 1, entity: "deliveryCosts", rows: DeliveryCostRow[] } (no unit)
// studio: ExportEntity and INPUT_ENTITIES include "deliveryCosts"; ImportDialog accepts entity="deliveryCosts" via ImportEntity.
```

- [ ] **Step 0: Skills.** `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Worktree check + install** — `cd /Users/shubhamkr/nos-scu-2.p2.3 && git rev-parse --abbrev-ref HEAD` → `scu-2.p2.3-work`; base guard; `pnpm install --frozen-lockfile`.

- [ ] **Step 2: Write the failing tests**

Add to `lib/import-schema/src/__tests__/importSchema.test.ts`: the `LITERAL_COLUMNS` entry `deliveryCosts: { 1: ["template_version", "from_id", "to_id", "cost"] },` and
```ts
describe("deliveryCosts (D1)", () => {
  it("is v1-only, unitless, cost ≥ 0 inclusive, delivery-only, no add mode", () => {
    const s = IMPORT_SCHEMAS.deliveryCosts;
    expect(s.models).toEqual(["delivery-teaching-us"]);
    expect(s.addModels).toEqual([]);
    expect(s.versions.map(v => v.templateVersion)).toEqual([TEMPLATE_VERSION]);
    const cost = s.versions[0]!.fields.find(f => f.csvHeader === "cost")!;
    expect(cost).toMatchObject({ type: "number", min: 0, requiredForUpdate: true });
    expect(cost.exclusiveMin).toBeUndefined();
    expect(cost.unitFamily).toBeUndefined(); // billable miles — never unit-converted
    expect(exampleJsonDocument("deliveryCosts")).toEqual({ templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", rows: [{ fromId: "W8", toId: "C269", cost: 1047.7157 }] });
  });
});
```

`artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts`:
```ts
// SCU-2.P2.3 (B2.7, D1) — pure tests of the deliveryCosts parser and writer.
// Base values measured from solvers/delivery-teaching-us/dataset/costs.json:
// "W8,C269" = 1047.7157, "W8,C8" = 0 (one of 33 zero-cost base lanes out of 10,329).
import { describe, it, expect } from "vitest";
import { TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import { parseAndValidateImport, parseAndValidateJsonImport, deliveryBaseCost } from "../services/import.js";
import { applyDeliveryCostOverrides, deliveryCostRowsToCsv } from "../services/templates.js";

const M = "delivery-teaching-us";
const HEADER = csvColumns("deliveryCosts", TEMPLATE_VERSION).join(",");
const csv = (...lines: string[]) => `${HEADER}\n${lines.join("\n")}\n`;
const run = (text: string, laneCostOverrides: Array<{ fromId: string; toId: string; cost: number }> = []) =>
  parseAndValidateImport("deliveryCosts", text, { laneCostOverrides }, 3, M);

describe("deliveryCosts import", () => {
  it("exposes the base matrix", () => {
    expect(deliveryBaseCost("W8", "C269")).toBe(1047.7157);
    expect(deliveryBaseCost("W8", "C8")).toBe(0);
    expect(deliveryBaseCost("W8", "C99999")).toBeUndefined();
  });

  it("a new cost on a base pair is a change from the base value", () => {
    const r = run(csv(`${TEMPLATE_VERSION},W8,C269,1`));
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([{ id: "W8|C269", line: 2, before: { status: "active", value: 1047.7157 }, after: { status: "active", value: 1 }, fromId: "W8", toId: "C269" }]);
  });

  it("a cost equal to base with no override is no change; with an override it is a change back to base", () => {
    expect(run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`)).changes).toEqual([]);
    const back = run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`), [{ fromId: "W8", toId: "C269", cost: 1 }]);
    expect(back.changes).toEqual([expect.objectContaining({ before: { status: "active", value: 1 }, after: { status: "active", value: 1047.7157 } })]);
  });

  it("zero is a legal cost", () => {
    expect(run(csv(`${TEMPLATE_VERSION},W8,C269,0`)).errors).toEqual([]);
    expect(run(csv(`${TEMPLATE_VERSION},W8,C8,0`)).changes).toEqual([]);
  });

  it("rejects blank (deviation 6), negative and non-numeric cost", () => {
    for (const cost of ["", "-1", "abc"]) {
      expect(run(csv(`${TEMPLATE_VERSION},W8,C269,${cost}`)).errors).toEqual([expect.objectContaining({ errorClass: "logic", line: 2 })]);
    }
  });

  it("rejects a pair outside the base matrix, duplicates, wrong version, wrong header", () => {
    expect(run(csv(`${TEMPLATE_VERSION},W8,C99999,1`)).errors[0]!.message).toMatch(/base cost matrix/);
    expect(run(csv(`${TEMPLATE_VERSION},W8,C269,1`, `${TEMPLATE_VERSION},W8,C269,2`)).errors).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining("Duplicate") })]);
    expect(run(csv(`2,W8,C269,1`)).errors[0]!.message).toMatch(/template_version/);
    expect(run("template_version,unit,from_id,to_id,cost\n2,mi,W8,C269,1\n").errors[0]).toMatchObject({ errorClass: "format", line: 1 });
  });

  it("JSON rows {fromId,toId,cost} import through the same rules", () => {
    const p = parseAndValidateJsonImport("deliveryCosts", { templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", rows: [{ fromId: "W8", toId: "C269", cost: 1 }] }, {}, 3, M);
    expect(p.errors).toEqual([]);
    expect(p.changes).toEqual([expect.objectContaining({ rowIndex: 0, after: { status: "active", value: 1 } })]);
    const withUnit = parseAndValidateJsonImport("deliveryCosts", { templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", unit: "mi", rows: [] }, {}, 3, M);
    expect(withUnit.errors).toEqual([expect.objectContaining({ field: "unit" })]); // no unit field on deliveryCosts
  });
});

describe("deliveryCosts export", () => {
  it("emits only overridden pairs, unconverted, under the import header", () => {
    const rows = applyDeliveryCostOverrides([{ fromId: "W8", toId: "C269", cost: 1 }]);
    expect(rows).toEqual([{ fromId: "W8", toId: "C269", cost: 1 }]);
    expect(deliveryCostRowsToCsv(rows)).toBe(`${HEADER}\n${TEMPLATE_VERSION},W8,C269,1\n`);
    expect(run(deliveryCostRowsToCsv(rows)).changes).toHaveLength(1); // export → import closes
  });
});
```

`artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts` (real Postgres, same conventions as `importJsonRoundTrip.test.ts`):
```ts
// SCU-2.P2.3 (B2.7, D1) — deliveryCosts through the real routes: apply
// persists into inputs.laneCostOverrides, cost === base removes the override,
// CSV round trip, unknown pair is all-or-nothing. Sibling-model 422s are
// covered for all 7 models by importSchemaRouteParity.test.ts.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";

beforeEach(() => { setLockedModelsForTests([]); });

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

const DELIVERY = { p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120, costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [], warehouseOverrides: [], customerOverrides: [] };
const HEADER = csvColumns("deliveryCosts", TEMPLATE_VERSION).join(",");
let cookie = "";

beforeAll(async () => {
  const email = `scu-p2-3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const reg = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(reg.status).toBe(201);
  userIds.push(reg.body.user.id);
  cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
});

async function create(laneCostOverrides: Array<{ fromId: string; toId: string; cost: number }> = []): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({ name: "scu-p2-3", modelId: "delivery-teaching-us", inputs: { ...DELIVERY, laneCostOverrides } });
  expect(res.status).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}
const overridesOf = async (id: number) => (await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie)).body.inputs.laneCostOverrides;
const applyCsv = (id: number, csvText: string, mode = "all_or_nothing") =>
  request(app).post(`/api/scenarios/${id}/import/apply`).set("Cookie", cookie).send({ entity: "deliveryCosts", csvText, mode });

describe("deliveryCosts routes", () => {
  it("apply upserts into inputs.laneCostOverrides (zero allowed)", async () => {
    const id = await create();
    const res = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,0\n`);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(await overridesOf(id)).toEqual([{ fromId: "W8", toId: "C269", cost: 0 }]);
  });

  it("a cost equal to base removes the override (stays sparse)", async () => {
    const id = await create([{ fromId: "W8", toId: "C269", cost: 1 }]);
    expect((await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,1047.7157\n`)).status).toBe(200);
    expect(await overridesOf(id)).toEqual([]);
    const exp = await request(app).get(`/api/scenarios/${id}/export`).query({ entity: "deliveryCosts", format: "json" }).set("Cookie", cookie);
    expect(exp.body).toEqual({ templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", rows: [] });
  });

  it("CSV export → CSV import into a fresh scenario reproduces the overrides", async () => {
    const source = await create([{ fromId: "W8", toId: "C269", cost: 1 }, { fromId: "W8", toId: "C8", cost: 7 }]);
    const csvText = (await request(app).get(`/api/scenarios/${source}/export`).query({ entity: "deliveryCosts", format: "csv" }).set("Cookie", cookie)).text;
    expect(csvText.startsWith(`${HEADER}\n`)).toBe(true);
    const target = await create();
    expect((await applyCsv(target, csvText)).status).toBe(200);
    expect(await overridesOf(target)).toEqual(await overridesOf(source));
  });

  it("an unknown pair blocks an all-or-nothing apply and changes nothing", async () => {
    const id = await create([{ fromId: "W8", toId: "C269", cost: 1 }]);
    const res = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C99999,1\n${TEMPLATE_VERSION},W8,C269,2\n`);
    expect(res.status).toBe(422);
    expect(res.body.preview.errors).toHaveLength(1);
    expect(await overridesOf(id)).toEqual([{ fromId: "W8", toId: "C269", cost: 1 }]);
  });

  it("a non-owner gets 404", async () => {
    const id = await create();
    const other = await request(app).post("/api/auth/register").send({ email: `scu-p2-3-x-${Date.now()}@example.test`, password: "correct horse battery" });
    userIds.push(other.body.user.id);
    const otherCookie = (other.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const res = await request(app).post(`/api/scenarios/${id}/import`).set("Cookie", otherCookie).send({ entity: "deliveryCosts", csvText: `${HEADER}\n` });
    expect(res.status).toBe(404);
  });
});
```

In `importJsonRoundTrip.test.ts`, append to `ROUND_TRIP_CASES`:
```ts
  { name: "delivery deliveryCosts", modelId: "delivery-teaching-us", entity: "deliveryCosts", overrides: { laneCostOverrides: [{ fromId: "W8", toId: "C269", cost: 1 }] }, expectChanges: true },
```
In `importSchemaContract.test.ts`, add `ExportScenarioResponse` to the api-zod import, `applyDeliveryCostOverrides` to the templates import, and:
```ts
  it("a populated deliveryCosts export envelope satisfies the export contract (v1, no unit)", () => {
    const envelope = { templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", rows: applyDeliveryCostOverrides([{ fromId: "W8", toId: "C269", cost: 1 }]) };
    expect(envelope.rows.length).toBeGreaterThan(0);
    expect(ExportScenarioResponse.safeParse(envelope).success).toBe(true);
  });
```
In `artifacts/studio/src/__tests__/ExportContext.test.tsx`, inside `describe("disabledReasonFor", …)`, add:
```tsx
    it("classifies deliveryCosts as an input entity (history lock applies)", () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({ scenarioId: 1, unit: "mi", inputDisabledReason: "history", resultDisabledReason: "result" }),
      });
      expect(INPUT_ENTITIES).toContain("deliveryCosts");
      expect(result.current.disabledReasonFor("deliveryCosts")).toBe("history");
    });
```
(`exportProviderWrapper(overrides: Partial<ExportProviderValue>)` from `@/__tests__/helpers/renderWithExportProvider`, already imported by this file.)

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @workspace/import-schema test` → FAIL (no `deliveryCosts` schema).
Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/deliveryCostsImport.test.ts src/__tests__/deliveryCostsImportRoute.test.ts` → FAIL (`deliveryBaseCost` / `applyDeliveryCostOverrides` not exported; routes 422 `entity must be one of`).

- [ ] **Step 4: Package entry**

In `lib/import-schema/src/index.ts`, append `"deliveryCosts",` to `IMPORT_ENTITIES` (last), and add to `IMPORT_SCHEMAS`:
```ts
  deliveryCosts: {
    entity: "deliveryCosts",
    models: ["delivery-teaching-us"],
    addModels: [],
    // D1 — sparse overrides of inputs.laneCostOverrides. cost = BILLABLE MILES:
    // never unit-converted, so v1 only and no unitFamily (unlike laneCosts).
    versions: pairVersions("W8", "C269", field({ csvHeader: "cost", type: "number", ...ALWAYS, min: 0, example: "1047.7157" }), false),
    exportOnlyJsonKeys: [],
  },
```

- [ ] **Step 5: OpenAPI + regen**

In `lib/api-spec/openapi.yaml`:
- `ImportEntity.enum`: append `deliveryCosts`.
- `/scenarios/{scenarioId}/export` → `entity` query `enum`: append `deliveryCosts`.
- `ExportEnvelopeV1`: description `Unitless export entities (warehouses, customers, mines, stations, refineries, plants, plantCapabilities, deliveryCosts, openWarehouses). …` (keep the rest) and `entity.enum`: append `deliveryCosts`.
- `ExportEnvelope` description: `v1 unitless (warehouses/customers/mines/stations/refineries/plants/ plantCapabilities/deliveryCosts/openWarehouses)`.

Then run Step 5 of SCU-2.P2.2 verbatim (codegen, shasum, codegen, diff → `REGEN-STABLE`).

- [ ] **Step 6: Server**

`services/import.ts`:
- `type SingleIdEntity = Exclude<ImportEntity, "distances" | "laneCosts" | "legDistances" | "plantCapabilities" | "deliveryCosts">;` (TypeScript forces this: `COLUMNS` is a `Record<SingleIdEntity, …>`).
- Add `import { getReferenceCosts } from "../data/referenceCosts.js";` and, below `PLANT_CAPABILITY_COLUMNS`:
```ts
// SCU-2.P2.3 (B2.7, D1) — delivery-teaching-us's lane-cost overrides. The
// base matrix is the same immutable 33×313 table GET /models/:id/reference-costs serves.
const DELIVERY_COST_COLUMNS = csvColumns("deliveryCosts", TEMPLATE_VERSION);
const deliveryReference = getReferenceCosts("delivery-teaching-us");
if (!deliveryReference) throw new Error("import.ts: delivery-teaching-us reference costs are not registered");
const DELIVERY_BASE_COST_BY_PAIR: ReadonlyMap<string, number> = new Map(deliveryReference.pairs.map(p => [`${p.fromId}|${p.toId}`, p.cost]));

export function deliveryBaseCost(fromId: string, toId: string): number | undefined {
  return DELIVERY_BASE_COST_BY_PAIR.get(`${fromId}|${toId}`);
}
```
- Header check `else` branch: `entity === "plantCapabilities" ? PLANT_CAPABILITY_COLUMNS : entity === "deliveryCosts" ? DELIVERY_COST_COLUMNS : COLUMNS[entity as SingleIdEntity];`
- After the `plantCapabilities` dispatch block:
```ts
  if (entity === "deliveryCosts") {
    const deliveryResult = parseDeliveryCostRows(rows.slice(1), currentOverrides.laneCostOverrides ?? []);
    return { errors: deliveryResult.errors, changes: deliveryResult.changes, warnings: [] };
  }
```
- Add the parser next to `parsePlantCapabilityRows`:
```ts
// SCU-2.P2.3 (B2.7, D1). `before` is the EFFECTIVE cost (override ?? base),
// so re-importing an export is a no-op and a row equal to base on an
// overridden pair is a real change (the apply route then drops the override).
function parseDeliveryCostRows(
  dataRows: string[][],
  currentOverrides: LaneCostOverride[],
): { errors: ImportError[]; changes: ImportRowChange[] } {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const overrideByPair = new Map(currentOverrides.map(o => [`${o.fromId}|${o.toId}`, o.cost]));
  const seenPairs = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];
    if (cols.length !== DELIVERY_COST_COLUMNS.length) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${DELIVERY_COST_COLUMNS.length} columns, got ${cols.length}` });
      continue;
    }
    const [tvStr, fromId, toId, costStr] = cols;
    if (Number(tvStr) !== TEMPLATE_VERSION) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${TEMPLATE_VERSION}` });
      continue;
    }
    const pairKey = `${fromId}|${toId}`;
    const base = DELIVERY_BASE_COST_BY_PAIR.get(pairKey);
    if (base === undefined) {
      errors.push({ errorClass: "logic", line, message: `Unknown lane (from_id "${fromId}", to_id "${toId}") — must be a warehouse→customer pair in the base cost matrix` });
      continue;
    }
    if (seenPairs.has(pairKey)) {
      errors.push({ errorClass: "logic", line, message: `Duplicate (from_id,to_id) pair "${pairKey}"` });
      continue;
    }
    seenPairs.add(pairKey);
    // Deviation 6: Number("") is 0, a legal cost here — a blank cell must not become a 0 override.
    const cost = costStr.trim() === "" ? NaN : Number(costStr);
    if (!Number.isFinite(cost) || cost < 0) {
      errors.push({ errorClass: "logic", line, message: `cost must be a non-negative number, got "${costStr}"` });
      continue;
    }
    const before = overrideByPair.get(pairKey) ?? base;
    if (before !== cost) {
      changes.push({ id: pairKey, line, before: { status: "active", value: before }, after: { status: "active", value: cost }, fromId, toId });
    }
  }
  return { errors, changes };
}
```

`services/templates.ts` (after `laneCostRowsToCsv`):
```ts
// SCU-2.P2.3 (B2.7, D1) — delivery-teaching-us's laneCostOverrides as an
// import/export entity. SPARSE (only overridden pairs, like distances/
// laneCosts). `cost` is billable miles and is never unit-converted, so this is
// a v1 unitless entity with no `unit` field — unlike transport laneCosts.
export interface DeliveryCostRow { fromId: string; toId: string; cost: number; }

export function applyDeliveryCostOverrides(overrides: Array<{ fromId: string; toId: string; cost: number }>): DeliveryCostRow[] {
  return overrides.map(o => ({ fromId: o.fromId, toId: o.toId, cost: o.cost }));
}

export function deliveryCostRowsToCsv(rows: DeliveryCostRow[]): string {
  const header = csvColumns("deliveryCosts", TEMPLATE_VERSION).join(",");
  const lines = rows.map(r => [TEMPLATE_VERSION, r.fromId, r.toId, r.cost].join(","));
  return [header, ...lines].join("\n") + "\n";
}
```

`routes/scenarios.ts`:
- Import `applyDeliveryCostOverrides`, `deliveryCostRowsToCsv` from templates and `deliveryBaseCost` from import.
- Export allowlist `:618`: add `&& entity !== "deliveryCosts"` before `&& !OUTPUT_ENTITIES…`, and add `'deliveryCosts'` to the 422 message list.
- The three `entityIsDelivery` lines (`:894`, `:1655`, `:1731`): `entity === "warehouses" || entity === "customers" || entity === "deliveryCosts"`. The three messages: `delivery-teaching-us scenarios only support warehouses/customers/deliveryCosts export|import`.
- Delivery export branch (`:1282`): extend its `inputs` cast with `laneCostOverrides?: Parameters<typeof applyDeliveryCostOverrides>[0];` and add first inside the branch:
```ts
    if (entity === "deliveryCosts") {
      const rows = applyDeliveryCostOverrides(inputs.laneCostOverrides ?? []);
      posthog?.capture({
        distinctId: req.userId!,
        event: "scenario data exported",
        properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
      });
      if (format === "csv") {
        res.type("text/csv").send(deliveryCostRowsToCsv(rows));
        return;
      }
      res.json({ templateVersion: TEMPLATE_VERSION, entity, rows });
      return;
    }
```
- Next to `mergeLaneCostChangesIntoOverrides`:
```ts
// SCU-2.P2.3 (B2.7, D1) — upsert; a row whose cost equals the base matrix
// REMOVES the override, keeping laneCostOverrides sparse.
function mergeDeliveryCostChangesIntoOverrides(
  currentOverrides: Array<{ fromId: string; toId: string; cost: number }>,
  changes: ImportRowChange[],
): Array<{ fromId: string; toId: string; cost: number }> {
  const changedKeys = new Set(changes.map(c => `${c.fromId}|${c.toId}`));
  const rest = currentOverrides.filter(o => !changedKeys.has(`${o.fromId}|${o.toId}`));
  const applied = changes
    .filter(c => c.after.value !== deliveryBaseCost(c.fromId!, c.toId!))
    .map(c => ({ fromId: c.fromId!, toId: c.toId!, cost: c.after.value! }));
  return [...rest, ...applied];
}
```
- In the apply route, insert **before** `} else if (entity === "warehouses" || entity === "customers") {` — and in any case before the final refineries `else`, which would otherwise swallow `deliveryCosts` silently:
```ts
  } else if (entity === "deliveryCosts") {
    nextInputs = { ...inputs, laneCostOverrides: mergeDeliveryCostChangesIntoOverrides(inputs.laneCostOverrides ?? [], preview.changes) };
```
The import/apply entity allowlist needs no edit: it is `isImportEntity` since SCU-2.P2.2.

- [ ] **Step 7: Studio unions**

`artifacts/studio/src/lib/exportEntity.ts:9`: append `| "deliveryCosts"` to `ExportEntity` (the generated `exportScenario` call now type-checks it against the regenerated enum).
`artifacts/studio/src/contexts/ExportContext.tsx`: append `"deliveryCosts",` to `INPUT_ENTITIES`, and change its doc comment from "The ten input entities." to "The eleven input entities." The compile-time partition proof (`_AssertPartitionIsExact`) then holds.
`ImportDialog` needs nothing: its `entity` is `ImportEntity` from the package.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @workspace/import-schema test`
Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/deliveryCostsImport.test.ts src/__tests__/deliveryCostsImportRoute.test.ts src/__tests__/importJsonRoundTrip.test.ts src/__tests__/importSchemaContract.test.ts src/__tests__/importSchemaParity.test.ts src/__tests__/importSchemaRouteParity.test.ts src/__tests__/import.test.ts src/__tests__/referenceCosts.test.ts`
Run: `pnpm --filter studio exec vitest run src/__tests__/ExportContext.test.tsx src/__tests__/ImportDialog.test.tsx src/__tests__/DeliveryCostsTab.test.tsx`
Expected: PASS. The route-parity file now runs 77 entity×model cases (11×7). Parity covers `deliveryCosts.cost` blank → error (deviation 6), 0 accepted and −1 rejected. `DeliveryCostsTab.test.tsx` is unchanged (spec B2.7).

- [ ] **Step 9: Solver + journey scripts** (spec "After P2")

`solve.py` is untouched in this phase. Run, each separately:
```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```
Start a local API in the background: `PORT=3001 DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server run dev`. Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/healthz` prints `200`. Then:
```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 delivery
```
```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 transport
```
Stop the server. Expected: each exits 0 with no `FAIL` line. Record the results verbatim. Never edit either script (`e2e_accuracy.py` is sacred).

- [ ] **Step 10: e2e sweep**

```bash
grep -rn "deliveryCosts\|only support warehouses/customers" artifacts/studio/e2e
```
Expected: only `delivery-teaching.spec.ts:188,240` (`sidebar-input-deliveryCosts`, unrelated to this change). No rewrite.

- [ ] **Step 11: Gate** — the three gate commands, each separately; `git diff --stat "$BASE"..HEAD -- lib/db/src/schema/` → empty.

- [ ] **Step 12: Changelog** — append `### SCU-2.P2.3 — deliveryCosts entity (B2.7, D1)`. Record: the closed-union checklist (package, OpenAPI ×3 enums, regen `REGEN-STABLE`, service union, export allowlist, 3 delivery guards, export branch, apply branch, `ExportEntity`, `INPUT_ENTITIES`); sparse + cost-equals-base removal; deviation 6; route-parity 77 cases; the `e2e_accuracy.py` and `e2e_journey.py` delivery/transport results; gate counts from this run; lib/db schema unchanged. Close the phase with: `P2 complete — P3/P4 consume IMPORT_SCHEMAS, exampleCsv/exampleJsonDocument, MAX_IMPORT_BYTES, ImportDialog format, ImportError.rowIndex/field.`

- [ ] **Step 13: Commit**

```bash
git add -A lib/api-zod/src/generated lib/api-client-react/src/generated
git add artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts
```
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit lib/import-schema lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated artifacts/api-server/src/services/import.ts artifacts/api-server/src/services/templates.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts artifacts/api-server/src/__tests__/importSchemaContract.test.ts artifacts/studio/src/lib/exportEntity.ts artifacts/studio/src/contexts/ExportContext.tsx artifacts/studio/src/__tests__/ExportContext.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P2.3] add deliveryCosts import/export entity (sparse, billable miles)" -m "D1: only overridden pairs; cost equal to base removes the override; no unit. Deviation 6: blank cost rejected. Closed-union change in one commit: package, OpenAPI, regen, server, studio unions." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (self-review)

| Spec item | Task / step |
|---|---|
| B2.5 content: csvHeader/jsonKey, type, nullable, requiredForAdd/Update, enum, min (max: deviation 9), unitFamily, example, models; version families incl. `DISTANCES_COLUMNS(_V2)`, `LANE_COST_COLUMNS`, `PLANT_CAPABILITY_COLUMNS`, `COLUMNS`; blank-id = add | 2.P2.1 Step 5 (`addModels`, id descriptor) |
| B2.5 header matching stays exact; server switches with no column change | 2.P2.1 Steps 3 (literal pins), 10, 11 |
| B2.5 wiring: package files, composite tsconfig, 3 references, deps in both packages, lockfile, filtered builds, Docker | 2.P2.1 Steps 2, 7, 12 |
| B2.6 oneOf, `format` default csv, document = export envelope, round trip unchanged | 2.P2.2 Steps 2, 4, 7, 8 |
| B2.6 entity match, version supported, unknown keys, duplicate rule, malformed 400 | 2.P2.2 Steps 2, 7, 8 (deviation 1) |
| B2.6 `rowIndex`/`field`, CSV keeps `line`, apply 422 documented as-is | 2.P2.2 Steps 4, 7 (deviation 2) |
| B2.6 2 MB / 413 / 20,000 rows | 2.P2.2 Steps 2, 7, 8, 11 |
| B2.6 ownership 404 | 2.P2.2 Step 2; 2.P2.3 Step 2 |
| B2.6 tests: preview+apply, populated round trip every entity, non-owner 404, 413, malformed, mismatch, format omitted, contract pinned to constants | 2.P2.2 Steps 2, 6; 2.P2.3 Step 2 (11th entity) |
| B2.7 representation D1 (sparse, billable miles, no unit, base-pair only, equal-to-base removes) | 2.P2.3 Steps 2, 4, 6 |
| B2.7 checklist: OpenAPI import + export enums, regen, service union, route allowlists, delivery guards, ImportDialog/ExportEntity/INPUT_ENTITIES, import-schema entry, tests + populated round-trip fixture | 2.P2.3 Steps 4–7, 2 |
| DeliveryCostsTab inline "+ Add row" and its tests unchanged | 2.P2.3 Step 8 (runs them unchanged) |
| Contract tasks: regen no diff on re-run | 2.P2.2 Step 5; 2.P2.3 Step 5 |
| After P2: `e2e_accuracy.py`, `e2e_journey.py` delivery + transport | 2.P2.3 Step 9 |
| ImportDialog format param (P2 plumbing) | 2.P2.2 Steps 10–11 |
| No lib/db schema change | every task's gate step |
