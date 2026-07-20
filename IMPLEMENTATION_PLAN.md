# Network Optimization Studio v2 — Technical Implementation Plan

**Revision:** v0.2 — incorporates the system-design critique that the original plan's typed-per-model schema (`scenarios.pValue`, `.warehouseStatuses`, etc.) does not scale past the current three models. This revision changes the **shape** of Phases 2–3 to build the generic, plugin-friendly design directly instead of a typed-schema detour that would need migrating later, and adds **Phase 3.5** (model registry, standardized result envelope, async job queue). Phases 1, 4, 5 are functionally unchanged; their file lists shift slightly because the schema they build on is now generic. Read §0.5a before starting Phase 2.

**Audience:** Claude Code (autonomous execution) and human reviewers.
**Source of truth for scope:** `PRD-network-optimization-studio-v2.md` (v0.1). Requirement IDs below (A1, D5, X1…) reference that PRD.
**Repo:** `ShubhamKr07/network-optimization-studio` — pnpm monorepo, Node 24, TS 5.9, Express 5, Drizzle/Postgres, React+Vite frontend, Python/PuLP/CBC solver.

---

## 0. Operating instructions for Claude Code

Read this section fully before executing any task.

### 0.1 Ground rules (non-negotiable)

1. **Contract-first, always.** Any API shape change starts in `lib/api-spec/openapi.yaml`, then run codegen (see 0.3). NEVER hand-edit anything under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. If a generated file looks wrong, fix the spec or `lib/api-spec/orval.config.ts`.
2. **The accuracy suite is sacred.** `artifacts/api-server/src/solver/tests/e2e_accuracy.py` validates solver output against textbook answers. It must pass unmodified after every phase. If a change breaks it, the change is wrong (exception: task C2 label fixes, which have their own protocol — see C2).
3. **One task = one commit (or small commit series).** Commit message format: `[<task-id>] <imperative summary>`, e.g. `[A2.1] add user_id ownership to scenarios table`. Do not batch unrelated tasks into one commit.
4. **Run the verification gate (0.4) before marking any task done.** A task is not done because the code compiles; it is done when its listed tests pass and the gate is green.
5. **Sequencing is mandatory within a phase; phases 4 and late Phase 3.5 may interleave** as noted. Never start Phase 3 before Phase 2 is green, and never start Phase 4 before Phase 3.5's G2.1 (result envelope) is green — Phase 4 renders from that envelope.
6. **When this plan conflicts with reality** (a file moved, an API differs), trust the repo, fix the smallest thing possible, and note the deviation in the commit body. Do not silently redesign.
7. **Do not touch** `attached_assets/` (textbook source material) or the Replit deployment files (`.replit`, `replit.md`, `push-to-github.mjs`) except where a task explicitly says so.
8. **Blocked decisions:** three PRD open questions are pre-resolved for this plan (see 0.5). Any *other* ambiguity that changes user-facing behavior → stop and ask the human, don't guess.

### 0.2 Repo map (verified)

```
lib/api-spec/openapi.yaml            ← API contract (source of truth)
lib/api-spec/orval.config.ts         ← codegen config
lib/api-zod/src/generated/           ← generated Zod (do not edit)
lib/api-client-react/src/generated/  ← generated React Query hooks (do not edit)
lib/db/src/schema/{auth,scenarios,user_progress,index}.ts   ← Drizzle schema
lib/db/  scripts: `push` (drizzle-kit push), `push-force`
artifacts/api-server/src/routes/{auth,scenarios,progress,dataset,health}.ts
artifacts/api-server/src/solver/pmedian.ts   ← spawnSync wrapper (superseded by Phase 3.5 job dispatcher)
artifacts/api-server/src/solver/solve.py     ← PuLP models + HARDCODED datasets (dissolves into solvers/ in Phase 2/3.5)
artifacts/api-server/src/solver/tests/       ← pytest incl. e2e_accuracy.py
artifacts/studio/src/App.tsx                 ← wouter routes
artifacts/studio/src/pages/{Studio,Compare}.tsx
artifacts/studio/src/pages/arcadia/          ← to be deleted (Phase 1)
artifacts/studio/src/components/             ← NetworkMap, BrazilMap, OverlayMap, panels

TARGET (built across Phase 2/3/3.5, see §0.5a):
solvers/<model-id>/{manifest.json, dataset/*.json, solver.py, tests/}   ← one package per model
lib/db/src/schema/{scenarios, solve_jobs, result_cache}.ts             ← generic, no per-model columns
```

Existing tables: `users` (Replit-Auth remnant: id uuid, email unique, names, timestamps — REUSE, extend), `sessions` (unused by current cookie auth — repurpose or drop, see A1.2), `scenarios` (NO user_id), `user_progress` (delete in A3).
Target tables (Phase 3/3.5): `scenarios(id, user_id, model_id, name, inputs jsonb, inputs_version, result jsonb, solved_at, inputs_updated_at, created_at, updated_at)`, `solve_jobs(id, scenario_id, user_id, status, inputs_hash, result_summary jsonb, error, queued_at, started_at, finished_at)`, `result_cache(inputs_hash pk, model_id, result jsonb, created_at)` — optional, add if time permits.

### 0.3 Commands

```bash
pnpm install                                  # workspace install (pnpm only; npm/yarn blocked by preinstall)
pnpm run typecheck                            # whole workspace
pnpm --filter api-server test                 # API vitest
pnpm --filter studio test                     # frontend vitest
pnpm --filter studio test:e2e                 # Playwright
pnpm --filter @workspace/db push              # drizzle-kit push (schema → DB)
cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x   # solver suite
# Codegen: check lib/api-spec/ and root scripts/ for the orval invocation
# (likely `npx orval --config lib/api-spec/orval.config.ts` or a package script — locate once, then reuse).
```

Python deps: `pip install pulp pytest --break-system-packages` if missing. Postgres: expect `DATABASE_URL` env; for local dev spin up via docker or use the configured Replit DB URL from env.

### 0.4 Verification gate (run before closing every task)

```bash
pnpm run typecheck \
&& pnpm --filter api-server test \
&& pnpm --filter studio test \
&& (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Plus, if the task touched the OpenAPI spec: re-run codegen and `git diff --exit-code lib/api-zod lib/api-client-react` must show ONLY the intended regeneration (commit generated changes with the task).
Plus, at each phase end: `pnpm --filter studio test:e2e`.

### 0.5 Pre-resolved decisions (PRD open questions)

- **OQ1 (legacy scenarios):** create a system user `seed@local` at migration time; assign all pre-existing scenarios to it. Nothing is deleted.
- **OQ2 (cohort size / async solve):** assume pilot ≤ 10 concurrent users → X2 async solve stays **P1**, scheduled as Phase 6 (optional). Build Phase 3 so the payload path doesn't preclude it.
- **OQ4 (achieved gap):** ship the status-statement version ("proven optimal" / "within configured gap X%, limit reached"); CBC log parsing is a fast-follow.
- **OQ5 (import default):** default = **all-or-nothing**; "apply valid rows only" is an explicit opt-in checkbox in the preview.
- **OQ7 (email verification):** deferred; not built.
- **OQ3 & OQ6 remain human decisions** — C2 and D3-transport tasks include a STOP-AND-ASK step.

### 0.5a Scalability decisions (v0.2 — from the plugin-architecture critique)

The original plan's `scenarios` table grew a typed column per model concept (`pValue`, `warehouseStatuses`, `distanceBands`...). That doesn't scale past three models — every new model would mean a schema migration and API contract change. This revision course-corrects **before** those columns are built, not after:

- **Generic scenario storage.** `scenarios` gets exactly one model-shaped column: `inputs jsonb`. No `pValue`, `capacityMode`, `uniformCapacity`, `warehouseStatuses`, or `distanceBands` columns are created at all — not even temporarily. Everything that was going to be a typed column becomes a key inside `inputs`, validated at the API boundary against a per-model JSON Schema. This is a **change to Phase 3's D0.2**, not a new phase — see Phase 3 below.
- **Datasets live in per-model packages, not a flat shared folder.** Phase 2 (C1) now produces `solvers/<model-id>/dataset/*.json` per model instead of a single `lib/datasets/` folder — each model owns its dataset, manifest, solver module, and golden tests as one unit. This is the smallest change that makes "add a model" mean "add a folder."
- **`model_id` is a free-text field, not a foreign key.** Models are discovered from the filesystem registry at boot, not stored as DB rows. The API validates `model_id` against the live registry at write time.
- **Result envelope is standardized.** Every solver returns `{status, objective, runTimeSec, quality, edges, metrics, details}` — `edges` normalizes assignments (p-median) and flows (transportation) into one shape so the map, band coverage, and Compare can all be model-agnostic. This is built in **Phase 3.5**, inserted after Phase 3 and before Phase 4, because Phase 4 (routes/bands) and Phase 5 (Compare) both consume it — building it earlier avoids writing model-specific rendering code in Phase 4 and then generalizing it later.
- **Async solve is promoted from "Phase 6, optional" to part of Phase 3.5.** The generic `solve_jobs` table doubles as both the async job queue and the solve-history feature (A4), so building them together is cheaper than building typed history now and a queue later. Phase 6 is retained only for the *worker-pool scaling* concern (multiple concurrent solves), which genuinely can wait for cohort size to demand it.
- **Net effect on already-written tasks:** Phase 1 is unaffected. Phase 2's C1 tasks change target paths only (see below). Phase 3's D0 preamble and D1–D3 tasks change from "add typed/override columns" to "define and validate against a JSON Schema" — the student-facing behavior in every Phase 3 task's acceptance criteria is unchanged.

---

## Phase 1 — Auth, ownership, de-gamification (A1, A2, A3, B1, B2)

### Task A1.1 — OpenAPI: real auth endpoints
**Files:** `lib/api-spec/openapi.yaml`, regen.
Replace the current auth section: remove `/callback`, `/mobile-auth/*`, and the `userId`-body `/login`. Add:
- `POST /api/auth/register` — body `{email, password}` (email format, password minLength 8) → 201 `{user:{id,email,role}}`; 409 on duplicate.
- `POST /api/auth/login` — body `{email, password}` → 200 `{user}`; 401 generic on failure.
- `POST /api/auth/logout` → 200.
- `GET /api/auth/user` → `{user: {id,email,role} | null}`.
Define `User` schema with `role: enum[student, instructor]`.
**DoD:** codegen clean; typecheck green; no other endpoint changed in this task.

### Task A1.2 — Schema: extend users table
**Files:** `lib/db/src/schema/auth.ts`.
Add to `usersTable`: `passwordHash: varchar("password_hash")` (nullable for migration), `role: varchar("role").notNull().default("student")`. Keep the table/columns Replit comments removed; drop `profileImageUrl` only if nothing references it (grep first). Keep `sessions` table for now (unused ≠ harmful); mark with a `// TODO(remove after v2 stabilizes)` comment.
Run `pnpm --filter @workspace/db push`.
**DoD:** push succeeds; typecheck green.

### Task A1.3 — Auth routes implementation
**Files:** `artifacts/api-server/src/routes/auth.ts`, `artifacts/api-server/package.json` (add `bcryptjs` or `argon2` — prefer `argon2`; if native build is a problem in the deploy env, fall back to `bcryptjs` and note it).
Implement register/login/logout/user against `usersTable`. Session: keep the existing signed HTTP-only cookie mechanism but store the **user UUID** (rename cookie `arcadia_uid` → `nos_session`), `sameSite: lax`, 7-day TTL. Add an `requireAuth` Express middleware in `artifacts/api-server/src/middleware/auth.ts` exporting `req.userId`; 401 JSON when absent.
Constraints: identical error body for wrong-email vs wrong-password; never log password or hash; rate-limit login (simple in-memory counter, 10/min/IP is fine for pilot).
**Tests (new, vitest+supertest):** register→login→get user happy path; duplicate email 409; bad password 401 with generic message; logout clears session; `requireAuth` blocks anonymous.
**DoD:** gate green; manual curl of all four endpoints documented in commit body.

### Task A2.1 — Scenario ownership: schema + migration
**Files:** `lib/db/src/schema/scenarios.ts`, a one-off migration script `scripts/src/migrate-scenario-owners.ts`.
Add `userId: varchar("user_id").notNull().references(() => usersTable.id)` + index. Migration script: create/find user `seed@local` (random unusable password hash), set `user_id` on all NULL rows, then enforce NOT NULL. Because the repo uses `drizzle-kit push` (no migration files), do this as: (1) add column nullable, push; (2) run script; (3) make NOT NULL, push again.
**DoD:** script idempotent (safe to re-run); push green.

### Task A2.2 — Ownership enforcement in routes
**Files:** `artifacts/api-server/src/routes/scenarios.ts`, `lib/api-spec/openapi.yaml` (mark scenario endpoints as auth-required; add 401 responses).
Apply `requireAuth` to the whole scenarios router. Every query gains `AND user_id = req.userId`. `POST /scenarios` and `/clone` set `userId`. Not-owned-by-caller → **404** (not 403). `POST /scenarios/:id/solve` and compare likewise.
**Tests:** cross-user access returns 404 for get/patch/delete/solve/clone; list returns only own; create stamps owner. Update ALL existing scenario route tests to authenticate first (add a test helper `loginAs(email)`).
**DoD:** gate green; zero scenario endpoint reachable anonymously (add one test asserting 401 per endpoint).

### Task A3.1 — Remove gamification (backend)
**Files:** delete `artifacts/api-server/src/routes/progress.ts` + its registration; delete `lib/db/src/schema/user_progress.ts` + export from `index.ts`; remove `/progress*` paths and related schemas from `openapi.yaml`; regen.
Before dropping the table, if A4 (solve history, P1) is planned this cycle, extract nothing — the new table is independent. Drop `user_progress` via push.
**DoD:** grep for `progress|xp|streak|badge|quest|leaderboard` in `artifacts/api-server` and `lib/` returns nothing (case-insensitive, excluding this plan/PRD).

### Task A3.2 — Remove gamification (frontend) + new auth pages
**Files:** delete `artifacts/studio/src/pages/arcadia/` (Dashboard, QuestMap, Leaderboard, Badges), `GamificationContext`, `ArcadiaShell` and all imports; create `pages/auth/{Login,Register}.tsx` using the generated auth hooks; simple shell layout with app name, user email, logout.
Routing (wouter in `App.tsx`): unauthenticated → `/login`; authenticated → landing (B1). Remove all arcadia routes.
**Tests:** RTL tests for Login/Register validation + error display; update/remove arcadia component tests; update Playwright flows to the new login.
**DoD:** `grep -ri "arcadia\|quest\|xp\|badge\|leaderboard\|streak" artifacts/studio/src` → empty; e2e green.

### Task B1.1 — Chapter landing + routes
**Files:** `artifacts/studio/src/pages/Landing.tsx` (new), `App.tsx`.
Landing lists three labs: `/chapter-3` (Al's Athletics, p-median), `/chapter-5/transport` (coal LP), `/chapter-5/brazil` (capacitated p-median). Each studio route mounts the existing Studio page pre-bound to that model (pass model via route, not user selection). Scenario list on each chapter page shows only scenarios of that model (`?problemType=` query param on list endpoint — add to spec).
**DoD:** no problem-type selector rendered anywhere; direct URL navigation works; e2e updated.

### Task B2.1 — problemType locked server-side
**Files:** `openapi.yaml` (remove `problemType` from `ScenarioUpdate`), `routes/scenarios.ts` (PATCH rejects `problemType` with 422; POST derives/validates it), regen.
**Tests:** PATCH with problemType → 422; POST without valid problemType → 422; solver dispatch unaffected (existing solve tests still pass).
**Phase 1 exit:** full gate + e2e green; two different users in one Playwright test cannot see each other's scenarios.

---

## Phase 2 — Data layer extraction into model packages (C1, C2, X3)

**Scope change from v0.1 (see §0.5a):** datasets are extracted directly into per-model package directories (`solvers/<model-id>/`) instead of a shared `lib/datasets/` folder. This is the foundation the registry (Phase 3.5) and any future model addition will read from — getting the target layout right now avoids a second migration later. `solve.py` itself is **not** split into separate modules yet (that's Phase 3.5, once the result envelope and dispatch contract are defined) — Phase 2 only extracts data, Phase 2 leaves `solve.py`'s three solve functions in place reading from the new paths.

### Task C1.1 — Canonical dataset files as model packages
**Files:** new top-level `solvers/` directory (outside any existing pnpm package — plain data + Python, no build step needed yet):
```
solvers/p-median-us/dataset/{warehouses.json, customers.json, distances.json, version.json}
solvers/transport-coal/dataset/{mines.json, stations.json, costs.json, version.json}
solvers/p-median-brazil/dataset/{warehouses.json, states.json, distances.json, version.json}
```
`version.json` per package: `{"version": 1, "sha256": "<hash of the other files concatenated>"}`. Extract these **verbatim** from the blobs in `solve.py` — write a one-off extraction script (`scripts/src/extract-datasets.ts` or a python script) rather than retyping; delete the script after use or keep under `scripts/` marked one-off. Model IDs (`p-median-us`, `transport-coal`, `p-median-brazil`) are the values that will later populate `scenarios.model_id` — pick them now, they become a stable identifier.
**DoD:** JSON validates against a small Zod schema (in a new lightweight `lib/dataset-schema/` package, shared by extraction script and any future consumer); counts match (26/200 etc.) for each package.

### Task C1.2 — Solver reads canonical data by model ID
**Files:** `solve.py`, `pmedian.ts`.
`solve.py` loads dataset JSON from `solvers/<model-id>/dataset/` given a `modelId` in the stdin payload (`pmedian.ts` passes `modelId` mapped from the scenario's `model_id` once that column exists in Phase 3; until then, keep the existing `modelType` field as the interim lookup key so this task is independently shippable). Delete the embedded blobs. **Critical check:** byte-identical model behavior — run `e2e_accuracy.py` before and after; results must be identical.
**DoD:** `solve.py` line count drops massively; accuracy suite green with zero test edits.

### Task C1.3 — API serves canonical data + drift guard
**Files:** `routes/dataset.ts` reads from `solvers/<model-id>/dataset/`; delete any duplicated dataset constants in TS. Add a vitest that hashes each package's dataset files and compares against its `version.json` sha256 (fails CI on silent edits), and a pytest asserting python loads the same version number per package.
**DoD:** frontend dataset endpoint output unchanged (snapshot test), single source of truth established per model.

### Task C2.1 — Dataset defect audit ⚠ STOP-AND-ASK
Audit all warehouse/customer labels vs coordinates (haversine each label's real city vs stored lat/lng; flag > 50 mi mismatches). Known suspects: WH23 "San Francisco, MO", WH25 "St. Louis, FL".
**Produce a report; do NOT change the distance matrix without human sign-off** (PRD OQ3: textbook matrix vs label authority). Safe default if approved: fix *labels only* (state codes), leave coordinates and matrix untouched → accuracy suite unaffected.
**DoD:** report committed as `docs/dataset-audit.md`; approved label fixes applied; accuracy green.

---

## Phase 3 — Inputs epic (D1–D6, X1) — largest phase

**Scope change from v0.1 (see §0.5a):** D0.2 below builds the generic `scenarios.inputs jsonb` column directly — there is no typed `p_value`/`capacity_mode`/`warehouse_statuses` column stage to migrate away from later. Every acceptance criterion from the original D1–D6/X1 tasks is preserved verbatim; only the storage shape and the validation mechanism change.

**Contract preamble (Task D0.1):** one spec change-set covering the whole phase, then regen once:
- `Scenario.inputs` is a single `object` (opaque to the shared OpenAPI schema — this is intentional, see below), containing for the p-median models: `{p: number, capacityMode: "none"|"uniform"|"per_wh", uniformCapacity?: number, warehouseOverrides: [{id, capacity?: number|null, status: "active"|"forced_open"|"inactive"}], customerOverrides: [{id, demand?: number|null, status: "active"|"excluded"}], distanceBands: number[], gap: number, timeLimitSec: number}`. Per-model shapes are documented in each `solvers/<model-id>/manifest.json` (created in Phase 3.5) — until Phase 3.5 lands, this shape is documented inline in a new `docs/scenario-inputs-schema.md` and enforced by a hand-written Zod schema per model in `artifacts/api-server/src/validation/inputs/`.
- New endpoints: `GET /scenarios/:id/export?entity=warehouses|customers&format=csv|json`, `POST /scenarios/:id/import` (multipart or JSON body `{entity, format, content}`) → returns a **preview object** `{templateVersion, rows: [{line, id, changes:{field:{from,to}}, errors:[{class: format|syntax|logic, message}]}], summary}`, and `POST /scenarios/:id/import/apply` with `{previewToken | rows, mode: all_or_nothing|valid_only}`.
- New: `POST /scenarios/:id/reset-to-baseline`.
Store preview server-side keyed by a token with short TTL (in-memory map is fine for pilot) so apply is atomic against the previewed content.
**DoD (D0.1):** OpenAPI validates `inputs` as `type: object` (no fixed properties at the contract level — fixed shape lives in the per-model Zod validators, not codegen); regen produces no per-model union types.

**Schema (Task D0.2):** `scenarios` gets exactly: `id, user_id, model_id text, name, inputs jsonb NOT NULL DEFAULT '{}', inputs_version int NOT NULL DEFAULT 1, result jsonb, solved_at timestamp, inputs_updated_at timestamp NOT NULL DEFAULT now(), created_at, updated_at`. **No `p_value`, `capacity_mode`, `uniform_capacity`, or `warehouse_statuses` columns are created.** `model_id` replaces `problemType` from Task B2.1 — reconcile: B2.1 (Phase 1) already locked `problemType` server-side; in this task rename that field to `model_id` end-to-end (routes, OpenAPI, chapter query param from B1.1) and set its value to the model IDs chosen in Phase 2's C1.1 (`p-median-us`, `transport-coal`, `p-median-brazil`). Write a migration script analogous to A2.1's two-step protocol: add `inputs`/`model_id`/etc. nullable → backfill (`inputs = '{}'`, `model_id` derived from existing `problem_type` values) → enforce NOT NULL where specified.
**DoD (D0.2):** push succeeds; existing scenario rows (assigned to `seed@local` in A2.1) have non-null `model_id` and empty-object `inputs` post-migration; `e2e_accuracy.py` unaffected (it doesn't touch this table).

**Per-model input validation (Task D0.3, new):** `artifacts/api-server/src/validation/inputs/{pMedian,transportLp}.ts` — Zod schemas for each model's `inputs` shape, keyed by `model_id`, invoked in the scenario PATCH/POST handlers before persisting. This is the enforcement point that a fixed DB column used to provide for free; make it a single shared `validateInputsForModel(modelId, inputs)` function so Phase 3.5's registry can later replace the lookup table with manifest-driven schemas without touching call sites.
**Tests:** valid p-median inputs pass; invalid `capacityMode` value rejected 422; unknown `model_id` rejected 422; per-WH capacity entry with negative number rejected 422.

### Task D1.1 — Solver: per-WH capacity + demand overrides
**Files:** `solve.py`, `pmedian.ts` (SolveInput), route payload build.
The stdin payload sent to `solve.py` is now built by passing the scenario's `inputs` object through mostly as-is (plus the resolved `modelId`/dataset path from Phase 2) rather than assembling it field-by-field from separate columns. `solve.py` applies `inputs.warehouseOverrides`/`inputs.customerOverrides` as: per-WH capacity replaces uniform in the capacity constraint when `capacityMode=per_wh`; demand override replaces base demand in objective + capacity LHS; excluded customer drops its assignment constraint and variables. Overrides are DATA (changed coefficients/bounds) — no new special-case branches. This is also where the base dataset (Phase 2) and the sparse overrides are merged into the full effective warehouse/customer lists — implement this merge as one pure function, `applyOverrides(baseDataset, inputs)`, reusable by the export task (D4.1) for producing the merged view students edit.
**Tests (pytest, new file `test_overrides.py`):** demand override shifts objective as hand-computed on a tiny sub-problem; per-WH capacity binds (force a small capacity, assert warehouse not over-assigned); excluded customer absent from assignments; **accuracy suite untouched and green** (it uses no overrides).

### Task D1.2 — Left panel rework
**Files:** Studio page + panel components.
Controls: p (number), capacity mode (none/uniform/per-warehouse) + uniform value; buttons opening D2/D3 tables; solver settings relabeled here or in E3 (do it here: **"Optimization gap"**, **"Max time (seconds)"**).
**Tests:** RTL — edits fire PATCH with correct body; per-WH mode toggles table column.

### Task D2.1 / D3.1 — Warehouse & customer tables
**Files:** new `components/tables/{WarehouseTable,CustomerTable}.tsx` (expandable/collapsible section or Radix Dialog — match existing UI patterns).
Warehouse: ID, city+state (read-only), capacity (editable iff per_wh), status select. Customer: ID, city+state, demand (editable, ≥0), status (active/excluded). Inline validation; debounced PATCH of the overrides array; dirty-state indicator.
**Tests:** RTL — edit persists; invalid input blocked with message; 200-row customer table renders performantly (virtualize only if a simple render janks — measure first).

### Task D4.1 — Export
**Files:** new `artifacts/api-server/src/services/templates.ts` + export route handler.
CSV columns (warehouses): `template_version,id,city,state,capacity,status`; (customers): `template_version,id,city,state,demand,status` — or a header comment line for version + plain columns; pick ONE and document in the file. JSON: `{templateVersion, entity, rows:[...]}`. Values reflect current scenario overrides merged over baseline.
**Tests:** supertest — export → parse → matches scenario state; round-trip with import (D5) yields zero changes.

### Task D5.1 — Import: parse + validate + preview
**Files:** `services/import.ts` (+ `papaparse` server-side or a minimal CSV parser — papaparse is already a frontend dep; add to api-server).
Pipeline per plan §D5 of PRD. Error classes exactly `format|syntax|logic`, each row error carries `line`. Logic checks: unknown ID, negative/non-numeric demand/capacity, invalid status, duplicate ID, template-version mismatch. Cross-field warning (non-blocking): total active capacity < total demand for current p.
**Tests (most important tests in the phase):** golden files under `tests/fixtures/imports/`: clean file; wrong columns; bad encoding; 3-bad-rows file; duplicate-ID file; no-ID city-keyed file (must reject as format error); version-mismatch file. Assert exact error classes and line numbers. Atomicity: apply of a failing all_or_nothing changes nothing (DB snapshot compare).

### Task D5.2 — Import UI
**Files:** `components/ImportDialog.tsx`.
Flow: file pick → preview table (changes green, errors red with line + class) → mode checkbox (default all-or-nothing per 0.5) → confirm → apply → success toast with counts. Cancel = zero mutation.
**Tests:** RTL with mocked preview responses covering all three error classes; e2e happy path with a real small CSV.

### Task D6.1 — Reset to baseline
Route clears both override arrays (confirm dialog in UI).

### Task X1.1 — Staleness guard
**Files:** `routes/scenarios.ts`, spec (`Scenario.stale: boolean` derived, never stored), Studio + Compare UI.
Every scenario row already carries `inputs_updated_at` (from D0.2) and `solved_at`; staleness is purely derived — `stale = inputs_updated_at > solved_at` — computed in the response serializer, never written to a column. Any PATCH that changes `inputs` bumps `inputs_updated_at`; a PATCH that only changes `name` must NOT bump it (write a test specifically for this — it's the easy bug to introduce). The solve route sets `solved_at = now()` after a successful UPDATE. `result` is left untouched on a stale scenario (old result stays visible with a "stale" badge — better pedagogy than nulling it).
**Tests:** solve → stale=false; patch `inputs.p` → stale=true; patch `name` only → stale unchanged; re-solve → false. UI badge test.
**Phase 3 exit:** gate + e2e; manual script: export customers → edit 5 demands in a spreadsheet → import → preview shows exactly 5 changes → apply → solve → objective changes.

---

## Phase 3.5 — Model registry, result envelope, async job queue (new in v0.2)

**Why this phase exists (see §0.5a):** Phase 4 (map/bands/routes) and Phase 5 (Compare) both need a model-agnostic result shape to avoid writing per-model rendering and diffing code that would need generalizing later. Building the registry and envelope now, before Phase 4, means Phase 4/5 are written against their final interface the first time. This phase also finally retires `spawnSync`, which every earlier phase has been implicitly tolerating.

### Task G1.1 — Model manifests
**Files:** `solvers/<model-id>/manifest.json` for each of the three existing models (created alongside the dataset packages from Phase 2, populated now).
Schema: `{id, name, chapter, datasetDir, countryBounds: {sw:[lat,lng], ne:[lat,lng]}, capabilities: {supportsP: bool, capacityModes: string[], demandEditable: bool}, inputsSchema: <JSON Schema>}`. The `inputsSchema` is the JSON Schema equivalent of the Zod validators written in D0.3 — write one, generate or hand-sync the other (prefer: JSON Schema as source, generate the Zod validator from it with a small script, to avoid the two drifting).
**DoD:** three manifests exist; a vitest loads each and validates it against a manifest meta-schema.

### Task G1.2 — Registry service
**Files:** `artifacts/api-server/src/registry/modelRegistry.ts`.
Scans `solvers/*/manifest.json` at boot, builds an in-memory map `modelId → manifest`. Exposes `getManifest(modelId)`, `listModels()`, `validateInputs(modelId, inputs)` (delegates to the per-model Zod validator, replacing D0.3's hand-written lookup table with a registry-driven one — same function signature, so no call sites change). `GET /api/models` (new endpoint, add to spec) returns `listModels()` output (sans server-internal fields) for the frontend.
**DoD:** adding a fourth manifest+dataset+solver directory with zero code changes makes `GET /api/models` return it (write this as the literal test: copy `p-median-us` to `p-median-us-copy` with a new id, assert it appears).

### Task G2.1 — Standardized result envelope
**Files:** `solve.py` (all three model functions), `artifacts/api-server/src/solver/resultEnvelope.ts` (Zod schema for the envelope, used to validate `solve.py`'s stdout before caching it).
Every model's postprocessing step now emits `{status, objective, runTimeSec, quality, edges: [{fromId, toId, flow, distance, band?}], metrics: {utilizationByNode?: [...], bandCoverage?: [...], weightedAvgDistance?}, details: {...model-specific extras...}}`. p-median's `assignments` become `edges` (warehouse→customer, flow=demand); transportation LP's shipments become `edges` (mine→station, flow=tons). This is a refactor of existing postprocessing code, not new solver logic — the underlying numbers are unchanged.
**Tests:** `e2e_accuracy.py` re-run — objective/assignment values identical, only the wrapping shape changes (update the test's *assertions* to read the new envelope paths, not its expected numeric values — this is the one place existing test code changes, per the exception noted in this task).
**DoD:** all three models emit an envelope that validates against the shared Zod schema.

### Task G3.1 — solve_jobs table + async dispatch
**Files:** `lib/db/src/schema/solve_jobs.ts` (new), `routes/scenarios.ts` (solve endpoint), `artifacts/api-server/src/solver/jobRunner.ts` (new, replaces direct `spawnSync` calls from `pmedian.ts`).
Schema per §0.5a target tables. `POST /scenarios/:id/solve` now: validates inputs (D0.3/G1.2), computes `inputsHash = sha256(modelId + datasetVersion + canonicalJson(inputs))`, inserts a `solve_jobs` row (`status: queued`), returns `202 {jobId}` immediately. A small in-process worker pool (concurrency 2–4, simple array-based queue) picks up queued jobs, runs `spawn` (not `spawnSync`) against `solve.py`, updates the job row through `running → succeeded|failed`, and on success writes `scenarios.result`/`solved_at`. `GET /scenarios/:id/solve-jobs/:jobId` for polling.
**Tests:** two concurrent solve requests don't block each other's other API calls (supertest with a deliberately slow fixture model or a mocked delay); job transitions through correct statuses; timeout kills the child process and marks `failed` with a message; crash/bad-stdout still degrades gracefully (existing wrapper contract preserved).
**DoD:** no remaining `spawnSync` call in the codebase; frontend solve flow updated to POST-then-poll (small Studio.tsx change, reuse existing loading-state UI, swap the request shape).

### Task G3.2 — Solve history from solve_jobs (absorbs A4)
**Files:** `routes/solveHistory.ts` (new, thin — reads `solve_jobs` filtered by `user_id`), Landing page "recent solves" list.
No new table needed — A4's requirement is satisfied by listing `solve_jobs` ordered by `queued_at desc`, joined to scenario name.
**DoD:** landing page shows last 5 solves with status/objective/runtime; clicking opens the scenario.

**Phase 3.5 exit:** gate + e2e; `GET /api/models` lists 3 models; a solve request returns 202 and a subsequent poll shows `succeeded` with an envelope-shaped result; `e2e_accuracy.py` green against the new envelope; two simultaneous solves in a Playwright test both complete without one blocking the other's page navigation.

---

## Phase 4 — Results & map UX (E1–E5) — may interleave with late Phase 3.5

### Task E3.1 — Achieved metrics display
Show post-solve: `runTimeSec` (exists) + quality statement derived from status & configured gap (per 0.5/OQ4). Component near objective.

### Task E1.1 — Client-side distance bands (right panel)
**Files:** move band editor from left config to results panel; new pure function `studio/src/lib/bands.ts`: `computeBandCoverage(edges, bands)` + `assignBand(distance, bands)`.
Bands become **presentation state**: keep persisting them in `inputs.distanceBands` (they're part of the lab writeup) but recompute coverage + route colors client-side on change from the result's `edges` array — no `/solve` call. This task is unblocked by Phase 3.5's G2.1 (standardized `edges`); it now reads the same field regardless of which model produced the result.
**Tests:** unit tests for the pure function (edges: distance == boundary, empty bands, unsorted input); RTL: slider change updates coverage with fetch mock asserting **zero** network calls.

### Task E4.1 — Auto-show routes colored by band
On solve success, set routes toggle ON; render one polyline per `result.edges[]` entry; polyline color = band palette (single palette constant shared with coverage panel — create `studio/src/lib/bandPalette.ts`). Same rendering code path serves all models since `edges` is standardized — no per-model branch in the map component.
**Tests:** RTL on map container props; visual check in e2e.

### Task E5.1 — Map bounds per model
Read `countryBounds` from the model's manifest (`GET /api/models`, cached client-side) instead of hardcoded per-page constants — `maxBounds` + `minZoom` + fitBounds derived from the manifest value. This makes E5.1 automatically correct for any future model with zero map-component changes, provided its manifest sets `countryBounds`.
**Tests:** unit-test the bounds selection given a mock manifest; e2e asserts map container received bounds for at least one model (or skip e2e assert; manual check).

### Task E2.1 — Constraint chip bar
New `components/ConstraintChips.tsx` above the map: p, capacity summary, forced-open count, inactive count, excluded count, demand-edits count, stale badge (X1). Click → focus/scroll to source input. Derived entirely from scenario state (no new API).
**Tests:** RTL — chips reflect state; click focuses target.
**Phase 4 exit:** gate + e2e; solve a scenario and confirm: routes auto-on, band edit instant, chips correct, map locked.

---

## Phase 5 — Compare v2 (F1, F2)

### Task F1.1 — Compare contract + validation
**Files:** spec (compare request/response overhaul), `routes/` compare handler.
Request: 2–4 scenario IDs. Server validates: all owned by caller (else 404-style rejection), same `model_id` (422 with message — renamed from `problemType` per D0.2), all solved AND not stale (422 listing offending IDs, using the derived staleness check from X1.1). Response per scenario: `inputs` (opaque object, rendered generically — see F2.1), and `result` in the standardized envelope from Phase 3.5 (`objective, runTimeSec, quality, edges, metrics, details`).
**Tests:** every rejection path; happy path.

### Task F2.1 — Diff engine + UI
**Files:** `studio/src/lib/compareDiff.ts` (pure) + rebuilt `Compare.tsx`.
Diff computation (client-side, pure, unit-tested), now written once against the generic shapes instead of per-model fields: **input diff** — shallow-diff the `inputs` objects key by key (works for any model's inputs shape without knowing its fields in advance; nested `warehouseOverrides`/`customerOverrides` arrays diffed by `id`); changed keys highlighted, identical keys de-emphasized. **output diff** vs a chosen baseline scenario — objective Δ abs & %, edge-set difference (open/closed sites derived from unique `fromId`s in `edges`, reassignment count from edge target changes), `metrics` deltas (whatever keys the model populated — bandCoverage, utilization, etc.), rendered generically by iterating `metrics` keys rather than naming each one.
UI: scenario picker filtered to same-`model_id` solved scenarios (grey + "needs solving" chip with one-click solve for others, using the async solve flow from G3.1), side-by-side columns, changes highlighted.
**Tests:** unit tests on `compareDiff` with crafted fixtures (p 4→5 case from PRD acceptance criteria); RTL for picker filtering; e2e: clone scenario, change p, solve both (async, poll to completion), compare, assert highlighted rows.
**Phase 5 exit:** PRD F1/F2 acceptance criteria pass verbatim; a manual check confirms Compare requires no code change to work with a fourth model once one exists (only requires two solved scenarios sharing that `model_id`).

---

## Phase 6 (P1, optional) — Solve worker-pool scaling

Only if pilot cohort exceeds ~10 concurrent users. Phase 3.5 (G3.1) already replaced `spawnSync` with an async, queued dispatcher — that alone removes the single-process blocking bug regardless of cohort size. Phase 6 is narrower than the original plan's: it's about *throughput*, not correctness.
- Increase worker pool concurrency past the Phase 3.5 default (2–4) based on measured host CPU/memory headroom; add basic backpressure (429 with retry-after if the queue exceeds a depth threshold).
- If a single Node process becomes the bottleneck, split the solver dispatcher into a separate process/service consuming from the same `solve_jobs` table (simple polling is sufficient at this scale — no message broker needed yet).
- Add the `result_cache` table (target schema, §0.5a) keyed on `inputsHash`: check-before-dispatch in `jobRunner.ts`, serve cached results instantly for byte-identical repeated solves (common in a classroom where many students start from the textbook baseline).

---

## Final acceptance checklist (maps to PRD goals)

- [ ] Two users register, work concurrently, never see each other's data (Goal 1).
- [ ] Every input in PRD Goal 2 editable via UI; overrides verifiably change solver output (Goal 2).
- [ ] All golden import fixtures behave exactly as specified; no import path mutates state before confirm (Goal 3).
- [ ] Compare rejects invalid sets and renders input+output diffs per F2 criteria (Goal 4).
- [ ] Auto-routes, instant band recompute, chip bar, achieved metrics, bounded map (Goal 5).
- [ ] `e2e_accuracy.py` green and unmodified in expected values (assertion paths may change once at G2.1 for the envelope refactor; numeric expectations never change).
- [ ] `git diff --exit-code` on generated dirs after a fresh codegen run.
- [ ] No grep hits for gamification terms; no `/callback` or `/mobile-auth` in spec.
- [ ] **Scalability goal (new in v0.2):** copying `solvers/p-median-us/` to a new directory with a new `model_id`, no other code changes, and it appears in `GET /api/models`, is solvable, renders on the map, and is comparable in Compare — the concrete test of "the app scales to more models."
- [ ] No `scenarios` table column is model-specific (`inputs jsonb` is the only model-shaped field).
- [ ] No remaining `spawnSync` in the codebase.

## Known risks & mitigations

| Risk | Mitigation |
|---|---|
| drizzle-kit `push` has no migration history; NOT NULL addition on live data can fail | Two-step nullable→backfill→not-null protocol in A2.1 and D0.2; run against a DB snapshot first |
| Dataset extraction (C1) subtly changes numbers | Byte-level before/after accuracy run in C1.2; sha256 drift guard in C1.3 |
| Orval regen churns unrelated files | Regen in its own commit per task; diff review limited to intended paths |
| `argon2` native build fails in deploy env | Fallback to `bcryptjs`, note in commit |
| 5,200-var model + overrides slows CBC unexpectedly | Overrides only change coefficients/bounds, not variable count; add a pytest asserting solve time on the canonical case stays within 2× baseline |
| In-memory preview tokens lost on restart | Acceptable for pilot; documented |
| `inputs jsonb` loses DB-level type safety that typed columns would have given | Enforced at one gate instead (D0.3/G1.2 Zod validation on every write); tests target this gate directly rather than relying on schema constraints |
| Phase 3.5's envelope refactor (G2.1) touches `solve.py`'s postprocessing for all three models at once | Land it as its own commit per model function, run `e2e_accuracy.py` after each, not just at the end |
| Async dispatch (G3.1) introduces a new failure class (job stuck in `running` if the worker crashes) | Add a startup sweep that requeues/fails any job left `running` from a previous process lifetime |
| Reordering Phase 3.5 before Phase 4/5 delays visible UI progress | Acceptable trade — Phase 4/5 would otherwise need rework; flag to stakeholders that Phase 3.5 is infrastructure with no new student-facing screen |
