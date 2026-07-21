# CLAUDE.md — Network Optimization Studio

Educational supply-chain network design tool. Students configure facility-location scenarios (p-median, transportation LP), solve them with a real ILP solver (PuLP/CBC), and compare results. Datasets and expected answers come from Watson et al., *Supply Chain Network Design* (Ch. 3 & 5).

Active work is governed by `IMPLEMENTATION_PLAN.md` (task IDs like A2.1, D5.1) with scope defined in `PRD-network-optimization-studio-v2.md`. When executing a task, follow the plan's per-task file lists, tests, and Definition of Done. Section 0 of the plan is the operating contract — read it first.

## Architecture (30 seconds)

pnpm monorepo. Contract-first: `lib/api-spec/openapi.yaml` is the single source of truth for the API; Orval generates the Zod validators and React Query client from it.

```
lib/api-spec/          OpenAPI contract + orval.config.ts (codegen)
lib/api-zod/           GENERATED Zod schemas        — never hand-edit src/generated/
lib/api-client-react/  GENERATED React Query hooks  — never hand-edit src/generated/
lib/db/                Drizzle schema (Postgres) — schema sync via drizzle-kit push, no migration files
artifacts/api-server/  Express 5 API. Routes in src/routes/, solver bridge in src/solver/
artifacts/studio/      React + Vite + Tailwind + Radix + Leaflet + wouter + TanStack Query
```

Solve path: frontend PATCHes inputs onto the scenario row → `POST /scenarios/:id/solve` (empty body; **DB row is the source of truth**) → route builds `SolveInput` → `pmedian.ts` pipes JSON via stdin to `python3 solve.py` (`spawnSync`, blocking) → PuLP/CBC solves → JSON on stdout → result cached as JSONB on the scenario row → response → React Query renders. The cached JSONB is what the Compare feature reads.

## Commands

```bash
pnpm install                                  # pnpm ONLY (preinstall blocks npm/yarn)
pnpm run typecheck                            # whole workspace
pnpm --filter api-server test                 # API tests (vitest + supertest)
pnpm --filter studio test                     # frontend tests (vitest + RTL)
pnpm --filter studio test:e2e                 # Playwright
pnpm --filter @workspace/db push              # apply Drizzle schema to DB
cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x   # solver tests
```

Python needs `pulp` and `pytest` (`pip install pulp pytest --break-system-packages`). Postgres via `DATABASE_URL`.

**Verification gate — run before considering any task done:**
```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

## Hard rules

1. **Never edit generated code.** Anything under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` comes from codegen. To change API shapes: edit `lib/api-spec/openapi.yaml`, re-run Orval (config: `lib/api-spec/orval.config.ts`), commit spec + regenerated output together.
2. **`e2e_accuracy.py` is sacred.** `artifacts/api-server/src/solver/tests/e2e_accuracy.py` validates solver output against the textbook's published answers. It must pass unmodified after every change. If your change breaks it, your change is wrong — do not adjust the expected values without explicit human approval.
3. **Schema changes that add NOT NULL columns to populated tables** must use the two-step protocol (add nullable → backfill → enforce NOT NULL), because `drizzle-kit push` has no migration history.
4. **One task = one commit.** Message format: `[<task-id>] <imperative summary>` (e.g. `[A2.1] add user_id ownership to scenarios`). Regenerated codegen output goes in the same commit as its spec change.
5. **Ownership filtering is security-critical.** Every scenario query must filter by the authenticated `user_id`; non-owned resources return **404** (never 403 — avoid ID enumeration). Any new scenario-scoped endpoint inherits this.
6. **Solver changes enter as data, not branches.** Business rules (forced-open, inactive, demand overrides, capacities) become variable bounds or coefficient changes in the PuLP model — never new if/else code paths in `solve.py`.
7. **Don't touch** `attached_assets/` (textbook source material) or Replit deploy files (`.replit`, `replit.md`, `push-to-github.mjs`) unless a plan task explicitly says so.
8. When the plan conflicts with the repo's actual state, trust the repo, make the smallest correct fix, and note the deviation in the commit body. If a genuinely ambiguous product decision arises, stop and ask — don't guess.

## v2 implementation progress

Tracking execution of `IMPLEMENTATION_PLAN.md` against `PRD-network-optimization-studio-v2.md`. Update this section as each task lands (one line per task, most recent phase at top).

**Plan revision note:** `IMPLEMENTATION_PLAN.md` was revised to v0.2 upstream (pulled 2026-07-20) after Phase 1 work below had already started. Phase 1 (A1.1–B2.1) is byte-identical to v0.1 — unaffected. Phases 2–3 change shape: no typed per-model `scenarios` columns at all (`pValue`, `capacityMode`, `warehouseStatuses`, etc. never get built, not even temporarily) — Phase 3's D0.2 goes straight to a generic `scenarios.inputs jsonb` + `model_id` text field, validated per-model by Zod/JSON-Schema. Phase 2's dataset extraction targets per-model packages (`solvers/<model-id>/{manifest.json,dataset/*.json,solver.py,tests/}`) instead of a flat `lib/datasets/` folder. A new **Phase 3.5** (model registry + standardized result envelope `{status,objective,edges,metrics,details}` + async `solve_jobs` queue, replacing `spawnSync`) is inserted before Phase 4. See the plan's §0.5a for full rationale. None of the Phase 1 work below needs rework because of this.

**Phase 1 — Auth, ownership, de-gamification**
- [x] A1.1 — OpenAPI: real auth endpoints (`register`/`login`/`logout`/`user`, `User.role` enum). Removed legacy `/login` (userId-body), `/callback`, `/mobile-auth/*`. Codegen regenerated (also caught up pre-existing drift: `transport` problemType enum value was in spec but not yet regenerated — unrelated to this task, included in the same regen commit per plan's "regen churn" note). Commit `db7b9db`.
- [x] A1.2 — Schema: extend `users` table (`passwordHash`, `role`; dropped unreferenced `profileImageUrl`). Commit `444438b`.
- [x] A1.3 — Auth routes implementation (argon2, `requireAuth` in `middlewares/auth.ts`, cookie renamed to `nos_session`). Removed dead `openid-client` dep. Commit `a0b6ed0`.
- [x] A2.1 — Scenario ownership schema + migration (`user_id` FK+index, NOT NULL via two-step protocol, `seed@local` backfill). Commit `d204860`.
- [x] A2.2 — Ownership enforcement in routes (404 not 403). `requireAuth` applied to whole scenarios router; every query filters by `user_id`; the A2.1 `getSeedUserId()` stopgap is gone, replaced by `req.userId`. Commit `51f8ace`. Manually verified cross-user isolation against the real local DB (two real registered users, cross-user GET 404, cross-user DELETE 204-no-op verified by refetch, anonymous 401).
- [x] A3.1 — Remove gamification (backend). Deleted `routes/progress.ts`, `user_progress` schema+table (dropped via push). `/progress` was never in the OpenAPI spec, nothing to remove there. Commit `cd642fc`.
- [x] A3.2 — Remove gamification (frontend) + new auth pages. Deleted `pages/arcadia/`, `GamificationContext`, `ArcadiaShell`; new `pages/auth/{Login,Register}.tsx` on the generated auth hooks + a plain `AppShell`. `App.tsx` gates on `useGetCurrentAuthUser`. Studio's "which lab" state is temporarily local (`activeModelIndex`) — B1.1 replaces it with the real chapter-route signal. Commit `44cb9a6`. **Known gap** (still open): `e2e/labs.spec.ts` not executed this session — no wired-up local same-origin dev setup (frontend/backend on separate ports, no dev proxy) and the default `E2E_BASE_URL` targets a stale Replit deployment.
- [x] B1.1 — Chapter landing + routes. New `Landing.tsx` (3 chapter cards) at `/`; Studio moved to `/chapter-3`, `/chapter-5/transport`, `/chapter-5/brazil`, each pre-bound via a required `problemType` prop (replaces A3.2's local-state stopgap). Removed the "Problem type" Select dropdown from Studio's configure panel entirely. New `lib/chapters.ts` is the single source of truth for chapter path/problemType (Landing, App.tsx routes, and Compare.tsx's "Back" link all read it — Compare's back-link was hardcoded to `/` and broke the moment Studio moved off root, fixed here). `GET /scenarios` gained `?problemType=` query-param scoping. Commit `95fc8be`. Manually verified `?problemType=` filtering against the real local DB.
- [x] B2.1 — problemType locked server-side (Phase 1 exit). `ScenarioUpdate` no longer has `problemType`; PATCH 422s if the body contains it at all; POST 422s if it's missing or not a valid model value (replaces the old silent `?? "p_median"` default). `Studio.tsx`'s `handleSave` strips `problemType` from its PATCH payload (it kept `localConfig.problemType` for read-only branching only). Commit `8bf8b56`. **Phase 1 (A1.1–B2.1) is complete.** Gate green: typecheck, 83/83 api-server, 109/109 studio, 46/46 solver pytest. E2E still not executed this session (see A3.2's known gap, unresolved) — Phase 1's cross-user isolation claim is instead backed by A2.2's real-DB manual verification + 83 automated tests.

**Next**: Phase 2 (C1, C2, X3) — data layer extraction into `solvers/<model-id>/` packages, per the v0.2 plan revision above.

**Also fixed along the way** (pre-existing bugs found while restoring a green verification gate, unrelated to any single task — see commit `6869029`): Brazil-lab scenarios were silently solving as plain uncapacitated p-median in production — `problemType` enum (`capacitated_flp`) never matched `solve.py`'s dispatch string (`capacitated_pmedian`), and even after that's fixed, the route never sent `warehouseCapacity` (a field distinct from `uniformCapacity`) that `solve_capacitated_pmedian()` actually reads. Both fixed; verified against `e2e_accuracy.py` (102/102, unmodified). `routes.test.ts` was also rewritten — it mocked a three-table architecture (`pmedianScenariosTable`/`transportScenariosTable`/`brazilScenariosTable`) that was never actually implemented; real schema has always been one `scenariosTable`.

**Local dev DB:** no `DATABASE_URL` in the environment by default; a local Postgres 18 is running with a `nos_dev` database already matching the schema. Pass `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline per command (shell env doesn't persist across tool calls in this session).

**Phase 2 — Data layer extraction into model packages** (C1, C2, X3) — not started. Target: `solvers/<model-id>/dataset/*.json` (v0.2 shape, see above), not `lib/datasets/`.
**Phase 3 — Inputs epic** (D0–D6, X1) — not started. D0.2 replaces all typed scenario columns with generic `inputs jsonb` + `model_id`.
**Phase 3.5 — Model registry, result envelope, async job queue** (new in v0.2) — not started.
**Phase 4 — Results & map UX** (E1–E5) — not started.
**Phase 5 — Compare v2** (F1, F2) — not started.
**Phase 6 — Solve worker-pool scaling** (P1, optional) — not started.

## Gotchas

- `spawnSync` in `pmedian.ts` blocks the Node event loop for the entire solve (up to time limit + 15s grace). Do not add long-running sync work elsewhere; async solve is planned as Phase 6 (X2).
- The solver wrapper never throws — crashes, timeouts, and unparseable stdout all degrade to a well-formed `{status: "error", infeasibilityReason: ...}`. Preserve this contract.
- Distance bands are a **reporting lens**, not model constraints — they're computed in post-processing from per-assignment distances and can be recomputed client-side without re-solving.
- Customer city names are NOT unique (two Arlingtons, two Kansas Citys, two Springfields…). Stable IDs are the only valid join key for imports/exports; city/state are display-only.
- Known dataset label defects (WH23 "San Francisco, MO", WH25 "St. Louis, FL") are under a stop-and-ask protocol (task C2) — do not "fix" them opportunistically; the textbook distance matrix may be the authority.
- Cached `result` JSONB can drift from edited inputs until the staleness guard (X1) lands — don't trust `result` on a scenario whose inputs changed after solving.
- `problemType` is hidden from the UI but must NOT be removed from DB/API — solver dispatch and Compare validation depend on it.
- Tests live per package: API in `artifacts/api-server` (vitest/supertest), frontend in `artifacts/studio` (vitest/RTL + Playwright), solver in `artifacts/api-server/src/solver/tests/` (pytest).
- `uniformCapacity` (DB/API/TS field name) and `warehouseCapacity` (the key `solve.py`'s `solve_capacitated_pmedian()` actually reads off stdin) are the same value under two different names at two different layers — the route/`solve()` boundary translates between them. Don't rename one without the other, and don't assume a grep for one name finds every reference.
- `e2e_accuracy.py` and `e2e_journey.py` under `artifacts/api-server/src/solver/tests/` are standalone scripts (`python3 e2e_accuracy.py`), not pytest-discovered (`test_*.py` naming) — `python3 -m pytest tests/ -x` does NOT run them. Run them directly when solver-affecting changes land, despite CLAUDE.md's rule 2 calling `e2e_accuracy.py` sacred — the pytest-only gate command will not catch a regression there.
- The login rate limiter (`routes/auth.ts`, 10 attempts/min/IP, in-memory `Map`) never resets on its own between test runs within one process. Any test file that logs in more than ~10 times (e.g. `routes.test.ts`'s per-test `loginAs()` helper) must call the test-only `resetLoginRateLimiterForTests()` export in `beforeEach`, or later logins in the same file silently start 429ing.
