# Network Optimization Studio v2 — Technical Implementation Plan

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
5. **Sequencing is mandatory within a phase; phases 3 and 4 may interleave** as noted. Never start Phase 3 before Phase 2 is green.
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
artifacts/api-server/src/solver/pmedian.ts   ← spawnSync wrapper
artifacts/api-server/src/solver/solve.py     ← PuLP models + HARDCODED datasets
artifacts/api-server/src/solver/tests/       ← pytest incl. e2e_accuracy.py
artifacts/studio/src/App.tsx                 ← wouter routes
artifacts/studio/src/pages/{Studio,Compare}.tsx
artifacts/studio/src/pages/arcadia/          ← to be deleted (Phase 1)
artifacts/studio/src/components/             ← NetworkMap, BrazilMap, OverlayMap, panels
```

Existing tables: `users` (Replit-Auth remnant: id uuid, email unique, names, timestamps — REUSE, extend), `sessions` (unused by current cookie auth — repurpose or drop, see A1.2), `scenarios` (NO user_id), `user_progress` (delete in A3).

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

## Phase 2 — Data layer extraction (C1, C2, X3)

### Task C1.1 — Canonical dataset files
**Files:** new `lib/datasets/` package (`package.json`, `src/`): per-model JSON: `als-athletics.json` (26 warehouses: id, city, state, lat, lng; 200 customers: id, city, state, lat, lng, demand; distance matrix), `coal-transport.json`, `brazil.json`. Extract these **verbatim** from the blobs in `solve.py` — write a one-off extraction script (`scripts/src/extract-datasets.ts` or a python script) rather than retyping; delete the script after use or keep under `scripts/` marked one-off.
Add a `version` and `sha256` field per file.
**DoD:** JSON validates against a small Zod schema in the package; counts match (26/200 etc.).

### Task C1.2 — Solver reads canonical data
**Files:** `solve.py`, `pmedian.ts`.
`solve.py` loads dataset JSON from disk (path passed as `--data-dir` arg or env var supplied by `pmedian.ts`; default relative path for direct pytest runs). Delete the embedded blobs. **Critical check:** byte-identical model behavior — run `e2e_accuracy.py` before and after; results must be identical.
**DoD:** `solve.py` line count drops massively; accuracy suite green with zero test edits.

### Task C1.3 — API serves canonical data + drift guard
**Files:** `routes/dataset.ts` reads from `lib/datasets`; delete any duplicated dataset constants in TS. Add a vitest that hashes the dataset files and compares against the `sha256` field (fails CI on silent edits), and a pytest asserting python loads the same version string.
**DoD:** frontend dataset endpoint output unchanged (snapshot test), single source of truth established.

### Task C2.1 — Dataset defect audit ⚠ STOP-AND-ASK
Audit all warehouse/customer labels vs coordinates (haversine each label's real city vs stored lat/lng; flag > 50 mi mismatches). Known suspects: WH23 "San Francisco, MO", WH25 "St. Louis, FL".
**Produce a report; do NOT change the distance matrix without human sign-off** (PRD OQ3: textbook matrix vs label authority). Safe default if approved: fix *labels only* (state codes), leave coordinates and matrix untouched → accuracy suite unaffected.
**DoD:** report committed as `docs/dataset-audit.md`; approved label fixes applied; accuracy green.

---

## Phase 3 — Inputs epic (D1–D6, X1) — largest phase

**Contract preamble (Task D0.1):** one spec change-set covering the whole phase, then regen once:
- `Scenario` gains: `warehouseOverrides: [{warehouseId, capacity?: number|null, status}]` (replaces/extends `warehouseStatuses` — keep old field name if migration cost is high; decide by smallest diff), `customerOverrides: [{customerId, demand?: number|null, status: enum[active, excluded]}]`.
- `capacityMode` enum gains `per_wh` end-to-end (it exists in the wrapper already; verify spec parity).
- New endpoints: `GET /scenarios/:id/export?entity=warehouses|customers&format=csv|json`, `POST /scenarios/:id/import` (multipart or JSON body `{entity, format, content}`) → returns a **preview object** `{templateVersion, rows: [{line, id, changes:{field:{from,to}}, errors:[{class: format|syntax|logic, message}]}], summary}`, and `POST /scenarios/:id/import/apply` with `{previewToken | rows, mode: all_or_nothing|valid_only}`.
- New: `POST /scenarios/:id/reset-to-baseline`.
Store preview server-side keyed by a token with short TTL (in-memory map is fine for pilot) so apply is atomic against the previewed content.
**Schema (Task D0.2):** `scenarios` gains `warehouse_overrides jsonb`, `customer_overrides jsonb`, `solved_at timestamp` (for X1). Migrate `warehouse_statuses` data into `warehouse_overrides` (status only), keep old column until Phase 5, then drop.

### Task D1.1 — Solver: per-WH capacity + demand overrides
**Files:** `solve.py`, `pmedian.ts` (SolveInput), route payload build.
`solve.py` payload gains `warehouseOverrides`/`customerOverrides`; apply as: per-WH capacity replaces uniform in the capacity constraint when mode=per_wh; demand override replaces base demand in objective + capacity LHS; excluded customer drops its assignment constraint and variables. Overrides are DATA (changed coefficients/bounds) — no new special-case branches.
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
**Files:** `routes/scenarios.ts`, spec (`Scenario.stale: boolean` derived), Studio + Compare UI.
On any PATCH touching solve-relevant fields (p, capacityMode, uniformCapacity, overrides, gap? no — gap/time affect solve, include them) → set `result` untouched but compute `stale = updatedAt > solvedAt` server-side; set `solvedAt = now()` inside the solve route after UPDATE. Simpler equivalent: null out `result` on solve-relevant PATCH — choose the `solvedAt` flag (preserves the old result for display with a "stale" badge, better pedagogy).
**Tests:** solve → stale=false; patch p → stale=true; re-solve → false. UI badge test.
**Phase 3 exit:** gate + e2e; manual script: export customers → edit 5 demands in a spreadsheet → import → preview shows exactly 5 changes → apply → solve → objective changes.

---

## Phase 4 — Results & map UX (E1–E5) — may interleave with late Phase 3

### Task E3.1 — Achieved metrics display
Show post-solve: `runTimeSec` (exists) + quality statement derived from status & configured gap (per 0.5/OQ4). Component near objective.

### Task E1.1 — Client-side distance bands (right panel)
**Files:** move band editor from left config to results panel; new pure function `lib/` or `studio/src/lib/bands.ts`: `computeBandCoverage(assignments, bands)` + `assignBand(distance, bands)`.
Bands become **presentation state**: keep persisting them on the scenario (they're part of the lab writeup) but recompute coverage + route colors client-side on change — no `/solve` call. Remove band recompute from the solve requirement path (solver may still return its version; client ignores or reconciles — client is authoritative post-solve).
**Tests:** unit tests for the pure function (edges: distance == boundary, empty bands, unsorted input); RTL: slider change updates coverage with fetch mock asserting **zero** network calls.

### Task E4.1 — Auto-show routes colored by band
On solve success, set routes toggle ON; polyline color = band palette (single palette constant shared with coverage panel — create `studio/src/lib/bandPalette.ts`).
**Tests:** RTL on map container props; visual check in e2e.

### Task E5.1 — Map bounds per model
`maxBounds` + `minZoom` + fitBounds: US bounds for chapter-3 & transport, Brazil for brazil. Constants in the map components.
**Tests:** unit-test the bounds selection; e2e asserts map container received bounds (or skip e2e assert; manual check).

### Task E2.1 — Constraint chip bar
New `components/ConstraintChips.tsx` above the map: p, capacity summary, forced-open count, inactive count, excluded count, demand-edits count, stale badge (X1). Click → focus/scroll to source input. Derived entirely from scenario state (no new API).
**Tests:** RTL — chips reflect state; click focuses target.
**Phase 4 exit:** gate + e2e; solve a scenario and confirm: routes auto-on, band edit instant, chips correct, map locked.

---

## Phase 5 — Compare v2 (F1, F2)

### Task F1.1 — Compare contract + validation
**Files:** spec (compare request/response overhaul), `routes/` compare handler.
Request: 2–4 scenario IDs. Server validates: all owned by caller (else 404-style rejection), same `problemType` (422 with message), all solved AND not stale (422 listing offending IDs). Response per scenario: full inputs (p, capacityMode, uniformCapacity, override summaries + full override arrays), outputs (objective, weightedAvgDistanceMi, openWarehouseIds, assignments, bandCoverage, utilization, runTimeSec, quality statement).
**Tests:** every rejection path; happy path.

### Task F2.1 — Diff engine + UI
**Files:** `studio/src/lib/compareDiff.ts` (pure) + rebuilt `Compare.tsx`.
Diff computation (client-side, pure, unit-tested): input diff (changed fields highlighted; identical de-emphasized); output diff vs a chosen baseline scenario: objective Δ abs & %, sites opened/closed (set difference of openWarehouseIds), reassigned customer count (assignment map difference), band coverage deltas, per-common-site utilization deltas.
UI: scenario picker filtered to same-model solved scenarios (grey + "needs solving" chip with one-click solve for others), side-by-side columns, changes highlighted.
**Tests:** unit tests on `compareDiff` with crafted fixtures (p 4→5 case from PRD acceptance criteria); RTL for picker filtering; e2e: clone scenario, change p, solve both, compare, assert highlighted rows.
**Phase 5 exit:** PRD F1/F2 acceptance criteria pass verbatim.

---

## Phase 6 (P1, optional) — Async solve (X2) + solve history (A4)

Only if cohort > ~10 or time permits.
- **X2:** replace `spawnSync` with `spawn`; `POST /solve` → 202 `{jobId}`; in-memory job registry with worker pool (concurrency 2–4, queue with position); `GET /solve-jobs/:id` for polling; frontend polls every 1.5s; timeout/kill child on limit+grace. Keep the sync endpoint behavior behind the same route until the frontend switches (one release).
- **A4:** `solve_history` table (id, userId, scenarioId, status, objective, runTimeSec, createdAt); insert on every solve completion; "Recent solves" list on landing.

---

## Final acceptance checklist (maps to PRD goals)

- [ ] Two users register, work concurrently, never see each other's data (Goal 1).
- [ ] Every input in PRD Goal 2 editable via UI; overrides verifiably change solver output (Goal 2).
- [ ] All golden import fixtures behave exactly as specified; no import path mutates state before confirm (Goal 3).
- [ ] Compare rejects invalid sets and renders input+output diffs per F2 criteria (Goal 4).
- [ ] Auto-routes, instant band recompute, chip bar, achieved metrics, bounded map (Goal 5).
- [ ] `e2e_accuracy.py` green and unmodified (except human-approved C2 label protocol).
- [ ] `git diff --exit-code` on generated dirs after a fresh codegen run.
- [ ] No grep hits for gamification terms; no `/callback` or `/mobile-auth` in spec.

## Known risks & mitigations

| Risk | Mitigation |
|---|---|
| drizzle-kit `push` has no migration history; NOT NULL addition on live data can fail | Two-step nullable→backfill→not-null protocol in A2.1; run against a DB snapshot first |
| Dataset extraction (C1) subtly changes numbers | Byte-level before/after accuracy run in C1.2; sha256 drift guard in C1.3 |
| Orval regen churns unrelated files | Regen in its own commit per task; diff review limited to intended paths |
| `argon2` native build fails in deploy env | Fallback to `bcryptjs`, note in commit |
| 5,200-var model + overrides slows CBC unexpectedly | Overrides only change coefficients/bounds, not variable count; add a pytest asserting solve time on the canonical case stays within 2× baseline |
| In-memory preview tokens / rate limits lost on restart | Acceptable for pilot; documented; revisit with X2 job registry |
