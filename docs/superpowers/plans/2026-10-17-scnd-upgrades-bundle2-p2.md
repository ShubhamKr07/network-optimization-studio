# SCND Upgrades — Bundle 2 Phase P2 Implementation Plan (import-schema, JSON import, deliveryCosts)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (gate run, Orval no-diff check, Docker build, `e2e_accuracy.py`, `e2e_journey.py` delivery + transport, e2e sweep, changelog entry), per the standing ledger rule.

**Goal:** Ship spec B2.5–B2.7: a new `@workspace/import-schema` workspace package that is the single source of every importable entity's file layout, a strict JSON import path that accepts the export envelope (route-scoped 2 MiB body limit, ownership checked before the body is read, 20,000-row cap), and a new sparse `deliveryCosts` import/export entity for `delivery-teaching-us`.

**Revision 2 (2026-10-17):** folds the Codex deep review (gpt-5.6-luna, xhigh, "request changes", 12 findings). Spec B2.6/B2.7 were updated in place to match.

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
  - One **2 MiB wire limit**, `MAX_IMPORT_BYTES = 2 * 1024 * 1024` = 2,097,152 bytes (what body-parser parses `"2mb"` to), applied by a **route-scoped** JSON parser on the two import routes only. Every other route keeps today's global `express.json()` unchanged. Over the limit → **413 `{ error: "payload_too_large" }`**. Auth and ownership run before that parser, so a non-owned scenario is **404 whatever the body**. The client measures the serialized request body (`new Blob([JSON.stringify(payload)]).size`), never `file.size`.
  - Max **20,000** rows per import (CSV data rows or JSON `document.rows`).
  - Malformed JSON → **400 with `errorClass: "malformed"`** (plus optional `field`). This covers an unparseable body and a `document` that breaks the schema. Request-envelope violations → 422.
  - **Strict request contract:** `additionalProperties: false` on both request variants and on `ImportDocument` (keys `templateVersion`, `entity`, `unit`, `rows` only); `document.entity` is the shared `ImportEntity`; `format: null` is rejected. The generated Zod (per-operation `strict.body`) and the server's `readImportRequest` accept and reject exactly the same bodies (pinned by a table test).
  - `ImportRequest` is `oneOf`: `{ entity, format: "csv", csvText }` with **`format` optional, defaulting to `csv`**, or `{ entity, format: "json", document }`.
  - **The JSON `document` is the export envelope** `{ templateVersion, entity, unit?, rows }` with JSON keys. Round trip = **structural JSON equality** of the re-export (distances already pass through the existing 4-dp `roundForFile`). Base rows and overrides round-trip across scenarios. Added (scenario-local, opaque-id) entities round-trip only into the **same** scenario.
  - `document.entity` must equal `entity`; `templateVersion` must be supported; unknown keys → error; duplicate ids → the existing duplicate rule.
  - `ImportError` gains optional `rowIndex` (0-based, JSON) and `field`; CSV keeps `line`.
  - The apply 422 `{ error, preview }` (`scenarios.ts:1749`) is documented in OpenAPI as-is.
  - **`deliveryCosts` (D1): sparse overrides of `inputs.laneCostOverrides`; rows `{ fromId, toId, cost }`; `cost` = billable miles, no unit conversion, no `unit` field.** Export emits only overridden pairs whose cost differs from base. Import upserts; pairs must exist in the base matrix. A row whose cost equals base removes the override, decided by the override's **presence** (so a redundant stored override equal to base is removed too). A real change advances `inputsUpdatedAt` + `solveInputRevision`; a no-op does not.
  - Header matching stays exact; blank `id` = add mode.
- **Gate (every task; scripts verified: `artifacts/studio/package.json:11` has `typecheck:e2e`; `lib/import-schema` gets `test` in SCU-2.P2.1).** Run each separately, judge by its own exit status:
  1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]` — alone, never chained with `&&`.
  2. `pnpm --filter @workspace/import-schema test`
  3. `pnpm run typecheck && pnpm --filter studio typecheck:e2e && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
- **Flakes:** check `docs/superpowers/flake-registry.md` by test **name** and re-run a failing file twice in isolation before calling it a regression. `nos_dev` is shared with other sessions; these tests never solve, so no dispatcher interaction is expected.
- **e2e sweep:** each task greps `artifacts/studio/e2e/` for every string/testid it changes. Measured at `46d2f98`: `entity must be` 0 files, `csvText is required` 0, `only support` 0, `Could not parse file` 0, `Import failed` 0, `import-preview-error` 0, `import-error-row` 0, `import-change-row` 0, `payload_too_large` 0, `deliveryCosts` 1 (`delivery-teaching.spec.ts:188,240`, the sidebar testid `sidebar-input-deliveryCosts`, untouched). No spec rewrite is expected; record `e2e: sweep 0 hits` in the changelog, never "green".
- **No merge, no push, no deploy in this plan.** P2.1 changes root build inputs (`pnpm-lock.yaml`, root `tsconfig.json`), which by the `deploy_config` gate touch both services; that matters only at bundle deploy time.
- **Scratch files** (regen hashes, smoke cookies) go in `$(mktemp -d)`, never `.harness/`.
- **Line numbers are from `46d2f98`.** Earlier tasks shift them; locate by the quoted text, verify, then edit.

## Spec deviations and grounding facts (read before any task)

Each is the smallest correct reading where the spec and the repo disagree (hard rule #8). Every commit that implements one names it in its body.

1. **Body handling is route-scoped, after ownership (review #1).** Measured today (2026-10-17, probe against `5ba7c4c` with `supertest`): a malformed body returns **500 `{"error":"Internal server error"}`**, and so does a 150 kB body (body-parser's 100 kB default). Both happen before any route runs. Plan:
   - The global `express.json()` in `app.ts` **skips** the two import paths (`IMPORT_BODY_PATH`) and is otherwise unchanged. Every other route keeps today's 100 kB / 500 behaviour, and a test pins that.
   - Each import route mounts, in order: `requireAuth` (already router-wide) → `loadOwnedImportScenario` (404 for a non-owned scenario) → `importJsonBody = express.json({ limit: MAX_IMPORT_BYTES })` → `importBodyErrors`. The error handler maps `entity.too.large` → 413 `{ error: "payload_too_large" }` and `entity.parse.failed` → 400 `{ error: "Request body is not valid JSON.", errorClass: "malformed" }`. The type strings are verified in `raw-body@3.0.2/index.js:167` and `body-parser@2.2.2/lib/read.js:166`.
   - So a non-owned scenario is 404 whatever the body, and the limit cannot be used to probe ids.
   - The handler keeps its own `isModelLocked(` check, because `lockedModelGuards.test.ts` scans each `:scenarioId` handler's own text.
   - `ImportErrorClass` stays `format | syntax | logic`; "malformed" is the separate 400 body `ImportMalformedError { error, errorClass, field? }`.
2. **`ImportRowChange` also gains `rowIndex`.** The spec gives `rowIndex` to errors only. A JSON change still needs its row, and `ImportRowChange.line` is a required integer in the contract. Plan: JSON changes carry `rowIndex` and `line = rowIndex + 2` (the CSV-equivalent line, documented). JSON errors carry `line: null` plus `rowIndex`, as the spec says.
3. **Do not replace `canAdd` or the route guards with the package.** `parseAndValidateImport`'s `canAdd` (`import.ts:652-654`) allows mines/stations/refineries/plants adds for *any* `modelId`, and `import.test.ts:406-524,645-684` calls it with the default `"p-median-us"`. Driving it from `addModels` would break those tests. Plan: keep `canAdd` and the route guards unchanged. Pin the package to them instead: the pure `importSchemaParity.test.ts` (every supported entity×model example with `errors === []`, add-mode, required-ness, bounds, enums, field applicability) and the real-DB `importSchemaRouteParity.test.ts` (one accepted + one rejected entity per model guard; deviation 15).
4. **Template-version constants move into the package.** `TEMPLATE_VERSION = 1` and `DISTANCE_TEMPLATE_VERSION = 2` (`templates.ts:28,38`) become `@workspace/import-schema` exports. `templates.ts` imports and re-exports them, so every existing importer keeps compiling. `OUTPUT_TEMPLATE_VERSION` / `COST_SUMMARY_TEMPLATE_VERSION` stay in `templates.ts`.
5. **Export JSON rows carry keys import must accept.** Single-id input rows carry a per-row `templateVersion` and an `overridden` flag (`templates.ts:125-200`), and distance rows carry `overridden: true` (`templates.ts:1042-1049`). Plan: per-row `templateVersion` is a field (`envelopeKey: "templateVersion"`, so a row may omit it), `unit` is a field with `envelopeKey: "unit"` (export puts it only on the envelope, `templates.ts:1148-1151`), and `overridden` is listed in `exportOnlyJsonKeys` (accepted, ignored).
6. **`deliveryCosts` presence semantics (review #8) and blank cost.** A row equal to base removes an existing override even when the stored value already equals base. The parser tracks override presence, not the effective value, and marks the change `after.status = "base"`. Export filters redundant overrides (cost equal to base). The base map lives in `data/referenceCosts.ts` (`deliveryBaseCost`), so `templates.ts` can use it without importing `import.ts` (no cycle). **Blank cost needs an explicit check.** `Number("") === 0` and 0 is a legal delivery cost (`delivery.ts:6` `nonnegative`; 33 of the 10,329 base lanes are 0, measured from `costs.json`). Unlike `laneCosts`, which rejects 0, a blank cell would silently become a 0 override. Plan: a blank cost is an error. `importSchemaParity.test.ts`'s required-for-update case pins this.
7. **No Dockerfile or `render.yaml` change is needed (review #11: proof is behavioural, not a bundle grep).** The Dockerfile `COPY . .` (and `.dockerignore` excludes only `node_modules`/`dist`), installs the whole workspace, and builds `pnpm --filter api-server...`. esbuild bundles workspace sources, and `import-schema` has no build step, like `@workspace/units`. The studio Render build is `pnpm --filter studio...` → `vite build`. Proven by a frozen install against the committed lockfile, both filtered builds, a **built-server smoke** (start `dist/index.mjs`, register, create, export, import), and a local `docker build`, which is itself a from-scratch frozen install. All of this runs in SCU-2.P2.1.
8. **tsconfig references.** The spec asks for references in the root, api-server and studio tsconfigs. The `@workspace/units` precedent (`6b01f03`) added only the root one. Plan: follow the spec, as `lib/db`/`lib/api-zod` already do. The gate's `pnpm run typecheck` runs `tsc --build` first, which emits `lib/import-schema/dist/*.d.ts` before the per-package checks.
9. **No field has a `max`.** The spec lists `min?`/`max?`. The validator enforces only non-negative capacity/demand/delivery cost and strictly positive distance/lane cost. Plan: `min` + `exclusiveMin`, and no `max` (YAGNI). Bounds mirror the import validator, which accepts capacity 0 even though `pMedian.ts:5` `capacity.positive()` later rejects it at apply-revalidate. That is pre-existing and not changed here.
10. **One wire limit (review #10, coordinator decision).** `MAX_IMPORT_BYTES` is the contract, applied to the request body on the wire. The client measures `new Blob([JSON.stringify({ ...payload, mode: "all_or_nothing" })]).size`, the larger of the preview and apply bodies, not `file.size`. So a pretty-printed export whose compact body fits is accepted, and a CSV just under 2 MiB whose escaped body does not fit is refused before sending. Both show the same sentence as a 413.
11. **Route guard messages change for import/apply entity validation only.** The 10-name `entity !== …` chains at `scenarios.ts:1603-1605,1686-1688` become `isImportEntity` from the package (so B2.7 cannot forget them). The 422 text becomes `entity must be one of: …`. No test or e2e asserts the old text (measured, 0 hits). The export chain (`scenarios.ts:618-620`) is edited in place in SCU-2.P2.3.
12. **ImportDialog gets two display one-liners.** For JSON, errors show `row N` instead of `—`, and changes show `row N` instead of the synthetic line. Without them, the `format` param this phase adds would show nothing useful. The expected-fields panel and the Upload ▾ menu stay P4.
13. **Strict oneOf needs an Orval config change (review #2).** Measured with a scratch Orval 8.9.1 run: `additionalProperties: false` alone emits **no** `.strict()` (Zod strips unknown keys). The global `override.zod.strict.body` makes **all 14** request bodies strict, including `RegisterUserBody`/`LoginUserBody`/`ForgotPasswordBody`/`ResetPasswordBody`, which `auth.ts:114,170,312,349` parse at runtime — an out-of-scope behaviour change. The per-operation override (`override.operations.{previewScenarioImport,applyScenarioImport}.zod.strict.body`) emitted `.strict()` on exactly the two import bodies (6 occurrences). Plan: edit `lib/api-spec/orval.config.ts` (config, not generated code) with that per-operation override.
14. **`customers.demand` already included `delivery-teaching-us` (review #3).** It is in rev 1's descriptor. The fold adds the missing proof: an applicability test that `field.models` equals exactly the models whose input schema **keeps** an override's `demand` (and `capacity` for warehouses), via `validateInputsForModel`. The manifest's `demandEditable` is not that authority. `p-median-brazil` says `false` but its `pMedian.ts:11` schema persists import demand. JADE says `true` but means per-product demand (`jadeInputs.ts:70`), and its scalar demand is stripped. That Brazil mismatch already exists. It is reported, not changed.
15. **Route parity is reduced (review #7, overkill).** The 77-case real-DB cross product is replaced by:
   - (a) fast unit parity over every supported entity × model pair, 22 in P2.1 and 23 after P2.3, with model-specific populated fixtures asserting `errors === []` (JADE `legDistances` uses `plant-1 → wh-1`, Brazil uses `ANP`/`SP`);
   - (b) real-DB route cases only where a guard differs: one accepted and one rejected entity per model guard block. That is **14** cases in P2.1 and **16** after P2.3 (adding `deliveryCosts` accepted on delivery and rejected on transport). Each case checks import and export.
16. **Edge values and `exampleCsv` (review #6).** `exampleCsv` uses `Papa.unparse` (the package gains a `papaparse` dependency, the version api-server already uses). JSON→CSV already went through `Papa.unparse`. A pure edge-value suite covers quotes/commas/newlines, `false`, nulls, envelope-backed fields omitted, and km vs mi (100 km → 62.1371 mi).
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
| `artifacts/api-server/src/__tests__/fixtures/importFixtures.ts` | **new** — shared `MODEL_INPUTS`, model-specific example ids, `exampleCellsFor`/`exampleCsvFor` | 2.P2.1 |
| `artifacts/api-server/src/__tests__/importSchemaParity.test.ts` | **new** — package ↔ validator (all supported entity×model pairs, applicability) | 2.P2.1 |
| `artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts` | **new** — real-DB, one accepted + one rejected entity per model guard (14 → 16) | 2.P2.1, 2.P2.3 |
| `artifacts/api-server/src/app.ts` | global `express.json()` skips the two import paths | 2.P2.2 |
| `lib/api-spec/orval.config.ts` | per-operation `strict.body` for the two import operations | 2.P2.2 |
| `artifacts/api-server/src/__tests__/importJsonEdgeValues.test.ts` | **new** — pure edge values + 20,000/20,001 boundary | 2.P2.2 |
| `artifacts/api-server/src/data/referenceCosts.ts` | `deliveryBaseCost` | 2.P2.3 |
| `artifacts/api-server/src/routes/scenarios.ts` | import/apply: ownership middleware → route-scoped 2 MiB parser → strict `readImportRequest` (2.P2.2); `deliveryCosts` guards/export/apply (2.P2.3) | 2.P2.2, 2.P2.3 |
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

## Deploy note (review #12)

- **No `lib/db` change.** Every task asserts `git diff --stat "$BASE"..HEAD -- lib/db/src/schema/` is empty, so `docs/ops/schema-push-before-deploy.md` does not apply.
- **No new env var.** The limit is a code constant. No `process.env` read is added, and none of the touched files reads one.
- **Deploy surface** (for the eventual bundle deploy, which needs separate approval): both services. Root build inputs `pnpm-lock.yaml` and root `tsconfig.json` change in P2.1, and api-server and studio source change in every task. The future deploy request runs `pnpm deploy:preflight -- <deployed-sha>..HEAD` and attaches its checklist (Branch discipline step 7). Deploy order is `nos-api` first: the studio's JSON upload needs the new API, and the old API would 422 a `format: "json"` request.

---

## Task SCU-2.P2.1: `@workspace/import-schema` package + full wiring (B2.5)

**Owner role:** backend-engineer. **Spec:** B2.5. **Deviations:** 3, 4, 7, 8, 9.

**Files:**
- Create: `lib/import-schema/package.json`, `lib/import-schema/tsconfig.json`, `lib/import-schema/vitest.config.ts`, `lib/import-schema/src/index.ts`, `lib/import-schema/src/__tests__/importSchema.test.ts`
- Create: `artifacts/api-server/src/__tests__/fixtures/importFixtures.ts`, `artifacts/api-server/src/__tests__/importSchemaParity.test.ts`, `artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts`
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
export function exampleCsv(entity: ImportEntity): string;                 // Papa.unparse([header, example]) + "\n", latest version
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
  "dependencies": {
    "papaparse": "^5.4.1"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@types/papaparse": "^5.3.14",
    "vitest": "^3.2.4"
  }
}
```
(`papaparse` at the same ranges `artifacts/api-server/package.json` already uses, so the lockfile reuses the resolved versions.)

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
import Papa from "papaparse";
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

  it("exampleCsv is real CSV: it parses back to exactly the latest header + example row", () => {
    for (const entity of IMPORT_ENTITIES) {
      const versions = IMPORT_SCHEMAS[entity].versions;
      const latest = versions[versions.length - 1]!;
      const csv = exampleCsv(entity);
      expect(csv.endsWith("\n")).toBe(true);
      expect(Papa.parse<string[]>(csv.trim()).data).toEqual([latest.fields.map(f => f.csvHeader), latest.fields.map(f => f.example)]);
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

import Papa from "papaparse";

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

/** Papa.unparse, so an example containing a comma/quote/newline is still valid CSV. */
export function exampleCsv(entity: ImportEntity): string {
  const { fields } = latestVersion(entity);
  return Papa.unparse([fields.map(f => f.csvHeader), fields.map(f => f.example)], { newline: "\n" }) + "\n";
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

`artifacts/api-server/src/__tests__/fixtures/importFixtures.ts` (shared by every import test in this plan; not a `*.test.ts`, so vitest does not collect it):
```ts
// SCU-2.P2.1 — shared import-test fixtures: valid create-inputs per model, and
// the model-specific ids each descriptor example needs on models other than
// the entity's first (the descriptor example uses the first model's ids).
import Papa from "papaparse";
import { IMPORT_SCHEMAS } from "@workspace/import-schema";
import type { ImportEntity, ImportFieldDescriptor, ModelId } from "@workspace/import-schema";

const PMEDIAN = { p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30, addedWarehouses: [], addedCustomers: [], distanceOverrides: [] };

export const MODEL_INPUTS: Record<ModelId, Record<string, unknown>> = {
  "p-median-us": PMEDIAN,
  "p-median-brazil": PMEDIAN,
  "transport-coal": { distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120, capacityFactor: 1.0, singleSource: false, capacityInactive: false },
  "two-echelon-gold-au": { bomRatio: 1.1, refineryOverrides: [], customerOverrides: [], distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120 },
  "two-echelon-jade-us": { p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120, warehouseOverrides: [], customerOverrides: [], plantProductCapability: [], addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "max-coverage-us": { p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, coverageFloorDemand: 0, gap: 0, timeLimitSec: 120, capacityMode: "none", distanceBands: [450, 3400], warehouseOverrides: [], customerOverrides: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "delivery-teaching-us": { p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120, costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [], warehouseOverrides: [], customerOverrides: [] },
};

// Real dataset ids (measured from solvers/*/dataset): Brazil warehouse ANP,
// region SP; JADE wh-1/customer-1/plant-1; delivery W1/C269; gold sydney.
const MODEL_IDS_FOR: Partial<Record<ImportEntity, Partial<Record<ModelId, Record<string, string>>>>> = {
  warehouses: { "p-median-brazil": { id: "ANP" }, "two-echelon-jade-us": { id: "wh-1" }, "delivery-teaching-us": { id: "W1" } },
  customers: { "p-median-brazil": { id: "SP" }, "two-echelon-gold-au": { id: "sydney" }, "two-echelon-jade-us": { id: "customer-1" }, "delivery-teaching-us": { id: "C269" } },
  distances: { "p-median-brazil": { from_id: "ANP", to_id: "SP" } },
  legDistances: { "two-echelon-jade-us": { from_id: "plant-1", to_id: "wh-1" } },
};

export function latestFields(entity: ImportEntity): readonly ImportFieldDescriptor[] {
  const versions = IMPORT_SCHEMAS[entity].versions;
  return versions[versions.length - 1]!.fields;
}

export function exampleCellsFor(entity: ImportEntity, fields: readonly ImportFieldDescriptor[], model: ModelId): string[] {
  const ids = MODEL_IDS_FOR[entity]?.[model] ?? {};
  return fields.map(f => ids[f.csvHeader] ?? f.example);
}

export function exampleCsvFor(entity: ImportEntity, model: ModelId): string {
  const fields = latestFields(entity);
  return Papa.unparse([fields.map(f => f.csvHeader), exampleCellsFor(entity, fields, model)], { newline: "\n" }) + "\n";
}
```

`artifacts/api-server/src/__tests__/importSchemaParity.test.ts`:
```ts
// SCU-2.P2.1 (B2.5) — pins every descriptor value that RESTATES a validator
// rule to the real validator (services/import.ts's parseAndValidateImport)
// and the input schemas (validateInputsForModel). Fast and pure: this is the
// full entity × model coverage; the real-DB route file covers only the guards.
import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { IMPORT_ENTITIES, IMPORT_SCHEMAS } from "@workspace/import-schema";
import type { ImportEntity, ImportFieldDescriptor, ModelId } from "@workspace/import-schema";
import { parseAndValidateImport } from "../services/import.js";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { MODEL_INPUTS, exampleCellsFor, latestFields } from "./fixtures/importFixtures.js";

const P = 3;

function errorsFor(entity: ImportEntity, fields: readonly ImportFieldDescriptor[], cells: string[], modelId: ModelId) {
  const csv = Papa.unparse([fields.map(f => f.csvHeader), cells], { newline: "\n" });
  return parseAndValidateImport(entity, csv, {}, P, modelId).errors;
}

const exampleCells = (fields: readonly ImportFieldDescriptor[]) => fields.map(f => f.example);
const isSingleId = (entity: ImportEntity) => latestFields(entity).some(f => f.csvHeader === "id");

// An ADD row: blank id, a fresh display code, status "active" (the only status
// an added customer may have; legal for every facility enum too).
const addRowCells = (fields: readonly ImportFieldDescriptor[]) =>
  fields.map(f => (f.csvHeader === "id" ? "" : f.csvHeader === "display_code" ? "PARITY-1" : f.csvHeader === "status" ? "active" : f.example));

const withCell = (fields: readonly ImportFieldDescriptor[], cells: string[], target: ImportFieldDescriptor, value: string) =>
  cells.map((c, i) => (fields[i] === target ? value : c));

describe("every supported (entity, model) pair: a populated, model-specific example row validates with errors === []", () => {
  let pairs = 0;
  for (const entity of IMPORT_ENTITIES) {
    const schema = IMPORT_SCHEMAS[entity];
    for (const model of schema.models) {
      pairs++;
      for (const version of schema.versions) {
        it(`${entity} v${version.templateVersion} on ${model}`, () => {
          expect(errorsFor(entity, version.fields, exampleCellsFor(entity, version.fields, model), model)).toEqual([]);
        });
      }
    }
  }
  it("covers every supported pair (22 here; 23 once deliveryCosts lands in SCU-2.P2.3)", () => {
    expect(pairs).toBe(IMPORT_ENTITIES.reduce((n, e) => n + IMPORT_SCHEMAS[e].models.length, 0));
    expect(pairs).toBeGreaterThanOrEqual(22);
  });
});

describe("field `models` = the models whose input schema keeps the value (not manifest demandEditable)", () => {
  const cases = [
    { entity: "customers" as const, csvHeader: "demand", key: "customerOverrides", make: (id: string) => ({ id, status: "active", demand: 5 }) },
    { entity: "warehouses" as const, csvHeader: "capacity", key: "warehouseOverrides", make: (id: string) => ({ id, status: "active", capacity: 5 }) },
  ];
  for (const c of cases) {
    const fields = latestFields(c.entity);
    const field = fields.find(f => f.csvHeader === c.csvHeader)!;
    for (const model of IMPORT_SCHEMAS[c.entity].models) {
      const expected = (field.models ?? IMPORT_SCHEMAS[c.entity].models).includes(model);
      it(`${c.entity}.${c.csvHeader} on ${model}: ${expected ? "kept" : "dropped"}`, () => {
        const id = exampleCellsFor(c.entity, fields, model)[1]!; // the id column
        const result = validateInputsForModel(model, { ...MODEL_INPUTS[model], [c.key]: [c.make(id)] });
        expect(result.success).toBe(true);
        const row = (result as unknown as { data: Record<string, Array<Record<string, unknown>>> }).data[c.key]![0]!;
        expect(row[c.csvHeader] === 5).toBe(expected);
      });
    }
  }
});

describe("addModels matches the validator's add mode (blank id)", () => {
  for (const entity of IMPORT_ENTITIES.filter(isSingleId)) {
    for (const model of IMPORT_SCHEMAS[entity].models) {
      const expected = IMPORT_SCHEMAS[entity].addModels.includes(model);
      it(`${entity} on ${model}: add ${expected ? "accepted" : "rejected"}`, () => {
        const fields = latestFields(entity);
        expect(errorsFor(entity, fields, addRowCells(fields), model).length === 0).toBe(expected);
      });
    }
  }
});

describe("requiredForAdd matches the validator", () => {
  for (const entity of IMPORT_ENTITIES.filter(isSingleId)) {
    const fields = latestFields(entity);
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
    const fields = latestFields(entity);
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
    const fields = latestFields(entity);
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

`artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts` (real Postgres, no mocks — same convention as `deliveryPrecheckIntegration.test.ts`). It does **not** run the entity × model cross product, which the pure file above covers. It runs one accepted and one rejected entity per model guard block in `routes/scenarios.ts`, so every guard is exercised exactly once (deviation 15):
```ts
// SCU-2.P2.1 (B2.5) — pins import-schema's entity `models` to each model's
// guard block in routes/scenarios.ts (import AND export). One accepted entity
// (with a model-specific populated row that must produce errors === []) and
// one rejected sibling per model: model-integration-precheck.md Gate 7.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { IMPORT_SCHEMAS, MODEL_IDS } from "@workspace/import-schema";
import type { ImportEntity, ModelId } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";
import { MODEL_INPUTS, exampleCsvFor } from "./fixtures/importFixtures.js";

beforeEach(() => { setLockedModelsForTests([]); });

export const GUARD_CASES: Array<{ modelId: ModelId; entity: ImportEntity; supported: boolean }> = [
  { modelId: "p-median-us", entity: "distances", supported: true },
  { modelId: "p-median-us", entity: "laneCosts", supported: false },
  { modelId: "p-median-brazil", entity: "customers", supported: true },
  { modelId: "p-median-brazil", entity: "refineries", supported: false },
  { modelId: "transport-coal", entity: "laneCosts", supported: true },
  { modelId: "transport-coal", entity: "distances", supported: false },
  { modelId: "two-echelon-gold-au", entity: "legDistances", supported: true },
  { modelId: "two-echelon-gold-au", entity: "plants", supported: false },
  { modelId: "two-echelon-jade-us", entity: "legDistances", supported: true },
  { modelId: "two-echelon-jade-us", entity: "distances", supported: false },
  { modelId: "max-coverage-us", entity: "warehouses", supported: true },
  { modelId: "max-coverage-us", entity: "legDistances", supported: false },
  { modelId: "delivery-teaching-us", entity: "customers", supported: true },
  { modelId: "delivery-teaching-us", entity: "distances", supported: false },
];

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

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

describe("one accepted + one rejected entity per model guard", () => {
  it("every model has exactly one accepted and one rejected case, and each agrees with the package", () => {
    for (const modelId of MODEL_IDS) {
      const mine = GUARD_CASES.filter(c => c.modelId === modelId);
      expect(mine.filter(c => c.supported)).toHaveLength(1);
      expect(mine.filter(c => !c.supported).length).toBeGreaterThanOrEqual(1);
    }
    for (const c of GUARD_CASES) expect(IMPORT_SCHEMAS[c.entity].models.includes(c.modelId)).toBe(c.supported);
  });

  for (const c of GUARD_CASES) {
    it(`${c.modelId} × ${c.entity}: import + export ${c.supported ? "accepted with errors === []" : "422"}`, async () => {
      const id = scenarioByModel.get(c.modelId)!;
      const imp = await request(app).post(`/api/scenarios/${id}/import`).set("Cookie", cookie).send({ entity: c.entity, csvText: exampleCsvFor(c.entity, c.modelId) });
      expect(imp.status).toBe(c.supported ? 200 : 422);
      if (c.supported) expect(imp.body.errors).toEqual([]);
      const exp = await request(app).get(`/api/scenarios/${id}/export`).query({ entity: c.entity, format: "json" }).set("Cookie", cookie);
      expect(exp.status).toBe(c.supported ? 200 : 422);
    });
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

- [ ] **Step 12: Wiring proof — clean install, filtered builds, built-server smoke, Docker** (spec B2.5 wiring; deviation 7; review #11)

Clean install against the committed lockfile (fails if Step 7 left the lockfile incomplete):
```bash
pnpm install --frozen-lockfile
```
Expected: exit 0, "Lockfile is up to date".
```bash
pnpm --filter api-server... build
```
Expected: exit 0; `artifacts/api-server/dist/index.mjs` written.
```bash
PORT=5180 BASE_PATH=/ pnpm --filter studio... build
```
Expected: exit 0 (`vite.config.ts:7-25` throws without `PORT` and `BASE_PATH`).

Built-server smoke. This proves the **bundled** server really resolves the package at runtime: the export header comes from `csvColumns`, and the import header check uses the same list. Start it in the background:
```bash
PORT=3002 DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" node --enable-source-maps artifacts/api-server/dist/index.mjs
```
Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/api/healthz` prints `200`. Then run:
```bash
T=$(mktemp -d); B=http://localhost:3002/api; E="scu-p2-1-smoke-$(date +%s)@example.test"
curl -s -c "$T/c" -H 'content-type: application/json' -d "{\"email\":\"$E\",\"password\":\"correct horse battery\"}" "$B/auth/register" -o /dev/null -w 'register %{http_code}\n'
SID=$(curl -s -b "$T/c" -H 'content-type: application/json' -d '{"name":"smoke","modelId":"p-median-us","inputs":{"p":3,"distanceBands":[200,400,800,1600],"capacityMode":"none","uniformCapacity":null,"warehouseOverrides":[],"customerOverrides":[],"gap":0,"timeLimitSec":30,"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}}' "$B/scenarios" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -b "$T/c" "$B/scenarios/$SID/export?entity=warehouses&format=csv" -o "$T/w.csv" -w 'export %{http_code}\n'; head -1 "$T/w.csv"
python3 -c "import json,sys;print(json.dumps({'entity':'warehouses','csvText':open(sys.argv[1]).read()}))" "$T/w.csv" > "$T/body.json"
curl -s -b "$T/c" -H 'content-type: application/json' --data-binary @"$T/body.json" "$B/scenarios/$SID/import" -w '\nimport %{http_code}\n'
psql "postgresql://shubhamkr@localhost:5432/nos_dev" -c "delete from scenarios where user_id in (select id from users where email = '$E'); delete from users where email = '$E';"
```
Expected: `register 201`, `export 200`, header `template_version,id,display_code,city,state,lat,lng,capacity,status`, import body `{"errors":[],"changes":[],"warnings":[]}` with `import 200`, and `DELETE 1` twice. Stop the server.

Docker. Spec B2.5 requires it, and it is a from-scratch frozen install inside the image:
```bash
docker build -t nos-api-scu-2-p2-1 .
```
Expected: exit 0. Record the build duration in the changelog, then `docker rmi nos-api-scu-2-p2-1`. (The container is not booted: it needs a reachable Postgres. The host smoke above is the runtime proof.)

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
- Deviation 3: `canAdd` and route guards unchanged (driving them from `addModels` breaks `import.test.ts`'s default-modelId calls); pinned instead by the pure `importSchemaParity.test.ts` (<N> cases over all 22 supported entity×model pairs, plus demand/capacity applicability via `validateInputsForModel`) and the real-DB `importSchemaRouteParity.test.ts` (14 guard cases: one accepted, one rejected per model; deviation 15).
- Wiring: references in root/api-server/studio tsconfig; dependency in api-server + studio; lockfile. frozen install ok; `pnpm --filter api-server... build` ok; `pnpm --filter studio... build` ok; built-server smoke (register/create/export/import against `dist/index.mjs`) <result>; `docker build` ok (<duration>). No Dockerfile/render.yaml change (deviation 7). `exampleCsv` uses `Papa.unparse` (package dependency `papaparse`).
- Gate: import-schema <N>, studio <N>, api-server <N>, pytest <N> — measured this run. e2e: n/a (no UI change). lib/db schema: unchanged.
```
Replace each `<…>` with the value printed by this run, or `unknown`.

- [ ] **Step 16: Commit**

```bash
git add lib/import-schema artifacts/api-server/src/__tests__/fixtures/importFixtures.ts artifacts/api-server/src/__tests__/importSchemaParity.test.ts artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts
```
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit lib/import-schema tsconfig.json artifacts/api-server/tsconfig.json artifacts/studio/tsconfig.json artifacts/api-server/package.json artifacts/studio/package.json pnpm-lock.yaml artifacts/api-server/src/services/templates.ts artifacts/api-server/src/services/import.ts artifacts/api-server/src/__tests__/fixtures/importFixtures.ts artifacts/api-server/src/__tests__/importSchemaParity.test.ts artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P2.1] add @workspace/import-schema and wire server to it" -m "No column change. Deviation 3: canAdd/route guards kept; package pinned by parity tests. Deviation 4: template-version constants moved into the package. Deviation 7: no Docker/render change; built-server smoke + docker build verified. Deviation 15: unit parity over all pairs, 14 real-DB guard cases." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P2.2: JSON import contract — strict OpenAPI oneOf + regen + route-scoped body + server + ImportDialog (B2.6)

**Owner role:** backend-engineer. **Spec:** B2.6. **Deviations:** 1, 2, 10, 11, 12, 13, 16. **Depends on:** SCU-2.P2.1.

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (paths `/scenarios/{scenarioId}/import` `:403-432`, `/import/apply` `:434-463`; schemas `ImportRequest`…`ImportApplyRequest` `:1942-2005`)
- Modify: `lib/api-spec/orval.config.ts` (zod output `override.operations`, deviation 13)
- Regenerate: `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`. This removes `importRequestEntity.ts`, `importApplyRequestEntity.ts` and `importApplyRequestMode.ts`. It adds `importEntity.ts`, `importDocument.ts`, `importCsvRequest.ts`, `importJsonRequest.ts`, `importCsvApplyRequest.ts`, `importJsonApplyRequest.ts`, `importApplyMode.ts`, `importMalformedError.ts`, `payloadTooLargeError.ts`, `importApplyRejection.ts` and their enum files. The import bodies come out `.strict()` (6 occurrences in `api-zod/src/generated/api.ts`). All of this was verified with a scratch Orval 8.9.1 run of this exact YAML and config.
- Modify: `artifacts/api-server/src/app.ts:68` (global parser skips the import paths)
- Modify: `artifacts/api-server/src/services/import.ts` (`ImportError`, `ImportRowChange`, row cap, `readImportRequest`, `previewImport`, `parseAndValidateJsonImport`)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (new `loadOwnedImportScenario`/`importJsonBody`/`importBodyErrors`; preview `:1599-1615,1676-1680`; apply `:1682-1699,1744-1745`)
- Modify: `artifacts/studio/src/components/ImportDialog.tsx`, `artifacts/studio/src/__tests__/ImportDialog.test.tsx`
- Create: `artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts` (real DB), `artifacts/api-server/src/__tests__/importSchemaContract.test.ts` (pure), `artifacts/api-server/src/__tests__/importJsonEdgeValues.test.ts` (pure)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `IMPORT_ENTITIES`, `IMPORT_SCHEMAS`, `isImportEntity`, `findTemplateVersion`, `MAX_IMPORT_ROWS`, `MAX_IMPORT_BYTES`, `TEMPLATE_VERSION`, `DISTANCE_TEMPLATE_VERSION`, `csvColumns`, `ImportEntity`, `ImportFieldDescriptor`, `ImportJsonDocument` (SCU-2.P2.1); `MODEL_INPUTS` (`__tests__/fixtures/importFixtures.ts`).
- Produces — generated client types (P3/P4 consume from `@workspace/api-client-react`):
```ts
export type ImportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries" | "distances" | "laneCosts" | "legDistances" | "plants" | "plantCapabilities";
export interface ImportDocument { templateVersion: number; entity: ImportEntity; unit?: "km" | "mi"; rows: { [key: string]: unknown }[] } // additionalProperties: false
export interface ImportCsvRequest { entity: ImportEntity; format?: "csv"; csvText: string }            // additionalProperties: false
export interface ImportJsonRequest { entity: ImportEntity; format: "json"; document: ImportDocument }  // additionalProperties: false
export type ImportRequest = ImportCsvRequest | ImportJsonRequest;
export type ImportApplyMode = "all_or_nothing" | "partial";
export interface ImportCsvApplyRequest { entity: ImportEntity; format?: "csv"; csvText: string; mode?: ImportApplyMode }
export interface ImportJsonApplyRequest { entity: ImportEntity; format: "json"; document: ImportDocument; mode?: ImportApplyMode }
export type ImportApplyRequest = ImportCsvApplyRequest | ImportJsonApplyRequest;
export interface ImportError { errorClass: "format" | "syntax" | "logic"; line: number | null; rowIndex?: number; field?: string; message: string }
export interface ImportRowChange { id: string; line: number; rowIndex?: number; before: object; after: object }
export interface ImportMalformedError { error: string; errorClass: "malformed"; field?: string }
export interface PayloadTooLargeError { error: "payload_too_large" }
export interface ImportApplyRejection { error: string; preview?: ImportPreview }
```
- Produces — server (`services/import.ts`):
```ts
export interface ImportError { errorClass: ImportErrorClass; line: number | null; message: string; rowIndex?: number; field?: string }
// ImportRowChange gains: rowIndex?: number
export type ImportPayload = { format: "csv"; csvText: string } | { format: "json"; document: ImportJsonDocument };
export type ReadImportRequestResult =
  | { ok: true; entity: ImportEntity; payload: ImportPayload; mode: "all_or_nothing" | "partial" }
  | { ok: false; status: 400 | 422; body: { error: string; errorClass?: "malformed"; field?: string } };
export function readImportRequest(body: unknown, route: "preview" | "apply"): ReadImportRequestResult;
export function parseAndValidateJsonImport(entity: ImportEntity, document: ImportJsonDocument, currentOverrides: ImportCurrentOverrides, pValue: number, modelId?: string): ImportPreview;
export function previewImport(entity: ImportEntity, payload: ImportPayload, currentOverrides: ImportCurrentOverrides, pValue: number, modelId: string): ImportPreview;
```
- Produces — studio: `ImportDialog` props `{ open; onOpenChange; scenarioId; entity: ImportEntity /* from @workspace/import-schema */; format?: "csv" | "json" /* default "csv" */; onApplied?; enableFilters? }`; new testid `import-file-error`; the client size check measures the serialized request body.

- [ ] **Step 0: Skills.** `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Worktree check + install** — `cd /Users/shubhamkr/nos-scu-2.p2.2 && git rev-parse --abbrev-ref HEAD` → `scu-2.p2.2-work`; base guard; `pnpm install --frozen-lockfile`.

- [ ] **Step 2: Write the failing real-DB contract test**

`artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts`:
```ts
// SCU-2.P2.2 (B2.6) — JSON import contract through the real routes and a real
// Postgres (no vi.mock). "Round trip" = the re-export is STRUCTURALLY EQUAL
// (toEqual) to the export that was imported. Base rows/overrides round-trip
// across scenarios; added (scenario-local, opaque-id) entities round-trip
// only into the SAME scenario — in another scenario their ids are unknown.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";
import { MODEL_INPUTS } from "./fixtures/importFixtures.js";

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

const BASE = MODEL_INPUTS as Record<string, Record<string, unknown>>;

// One populated override per entity (real dataset ids), imported into a FRESH
// scenario. `expectChanges: false` only for plants: base plants have no
// override concept (an added plant is covered by ADDED_CASES below).
const ROUND_TRIP_CASES: Array<{ name: string; modelId: string; entity: string; overrides: Record<string, unknown>; expectChanges: boolean }> = [
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

// One populated ADDED entity per addable entity, re-imported into the SAME
// scenario (review #5). The city carries a quote and a comma, so the CSV
// escaping on the JSON → CSV path is exercised through the real routes.
const ADDED_CASES: Array<{ name: string; modelId: string; entity: string; key: string; added: Record<string, unknown> }> = [
  { name: "p-median-us added warehouse", modelId: "p-median-us", entity: "warehouses", key: "addedWarehouses", added: { id: "aw-scu-p2-2", displayCode: "NEW-W", city: 'Fort "Big", Town', state: "TX", lat: 31.5, lng: -97.1, status: "forced_open" } },
  { name: "p-median-us added customer", modelId: "p-median-us", entity: "customers", key: "addedCustomers", added: { id: "ac-scu-p2-2", displayCode: "NEW-C", city: "Newtown", state: "TX", lat: 31.6, lng: -97.2, demand: 1234 } },
  { name: "transport added mine", modelId: "transport-coal", entity: "mines", key: "addedMines", added: { id: "am-scu-p2-2", displayCode: "NEW-M", city: "Minetown", state: "WV", lat: 38.1, lng: -81.6, capacity: 5000 } },
  { name: "transport added station", modelId: "transport-coal", entity: "stations", key: "addedStations", added: { id: "as-scu-p2-2", displayCode: "NEW-S", city: "Stationville", state: "OH", lat: 40.1, lng: -82.9, demand: 700 } },
  { name: "gold added refinery", modelId: "two-echelon-gold-au", entity: "refineries", key: "addedRefineries", added: { id: "aw-scu-p2-2r", displayCode: "NEW-R", city: "Refinerton", state: "NSW", lat: -32.1, lng: 147.2, status: "active" } },
  { name: "jade added plant", modelId: "two-echelon-jade-us", entity: "plants", key: "addedPlants", added: { id: "ap-scu-p2-2", displayCode: "NEW-P", city: "Plantville", state: "IN", lat: 39.8, lng: -86.2 } },
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
const rawPost = (cookie: string, path: string, raw: string) => request(app).post(path).set("Cookie", cookie).set("Content-Type", "application/json").send(raw);

describe("base rows round-trip across scenarios (structural JSON equality)", () => {
  for (const c of ROUND_TRIP_CASES) {
    it(`${c.name}: export JSON → import JSON into a fresh scenario → equal export`, async () => {
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

describe("added entities round-trip into the SAME scenario only", () => {
  for (const c of ADDED_CASES) {
    it(`${c.name}: same-scenario re-import is a no-op; another scenario rejects the opaque id`, async () => {
      const id = await createScenario(owner, c.modelId, { ...BASE[c.modelId], [c.key]: [c.added] });
      const document = await exportJson(owner, id, c.entity);
      const addedIndex = document.rows.findIndex(r => r.id === c.added.id);
      expect(addedIndex).toBeGreaterThanOrEqual(0);
      expect(document.rows[addedIndex]).toMatchObject({ displayCode: c.added.displayCode, city: c.added.city });

      const same = await preview(owner, id, { entity: c.entity, format: "json", document });
      expect(same.body).toEqual({ errors: [], changes: [], warnings: same.body.warnings });
      expect((await apply(owner, id, { entity: c.entity, format: "json", document })).status).toBe(200);
      expect(await exportJson(owner, id, c.entity)).toEqual(document);

      const other = await createScenario(owner, c.modelId, BASE[c.modelId]!);
      const cross = await preview(owner, other, { entity: c.entity, format: "json", document });
      expect(cross.body.errors).toEqual([expect.objectContaining({ errorClass: "logic", rowIndex: addedIndex, message: expect.stringContaining("Unknown id") })]);
    });
  }
});

describe("body handling is scoped to the import routes and runs after ownership (review #1)", () => {
  it("owner: a body over the 2 MiB wire limit is 413 payload_too_large", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const res = await preview(owner, id, { entity: "warehouses", csvText: "x".repeat(MAX_IMPORT_BYTES) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });

  it("owner: a 150 kB body is accepted (it was a 500 under the 100 kB default)", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const res = await preview(owner, id, { entity: "warehouses", csvText: "x".repeat(150 * 1024) });
    expect(res.status).toBe(200);
    expect(res.body.errors[0].errorClass).toBe("format");
  });

  it("owner: a body that is not JSON is 400 malformed (preview and apply)", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    for (const path of [`/api/scenarios/${id}/import`, `/api/scenarios/${id}/import/apply`]) {
      const res = await rawPost(owner, path, "{not json");
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Request body is not valid JSON.", errorClass: "malformed" });
    }
  });

  it("non-owner: 404 for a valid, a malformed and an oversized body — never 400/413 — and nothing changes", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const document = await exportJson(owner, id, "warehouses");
    document.rows[1] = { ...document.rows[1], status: "forced_open" };
    expect((await preview(stranger, id, { entity: "warehouses", format: "json", document })).status).toBe(404);
    expect((await apply(stranger, id, { entity: "warehouses", format: "json", document, mode: "partial" })).status).toBe(404);
    expect((await rawPost(stranger, `/api/scenarios/${id}/import`, "{not json")).status).toBe(404);
    expect((await preview(stranger, id, { entity: "warehouses", csvText: "x".repeat(MAX_IMPORT_BYTES) })).status).toBe(404);
    expect((await exportJson(owner, id, "warehouses")).rows[1]!.status).toBe("active");
  });

  it("unauthenticated: 401 before any body handling", async () => {
    expect((await request(app).post("/api/scenarios/1/import").set("Content-Type", "application/json").send("{not json")).status).toBe(401);
  });

  it("a NON-import route keeps today's global body handling (pre-existing 500, not changed here)", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const malformed = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", owner).set("Content-Type", "application/json").send("{not json");
    expect(malformed.status).toBe(500);
    const big = await request(app).post("/api/scenarios").set("Cookie", owner).send({ name: "x".repeat(150 * 1024), modelId: "p-median-us", inputs: BASE["p-median-us"] });
    expect(big.status).toBe(500);
  });
});

describe("strict request contract (review #2, #4)", () => {
  let id = 0;
  let document: Awaited<ReturnType<typeof exportJson>>;
  beforeAll(async () => {
    id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    document = await exportJson(owner, id, "warehouses");
  });

  it("format omitted is CSV (backward compatible) and CSV keeps line, not rowIndex", async () => {
    const csvText = `${csvColumns("warehouses", TEMPLATE_VERSION).join(",")}\n${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.753693,-84.389544,,forced_open\n`;
    const res = await preview(owner, id, { entity: "warehouses", csvText });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toEqual([expect.objectContaining({ id: "ATL", line: 2, after: { status: "forced_open", value: null } })]);
    expect(res.body.changes[0].rowIndex).toBeUndefined();
  });

  it.each([
    ["format null", () => ({ entity: "warehouses", format: null, csvText: "x" })],
    ["unknown format", () => ({ entity: "warehouses", format: "xml", csvText: "x" })],
    ["csv + document mixed", () => ({ entity: "warehouses", format: "csv", csvText: "x", document })],
    ["unknown request key", () => ({ entity: "warehouses", csvText: "x", extra: 1 })],
    ["mode on preview", () => ({ entity: "warehouses", csvText: "x", mode: "partial" })],
  ])("request-envelope violation (%s) is 422", async (_name, body) => {
    expect((await preview(owner, id, body())).status).toBe(422);
  });

  it("apply rejects an invalid mode with 422", async () => {
    expect((await apply(owner, id, { entity: "warehouses", csvText: "x", mode: "bogus" })).status).toBe(422);
  });

  it.each([
    ["no rows array", () => ({ templateVersion: TEMPLATE_VERSION, entity: "warehouses" }), "rows"],
    ["unknown top-level document key", () => ({ ...document, exportedAt: "2026-10-17" }), "exportedAt"],
    ["document.entity not an import entity", () => ({ ...document, entity: "assignments" }), "entity"],
    ["a row that is not an object", () => ({ ...document, rows: [1] }), "rows"],
  ])("document schema violation (%s) is 400 malformed on preview and apply", async (_name, doc, field) => {
    for (const res of [await preview(owner, id, { entity: "warehouses", format: "json", document: doc() }), await apply(owner, id, { entity: "warehouses", format: "json", document: doc() })]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ errorClass: "malformed", field });
    }
  });

  it("document.entity must equal entity (a valid but different entity is a preview format error)", async () => {
    const res = await preview(owner, id, { entity: "customers", format: "json", document });
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([]);
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", line: null, field: "entity" })]);
  });

  it("an unsupported templateVersion is a preview format error on templateVersion", async () => {
    const res = await preview(owner, id, { entity: "warehouses", format: "json", document: { ...document, templateVersion: TEMPLATE_VERSION + 98 } });
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", field: "templateVersion" })]);
  });

  it("unknown row keys, wrong types and duplicate ids are per-row errors with rowIndex; partial apply keeps only the good row; all-or-nothing 422 carries the preview", async () => {
    const own = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const doc = await exportJson(owner, own, "warehouses");
    const at = (rowId: string) => doc.rows.findIndex(r => r.id === rowId);
    const aln = at("ALN"), atl = at("ATL"), bal = at("BAL");
    doc.rows[aln] = { ...doc.rows[aln], bogus: 1 };
    doc.rows[atl] = { ...doc.rows[atl], status: "forced_open" };
    doc.rows[bal] = { ...doc.rows[bal], lat: "40" };
    doc.rows.push({ ...doc.rows[atl] });
    const dupIndex = doc.rows.length - 1;
    const body = { entity: "warehouses", format: "json", document: doc };

    const p = await preview(owner, own, body);
    expect(p.status).toBe(200);
    expect(p.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorClass: "syntax", line: null, rowIndex: aln, field: "bogus" }),
      expect.objectContaining({ errorClass: "syntax", line: null, rowIndex: bal, field: "lat" }),
      expect.objectContaining({ errorClass: "logic", line: null, rowIndex: dupIndex, message: expect.stringContaining("Duplicate id") }),
    ]));
    expect(p.body.changes).toEqual([expect.objectContaining({ id: "ATL", rowIndex: atl, line: atl + 2 })]);

    const strict = await apply(owner, own, { ...body, mode: "all_or_nothing" });
    expect(strict.status).toBe(422);
    expect(strict.body.preview.errors.length).toBe(p.body.errors.length);

    const partial = await apply(owner, own, { ...body, mode: "partial" });
    expect(partial.status).toBe(200);
    expect(partial.body.applied).toBe(1);
    expect((await exportJson(owner, own, "warehouses")).rows[atl]!.status).toBe("forced_open");
  });

  it("MAX_IMPORT_ROWS + 1 rows is a format error through the route (CSV and JSON)", async () => {
    const line = `${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.75,-84.39,,active`;
    const csvText = `${csvColumns("warehouses", TEMPLATE_VERSION).join(",")}\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => line).join("\n")}\n`;
    const jsonDoc = { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({})) };
    for (const body of [{ entity: "warehouses", csvText }, { entity: "warehouses", format: "json", document: jsonDoc }]) {
      const res = await preview(owner, id, body);
      expect(res.status).toBe(200);
      expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", line: null, message: expect.stringContaining(String(MAX_IMPORT_ROWS)) })]);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/importJsonRoundTrip.test.ts`
Expected: FAIL. JSON cases get 422 `csvText is required`; the 413 and 150 kB cases get 500; the malformed cases get 500 (the measured probe, deviation 1); non-owner malformed/oversized get 500 instead of 404. The "non-import route keeps today's behaviour" and "unauthenticated 401" cases already PASS, and they must keep passing.

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
        unit-bearing entity. Only these four top-level keys are allowed.
        Round trip = structural JSON equality of the re-export; added
        (scenario-local) entities round-trip into the same scenario only.
      example: { templateVersion: 1, entity: warehouses, rows: [{ templateVersion: 1, id: ALN, displayCode: null, city: Allentown, state: PA, lat: 40.602812, lng: -75.470433, capacity: null, status: forced_open, overridden: true }] }
      additionalProperties: false
      properties:
        templateVersion:
          type: integer
        entity:
          $ref: "#/components/schemas/ImportEntity"
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
      additionalProperties: false
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
      additionalProperties: false
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
      additionalProperties: false
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
      additionalProperties: false
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
        field:
          type: string
          description: The document key to blame, when one is (e.g. rows, entity, an unknown key).
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
          description: The request body is not valid JSON, or document violates ImportDocument (not an object, unknown top-level key, entity not an ImportEntity, unit not km/mi, rows not an array of objects). Only after auth and ownership — a non-owned scenario is 404 whatever the body.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ImportMalformedError"
        "401":
          description: Not authenticated
        "404":
          description: Not found (also a scenario owned by another user — never 403)
        "413":
          description: Request body exceeds the 2 MiB import wire limit (import routes only; checked after ownership)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PayloadTooLargeError"
        "422":
          description: Invalid entity, format (incl. null) or unknown request key, csvText missing for a CSV import, or this scenario's model doesn't support the entity
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```
In `/scenarios/{scenarioId}/import/apply`, the same `400`/`401`/`404`/`413` blocks (copy them verbatim), and a `422` of:
```yaml
        "422":
          description: Invalid entity, format, mode or unknown request key, model unsupported, merged inputs failed validation, or (all_or_nothing mode) the import had errors and nothing was applied — the last case carries the preview
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ImportApplyRejection"
```
Also change both summaries from "a CSV import" to "a CSV or JSON import".

- [ ] **Step 5: Orval — strict bodies for the two import operations only** (deviation 13)

In `lib/api-spec/orval.config.ts`, inside the `zod` target's `output.override`, add an `operations` key next to the existing `zod`/`useDates`/`useBigInt` keys:
```ts
        // SCU-2.P2.2 (B2.6) — additionalProperties:false only becomes .strict()
        // with Orval's strict.body flag. Scoped to the two import operations:
        // the global flag would also make auth's Register/Login/ForgotPassword/
        // ResetPassword bodies strict (auth.ts:114,170,312,349 parse with them).
        operations: {
          previewScenarioImport: { zod: { strict: { body: true } } },
          applyScenarioImport: { zod: { strict: { body: true } } },
        },
```

- [ ] **Step 6: Regenerate and prove the regen is stable**

```bash
pnpm --filter @workspace/api-spec codegen
```
Expected: two `🎉 … converted` lines, then `typecheck:libs` exit 0. (A scratch Orval 8.9.1 run of exactly this YAML and config, made while writing this plan, generated cleanly, and the regenerated api-zod index typechecked.)
```bash
grep -c "\.strict()" lib/api-zod/src/generated/api.ts
```
Expected: `6` (two bodies × csv branch, json branch, nested document), as measured in the scratch run. Any other count means the strict scope is wrong.
```bash
T=$(mktemp -d)
find lib/api-zod/src/generated lib/api-client-react/src/generated -type f -print0 | sort -z | xargs -0 shasum > "$T/gen1.sha"
pnpm --filter @workspace/api-spec codegen
find lib/api-zod/src/generated lib/api-client-react/src/generated -type f -print0 | sort -z | xargs -0 shasum > "$T/gen2.sha"
diff "$T/gen1.sha" "$T/gen2.sha" && echo REGEN-STABLE
```
Expected: `REGEN-STABLE`. Then `git status --short lib/api-zod/src/generated lib/api-client-react/src/generated` lists the three deleted `importRequestEntity.ts`/`importApplyRequestEntity.ts`/`importApplyRequestMode.ts` per package and the new files from the Files list.

- [ ] **Step 7: Write the failing pure tests — contract (generated code pinned to constants, strict parity) and edge values**

`artifacts/api-server/src/__tests__/importSchemaContract.test.ts`:
```ts
// SCU-2.P2.2 (B2.6) — the regenerated contract, exercised with POPULATED rows
// built by the production writers and versions read from the CONSTANTS (never
// literals): root CLAUDE.md "contract-version" + "hand-authored fixture"
// gotchas. Plus the strict-oneOf parity table: the generated Zod and the
// server's hand parser must accept and reject exactly the same bodies.
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
import { parseAndValidateJsonImport, readImportRequest } from "../services/import.js";

const DOC = { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows: [{ id: "ATL", status: "forced_open" }] };
const CSV = { entity: "warehouses", csvText: "x" };
const JSON_REQ = { entity: "warehouses", format: "json", document: DOC };

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
    expect(readImportRequest(body, "preview").ok).toBe(true);
  });

  it("a v2 distance document parses with its unit", () => {
    const rows = applyDistanceOverrides([{ fromId: "ALN", toId: "C1", distance: 12 }], "mi").map(toDistanceJsonRow);
    const body = { entity: "distances", format: "json", document: { templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "mi", rows } };
    expect(PreviewScenarioImportBody.safeParse(body).success).toBe(true);
    expect(readImportRequest(body, "preview").ok).toBe(true);
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

// [case, body, accepted, expected server status when rejected]
const PREVIEW_CASES: Array<[string, unknown, boolean, 400 | 422 | null]> = [
  ["format omitted (csv)", CSV, true, null],
  ["format csv", { ...CSV, format: "csv" }, true, null],
  ["format json", JSON_REQ, true, null],
  ["format null", { ...CSV, format: null }, false, 422],
  ["unknown format", { ...CSV, format: "xml" }, false, 422],
  ["mixed: csv + document", { ...CSV, format: "csv", document: DOC }, false, 422],
  ["mixed: format omitted + document", { ...CSV, document: DOC }, false, 422],
  ["json carrying csvText", { entity: "warehouses", format: "json", csvText: "x" }, false, 422],
  ["unknown request key", { ...CSV, extra: 1 }, false, 422],
  ["mode on preview", { ...CSV, mode: "partial" }, false, 422],
  ["entity not an import entity", { ...CSV, entity: "assignments" }, false, 422],
  ["json without document", { entity: "warehouses", format: "json" }, false, 400],
  ["document extra top-level key", { ...JSON_REQ, document: { ...DOC, exportedAt: "x" } }, false, 400],
  ["document.entity not an import entity", { ...JSON_REQ, document: { ...DOC, entity: "assignments" } }, false, 400],
  ["document.unit not km/mi", { ...JSON_REQ, document: { ...DOC, unit: "ft" } }, false, 400],
  ["document.rows not an array", { ...JSON_REQ, document: { ...DOC, rows: {} } }, false, 400],
  ["document row not an object", { ...JSON_REQ, document: { ...DOC, rows: [1] } }, false, 400],
  ["document.templateVersion not a number", { ...JSON_REQ, document: { ...DOC, templateVersion: "1" } }, false, 400],
];
const APPLY_CASES: Array<[string, unknown, boolean]> = [
  ["mode omitted", CSV, true],
  ["mode partial", { ...CSV, mode: "partial" }, true],
  ["json + mode", { ...JSON_REQ, mode: "all_or_nothing" }, true],
  ["mode bogus", { ...CSV, mode: "bogus" }, false],
  ["mode null", { ...CSV, mode: null }, false],
];

describe("strict oneOf: generated Zod and readImportRequest agree on every case", () => {
  it.each(PREVIEW_CASES)("preview — %s", (_name, body, accepted, status) => {
    expect(PreviewScenarioImportBody.safeParse(body).success).toBe(accepted);
    const result = readImportRequest(body, "preview");
    expect(result.ok).toBe(accepted);
    if (!result.ok) {
      expect(result.status).toBe(status);
      if (status === 400) expect(result.body.errorClass).toBe("malformed");
    }
  });
  it.each(APPLY_CASES)("apply — %s", (_name, body, accepted) => {
    expect(ApplyScenarioImportBody.safeParse(body).success).toBe(accepted);
    expect(readImportRequest(body, "apply").ok).toBe(accepted);
  });
});
```

`artifacts/api-server/src/__tests__/importJsonEdgeValues.test.ts` (review #6, #10):
```ts
// SCU-2.P2.2 (B2.6) — edge values through the JSON → CSV → validator path, and
// the 20,000 / 20,001 row boundary for both formats. Pure (no DB).
import { describe, it, expect } from "vitest";
import { MAX_IMPORT_ROWS, TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import type { ImportEntity } from "@workspace/import-schema";
import { parseAndValidateImport, parseAndValidateJsonImport } from "../services/import.js";

const M = "p-median-us";
const json = (entity: ImportEntity, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  parseAndValidateJsonImport(entity, { templateVersion: TEMPLATE_VERSION, entity, rows, ...extra }, {}, 3, M);
const ATL = { id: "ATL", displayCode: null, city: "Atlanta", state: "GA", lat: 33.753693, lng: -84.389544, capacity: null, status: "active" };

describe("edge values", () => {
  it("quotes, commas and newlines survive JSON → CSV → validator unchanged", () => {
    const city = 'Fort "Big", Town\nNorth';
    const displayCode = 'A,B "C"';
    const p = json("warehouses", [{ ...ATL, id: null, displayCode, city, status: "active" }]);
    expect(p.errors).toEqual([]);
    expect(p.changes).toEqual([expect.objectContaining({ changeType: "add", city, displayCode, rowIndex: 0, line: 2 })]);
  });

  it("false survives: disabling a capable plant×product pair is a real change", () => {
    const p = parseAndValidateJsonImport("plantCapabilities", { templateVersion: TEMPLATE_VERSION, entity: "plantCapabilities", rows: [{ plantId: "plant-1", productId: "product-1", enabled: false }] }, {}, 2, "two-echelon-jade-us");
    expect(p.errors).toEqual([]);
    expect(p.changes).toEqual([expect.objectContaining({ after: { status: "false", value: 0 }, rowIndex: 0 })]);
  });

  it("null on a nullable field is a blank cell, not an error", () => {
    expect(json("warehouses", [{ ...ATL, displayCode: null, capacity: null, lat: null }]).errors).toEqual([]);
  });

  it("envelope-backed fields may be omitted from rows (templateVersion; unit on v2)", () => {
    expect(json("warehouses", [ATL]).errors).toEqual([]);
    const v2 = parseAndValidateJsonImport("distances", { templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "mi", rows: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] }, {}, 3, M);
    expect(v2.errors).toEqual([]);
    expect(v2.changes[0]!.after.value).toBe(123.4); // mi → mi is identity
  });

  it("km converts to the canonical mi with the existing 4-dp rounding (100 km → 62.1371 mi)", () => {
    const p = parseAndValidateJsonImport("distances", { templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "km", rows: [{ fromId: "ALN", toId: "C1", distance: 100 }] }, {}, 3, M);
    expect(p.errors).toEqual([]);
    expect(p.changes[0]!.after.value).toBe(62.1371);
  });

  it("a row-level templateVersion wins over the envelope's", () => {
    expect(json("warehouses", [{ ...ATL, templateVersion: TEMPLATE_VERSION + 1 }]).errors).toEqual([expect.objectContaining({ rowIndex: 0, message: expect.stringContaining("template_version") })]);
  });

  it("a non-null value of the wrong JSON type is a syntax error on that field", () => {
    expect(json("warehouses", [{ ...ATL, capacity: "5" }]).errors).toEqual([expect.objectContaining({ errorClass: "syntax", rowIndex: 0, field: "capacity" })]);
  });
});

describe("row-count boundary (MAX_IMPORT_ROWS)", () => {
  const capError = (errors: Array<{ message: string }>) => errors.some(e => e.message.includes(`maximum is ${MAX_IMPORT_ROWS}`));
  const csvWith = (n: number) => `${csvColumns("warehouses", TEMPLATE_VERSION).join(",")}\n${Array.from({ length: n }, () => `${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.75,-84.39,,active`).join("\n")}\n`;

  it(`CSV: ${MAX_IMPORT_ROWS} rows accepted by the cap, ${MAX_IMPORT_ROWS + 1} rejected`, () => {
    expect(capError(parseAndValidateImport("warehouses", csvWith(MAX_IMPORT_ROWS), {}, 3, M).errors)).toBe(false);
    expect(parseAndValidateImport("warehouses", csvWith(MAX_IMPORT_ROWS + 1), {}, 3, M).errors).toEqual([expect.objectContaining({ errorClass: "format", line: null })]);
  });

  it(`JSON: ${MAX_IMPORT_ROWS} rows accepted by the cap, ${MAX_IMPORT_ROWS + 1} rejected`, () => {
    expect(capError(json("warehouses", Array.from({ length: MAX_IMPORT_ROWS }, () => ATL)).errors)).toBe(false);
    expect(json("warehouses", Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ATL)).errors).toEqual([expect.objectContaining({ errorClass: "format", line: null })]);
  });
});
```
(At 20,000 identical ATL rows the validator still reports one duplicate per extra row. The boundary assertion is only that the **cap** error is absent.)

Run: `cd artifacts/api-server && pnpm exec vitest run src/__tests__/importSchemaContract.test.ts src/__tests__/importJsonEdgeValues.test.ts`
Expected: FAIL — `parseAndValidateJsonImport` / `readImportRequest` are not exported yet (the generated names exist after Step 6).

- [ ] **Step 8: Server — `services/import.ts`**

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
import type { ImportFieldDescriptor, ImportJsonDocument } from "@workspace/import-schema";
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
// checked against @workspace/import-schema (the document's SHAPE was already
// checked by readImportRequest), the rows become CSV text in the
// entity's own header order, and the existing CSV validator above decides
// everything else (ids, duplicates, values, add mode). Its line numbers are
// then mapped back to document.rows indexes.
// ---------------------------------------------------------------------------

function tooManyRowsError(count: number): ImportError {
  return { errorClass: "format", line: null, message: `File has ${count} data rows; the maximum is ${MAX_IMPORT_ROWS} per import.` };
}

export type ImportPayload =
  | { format: "csv"; csvText: string }
  | { format: "json"; document: ImportJsonDocument };

export type ReadImportRequestResult =
  | { ok: true; entity: ImportEntity; payload: ImportPayload; mode: "all_or_nothing" | "partial" }
  | { ok: false; status: 400 | 422; body: { error: string; errorClass?: "malformed"; field?: string } };

const REQUEST_KEYS = { csv: ["entity", "format", "csvText"], json: ["entity", "format", "document"] } as const;
const DOCUMENT_KEYS = new Set(["templateVersion", "entity", "unit", "rows"]);
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The hand-written twin of the strict OpenAPI oneOf (additionalProperties:
 * false). importSchemaContract.test.ts pins it case-for-case to the generated
 * Zod. Request-envelope violations → 422; `document` schema violations → 400
 * malformed. Runs AFTER the ownership lookup (the route mounts it that way).
 */
export function readImportRequest(body: unknown, route: "preview" | "apply"): ReadImportRequestResult {
  const invalid = (error: string): ReadImportRequestResult => ({ ok: false, status: 422, body: { error } });
  const malformed = (error: string, field: string): ReadImportRequestResult => ({ ok: false, status: 400, body: { error, errorClass: "malformed", field } });

  if (!isPlainObject(body)) return invalid("request body must be a JSON object");
  if (!isImportEntity(body.entity)) return invalid(`entity must be one of: ${IMPORT_ENTITIES.join(", ")}`);
  const format = "format" in body ? body.format : "csv"; // omitted = csv; null is rejected below
  if (format !== "csv" && format !== "json") return invalid("format must be 'csv' or 'json'");
  const allowed = new Set<string>([...REQUEST_KEYS[format], ...(route === "apply" ? ["mode"] : [])]);
  const unknownKey = Object.keys(body).find(k => !allowed.has(k));
  if (unknownKey !== undefined) return invalid(`Unknown request field "${unknownKey}"`);
  const mode = "mode" in body ? body.mode : "all_or_nothing";
  if (mode !== "all_or_nothing" && mode !== "partial") return invalid("mode must be 'all_or_nothing' or 'partial'");

  if (format === "csv") {
    if (typeof body.csvText !== "string") return invalid("csvText is required");
    return { ok: true, entity: body.entity, payload: { format, csvText: body.csvText }, mode };
  }
  const doc = body.document;
  if (!isPlainObject(doc)) return malformed("document must be a JSON object", "document");
  const unknownDocKey = Object.keys(doc).find(k => !DOCUMENT_KEYS.has(k));
  if (unknownDocKey !== undefined) return malformed(`Unknown document field "${unknownDocKey}"`, unknownDocKey);
  if (typeof doc.templateVersion !== "number") return malformed("document.templateVersion must be a number", "templateVersion");
  if (!isImportEntity(doc.entity)) return malformed(`document.entity must be one of: ${IMPORT_ENTITIES.join(", ")}`, "entity");
  if ("unit" in doc && doc.unit !== "km" && doc.unit !== "mi") return malformed("document.unit must be 'km' or 'mi'", "unit");
  if (!Array.isArray(doc.rows) || !doc.rows.every(isPlainObject)) return malformed("document.rows must be an array of JSON objects", "rows");
  return { ok: true, entity: body.entity, payload: { format, document: doc as unknown as ImportJsonDocument }, mode };
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
  document: ImportJsonDocument, // shape already guaranteed by readImportRequest
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

  document.rows.forEach((record, rowIndex) => {
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

- [ ] **Step 9: Server — route-scoped body (after ownership) + routes + app** (deviation 1)

`routes/scenarios.ts` imports:
- change `import { Router } from "express";` to `import express, { Router, type Request, type Response, type NextFunction } from "express";`;
- change `import { parseAndValidateImport } from "../services/import.js";` to `import { previewImport, readImportRequest } from "../services/import.js";`. Keep `ImportEntity` as a type import only if still referenced;
- add `import { MAX_IMPORT_BYTES } from "@workspace/import-schema";`.

Add above `router.post("/scenarios/:scenarioId/import"` (after the merge helpers):
```ts
// SCU-2.P2.2 (B2.6; review #1) — the two import routes read their body AFTER
// auth (router-wide requireAuth) and AFTER this ownership lookup, so a
// non-owned scenario is 404 whatever the body (never 400/413) and the 2 MiB
// limit cannot be used to probe ids. app.ts's global express.json() skips
// exactly these two paths; every other route keeps it unchanged.
async function loadOwnedImportScenario(req: Request, res: Response, next: NextFunction): Promise<void> {
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, Number(req.params.scenarioId)), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }
  res.locals.importScenario = scenario;
  next();
}

const importJsonBody = express.json({ limit: MAX_IMPORT_BYTES });

// Answers body-parser failures for the import routes only (type strings:
// raw-body@3.0.2/index.js:167, body-parser@2.2.2/lib/read.js:166).
function importBodyErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.too.large") { res.status(413).json({ error: "payload_too_large" }); return; }
  if (type === "entity.parse.failed") { res.status(400).json({ error: "Request body is not valid JSON.", errorClass: "malformed" }); return; }
  next(err);
}
```
Preview route (`:1599-1615`): replace the signature line, the body destructure, the entity chain, the `csvText` check and the `db.select … 404` lookup with:
```ts
router.post("/scenarios/:scenarioId/import", loadOwnedImportScenario, importJsonBody, importBodyErrors, async (req: Request, res: Response) => {
  const id = Number(req.params.scenarioId);
  const scenario = res.locals.importScenario as typeof scenariosTable.$inferSelect;
  // Kept in the handler: lockedModelGuards.test.ts scans each :scenarioId handler's own text.
  if (isModelLocked(scenario.modelId)) { respondLocked(res); return; }
  // SCU-2.P2.2 (B2.6) — strict request contract (import-schema entity list, format default csv).
  const parsedRequest = readImportRequest(req.body, "preview");
  if (!parsedRequest.ok) { res.status(parsedRequest.status).json(parsedRequest.body); return; }
  const { entity, payload } = parsedRequest;
```
Remove the old `if (isModelLocked(...))` line that followed the lookup. Then replace the final `parseAndValidateImport(...)` call (`:1678`) with:
```ts
  const preview = previewImport(entity, payload, inputs as Parameters<typeof previewImport>[2], inputs.p ?? 0, scenario.modelId);
```
Apply route (`:1682-1699`): the same replacement with `"apply"` and
```ts
  const applyMode = parsedRequest.mode;
```
replacing the old destructure, entity chain, `csvText` check, `applyMode` line and lookup. Replace `:1745`'s `parseAndValidateImport(...)` with the same `previewImport(...)` call. The model guards, the merge branches and `applyScenarioInputWrite` are unchanged. The mocked `routes.test.ts` still sees one `db.select` before the write: it moved from the handler into the middleware. Remove any `entity as ImportEntity` casts that are now redundant.

`app.ts`: replace `app.use(express.json());` (`:68`) with:
```ts
// SCU-2.P2.2 (B2.6; review #1) — the two import routes parse their own body
// (route-scoped 2 MiB parser in routes/scenarios.ts, mounted after auth and
// ownership). Every other route keeps this unchanged global parser.
const IMPORT_BODY_PATH = /^\/api\/scenarios\/[^/]+\/import(?:\/apply)?\/?$/i;
const defaultJsonBody = express.json();
app.use((req, res, next) => (IMPORT_BODY_PATH.test(req.path) ? next() : defaultJsonBody(req, res, next)));
```
`express.urlencoded` and the catch-all error handler stay exactly as they are.

- [ ] **Step 10: Run the server tests to verify they pass**

Run: `cd artifacts/api-server && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm exec vitest run src/__tests__/importJsonRoundTrip.test.ts src/__tests__/importSchemaContract.test.ts src/__tests__/importJsonEdgeValues.test.ts src/__tests__/import.test.ts src/__tests__/importMultiModelRoundTrip.test.ts src/__tests__/routes.test.ts src/__tests__/error-handling.test.ts src/__tests__/lockedModelGuards.test.ts src/__tests__/importSchemaRouteParity.test.ts`
Expected: PASS. If TypeScript cannot infer `req.params`/`req.userId` on the inline handler next to the error-handling middleware, the explicit `(req: Request, res: Response)` annotation above is what fixes it.

- [ ] **Step 11: Write the failing ImportDialog tests**

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

  it("the check is on the serialized request BODY: a CSV just under 2 MiB whose body exceeds the wire limit is refused before sending", async () => {
    renderDialog();
    const file = new File(["x".repeat(MAX_IMPORT_BYTES - 10)], "big.csv", { type: "text/csv" });
    expect(file.size).toBeLessThan(MAX_IMPORT_BYTES);
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), file);
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent(LIMIT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a pretty-printed JSON file over 2 MiB whose compact body fits is sent", async () => {
    mockFetchRoutes({ errors: [], changes: [], warnings: [] });
    renderDialog({ format: "json" });
    const padded = JSON.stringify(document) + " ".repeat(MAX_IMPORT_BYTES); // trailing whitespace is valid JSON
    const file = new File([padded], "pretty.json", { type: "application/json" });
    expect(file.size).toBeGreaterThan(MAX_IMPORT_BYTES);
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), file);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ entity: "warehouses", format: "json", document });
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
Expected: FAIL (no `format` prop, no `import-file-error`, raw `payload_too_large` shown, no body-size check). The pre-existing tests in the file still pass.

- [ ] **Step 12: Rewrite `ImportDialog.tsx`**

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

const LIMIT_MESSAGE = `File is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB import limit.`; // same sentence for the client check and a server 413

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
      // SCU-2.P2.2 (B2.6; review #10) — the limit is on the WIRE body, so measure
      // the serialized request (with mode, the larger of preview/apply), never file.size.
      if (new Blob([JSON.stringify({ ...next, mode: "all_or_nothing" })]).size > MAX_IMPORT_BYTES) {
        setFileError(LIMIT_MESSAGE);
        return;
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

- [ ] **Step 13: Run studio tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/ImportDialog.test.tsx`
Expected: PASS (old and new tests).

- [ ] **Step 14: e2e sweep**

```bash
grep -rln "input-import-file\|import-preview-error\|import-error-row\|import-change-row\|Could not parse file\|Import failed\|entity must be\|csvText is required" artifacts/studio/e2e
```
Expected hits: `import.spec.ts`, `input-map-v2.spec.ts`, `jade-two-echelon.spec.ts`, `max-coverage.spec.ts`, `workspace-fixups.spec.ts` (all for `input-import-file-*`, whose testid and CSV `accept` are unchanged); none for the other strings. Open each hit and confirm that it uploads a `.csv`, so no rewrite is needed. If the local two-server setup is up, run `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/import.spec.ts`; otherwise record `e2e: not run — sweep only`.

- [ ] **Step 15: Gate** — the three gate commands, each separately; `git diff --stat "$BASE"..HEAD -- lib/db/src/schema/` → empty.

- [ ] **Step 16: Changelog** — append `### SCU-2.P2.2 — JSON import contract (B2.6)`. Record:
  - the strict oneOf shapes and the per-operation Orval `strict.body` (`.strict()` count 6);
  - the route-scoped 2 MiB parser after auth + ownership, with 413/400 and non-owned → 404 whatever the body (measured before: 500 for both malformed and 150 kB);
  - that non-import routes are unchanged;
  - the 20,000/20,001 boundary for CSV and JSON;
  - `rowIndex`/`field`;
  - deviations 1, 2, 10, 11, 12, 13, 16;
  - `REGEN-STABLE`;
  - the round-trip case counts (16 cross-scenario base, 6 same-scenario added);
  - the gate counts from this run;
  - the e2e sweep result.

- [ ] **Step 17: Commit**

```bash
git add -A lib/api-zod/src/generated lib/api-client-react/src/generated
git add artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts artifacts/api-server/src/__tests__/importSchemaContract.test.ts artifacts/api-server/src/__tests__/importJsonEdgeValues.test.ts
```
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit lib/api-spec/openapi.yaml lib/api-spec/orval.config.ts lib/api-zod/src/generated lib/api-client-react/src/generated artifacts/api-server/src/app.ts artifacts/api-server/src/services/import.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts artifacts/api-server/src/__tests__/importSchemaContract.test.ts artifacts/api-server/src/__tests__/importJsonEdgeValues.test.ts artifacts/studio/src/components/ImportDialog.tsx artifacts/studio/src/__tests__/ImportDialog.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P2.2] accept the JSON export envelope on import (strict oneOf, route-scoped 2 MiB, 20k rows)" -m "Deviations 1 (route-scoped parser after ownership; non-owned 404 whatever the body), 2 (rowIndex on changes), 10 (client measures wire body), 11, 12, 13 (per-operation Orval strict.body), 16 (edge values). Spec + config + regenerated client in one commit." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P2.3: `deliveryCosts` entity — closed-union change (B2.7, D1)

**Owner role:** backend-engineer. **Spec:** B2.7, D1. **Deviations:** 6, 15. **Depends on:** SCU-2.P2.2.

**Files:**
- Modify: `lib/import-schema/src/index.ts` (+ `src/__tests__/importSchema.test.ts`)
- Modify: `lib/api-spec/openapi.yaml` (`ImportEntity` enum; export `entity` query enum `:522`; `ExportEnvelopeV1` description + enum `:2027-2047`; `ExportEnvelope` description `:2270-2277`) + regenerated `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`
- Modify: `artifacts/api-server/src/data/referenceCosts.ts` (`deliveryBaseCost`)
- Modify: `artifacts/api-server/src/services/import.ts` (`SingleIdEntity`, header check, dispatch, parser)
- Modify: `artifacts/api-server/src/services/templates.ts` (`DeliveryCostRow`, `applyDeliveryCostOverrides`, `deliveryCostRowsToCsv`)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (export allowlist `:618-620`; delivery guard in export `:894,915-916`, import `:1655,1658-1659`, apply `:1731,1734-1735`; delivery export branch `:1282`; apply merge branch before the refineries `else`)
- Modify: `artifacts/studio/src/lib/exportEntity.ts:9`, `artifacts/studio/src/contexts/ExportContext.tsx:20-38`, `artifacts/studio/src/__tests__/ExportContext.test.tsx`
- Create: `artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts`, `artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts`
- Modify: `artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts` (one case), `artifacts/api-server/src/__tests__/importSchemaContract.test.ts` (one test), `artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts` (two guard cases)
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
export function applyDeliveryCostOverrides(overrides: Array<{ fromId: string; toId: string; cost: number }>): DeliveryCostRow[]; // drops redundant overrides (cost === base)
export function deliveryCostRowsToCsv(rows: DeliveryCostRow[]): string; // header "template_version,from_id,to_id,cost"
// data/referenceCosts.ts (not import.ts: templates.ts needs it, and import.ts imports templates.ts)
export function deliveryBaseCost(fromId: string, toId: string): number | undefined;
// a deliveryCosts change that resets a pair to base carries after.status === "base"
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
import { parseAndValidateImport, parseAndValidateJsonImport } from "../services/import.js";
import { deliveryBaseCost } from "../data/referenceCosts.js";
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

  it("presence decides removal (review #8): equal-to-base is a no-op without an override, a reset-to-base with one — even a redundant one", () => {
    expect(run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`)).changes).toEqual([]);
    const back = run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`), [{ fromId: "W8", toId: "C269", cost: 1 }]);
    expect(back.changes).toEqual([expect.objectContaining({ before: { status: "active", value: 1 }, after: { status: "base", value: 1047.7157 } })]);
    // A stored override whose value ALREADY equals base: the effective value is
    // unchanged, but the row must still remove the override.
    const redundant = run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`), [{ fromId: "W8", toId: "C269", cost: 1047.7157 }]);
    expect(redundant.changes).toEqual([expect.objectContaining({ before: { status: "active", value: 1047.7157 }, after: { status: "base", value: 1047.7157 } })]);
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
  it("emits only overridden pairs that differ from base, unconverted, under the import header", () => {
    const rows = applyDeliveryCostOverrides([{ fromId: "W8", toId: "C269", cost: 1 }, { fromId: "W8", toId: "C8", cost: 0 }]);
    expect(rows).toEqual([{ fromId: "W8", toId: "C269", cost: 1 }]); // W8,C8 = 0 equals base: redundant, filtered
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

  it("a stored REDUNDANT override (cost already equal to base) is hidden from export and removed by an explicit equal-to-base row", async () => {
    const id = await create([{ fromId: "W8", toId: "C269", cost: 1047.7157 }]);
    const before = await request(app).get(`/api/scenarios/${id}/export`).query({ entity: "deliveryCosts", format: "json" }).set("Cookie", cookie);
    expect(before.body.rows).toEqual([]);
    const res = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,1047.7157\n`);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(await overridesOf(id)).toEqual([]);
  });

  it("a real change advances inputsUpdatedAt + solveInputRevision; a no-op import does not advance the revision (review #9)", async () => {
    const id = await create();
    const read = async () => (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;
    const r0 = await read();
    expect((await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,2\n`)).status).toBe(200);
    const r1 = await read();
    expect(r1.solveInputRevision).toBe(r0.solveInputRevision + 1);
    expect(r1.inputsUpdatedAt.getTime()).toBeGreaterThan(r0.inputsUpdatedAt.getTime());
    const noop = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,2\n`);
    expect(noop.status).toBe(200);
    expect(noop.body.applied).toBe(0);
    const r2 = await read();
    expect(r2.solveInputRevision).toBe(r1.solveInputRevision);
    expect(r2.inputsUpdatedAt.getTime()).toBe(r1.inputsUpdatedAt.getTime());
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

In `importSchemaRouteParity.test.ts`, append to `GUARD_CASES` (16 cases total):
```ts
  { modelId: "delivery-teaching-us", entity: "deliveryCosts", supported: true },
  { modelId: "transport-coal", entity: "deliveryCosts", supported: false },
```
and relax its "exactly one accepted case per model" assertion to `toBeGreaterThanOrEqual(1)` (delivery now has two).

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

Then run Step 6 of SCU-2.P2.2 verbatim (codegen, `.strict()` count still `6`, mktemp shasum, codegen, diff → `REGEN-STABLE`).

- [ ] **Step 6: Server**

`services/import.ts`:
- `type SingleIdEntity = Exclude<ImportEntity, "distances" | "laneCosts" | "legDistances" | "plantCapabilities" | "deliveryCosts">;` (TypeScript forces this: `COLUMNS` is a `Record<SingleIdEntity, …>`).
`data/referenceCosts.ts` (append; it already builds the matrix at load):
```ts
// SCU-2.P2.3 (B2.7, D1) — the delivery base matrix as a pair lookup, shared by
// the importer, the exporter and the apply merge. Lives here (not import.ts)
// so templates.ts can use it without an import.ts ↔ templates.ts cycle.
const DELIVERY_BASE_COST_BY_PAIR: ReadonlyMap<string, number> = new Map(
  REFERENCE_COSTS_BY_MODEL["delivery-teaching-us"]!.pairs.map(p => [`${p.fromId}|${p.toId}`, p.cost]),
);

export function deliveryBaseCost(fromId: string, toId: string): number | undefined {
  return DELIVERY_BASE_COST_BY_PAIR.get(`${fromId}|${toId}`);
}
```
`services/import.ts`: add `import { deliveryBaseCost } from "../data/referenceCosts.js";` and, below `PLANT_CAPABILITY_COLUMNS`:
```ts
// SCU-2.P2.3 (B2.7, D1) — delivery-teaching-us's lane-cost overrides.
const DELIVERY_COST_COLUMNS = csvColumns("deliveryCosts", TEMPLATE_VERSION);
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
// SCU-2.P2.3 (B2.7, D1; review #8). `before` is the EFFECTIVE cost (override
// ?? base). Removal is decided by the override's PRESENCE: a row equal to base
// on an overridden pair is a reset-to-base change (after.status "base") even
// when the stored override already equals base, and the apply merge drops it.
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
    const base = deliveryBaseCost(fromId, toId);
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
    const hasOverride = overrideByPair.has(pairKey);
    const before = hasOverride ? overrideByPair.get(pairKey)! : base;
    if (cost === base) {
      if (hasOverride) changes.push({ id: pairKey, line, before: { status: "active", value: before }, after: { status: "base", value: base }, fromId, toId });
    } else if (before !== cost) {
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
// (add to the imports: `import { deliveryBaseCost } from "../data/referenceCosts.js";`)
export interface DeliveryCostRow { fromId: string; toId: string; cost: number; }

/** Drops redundant overrides (cost equal to base), so the export is the true sparse diff. */
export function applyDeliveryCostOverrides(overrides: Array<{ fromId: string; toId: string; cost: number }>): DeliveryCostRow[] {
  return overrides
    .filter(o => o.cost !== deliveryBaseCost(o.fromId, o.toId))
    .map(o => ({ fromId: o.fromId, toId: o.toId, cost: o.cost }));
}

export function deliveryCostRowsToCsv(rows: DeliveryCostRow[]): string {
  const header = csvColumns("deliveryCosts", TEMPLATE_VERSION).join(",");
  const lines = rows.map(r => [TEMPLATE_VERSION, r.fromId, r.toId, r.cost].join(","));
  return [header, ...lines].join("\n") + "\n";
}
```

`routes/scenarios.ts`:
- Import `applyDeliveryCostOverrides`, `deliveryCostRowsToCsv` from templates. The merge below needs no base lookup: a reset is marked by `after.status === "base"`.
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
// SCU-2.P2.3 (B2.7, D1; review #8) — upsert; a reset-to-base change
// (after.status "base", set by the parser on override PRESENCE) removes the
// override, keeping laneCostOverrides sparse.
function mergeDeliveryCostChangesIntoOverrides(
  currentOverrides: Array<{ fromId: string; toId: string; cost: number }>,
  changes: ImportRowChange[],
): Array<{ fromId: string; toId: string; cost: number }> {
  const changedKeys = new Set(changes.map(c => `${c.fromId}|${c.toId}`));
  const rest = currentOverrides.filter(o => !changedKeys.has(`${o.fromId}|${o.toId}`));
  const applied = changes
    .filter(c => c.after.status !== "base")
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
Expected: PASS. The route-parity file now runs 16 guard cases (deviation 15). The pure parity file covers 23 supported pairs. Parity covers `deliveryCosts.cost` blank → error (deviation 6), 0 accepted and −1 rejected. `DeliveryCostsTab.test.tsx` is unchanged (spec B2.7).

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

- [ ] **Step 12: Changelog** — append `### SCU-2.P2.3 — deliveryCosts entity (B2.7, D1)`. Record: the closed-union checklist (package, OpenAPI ×3 enums, regen `REGEN-STABLE`, service union, export allowlist, 3 delivery guards, export branch, apply branch, `ExportEntity`, `INPUT_ENTITIES`); sparse + presence-based removal + redundant-override export filter (review #8); staleness revision/no-op (review #9); deviation 6; pure parity 23 pairs, route parity 16 guard cases; the `e2e_accuracy.py` and `e2e_journey.py` delivery/transport results; gate counts from this run; lib/db schema unchanged. Close the phase with: `P2 complete — P3/P4 consume IMPORT_SCHEMAS, exampleCsv/exampleJsonDocument, MAX_IMPORT_BYTES, ImportDialog format, ImportError.rowIndex/field.`

- [ ] **Step 13: Commit**

```bash
git add -A lib/api-zod/src/generated lib/api-client-react/src/generated
git add artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts
```
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit lib/import-schema lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated artifacts/api-server/src/data/referenceCosts.ts artifacts/api-server/src/services/import.ts artifacts/api-server/src/services/templates.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/importSchemaRouteParity.test.ts artifacts/api-server/src/__tests__/deliveryCostsImport.test.ts artifacts/api-server/src/__tests__/deliveryCostsImportRoute.test.ts artifacts/api-server/src/__tests__/importJsonRoundTrip.test.ts artifacts/api-server/src/__tests__/importSchemaContract.test.ts artifacts/studio/src/lib/exportEntity.ts artifacts/studio/src/contexts/ExportContext.tsx artifacts/studio/src/__tests__/ExportContext.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P2.3] add deliveryCosts import/export entity (sparse, billable miles)" -m "D1: only overridden pairs differing from base; presence-based removal (incl. redundant overrides); no unit; real change bumps revision, no-op does not. Deviation 6: blank cost rejected. Closed-union change in one commit: package, OpenAPI, regen, server, studio unions." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (self-review)

| Spec item | Task / step |
|---|---|
| B2.5 content: csvHeader/jsonKey, type, nullable, requiredForAdd/Update, enum, min (max: deviation 9), unitFamily, example, models; version families incl. `DISTANCES_COLUMNS(_V2)`, `LANE_COST_COLUMNS`, `PLANT_CAPABILITY_COLUMNS`, `COLUMNS`; blank-id = add | 2.P2.1 Step 5 (`addModels`, id descriptor) |
| B2.5 header matching stays exact; server switches with no column change | 2.P2.1 Steps 3 (literal pins), 10, 11 |
| B2.5 wiring: package files, composite tsconfig, 3 references, deps in both packages, lockfile, filtered builds, Docker | 2.P2.1 Steps 2, 7, 12 |
| B2.6 oneOf, `format` default csv, document = export envelope, round trip (structural equality) | 2.P2.2 Steps 2, 4, 7, 8, 9 |
| B2.6 entity match, version supported, unknown keys, duplicate rule, malformed 400 | 2.P2.2 Steps 2, 7, 8, 9 (deviation 1) |
| B2.6 `rowIndex`/`field`, CSV keeps `line`, apply 422 documented as-is | 2.P2.2 Steps 4, 8 (deviation 2) |
| B2.6 2 MiB / 413 / 20,000 rows | 2.P2.2 Steps 2, 7, 8, 9, 12 |
| B2.6 ownership 404 | 2.P2.2 Step 2; 2.P2.3 Step 2 |
| B2.6 tests: preview+apply, populated round trip every entity, non-owner 404, 413, malformed, mismatch, format omitted, contract pinned to constants | 2.P2.2 Steps 2, 7; 2.P2.3 Step 2 (11th entity) |
| B2.7 representation D1 (sparse, billable miles, no unit, base-pair only, equal-to-base removes) | 2.P2.3 Steps 2, 4, 6 |
| B2.7 checklist: OpenAPI import + export enums, regen, service union, route allowlists, delivery guards, ImportDialog/ExportEntity/INPUT_ENTITIES, import-schema entry, tests + populated round-trip fixture | 2.P2.3 Steps 4–7, 2 |
| DeliveryCostsTab inline "+ Add row" and its tests unchanged | 2.P2.3 Step 8 (runs them unchanged) |
| Contract tasks: regen no diff on re-run | 2.P2.2 Step 6; 2.P2.3 Step 5 |
| After P2: `e2e_accuracy.py`, `e2e_journey.py` delivery + transport | 2.P2.3 Step 9 |
| ImportDialog format param (P2 plumbing); client measures the wire body | 2.P2.2 Steps 11–12 |
| **Review fold (rev 2)** | |
| #1 route-scoped parser, non-import routes unchanged, ownership before body | 2.P2.2 Steps 2, 9 (deviation 1) |
| #2 strict oneOf, `format: null`, shared `ImportEntity`, generated-Zod parity | 2.P2.2 Steps 4–7 (deviation 13) |
| #3 `customers.demand` includes delivery; applicability test | 2.P2.1 Steps 5, 8 (deviation 14) |
| #4 unknown top-level document keys → 400 | 2.P2.2 Steps 2, 7, 8 |
| #5 round-trip scope; same-scenario added entities | 2.P2.2 Step 2 |
| #6 `Papa.unparse` example; edge values; structural equality | 2.P2.1 Step 5; 2.P2.2 Step 7 (deviation 16) |
| #7 unit parity over all pairs + 14→16 real-DB guard cases | 2.P2.1 Step 8; 2.P2.3 Step 2 (deviation 15) |
| #8 presence-based removal; export filters redundant overrides | 2.P2.3 Steps 2, 6 (deviation 6) |
| #9 staleness: revision + inputsUpdatedAt advance; no-op does not | 2.P2.3 Step 2 |
| #10 one wire limit; client body measure; 20,000/20,001 | 2.P2.2 Steps 7, 11–12 (deviation 10) |
| #11 frozen install + built-server smoke; regen hashes in mktemp | 2.P2.1 Step 12; 2.P2.2 Step 6 |
| #12 deploy note | "Deploy note" section |
| No lib/db schema change | every task's gate step |
