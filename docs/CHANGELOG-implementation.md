# Implementation changelog — Network Optimization Studio

Append-only record of what actually landed: every phase, task, bundle, and post-merge fix round, with commit SHAs, gate numbers, review verdicts, and deviations from plan.

Moved verbatim out of `CLAUDE.md` on 2026-09-22 (it had grown to 55% of that file). **`CLAUDE.md` hard rule #9 now requires all new entries to land here, with only a one-line link from `CLAUDE.md`.**

Ordering: chronological by when the work was executed (Phase 0 landed last in real time but is numbered first — see its own note). Most recent work is at the bottom.

Related, non-changelog docs:
- `IMPLEMENTATION_PLAN.md` / `PRD-network-optimization-studio-v2.md` — the plan this executes against
- `docs/superpowers/specs/**` + `docs/superpowers/plans/**` — per-feature design docs (historical, never audited)
- `docs/superpowers/metrics/` — the machine-readable metrics store (`tasks.csv`, `failures.csv`, …)

---

## Index

Entries are append-only and roughly chronological. **To find something fast, grep this file** for a
model id (`chens-cosmetics-cn`), a task id (`D5.1`, `G3.1`, `B6.2`), a bundle name (`bundle6.1`), or
a commit SHA — every entry carries all four. Line numbers below are a convenience for
`Read(offset:)`; if one looks off, grep the title instead.

| Entry | Line |
|---|---|
| Plan revision note (v0.1 → v0.2) | L49 |
| Phase 0 — Render migration (R0.1–R0.9) | L51 |
| Phase 1 — Auth, ownership, de-gamification (A1.1–B2.1) | L67 |
| Phase 2 — Data layer extraction into model packages (C1–C2, X3) | L78 |
| Phase 3 — Inputs epic (D0–D6, X1) | L87 |
| Phase 3.5 — Model registry, result envelope, async job queue (G1–G3) | L103 |
| Phase 4 — Results & map UX (E1–E5) | L109 |
| Phase 5 — Compare v2 (F1, F2) | L117 |
| Phase 6 — Solve worker-pool scaling (P1) | L121 |
| Post-migration bug-class audit | L126 |
| Chapter 10 — Two-Echelon Gold Refinery (`two-echelon-gold-au`) | L134 |
| Post-Chapter-10 bug-fix/UX rounds (5 rounds) | L149 |
| SCN v0.3 — Tabbed Workspace & Scenario-Local Network Edits (Phases A/B/C, 3.1, 3.2) | L158 |
| SCN v0.3 Bundles 1–6.1 + JADE Ch.9 Workspace bundle | L178 |
| Chapter 4 — Chen's Cosmetics (`chens-cosmetics-cn`) | L203 |
| Workspace fixups bundle | L211 |
| Workspace fixups 2 | L216 |
| chen-bands-units | L222 |
| ch4-fixes | L231 |
| Chapter 4 — US dataset migration (`chens-cosmetics-cn` → `max-coverage-us`) + whole-branch review fixes | L459 |
| Chapter 4 — two-step workflow (`ch4-2s-1`–`ch4-2s-9`) | L583 |
| Chapter 5 (modified) — Delivery Company Teaching Example (`delivery-teaching-us`, `ch5-del-1`–`ch5-del-13`) | L770 |
| Chapter 4 UX fixes — output lock, editable solve dialog, solve overlay (`CH4UX-1`–`CH4UX-8`) | L1007 |
| Chapter 5 delivery rework, Rev 2.1 (`ch5-edit-0`–`ch5-edit-9`) — five input tabs, `fixedGeography` map, registry set-equality test | L1314 |
| Chapter 5 delivery rework — warehouses/customers CSV export/import (`ch5-edit-11`) | L1431 |
| Chapter 5 editable inputs — retro: ten assertions that could not fail (`ch5-editable`) | L1554 |
| ch9-unlock — Chapter 9 (JADE) reopened; no chapter is locked any more | L1708 |
| Chapter 4 two-step — rollout/rollback ops doc (`OPS-1`) | L1822 |
| Solve clock showed "Solving 25200s" — `timestamp` → `timestamptz` (`HND-B`) | L1913 |
| The e2e specs were in no tsc program at all (`HND-D`) | L2043 |
| e2e hygiene — `readSolvedAt` extracted from 7 copies, concurrent-solve hazard (`HND-F`) | L2128 |
| harness-retro steps 5–7 for CH4UX (`HND-G`) | L2182 |
| 2039 e2e test users purged from `nos_dev`, and the leak closed (`HND-A`) | L2288 |
| ch9-e2e-findings — the four JADE spec drifts, the unbounded-action trap, the Input Map bands-Save gap | L2547 |
| bands-save — the Input Map Layers-row Save honours a lens-only change | L2628 |

---

Tracking execution of `IMPLEMENTATION_PLAN.md` against `PRD-network-optimization-studio-v2.md`. Update this section as each task lands (one line per task, most recent phase at top).

**Plan revision note:** `IMPLEMENTATION_PLAN.md` was revised to v0.2 upstream (pulled 2026-07-20) after Phase 1 work below had already started. Phase 1 (A1.1–B2.1) is byte-identical to v0.1 — unaffected. Phases 2–3 change shape: no typed per-model `scenarios` columns at all (`pValue`, `capacityMode`, `warehouseStatuses`, etc. never get built, not even temporarily) — Phase 3's D0.2 goes straight to a generic `scenarios.inputs jsonb` + `model_id` text field, validated per-model by Zod/JSON-Schema. Phase 2's dataset extraction targets per-model packages (`solvers/<model-id>/{manifest.json,dataset/*.json,solver.py,tests/}`) instead of a flat `lib/datasets/` folder. A new **Phase 3.5** (model registry + standardized result envelope `{status,objective,edges,metrics,details}` + async `solve_jobs` queue, replacing `spawnSync`) is inserted before Phase 4. See the plan's §0.5a for full rationale. None of the Phase 1 work below needs rework because of this.

**Phase 0 — Render migration (infrastructure-only, not in `IMPLEMENTATION_PLAN.md`)**

Tracked separately in `docs/superpowers/plans/2026-07-24-render-migration.md`, reconciled from `NETWORK_MIGRATION_PLAN.md` (uploaded directly to GitHub `origin/main`, merged into local history via commit `04941d7`). Executed after Phase 6 in real time (numbered "0" because it logically precedes Phase 1 — infra should exist before product phases needed it — but landed last since it wasn't part of the original plan). All 7 tasks (R0.1-R0.7) executed via subagent-driven-development with the `glm` subagent type (implementer + reviewer) per explicit user instruction, every one Approved with zero fix cycles, then one clean final whole-branch review.

- [x] R0.1 — conditional Postgres TLS. `c532dcb`. `lib/db/src/index.ts`'s `Pool` constructor now sets `ssl: {rejectUnauthorized: false}` only when `NODE_ENV === "production"` (Render's managed Postgres requires TLS; local/dev Postgres doesn't support it). 2 new tests.
- [x] R0.2 — production CORS allowlist. `713cde8`. `app.ts`'s `cors()` reflects any origin (`origin: true`) unchanged in dev, but in production checks the request's `Origin` against a new `CORS_ALLOWED_ORIGIN` env var (comma-separated) instead — once the API has a real public hostname, unconditionally reflecting every origin back would be an open credentialed CORS policy. 3 new tests (dev reflects-all unchanged, prod allows a listed origin, prod rejects an unlisted one).
- [x] R0.3 — environment-driven session cookie flags. `b19c01f`. `routes/auth.ts`'s `setSessionCookie` and the `/auth/logout` handler's `clearCookie` call both now set `sameSite: "none", secure: true` in production (required together — `SameSite=None` without `Secure` is invalid and silently rejected by browsers) vs. unchanged `sameSite: "lax"` (no `secure`) otherwise — once frontend and API are different Render services (different origins for cookie purposes even sharing the `onrender.com` suffix), a `lax` cookie isn't sent on cross-site fetch/XHR. Login and logout use identical logic so the clearing cookie's attributes match the setting cookie's (mismatched attributes mean logout silently fails to clear it). 2 new tests.
- [x] R0.4 — cross-origin frontend wiring. `d4c5364`. `lib/api-client-react/src/custom-fetch.ts`'s `customFetch` now defaults `credentials` to `"include"` only when the caller doesn't explicitly pass one (today's only-ever-relative-path requests already work via the browser default; this stops breaking once requests become genuinely cross-origin). `artifacts/studio/src/main.tsx` now calls the already-existing-but-previously-unused `setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null)` before the first render — a no-op locally (env var unset), wires the real cross-origin API host in production. New `custom-fetch.test.ts` (didn't exist before this task).
- [x] R0.5 — Dockerfile for `nos-api`. `3939321`. New root `Dockerfile` (`node:24-slim` + `python3`/`build-essential` for the solver and argon2's native bindings + `pnpm@9` via corepack, builds only `api-server`, runs `node --enable-source-maps artifacts/api-server/dist/index.mjs`), `.dockerignore`, and `artifacts/api-server/src/solver/requirements.txt` (`pulp==3.3.2` — production-only pin, CI's own separate unpinned `pip install pulp pytest` step is untouched). No app code touched. Docker build/run verification not attemptable in this sandbox (no network to pull the base image) — explicitly pre-authorized by the plan; real first build happens via Render itself. **Not independently re-verified: whether `pulp==3.3.2` is still current on PyPI** — spot-check before the first real deploy.
- [x] R0.6 — `render.yaml` Blueprint. `062fa05`. New root `render.yaml` (three resources: `nos-api` Docker web service referencing R0.5's Dockerfile, `nos-studio` static site, `nos-postgres` managed Postgres) + `.node-version` (`24`, pins Node for `nos-studio`'s non-Docker static build). `staticPublishPath` independently confirmed against `vite.config.ts`'s real `outDir` (`artifacts/studio/dist/public`) by both the implementer and reviewer, not just copied from the source plan's assumption. Placeholder `*.onrender.com` hostnames in `CORS_ALLOWED_ORIGIN`/`VITE_API_BASE_URL` need a manual correction after first deploy (R0.8 — chicken-and-egg, the real URLs don't exist until the services are first created).
- [x] R0.7 — README deploy section. `d7c880e`. Docs-only `## Deploying` section pointing at the migration plan doc and the one manual R0.8 step. **Phase 0 (R0.1-R0.7) is complete** — final whole-branch review confirmed R0.2+R0.3+R0.4 genuinely compose (CORS allowlist echoes back the specific allowed origin with credentials, the cookie is accepted cross-site, `customFetch` sends it) and R0.5/R0.6's Dockerfile/render.yaml cross-references line up. Gate green: typecheck, 204/204 api-server, 200/200 studio. Python untouched (only the new `requirements.txt`, no `solve.py` change) — pytest not re-run.
  - **Remaining, not subagent-dispatchable:** R0.8 (STOP AND ASK — a human must click through Render's dashboard: create the Blueprint, set the two real cross-referenced URLs after first deploy, confirm Starter not Free plans) and R0.9 (manual post-deploy checklist against the real deployed environment). See the plan doc for both in full.
- [x] R0.8 (partial) — real deployment attempted via Render CLI + Render MCP (`render` MCP server, connected mid-session with a user-supplied API key). `a9c8eb4`, `ad9755a`, `95f34e2`. This surfaced that **75 commits — all of Phase 5, Phase 6, and R0.1-R0.7 — had never been pushed to `origin/main`**; pushing them (user-approved) triggered the first-ever real CI run and first-ever real Render build against this repo, which found 3 real bugs no local gate could catch: (1) `render.yaml`'s database `plan: starter` is a deprecated legacy Postgres plan name, caught by `render blueprints validate` against the live API — fixed to `basic-256mb`; (2) `package.json` had no `packageManager` field (CI's `pnpm/action-setup@v4` couldn't even install pnpm) and `pnpm-lock.yaml` carried an orphaned `overrides:` block (60+ entries) stripping every non-darwin-arm64 native binary for esbuild/rollup/lightningcss/`@tailwindcss/oxide` with zero corresponding config in any `package.json` — this wasn't just stale metadata, it broke `--frozen-lockfile` outright and meant the lockfile could never resolve correct Linux binaries on CI's `ubuntu-latest` or Render's Docker build even if the mismatch check were bypassed; pinned `packageManager: pnpm@9.15.9` (matching the Dockerfile's `corepack prepare pnpm@9`) and regenerated the lockfile clean; (3) `.github/workflows/ci.yml` ran the API test suite (which shells out to real `python3 solve.py` via `resultEnvelope.test.ts`, a G2.1 test) *before* installing Python/pulp — reordered. **CI now passes green end-to-end for the first time ever.** Created real Render resources via MCP: `nos-postgres` (`dpg-d9hg4bmpbkes73a0j6l0-a`, `basic_256mb`, Postgres 16) and `nos-studio` (`srv-d9hg4gvlk1mc73dtp67g`, static site) — **`nos-studio` is live** at `https://nos-studio.onrender.com`, matching `render.yaml`'s placeholder exactly. **`nos-api` could not be created via MCP** — `create_web_service`'s own tool description explicitly excludes Docker-runtime services; this genuinely remains a Dashboard-only step (not a skill/tool gap I could work around), so R0.8 is only partially resolved. Once a human creates `nos-api` via the Dashboard, if it's named exactly `nos-api` its URL will be `https://nos-api.onrender.com` — already the exact value both `render.yaml` and `nos-studio`'s live `VITE_API_BASE_URL` use, so no further cross-reference fix should be needed.
  - **Still remaining:** create `nos-api` via the Render Dashboard (Docker runtime, pointed at this repo's `Dockerfile`) — see the plan doc's R0.8 for the full manual checklist (Starter plan, not Free) — then R0.9's post-deploy verification.
- [x] R0.8 (complete) + R0.9 — human created `nos-api` via the Dashboard; its real assigned URL is `https://nos-api-uwf8.onrender.com` (`nos-api` alone was already taken globally, Render appended a random suffix — the "no fix needed" assumption in the note above was wrong). Fixed `nos-studio`'s `VITE_API_BASE_URL` to the real URL and redeployed; re-asserted `nos-api`'s `CORS_ALLOWED_ORIGIN` too (no MCP/CLI tool can read back an existing env var to confirm it was typed correctly, so re-asserting — merge-safe, idempotent — is cheaper than trusting it blind). Ran R0.9's full checklist for real (glm agent for the curl-based checks, direct MCP/CLI work for log inspection and fixes) and found one more real bug: **`nos-postgres` was a brand-new empty database — nobody had ever pushed the schema to it**, so `POST /auth/register` 500'd on every request (`Failed query: select ... from "users"` — the table didn't exist). Fixed via `render jobs create <nos-api-service-id> --start-command "pnpm --filter @workspace/db push --force"` — a Render one-off job running inside `nos-api`'s own image, using its already-correct internal `DATABASE_URL`, no external IP allowlist changes needed (the DB's external access was closed by default; the user later opened it anyway via Dashboard Networking → IP Allow List for future ad hoc `psql` access, and provided the external connection string, but it wasn't actually needed for this fix). All 9 R0.9 checks now pass against the live environment: health check, CORS (echoes the specific origin + credentials), register (cookie shows `Secure; SameSite=None` in production), cookie auth round-trip, models list (3 models), create scenario, trigger solve (`202 {jobId}`), poll to completion (**a real CBC solve ran inside the deployed Docker container**: `status: optimal`, objective `29873735731`, `runTimeSec: 0.8`), frontend loads. **Render Migration Phase 0 is fully complete — first real deployment of this app off local-only/Replit, all three services live**: `nos-postgres`, `nos-studio` (`https://nos-studio.onrender.com`), `nos-api` (`https://nos-api-uwf8.onrender.com`).

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

**Phase 2 — Data layer extraction into model packages**
- [x] C1.1 — Extracted solve.py's embedded blobs into `solvers/{p-median-us,transport-coal,p-median-brazil}/dataset/*.json` (v0.2 per-model-package shape) via a one-off script that imports solve.py as a module (no hand-retyping). New `lib/dataset-schema` package (Zod schemas + validate/hash/version helpers). Commit `c9bf2bb`.
- [x] C1.2 — solve.py loads all three packages eagerly from disk instead of embedded blobs (small enough not to need per-request lazy loading yet); `_transport_distances()`/`_brazil_distances()` now return precomputed maps instead of recomputing haversine at call time. File 116KB -> 22KB. Byte-identical verified (e2e_accuracy.py 102/102 before and after). Commit `2965108`.
- [x] C2.1 — STOP-AND-ASK dataset audit, run early (before its normal later slot) because C1.3 was about to regress already-correct frontend labels — see below. Fixed WH23 (San Francisco, MO -> CA), WH25 (St. Louis, FL -> MO), WH26 (LUB -> LBB, "Lubbock" -> "Lubbock - Current WH") in the canonical JSON; id/city/state only, coordinates and distance matrix untouched (`DISTANCE` is index-keyed, not id-keyed). Report at `docs/dataset-audit.md`. Commit `2ca6e6a`.
- [x] C1.3 — `/api/dataset` now reads `solvers/p-median-us/dataset/` instead of a duplicated, since-diverged TS copy (`data/dataset.ts`) — that divergence (TS already had the correct WH23/25/26 labels) is exactly why C2.1 got pulled forward. Also caught and fixed a real esbuild-bundling bug: `import.meta.url`-relative paths collapse to the bundle's own location for every merged module, not each source file's true path (same class of issue `pmedian.ts` already works around for `solve.py`'s path) — fixed with `findRepoRoot()` walking up to `pnpm-workspace.yaml` instead of hardcoding a parent count, verified against the actual built server, not just vitest. New `test_datasets.py` (Python-side drift guard). Commit `3528000`.
- [x] X3 — New `.github/workflows/ci.yml` (none existed before): typecheck, api-server tests, studio tests, solver pytest, `e2e_accuracy.py`, on every push/PR against a Postgres 16 service container. Not yet exercised by a real Actions run (would need a push). Commit `bd2e6b7`.

**Phase 2 complete.**

**Phase 3 — Inputs epic (D0–D6, X1)**
- [x] D0 preamble (D0.1 contract + D0.2 schema/migration + D0.3 validators, plus forced route/solver/frontend rewrite) — landed as 3 verified checkpoints rather than the plan's single change-set, since D0.1+D0.2 together are genuinely one atomic migration but the route/solver rewrite and the ~900-line Studio.tsx rewrite are large enough to want independent rollback points. Each commit: full verification gate green before moving to the next.
  - `a60e478` — D0.1 (OpenAPI: `problemType`→`modelId` rename + new model-id values `p-median-us`/`transport-coal`/`p-median-brazil`; all typed scenario fields collapsed into a single opaque `inputs: object`), D0.2 (DB: `scenarios` gets `model_id text NOT NULL` + `inputs jsonb NOT NULL DEFAULT '{}'` + `inputs_version`/`solved_at`/`inputs_updated_at`, all 12 old flat columns dropped; migrated via raw SQL — `drizzle-kit push`'s rename-resolver needs a TTY we don't have, same issue as A2.1 — captured idempotently in `scripts/src/migrate-scenario-inputs.ts`; all 5 `nos_dev` rows translated and verified), D0.3 (`artifacts/api-server/src/validation/inputs/{pMedian,transportLp}.ts` Zod schemas behind `validateInputsForModel(modelId, inputs)`). Found while designing D0.3: p-median's `capacityMode` gains a third value `"none"` (old `capacityMode="uniform"`+`uniformCapacity=null` collapses to this); `warehouseOverrides`/`customerOverrides` replace the old `warehouseStatuses`/(never-wired) `excludedCustomerIds`, structurally validated now but D1.1 still owns actually wiring per-warehouse capacity and demand overrides into the solver.
  - `60c6b72` — Step 2: `routes/scenarios.ts` and `pmedian.ts` rewritten to read/write `model_id`/`inputs` instead of the flat columns; `pmedian.ts`'s `SolveInput` is now a discriminated union keyed by `modelId`, translating validated `inputs` into solve.py's existing (unchanged) wire format. Found here: `solve_capacitated_pmedian` reads `singleSource` but D0.1's p-median shape didn't have it — added as optional to the shared p-median schema (Brazil needs it, plain p-median ignores it). `routes.test.ts`/`pmedian.test.ts` rewritten for the new shapes.
  - `a481d79` — Step 3: `Studio.tsx`/`Compare.tsx`/`chapters.ts`/`ObjectiveBar.tsx`/`NetworkMap.tsx`/`App.tsx` rewritten. `Studio.tsx`'s `LocalConfig` deliberately keeps its old flat internal shape (including `warehouseStatuses` with the old `"potential"` vocabulary) — only `configFromScenario`/`buildInputsForSave` translate to/from the new nested `inputs` shape, so the ~900-line JSX body barely changed. Removed the Solver select entirely (dead field — solve.py always uses CBC regardless of what was sent; D0.1's contract has no field for it). `customerOverrides` aren't editable by any UI yet (D1.2/D2) so Studio carries them through unchanged rather than dropping them on save.
  - Gate at HEAD: full workspace typecheck green, 109/109 studio tests, 103/103 api-server tests, 50/50 solver pytest, 102/102 `e2e_accuracy.py` (unmodified). `vite build` fails on a pre-existing, unrelated `lightningcss` native-binary issue (confirmed present before this work via `git stash`) — not in the project's defined verification gate.
- [x] D1.1 — solver override capability. `96550e3`. `solve_pmedian` (p-median-us) now reads `warehouseCapacities`/`customerDemands` sparse maps (per-warehouse capacity bound, per-customer demand), falling back to `uniformCapacity`/base demand when no override exists — a real capability change, since per-warehouse capacity was declared in the old schema's `capacityMode="per_wh"` value but solve.py never actually implemented it (always used one shared scalar). `pmedian.ts`'s `buildPayload` derives these maps from `warehouseOverrides[].capacity`/`customerOverrides[].demand`. Sent to Brazil too (harmless — its dispatch ignores unknown keys) but Brazil's *own* per-warehouse wiring is out of scope: no warehouse/customer table UI exists for it yet, and it's a structurally separate solve function/dataset. **Deviation from plan text:** implemented as inline closures instead of one shared `applyOverrides(baseDataset, inputs)` function reusable by D4.1 — that abstraction would be premature before D4.1 exists and its real shape is known; revisit then. New `test_overrides.py` (3 tests: demand-override objective delta hand-verified, per-WH capacity actually binds, excluded customer absent from assignments) + 2 new `pmedian.test.ts` cases for the TS-side translation. 105/105 api-server, 53/53 solver pytest, 102/102 `e2e_accuracy.py` unmodified.
- [x] D1.2/D2.1/D3.1 — left panel rework + warehouse/customer override tables. `a231645`. Bundled these three tasks into one commit: D1.2's own spec text depends on D2/D3 tables existing ("buttons opening D2/D3 tables"), so doing D1.2 alone first would ship dead buttons. New `components/tables/{WarehouseTable,CustomerTable}.tsx` (ID, city+state read-only, status select, warehouse capacity editable iff `capacityMode=per_wh`, customer demand editable ≥0 with inline error) opened from the left panel via two Dialog-wrapped buttons ("Overrides" section, replacing the old inline 26-row warehouse-status list). `Studio.tsx`'s `LocalConfig.warehouseStatuses` (old vocabulary, no capacity) became `warehouseOverrides` matching the API shape 1:1 — no more boundary translation needed. `capacityMode` is now a real 3-way none/uniform/per_wh toggle (D0.1's contract already had "none", the UI just didn't expose it). Gap/Time relabeled "Optimization gap"/"Max time (seconds)" per plan wording. Found while building the customer table: OpenAPI's `Customer` schema was missing `city`/`state` even though the dataset and api-server's internal type both already had them (`data/dataset.ts` casts the raw JSON directly) — added to the contract, no backend code change needed since the data was already flowing through. No virtualization on the 200-row customer table — measured first (~130ms), can revisit if it janks for real. 120/120 studio tests, 105/105 api-server (unaffected); didn't touch solve.py/datasets so skipped the full pytest run, spot-checked `test_datasets.py` (4/4) as a sanity check on the Customer schema change. **Deferred:** Brazil/transport get no warehouse/customer table wiring (different dataset/id namespace, same boundary D1.1 drew).
- [x] D4.1 — export. `f33710c`. New `GET /scenarios/:id/export?entity=warehouses|customers&format=csv|json` — p-median-us only (Brazil/transport out of scope, same boundary as D1.1/D2/D3). New `services/templates.ts`: `applyWarehouseOverrides`/`applyCustomerOverrides` merge sparse overrides onto the full baseline dataset (all 26/200 rows, not just overridden ones) — the TS-side counterpart to D1.1's solve.py closures, confirming D1.1's "wait for D4.1 to know the real shape" call was right (export wants complete per-row data, solve.py wants lookup functions — genuinely different needs, not one reusable function). CSV: plain columns, `template_version` repeated per row (not a comment line) — picked for a simpler D5 importer. Found while regenerating codegen: first operation with both a path param and query params, and orval names them identically (`ExportScenarioParams`) causing an ambiguous star-export in `lib/api-zod/src/index.ts`; fixed with one explicit `export type {...}` line (explicit re-exports win over star-export ambiguity) — no generated file touched. 123/123 api-server, 120/120 studio (unaffected). No Python touched, skipped the full pytest run.
- [x] D5.1 — import parse/validate/preview + apply (backend). `295fd0a`. New `services/import.ts`: `parseAndValidateImport` returns `{errors, changes, warnings}` with error classes exactly `format|syntax|logic` (format = whole-file structural, e.g. wrong columns / bad encoding / city-keyed instead of id-keyed; syntax = row column-count mismatch; logic = business rule violation — unknown id, negative/non-numeric value, invalid status, duplicate id, template_version mismatch). Bad rows are skipped, not fatal — one malformed row doesn't block the rest of the file. Cross-field warning (non-blocking): total capacity of the p highest-capacity active warehouses vs total customer demand. Golden fixture tests under `__tests__/fixtures/imports/` per the plan's exact list (7 files, 13 tests). Uses papaparse — **correction to the plan**: it claims papaparse is already a studio dependency; it isn't present anywhere in the repo, added fresh to api-server instead. Also built the two routes (`POST /scenarios/:id/import` preview, `POST /scenarios/:id/import/apply`) since D5.1's file list only mentions the service but D5.2 has no backend file at all — apply always re-validates server-side (never trusts a stale client preview), `all_or_nothing` mode + any error → 422 with zero DB writes. p-median-us only. 144/144 api-server, 120/120 studio (unaffected). No Python touched.
- [x] D5.2 — Import UI (`components/ImportDialog.tsx`) + export buttons. `21a9cdd`. Flow: file pick → preview (errors red w/ line+class, changes green) → all-or-nothing/partial mode checkbox → confirm → apply → success toast with counts; Cancel is a true no-op (only Confirm calls apply). Also added Export CSV/JSON buttons for warehouses/customers to `Studio.tsx`'s Overrides section — D4.1 had shipped backend-only with no frontend trigger despite the PRD requiring one, and import needs a source file anyway, so closed both gaps in one pass (product-scope call, confirmed with the human first). Export downloads client-side via the plain `exportScenario` fetch function + Blob (the generated hook is a query hook, not suited to on-click downloads). 4 new RTL tests (`ImportDialog.test.tsx`) mock at the `global.fetch` level rather than mocking the generated hooks, so real React Query state transitions are exercised. **Also finally executed e2e for real** (first time since A3.2's known gap was opened): new `e2e/import.spec.ts` exports a real scenario's customer CSV, edits one demand value, reimports through the UI, asserts exactly one change applied. Required fixing the local-dev-proxy gap: `vite.config.ts` gained an opt-in dev-only proxy (`API_PROXY_TARGET` env var, no effect unless set, no effect on production build) forwarding `/api` to the api-server so the browser sees one origin (auth cookies work without CORS gymnastics). Uncovered along the way: the environment was missing darwin-arm64 native bindings for both `lightningcss` *and* `@tailwindcss/oxide` — not just lightningcss, which line 84 already knew broke `vite build`; `vite dev` couldn't start at all. Fixed via a full `node_modules` reinstall plus explicitly pinning `lightningcss-darwin-arm64` and `@tailwindcss/oxide-darwin-arm64` as devDependencies so the lockfile resolves them for this platform. `.gitignore` gained entries for Playwright's local run artifacts (`e2e/.auth`, `e2e/report`, `test-results`). Gate green: typecheck, 144/144 api-server, 124/124 studio, 53/53 solver pytest. No Python touched, `e2e_accuracy.py` not re-run.
- [x] D6.1 — reset to baseline. `b49da82`. New `POST /scenarios/:id/reset-to-baseline` (spec + regen): clears `warehouseOverrides`/`customerOverrides` only, leaves `p`/`capacityMode`/`distanceBands`/etc untouched; p-median-us only (same boundary as D1.1/D2/D3/D4.1/D5.1); bumps `inputsUpdatedAt` for X1.1. `Studio.tsx` gained a "Reset to baseline" button (disabled when nothing to reset) behind a confirm `Dialog`, reusing D5.2's `handleImportApplied` to resync local state from the response. 5 new api-server tests, 4 new Studio RTL tests. Gate green: typecheck, 149/149 api-server, 128/128 studio, 53/53 solver pytest.
- [x] X1.1 — staleness guard. `4de0e2a`. **Phase 3 complete.** `Scenario.stale` (spec + regen): derived, never stored — `stale = result != null && inputsUpdatedAt > solvedAt`, computed in `toApiScenario`. Unsolved (`result` null) is never stale. `inputsUpdatedAt` was already bumped by PATCH-inputs/import-apply/reset-to-baseline (D0.2/D5.1/D6.1); a name-only PATCH correctly does not (tested directly against the raw `.set()` call args). Solve always clears it since `solvedAt` is set alongside `result`. `Studio.tsx` header pill + a results-panel `Badge` show "Stale · re-solve" instead of misleadingly "Solved · validated"; `Compare.tsx` gets a per-column stale `Badge` (first test file written for Compare.tsx). 5 new api-server tests, 3 new frontend tests. **Phase 3 exit manual script run for real** against the local DB: solve (objective A) → export customers → edit 5 demands → preview (exactly 5 changes, 0 errors) → apply (stale→true) → re-solve (objective B ≠ A, stale→false) — matches the plan's acceptance script verbatim. Gate green: typecheck, 154/154 api-server, 131/131 studio, 53/53 solver pytest.

**Also fixed along the way** (pre-existing bugs found while restoring a green verification gate, unrelated to any single task — see commit `6869029`): Brazil-lab scenarios were silently solving as plain uncapacitated p-median in production — `problemType` enum (`capacitated_flp`) never matched `solve.py`'s dispatch string (`capacitated_pmedian`), and even after that's fixed, the route never sent `warehouseCapacity` (a field distinct from `uniformCapacity`) that `solve_capacitated_pmedian()` actually reads. Both fixed; verified against `e2e_accuracy.py` (102/102, unmodified). `routes.test.ts` was also rewritten — it mocked a three-table architecture (`pmedianScenariosTable`/`transportScenariosTable`/`brazilScenariosTable`) that was never actually implemented; real schema has always been one `scenariosTable`.

**Phase 3.5 — Model registry, result envelope, async job queue** (new in v0.2)
- [x] G1.1 — model manifests. `bca3c36`. `solvers/<model-id>/manifest.json` for all three models (id/name/chapter/datasetDir/countryBounds/capabilities/inputsSchema); `countryBounds` computed from real dataset lat/lng, not guessed. New `lib/dataset-schema` `ManifestSchema`/`readManifest()`/`MODEL_IDS`. 13 new tests.
- [x] G1.2 — model registry service + `GET /api/models`. `fdc46a7`. New `registry/modelRegistry.ts`: scans `solvers/*/manifest.json` at boot via `fs.readdirSync` (not a hardcoded list — DoD literal test: drop a 4th manifest dir, it appears with zero code changes). `validateInputsForModel` now delegates to the registry (same signature, no call-site changes). New unauthenticated `GET /api/models`. 6 new tests.
- [x] G2.1 — standardized result envelope. `af5a724`. `solve.py`'s three models now emit `{status, objective, runTimeSec, quality, edges, metrics, details, solverUsed, infeasibilityReason}` via a shared `_envelope()` helper — pure refactor, no numeric values changed (verified `e2e_accuracy.py` 102/102 unmodified, the plan's explicitly-granted exception for updating that test's assertions to new paths). New `resultEnvelope.ts` (Zod schema) + `pmedian.ts`'s `envelopeToLegacy()` shim translates back to the pre-envelope flat shape so the frontend needed zero changes for this task (Phase 4/5 will read the envelope directly and retire the shim). 4 new tests (all three models + infeasible case validate against the schema — the literal DoD).
- [x] G3.1 — async solve (`solve_jobs` table + worker-pool dispatcher). `03fa762`. `POST /scenarios/:id/solve` now enqueues and returns `202 {jobId}` instead of blocking the event loop; new `GET /scenarios/:id/solve-jobs/:jobId` for polling. New `solve_jobs` table (doubles as G3.2's solve-history source later). New `jobRunner.ts`: in-process worker pool (concurrency 3), async `spawn` (not `spawnSync`) with SIGKILL-on-timeout resolving immediately rather than waiting on a "close" event. `pmedian.ts`'s synchronous `solve()` is gone entirely (DoD: zero `spawnSync` in the codebase — also deleted the long-dead `listSolvers()`, unused since B1.1 removed the Solver dropdown, which also used `spawnSync`). `Studio.tsx` polls via `useGetSolveJob` (`refetchInterval` 800ms while queued/running), toasts on failure. `pmedian.test.ts` rewritten as pure-function tests (`buildPayload`/`envelopeToLegacy`, no more `child_process` mocking needed). New `jobRunner.test.ts` (7 tests: transitions, 2 concurrent jobs don't block each other, timeout, non-zero exit, bad stdout, invalid envelope, spawn error — all degrade to `failed` without throwing). Gate green: typecheck, 175/175 api-server, 134/134 studio, 53/53 solver pytest; `e2e_accuracy.py` not re-run (solve.py untouched since G2.1's verified 102/102).
- [x] G3.2 — solve history from solve_jobs (absorbs A4). `429c547`. **Phase 3.5 complete.** New `GET /solve-history?limit=5`: reads `solve_jobs` filtered by `user_id`, ordered `queuedAt` desc, inner-joined to `scenarios` for name/modelId — no new table (per §0.5a's rationale for building G3.1/G3.2 together). `jobRunner.ts`'s `resultSummary` gained `runTimeSec` (the one field G3.2's DoD needed that wasn't already there). `Landing.tsx` gained a "Recent solves" section (hidden when empty) — status badge, objective/distance/runtime, links to the scenario's chapter route with `?scenario=`. 10 new tests (5 api-server, 5 frontend). Gate green: typecheck, 180/180 api-server, 137/137 studio. No Python touched.
**Phase 4 — Results & map UX** (E1–E5)
- [x] Phase4-prereq — retired `envelopeToLegacy()` shim, migrated all frontend consumers to the envelope shape. `ea4b822`. `Scenario.result`/`SolveResult` (spec + regen) is now `{status, objective, runTimeSec, quality, edges, metrics, details, solverUsed, infeasibilityReason}` end-to-end — G2.1's shim (which stripped this back to the pre-envelope flat shape before it ever reached the API) is gone, exactly as its own commit note said would happen once Phase 4 needed `edges` on the wire (E1.1 does). `jobRunner.ts` stores the validated envelope as-is. Every consumer migrated: `NetworkMap.tsx`/`BrazilMap.tsx`/`OverlayMap.tsx`/`ObjectiveBar.tsx`/`Studio.tsx`/`Compare.tsx` all read `edges`/`metrics`/`details` now instead of `assignments`/`openWarehouseIds`/`bandCoverage`/`utilization`/`weightedAvgDistanceMi`. Dropped the unused `"solving"` status enum value (job status owns that concept now). Gate green: typecheck, 176/176 api-server, 143/143 studio.
- [x] E3.1 — achieved metrics quality statement. `d8cfbc9`. New `lib/quality.ts`: "Proven optimal" (gap=0) / "Within configured gap X%, limit reached" (gap>0) — ships the status-statement version per the plan's pre-resolved OQ4; real CBC log parsing is an explicit fast-follow. Wired into Studio.tsx's headline metric block, reading gap from the persisted `scenarioFromApi.inputs`, not local unsaved edits. 4 unit + 2 RTL tests.
- [x] E1.1 — client-side distance bands. `68c26e7`. New `lib/bands.ts`: `assignBand`/`computeBandCoverage`, mirroring solve.py's cumulative band-coverage semantics exactly. Band editor moved from the left config panel to the results panel (only shown once solved) — editing is now purely an analysis lens on the current result, no re-solve implied. Coverage bars and `NetworkMap`'s route/marker colors both recompute client-side from `result.edges` + the current bands, instead of trusting the server's `metrics.bandCoverage`/each edge's stored `.band` (both go stale the moment bands are edited post-solve without re-solving). 10 unit + 3 RTL tests, including the zero-network-call assertion the plan's DoD specifically asks for.
- [x] E4.1 — auto-show routes colored by band. `3708082`. New `lib/bandPalette.ts` (`BAND_COLORS`/`getBandColor`) — single source of truth shared by `NetworkMap` and the band-coverage bars, which previously had their own slightly-divergent local copies (4 vs 5 colors). On solve success the routes toggle now switches on automatically instead of staying wherever the student last left it. 2 new unit tests + 1 Studio RTL test. Gate: typecheck, 158/158 studio.
- [x] E5.1 — map bounds per model, from the manifest. `75914e9`. New `lib/mapBounds.ts`: `getMapBoundsProps(countryBounds)` derives `maxBounds`/`center`/`minZoom` from the active model's manifest (via `useListModels`) instead of a hardcoded US-centric constant; falls back to a continental-US default only before the manifest loads. `NetworkMap` gained a `countryBounds` prop + `FitBounds` helper (mirrors the existing `MapClickDeselect` pattern) and `minZoom`/`maxBounds` on `MapContainer`. 5 new unit tests (US/Brazil bounds, malformed fallback, minZoom floor) + 2 Studio RTL tests. Gate: typecheck, 165/165 studio.
- [x] E2.1 — constraint chip bar, Phase 4 exit. `02acd57`. New `components/ConstraintChips.tsx` above the map: p, capacity-mode summary, and (only when non-zero) forced-open/inactive/excluded/demand-edited counts + X1.1's stale badge — p-median-us only, same boundary as Overrides (D1-D3). Chips are clickable: p/capacity scroll their left-panel section into view (new `section-p-value`/`section-capacity` ids), forced-open/inactive open the Warehouses dialog, excluded/demand-edited open the Customers dialog. 10 new unit/RTL tests + 3 Studio integration tests. Gate: typecheck, 178/178 studio. **Phase 4 (Results & map UX, E1-E5) is complete.**
- [x] Phase4-exit manual verification + fix. `f937091`. Ran the plan's literal Phase 4 exit check (solve a scenario in a real browser against the built server, confirm routes auto-on/bands/chips/map) via `claude-in-chrome` against local dev servers. Found and fixed two real bugs neither automated suite could catch: (1) `jobRunner.ts`'s `SOLVER_PY` path broke under the bundled server the same way `data/dataset.ts` already documents (`import.meta.url` collapses to the bundle's location) — every real solve failed with "python3 process failed"; fixed with the same `findRepoRoot()` pattern. (2) Express's default weak ETags turned repeat solve-job poll GETs into `304 Not Modified`, which `customFetch` treats as an error (not "reuse cached data"), silently breaking the async poll loop — fixed with `app.set("etag", false)` (this is a stateful JSON API, not cacheable content). Re-verified end-to-end against the rebuilt server: a live solve completes, "Show routes" auto-enables (`aria-checked` flips false→true), quality statement/bands/chips all render correctly. (A misleading "stuck polling forever" symptom seen mid-investigation turned out to be a `claude-in-chrome`-only artifact — the automated tab reports `document.hidden === true` even while it has focus, pausing React Query's background refetch; real foreground tabs aren't affected, and `refetchOnWindowFocus` self-heals if a real user alt-tabs away mid-solve — no frontend change needed for that part.) Gate green: typecheck, 176/176 api-server, 178/178 studio. Python untouched, pytest not re-run.
**Phase 5 — Compare v2** (F1, F2)
- [x] F1.1 — Compare contract + validation. `037286a`. Rewrote `POST /scenarios/compare` wholesale (spec + regen + route), replacing the old broken pre-envelope contract (it had been silently reading `result.utilization`/`result.openWarehouseIds`/`result.bandCoverage`/`result.weightedAvgDistanceMi` — fields that stopped existing after the Phase4-prereq envelope migration). New contract: 2-4 scenario IDs, ownership check first (404, never 403 — batched into one `inArray(...) AND userId` query, replacing the old N sequential per-ID queries), same-`modelId` check (422), solved-and-non-stale check (422 `CompareRejection{error, offendingIds}`, reusing the existing `isStale()` helper verbatim). Response is `{scenarios: Scenario[]}` in request order, each scenario's opaque `inputs` + full envelope `result` unchanged — no server-side flattening; the frontend (F2.1) diffs generically. New `CompareRejection` schema, dropped `ScenarioMetrics`/old `CompareResult` shape. 9 new/rewritten compare tests. Gate green: typecheck (Compare.tsx itself deliberately left red — explicitly F2.1's job), 182/182 api-server, 178/178 studio, 53/53 solver pytest. Executed via subagent-driven-development (implementer + task reviewer, Approved first pass).
- [x] F2.1 — Diff engine + UI. `4f10ca5` + `df7b627` (test-coverage fix) + `c4e5137` (onError guard fix, from final review). New pure `studio/src/lib/compareDiff.ts`: generic key-by-key `inputs` diff (works for any model's shape sight-unseen — the only special case is arrays of `{id: ...}` objects diffed by id instead of index/stringify, implemented once inside a generic `deepEqual`, not as a `warehouseOverrides`-specific branch) + output diff (objective delta abs/%, open/closed sites derived from unique `edges[].fromId`, reassignment count from per-customer `fromId` changes, `metrics` deltas iterated generically over whatever keys a model populates). Rebuilt `Compare.tsx`: picker filtered to one `modelId` at a time (prevents cross-model selection by construction, stronger than relying on the 422), "needs solving" chip + one-click async solve (reusing Studio.tsx's mutate→poll→invalidate pattern) for unsolved/stale scenarios, side-by-side diff table with changed-vs-identical highlighting. Deleted `OverlayMap.tsx` and the old ad hoc "Before/After Overlay" section (out-of-scope F3, didn't generalize to a 2-4-scenario picker — explicit judgment call, not an oversight). 14 new `compareDiff` unit tests + rebuilt `Compare.tsx` RTL tests (200/200 studio total). Found and fixed during self-review: a baseline-anchoring bug where metric "changed"/delta values were computed relative to array index 0 instead of the user-chosen baseline scenario. One task-review fix cycle (added missing test coverage for the compare-endpoint 422/race-handling path: a scenario going unsolved/stale between page load and comparison correctly demotes to "needs solving" via `onError`, not silently). One final-whole-branch-review fix (guarded `onError`'s `"offendingIds" in data` against non-object `data` — `customFetch` returns a raw string for non-JSON error bodies, e.g. an infra-level 500, and the bare `in` check would throw). Executed via subagent-driven-development end-to-end: implementer → task review → fix → re-review (Approved) → final whole-branch review (Ready to merge) → fix → fresh gate re-verification. Gate green: typecheck, 182/182 api-server, 200/200 studio. Python untouched throughout Phase 5. **Phase 5 (Compare v2) is complete.**
  - **Known non-blocking follow-ups** (deferred as genuinely Minor by both the task and final reviews, not fixed): duplicate scenario IDs in a compare request (e.g. `[1,1]`) produce a misleading "not found" 404 instead of a clearer error; no 200 happy-path test at the exact 4-scenario upper boundary; `compareDiff.ts`'s `detectKeyField` picks an output-metric array's id-field via "prefer `id`, else first-unique-field" relying on object key insertion order (works for every current metric shape, could mis-key a hypothetical future one); no RTL test at 3-4 simultaneous scenario selection or the `MAX_COMPARE=4` disable behavior; small DRY duplication between `InputDiffCell` and `MetricRowCells`'s keyed-array rendering. **`artifacts/api-server/src/solver/tests/e2e_journey.py`'s compare assertions are now dead against the new contract** (reads old field names `scenarioId`/`openSites`/`weightedAvgDistanceMi`) — it's a standalone script outside the `pytest tests/ -x` gate and wasn't run this phase; needs updating before it's trusted again, don't mistake its presence for coverage.
**Phase 6 — Solve worker-pool scaling** (P1, optional)
- [x] P1.1 — configurable concurrency + backpressure. `456401f`. Scope is deliberately narrow: the plan's third Phase 6 bullet (split the dispatcher into a separate process/service) is explicitly conditional on evidence a single Node process is the bottleneck — none exists (this pilot has never been deployed to a real cohort) — so it's NOT part of this task. `jobRunner.ts`'s `CONCURRENCY` (was a hardcoded `3`) and a new `QUEUE_DEPTH_LIMIT` (30) are both configurable via `SOLVE_WORKER_CONCURRENCY`/`SOLVE_QUEUE_DEPTH_LIMIT` env vars, parsed by a new pure `parsePositiveIntEnv()` (falls back to the default on unset/blank/non-numeric/non-integer/<=0 — operators should tune concurrency based on their own host's measured headroom, which doesn't exist yet for this pilot, hence the unchanged default). New exported `getQueueDepth()` reads the existing `queue` array's length — jobs waiting for a worker slot, deliberately excluding in-flight `activeCount` jobs (not a capacity problem). `routes/scenarios.ts`'s solve handler checks queue depth *before* any DB work (same fail-fast ordering as `auth.ts`'s login rate limiter) and returns `429` + `Retry-After: 30` (fixed conservative estimate, not derived from live measurements) + `{error}` JSON when at/over the threshold, without enqueueing. New `429` response added to `solveScenario` in the spec (`ErrorEnvelope` body + `Retry-After` header); codegen regenerated (`lib/api-client-react` only — the zod schema shape didn't change). 4 new route tests (429 at/over limit, still-202 below limit, capacity check runs before the DB lookup) + jobRunner tests (`getQueueDepth()` behavioral correctness at default concurrency, `parsePositiveIntEnv` unit tests, `QUEUE_DEPTH_LIMIT` default) + new `jobRunnerConcurrency.test.ts` (`SOLVE_WORKER_CONCURRENCY=1` actually serializes two jobs, via a fresh module import relying on vitest's per-file module isolation). No frontend change — a generic error toast on the existing mutation `onError` path is accepted as adequate interim 429 UX per the task brief; no Retry-After-aware messaging or auto-retry built. Gate green: typecheck, 195/195 api-server (16 new/changed), 200/200 studio (unaffected), 53/53 solver pytest (unaffected, Python untouched).
- [x] P1.2 — result_cache table + check-before-dispatch. `7d62c6f`. New `lib/db/src/schema/result_cache.ts`: `inputsHash` (PK), `modelId`, `result` jsonb, `createdAt` — matches the plan's §0.2 target schema exactly, applied via plain `drizzle-kit push` (new table, not a NOT NULL column on a populated one, so the two-step protocol doesn't apply). `jobRunner.ts`'s `runJob()` checks this cache by the already-existing `computeInputsHash()` before spawning `solve.py`; on a hit, skips the solver process entirely and calls the existing `markSucceeded()` directly with the cached envelope (re-validated against `ResultEnvelopeSchema` — cache entries aren't trusted any more than solve.py's raw stdout is); on a miss, solves normally then writes through via a race-safe `onConflictDoNothing` upsert (two near-simultaneous identical solves can't crash on a duplicate key). No new `solve_jobs` status values, no frontend changes, no API/spec changes (a transparent internal optimization — a cache-hit job still visibly goes through `queued→running→succeeded`, just fast). Both lookup and write-through catches degrade silently to "solve normally" on any error (schema drift, transient DB issue) — consistent with `jobRunner.ts`'s pre-existing "never throw" invariant and this codebase's existing no-logging convention elsewhere, not a new gap. 4 new tests: cache hit asserts `spawn` was never called (not just that the job succeeded), cache miss asserts a real write-through row, two-same-hash test threads job 1's actual captured insert payload into job 2's mocked read (a genuine round trip), malformed-cache-entry falls back to solving rather than crashing. Executed via subagent-driven-development: implementer → task review (Approved, no fix cycle) → final whole-branch review across both P1.1+P1.2 (dispatched via the GLM agent per explicit user instruction — first phase to use it), Ready to merge, no Critical/Important findings. Fresh gate re-verified after: typecheck clean, 199/199 api-server, 200/200 studio. Python untouched throughout Phase 6. **Phase 6 (Solve worker-pool scaling, P1.1+P1.2) is complete — this was the last phase in `IMPLEMENTATION_PLAN.md`.**
  - **Known non-blocking follow-ups** (deferred as genuinely Minor by both task reviews and the final review): the queue-depth check-then-enqueue isn't atomic (fine at this pilot's assumed ≤10 concurrent users); the new 429's OpenAPI doc is richer than its sibling 404/422 on the same endpoint (cosmetic inconsistency); `lookupCachedResult`'s genuine-thrown-error branch (as opposed to schema-invalid JSON) is untested; zero observability/logging if cache lookup or write-through ever errors (inherited gap, not introduced here); `computeInputsHash()` is recomputed in `runJob()` despite already being stored on the `solve_jobs` row from `enqueueSolveJob()` (harmless).

**Post-migration bug-class audit** (2026-07-24, `docs/superpowers/plans/2026-07-24-post-migration-audit.md`) — after the Render migration surfaced two real first-deployment bugs (unreachable create-scenario dialog, auth-routing race — both above), ran 8 read-only audit tasks via the `glm` subagent to proactively hunt for more of the same bug classes plus other migration-exposed blockers, reports under `.superpowers/sdd/audit-task{1-8}-*.md`. 4 real findings, all fixed (each via a dispatched `glm` fix + independently re-verified by re-reading the diff and re-running the full gate myself, not just trusting the agent report):
- [x] Task 7 finding (security) — `DELETE /scenarios/:id` returned `204` instead of `404` for a scenario owned by a different user, a status-code side-channel violating hard rule #5's anti-enumeration contract. No data was ever mutated (the `WHERE userId=...` clause was always correctly scoped — a true no-op), confirmed live against the deployed API with two disposable test accounts (cleaned up after). Fixed in `3e9d5de`: DELETE now uses `.returning()` like PATCH already did, 404s when zero rows match.
- [x] Task 6 finding — `nos-api` (single Render instance) has no SIGTERM handling at all; any `solve_jobs` row still `"running"` when a redeploy kills the process stayed stuck in `"running"` forever, with no reaper/heartbeat/startup sweep — compounding on every future redeploy and needing manual SQL cleanup. Fixed in `9251d4a`: new exported `reapStuckJobs()` in `jobRunner.ts`, called once at startup in `index.ts` before `app.listen`, marks any pre-existing `"running"` row `"failed"` ("Interrupted by server restart"). Deliberately narrow — full graceful in-flight-request draining and child-process SIGTERM cleanup are explicitly NOT part of this fix, only the "permanently stuck row" half.
- [x] Task 4 finding — zero catch-all Express error-handling middleware anywhere; an unhandled route exception (e.g. an un-try/caught `await db...`) fell through to Express 5's default `finalhandler`, returning HTML (with a stack trace outside production) instead of the `{error: "..."}` JSON convention every other response in this API uses — breaking the frontend's JSON-only `customFetch`. Fixed in `07502c9`: new 4-arg error middleware at the end of `app.ts`, logs the real error server-side via the existing `logger`, always responds `500 {error: "Internal server error"}` to the client in every environment (never leaks internals), delegates to `next(err)` if `res.headersSent`.
- [x] Task 2 finding — `Studio.tsx`'s `handleClone`/`handleDelete`/`handleCreateConfirm` all called `invalidateQueries` then `navigate` in the same tick, without awaiting the async refetch — same race *class* as the already-fixed `App.tsx`/`AppShell.tsx` auth bug, though lower severity here (a stale/wrong-scenario flash that self-corrects, not a hard dead-end 404). Fixed in `ae65412` using the same established pattern as `AppShell.tsx`'s logout fix: `queryClient.setQueryData(...)` writes the mutation's own response synchronously into the cached scenarios list *before* `navigate(...)`, with `invalidateQueries` moved to strictly after navigation as a non-blocking background refresh.
- Tasks 1, 3, 5 found no actionable gaps (Task 1: the dialog bug above was the only instance of that pattern, already fixed and test-covered; Task 3: no new hardcoded URLs beyond the two already-known files; Task 5: DB pool math checks out at current scale, though Render's actual `basic_256mb` connection ceiling is still genuinely unconfirmed in-repo). Task 8 produced a non-code proposal (not implemented): a prioritized list of 5 concrete flows `labs.spec.ts` should be rewritten to cover, each targeting one of today's specific findings — top priority is a real-browser "empty account → create first scenario" flow.
- Full verification gate re-run once, myself, after all 4 fixes landed (not per-fix, since fixes touched disjoint files): typecheck clean, 207/207 api-server, 216/216 studio. Python untouched throughout, pytest not re-run.

**Chapter 10 — Two-Echelon Gold Refinery Siting (`two-echelon-gold-au`), a 4th model** (2026-07-24/25, `docs/superpowers/plans/2026-07-24-chapter-10-two-echelon-gold-refinery.md`, reconciled from `chapter-10-two-echelon-gold-refinery-{integration,implementation}.md`). Mine→refinery (raw)→customer (refined) LP with a single-refinery-open binary and a bill-of-materials ratio linking the two legs; dataset transcribed from the real source notebook (`Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb`) — 1 mine (Kalgoorlie), 2 candidate refineries (Daggar Hills, Cunnamulla), 10 customers, demand summing to 7,400,000. Executed via subagent-driven-development (`glm` implementer per task, myself as orchestrator/verifier) across 7 tasks, each its own commit:
- `96f4c1e` (M0) dataset extraction into `solvers/two-echelon-gold-au/dataset/*.json`, slug ids to avoid the notebook's numeric-id collisions between refineries/customers.
- `8bdbe2a` (M1) manifest + `PACKAGE_SPECS`/`lib/dataset-schema` registration.
- `6bb3950` (M2+M3.1, one commit per the plan's explicit constraint) `solve_two_echelon()` in `solve.py` + `resultEnvelope.ts`'s `Edge.leg`/`Metrics.avgDistanceByLeg` — **fixes a real bug in the source notebook**: its BOM constraint was written per (mine, refinery) pair, only correct by coincidence with one mine; `solve_two_echelon` sums it over mines instead (`test_flow_balance_generalizes` in `test_two_echelon.py` proves this with a monkeypatched 2nd mine). Verified against the notebook's own stored output: objective `386576.9929994568`, Cunnamulla opens, avg customer distance `687.5738755210947` km, exact match.
- `cc22604` (M3.2-M3.5) Zod schema (`bomRatio: z.number().gt(1).max(10)`), `VALID_MODEL_IDS`/`buildPayload()` wiring, OpenAPI enum + codegen (`Edge.leg` enum, `SolveMetrics.avgDistanceByLeg`/`LegAverageDistance` added to the **public** contract too, separate from the internal envelope, or Orval's generated client would silently strip them).
- `23f5372` (M4) frontend: Australia `countryBounds`, leg-colored routes on `NetworkMap` (green mine→refinery, red refinery→customer, falling back to band coloring for every other model), BOM ratio slider, per-leg avg-distance panel. New chapter entry is `hiddenFromLanding: true` (deliberate — never manually browser-tested before this session; routes stay registered so deep links/scenarios still work, same mechanism as the existing transport-coal/p-median-brazil hiding).
- `f5cac22` (tests) `registration.test.ts`'s `SOLVABLE` extended to all 4 models, `resultEnvelope.test.ts`/`NetworkMap.test.tsx`/`Studio.test.tsx` coverage for the leg fields, `test_two_echelon.py` (10 pytest cases including the BOM-summing regression test above), `e2e/two-echelon.spec.ts` written but **not executed** (no real browser+dev-server pair available in that verification pass).
- M5 ("Arcadia quest" content) was explicitly out of scope per the plan's Global Constraints, resolving a contradiction between the two source docs — no gamification subsystem exists in this codebase to attach it to anyway (removed in Phase 1/A3).
- **Real, general, previously-undiscovered production bug found and fixed along the way, at explicit user instruction ("Before Task 6, Fix this solve_jobs bug")**: `DELETE /api/scenarios/:id` 500'd for any solved scenario in ANY model (not Chapter-10-specific) — `solve_jobs` rows reference `scenarios.id` with no `ON DELETE CASCADE`, so deleting a scenario with solve history violated the FK. Fixed in `26fa918`: DELETE now wrapped in `db.transaction()`, deletes the scenario's `solve_jobs` rows (scoped by `scenarioId` + `userId`) before deleting the scenario row. Verified live against a real Postgres-backed server (204 then 404) both before and after deploying.
- **Deploy-time bug found and fixed**: Task 3 (M1)'s `glm` implementer added `vitest`/`vitest-coverage` devDependencies to `lib/dataset-schema/package.json` but never committed the regenerated `pnpm-lock.yaml`, so `nos-api`'s Docker build (`pnpm install --frozen-lockfile`, same strictness as CI) failed with `ERR_PNPM_OUTDATED_LOCKFILE` on the real Render build. Caught via `mcp__render__list_logs`, fixed in `1ab4800`.
- **Flaky `resultEnvelope.test.ts` timeouts investigated and resolved as environmental, not a regression**: a fresh `api-server` test run mid-session showed inconsistent failures (different subprocess-spawning test timing out each run). Root cause: 26 accumulated `node`/`vite`/`python3` processes left running from this very long session's own earlier manual verification steps (orphaned dev servers on ports 3001/5174 never killed after use), starving CPU for the real-`spawnSync`-based envelope tests. Killed the orphaned processes; 3 consecutive fresh `pnpm --filter api-server test` runs afterward were clean at 262/262 — confirmed environmental, not a solve.py regression, before marking Task 7 done.
- Full gate re-verified fresh, myself, after cleanup: typecheck clean, 262/262 api-server (3 consecutive clean runs), 252/252 studio, 67/67 solver pytest (includes the new `test_two_echelon.py`), `e2e_accuracy.py` 102/102 unmodified.
- **Deployed and live-verified for real**: both `nos-api` and `nos-studio` redeployed to `f5cac22` (Render's autoDeploy webhook didn't fire within ~50s of the push for either service — manually triggered via `mcp__render__trigger_deploy` rather than waiting further). Live checks run directly against production, not just locally: `GET /api/models` lists all 4 models; a real registered user/scenario/solve/poll cycle against `two-echelon-gold-au` on the deployed server reproduced the notebook's exact ground truth (objective `386576.99`, Cunnamulla, refinery→customer avg `687.6` km); `DELETE` on that solved scenario returned `204` then `404` (confirms the solve_jobs FK fix live on the new model too); `nos-studio`'s SPA-fallback rewrite serves `200` on the new nested route `/chapter-10/gold-refinery`, not just root (per this file's own existing gotcha about root-only checks missing rewrite regressions). Test scenario and live cookies cleaned up after.
- **Known gaps, not yet closed**: `e2e/two-echelon.spec.ts` has never actually been run (written against the local dev-proxy setup, not production); no real-browser interactive check of the BOM slider/leg-colored routes/per-leg panel (curl/API-level verification only) — chapter stays `hiddenFromLanding` until one happens.

**Post-Chapter-10 bug-fix/UX rounds** (2026-07-25/26, one extended session, user-driven bug reports against the live deployed app rather than a written plan). `two-echelon-gold-au` was un-hidden from Landing (`a0841d5`) at the very start, so every round below was found via real usage of the live model, not code review. Each round: full gate green (typecheck, api-server, studio; solver pytest only re-run when Python actually changed) before commit, then `git push` + manual `trigger_deploy` for both `nos-api`/`nos-studio` (Render's autoDeploy webhook did not fire on its own for **any** push this entire session — always required a manual trigger) + live verification via `claude-in-chrome` against production where feasible.

- **Round 1** (`2c6e65c` fix + `b996223` docs) — Chapter 10 parity gaps, all instances of the same root pattern: a per-model `modelId === "..."` allowlist/ternary that was extended for `transport-coal` in a later task but never for `two-echelon-gold-au`. Header title fell back to "Al's Athletics" (fixed: derive from `chapters.ts`'s `CHAPTERS` lookup, `chapterForModelId()`). Refinery import/export didn't exist (`refineries` is the first entity with a status column and *no* value column at all — generalized `services/import.ts`'s column indexing beyond the "always one value column" assumption; `modelId` now disambiguates the `customers` entity name shared between p-median-us's 200-row and two-echelon's 10-row dataset). Map multi-select excluded two-echelon entirely. Left-panel "Warehouses to open (P)"/"Warehouse capacity" sections had **no model gate at all** and rendered nonsensically for every model — first pass wrongly scoped this to `p-median-us` only and broke `p-median-brazil` (which also has P), caught by `Studio.test.tsx`. Added `WarehouseCandidate.kind: "mine" | "facility"` (OpenAPI + codegen) so the frontend can distinguish the one non-overridable mine from the two overridable refineries sharing the `dataset.warehouses` array. `b996223` generalized the lessons into `model-integration-precheck.md`'s Gate 1 (eight registration points → ten: #9 override-entity registration, #10 map multi-select allowlist) plus a 6th row on the quick-reference silent-failures table — this bug class is now a documented checklist item for the next model, not just a one-off fix.
- **Round 2** (`8a6d993`) — Root-caused "changing BOM ratio doesn't change the result": **not** a solver bug (verified `solve.py` directly picks Cunnamulla at `bom=1.0`, Daggar Hills at `bom>=1.5`). `handleSolve` fired `POST /solve` (which solves whatever's already persisted — "DB row is the source of truth") without saving a dirty `localConfig` edit first, so any unsaved slider drag was silently discarded and Solve just re-ran the stale saved inputs. Fixed by saving first when dirty, then solving — a universal fix, not BOM-specific. Also: mine=star/refinery=triangle icons (`WarehouseCandidate.kind`-keyed); `computeAutoBands()` fits distance bands to the solved result's actual edge distances instead of a static per-model default (still freely re-editable after, per E1.1); `ObjectiveBar` (the bar under the main header) was a **leftover gamified "Beat X mi" goal box** from before the Phase 1 de-gamification pass, with a hardcoded `MODEL_TARGETS` table that had no entry for two-echelon (same header-ternary bug class as Round 1) — replaced with a neutral summary sourced from `chapters.ts`; left panel widened 220→253px; export/import buttons relocated from inside each model's Overrides section into one toolbar above the map.
- **Round 3** (`552542c`) — `ObjectiveBar` gained each model's teaching-intent description (`chapters.ts`'s existing `description` field) alongside chapter/title/scenario-name. Root-caused Chapter 10 showing the **continental US map**: `react-leaflet`'s `<MapContainer>` applies `center`/`maxBounds`/`minZoom` only at construction — not reactive props. `GET /api/models` (source of `countryBounds`) and `GET /dataset` are independent queries with no ordering guarantee; if dataset resolves first, `NetworkMap` mounts with the US fallback baked into an immutable `maxBounds`, and `FitBounds`'s later `fitBounds()` call can't override it (`maxBoundsViscosity=1.0` clamps back). Fixed by keying `<MapContainer>` on the resolved bounds so React force-remounts it once real data lands — 2 regression tests prove the remount happens on bounds resolution and does *not* happen on unrelated re-renders. Distance-band coverage (`lib/bands.ts`) changed from cumulative to **exclusive** (each band excludes flow already counted toward a lesser band) per explicit request. Map multi-select gained a "Restrict solver to selection" bulk action (forces the selection open/active, everything else of that type inactive/excluded, computed as one atomic override update — two sequential `bulkUpsert*` calls in the same handler would each read the same stale `localConfig` closure and the second would silently clobber the first); "Cancel" relabeled "Deselect all".
- **Round 4** (`1eae422`) — `CONSTRAINTS` (the "Constraints · model-defined" panel) had no `two-echelon-gold-au` entry either (same header-ternary bug class, 3rd occurrence) — silently fell back to p-median-us's list ("Open exactly P facilities" for a model with no P). Added the model's real constraints matching `solve_two_echelon` exactly. BOM ratio slider: step 0.1→0.05, range narrowed to 1.05–2.0 (min deliberately stays *just above* 1, not exactly 1.0 — `twoEchelonInputsSchema` requires `bomRatio` strictly `> 1`, and Round 2's silent-save-failure fix means hitting that boundary would otherwise 422 silently again). `NetworkMap` hover tooltips were gated on `isOpen`, so a "potential" candidate (most markers, especially pre-solve) or the fixed mine (never in `openWarehouseIds` — it's not a facility-location choice) showed nothing on hover at all; now unconditional. Legend gained a "Mine (fixed)" entry (only rendered when the dataset has one). **Root-caused and fixed a real missing-route bug**: the route-pane resolved every edge's `toId` against `dataset.customers`, which works for every single-echelon model and two-echelon's own refinery→customer leg, but a `mine_to_refinery` edge's `toId` is the *refinery* — a warehouse-role entity never in `dataset.customers`. The lookup always failed and silently dropped that polyline; with routes shown, the map only ever drew refinery→customer lines, never the mine→refinery backbone. The *existing* M4.2 test had accidentally masked this by duplicating the refinery id into its `customers` fixture too — added a second regression test using the real (non-duplicated) dataset shape.
- **Round 5** (`3b45c8f`) — Page-back button now navigates to Landing (`"/"`) deterministically instead of `window.history.back()` (whose destination is unpredictable). Result-history back/forward beside Solve (a session-local, non-persisted stack of `{result, inputs}` pairs per scenario, since the DB only ever keeps the latest) is now always visible (was gated on 2+ results) and restores the *respective inputs* on navigation, not just the output. **Executed via `mcp__glm__glm_agent`** (fully-specified diff — GLM as executor, not designer) at explicit user instruction; caught and reverted one real deviation on review before landing: GLM's draft also synced `localConfig`/`savedConfig` on *every* arriving result (not just explicit back/forward clicks) to make its own added test pass — this would have let a background refetch (e.g. window-refocus) silently clobber a genuinely in-progress unsaved edit. Removed; only explicit navigation restores a historical entry's inputs now, matching what was actually asked for. Session ended with a stale-tab login expiry blocking live click-through verification of this specific round — landed on strong automated coverage (298/298 studio, dedicated tests for both behaviors) instead; flagged to the user rather than claimed as live-verified.
- **Known gap carried forward**: none of these five rounds re-ran `e2e/two-echelon.spec.ts` or `e2e_accuracy.py`/`e2e_journey.py` — no Python/solver code changed in any of them, so the pytest gate was skipped by design each time (documented per-round), but the two standalone e2e scripts remain unexecuted since Chapter 10 shipped.

**SCN v0.3 — Tabbed Workspace & Scenario-Local Network Edits** (`docs/superpowers/plans/2026-08-20-scn-v0.3-workspace.md`). New `/workspace` shell (tabbed, manual-Save-only) alongside the existing Studio/Compare pages, plus the ability to add warehouses/customers/mines/stations/refineries not in the base textbook dataset and override individual pairwise distances/costs — all scoped to one scenario's `inputs` JSONB, base dataset files under `solvers/*/dataset/*.json` never mutated (DD-1). Executed via `subagent-driven-development` (fresh implementer + independent task reviewer per task, ledger-tracked) across two git-worktree phases, both with a clean final whole-branch review before merge.

- **Phase A (Workspace Shell)** — merged to main at `7888c48`. New `Workspace.tsx` shell, `SidebarTree`/`TabBar`/`SolveDialog`/`StaleOutputBanner`, per-model input tabs (`WarehousesTab`/`CustomersTab`/`OptimizationParametersTab`/`OutputMapTab`/`MinesTab`/`StationsTab`), `lib/workspaceTabs.ts`/`lib/exportEntity.ts`. Two standing architectural decisions locked in via `AskUserQuestion` after real bugs/ambiguity surfaced, binding for everything after: **manual-Save-only** (no auto-save/debounce — a debounce draft was found to silently lose a pending edit on scenario-switch/unmount) across every input tab, and **tabs-only content layout** (no persistent split-view map — the wireframe's "Input Map"/"Output Map" are tabs, confirmed against the actual screens over the plan's own ambiguous prose). 11 tasks, 1 fix cycle, final whole-branch review: Ready to merge.
- **Phase B (Scenario-Local Network Edits)** — merged to main at `dc5d970` (branch `scn-v0.3-phase-b` deleted post-merge). `addedWarehouses[]`/`addedCustomers[]`/`distanceOverrides[]` built from scratch for p-median-us first (B1.1-B5.2: schema → id↔index bridge → solver merge → semantic precheck service → composite-key `distances` import/export entity → add/delete-row grid UI), then fast-followed to the other 3 models: `p-median-brazil` (B6.3, straight port — already ID-keyed, backend/solver-only since no dataset-browsing endpoint exists for this model's frontend), `transport-coal` (B6.1, `addedMines`/`addedStations`/`laneCostOverrides` built from scratch, full stack including frontend), `two-echelon-gold-au` (B6.2, `addedRefineries`/`addedCustomers`/`distanceOverrides` for its 3-entity/2-leg shape, full stack including frontend). 20 tasks total, 3 fix cycles, 2 standing open-product-questions resolved (customer `state` field added to all 3 relevant schemas; `capacityMode="none"` made genuinely uniform across all 3 capacity sources). Final whole-branch review (28 commits, `7888c48..5549eff`): **Ready to merge, no Critical/Important findings** — cross-model consistency independently re-verified (not just trusted from per-task claims), `e2e_accuracy.py` re-run fresh at 102/102 unmodified despite 5 separate tasks touching solver code, hard rules 5/6/DD-8 all confirmed holding branch-wide. 5 Minor follow-ups noted, none blocking (two-echelon's added-customer id-collision check asymmetric with its added-refinery check; CSV bulk-add-mode not extended to two-echelon's refineries/customers; two cosmetic style-drift items; pre-existing untouched-by-this-branch test gaps).
- **Recurring bug class caught and closed twice more this branch** (same pattern as Chapter 10's Rounds 1/2/4: a shared component's added-section/gate extended for one model but not its sibling) — `CustomersTab`'s added-section (B5.2) and `WarehousesTab`'s added-section (B6.2/Refineries) both needed a capability-based gate (`onAdded*Change != null`) instead of an entity-name gate, so they don't leak a silently-broken form into a model that never wired the callback. `model-integration-precheck.md`'s Gate 1 checklist (10 points) was run explicitly at every new entity/model registration point across this branch (B4.1, B6.1, B6.2) — this is now this repo's most-documented recurring bug class across two separate features (Chapter 10 and SCN v0.3), not a one-off.
- **Task #25** (a genuine one-line gap, not part of any task's original scope) — p-median-us's `reset-to-baseline` branch cleared `warehouseOverrides`/`customerOverrides` but never picked up B1.1's `addedWarehouses`/`addedCustomers`/`distanceOverrides`, even after transport-coal's (B6.1) and two-echelon's (B6.2) own reset branches got the equivalent fields. Fixed directly (no dispatch — trivial, mechanical, precedent already proven twice).
- **Phase C (Outputs & Reporting, p-median-us pilot)** — merged to main. First phase executed via the **agent team** (parallel role-based dispatch: `backend-engineer`/`frontend-engineer`) per explicit user instruction, replacing the sequential `subagent-driven-development` loop Phases A/B used — see `docs/superpowers/specs/2026-08-24-scn-v0.3-phase-c-team-execution-design.md` and `docs/superpowers/plans/2026-08-24-scn-v0.3-phase-c-outputs-reporting.md`. Four new output grid tabs (Open Warehouses/Customer Assignments/Cost Summary/Service Stats) deriving from the already-solved result envelope, a Reports tab (`pickBaseline` DD-3, cost breakdown vs baseline, service-level as a **cumulative** rollup computed only at the Reports layer on top of `lib/bands.ts`'s still-exclusive semantics, warehouse utilization), scenario compare folded into that same Reports tab (reusing `compareDiff.ts`/`useCompareScenarios`), a client-side result-history stepper with "Save as scenario" (DD-7, rides `result_cache`), and a research spike (decision doc, `html-to-image` recommended) for a later clipboard-copy task. 8 tasks + 1 review-driven fix, real dispatch-sequencing deviation from the design doc noted and applied (only 3 of 8 tasks were genuinely file-disjoint enough to run concurrently — `Workspace.tsx`/`ReportsTab.tsx` ownership forced the rest sequential). Zero fix cycles mid-execution (every task's own gate passed clean first try) but 2 real deviations from the plan's own guessed code were caught and correctly resolved by the orchestrator *before* dispatch (an OpenAPI/codegen dependency the plan wrongly assumed didn't exist; the real solve-success→result-history wiring shape, since the plan's sketch assumed a `latest` variable that doesn't exist — solve completion only invalidates a query, the fresh result arrives async on a later render). Final whole-branch review: Ready to merge, no Critical findings, 1 Important finding (the history stepper restored inputs on step but no output view reflected the stepped-to result — `Studio.tsx`'s own already-shipped stepper had solved this correctly via a derived `result` variable that Task 6's port omitted) fixed before merge via a dedicated `displayedResult` derivation mirroring `Studio.tsx:475-478` exactly. Gate green: typecheck, 550/550 api-server, 654/654 studio. No Python touched (zero solver/`merge_inputs.py` changes) — `e2e_accuracy.py` correctly not re-run. Explicitly deferred (not part of this plan, each needs its own follow-up): C4.2 (clipboard implementation, now unblocked by the spike's decision), C6.1 (fast-follow all of Phase C to `transport-coal`/`two-echelon-gold-au`/`p-median-brazil`).
- **C6.1 (Outputs fast-follow to all 4 models)** — merged to main. `docs/superpowers/specs/2026-08-24-scn-v0.3-phase-c-c61-fastfollow-design.md` + `docs/superpowers/plans/2026-08-24-scn-v0.3-c61-outputs-fastfollow.md`. Real finding that shaped the design: unlike Phase B's Brazil carve-out (forced by a missing `GET /dataset` entry the *input* override tables need), the output tabs take only `{result, scenarioId}` — no dataset dependency — so Brazil's missing dataset endpoint doesn't block its output tabs at all; this fast-follow gives Brazil full parity, closing a real gap rather than repeating the input-side carve-out. New `capabilities.outputGrids: string[]` manifest field replaces a hardcoded `modelId !== "p-median-us"` gate on both the backend export route and the frontend tab-gating — the single most-documented recurring bug class in this repo (a shared component's per-model gate updated for one model, forgotten for a sibling, hit 5+ times) closed by construction: p-median-us/brazil get `[openWarehouses, assignments, costSummary, serviceStats]`, transport-coal gets `[flows, costSummary, serviceStats]` (no facility-location concept, Flows IS its assignment view), two-echelon gets all 5 (its `mine_to_refinery`/`refinery_to_customer` `Edge.leg` values map 1:1 onto Flows/Customer Assignments). New `flows` export entity + `FlowsTab.tsx`. 4 tasks executed via the agent team, 2 genuinely parallel (Task 1 manifest/contract, Task 3 `FlowsTab` — zero file overlap) then 2 sequential (Task 2 backend route depends on Task 1, Task 4 frontend wiring depends on all three). Zero fix cycles — every task's gate passed clean first try — but **two independent validation layers gate `capabilities`, and a real THIRD layer surfaced mid-execution**: `lib/dataset-schema`'s Zod schema (silently strips unknown fields, no error) and `openapi.yaml`'s `ModelInfo.capabilities` schema were both updated in Task 1 as anticipated, but Task 2 found `openapi.yaml`'s *separate* `exportScenario` endpoint's `entity` query-param enum also needed `"flows"` — a location neither the design doc nor Task 1 anticipated, one layer deeper than either prior task's own notes flagged. Caught and fixed correctly (spec+codegen same commit, hard rules #1/#4/#8). Final whole-branch review: Ready to merge, no Critical/Important findings — all three validation-layer fixes independently re-verified as genuinely regenerated (not hand-edited), the grid-to-model mapping hand-traced correct for all 4 models, backend/frontend flow filters confirmed character-identical, `buildOpenWarehouseRows`'s two-echelon "Open Refineries not Open Mines" behavior confirmed via a specific test exercising the real unmocked model registry, zero Python touched, ownership-before-dispatch ordering intact. 2 Minor findings, one fixed immediately (a stale p-median-us-only code comment), one left as a genuine follow-up (the sidebar shows all 5 output entries per model regardless of `outputGrids`, unsupported ones just placeholder — matches Phase C's own existing behavior, not a regression, but the sidebar itself was never scoped to read the capability list, only `renderTabContent` was). Gate green: typecheck, 556/556 api-server, 661/661 studio. No Python touched — `e2e_accuracy.py` correctly not re-run. Explicitly still deferred: C4.2 (clipboard implementation).
- **C4.2 (Copy Map to Clipboard implementation)** — merged to main. `docs/superpowers/specs/2026-08-24-scn-v0.3-c42-clipboard-copy-design.md` + `docs/superpowers/plans/2026-08-24-scn-v0.3-c42-clipboard-copy.md`, implementing the already-completed spike (`docs/superpowers/specs/2026-08-24-copy-map-clipboard-spike.md` — `html-to-image`, eager-capture Clipboard API pattern for Safari/WebKit bug #222262). New `lib/copyMapToClipboard.ts` (`captureMapAsBlob`/`copyMapToClipboard`/`downloadMapAsPng`/`isClipboardImageWriteSupported`) + "Copy to clipboard"/"Download PNG" buttons on `OutputMapTab.tsx` (shared across all 4 models — both its `useBrazilMap` and main `NetworkMap` render branches wired via one shared `copyDownloadButtons` JSX const, avoiding yet another instance of this repo's most-documented recurring bug class). Real finding that simplified the design: the map container div was already isolated from the toggle-checkbox row (two sibling divs, not nested), so no `filter` option was needed to exclude UI chrome from the capture — an open question the spike had explicitly left for this task to resolve. 2 tasks via the agent team, strictly sequential (Task 2 imports Task 1's module), zero fix cycles at dispatch time. Final whole-branch review: Ready to merge, no Critical/Important findings — the eager-capture shape (unawaited `Promise<Blob>` passed directly into `ClipboardItem`'s constructor, `write()` called synchronously) independently re-verified against real code via a genuinely non-tautological test, both render branches confirmed wired, feature-detection confirmed one-time not per-click. 3 Minor findings, two fixed immediately: the copy-failure fallback was re-running the full `html-to-image` capture a second time instead of reusing the blob already captured for the clipboard attempt (fixed — hoisted the capture promise once, reused for both the `ClipboardItem` and the download fallback, closing the exact slow-path this feature exists to make fast on Safari); `handleDownload` had no failure toast unlike `handleCopy` (fixed, plus closed an unhandled-rejection edge case in `handleCopy` itself for a genuinely-double-failing capture). Third Minor (a `pnpm-lock.yaml` regen dropping `cpu: [arm64]` from 3 unrelated native-binding entries) spot-checked with `pnpm install --frozen-lockfile` — passes clean, confirmed benign, no fix needed (directly informed by this repo's own prior lockfile-breaks-Docker-build incident, so this was checked rather than assumed). Gate green: typecheck, 556/556 api-server (unaffected — pure frontend change), 675/675 studio, `--frozen-lockfile` clean. No Python touched — `e2e_accuracy.py` correctly not re-run. **All of Phase C (pilot + C6.1 fast-follow + C4.2) is now complete.**
- **SCN v0.3 Phase 3.1 — SCN Design Wireframes theme applied to Workspace.** `docs/superpowers/specs/2026-08-24-scn-v0.3-phase3.1-design-system-design.md` + `docs/superpowers/plans/2026-08-24-scn-v0.3-phase3.1-design-system.md`. Source: `/Users/shubhamkr/Downloads/SCN Design Wireframes/styles.css` (real design tokens behind the 5 annotated screens that originally specified the tabbed-workspace layout) — took three rounds of user clarification to locate the real source (two meta-prompt PDFs and `SCN Design.pdf` were each proposed and rejected first; that PDF has no real color palette, `styles.css` is the actual deliverable). New scoped `.scn-theme` CSS class in `index.css`, applied only to `Workspace.tsx`'s root shell div — mirrors the existing `.studio-lab` scoping precedent so Landing/auth/Studio.tsx/Compare.tsx stay on today's styling untouched (Workspace-only was an explicit user scope decision). Retargets the same HSL custom-property names the existing shadcn `@theme inline` system already reads (`--background`/`--primary`/`--muted`/`--sidebar-*`/etc, converted from the wireframe's hex tokens) plus `--radius: 0rem` (literal sharp corners everywhere in scope — an explicit user decision to take the wireframe's own "components are wireframe objects" override block literally, not its softer `--radius-sm/md/lg` 2/4/7px tokens). New `--app-font-heading`/`font-heading` Tailwind utility (Barlow Condensed, wireframe's heading font) added alongside the existing `--app-font-sans/serif/mono` pattern, applied to the Workspace app-name, the "Run Optimizer" dialog title, and all four Reports-tab section headings; body text within `.scn-theme` switches to Barlow. Deliberately did not touch the base `--spacing` token (wireframe's 3.4px-based scale vs Tailwind's existing 4px-based one — changing it would silently reflow every already-tuned padding/gap app-wide for a difference too small to be worth that risk). One agent-team task (frontend-engineer, dispatched in an isolated worktree — no parallelism to leverage since this was a small, tightly file-coupled reskin, not a case where the agent-team model's parallel dispatch applied), diff verified byte-for-byte against the plan's literal before/after code before merging. Gate green: 677/677 studio, typecheck clean. Live-verified via `claude-in-chrome` against local dev servers (fresh registered test account, real solve run) — pre-flight file reads during plan-writing had already confirmed `WarehouseTable.tsx`'s status vocabulary (Potential/Fixed-Open/Inactive), `SolveDialog.tsx`'s "Run Optimizer" title, `StaleOutputBanner.tsx`'s copy, and `ReportsTab.tsx`'s four sections all already matched the wireframe's structure exactly — so this phase was theming-only, no structural rework needed; the live check confirmed the new palette/radius/fonts render correctly (Barlow Condensed visibly narrower on headings, square corners on buttons/inputs/dialogs/segmented controls, correct blue-gray accent tone) with zero further fixes required. **Found and fixed as a follow-up commit (`5db532a`):** Reports tab's Warehouse Utilization bars displayed nonsensical values like "10000%"/"7800%"/"9200%" — `solve.py`'s `utilizationByNode[].utilization` is already a 0-100 percent (`min(100, round(demand*100/capacity))`), but `ReportsTab.tsx` and `OpenWarehousesTab.tsx` both multiplied it by 100 again. `Studio.tsx`'s own utilization display already used the value directly (no `*100`), confirming this was frontend-only, not a solver contract mismatch. Both files' test fixtures had encoded the same wrong assumption (fractional `utilization` values, e.g. `0.41`) — corrected to real 0-100 percents (`41`) in the same commit. 677/677 studio, typecheck clean. No Python touched.
- **SCN v0.3 Phase 3.2 — table columns, Input Map, removals, renames.** `docs/superpowers/specs/2026-08-26-scn-v0.3-phase3.2-ui-changes-design.md` + `docs/superpowers/plans/2026-08-26-scn-v0.3-phase3.2-ui-changes.md`. Both the design spec and the implementation plan went through explicit user review rounds (5 + 13 findings respectively) before execution — every finding verified against real code first, then fixed in the doc; two real cross-track file collisions were found this way (Task 1 vs. Task 3's shared `openapi.yaml` edits; Task 3 vs. Task 4 both needing `MinesTab.tsx`/`StationsTab.tsx`), reshaping the plan's sequencing from "5 independent tracks" to 3 waves with explicit checkpoints and one forced-sequential wave — executed via the agent team (backend-engineer × 3, frontend-engineer, qa-sdet), each task in its own isolated worktree, cherry-picked and gate-reverified by the controller before merging, matching this session's established pattern.
  - **Task 1** (`c045548`) — removed `POST /scenarios/compare` + `POST /scenarios/:id/reset-to-baseline` (routes, spec, codegen, tests), `Compare.tsx` page, `compareDiff.ts`/`pickBaseline.ts` (both confirmed orphaned once their two real consumers were gone), Reports tab (frontend only), and Reset-to-Baseline everywhere including `SidebarTree.tsx`'s hover icon and Studio.tsx's own copy (explicit "remove everywhere" scope, not the usual "leave Studio.tsx alone" default). Renamed "Cost Summary" → "Solution Summary" (both the sidebar label and `CostSummaryTab.tsx`'s own separate in-tab heading — a real gap the plan-review round caught) and the app title → "SCND Optimization Studio" / "By Prof. Michael Watson" (4 spots, including `index.html`'s two different string formats — em-dash in `<title>`/`og:title`, comma in `description`).
  - **Task 2** (`56db313`) — one-time reverse-geocode script (`scripts/src/fetch-postal-codes.ts`, Nominatim, 1 req/sec) adding real US zip codes (p-median-us, transport-coal) and Australian postcodes (two-echelon) to the base dataset JSON — 254 hits / 3 genuine misses / 0 failures across 257 rows. Built with real failure classification (timeout/rate-limit ≠ genuine miss, retried with backoff, aborts below an 85% coverage floor) and true per-row atomic persistence (temp-file + rename after every row, not once per file) — both fixed during the plan-review round after an earlier draft only had a happy-path loop. Recomputed `version.json` sha256/version for all 3 touched packages; also had to update a hardcoded expected-hash string in `lib/dataset-schema/src/index.test.ts` the plan review caught was about to go stale.
  - **Task 3** (`6191b70`) — threaded `zip` through 3 real plumbing layers found necessary by re-reading the actual loader chain (dataset-schema Zod schemas silently strip unknown keys by default; `transportCoalDataset.ts`/`twoEchelonDataset.ts` explicitly rebuild rows from a fixed field list, dropping anything not named; `dataset.ts`'s own local `WarehouseCandidate`/`Customer` interfaces are separate from the generated OpenAPI types of the same name) plus the OpenAPI schema itself. Added City/State split + Latitude/Longitude + conditional Zip columns to all 4 base-dataset tables (`WarehouseTable`/`CustomerTable`/`MineTable`/`StationTable`) — all 4 previously merged City/State into one cell and dropped lat/lng entirely despite the data already being present, the exact same latent bug in all 4 in parallel. Scope expanded mid-plan-review to also cover `MinesTab.tsx`/`StationsTab.tsx`'s own separate (identically-named-but-different) local row types, and all 4 "Added X" inline tables (a genuinely different table from the base one, confirmed by reading the code — no Zip column there, added rows are never geocoded per DD-1).
  - **Task 4** (`93a524a`) — new `InputMapTab.tsx`: pre-solve map (p-median-us/transport-coal/two-echelon, not Brazil) showing current entities as pins, click-to-place with an explicit draft-marker + Confirm/Cancel step (rendered in the component's own JSX, not inside a Leaflet `<Popup>` nested in a `<Marker>` — confirmed via `NetworkMap.tsx`'s own existing workaround that a nested Popup stays closed until clicked, which would have made the plan's original design invisible without an extra click). Confirm reuses the real, already-existing `openTab()` function and each `*Tab.tsx`'s existing add-form plumbing (`prefillCoords`/`onPrefillConsumed`) — no new data path. Post-Save precheck toast redesigned mid-plan-review to track a scenario-scoped list of pending watches and `await` a real `fetchQuery` for fresh precheck data, replacing an earlier design that read a stale closure the instant Confirm fired (precheck data is keyed to the *saved* state, which doesn't exist yet at that moment). Also corrected: two-echelon's "Distances" sidebar label actually renders a different component, `LegDistancesTab.tsx`, not `DistancesTab.tsx` — both (plus `LaneCostsTab.tsx`) got the new `focusEntityId` prop for the toast's "jump to it" action.
  - **Task 5** (`66769f9`) — `Workspace.TabCoverage.test.tsx` (RTL sweep, every tab × 3 models) + `e2e/tab-coverage.spec.ts` (real Playwright run against real local dev servers, not just written-but-unexecuted — confirmed real `DELETE` calls via server log grep for the disposable-scenario cleanup). Found and fixed 2 real bugs in its own spec while running it for real: `Output Map` is genuinely disabled until a solve exists (was clicking it blind); a `.toFixed(4)`-rounded preview string was being compared against a full-precision input value. Corrected acceptance check (a plan-review finding): a map-added row is verified for City/State/Lat/Lng in the *Added* table, not for a Zip value it can never have.
  - Every task's own gate re-run by the controller after cherry-picking, on the fully merged state, not trusted from the dispatched agent's own report alone. Two agents (Task 3, Task 4) self-reported accidentally editing the shared main checkout instead of their assigned worktree mid-task, caught it themselves via `git status`/`git worktree list` returning empty, and restored the shared checkout to byte-identical pristine before redoing the work correctly in their own worktree — verified independently by the controller (`git status` clean) before proceeding each time. Final combined gate: typecheck clean, api-server 539/539, studio 648/648, dataset-schema 7/7, solver pytest 131/131, `e2e_accuracy.py` 87/87 unmodified (re-run despite the "frontend phase" framing, since Task 2 touched base dataset JSON). One real environmental flake hit twice at Checkpoint 2/final-gate time — root-caused (not just assumed) to leftover orphaned `vite`/`pnpm run dev` processes from Task 5's own real Playwright run plus an older session, confirmed via `ps aux` before killing them; clean on every re-run after.
  - Live-verified via `claude-in-chrome` against local dev servers post-merge: rename correct in the tab title and header, Reports section gone, Input Map present with real pins, full click→draft-marker→Confirm→prefilled-form→unsaved-toast flow works end-to-end, base-table Zip columns show real data (ALN→18101, ATL→30303, etc.), Reset-to-Baseline icon gone from the scenario row (only rename/clone/delete remain).
- **`artifacts/api-server/src/__tests__/resultEnvelope.test.ts`'s Brazil case is a known-flaky, pre-existing, environmental test — not a regression, seen again during Phase C's merge verification.** `p-median-brazil (capacitated_pmedian) emits an envelope that validates against the shared schema` occasionally fails with `Test timed out in 5000ms` when the full `api-server` suite runs (vitest's parallel workers spawning several real `python3 solve.py` subprocesses concurrently can starve this one, heavier Brazil P=5 capacitated solve past its fixed timeout) — confirmed via `npx vitest run src/__tests__/resultEnvelope.test.ts` in isolation, which passed in 1.2s, well under the 5s limit. Matches the exact flake class already diagnosed and closed as environmental during Chapter 10's session (this file's own "Flaky `resultEnvelope.test.ts` timeouts" note above) — same root cause (subprocess-heavy tests + CPU contention from concurrent workers), different trigger (this time genuinely just vitest's own parallelism, no leftover orphaned dev-server processes found). Not fixed as part of Phase C (out of scope — Phase C's diff touches zero Python/`resultEnvelope.test.ts`); if this becomes disruptive, the real fix is either a longer per-test timeout for this specific subprocess-heavy test or serializing this file's tests (`sequential: true` in its vitest config), not chasing it as a code bug.

**SCN v0.3 Bundles — post-Phase-3.2 Workspace UX polish (2026-08-27 → 2026-09-02).** A user-driven series of "bundles" refining the tabbed `/workspace` (routed at the chapter paths — `/chapter-3` etc. with `workspace: true` in `chapters.ts`, NOT `/workspace`, which 404s). Each bundle ran the full brainstorm → spec → plan → **agent-team** build → review → merge-to-local-main → push → Render deploy → live-verify pipeline. Spec/plan docs live under `docs/superpowers/specs|plans/2026-09-0*`. All merged to local `main` first (docs re-merged after each review round), commits pushed to origin.
- **Bundle 1 (R1-R9 Workspace UX)** — `2ee91eb`. Nine workspace UX refinements (e.g. R2: excluded customers rendered dim-but-visible in the demand scale rather than hidden).
- **Input Map v2 (map-first editing)** — merged across `98bad28`/`1801ce0`/`8bfb304`/`d957d6b`. Click-to-place entity creation on the input map (`CreateEntityDialog` with an explicit draft-marker + Confirm step, rendered in the component's own JSX — a nested Leaflet `<Popup>` inside `<Marker>` stays closed until clicked), plus in-map edit/move/copy/delete via `MapDetailsCard` (left-click) → `MapActionMenu` (right-click).
- **Bundle 2 (Input Map v2 + R1-R9 fast-follow to all models)** — `29e32ea`. Full v2 editor + the p-median-only R1-R9 UX fast-followed to transport-coal / two-echelon / Brazil. Green demand bubbles all models; Brazil R7 migrated onto `NetworkMap`; **two-echelon distance unit relabelled km→mi with ZERO data change** (the Ch-10 notebook mislabels geographically-miles values as km; relabelling preserves the golden objective `386576.99`). T9 added Brazil CSV import/export. New TS-side distance estimators for added entities (`services/autoDistance.ts`: `R_MI=3959`, circuity two-echelon r→c `1.17910`, Brazil/transport `1.17`) — only touch added-entity rows, so `e2e_accuracy` 87/87 holds.
- **Bundle 2.1 (5 UI tweaks)** — `745597e`. Unhid Ch5 models + hid Ch10 on Landing; Output Map floating metric overlay (Objective + Weighted-avg-distance, top-right, follows the displayed result); "Al's"→"AL's" (Ch3); centered chapter+summary header block; header divider clears the Save/Run buttons (`min-h-14`).
- **Tile fix** — `dc4e58f` (→ deployed `bbb8cc1`). CARTO now key-gates `basemaps.cartocdn.com`, serving an "API Keys Required" watermark tile to anonymous traffic (hit the Brazil/Australia maps). Swapped all 5 `<TileLayer>`s (NetworkMap + 4 InputMapTab modes) to keyless OSM standard (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`).
- **Bundle-2 cleanups** — `322587a`. Removed dead legacy/placeholder Input Map modes; gated `CreateEntityDialog`'s capacity field; `projectsAddedEntities`→`true`.
- **Bundle 2.2 (Workspace UI updates — 15 items)** — merged `92f8561`, deployed. Executed via the **agent team** as 12 tasks (T0-T11) in 3 waves, using a **two-lane concurrency model** (backend=`api-server`/`lib` ⊥ frontend=`studio` — separate build graphs, so file-disjoint tasks in the two lanes run concurrently without corrupting each other's `vitest`/`tsc`) plus **single-writer serialization** for shared files (`Workspace.tsx`→T9 only; `openapi.yaml`→T2 only; `manifest.json`/`ManifestSchema`→T0 only; `InputMapTab.tsx`→T3 then T8). Per-commit-green kept by the **optional-props pattern**: leaf tasks (T6/T7) add new props as optional-with-safe-default so their commits typecheck standalone, and T9 (the single `Workspace.tsx` writer) wires the real props at the call sites. The 15 items:
  - **1** global `© Developed by hx1` footer (`components/AppFooter.tsx`, `FOOTER_H=24`, mounted in AppShell/Workspace/Login/Register). **13/14/15** Workspace header rework: removed the "SCND Optimization Studio" title/subtitle; scenario selector → left corner; full untruncated chapter+summary centered (`grid-cols-[auto_1fr_auto]`, `<md` stacks the 3 zones); email+Logout → top-right; result-history stepper + Save + Run-Optimizer cluster unmoved.
  - **2/3** Input-map layer toggles → shadcn `Checkbox` (all 3 toolbars; place-pin stays buttons); `MapLegend` hides swatch groups for toggled-off layers. **4** new "Size customers by demand" toggle (input maps only, default ON; OFF → fixed `FIXED_CUSTOMER_RADIUS=6` for every demand-bearing role incl. transport stations). Two-echelon fixed mine now hides with the Refineries layer.
  - **5** Utilization column in Open Warehouses hidden when the snapshot `capacityMode==="none"`. **6** sidebar output entries gated by manifest `capabilities.outputGrids` (Flows disappears for p-median-us). **8** Solution Summary moved to 2nd (after Output Map). **11** Open Warehouses + Customer Assignments render user-created warehouses' display **ID** (not `aw-` uid), from the `displayedInputs` snapshot (`addedWarehouses ∪ addedRefineries`).
  - **7** Distances tab "Base distances (reference)" table via a **new model-scoped immutable endpoint** `GET /models/:id/reference-distances` (unauthenticated like `/dataset`/`/models`; explicit `ETag` from dataset version/hash + `304` revalidation since `app.set("etag", false)` is global; `422` for a known-but-unsupported model; gated by new `capabilities.supportsReferenceDistances`). New TS loader (`data/referenceDistances.ts`, ordinal→index via `SOLVERS_ROOT`); `@tanstack/react-virtual` windowing; **client-side view filter** against live `localInputs` (base data is status-independent, so filtering is a pure view concern — endpoint returns the complete 5200-pair matrix, client hides inactive-WH/excluded-CS rows instantly, no refetch). **9** Solution Summary compare mode gained an open-facility-set **by city name** row after Weighted-avg-distance (reuses mine-safe `openFacilityIds()`, gated on `supportsFacilityStatus` not `supportsP`, cities via `useGetDataset` ∪ each column's persisted `addedWarehouses`/`addedRefineries`). **12** Output-map route polylines gained a translucent hover `<Tooltip>` (`{fromCity} → {toCity}`, `{edge.distance} {distanceUnit}`, model-unit-aware).
  - **10** Customer Active/Excluded end-to-end for **p-median-us + two-echelon only**: new `addedCustomers[].status` (api-server Zod, no OpenAPI change — `inputs` is opaque) threaded through `buildPayload().excludedCustomerIds` + `precheck`, both **gated on a new `capabilities.supportsAddedCustomerExclusion`** (us/2E `true`, **brazil `false`** — Brazil's solver applies no customer exclusion, so its UI/precheck/payload are all gated off to stay consistent; base-customer status still works for Brazil). Frontend: new `EntityRoleConfig.supportsExclusion` role flag (optional default false, customers-only — deliberately NOT reusing `hasStatus`, which means facility status); the added-customer control also requires the model capability (derived in `InputMapTab` via `useListModels()`), gating stations and Brazil out.
  - Gate green: typecheck, api-server 673/673, studio 1041/1041, solver pytest 131/131, `e2e_accuracy.py` 87/87 unmodified. Live-verified 13/15 items in a real browser (items 9/12 rest on automated T5 23/23 + T4 21/21 — pixel-hovering a thin SVG route stroke in the automated browser is unreliable). Reference-distances **model-scoping** decision (vs scenario-scoping) was made after a written impact analysis: the matrix is immutable/ownerless dataset data already served model-scoped by `/dataset`, so model-scoping dominates scenario-scoping on caching/auth/lifecycle with identical draft-consistency once the client filters the view — see `docs/superpowers/specs/2026-09-02-bundle2.2-workspace-ui-updates-design.md` Review Resolution Rev 2.
- **Bundle 3 (book-cover design system — full app-wide rebrand)** — merged to local `main`, commits `d0bf7c7..d00ebea` (11 tasks). Design package `docs/design-system/` (imported `749e4d0`, from the *Supply Chain Network Design* book cover). Spec/plan: `docs/superpowers/{specs,plans}/2026-09-03-bundle3-book-cover-design-system*.md` — both went through **2 review rounds each** (spec: 8 then 7 findings; plan: 9 then 7 findings), every finding verified against real code before fixing; decisions doc `docs/design-system/DECISIONS.md`. Replaces the Phase-3.1 `.scn-theme` (blue-gray Barlow) app-wide with paper-white + leaf-green + a dark **band** motif, `Source Serif 4` display / `IBM Plex Sans` UI / `IBM Plex Mono` for every number, radii 3/4/6, hairline borders — **light theme only**. Approach: retarget the shadcn HSL vars at **global `:root`** (not a scoped class) + close-match the 6 non-Radix studio components; the package's `components/**` are inline-styled specimens (a **visual spec, never imported**). `Studio.tsx`/`.studio-lab`/`--arc-*` left as dead code (all chapters `workspace:true`), EXCEPT `ObjectiveBar.tsx` (a live `--arc-*` consumer) which was rewritten.
  - **Executed via the agent team**, 3 waves: W1 `index.css` foundation (sole writer) + exhaustive source-contract test → W2 band/chrome (AppShell/Landing/NotFound, auth, footer, Workspace header) ∥ W3 finders (ObjectiveBar rewrite, 5 studio comps, map palette) → T9 mono-numbers (last, touches the others' files) → T11 Playwright. Key token decisions the reviews forced: `--accent-foreground` is **ink not white** (white-on-green-400 is 2.31:1, fails AA on `select`/`dropdown` `focus:text-accent-foreground`); shadows retargeted via Tailwind's **`@theme` shadow namespace** (the `:root --shadow-*` are dead — utilities don't read them) with the Switch thumb decoupled from overlay-`lg`; `--radius-sm/md/lg/xl` **pinned explicitly** (a single `--radius:4px` resolves to 0/2/4/8, not 3/4/6, and `Card`=`rounded-xl`); `bandPalette.BAND_COLORS`→`var(--band-N)` (tokens authoritative); map interaction-state rings kept as functional-affordance colors (palette lacks 3 contrasting hues). `.scnd-band`/`.scnd-kicker`/`.scnd-display` utilities in `index.css`; `.scnd-band .scnd-kicker` recolors to `--ink-300` for on-band contrast.
  - **Gate green:** typecheck clean, studio 1153/1153, solver pytest 131/131, api-server 673/673 (the lone full-run failure was the documented `resultEnvelope.test.ts` Brazil flake — CONFIRMED environmental via isolated 5/5, Bundle 3 touched zero api-server/Python). Live-verified in a real browser (disposable acct, purged): Landing band hero + green serif "Network Design Labs" + body "Labs"; auth band; Workspace band header; **sidebar green active left-rule + TabBar green top inset rule**; mono numeric cells (lat/lng/zip mono, ids/city sans); dialog radii/shadows — across p-median-us + transport-coal (no per-model gate slip). T11's Playwright smoke **actually ran vs Chromium** (band ink bg, green-600 primary, Card 6px, exact multi-layer box-shadows, accent focus-contrast, `--band-0` legend swatch).
  - **Process incident (git-index race in the shared worktree):** running 8 file-disjoint agents concurrently in ONE worktree, a `git commit` with **no pathspec** commits whatever is staged in the SHARED index — T4's commit swept teammates' just-staged files; its `git reset --soft` recovery then folded T2's commit out of history (file stayed byte-intact, re-committed as `3d828df`). **Fix/lesson: agents committing to a shared worktree MUST use `git commit -m "..." -- <explicit paths>`** (pathspec on the commit, not just `git add`), and re-check `git status` right before commit. After relaying this, T8/T10/T9/T11 all committed clean. Controller re-verified every landed commit's `--stat` listed only its own files + a full integrity audit (every expected file attributed to its task, nothing orphaned). **Still deferred:** production Render deploy (surface + confirm before the outward-facing step); one Minor residual (a Tailwind `bg-slate-400/border-slate-500` customer legend swatch in `NetworkMap.tsx`'s built-in legend, left un-tokenized — not a hex literal, out of the plan's named list).
- **Bundle 4 (auth split-screen + Landing hero + live Landing stats)** — merged to local `main`, commits `297538b`(T2) `56f63bf`(T1) `8efdc70`(T3) `81e7a1d`(T4), pushed origin. Spec/plan: `docs/superpowers/{specs,plans}/2026-09-03-bundle4-auth-landing-reskin*.md` — spec went through 1 review round (4 findings), plan through 1 review round (7 findings), every finding verified against real code before fixing. Reskins Login/Register to the mockup's split-screen (dark cover panel with the book-cover image + a paper form panel, no Card, shadcn Input/Button/Label preserved) via a new shared `components/auth/AuthShell.tsx`; the global `<AppFooter/>` is dropped on auth pages only, replaced by the mockup's inline "Developed by Shubham" credit block (LinkedIn/email icon links, mockup values verbatim). Landing grows the `AppShell` band into a hero (new `hero?: boolean` prop, 860px container, 32px green serif title + tagline — `/` route only) and gets live per-chapter card footers (chapter number + status text + `active` badge) and a header stats line, backed by a **new read endpoint `GET /landing-summary`** (`artifacts/api-server/src/routes/landingSummary.ts`, +orval regen): two grouped queries (scenarios by model; succeeded solve_jobs by model), returning `{perChapter:[{modelId,scenarioCount,lastSucceededSolveAt}], totals:{scenarios,solvedScenarios}}`. Executed via the **agent team**, 4 tasks each in its own isolated worktree (T1∥T2∥T3 file-disjoint → parallel; T4 last, needs T3's generated hook + edits T2's Landing.tsx), controller cherry-picked each onto the branch + main and re-gated. **Two security resolutions locked in and independently re-verified by the final review** (both `solve_jobs.user_id` AND `scenarios.user_id` filtered in the solve query — the columns are independent, so filtering one leaks the other tenant; proven at the mock layer by an exact `toEqual` on the `and(...)` array with table-qualified markers, since the suite mocks SQL and can't run a literal cross-linked-row exclusion) and one **truthfulness resolution** (the value is `COUNT(DISTINCT scenario_id)` of succeeded jobs — a locked earlier decision — so the field/label is `solvedScenarios`/"solved", never "solves"; renaming preserves the lock rather than reversing it). Final whole-branch review: Ready to merge, no Critical/Important findings; 2 Minor, both intentional (raw rgba book-cover shadow not tokenized — shadows aren't token-covered anyway; hardcoded personal contact values per the mockup). Gate green: typecheck, studio 1165/1165, api-server 677/677 (the lone full-run failure was the documented `resultEnvelope.test.ts` p-median-brazil flake — CONFIRMED environmental via isolated 5/5), solver pytest 131/131. **Env gotcha hit and root-caused:** mid-integration, studio tests showed 2→11 files failing to *transform* (`Failed to resolve import "@tanstack/react-virtual"`) — NOT a code regression; the 4 agents' concurrent `pnpm install` in sibling worktrees churned the shared `node_modules`/pnpm store mid-test. Settled once installs finished (symlink + store confirmed intact); clean re-run 77/1165. Lesson: when agent worktrees each run `pnpm install` against a shared pnpm store, the controller's own test runs can transiently fail dependency resolution — re-run after the installs quiesce before trusting a red result. **Still deferred:** production Render deploy (outward-facing — surface + confirm before triggering).
- **Bundle 5 (homepage polish + Distances pagination)** — merged to local `main`, commits `f5ffe03`(T3) `3562898`(T1) `8c0e593`(T2) `05ee866`(T4) `4932bd7`(T5) `19785c7`(QA), pushed origin. Spec/plan: `docs/superpowers/{specs,plans}/2026-09-04-bundle5-homepage-distances-polish*.md` — spec 1 review round (7 findings), plan 1 review round (6 findings), all verified against real code before fixing. Six user-requested items: (1) book-cover as a hero-band icon (~48px `<img>`, `AppShell` hero branch) AND browser favicon (`public/book-cover.png` + `index.html` `<link>`); (2) chapter-card restyled to the mockup — full-bleed sunken footer strip (`--surface-sunken` bg, `border-t`, green-700 number) inside an `overflow-hidden` card; (3) recent solves deduped to the latest job **per scenario** — `/solve-history` rewritten to a SQL `selectDistinctOn([scenarioId])` subquery (inner `orderBy(scenarioId, desc(queuedAt), desc(id))`, outer `orderBy(desc(queuedAt), desc(id)).limit`), the DB does the dedupe and the *response* is bounded (the scan is still O(user jobs), fine at pilot — NOT a bounded scan, worded honestly after review); (4) Log-out hover highlight on both band branches (`hover:bg-white/10`); (5) homepage footer = the login page's developer-credit block, extracted into shared `components/DeveloperCredit.tsx` and gated on the `hero` prop so not-found keeps the plain `AppFooter` (homepage-only by construction, no App.tsx change); (6) Distances tab paginates BOTH the reference and overrides tables at 50/page (dropped the `useVirtualizer`), From/To filters now live-filter both tables across all pages. Executed via the **agent team**, 5 file-disjoint tasks in parallel isolated worktrees (T1 AppShell cluster, T2 favicon, T3 Landing card, T4 solve-history+OpenAPI regen, T5 DistancesTab), controller cherry-picked each onto branch + main and re-gated. **Two review-caught traps fixed before build:** (a) the focus-jump/filter-reset race — page-reset was moved OUT of a `useEffect([fromFilter,toFilter])` (which would fire on the focus effect's programmatic filter-clear and snap back to page 1) INTO the From/To `onChange` handlers, so `focusEntityId`'s clear-then-jump survives; (b) the rewritten two-query route would have crashed every existing `/solve-history` test (they mocked only `mockDb.select`) — a shared `configureSolveHistoryMocks` helper now wires both the inner `selectDistinctOn().as()` and outer `select()` chains, and every existing test routes through it. Final whole-branch review: Ready to merge, no Critical/Important; 2 Minor, both intentional (focus-effect always clears filters per spec resolution #1; 151KB PNG favicon by choice). Gate green: typecheck, studio 1174/1174, api-server 678/678 (no flake this run), solver pytest 131/131 (no Python touched — no-regression confirmation). **QA task included in the plan by default this time** (per standing feedback — Bundles 3/4 both had QA retro-fitted after the user flagged it twice; now a first-class plan step): `qa-sdet` real Playwright (`e2e/bundle5-homepage-distances.spec.ts`, 5 tests, ran twice green against local dev servers) verified the T4 dedupe for real (solve one scenario twice via the async job API → exactly one recent-solves row), the hero cover img + `homepage-credit-footer` (+ absent `app-footer`) + logout hover class, the chapter-card sunken/overflow-hidden footer, and a real 120-row `distanceOverrides` PATCH → paginated Distances render ("Page 1 of 3" → Next → "Page 2 of 3", reference "Page 1 of 104", live From/To filtering both tables). No product bugs found. **Still deferred:** production Render deploy (outward-facing — surface + confirm before triggering).
- **Design-system: AssistantPanel (Bundle 7 prep)** — merged to local `main` (`10459e7`). Added `docs/design-system/components/studio/AssistantPanel.{jsx,d.ts,prompt.md}` (collapsible AI-assistant chat panel: 300px right rail, green status dot + scenario header, suggested-prompt empty state, user/AI chat bubbles, input+Send footer; canned replies isolated behind `getReply(text, ctx)` — the single seam a real LLM call replaces in Bundle 7), registered it in `assets/ds-loader.js` + the `studio.card.html` index, and wired it into the mockup `ui_kits/studio/Workspace.jsx` (Assistant toggle button, outline→secondary when open). **Design-system only — no `artifacts/studio` app change** (real integration is Bundle 7). The user's premise ("a reference impl exists at `ui_kits/studio/AssistantPanel.jsx`") was FALSE — nothing existed to move/adapt/delete; authored from scratch per the detailed spec (confirmed with the user first). Both new JSX files parse clean via esbuild.
- **Bundle 6 (Workspace + Landing/auth UI tweaks)** — merged to local `main`, commits `2468851`(T3) `eab74f7`(T4) `3c4a50b`(T1) `4110c15`(T6) `4523129`(T5) `1b3c8ac`+`dad9b1a`(T2) `b352396`(T7 QA), pushed origin. Spec/plan: `docs/superpowers/{specs,plans}/2026-09-04-bundle6-ui-tweaks*.md` — spec 1 review round (5 findings), plan 1 review round (5 findings), all verified against real code before fixing. Twelve UI/UX tweaks (**item 6 — distance metrics that FEED the solver, replacing the textbook matrix + a real routing provider — was split into its own later bundle** per the user; that bundle needs the provider choice + API key + an explicit `e2e_accuracy.py` hard-rule-2 override): (1) model page lands on the last-solved scenario's Input Map (default = greatest `solvedAt`, fallback `updatedAt`; **one-shot** `didSeedTabRef` seed keyed on modelId — NOT reactive open-when-null, so closing the last tab leaves none open); (2) removed the header scenario dropdown, chapter+summary moved far-left, scenario switching via the sidebar only; (3) removed email+Log-out from the model-page header (logout stays on Landing/AppShell; `handleLogout`/`useLogoutUser` fully deleted); (4) Solution Summary compare drops the utilization row + hyphenates City-State (`City - State`, inter-facility join stays comma); (5) result-history stepper arrows → bordered lucide `ChevronLeft`/`ChevronRight` (w-8, `--surface-band-fg`); (7) Input Map legend equal-width to the Output Map legend — resolved as **shared fixed `w-[220px]` + `flex-wrap`** (a shared `min-width` doesn't equalize widths; 14px swatch parity), verified live at 220px==220px; (8) hide Chapter 5 models **everywhere on Landing** (cards + Recent Solves + stats totals + active badge all filter to non-hidden modelIds — needed T1's new `LandingSummaryChapter.solvedScenarioCount` so the visible "N solved" is derivable); (9) hero cover 48→96px (`h-24`); (10) footer "Reach me out at"→"Reach out at"; (11) login "Register with your course email"→"Register"; (12) login footer strip → distinct non-hidden **chapters** not models (now just "Chapter 3"); (13) email placeholder → generic `you@example.com`. **T1 backend** added two read-only API fields (`Scenario.solvedAt`, `LandingSummaryChapter.solvedScenarioCount`) — both already computed server-side, no schema/DB change. Executed via the **agent team**, 7 tasks in parallel isolated worktrees across 2 waves (T1/T3/T4/T6 parallel → T2/T5 after T1's regen → T7 QA), controller cherry-picked each onto branch + main and re-gated. **Two review-caught traps fixed before build:** the header would have overflowed 375px as a flex row (kept the responsive `grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto]`); the "full Playwright suite" claim was impossible (`labs.spec.ts` is known pre-D0 debt — T7 explicitly excludes it). **One real T2-caused test break, correctly handled:** the one-shot seed mounts `InputMapTab` by default, exposing a pre-existing crash in two Workspace test files whose `useListModels` mocks lacked a `capabilities` object — the agent fixed both mocks minimally in a SEPARATE commit (confirmed via `git stash` the tests passed pre-T2). Final whole-branch review: Ready to merge, no Critical/Important; 3 Minor (dead `useLogoutUser` mock stubs, one exhaustive-deps omission matching file style, the single-item login strip per item 12). Gate green: typecheck, studio 1180/1180, api-server 678/678 (`resultEnvelope`/`cors` flaked under parallel-agent CPU load — CONFIRMED environmental via isolated 8/8), solver pytest 131/131 (no Python touched). **QA (T7, standing task):** `qa-sdet` real Playwright (`e2e/bundle6-ui-tweaks.spec.ts`, 10 tests + updated `bundle4-auth-landing.spec.ts`, ran green 11 passed, EXCLUDING `labs.spec.ts`) verified for real: last-solved+one-shot-seed (close last tab → stays closed), header cleanup, compare has no utilization + hyphenated city, **legend widths measured equal at 220px**, Ch5 hidden everywhere incl. Recent Solves, hero `h-24`, and (unauthenticated block) login copy/placeholder/strip. No product bugs. **Still deferred:** production Render deploy (outward-facing — surface + confirm before triggering); the split-out distance-metrics bundle (item 6).
- **Bundle 6.1 (map legend unify/realign + Distances table merge)** — merged to local `main`, commits `4d962b9`(T1) `10228cd`(T2) `f766611`(T3 QA) `f935082`(legend-color fix) `b43fe1f`(bundle5 e2e fix), pushed origin. **Frontend-only** (reference-distances endpoint + `distanceOverrides` already existed — no API/backend change). Spec/plan: `docs/superpowers/{specs,plans}/2026-09-05-bundle6.1-legend-distances*.md` — spec 1 review round (7 findings), plan 1 review round (8 findings), all verified against real code before fixing. Two items: **(1) map legend** — extracted ONE shared `MapLegend` used by both Input and Output maps (retired NetworkMap's hand-duplicated inline legend — the drift Bundle 6 kept patching), content-fit `w-fit max-w-[260px]` box with an aligned `grid-cols-[auto_1fr]` layout + group headers, and the demand group reworked from ragged variable-diameter bubbles into a **size-encoding ramp** (`customerBubbleSvg(QUINTILE_RADII[b]*0.55)` centered in equal `w-6 h-6` cells, one row per `scale.usedBuckets`). **Key correctness calls from review:** demand is **size-encoded not shade** (the maps encode demand by radius, not opacity; Input uses discrete quintiles, Output a different continuous `[3,8]` scale — so the demand ramp is **Input-only**, Output shows just a Customer marker); the Output legend is built from `NetworkMap.getStatus`'s ACTUAL rendered states (Potential/Open/Customer/Mine — **no separate "Forced Open"**, since a forced-open facility resolves to `open` via `openWarehouseIds`-first precedence post-solve); legend entries gate on the live `showWarehouseMarkers`/`showCustomerMarkers` layer toggles; route-band swatches use `getBandColor(i)` (clamps past the 5-entry BAND_COLORS). **(2) Distances tab** — merged the separate read-only "Base distances (reference)" section + editable overrides table into ONE Customers-tab-styled table (From / To / Base read-only / Override editable), for p-median-us (base+overrides) + p-median-brazil (override-only). **Overrides are always visible** (the base-key + saved-override lookups are built BEFORE the inactive/excluded view filter, and a pair carrying a current OR saved override bypasses the filter — so clearing a saved override on an inactive/excluded pair stays visible + "Changed" until Save); whole-value validation (`Number(raw.trim())`, not `parseFloat`); reference load→spinner / error→"unavailable" / "—" only for a genuinely base-absent pair on a success-loaded matrix; filters match the **displayed** value not the hidden uuid. **two-echelon's `LegDistancesTab` (T2b) was a verified NO-OP** — it already uses byte-identical shadcn `Table`/inline-`Input`/`font-mono`/`bg-amber-50` styling; the agent correctly made no change + no manufactured commit (surfaced to the user, who'd asked to "also restyle" it). Executed via the **agent team**, 3 parallel isolated worktrees (T1/T2/T2b) → T3 QA. Final whole-branch review: Ready to merge, no Critical/Important; **2 Minor — #1 fixed** (the shared legend regressed the Output "Potential" swatch to `--map-warehouse` dark ink; NetworkMap strokes un-opened candidates with `--map-default-stroke` gray — a dedicated SVG restores map-fidelity, `f935082`), **#2 deferred** (a committed `drafts[key]` isn't cleared → a low-prob stale value only if the override is externally mutated; the naive fix reformats-the-input-while-typing, so left as a documented Minor). Gate green: typecheck, studio 1204/1204. **QA (T3, standing task):** `qa-sdet` real Playwright — `e2e/bundle6.1-legend-distances.spec.ts` (legend one-box + per-bucket size-ramp circle with **bounding-box-contained-in-cell** assertion, Output "Open"/no-Forced-Open/no-demand-ramp, layer-toggle hides entries; merged single-table pagination "Page 1 of 104", base read-only + override→Changed; two-echelon leg tab) + updated `bundle6-ui-tweaks.spec.ts` (replaced the obsolete 220px/equal-width legend assertion with the content-fit contract), 10/10 green twice; no product bugs. **QA also caught a real e2e coverage regression** (out of its scope, routed back): `bundle5-homepage-distances.spec.ts`'s distances-pagination test still asserted the removed two-pager testids — fixed to the merged single-table testids + re-run 5/5 (`b43fe1f`; the fixing agent caught two bugs in its OWN rewrite — a `.includes()` substring collision on `C1`↔`C10..C199`, and a false "Changed" assertion on an API-seeded override that's saved-at-creation so `isChangedRow` is false). **Still deferred:** production Render deploy (frontend-only → `nos-studio` only, no `nos-api`); the split-out distance-metrics bundle (old item 6); Minor #2 (draft-clear).
- **JADE Ch.9 Workspace bundle (9 UI/reporting items + 2 backend touches)** — merged to local `main` (`f23d07f`; fast-forward, 19 bundle commits `712c319..6dc4f49` + harness metrics). Spec/plan: `docs/superpowers/{specs,plans}/2026-09-17-jade-ch9-workspace-bundle*.md` — spec went through **7 review rounds** (each finding verified against real code before folding; Option-C for distance bands chosen by the user), plan 1 round. Nine requirements, JADE-scoped except #1 (all-models): (1) band **overflow color** at ALL four `NetworkMap` band sites (lane/popup/highlight/tooltip via `assignBandOrOverflow`+`getBandColor(-1)`+shared `bandLabel`, no hand-rolled `Band N`) + **live recolor** — Output Map `bands` feed switched `displayedInputs`→`localInputs` (overriding T4 for the color lens only; geometry stays snapshot-sourced) + a `distanceBands`-only **non-staling save** (strict: sole-key, all models, backend `scenarios.ts`) + history-entry sync so stepping doesn't revert it; (2) first-class **plant markers** on the Output Map (separate `plants` prop, NOT `kind:"plant"` — `WarehouseCandidateKind` is `mine|facility`), `effectivePlants = dataset.plants ∪ addedPlants`, union-of-markers bounds driving `maxBounds`/`FitBounds`/`mapKey` with a padded 3-tier degenerate-bounds fallback; (3) three flow-weighted avg-distance lines (P→W, W→C, Overall from `avgDistanceByLeg`+`weightedAvgDistance`); (4) **product-level** Customer Assignments + Flows 2-inner-tab (P→W aggregated / W→C exact `Flows` label) as NEW `JadeAssignmentsTab`/`JadeFlowsTab` (shared tabs untouched) + model-branched backend export; (5) Plant Production section in Service Stats (full effective `plants×products` grid left-joined to inbound production) + JADE coverage recompute over `warehouse_to_customer` edges only; (6) read-only capacity in the Capability Matrix (210,000,000/0, via shared `lib/jadeCapability.ts`, any enabled cell = 210M per `merge_inputs.py:869`); (7) warehouse-capacity audit — no `10,000,000` leak (Big-M stays solver-internal); (8) running solve clock (`useElapsed`, queued/active split + persistent frozen total surviving the dialog's success auto-close, per-`ResultHistoryEntry` timing keyed to dodge the job-success-before-refetch race); (9) reusable type-aware `FilterMenu`+`useTableFilters` on every >10-row JADE table, opt-in `enableFilters` on shared components so it never leaks to other models. **Zero solver/`solve.py`/dataset/Python change** → `e2e_accuracy.py` correctly not re-run. Executed via the **agent team**: 4 foundation (A1-A4) + 9 leaf (B1-B9) + INT (sole `Workspace.tsx` writer) + QA, deps wired in a live task-ledger, controller cherry-picked + re-gated each on the merged state. **Mid-run branch-base incident (recorded as `merge_conflict` in `failures.csv`):** discovered `jade-ch9` was 61 commits behind already-merged/deployed `main`; retargeted the whole bundle onto `main` as `jade-ch9-workspace` (user-approved), re-applied the main-based agent commits clean. Two batch-1 agents (B1 map trio, B4 ServiceStats) had forked off the stale base pre-guard → hand-resolved cherry-picks (distanceUnit-vs-plant-prop unions; Chen+PlantProduction test-suite union) + a fixture fix, both test-verified. **Fix/lesson: added a `git merge-base --is-ancestor <target-tip> HEAD` base guard to every subsequent agent prompt** — batch 2 all reported `BASE_OK` and self-imported deps clean; bake this into the standard agent-team dispatch. INT correctly **flagged** (didn't hide) an unreachable `ImportDialog` filter path (nested in Warehouses/Customers tabs) → closed with a follow-up. Gate green: typecheck, studio 1700/1700, api-server 987/989 (2 = documented `cors`/`resultEnvelope` subprocess flakes, pass 12/12 isolated), solver pytest pass. **QA (`qa-sdet` real Playwright, `e2e/jade-ch9-workspace-bundle.spec.ts`):** all 9 JADE checks + `p-median-us` cross-model regression (live recolor + no-stale-on-bands-save survives a real reload), 2 clean runs, **0 product bugs**. Final whole-branch review: **Ready to merge**, 0 Critical/Important; Minor-1 fixed (`JadeBandEditor` restores validity on unmount so the Save gate can't stick, `6dc4f49`), Minor 2-4 documented non-issues. `jade-ch9-workspace` branch deleted post-merge; stale `jade-ch9` left as-is. **Still deferred:** production Render deploy (surface steps + confirm before triggering).

**Chapter 4 — Chen's Cosmetics (`chens-cosmetics-cn`), the 6th model** (2026-09-14/15, branch `chapter-4-chens`, 19 commits `5f46045..<merge>`). China warehouse→customer **service-level model** (Watson Ch.4, from the `ChensCosmeticsV1` notebooks) — single-echelon, TWO coupled objectives behind one `objective` mode toggle: **coverage** (maximize % demand within `highServiceDistKm`, s.t. avg-distance cap) and **min-distance** (minimize demand-distance, s.t. a coverage-demand floor). First **km** (non-mile) model → distance-unit plumbing generalized app-wide. Spec `docs/superpowers/specs/2026-09-14-*` (Rev 9, D1–D30, **8 review rounds** — every finding grep-verified against real code before folding), plan `docs/superpowers/plans/2026-09-14-*` (Rev 7, **7 review rounds**). Executed via the **agent team** (solver/backend/frontend/qa roles), waves by file-disjointness (Wave 1 dataset → W2 solver⟂contract → W3 backend chain on `routes/scenarios.ts` → W4 solve-history → W5 frontend chain on `Workspace.tsx` → W6 gate+QA), controller-verified + re-gated each task. **Zero fix cycles at dispatch time** — the exhaustive spec/plan grounding meant every task's own gate passed first try (only test-only brittleness self-corrected).
- **Data:** `solvers/chens-cosmetics-cn/` — 25 WH / 197 customers / 4925 direct-id-keyed **raw-km** pairs (`"wh-15,cs-1"`, ×1.17 circuity applied in-solver, D8), integer demand (D30), total `199269881`. Zips **100%** (`5f46045` extract → `ea87792` GeoNames CN city-level `NNNN00` at 25km-nearest + most-trailing-zeros tie-break, CC-BY attributed → `af6001b` cited hardcoded overrides for the 27 GeoNames couldn't place: HK→China-Post SAR `999077`, Macau→`999078`, 16 mainland cities → verified city codes). **Deviation from spec D9/D26 (Nominatim), user-directed** — OSM has no mainland-China postcodes; recorded `14548eb`.
- **Solver (`1f40eb8`):** `solve_chens` — ONE objective-sense branch (hard rule 6), CBC `gapRel`/`timeLimit`, `_safe_load` containment, Python-side `build_merged_chens_dataset` (D23, string-id keyed). Goldens (D3/D22, tie-aware — coverage avg NOT frozen): coverage **66.0639% / covered 131645389 / open {wh-40,wh-69,wh-102}**, min-distance **123834216789.27**. `e2e_accuracy.py` **unmodified** (99/99, sacred).
- **Backend:** `f6695c2` OpenAPI (modelId, 8-value precheck enum, additive solve-history, ExportEnvelope +4 output entities/rows-opaque, +regen) · `c3f6d1b` dataset loader + `/dataset` + direct-id `buildChensReferenceDistancePairs` + model→entity export/import selection (dedicated Chen branch, never falls through to p-median) · `edfd0d8` Zod `chensInputsSchema` (exact nested, `.default([])`, dedup, int demand) + `KNOWN_SCHEMAS`/`VALID_MODEL_IDS`/`buildPayload` + D19 · `eed589c` `fillEstimatedChensDistances` (km R=6371, 0.01 floor — separate fn, reparses `chensInputsSchema`) · `84dea3a`+`f527ce1` precheck (`zero_demand`/`no_feasible_route`/`coverage_floor_infeasible`, TS effective-view, ×1.17 two thresholds; `coverage_floor_infeasible` gated **min_distance-only** per the whole-branch review) · `72cff17` unit-aware exports (assignment `distanceMi`→`distance`+`distanceUnit` ALL models, `OUTPUT_TEMPLATE_VERSION=2` both JSON levels for assignments/costSummary/serviceStats, importable `distances` stays v1, effective-city openWH) · `651841e` solve-history unit-carrying `resultSummary` (removed `weightedAvgDistanceMi`, legacy fallback, Landing mode-aware).
- **Frontend:** `cf76f7d` chapters.ts + `defaultInputsForModel` + de-hardcode `mi` (routes derive from `CHAPTERS`, no App.tsx edit) · `5396f90` inputs UI (mode toggle clears the inactive field, `pMax=25` on tab AND SolveDialog, no capacity/band editor, band resync) · `4eacaae` full Input-Map parity (reuses the pmedian variant — Chen is structurally single-echelon; wired into every Workspace gate + move/delete client-purge reconciliation) · `b32a0d7` map (China `{sw,ne}` bounds, two-class coverage lens via derived `[high,max]` bands) + Gate-1 mapped audit (only shared points; NOT coal/gold/JADE branches) + output-tab KPIs + mode-aware objective + the still-live `CostSummaryTab` "Solution Summary — Compare" incompatible-mode block.
- **Gate green:** typecheck · dataset-schema 38/38 · api-server 974 (2 env flakes, isolated 12/12) · studio 1474/1474 · solver pytest 176/176 · `e2e_accuracy.py` 99/99 unmodified · **real-browser Playwright** `e2e/chens-cosmetics.spec.ts` 2/2 (`53b50d8`, real solves: coverage 66%/3 cities, min-distance, demand-edit delta, distance-override reassignment, Input-Map add, distances round-trip + customer edit-reimport). Final whole-branch review (fable independent lens): **Fix-then-merge** — 1 Important (the precheck mode-gate, fixed `f527ce1`), 0 Critical; all hard rules #1/#2/#5/#6 PASS.
- **Known non-blocking follow-ups** (Minor, from the whole-branch review — not fixed): (a) Open-Warehouses/Customer-Assignments **tabs** render Chen ids without cities (`Workspace.tsx:3011` `locationById` only wired for jade) though the D29 **export** got the effective-city lookup — UI/export inconsistency; (b) `SolveDialog.pMax` mechanism (built here) left unwired for jade (its dialog still allows P≤50 while its tab caps at active-warehouse count) — pre-existing sibling, mildest form of the recurring gate class; (c) `NetworkMap.tsx` popup field still named `distanceMi` while carrying km (display correct via `distanceUnit`) — cosmetic rename. **Deferred:** production Render deploy (outward-facing — surface + confirm before triggering).

**Workspace fixups bundle — plant icon / plant City-State / capability info / Added Entities tab / band-range filters** (2026-09-19/20, branch `workspace-fixups-2026-09-19`, merged to `main` + deployed `nos-studio` at `bd3049e`). Five user-reported Workspace UI/UX fixes, **frontend-only** (zero backend/solver/dataset/OpenAPI/Python — `e2e_accuracy.py` correctly not run). Spec `docs/superpowers/specs/2026-09-19-workspace-fixups-bundle-design.md` (2 Codex review rounds folded), plan `docs/superpowers/plans/2026-09-19-workspace-fixups-bundle.md` (2 rounds). Executed via the **agent team**, 10 tasks in 4 waves (T1–T9 leaf/component + INT sole-`Workspace.tsx`-writer + QA), each cherry-picked onto the bundle branch and re-gated by the controller.
- **The 5 items:** (1) plant map marker+legend → green **factory** icon via the single shared `plantSquareSvg` + new pinned token `--map-plant #2E7D32` (contract-tested); (2) plant id **`<id> — City, State`** at the 3 named surfaces (Flows P→W, Plant Production, Capability Matrix) via `plantIdCityState` — Flows resolves added plants from the SOLVED snapshot `displayedInputs` (deduped keyed-Map projection, base wins), never `localInputs`; input Plants tab deliberately untouched; (3) Capability Matrix info line single-line (`md:whitespace-nowrap`, no `max-w-md`) + capacity readouts suffixed ` Units`; (4) **Added Entities dedicated tab** (inner sub-tabs, Flows-tab pattern) for all 6 models — base tabs split via new `showAddedSection`/`showBaseTable` flags (base tab keeps the CSV toolbar/import; Added tab shows only add-form+added-table+precheck+delete), dead `pendingPrefill`/`prefillCoords` fully removed (the in-place `CreateEntityDialog` flow already writes `localInputs`); (5) Distance-Band **filters** show unit-aware ranges (`≤ 250 mi`/`250–500 mi`/`> 1000 mi`, km for chens) via new `bandRangeLabel` (sorts a copy, empty→`"All distances"`), live via `useMemo` deps on `[bands-signature, unit]` + a per-table **clear-on-change** effect (all 3 JADE band filters: Flows pw+wc, Assignments); table **cells** stay "Band N".
- **Gate:** typecheck **0**, studio **1768/1768** (clean full run; the lone occasional `JadeDistancesTab` full-suite timeout is the documented CPU-contention flake, 40/40 isolated). Whole-branch review (fable lens) **Ready to merge, 0 Critical/0 Important**; its 1 actionable Minor (pin `#2E7D32` in the contract test) fixed. QA real-browser Playwright (`e2e/workspace-fixups.spec.ts`, local-served merged branch, explicit `E2E_BASE_URL`) **3 consecutive clean runs, 0 product bugs** — incl. the mount-preserving band-clear via the Run Optimizer modal over an active output tab. Rebased onto `origin/main` (which had advanced 22 commits of permission-review-loop work — clean, disjoint) before push.
- **Deferred (non-blocking):** whole-branch review Minor 2 — consolidate the two plant projections (`effectiveFlowsPlants` memoized/deduped vs the older `effectivePlantsForCapabilityMatrix`/OutputMap concat) into one; harmless today (added-plant id-collisions prevented upstream, those consumers iterate not `.find()`).

**Workspace fixups 2 — remove Added Entities tab / id+City,State on >10-row tables / filter alignment / map hover type+id+location / drop P-Median label / Band N: X-Y filter format / relax JADE bands** (2026-09-20/21, branch `workspace-fixups-2-2026-09-20`, merged to `main` + deployed **both** `nos-studio` AND `nos-api` at `75212a1`). Seven user-reported fixes (some adjust the prior bundle). **Frontend + one backend Zod line** (item 7). Spec `docs/superpowers/specs/2026-09-20-workspace-fixups-2-design.md` (**3 Codex review rounds**), plan `docs/superpowers/plans/2026-09-20-workspace-fixups-2.md` (**4 rounds** — the review pressure kept surfacing real per-commit-green + data-flow gaps). Executed via the **agent team**, 13 build tasks + INT + CLEANUP + QA across 5 waves.
- **The 7 items:** (1) **Added Entities tab REMOVED** (reverts the prior bundle's item 4) — add-button back inline in each base tab; (2) **`EntityIdCell`** (stacked City,State + mono displayId, the Open-WHs pattern) on every >10-row output/input table lacking City/State columns, via `buildEntityIdentityById` (base ∪ added, **base wins on id collision**, `displayId=displayCode??id`) — **input tables fed the LIVE `localInputs` map, output tables the SOLVED `displayedInputs` map** (never cross them), CostSummary compare resolves **per-scenario** from each column's own `s.inputs`; (3) input-tab Filter moved onto the Import/Export toolbar row (JADE-enabled tabs only); (4) map hover **`Type · ID · City, State`** on BOTH renderers (`NetworkMap` output + `EntityMarkers` input) + the InputMapTab fixed-mine, `modelId`-driven role labels (gold-au facility→Refinery, transport supply→Mine/demand→Station), output display-id via `displayIdById` from `outputIdentityById` **OUTPUT-path only** (input map self-formats from live rows — the input-live/output-solved split); (5) drop "— P-Median" from the AL's Athletics Landing `title`; (6) band-**filter** label `Band N: X mi - Y mi` / overflow `Band N: > X mi` (cells stay `Band N`/`Overflow`); (7) **JADE bands relaxed** `jadeInputs.ts` `.length(4)`→`.min(1)` (the "exactly 4" was a self-imposed schema rule, NOT a solver requirement — bands are reporting-only, `merge_inputs.py` has zero band refs), JADE now uses Ch3's free chip editor everywhere, last-band `×` disabled at `length<=1`, `JadeBandEditor` deleted.
- **Gate:** typecheck **0**, studio **1811/1811**, api-server **993/993** (isolated; the in-suite cors/resultEnvelope fails are the documented subprocess CPU-contention flake, 12/12 isolated). Whole-branch review (fable) **Fix-then-merge, 0 Critical/0 Important**; its Important-1 (this bundle broke two PRIOR e2e specs — same recurring `spec_gap` class as bundle 6.1) + Minor-3 (bare-id cell lost `font-mono`) both fixed before merge. QA real-browser Playwright (`e2e/workspace-fixups-2.spec.ts`) **5/5 twice + both rewritten prior specs green twice, 0 product bugs**.
- **Process:** the `isolation:worktree` race that bit the prior bundle did NOT recur — pre-provisioned dedicated locked worktrees per task + per-wave integration (each wave's worktrees cut from the gated post-prior-wave tip). One INT watchdog-stall mid-run resumed cleanly from its intact uncommitted work (see the new gotcha).
- **Deferred Minors — ALL resolved in a follow-up (`0b26fc8`, deployed nos-studio):** the 4 review Minors (this bundle's + the prior bundle's) were knocked out as one small frontend-only polish commit. Minor-4: standardized the 6 `identity.city ? …` location guards to `(city || state)` (a state-only row keeps its location line). Minor-5: `EntityMarkers.modelId` is now **required** (removed the `"p-median-us"` default footgun; the p-median-family InputMapTab variant passes a correct definite fallback since its labels are model-invariant). wf1-Minor-2: consolidated the two plant projections into one canonical `mergeEffectivePlants` (base-wins dedup, correct for both `.find()` and iterating consumers). wf2-Minor-2: added a Workspace regression asserting no model exposes an `added-entities` sidebar entry. Gate: typecheck 0, studio 1812/1812.

**chen-bands-units — free Chen bands, live band lens, run-addressed history, and app-wide km/mi de-hardcoding** (2026-09-21/22, branch `chen-bands-units-impl`, 78 commits, merged to `main` and **deployed both services at `88e80e7`**). Spec `docs/superpowers/specs/2026-09-19-chen-bands-units-design.md` (**9 review rounds**, decisions 1–7 + 1b–1k), plan `docs/superpowers/plans/2026-09-20-chen-bands-units.md` (**9 rounds**). Executed via the agent team across two passes (backend T1–T9, then frontend T1b/T4/T10–T16), with controller-run integration commits between them.
- **The 5 items:** (1) **Chen's `distanceBands` become freely editable** — the backend used to unconditionally overwrite them with `[highServiceDistKm, maxDistKm]`; now a supplied array is preserved verbatim (positive, unique, strictly ascending, ≥1). (2) **Bands are a LIVE DISPLAY LENS, not part of the solved snapshot** — editing recolors the current *and* historical results with no re-solve; a bands-only Save is **non-staling** and goes through a field-scoped `jsonb_set` PATCH (`routes/distanceBands.ts`), never a read-modify-write of the whole blob. (3) the hardcoded **"199M" demand hint** is gone from both surfaces. (4) **every hardcoded km/mi literal removed app-wide**, replaced by a global `auto|km|mi` toggle. (5) **solve history is run-addressed** — new `solve_jobs.result` + `scenarios.result_run_id`; exports take `unit=` and `runId`.
- **`@workspace/units` is the single authority** — a new pure package (zero React) owning the conversion math (`KM_PER_MI = 1.609344`), the six-model objective-dimension mapping, and the band classifier. **Both `artifacts/api-server` and `artifacts/studio` call the same functions**, which is the only way the "one contract" claim survives a process boundary; `artifacts/studio/src/lib/bands.ts` re-exports it rather than keeping a second copy.
- **The central safety property: there is NO fallback unit, anywhere.** Chen is the only **km**-canonical model; every other is **mi**. So a `?? "mi"` fallback does not mislabel — it renders a **correct number under a wrong unit**, which a student reads as fact. Unresolved canonical ⇒ placeholder + disabled editor, on both read and write paths. Two pre-existing tests *asserted* the old `mi` default; both were rewritten to assert the placeholder, never "fixed" by restoring a default.
- **Gate:** typecheck clean · studio **2016/2016** (109 files) · api-server **1108/1108** · solver pytest **176** · `@workspace/units` **25/25** · dataset-schema **38/38** · **`e2e_accuracy.py` 99/99, byte-unmodified**. **Zero Python touched.** QA wrote and *ran* `e2e/chen-bands-units-qa.spec.ts` (7 tests, twice green) against real dev servers, including Chen's frozen golden — **66.0639%, open `{wh-40, wh-69, wh-102}`** — proving `highServiceDistKm: 600` and `avgServiceDistCapKm: 1000` stayed **uncoupled** (coupling them yields 64.8234% / `{wh-40, wh-102, wh-147}`).
- **Whole-branch review (fable, independent model): Ready to merge**, 0 Critical / 0 Important, 5 Minor. Hard rules verified by evidence not test status: generated code touched in exactly one commit (alongside `openapi.yaml`), `e2e_accuracy.py` byte-identical, ownership 404-never-403 upheld on both new routes (the `runId` export is triple-scoped `solve_jobs.id AND userId AND scenarioId` — **no IDOR**), zero Python.
- **Two real bugs found that no test caught, both silent.** (a) `Workspace.tsx` passed `canonicalUnit` to *neither* distance-editor parent, so **every distance edit in the app was a silent no-op** — no value written, no dirty flag, no analytics event; found only because three tests happened to exercise add-row. (b) `showBandEditor={modelId !== "chens-cosmetics-cn"}` at both call sites was still hiding Chen's band editor **from the one model the feature exists for**, so the whole capability would have shipped invisible.
- **Deferred Minors (4, documented, none blocking):** status toggles ignore `disabled` while browsing history (silent no-op, data-safe, inconsistent with the demand field's "Read-only" message); dead legacy `canonicalUnit === undefined` branches in `OptimizationParametersTab`/`SolveDialog` still contain `?? "mi"` — unreachable today (single call site, `CanonicalUnit | null`), but a second call site would resurrect the fallback; the bands-only PATCH re-validates the whole `inputs` blob so an unrelated legacy invalidity would 400 with a misleading "Invalid distanceBands"; `toApiScenario`/`isStale` hand-duplicated between `distanceBands.ts` and `scenarios.ts` (currently identical, drift risk only).

**ch4-fixes — homepage unit toggle removed, legends bottom-right, Solution Summary table unified, Distances number formatting** (2026-09-22, branch `ch4-fixes`, commit `917bc88`, merged to `main` + deployed `nos-studio`). Four user-reported fixes, **frontend-only** (zero api-server/solver/dataset/OpenAPI/Python — `e2e_accuracy.py` correctly not re-run). No spec/plan doc: small, directly-specified bundle, executed by the controller rather than the agent team; **QA explicitly waived by the user**, so there is NO real-browser verification for this one — the claim rests on the unit/RTL gate alone.
- **(1) `UnitToggle` removed from `AppShell.tsx`** — both the hero (homepage) and non-hero (404) branches, the only two places it rendered outside Workspace. `Workspace.tsx:3858` keeps its own. Consequence, deliberate: Landing's Recent Solves now render in whatever preference was last persisted in Workspace (default `"auto"` = each model's own canonical unit), with no homepage affordance to change it.
- **(2) `MapLegend`'s `corner` default flipped `"bl"` -> `"br"`** so every legend anchors bottom-right. `NetworkMap` already passed `"br"` explicitly (unaffected); the four `InputMapTab` call sites relied on the default and moved with it. `"bl"` deliberately KEPT as an escape hatch for a future caller with a genuine bottom-right conflict, not deleted.
- **(3) Solution Summary single-scenario adopts the COMPARE `<table>` shell** (metric column + one column per scenario) so selecting a 2nd scenario ADDS a column instead of swapping a `<dl>` for a table — all six models. **Row sets still differ by explicit user decision** (shell/typography shared, not the rows): single keeps `Solver`, compare keeps `Open facilities` + per-band rows. Compare additionally gained the Chapter 9 JADE **Inbound/Outbound cost** rows it never had (single-scenario has had them since jade-T14), gated on metric **PRESENCE across the selection, never on `modelId`** — a column whose envelope omits them renders `—` rather than dropping the row for every column.
- **(4) Distances tabs render grouped, max-2-dp values across all models.** New `artifacts/studio/src/lib/formatDistanceDisplay.ts` (`formatDistanceDisplay`/`stripGrouping`) is the single display formatter; **`roundForFile` (4 dp, ungrouped) is untouched and remains the EXPORT serialization contract** (spec Part E) — a file round-trips through a parser, a grid cell is read by a human. Applies to the read-only Base cells (`DistancesTab`, `JadeDistancesTab` — the only two tabs with a reference matrix) and the editable Override cell in **all four** distance-bearing tabs. The fourth is `LaneCostsTab`: **transport-coal's `cost` IS semantically a distance in miles** (`transportLp.ts:18-25` — named "cost" for that chapter's vocabulary only; the objective is literally distance × flow) and already routed through `useDistanceDraft`, so "across all models" genuinely includes it.
  - **Opt-in, NOT a default change:** `useDistanceDraft` has **nine** consumers and only four are Distances tabs — a default flip would have leaked commas into `SolveDialog`, `OptimizationParametersTab`, `WarehouseTable`, `CustomerTable` and `BandChipEditor`. New `presentation?: "raw" | "grouped"` option (default `"raw"`, so those five are byte-unchanged) plus a new returned `onFocus()`.
  - **Precision safety:** focusing a grouped field reverts it to the full-precision raw text BEFORE any keystroke can anchor off it, so editing a stored 4-dp override cannot silently truncate it to the 2 dp shown while idle. `commit()` (the blur/Enter handler at every call site) resumes the grouped presentation. Grouping separators are stripped on input, so a typed/pasted `"1,234.5"` still satisfies `COMPLETE_NUMBER`.
  - **Self-inflicted bug caught before it shipped:** both tabs validate with `Number(text.trim())`, and `Number("1,234.57")` is `NaN` — the formatted idle value would have rendered a false "Distance must be a positive number." on every valid committed override. Validation now reads `stripGrouping(text)`.
- **Two existing tests asserted behavior this bundle deliberately replaces and were REWRITTEN to the new contract, never "fixed" by reverting it:** `MapLegend.test.tsx`'s default-corner test (now asserts `"br"` + that the `"bl"` opt-out still works) and `CostSummaryTab.test.tsx`'s row-order test (reads the row's first `<td>` instead of a `<dt>`; the ORDER contract it exists to pin is unchanged).
- **Standing `spec_gap` sweep run before merge** (the recurring "a UI bundle breaks PRIOR bundles' Playwright specs" class): `e2e/chen-bands-units-qa.spec.ts` asserted the mi round-trip to **3 decimals** (`500/1.609344` = 310.6856) and the idle cell now shows `"310.69"` — rewritten to assert the 2-dp display contract. Every other distance assertion in `e2e/` uses values that format identically (`"126"`, `"500"`, `""`); no legend spec asserts a corner; the `cost-summary-list` + `cost-summary-value-*` testids were preserved through the table rewrite so `jade-two-echelon.spec.ts` is unaffected. **The rewritten spec was NOT executed** (QA waived, no dev servers) — it is reasoned-correct, not verified.
- **Gate:** typecheck clean, studio **2029/2029** (110 files, was 2016/2016). api-server/solver/pytest correctly not run — zero files touched in either.

**ch4-lock — Chapters 4 and 9 locked (greyed on Landing + enforced server-side)** (2026-09-22, branch `ch4-fixes`, commits `0d1fa7d` + `95b42fb`, merged to `main`, deployed **both** `nos-studio` AND `nos-api`). Chen's Cosmetics (`chens-cosmetics-cn`) and JADE (`two-echelon-jade-us`) are withheld from students. **QA waived by the user** — no real-browser verification; the claim rests on the unit/RTL/pytest gate alone.
- **`Chapter.locked` (chapters.ts) is DISTINCT from `hiddenFromLanding`** — hidden means "don't advertise this yet" and renders nothing; locked means "advertise it as deliberately unavailable" and renders a closed door. Landing greys the card (`opacity-60 grayscale`, `cursor-not-allowed`, `aria-disabled`), shows a "Locked" badge + lock icon instead of "start →", never claims the "active" badge, and does NOT wrap the card in a `<Link>` — genuinely inert, not a live link styled to look disabled. **Recent-Solves rows for a locked model lose their link too** (the lock must hold on both Landing entry points, or the rule looks arbitrary rather than absent); rows still render, dimmed — they are the student's own solve history and hiding them would misreport it. Landing stats/Recent Solves still COUNT locked chapters (explicit user decision; existing DB rows untouched).
- **Server-side is the half that actually holds.** `capabilities.locked` on `solvers/<model>/manifest.json`, read through the model registry (`middlewares/lockedModel.ts` — `isModelLocked`/`lockedModelIds`/`respondLocked`), is the AUTHORITY. **Never a hardcoded `modelId === "..."` list in the routes.** `ManifestSchema` had to learn the field: **Zod strips unknown keys**, so a manifest flag no schema knows about is silently dropped (the same trap C6.1's `outputGrids` hit).
- **All ELEVEN `:scenarioId` handlers** (10 in `scenarios.ts` + 1 in `distanceBands.ts`) return **403**, plus the two routes naming no scenario: create (403) and list (explicit `?modelId=` refused; an unscoped list drops locked rows but still returns the caller's open ones, so a student holding both a Ch3 and an old Ch4 scenario keeps a working homepage). 403 not 404 is correct here — model ids are already public via the unauthenticated `GET /api/models`, so there is no enumeration surface to protect.
- **Enforced per handler, NOT by one router-level `router.param` guard** — deliberate, after building the param guard first and reverting it: it cost an extra ownership-scoped SELECT on EVERY scenario request (eight handlers already hold the row they need) and shifted the positional mock queue in 47 existing tests. The price of per-handler is that a future handler can forget the check, so **`lockedModelGuards.test.ts` reads the route source** and fails if any `:scenarioId` handler lacks one — same structural-guard pattern as the studio's `historyReadOnlyGuards.test.ts`.
- **Anti-enumeration (hard rule #5) preserved.** Every check sits AFTER the handler's ownership-scoped 404 and inspects a row proven to be the caller's own, so another user's locked scenario answers **404** exactly as a non-existent id does. Two dedicated tests pin this. `patch` reuses the fetch its inputs-branch already performs (one read, not two); only a name-only PATCH and `delete` add a pre-write lookup.
- **Frontend route guard:** `App.tsx` redirects a locked chapter to Landing. **Its `<Route>` stays registered** — the single-`Switch` rule means every path must always resolve to a real Route, or a transitional render lands on NotFound instead of a valid redirect. Only the CONTENT branches; an unauthed visitor still goes to `/login` first, so the lock never leaks that the route exists.
- **Two declarations, held in agreement by a test.** `chapters.ts` keeps its own `locked` so Landing can grey a card SYNCHRONOUSLY — sourcing it from `GET /api/models` would leave a window on every page load where a locked card renders live and clickable. `lockedChapterDrift.test.ts` asserts the manifest-derived set and the chapters.ts set are identical, **and that the comparison is not vacuously empty**.
- **`setLockedModelsForTests` — a deliberate TEST-ONLY seam.** Locking two shipped models otherwise deletes their entire server-side coverage overnight: **73 real tests** stopped testing Chen/JADE behavior and started asserting 403. `routes.test.ts` and `importMultiModelRoundTrip.test.ts` unlock for their own duration; the lock's own describe re-arms the real set, and its manifest-truth assertions clear the override so they pin what actually ships. Deliberately NOT an env var — nothing in the running server can reach it, so it cannot become a production backdoor.
- **Gate:** typecheck clean · api-server **1130/1132** (the 2 are the documented `cors`/`resultEnvelope` subprocess flakes — CONFIRMED environmental, 12/12 isolated on three consecutive runs) · studio **2040/2040** across 111 files · dataset-schema **38/38** · solver pytest **176/176** (run because `solvers/` was touched, though zero Python changed).
- **KNOWN, NOT FIXED — 8 Playwright specs target the now-locked chapters** and will fail against a real server, because their entire subject matter is locked: `chens-cosmetics`, `jade-two-echelon`, `jade-ch9-workspace-bundle`, `chen-bands-units-qa`, `workspace-fixups`, `workspace-fixups-2`, `bundle4-auth-landing`, `nonjade-servicestats-live-coverage`. Gutting or skipping eight specs is a product decision, not a mechanical fix, so they were left intact and flagged. They are not in the unit gate so nothing is red today — but `pnpm e2e:gate` is now broken for those files until someone decides. **To re-run any of them, unlock the chapter first** (flip `capabilities.locked` + `Chapter.locked`); the drift test holds the two in sync.

---

## SCND correctness/measurement — approval and decision record (2026-09-22 → 2026-09-23)

**Why this section exists.** Measurement-plan review **MP-R9** found that the A plan, the measurement spec and the measurement plan all instruct agents to "record the answer in `docs/CHANGELOG-implementation.md`", while that file did not exist on `scnd-scaling`/`scnd-docs-review` — it was added to `main` via `ch4-fixes` after `scnd-scaling` was cut. The canonical audit artifact was therefore missing on the only branch that referenced it, and a plan cannot serve as both the approval request and the independent evidence it was approved. Restored from `main` here; decisions below are recorded, not re-asked.

**Decider for every row:** product owner (session decisions, 2026-09-22 unless stated).

| Decision | Scope | Date | Record |
|---|---|---|---|
| **A3 preparatory authorization** | §34's preparatory slice only; `v2_write` disabled throughout | 2026-09-22 | A plan status header |
| **A3's one public behaviour change** | A solver error envelope becomes a failed job — no scenario result, no cache write, failure telemetry. Fixes the cache-poisoning path at `jobRunner.ts:416-417` | 2026-09-22 | A plan status header, A3.C |
| **A14a authorization** | `render.yaml` shutdown budget + runbook; config/docs only. A14b explicitly NOT authorized | 2026-09-22 | A plan A14a/A14b |
| **A10 → Scaling scope move** | Single-flight removed from A after producing 12 of 56 findings at a rising rate | 2026-09-22 | A plan A10 removal record |
| **No-automatic-retry delivery contract** | A performs no automatic retry; ambiguous crash ends in terminal failure; retry policy stays in Scaling | 2026-09-22 | A plan goal + A2 |
| **Recovery-identity scoping** | `RECOVERY_CONTRACT_IDENTITY` governs recovery only; cache key unchanged until A6 | 2026-09-22 | A plan A1 |
| **Permanent failed-job API (Q80)** | `errorCode` + permanent `errorMessage` | 2026-09-22 | A plan A0/A5 |
| **AP-4 cohort-gate waiver** | Waived for **A4–A13**; full A rollout runs before Measurement. Still binds Scaling. Accepted cost: A4–A13 built without load evidence | 2026-09-22 | A plan AP-4 waiver section |
| **Measurement sequencing (M-R1/M-R7)** | Measurement runs after the full A rollout; the AP-4 waiver is a named prerequisite of its critical path | 2026-09-22 | Measurement spec header |
| **DEC-2026-09-21-01** | `e2e_accuracy.py` assertion corrections, zero golden-objective changes | 2026-09-21 | GitHub issue #19 |

**Still pending — not granted, do not infer:** **AP-1** (approval of the A plan revision), **AP-3** (G-cache artifact), **AP-5** (A14b), **AP-6/AP-7/AP-8** (R3 activation, auto-deploy suppression, rollback), **MP-1…MP-4** (measurement checkpoints).

**Standing requirement (MP-R9).** Every AP/MP checkpoint answer is written here before the answering task proceeds, carrying: the exact scoped answer, UTC timestamp, decider, and the referenced artifact or run IDs. A checkpoint answered anywhere else is not answered.

---

## login-fix — email normalization + password length cap (2026-09-24)

Branch `login-fix`, cut from local `main` (`7ce2b21`) and rebased onto `origin/main` (`89179f8`) before merge — local `main` carries three doc-only commits that are deliberately never pushed, so the branch was replayed onto the remote tip rather than dragging them along. Two auth defects, both reported by the product owner.

**1. Email was a case-sensitive identity, so a student could be locked out of their own account.**
`users.email` carries a plain `unique()` constraint, which Postgres evaluates byte-wise, and both auth routes looked the row up with `eq(usersTable.email, email)` on the raw request value. Consequences, both real: a student who registered as `Foo@x.com` and logged in as `foo@x.com` matched nothing — and because login's failure path is deliberately generic (no user enumeration), they got the same "Invalid email or password" as a wrong password, with no way to tell the difference. Separately, the two casings could both register, producing two accounts for one person.

- `lib/normalizeEmail.ts` (new) — `normalizeEmail` (trim + `toLowerCase`, NOT `toLocaleLowerCase`: the locale-aware variant would make an account's canonical form depend on the server's locale, Turkish dotless ı being the classic trap) and `withNormalizedEmail`, which applies it to a request body.
- **Normalization runs BEFORE the Zod parse, not after.** The generated validators check `email` with `.email()`, which rejects a leading or trailing space outright — a pasted `" student@example.com "` would have 400'd (register) or 401'd (login) before any trimming could happen. Normalizing the raw body and then parsing is what makes the whitespace case reachable at all.
- **Lookups compare `lower(email)`, not the normalized value directly.** App-level normalization alone only fixes rows written from now on. An account already stored as `Foo@x.com` would *stop* matching its owner's login the moment we began lowercasing the input — converting an intermittent bug into a permanent lockout for exactly the users who already hit it. `findUserByEmail()` uses `sql\`lower(${usersTable.email}) = ${email}\`` so both eras resolve with one query. Register's uniqueness check goes through the same helper, so a case-variant signup now 409s.
- Cost of that choice: the plain `unique()` index cannot serve a `lower(email)` predicate, so this is a sequential scan. At classroom scale (tens of rows) that is irrelevant — see the follow-up below.

**2. No maximum password length, on a 0.5-CPU box running argon2.**
argon2 is deliberately CPU-expensive; with no cap, one oversized password forces an expensive hash that steals CPU from every other student. `maxLength: 128` added to `RegisterRequest.password` and `LoginRequest.password` in `openapi.yaml`, Orval re-run (spec + regenerated output in this commit, per hard rule #1). The bound is inclusive — 128 passes, 129 is refused.

- The parse is the **first** thing both handlers do, so an over-long password is rejected before the DB lookup, before the rate-limit counter, and before argon2 ever runs. That ordering is the entire point; a cap enforced after hashing would protect nothing.
- Login's rejection is the same generic 401 as any other bad credential, so the cap cannot be used as an oracle. Register's 400 message now reads `(8-128 chars)`, built from the generated `registerUserBodyPasswordMin`/`Max` constants rather than hardcoded digits.
- `Login.tsx` / `Register.tsx` mirror the bound with `maxLength={128}` so the browser stops the student before the round-trip.

**Test-mock ripple.** `routes/auth.ts` now imports `sql` from `drizzle-orm`. Three suites mock that module and did not stub `sql`; because login is exercised through the real route in all of them, the import would have been `undefined` at call time. Added the same tagged-template stand-in `routes.test.ts` already carried to `auth.test.ts`, `error-handling.test.ts`, and `importMultiModelRoundTrip.test.ts` — in `auth.test.ts` it doubles as the assertion surface, since the interpolated values are what prove the WHERE clause received the normalized address.

**Gate (post-rebase, on `origin/main` + this commit):** typecheck clean · codegen re-run against the merged spec with **zero drift** · api-server **1153/1159** · studio **2040/2051** · solver pytest **217/217**.

The 17 non-passing unit tests are all load-induced timeouts, and none of them is in a file this branch touches. Establishing that took an explicit probe rather than an assertion, because on one run they reproduced *in isolation*, which normally disqualifies the "flake" explanation:
- The api-server trio (`cors.test.ts`, `resultEnvelope.test.ts`, `registry/registration.test.ts`) was re-run **at the base commit `89179f8` in a throwaway worktree, with this branch's code absent** — two of the three failed there too, and the specific set of failing cases differed from run to run (7 failures, then 2). `registration.test.ts` then passed 3/3 consecutively on the branch.
- The eleven studio failures (`CustomersTab`, `DistancesTab`, `JadeDistancesTab`, `Studio`, `Workspace.TwoEchelon`) pass **287/287** when those five files are run on their own.
- Solver is a non-issue by construction: `git diff 89179f8 HEAD -- '*.py'` is empty.

New coverage: `normalizeEmail.test.ts` (8) and 7 new cases in `auth.test.ts` — trimmed/lowercased insert, case-variant 409, case-variant login success, the 128 boundary, and both "argon2 was never called" assertions.

**Follow-up, NOT done here — the constraint itself is still case-sensitive.** The correct end state is a `lower(email)` expression unique index (which would also make the lookup indexed). It is not in this commit because creating it can fail on existing data: if production already holds two rows that differ only in case, the index build aborts. Deciding what to do with such a pair — and running any query against the production DB to find out whether one exists — needs the product owner, per the standing no-prod-side-effects rule. The app-level check closes the hole for every new registration in the meantime.

**SCND Correctness — Option A full contract (async-solve reliability + truthful v2 result contract)** — landed on `main` via merge `b5db64c` (18-commit bundle developed on `scnd-correctness-A`, `a5f0c16..0c78657`; reconciled onto current main because the branch was based off the pre-cherry-pick `scnd-scaling` B line). Spec `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` + G-cache artifact `…/2026-09-23-scnd-gcache-artifact.md`; plan `docs/superpowers/plans/2026-09-22-scnd-correctness-A-full-contract.md` (7 approval-review rounds, 58 findings A-R1…A-R58 folded; A10 single-flight removed → Scaling). Executed via the agent team, one locked worktree per task, controller cherry-pick + re-gate, with two product-owner gates surfaced for decision mid-build (G-cache Option 1, F1 legacyUnverified scope). **The v2 write path ships behind `SOLVER_V2_WRITE_ENABLED` (default OFF) — this bundle is inert to students until the separate R3 flag-flip; the always-on parts are the reliability fixes + the publication CAS + the failure-truthfulness change.**
- **Reliability substrate (A0–A3, A14a/A14b):** durable `solve_jobs` payload (`input_snapshot`/`model_id`, failure + requested-limit columns, `claim_generation` seq, owner-lease cols, `enqueued_solve_input_revision`, `recovery_contract_identity`); `scenarios.latest_solve_job_id` + `solve_input_revision` (3-step NOT NULL); atomic enqueue transaction (`SELECT … FOR UPDATE` + revalidate + captured revision + DB-side revision increments, distanceBands-exempt); recurring CAS dispatcher (5s, oldest-first, backoff), owner lease (10s heartbeat/60s stale, DB clock), version-aware claim (recompute `RECOVERY_CONTRACT_IDENTITY`, mismatch → fail-once no-retry), two-phase boot (pre-listen non-legacy dispatch gates readiness; async 180s-drain-gated legacy cleanup), SIGTERM drain (replaces the old immediate `process.exit` that reaped live jobs + orphaned CBC on every deploy — the live production bug this fixes); fd3 `SolverProcessMessage` + Node process-group supervisor + 14-row terminal state machine + Linux no-orphan proof; `render.yaml maxShutdownDelaySeconds: 120` + shutdown-budget runbook. **No automatic retry** (an ambiguous crash ends in an honest terminal failure the student retries).
- **Truthful v2 result contract (A4–A9, A11, A12):** five result schemas (OpenAPI `PublishedSolveResultV2`/`NormalizedSolveResult`; Zod cache/stored/fd3) + `composePublishedResult` (single composition point, current job's requested limits, wired into both publish paths flag-gated) + legacy normalizer (status/evidence-aware objective, never `===0`); composite `SOLVER_CONTRACT_IDENTITY` cache key (A1 manifest + `SOLVER_CONTRACT_VERSION`, **per-runtime-build — CBC binary + PuLP version in the key**, G-cache Option 1 approved) replacing the `solve.py`-only 12-char `SOLVER_CODE_HASH`; outcome-specific cache/publish (optimal/infeasible/unbounded→cache+publish; feasible→cache-under-v2-key; no_solution→no-cache; failure→neither); **always-on atomic publication CAS** on BOTH `latest_solve_job_id` AND `solve_input_revision`, RETURNING-gated so the scenario update runs only on exactly one owned job row (superseded-but-successful jobs stay recorded succeeded, never shown failed); public `errorCode`∈{SOLVE_FAILED,TIMEOUT} + permanent `errorMessage` (raw `solve_jobs.error` never surfaced; every terminal failure retryable, errorCode-derived); `legacyUnverified` = **genuinely pre-B rows only** (no `solutionStatus`/`terminationReason`) → export 409 + history badge fire only for those (product decision, F1); frontend unverified badge / errorCode-failures / retry / 409 resolve-prompt; `config/featureFlags.ts` (strict fail-closed) + `render.yaml autoDeployTrigger: off` + activation runbook `docs/ops/v2-write-activation.md`; per-site PostHog/Sentry allowlisted telemetry (completed strictly after the publish commit, never for superseded).
- **Whole-branch review (fable independent lens) found 1 CRITICAL (F1): `composePublishedResult` was never wired into production → no v2 shape ever written → the unconditional 409 export gate was a permanent 100%-user outage with an infinite re-solve loop. Fixed (`A-fix`): wired the composer flag-gated + narrowed `legacyUnverified` to pre-B rows (so B's truthful rows export 200/no-badge, converging in one re-solve) + hardened PATCH against `result` forgery (422) + a real solve→export integration + convergence test. Also caught a real invariant landmine — infeasible/unbounded/no_solution emit `objective:0` which would crash the composer at flag-on; fixed TS-side.** F4/F5 (runbook ceilings, stale test descriptions) folded earlier.
- **Gate at merge:** typecheck clean · api-server 1447/1448 (the lone full-run fail is the documented subprocess flake, isolated-clean) · studio 2076/2076 · solver pytest 231/231 · **`e2e_accuracy.py` 99/99 byte-unmodified** (hard rule #2 intact; solve.py's diff is IPC-only, zero solver-math per hard rule #6) · `e2e_journey.py` repaired onto `/auth/register`+`/auth/login` (157/157). Hard rules #1 (spec+regen together, faithful additive), #3 (3-step NOT NULL), #4, #5 (ownership 404-never-403; the 409 is post-ownership) all verified by evidence.
- **Deploy (this session):** merged to `main`; the prod schema is created one-shot by `drizzle-kit push` from HEAD (the two additive CHECK-constraint extensions A2/A5 made on the dev DB are already in the final `solve_jobs.ts`); `SOLVER_V2_WRITE_ENABLED` stays unset (OFF); the R3 flag-flip is a separate product-owner event gated on the A11 prerequisite list.
- **Deferred (not blocking):** the R3 activation (product-owner flag-flip) + A13b post-activation smoke; three non-documented flake sightings under heavy parallel-agent load (`jobRunnerDispatcher`/`dispatcherRecovery`/`scenarioSolveAtomicity` — each once in ~5 runs, isolated-green, same CBC/spawn-contention signature as the documented class) worth a `flake-audit.sh` pass.

**Bundle A — prod deploy actuals + Preflight P1–P5 record (2026-09-23T22:42Z UTC / 2026-09-24 local).** Corrects the "Deploy" bullet above (which said the prod schema would be created one-shot by `drizzle-kit push` — that is **not** what happened) and records the measurement-plan Preflight gates the product owner authorized.

- **`drizzle-kit push` cannot create the A schema on prod.** Prod's `nos_postgres` has the `pg_stat_statements` extension; `drizzle-kit push`'s reconcile tries to drop the extension's own views and Postgres refuses (`cannot drop view pg_stat_statements_info because extension pg_stat_statements requires it`) — `--force` cannot override a Postgres dependency refusal. Pivoted to an **idempotent additive explicit-SQL migration** (`ADD COLUMN IF NOT EXISTS`, guarded `CREATE`/`ADD CONSTRAINT`, never drops/reconciles, so it never touches the extension views) with a self-verify tail. Lesson (durable): **any prod schema change on this DB must be additive explicit SQL, never `drizzle-kit push`** — push is dev-DB-only here.
- **A silent boot-crash that survived every source-based gate — the "successful" migration job never committed the columns.** After the migration was reported applied, `nos-api` still failed every deploy: booted, logged `[A11] resolved SOLVER_V2_WRITE_ENABLED`, then `==> Application exited early` with **no error line** — because `index.ts`'s top-level `await initDispatcherForBoot()` rejected and the stack went to **stderr, which Render drops from its queryable log stream**. Diagnosis required running the *bundled* server locally against a migrated `nos_dev` (it booted clean) then querying prod directly (product owner allow-listed the diagnosing IP for a read-only pass): prod `solve_jobs` had **only the 11 base columns** and the sequence (value 5, bumped by the crashed boots' `nextval`) — every A column and both `scenarios` A columns were **absent**. The earlier one-off migration job's `MIGRATE_VERIFY_OK` had verified a DB that did not actually carry the columns (the transaction never committed to prod; only the sequence pre-existed, created by the aborted `drizzle-kit push`). Re-ran the additive migration **directly against prod** (product-owner GO for the write) → 16 `solve_jobs` A columns + 6 CHECKs + 2 `scenarios` cols (`latest_solve_job_id` nullable, `solve_input_revision` NOT NULL) confirmed by direct query. Redeploy `dep-daq58trncjis73ano8vg` → **live**, `[A11]` → `Server listening` (port 10000), `healthz`/`models` 200. `nos-studio` `dep-daq5a4rtqb8s73edoue0` → live, root + `/compare` + `/chapter-3` all 200. `SOLVER_V2_WRITE_ENABLED` stays unset (OFF) — A is in shadow mode in prod.
  - **Two durable lessons.** (1) A one-off migration job's own self-report is **not** proof the target DB changed — verify the schema by querying the DB the *app* connects to, not by trusting the job's exit/log. (2) A fail-closed boot must log *why* to the captured (pino/stdout) stream before exiting; an uncaught top-level-await rejection prints only to stderr and vanishes. Fixed in `ac10977` (`[A-boot]`, on `A-land-main`, **not yet deployed** — prod healthy on `9291eae`, queued for next deploy): `initDispatcherForBoot()` is wrapped in `try/catch` that `logger.error({err}, …)` then `Sentry.close` + `exit(1)`.
- **Preflight gates (measurement plan §"Preflight gates"), verified on `A-land-main`:**
  - **P1 — Option A shipped:** all A source modules present in the deployed branch (`recoveryContractIdentity.ts`, `solverContractIdentity.ts`, `featureFlags.ts`, `solverProcessMessage.ts`), A13a evidence commit `f787371 [A13a] QA pre-activation gate` in HEAD history, and prod boots the A dispatcher against the A schema. **PASS.**
  - **P2 — AP-4 cohort-gate waiver recorded:** present in `docs/superpowers/plans/2026-09-22-scnd-correctness-A-full-contract.md` (§"AP-4 cohort-gate waiver — granted 2026-09-22 (measurement review M-R7)", lines ~52–60): full A rollout runs BEFORE Measurement, cohort gate waived for A4–A13 by explicit product-owner decision; Scaling stays cohort-gated. **PASS** (already recorded; not re-asked).
  - **P3 — no back-dependency edge:** the A full-contract plan does not name Measurement as its own evidence source anywhere (grep empty); the waiver explicitly decouples A from Measurement. **PASS.**
  - **P4 — record the verifications with date:** this entry. **DONE.**
  - **P5 (MP-R9) — changelog exists on this branch:** `docs/CHANGELOG-implementation.md` present on `A-land-main` (171 KB, Bundle A entry above). **PASS.**
  - Net: all Preflight gates green → the measurement plan has authority to run. The Phases 1–2 campaign is executing in parallel on `scnd-measurement`.
**SCND Measurement — Phases 1–2 only (branch `scnd-measurement`, started 2026-09-23).** Executing `docs/superpowers/plans/2026-09-22-scnd-measurement-plan.md` (spec `…/specs/2026-09-22-scnd-measurement-design.md`), both brought onto this branch from `scnd-docs-review`.
- **Preflight decision record (P4/P5), 2026-09-23, decider: human (product owner):** the plan's Preflight P1/P2 STOP condition is acknowledged **not** satisfied — the **full** Option A rollout has NOT shipped (only the reliability subset `A0/A1/A2/A3/A14a/A14b` was built, on branch `scnd-correctness-A`, held un-merged/un-deployed; **A4–A13 + A13a pre-activation evidence are deferred**), and **no AP-4 cohort-gate waiver is recorded** in the A plan. Per the plan's own line-35 carve-out, **Phases 1 (M1.x) and 2 (M2.x) have zero technical dependency on Option A** — a local Python microbenchmark plus pure computation, touching no queue/worker/Render — so the human authorized running **only Phases 1–2 now**. **Phase 3 (HTTP load harness) and later remain gated** on the full A rollout + an isolated Render environment; not run. This branch is based off current `origin/main` (`89179f8`), which is A-independent.
- **P3 (M-R7 bidirectional check):** the A plan does not name Measurement as its own evidence source (A is the reliability contract; its gates are code/QA, not load evidence) — no dependency cycle.

**Phases 1–2 executed — real campaign + capacity model (controller-run, 2026-09-24).** Run after the earlier campaign attempt was found thrashing under an orphaned parent shell (stalled 33 min, zero durable output — the harness writes `benchmark-{raw,aggregates}.csv` only at completion, so the empty out-dir mid-run was expected, not the fault; the fault was the dead parent). Relaunched clean as a single tracked background run; validated the harness first (49 benchmark unit tests pass, manifest loads 124 cells).
- **Phase 1 (real CBC microbenchmark), run_id `a37bfb24`:** 124 cells × 8 obs = 992 raw observations; `benchmark-aggregates.csv` (124 rows) + `benchmark-raw.csv` written. **123/124 cells usable (96.8 % corpus mass).**
- **Corpus defect surfaced (real finding):** the `p-median-brazil | free_choice | distance` stratum (all 4 gaps, ~3.2 % mass/gap) fails deterministically — its `distanceOverrides.toId` uses **bare city codes** (`BEL`/`CPG`/`BET`) where `merge_inputs.py` requires a full `CITY,STATE` customer id (`to_id ∈ merged_regions`). Pre-existing (identical in committed HEAD and working tree; not introduced by the M1.1 regen). It is the documented "customer city names are NOT unique" trap biting the corpus generator — bare `BEL` is ambiguous across states. `solve.py` correctly rejects each as a data error (`ok=False`); the aggregates mark the stratum `usable=False, unusable_reason="no successes"`.
- **Product-owner decision (2026-09-24): exclude + reweight, ship now.** `capacity_report.py` gained a parameterized `--exclude-stratum` flag that drops the named stratum from SIZING (§§1/3/4) and **renormalizes** the remaining 30 strata to sum=1, printing exactly what was dropped and the mass it carried (never silent); descriptive §§2/5 still use the FULL manifest and report the stratum unusable. Repairing the corpus (mapping bare ids → valid `CITY,STATE` + regenerate + re-run) is the tracked follow-up.
- **Phase 2 results (over 96.8 % usable mass; run `a37bfb24`, report `docs/superpowers/metrics/reports/phase2-capacity-a37bfb24.txt`):**
  - §1 weighted-mean CPU service demand: **gap0 = 1.573**, gap0.005 = 1.555, gap0.01 = 1.515, gap0.02 = 1.486 CPU-sec/job (REAL, corpus-weighted).
  - §2 descriptive weighted p95 wall (partial over usable mass): 2.61–2.89 s across gaps (NEVER a sizing input).
  - §3 free-choice-mix sensitivity (ASSUMED alt weights): **+0.58 %** — negligible.
  - §4 required **CORES** at the ASSUMED 50×50/hr rate (0.694/s): **1.37–2.23 cores** across the efficiency (1.0/0.85/0.7) × headroom (0.20/0.30) grid; at 0.85/0.30 → **1.835 cores → a single small box covers it**. UNCALIBRATED (η/headroom are declared assumptions; M2.1b real calibration needs Render infra, out of scope).
  - §5 JADE `forced_open` gap0 re-measure (F-R20): p95 = **13.09 s → supports the PARENT ~13 s claim**, refutes the 0.6–3.5 s spike claim.
- **Not run (still gated):** Phase 3 (HTTP load harness) + M2.1b calibration — need the isolated A-carrying Render environment. Bundle A itself has since shipped + deployed on `main` (see that branch's changelog); the isolated-env stand-up is the next tracked task.

**Phase 3 started, parked at MP-2 (2026-09-24).** Prereqs all satisfied (full A shipped+deployed, AP-4 waiver + Preflight P1–P5 recorded, Phases 1–2 complete), so Phase 3 auto-started. M3.1 Step 1 done: drafted the isolated-environment pinned-config + teardown runbook (`docs/ops/measurement-environment.md`, commit `91c776d`) — nothing provisioned.
- **MP-2 checkpoint — asked 2026-09-24, decider: product owner: DECISION = HOLD / defer Phase 3.** Provisioning of the isolated Render environment (`nos-measure-api` `standard` + `nos-measure-postgres` `basic-256mb`, `oregon`, A-carrying, analytics/`SOLVER_V2_WRITE_ENABLED` OFF, disposable) is **not** authorized at this time. `provision-env.sh` does not run; no Render resource created. Rationale accepted: the campaign's headline capacity answer (≈1.4–2.2 cores / "one small box" at 50×50/hr) already stands; Phase 3 is live *validation* + the topology choice, deferrable until scaling is imminent or the v2 write-flag flip is planned.
- **Pinned for resume (product-owner-selected):** `app_sha = 9291eae` (deployed Bundle A, prod parity) — the single SHA for all future calibration/authoritative runs when Phase 3 resumes. Everything up to MP-2 is complete; resuming needs only a fresh MP-2 approval, then M3.1 Step 3 onward.

**MP-2 RE-ASKED and APPROVED (2026-09-24, decider: product owner).** After the initial HOLD, the product owner re-opened MP-2 and **approved provisioning** the isolated measurement environment + its teardown plan (artifact: `docs/ops/measurement-environment.md`, `91c776d`). Authorized config: `nos-measure-api` (`standard`, docker, A-carrying `9291eae`) + `nos-measure-postgres` (`basic-256mb`), `oregon`, analytics (`POSTHOG_API_KEY`/`SENTRY_DSN`) unset + `SOLVER_V2_WRITE_ENABLED` OFF, disposable with product-owner as teardown owner. Provisioning (M3.1 Step 3+) proceeds from here; resource ids + isolation assertions recorded as they are created.

- **M3.1 Step 3 — isolated environment PROVISIONED + booting clean (2026-09-24).** Live disposable resources:
  - `nos-measure-postgres` = **`dpg-daq9h6h7lnhs73c6uopg-a`** (Postgres 16, `basic-256mb`, `oregon`) — created via MCP.
  - `nos-measure-api` = **`srv-daq9ml8jo6nc73dlffug`** (`https://nos-measure-api.onrender.com`, docker, `standard`, `oregon`, `main`@`9291eae`, **autoDeploy OFF** to pin the SHA) — created via Dashboard.
  - **Provisioning-mechanics notes (durable):** (1) MCP `create_web_service` + CLI `services create/update` cannot create a Docker web service, set env vars, or link a DB, and Render exposes no DB password via CLI/MCP → the Docker service + `DATABASE_URL` DB-link were done in the Dashboard. (2) `drizzle-kit push` is unusable on Render Postgres (pre-enabled `pg_stat_statements` views it tries to drop — same failure as prod); a one-off `jobs create` was impossible (500 — Render won't run a one-off job before the service has a successful deploy image, and the first boot fails without a schema = chicken/egg). Resolved by applying a **`pg_dump --schema-only` of local `nos_dev`** (exact current A schema: 5 tables + `solve_jobs_claim_generation_seq` + all A columns, zero DROPs) over the measure DB's external URL (product-owner-supplied, used once, not persisted); **had to strip PG17+/18-only `SET transaction_timeout`/`idle_session_timeout`** the PG16 target rejects.
  - **Isolation verified (M3.1 Step 6, by construction):** pre-schema-load the API crashed on `relation "solve_jobs_claim_generation_seq" does not exist` — proving `DATABASE_URL` is the empty measure DB, **not** prod (prod has the sequence, would boot clean); the dispatcher never touched prod. Post-load redeploy (`dep-daq9t42d0e5s739qhoh0`) boots clean (`[A11]` flag OFF → `Server listening`), `healthz`/`models` 200. `SOLVER_V2_WRITE_ENABLED` unset (OFF); `POSTHOG_API_KEY`/`SENTRY_DSN` unset (analytics off).
  - **Billing note:** `standard` API + `basic-256mb` Postgres are live and billing until teardown (owner: product owner; procedure in `docs/ops/measurement-environment.md`).
  - **Next (M3.1 Step 4 →):** seed 50 synthetic users (`POST /auth/register`) + create/persist per-user scenarios (record scenario IDs; never commit credentials); then M3.2 cache prep, M3.3 driver, **M3.3b MP-1 SLO-gate ratification (product-owner gate) before any authoritative run**, M3.4a instrumentation, M3.4b soak.

- **M3.1 Steps 4–5 — synthetic cohort seeded (2026-09-24).** `scripts/measurement/seed-cohort.mjs` registers users via the real `POST /api/auth/register` (never one shared account) and persists per-user scenarios via `POST /api/scenarios`, writing the scenario-ID run manifest + session cookies to gitignored `.measurement/` (0600; **no credentials committed** — `.measurement/` added to `.gitignore`). Result: **48/50 users, 144 scenarios, balanced 36 each across the 4 unlocked models** (p-median-us, p-median-brazil, transport-coal, two-echelon-gold-au). Notes:
  - **Locked chapters excluded (correct):** `two-echelon-jade-us` (Ch9) + `chens-cosmetics-cn` (Ch4) are `capabilities.locked` → `403` on every scenario route, withheld from students, so they are legitimately out of the student-facing HTTP cohort. **Caveat for MP-1:** jade (heaviest, ~13s p95) is therefore absent from the HTTP load, which under-weights the tail vs the full-corpus (Phase 1/2) capacity model; unlocking on the isolated env for a fuller load would diverge from the pinned `app_sha` — a run-setup decision to raise at MP-1.
  - **Two users skipped** on transient 30s request timeouts (the seed now uses a per-request `AbortController` timeout + per-user try/catch so one stalled request no longer aborts the whole run — an earlier run FATAL'd on a 5-min undici headers-timeout). Recorded 48/50, not inflated to 50.
  - **Rate-limiter lesson:** re-seeding existing users forces `409 → login`, which trips the **10/min/IP login limiter** (no test-only reset on the live API); register is not similarly limited, so a clean cohort is best built register-only against a truncated DB (reusing the seed's cached cookies for later runs rather than re-logging-in).
- **Exploratory 50-hit burst on Chapter 3 (p-median-us) — SHAKEDOWN, non-authoritative (2026-09-24).** `scripts/measurement/solve-burst.mjs` fired 50 synchronized `POST /solve` at 50 distinct p-median-us scenarios on the isolated env: **50/50 enqueued, 50/50 `succeeded`, 0 rejected, 0 stuck** — A's async queue + worker pool handled the burst with zero loss. Timing on the `standard` 1-vCPU instance: enqueue latency p50 8.6s / p95 15.2s / max 15.8s (the 50 concurrent POSTs contend with the solver pool for the single core → HTTP responses back up), end-to-end ~17s for all 50, total wall 17.2s. **Labelled non-authoritative + excluded from any decision dataset** (per the plan's pre-MP-1 rule); it validates reliability-under-burst and previews the enqueue-latency SLO the MP-1 gate will set.

- **M3.2 — cache population prepared + verified (2026-09-24).** `scripts/measurement/prepare-cache.mjs` (API work) + psql wrapper (truncate/verify — this worktree has no node_modules/pg). Against the **write-through `result_cache`** (jobRunner, keyed on `computeInputsHash`, **unconditional / not v2-flag-gated** — so the classes are valid under flag-OFF). Prepared on p-median-us (Ch3): **hit=4** (distinct base inputs, solved+warmed, all 4 `succeeded`), **near=4** (the four edit families — demand=customerOverride, capacity=uniform, force=warehouseOverride forced_open, distance=distanceOverride ALN→C1 — each structurally distinct from base = distinct hash = miss, asserted), **cold=4** (unique p, never solved), **burst=50** (50 scenarios of one cold hash). **Verified:** `result_cache` holds exactly **4** rows (the hits); near/cold/burst confirmed cold by construction + count. Population manifest → gitignored `.measurement/cache-population-manifest.json`.
  - **all-JADE cold set (Step 4b) DEFERRED** — jade is a locked chapter (403), so the 7,500-cold-JADE guarantee profile can't run over the HTTP API; MP-1 decision (drop the all-JADE profile, or unlock jade/chens on the isolated env at the cost of diverging from the pinned `app_sha`).

- **M3.3 — open-loop load driver + run-manifest schema (2026-09-24).** `scripts/measurement/load-driver.mjs` + `run-manifest.schema.json`. Fires solves on a **fixed timer wheel** (all arrival offsets scheduled up front via `setTimeout`; a submission never awaits before the next → true open-loop, M-R3), seeded Poisson inter-arrivals, per-event cache class drawn from the declared 20/60/20 (seeded), round-robin across the cohort's cached sessions, 800ms poll to terminal, `429`=rejected (recorded, not retried), and an intended-vs-achieved-rate gate (open-loop runs `exit 2` if achieved < 99%). Emits a versioned run manifest + per-submission results CSV to gitignored `.measurement/`. Setup creates per-user hit/near/cold p-median-us scenarios (hit `p=4` == a warmed hash → cache hit; near = capacity-family variant; cold = distinct valid `p`).
  - **Exploratory shakedown (authoritative=false, 8 users, 45s, 0.694/s target):** intended 0.756/s = **achieved 0.756/s (100%)** — timer wheel correct; **34/34 succeeded, 0 rejected**; class mix hit24/near62/cold15% (n=34). On the `standard` 1-vCPU: **enqueue p95 694ms, queue-wait p95 8ms, e2e p95 1.2s** — the system is comfortable at sustained ~0.76/s (contrast the synchronized 50-burst's 15s enqueue: **rate ≠ burst**). Methodology note: the 800ms poll granularity masks the cache-hit speedup in end-to-end (sub-800ms unresolvable); queue-wait + M3.3a API-overhead are the finer signals. Labelled non-authoritative, excluded from the decision dataset. **Authoritative representative/burst/soak runs are gated on MP-1 (M3.3b).**

- **M3.3b — MP-1 SLO gate RATIFIED (2026-09-24, decider: product owner).** The predeclared pass/fail gate for all authoritative runs, ratified **before** any authoritative run observes it (prediction-before-observation, M-R5). Thresholds (per-class p50/p95/p99 over the measurement window, warmup excluded, pooled across the cohort; a threshold passes if met in ≥2 of 3 authoritative repetitions; 429 counts in offered load not success; infeasible is a valid outcome, never a failure):
  1. cache-hit e2e p95 ≤ 1.5s · 2. fast-miss (p-median) e2e p95 ≤ 8s · 3. JADE free-choice e2e p95 ≤ 20s **(N/A — see all-JADE below)** · 4. enqueue p95 ≤ 2s · 5. queue-wait p95 ≤ 10s · 6. max solve deadline 60s (`timeLimitSec`) + kill margin · 7. timeout/no-incumbent ≤ 2% · 8. rejection (429) ≤ 1% · 9. failure (excl. infeasible) ≤ 1% · 10. **zero permanently-stuck jobs on restart — hard MUST** · 11. min CPU headroom ≥ 20% · 12. min RSS headroom ≥ 25% · 13/14/15 aggregation + inclusion/exclusion + repetition rules as stated above.
  - **all-JADE decision (product owner): Option 1 — drop the all-JADE profile.** Authoritative runs use representative + cold-burst on the **4 unlocked models** only (prod-parity: students can't submit locked chapters either). Row 3 (JADE SLO) is **N/A** for this run. **Documented under-weighting:** the HTTP load omits jade's ~13s heavy tail vs the full-corpus (Phase 1/2) capacity model — so the load validation is conservative on the light side for the tail.
  - **Standing follow-up (product-owner instruction):** the measurement plan now carries a **"Locked-model measurement" step** (added to `2026-09-22-scnd-measurement-plan.md`): any future measurement campaign that must represent a locked chapter (jade Ch9, chens Ch4, or any newly-integrated locked model) adds an explicit step to make it measurable on the isolated env (unlock via a measure-only SHA, or a measurement seam) so the heavy tail is not silently dropped again.
  - **Next (unblocked by MP-1):** M3.4a instrumentation (default-off, isolated-env-only telemetry — needs a measure-only code change + redeploy, diverging from the pinned SHA like the jade-unlock would) → M3.4b authoritative representative soak + separate cold-identical burst.

- **M3.4b — authoritative runs COMPLETE, SLO gate PASSED (2026-09-24). Product-owner decisions: parity soak (no instrumentation SHA divergence; instrument only if it strains) + short authoritative window (~25 min).** Run on the pinned `9291eae` (prod parity); no `measurementTelemetry.ts` built (the run passed clean, so no bottleneck verdict was needed — M3.4a intentionally not executed, documented).
  - **Representative sustained soak** (`run-42-1500s-48u`, 48 users, 1500s, 0.699/s, 120s warmup excluded, `authoritative=true`): **achieved 0.699/s = 100% of intended** (open-loop ≥99% gate ✓); **1048/1048 succeeded, 0 rejected, 0 failed**; class mix hit209/near626/cold213 = exact 20/60/20. **vs the ratified MP-1 gate — every row PASS:** enqueue p95 **842ms** (≤2s), queue-wait p95 **9ms** (≤10s), fast-miss e2e p95 **1.24s** (≤8s), cache-hit e2e p95 **1.26s** (≤1.5s, poll-granularity-limited), rejection **0%** (≤1%), failure **0%** (≤1%). **Render platform metrics over the window (the headroom rows):** CPU peak **2.2%** / steady ~0.6% of 1 core → **~98% headroom** (≥20% ✓); memory ~**143 MB** of 2 GB → **~93% headroom** (≥25% ✓).
  - **Cold-identical burst** (50 requests, one cold hash, verified zero prior cache rows): **50/50 succeeded, 0 rejected, 0 stuck**; enqueue p95 13.8s / e2e ~16s — the burst-profile spike on a single core (50 synchronized solves contend), **not** a sustained-SLO violation (row 4 governs the sustained profile).
  - **Restart-under-load probe (hard SLO row 10):** redeployed `nos-measure-api` (`dep-daqfk7h42hec739h5fo0`) with ~20 solves in flight → came back `live`; post-settle `solve_jobs` = **1156 succeeded, 0 running, 0 queued, 0 permanently-stuck**. A's SIGTERM drain + two-phase Phase-1 recovery handled the restart with **zero job loss** — the reliability substrate's central promise, verified on real infra.
  - **Verdict: capacity VALIDATED.** At 50×50/hr (0.694/s) Bundle A on a single `standard` (1-vCPU/2-GB) instance meets every ratified SLO with ~98% CPU + ~93% memory headroom — confirming (and exceeding) Phase-2's "one small box" analytic sizing; even a smaller instance would suffice. Reliability under burst + restart confirmed. **Caveat (documented):** the HTTP load omits jade's ~13s heavy tail (locked chapter), so the tail is under-weighted vs the full-corpus model; a future campaign should include locked models per the plan's new locked-model step.
  - **M4 (experiments: MIP-start, warm-worker) and M5 (topology sweep: vertical vs dedicated-worker vs fleet — the MP-3-gated worker prototype) remain** as later phases; the representative-capacity question #48 targeted is answered.
- **Plan-vs-prod sizing gap (product-owner Q, decided from extrapolation 2026-09-24):** the soak ran on `standard` (1 vCPU/2 GB) but prod `nos-api` is `starter` (0.5 vCPU/512 MB), so the run does not *directly* validate prod's plan. Extrapolation: CPU is a non-issue on starter (~5% at 50×50/hr); **memory is the constraint** — each running solve ≈ node (~100 MB) + a CBC child (~180 MB peak RSS) ≈ ~280 MB, so starter's 512 MB safely holds ~1 concurrent solve, is tight at 2, and OOMs at 3+. The `result_cache` only absorbs the **exact-hit 20%** (keyed on the full-inputs hash); the **60% "near-identical" are distinct hashes = cache misses = real CBC solves**, so ~80% of load hits CBC and caching does not rescue starter under concurrency. **Recommendation (prod change, owner action): bump prod memory to ≥1 GB (or cap the worker-pool concurrency ≤2 on starter)** — burst insurance for simultaneous classroom solves; not a measured sustained-load necessity. MIP-start warm-starting for the near-identical 60% is the real lever but is the unbuilt M4.1 experiment.
- **Isolated env TORN DOWN (2026-09-24, product-owner approved).** `nos-measure-api` (`srv-daq9ml8jo6nc73dlffug`) + `nos-measure-postgres` (`dpg-daq9h6h7lnhs73c6uopg-a`) deleted via `render … delete --confirm`; verified 0 measure services / 0 measure postgres remaining → **billing stopped**. Prod untouched (nos-api `healthz` 200, nos-studio 200, nos-postgres present). Re-provisionable from `docs/ops/measurement-environment.md` for M4/M5 or a starter-plan re-run. Local `.measurement/` run artifacts (gitignored, incl. now-invalid synthetic sessions) left in place; no credentials ever committed.

**Branch merges to local `main` + design-doc reconciliation (#49, 2026-09-24).** Merged `A-land-main` (Bundle A + boot-logging fix `ac10977` + deploy/preflight records) and `scnd-measurement` (all Phases 1–3 + M-scripts) into local `main` (`5e3b81e`), gate `1445/1448` (3 documented cors/resultEnvelope/drain-timing flakes, untouched files). **Found local `main` was stale** — it had docs-only commits but had never merged the deployed Bundle A (`9291eae`=`origin/main`); the merge reconciled that. **Merge conflicts were all in the SCND design docs** (`specs/**`+`plans/**`) because the A-execution line and local `main` had evolved the same 5 docs independently (add/add + content, ~337 diff lines). Resolved per-doc toward the newer/fuller side (CHANGELOG unioned). **#49 audit (post-merge):** diffed each chosen (on-main) version against its dropped side; the dropped-only lines are **superseded earlier phrasings / a 47-line stub**, and the chosen versions cover every dropped concept (AP-4 ×4, G-cache ×12, A14b ×9, three-way/SUPERSEDED ×10, errorCode ×22, P0R.3/4 ×12) → **no genuine current content lost; main's versions are canonical + meaning-complete.** Standing rule added to CLAUDE.md branch-discipline: one canonical copy of design docs (edit in place, no re-synced divergent copies); check local `main` vs `origin/main` before merging. All merges local-only (`origin/main` unchanged). Also synced `render.yaml` nos-api `plan: starter → standard` (`00ae780`) to match the prod upgrade (inert Blueprint value, kept accurate).

---

## ch4-unlock — Chapter 4 (Chen's Cosmetics) reopened to students (2026-09-26)

Branch `unlock-ch4` off `main` (`682bbca`). Reverses the Chapter 4 half of ch4-lock (2026-09-22); **Chapter 9 (JADE) stays locked**.

**The change itself is two lines** — `capabilities.locked` deleted from `solvers/chens-cosmetics-cn/manifest.json`, and `locked: true` deleted from `chapters.ts`'s Chapter 4 entry. Nothing else in the lock machinery moved: `middlewares/lockedModel.ts`, the per-handler guards, `App.tsx`'s route guard and Landing's card rendering are all data-driven off those two declarations, which is exactly what ch4-lock was built for. The manifest edit was made with `perl` on the single line rather than a JSON round-trip, so the diff is one deletion and not a whole-file reformat.

**The rest of the diff is tests that had encoded "Chapter 4 is locked" as fact.** Each was rewritten to the new truth rather than deleted — a lock test that stops asserting anything is worse than no test:
- `lockedChapterDrift.test.ts` — the manifest/chapters.ts agreement check now expects `["two-echelon-jade-us"]`. This is the tripwire that made the unlock a two-place change rather than a silent one-place one: editing only the manifest fails here immediately.
- `Landing.test.tsx` — Chapter 4 moved out of the locked table and into the "stays a normal link" case, which now runs over both Ch3 and Ch4. The unlock is pinned **positively** (href present, no inert wrapper, no badge, no `data-locked`), so a half-applied unlock fails rather than merely shrinking a list.
- `routes.test.ts` — the server-side lock suite used `chens-cosmetics-cn` as its subject. It was repointed at JADE rather than kept on Chen's via the `setLockedModelsForTests` override: the override would have kept all 11 assertions green while the suite read as a claim about shipped behaviour that is now false. Repointing surfaced a latent brittleness — ten of the paths were hardcoded `/api/scenarios/13` (Chen's fixture id) instead of derived from the fixture, so they 404'd against the JADE row. They now build from a single `LOCKED_ROW` constant, making the next such move a one-line change.
- The unscoped-list test deliberately **keeps** Chen's in its fixture and now expects it to survive the filter, so it proves the drop is per-model rather than "anything ever locked".

**Gate:** typecheck clean · api-server **1446/1449** · studio **2075/2075** (113 files) · solver pytest **280/280** · `e2e_accuracy.py` **99/99** (run directly — it is not pytest-discovered, and Chapter 4's accuracy checks are part of that 99). The 3 api-server failures are the usual load-induced flakes (`jobRunnerDispatcher`, `resultEnvelope`) and pass 24/24 when those two files run alone.

**Playwright, unchanged and worth knowing.** The ch4-lock entry listed 8 specs broken *because* their subject was locked; unlocking Chapter 4 makes the Chen's-focused ones (`chens-cosmetics`, `chen-bands-units-qa`) meaningful again. They were not run here — no dev servers, and `pnpm e2e:gate` is not part of this gate.

**Pre-existing e2e staleness found but NOT fixed (not caused by this change).** `bundle4-auth-landing.spec.ts` asserts `"2 labs · …"` in four places and an `auth-labs-strip` of `"Chapter 3Chapter 9"`; `bundle6-ui-tweaks.spec.ts` asserts `"2 labs"` and `"Chapter 3Chapter 10"`. Both counts are already wrong at `main`: `visibleLabs` counts `!hiddenFromLanding`, and a **locked** chapter is still visible (that is the whole distinction from hidden), so Ch3 + Ch4 + Ch9 = **3 labs** both before and after this branch. `Landing.test.tsx` has asserted `"3 labs"` all along. Left alone deliberately — they are outside this change's blast radius and fixing them would mix an unrelated repair into an unlock.

---

## attached-assets — source notebooks committed for Chapters 4 and 9 (2026-09-26)

Branch `add-source-notebooks` off `main` (`4cf3bc1`). Closes a provenance gap: the Chen's Cosmetics
notebooks existed only on one developer's machine, so `scripts/src/extract-chens-dataset.ts` — which
takes the notebook path as a runtime argument specifically to avoid baking in a `~/Downloads` path —
could not be run from a clean clone at all.

**Chapter 4 — three notebooks, verbatim** (~145 KB each, sha256 recorded in `attached_assets/NOTEBOOKS.md`).

**Chapter 9 — one notebook, deliberately NOT byte-faithful.** The original is 23.73 MB, of which
22.79 MB (96%) is five identical copies of the plotly.js v2.35.2 bundle: one from
`init_notebook_mode()` and one re-embedded in each of four self-contained map renders. The real
figure payload across all four maps is 268,633 chars (0.27 MB, ~1%). Each library `<script>` body was
replaced with a CDN reference **pinned to 2.35.2** (the version that generated the figures, not
`plotly-latest`). Result: **0.42 MB**, every trace and coordinate retained. Product owner chose this
over both committing 24 MB and dropping the maps entirely.

The transform matched only `<script>` bodies over 1,000,000 chars that self-identify as `plotly.js v…`
in their first 400 characters — five matched. A cell-by-cell diff of the parsed notebooks confirms
nothing else moved: all 31 cells' `source` (including cell 13's 70,840-char `get_data()`), every
`cell_type`/`execution_count`, every non-HTML output byte for byte, `nbformat` and kernelspec
metadata. Cost: the saved maps now need network access to render. They are a view of data the repo
already holds — `get_data()` carries 100 customers / 25 warehouses / 4 plants, matching
`solvers/two-echelon-jade-us/dataset/` exactly.

**Found while verifying, and worth knowing: the extractor is step 1 of 2, not the whole pipeline.**
Running it against the newly-committed Step 3 notebook emits the right shape (25/197/4925) but
`version: 1` with no `zip` field, where the committed dataset is `version: 3` with zips —
`scripts/src/geocode-chens.ts` adds them afterwards (D9/D26, one-time Nominatim pass). The
regenerated files were reverted, not committed. So extraction is reproducible; the full dataset is
not reproducible offline, and `solvers/chens-cosmetics-cn/dataset/*.json` remains the authority.
`attached_assets/NOTEBOOKS.md` states this so nobody commits a bare extractor run as an "update".

**Chapter 5 — nothing to commit.** No notebook for `transport-coal` or `p-median-brazil` exists on
the machine (searched `~/Downloads`, `~/Desktop`, `~/Documents`, home tree), and neither model has an
`extract-*` script. How their datasets were produced is unrecorded.

**Amended (Chapter 5 delivery-teaching-us, 2026-09-29, `ch5-del-1`):** the above is narrower than it
reads — it was true only for `transport-coal`/`p-median-brazil`, the two models that existed under
"Chapter 5" at the time this note was written. It does not describe Chapter 5 as a whole any more.
A THIRD Chapter 5 model, `delivery-teaching-us` ("Chapter 5, modified" — a distinct teaching example,
not a rename of either retired model), was added in Task 1 of the `ch5-delivery` branch with a real
source workbook (a `~/Downloads` xlsx, 33 plants/313 customers/10,329 lanes) and its own extractor
script — see that entry below.

**Gate:** none run — no source, test, or config file is touched. The only executable path near this
change is the Chen extractor, which was run once to verify reproducibility and whose output was
reverted.

**Note on hard rule 7.** `attached_assets/` is normally off-limits; this was explicitly authorized by
the product owner. Chapter 10's notebook still sits at the **repo root**, not here — left alone.

---

## Chapter 4 — US dataset migration (`chens-cosmetics-cn` → `max-coverage-us`) + whole-branch review fixes (2026-09-28)

Branch `ch4-migration` off `main` (`ee75ecf`). Retires the China dataset (Chen's Cosmetics) and
cuts Chapter 4 over to Al's Athletics US data, renaming the model id and its dispatcher entry
(`chens-cosmetics-cn` → `max-coverage-us`). See
`docs/superpowers/specs/2026-09-27-ch4-us-dataset-migration-design.md` (design decisions `MIG-n`)
and `docs/superpowers/plans/2026-09-27-ch4-us-dataset-migration.md` (task list) for the full design.
A companion spec, `docs/superpowers/specs/2026-09-27-ch4-two-step-workflow-design.md`, documents the
unrelated two-step coverage/min-distance solve workflow (`CH4-n` decisions) already in place for this
model.

**Nine tasks, `[ch4-mig-1]` through `[ch4-mig-9]`** (each its own commit, several followed by a
plan-correction `docs:` commit when execution surfaced a plan defect — see each task's own commit
body for the deviation): `8dc8452` (T1, lock), `7739b91`/`b4585d2`/`a32f323` (T2, deletion
runbook+script, then two review fixes), `f6f1daa` (T3, build the US dataset package), `366a313` (T4,
rename + dataset swap — the ten registration points in `model-integration-precheck.md` Gate 1, in
one commit per MIG-3), followed by two T4 review fixes (`ecb0010` stale China-era defaults in
`defaultInputsForModel`, `189348d` an unfalsifiable dataset-identity test + stale China-id comments),
`1b2f9a5` (T5, regenerate the solver benchmark corpus for the new dataset), `b380858` (T6, assert
Chapter 4 min-distance at coverage floor 0 reproduces `solve_pmedian` exactly — the independent
equivalence check the new goldens are defended by), `d2c7edb` (T7, move the circuity factor from the
solver into the added-entity estimator), `8ab21dd`/`888b26f` (T8, UI copy + raise `p` to 26 + rewrite
the e2e specs, then a nearest-open-reasoning comment fix), `46a7078` (T9, remove the China dataset
and tooling, rewrite `README.md`).

**Dataset.** Al's Athletics: 26 warehouses, 200 customers, 5200 (26×200) distance pairs, all
US-real states (verified — no blank `state` anywhere in the shipped package).
`solvers/max-coverage-us/dataset/version.json`'s `sha256` is
`d4e62ef2205202462c8f652b7d97248372d55c8e8565e2df255aa0812ec791a1`, generated by `computeSha256()`
and verified by `lib/dataset-schema`'s `PACKAGE_SPECS` entry, never hand-written. `p`'s maximum rises
25 → 26 (Al's has 26 candidate warehouses), declared in **four** places per MIG-8, each with its own
regression: `solvers/max-coverage-us/manifest.json`'s `p.maximum`, `maxCoverageInputsSchema`'s
`.max(26)`, and the two independent `pMax={...}` UI call sites (`Workspace.tsx:3320`/`:4037` feeding
`OptimizationParametersTab`/`SolveDialog`).

**Circuity moved from the solver to the estimator (MIG-6/MIG-20), and a second, independent copy of
the same constant was found and removed in the same sweep.** `solve_max_coverage` no longer
multiplies raw stored distances by `1.17` — `rawKm` IS the effective distance now, matching the
dataset's own already-road-adjusted values (D8). Because the solver stopped applying the factor, the
added-entity distance estimator (`services/autoDistance.ts`'s max-coverage-us branch) now applies it
itself (`MAX_COVERAGE_CIRCUITY = 1.17`) so an added warehouse/customer's distances aren't ~15% shorter
than comparable base pairs. **Found while making this change:** `services/precheck.ts` carried its
own, entirely independent `CHENS_CIRCUITY = 1.17` constant (from the original `[C4.8]` semantic
precheck commit, `84dea3a`) that nobody had connected to the solver's copy — removed in the same
commit (`366a313`), since precheck's own feasibility thresholds now compare `rawKm` directly with no
circuity factor either, matching the solver.

**MIG-22 — a contract change beyond the migration's core, taken deliberately.** Three legacy
placeholder model ids (`max_coverage`, `p_center`, `set_cover`) sat in `VALID_MODEL_IDS`
(`routes/scenarios.ts`) and three OpenAPI `modelId` enums with no manifest, no Zod schema and no
dispatcher branch — a scenario created with any of them passed the id check and then failed with an
opaque `Unknown model_id`. All three are deleted from both places, with regenerated Orval output in
the same commit (hard rules #1 and #4) — this frees `max_coverage` as a string, which is deliberately
**not** reused as the model's own wire value (`max_coverage_us` instead) so a reader can't confuse
the retired placeholder with the new model.

**New goldens (T5/T6, no published answer table — see README fix below): coverage `68.4192%`,
covered demand `53385024`, open `{DAL, LA, PIT}`, weighted avg `635.13 km`.** Defaults: `p` 3,
`highServiceDistKm` 700, `maxDistKm` 5500, `avgServiceDistCapKm` 1000, bands
`[700, 1400, 2800, 5500]`. Frozen in `test_max_coverage.py`, defended by T6's independent floor-0
equivalence check against `solve_pmedian` (a `min_distance` solve with `coverageFloorDemand: 0` must
reproduce the p-median objective/assignment exactly — a mode collapse this model's two objectives
share a mathematical boundary with, and the check that would catch a divergence between them). The
solver benchmark corpus (`artifacts/api-server/src/solver/tests/benchmark/corpus`) was regenerated in
T5 against the new dataset — the sweep in T4 Step 8 that caught most stale China-era references
missed the corpus entirely, which is why it needed its own task.

**Runbook, and the hold this branch leaves open.** `docs/ops/ch4-migration-runbook.md` (MIG-16)
describes four operator stages — A (lock), B (drain the queue), C (delete the old data, point of no
return), D (deploy the rename). **As of this merge, only Stages B/C/D's *procedures* are ready; Stage
A has not actually been deployed to production**, despite an earlier draft of the runbook claiming
otherwise (verified false three ways during whole-branch review: `8dc8452` is not an ancestor of
`origin/main`, `origin/main`'s manifest carries no `locked` key, and the commit reaches no pushed
ref). The lock exists ready to deploy as commit `044b2c8` on a separate, unpushed branch
`ch4-stage-a` (`origin/main` + that one commit) — **and it must be deployed from that branch
specifically, because after this branch merges, `main` no longer contains the old manifest at any
point in its history, so Stage A can never again be performed from `main`.** The runbook was
corrected in this same review to state this, gate Stage B on a real, session-captured pair of `403`
proofs against production (not "already proven"), and add an explicit precondition to Stage C.
**Chapter 4 remains open to students in production** until Stage A is actually deployed and verified —
this is a stop-and-ask item for a human operator, not something this branch resolves.

**Whole-branch review findings folded into this same commit** (nine tasks had each passed their own
review; these are the cross-branch findings): the runbook's false "already shipped" claim (above,
Critical); `README.md`'s ground-truth-provenance claim corrected for Chapter 4 (no published answer
table — the goldens are the solver's own certified-optimal output, not a notebook transcription; the
retired China golden `131645389` does appear in `attached_assets/ChensCosmeticsV1.ipynb`, confirming
the claim was true before the swap and the identifier-rewrite pass left it standing); a new
`maxCoverageContract.test.ts` regression for the Zod `p.max(26)` declaration (the only one of the
four MIG-8 declarations that had none — proven by deliberately breaking it to `.max(25)` and
confirming the new assertion, and only that assertion, fails); this changelog entry itself (zero-byte
diff across all 40 commits on this branch before this entry — hard rule #9); `CLAUDE.md`'s model list
and its `e2e_accuracy.py` 99/99 attribution (wrongly credited to Chapter 4, which has zero references
in that file — the JADE/Chapter 9 section is what pushed 87 → 99); three test files renamed off the
retired model id (`maxCoverageContract.test.ts`, `InputMapTab.maxCoverage.test.tsx`,
`maxCoverageMapBounds.test.ts` — `chensDeletion.test.ts` deliberately kept its name, since it tests
the migration script that targets the old id on purpose); `scripts/py/dump_chens.py` deleted (its
only callers were already deleted in this branch); five UI comments that had gone from true-for-China
to self-contradicting-for-US rewritten as defensive-not-currently-true (`WarehouseTable.tsx`,
`CustomerTable.tsx`, `WarehousesTab.tsx`, `DistancesTab.tsx`, `formatLocation.ts`, `entityId.ts` —
measured 2026-09-28: 26/26 warehouses and 200/200 customers carry states, no blank `state` anywhere
across any of the six models' shipped datasets); a stale "no distance-band editor" claim in
`OptimizationParametersTab.tsx` (two sites) and `SolveDialog.tsx` corrected — the band editor **is**
rendered for this model since chen-bands-units (T13) superseded D13/D19's derived-only bands, and
`Workspace.tsx:3326`/`:4033` deliberately omit `showBandEditor` so it defaults true; a stale D19
re-derivation claim in `services/autoDistance.ts`'s doc comment corrected to match
`maxCoverageInputsSchema`'s actual verbatim-preserve behavior; `chens-cosmetics.spec.ts` references
in `truthful-status.spec.ts` repointed to its renamed `max-coverage.spec.ts`; a stale `chens.ts:108`
citation in the two-step workflow design doc repointed to `maxCoverage.ts:109`; a "default bands"
claim in `chen-bands-units-qa.spec.ts` reworded to name itself as the spec's own payload, not
`defaultInputsForModel`'s actual default (`[700, 1400, 2800, 5500]`).

**Gate (real, unscoped, run 2026-09-28):** `pnpm run typecheck` clean · api-server **1460/1463**
(3 documented load flakes — `cors.test.ts`, `resultEnvelope.test.ts` — isolated-green,
16/16, confirmed this session) · studio **2076/2076** (113 files, zero flakes this run) · solver
pytest **282/282** · `e2e_accuracy.py` **99/99**, run directly, diff against this branch's base is
empty (unmodified, hard rule #2).

---

## Chapter 4 — two-step workflow (`ch4-2s-1`–`ch4-2s-9`)

Nine tasks, executed per-task worktree per the standing agent-team protocol, each merged
`--no-ff` into `ch4-two-step-workflow-plan`: `ch4-2s-1` `a5335f6` (stepEpoch/step2 schema +
Chapter-4-scoped one-active-job index) · `ch4-2s-2` `0eb54ca` (`applyScenarioInputWrite`, the one
epoch authority every writer routes through) · `ch4-2s-3` `cdd7a1f` (write routes reject a
client-supplied `objective`/coverage floor) · `ch4-2s-4` `3763d21` (target-step derivation in the
enqueue lock, refuses a second active job) · `ch4-2s-5` `6cda42c` (`Scenario.steps` projection +
lazy per-step result envelope) · `ch4-2s-6` `63e16d5` (removes the free objective toggle from both
mounts — `OptimizationParametersTab` and `SolveDialog`) · `ch4-2s-7` `9ea5823` (step toggle, Step 2
parameters, confirm-and-clear) · `ch4-2s-8` `6e75682` (per-step output gating, the 2-of-2
comparison table) · `ch4-2s-9` `<merge-sha — see this entry's own commit>` (this entry — the
`ch4-two-step.spec.ts` e2e spec, sibling-spec repair, full gate, closeout).

**Task 9 scope, expanded beyond the plan's own text at explicit user instruction.** The plan's
Task 9 only rewrites `max-coverage.spec.ts`'s objective-toggle block (CH4-22). The user additionally
asked for a dedicated full-lifecycle spec, `artifacts/studio/e2e/ch4-two-step.spec.ts`, covering the
acceptance-matrix row the plan itself flagged as unprovable by any client-side/unit test — **a hard
page reload preserves `0/2`/`1/2`/`2/2` from SERVER state, not local UI state** — by actually reloading
a live page mid-test and re-asserting the counter. It also covers per-step output toggling
(`cost-summary-value-weighted-avg-distance`, `formatDistance`'s `.toFixed(1)` — one decimal, e.g.
`635.1 km`/`624.3 km`, NOT the two-decimal `step-comparison-*` cell `StepComparisonTable.tsx` renders
with its own `.toFixed(2)` — these are two different call sites and must not be conflated) and the
confirm-and-clear interception.

**Three real bugs found and fixed while getting the new spec and `max-coverage.spec.ts`'s rewrite to
actually pass (not e2e flake-chasing — each is root-caused, not papered over):**

1. **`ChenDistanceInput` (chen-bands-units) commits on blur/Enter, never on `fill()` alone.**
   `useDistanceDraft`'s `onChange` only updates the LOCAL draft text; `onCommit` (which is what
   reaches `guardStep1Edit`) fires from `onBlur`/`onKeyDown`-Enter only. A `.fill("750")` with no
   follow-up silently never reaches the guard at all — no dialog, no write, test passes for the
   wrong reason if nobody checks the counter afterward. Fixed by committing via `.press("Enter")`
   initially, then (see #2) via blurring onto a neighboring field instead.
2. **`.press("Enter")` on that same input races Radix's Dialog auto-focus and self-closes the
   freeze-confirm dialog within under a second, silently.** Root-caused via `page.on('console'
   /'pageerror'/'requestfailed')` diagnostics and a minimal isolated repro (single solve, no reload,
   no toggling): the dialog opens, then Playwright's own trace shows the accept button's `after`
   event carrying `locator.click: ... waiting for getByTestId('freeze-confirm-accept')` with ZERO
   console/page/network errors in between — the element itself stops existing. Committing the SAME
   edit via a blur (clicking a neighboring, already-focused-stable field) instead of Enter is 100%
   reliable across every re-run; Enter was never reliable across any. Not a workaround for a
   user-facing bug — real users commit these fields by tabbing/clicking away, not by pressing Enter,
   so the fix uses the MORE representative interaction, not a less representative one.
3. **Every Step-1-field write funnels through `guardStep1Edit` — including ones the plan's Task 9
   text never anticipated needing guard-handling.** Once Step 1 solves in `max-coverage.spec.ts`'s
   very first section, it stays frozen (`steps.step1.solved`) for the REST of the test — the
   pre-existing demand-edit (section 4), distance-override (section 5), and map-add (section 6)
   sections, unmodified since before this bundle, each attempt a Step-1-field write against an
   already-frozen Step 1 and each would hit the SAME freeze-confirm dialog the plan's Task 9 only
   added ONE explicit test case for. Handled with a shared `applyStep1Edit` helper (confirms the
   dialog if it intercepts — one whole-input PATCH does the edit AND drops both steps to 0/2 in the
   same request, so there's nothing left to `saveViaHeader` on interception) at sections 4 and 5; a
   THIRD interception at section 6 (map add) was deliberately NOT routed through the same
   intercept-and-continue pattern — see next paragraph.

**A real, if narrow, product interaction found and left alone (correctly out of scope for this
task): the confirm-and-clear PATCH doesn't register the map-add's `pendingEstimateWatches`, so a
freeze-intercepted map-add produces zero estimated-distance rows, not just a missing "estimated"
badge.** `handleAddedArrayChange`'s `handleEntityAdded(...)` call (which seeds the watch the
estimated-distance preview reads) fires unconditionally on every add regardless of which
`guardStep1Edit` branch the accompanying write takes, but the freeze-confirm path calls
`updateScenario.mutateAsync` directly rather than going through whatever the ordinary Input-Map Save
flow does with that watch — confirmed empirically (zero Distances-tab rows for the new code, not a
missing badge on an otherwise-real row). `max-coverage.spec.ts`'s section 6 now does one MORE
confirm-and-clear cycle immediately before the map-add specifically to reach an unfrozen state first,
so that section exercises the ORIGINAL, already-proven add-via-map-then-Save path untangled from this
edge case, rather than either masking the gap or expanding this task's scope into fixing it.

**Sibling-spec repair — the recurring `spec_gap` class, worse than the plan anticipated.** The plan's
own audit (CH4-22) named only `max-coverage.spec.ts` (genuine break) and
`nonjade-servicestats-live-coverage.spec.ts` (asserts only `chen-objective-section`, the wrapper —
"survives", verify-don't-rewrite). Both halves needed correction:
- `chen-bands-units-qa.spec.ts` (not named by the plan at all) had TWO tests asserting
  `button-result-back`/`text-result-history-position`/`button-save-as-scenario` against a
  max-coverage-us scenario — Task 8 (`ch4-2s-8`) hides that ENTIRE result-history stepper for
  max-coverage-us (`Workspace.tsx`: `{!stepState.isMaxCoverage && resultHistoryState.items.length >
  0 && (...)}`), so those testids no longer exist for this model at all. Fixed by relocating BOTH
  tests' history-browsing mechanics onto `p-median-us` (a model Task 8 never touches, where the
  identical generic Workspace.tsx code paths — dirty-nav-prompt, ordinary-editor no-op while
  historical, the band lens staying editable while historical — are unaffected), following the exact
  dual-model pattern the file's own first test already established. One relocated sub-block (input
  exports disabled / result export via `runId` while browsing history) does NOT relocate cleanly:
  `SidebarTree`'s `keepOutputsClickable` is true ONLY for max-coverage-us (CH4-18) — every other
  model's output sidebar entries are genuinely `disabled` while parked on a non-latest history entry,
  confirmed via trace replay (a plain `.click()` with no explicit timeout on a real `disabled
  aria-disabled="true"` button silently inherited the whole 300s test budget, 582 actionability
  retries). Kept only the input-export half (genuinely model-agnostic); the output/result-export half
  is out of scope for a relocation and was dropped with a comment, not silently lost.
- One test in that same file, unrelated to any of the above and never touched by this bundle
  (`unit-aware commit stores the correct canonical value...`, testing `input-distance-ALN-C4` add-row
  validation), fails consistently and reproducibly (2/2 runs) on `main`'s current `chen-bands-units`
  code — pre-existing, unrelated to Tasks 1–9, out of scope, reported not fixed.
- `nonjade-servicestats-live-coverage.spec.ts` — the plan's "survives" prediction is **wrong**: 3 of
  its 4 tests (p-median-us, two-echelon-gold-au, max-coverage-us) fail, all on the SAME root cause as
  bug #1 above (`.fill("50")` on `input-high-service-dist`/equivalent draft-commit fields never
  reaches the guard without a blur/Enter) — a pre-existing defect from `chen-bands-units`, predating
  this whole bundle by definition (`chapters.ts` and every touched component in the diff carry zero
  changes on this branch relative to `main` for this file's own assertions). Left unfixed per the
  plan's own explicit "Verify, do not rewrite" instruction for this file — reported here in full so
  the false "survives" assumption doesn't stand uncorrected in the plan record, escalated rather than
  silently absorbed into this task's scope.

**Full gate, run 2026-09-28 (numbers below are real, not fabricated for a subset that happened to be
green):**
- `git diff --check` clean.
- `pnpm run typecheck` clean.
- api-server (`DATABASE_URL` inline) **1530/1530** passed, one run, zero flakes observed.
- studio **2095/2095** (115 files), one run, zero flakes observed. The task brief's own prior
  session reported `2094/2095` on one run with `dispatcherRecovery.test.ts` behaving the same way on
  the api-server side; neither reproduced in this session's single run of each — too small a sample
  (n=1 each) to compute a rate. **`scripts/harness/flake-audit.sh --runs 20` was NOT run** — it drives
  the full real-CBC `e2e:gate` lane 20 times sequentially, and this session's own e2e timings (a
  single `max-coverage.spec.ts` run ranged from 17s to 4.3 minutes depending on moment-to-moment
  contention from other concurrent agent processes confirmed sharing this machine) make 20 full
  sequential passes infeasible inside this task's time budget. Flake rate over N runs: **unknown**
  (hard rule — never fabricate a metric), not zero.
- solver pytest **282/282**.
- `e2e_accuracy.py` **99/99**, run directly and unmodified (hard rule #2) — no Chapter 4 section,
  count unaffected by this bundle by construction.
- `ch4-two-step.spec.ts` (new): **PASS**, 2 consecutive clean runs after the fixes above (6.6s–18.2s
  each once contention eased).
- `max-coverage.spec.ts` (rewritten): **PASS**, 2 consecutive clean runs (17.2s and 38.6s).
- `chen-bands-units-qa.spec.ts`: **7/8 PASS** — the 1 failure is the pre-existing, unrelated,
  never-touched test named above.
- `nonjade-servicestats-live-coverage.spec.ts`: **1/4 PASS** — 3 pre-existing failures named above,
  correctly left unfixed per "verify, do not rewrite."
- `pnpm e2e:gate` (full 23-spec-file lane, **run with `--retries=0` instead of the config's default
  `retries=1` and the default worker count (4, auto) rather than serially — a disclosed deviation
  made for time-budget reasons, not silently substituted for the real command**): **34/59 passed, 26
  failed**, 8.5 minutes wall-clock. Of the 26 failures, 4 are the already-documented
  `chen-bands-units-qa.spec.ts`/`nonjade-servicestats-live-coverage.spec.ts` pre-existing failures
  above. The other **~22 failures span files entirely outside this bundle's touched set**
  (`bundle2-fastfollow`, `bundle4-auth-landing`, `bundle6-ui-tweaks`, `design-system`, `import`,
  `input-map-v2`, `jade-ch9-workspace-bundle`, `jade-two-echelon`, `posthog-analytics`,
  `sentry-capture`, `tab-coverage`, `two-echelon`, `workspace-fixups`, `workspace-fixups-2`,
  `workspace-ux-r1-r9`) — auth/landing copy, design-system colors, JADE band filters, map hover
  interactions, tab sweeps, none of which this bundle's diff touches. One (`bundle4-auth-landing.spec.ts`)
  was spot-checked in ISOLATED sequential mode (`--workers=1`) to rule out pure parallel-worker
  contention as the sole explanation — it **still failed**, on a real assertion mismatch
  (`landing-stats-line` expected `"2 labs"`, got `"3 labs"`); `chapters.ts` (the static code path
  that decides lab visibility) carries zero diff between `main` and this branch, so this does not
  look attributable to Tasks 1–9, but it was not root-caused further within this task's budget. **Not
  chased down or fixed — reported as-is.** This is the flaky/indecisive-result class this role is
  told to escalate rather than resolve unilaterally: full triage of ~22 failures across 15 unrelated
  spec files, on a machine independently confirmed to be running other agents' concurrent processes
  throughout this session, is a call for the lead, not something to absorb into a Task 9 closeout.

**Deviations from the plan surfaced during execution, not present in the plan's own text (per hard
rule #8, recorded here rather than guessed past):**
- `import/apply`'s `solve_input_revision` bump became **conditional** — a no-op import no longer
  bumps it. Affects all six models; judged more correct (an import that changes nothing shouldn't
  stale a valid result), kept deliberately.
- The export `runId` now follows the selected step (Task 8) rather than always the scenario's single
  latest result.
- Making the Compare list step-aware is **deferred** — it needs `GET /scenarios` to merge `steps`
  per row, the exact N+1 Task 5 deliberately avoided by keeping the list route's `toApiScenario`
  synchronous and un-per-row-queried.
- Task 9's own commit message deviates from the plan's literal suggested text
  (`[ch4-2s-9] rewrite the Chapter 4 e2e spec for the two-step workflow`) — the dispatching agent's
  explicit instruction for this task specified
  `[ch4-2s-9] add the two-step e2e spec, rewrite siblings, and record the bundle`, which more
  accurately describes the actual diff (a new spec file, not just a rewrite of an existing one).

**Distilled into `CLAUDE.md`'s `## Gotchas` (narrative stays here, only the durable rules moved):**
a test that hand-authors a persisted shape the production writer never produces can pass while the
code it covers is broken (the `step2` bag `synthesizeStep2Inputs` destructures away — R2, already
guarded by Task 2's own real-Postgres regressions, not a new gap, but the general lesson is durable
and worth keeping visible); a partial unique index or in-transaction guard added for one model
silently changes enqueue semantics for every model unless its predicate names the model (R1); a
Playwright `.click()`/`.fill()` with no explicit `timeout` inherits the ENTIRE remaining test budget
on a stuck actionability wait, turning a 10-second problem into a multi-minute or full-timeout one —
always bound e2e interactions that follow a dialog/disabled-state transition; a form field's
draft-until-blur/Enter commit pattern (`useDistanceDraft`) means `.fill()` alone can silently never
reach a guarded write path at all.

### Process deviation — Chapter 4 two-step bundle skipped two closing gates (2026-09-29)

Recorded, deliberately not retroactively closed (human decision, 2026-09-29):
the bundle merged as `0a300f8` and deployed to both Render services **without**
the two steps that normally close a branch in this repo.

**Skipped:**
- The **final whole-branch code review**. `subagent-driven-development`
  prescribes one after all tasks and before merge; `.superpowers/sdd/progress.md`
  records one for Phase 5, Phase 6, the Render migration and the ch4-migration
  bundle. This bundle has none.
- **`/harness-retro`**, which CLAUDE.md states is required before a branch is
  finished (metrics row in `docs/superpowers/metrics/tasks.csv`, per-cause
  failure logging, second-occurrence gate rule).

**What was done instead**, and why the result was judged acceptable: per-task
controller verification on all nine tasks (gates re-run independently, not
accepted on the implementer's report), four falsification tests that planted
violations to prove guards actually bite, and a production smoke that
reproduced both frozen goldens exactly (Step 1 `53385024` / `68.4192%` /
`635.13 km`; Step 2 at the server-derived floor `624.33 km`) plus a live `422`
on the CH4-25 floor guard.

**What was NOT done**: any independent read of the complete nine-task diff as a
whole. Per-task verification cannot catch cross-task incoherence or accumulated
drift — different instrument, different failure class.

**Root cause** (full analysis in the session memory
`feedback-process-steps-as-tracked-tasks`): the task ledger was seeded from the
*plan's* task list only. The whole-branch review and `/harness-retro` are
*process* steps owned by the skill and by CLAUDE.md, not plan tasks, so they had
no representation in any ledger and nothing surfaced them. Compounding: the
skill's text arrived truncated in context and was never re-read; a mid-run e2e
escalation displaced the sequence; and per-task rigour produced a false sense
that review had occurred.

**Standing correction:** seed the task ledger with the skill's and the repo's
process steps alongside the plan's own tasks, before the first dispatch. Read
`progress.md`'s prior entries before declaring a bundle complete — every
predecessor bundle's shape was four lines from the cursor that appended this
one.

---

## Chapter 5 (modified) — Delivery Company Teaching Example (`delivery-teaching-us`, `ch5-del-1`–`ch5-del-13`)

Branch `ch5-delivery`, 13 tasks executed sequentially against a 13-task plan
(`docs/superpowers/sdd/` — see the plan's own two review rounds, R1/Rev2/Rev2.1, for the design
history). A **seventh** model — not a rename of `transport-coal`/`p-median-brazil` (the two other,
still-hidden Chapter 5 models) but a genuinely distinct teaching example built from the COG
(Center-of-Gravity) case study's own dataset: 33 candidate distribution centers, 313 customers,
10,329 warehouse×customer lanes. `p_i \le P` facility-location on a **cost table**, not a distance
table — the interesting pedagogical point this chapter teaches — with an opt-in toggle
(`costAdjustEnabled`) that reprices every lane from its distance (a flat rate under a threshold, a
steeper rate beyond it) so students can watch the optimal network change when long lanes get more
expensive, without ever touching the underlying distances.

**Tasks 1–7 (solver + data + API registration):** `scripts/extract-cog-dataset.py` transcribes the
source xlsx (`~/Downloads/COG_CaseStudy_v2/COG-Model-Data-3DC-3WH.xlsx`) into
`solvers/delivery-teaching-us/dataset/{warehouses,customers,distances,costs}.json` — keyed by column
letter (not position) so a blank `<c>` cell can't silently shift every later column, ZIPs preserved
as zero-padded strings. `solve_delivery` (`solve.py`) mirrors `solve_pmedian`'s shape
(`{customerId, warehouseId, distanceMi, band}` assignments, single-source, `FacilityCount <= p`) but
separates **cost** (what the objective sums) from **distance** (what bands/WAD/edges report) — the
`_effective_delivery_costs` function is the one place a lane's billed cost is computed, and toggling
`costAdjustEnabled` changes ONLY that function's output, never `edges[].distance`. Two measured
goldens, verified against an independent oracle PuLP/CBC script that shares no code with `solve.py`
(`docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py`): Scenario 1 (toggle off — costs
seeded equal to distances, i.e. the case study's flat $1/mile) opens `{W1, W2, W60}`, objective
`88,240,913,478.10`, weighted avg distance `422.5511` mi; Scenario 2 (toggle on,
`distanceThreshold=800`/`costPerMile=1`/`costPerMileOver=10`) opens `{W6, W43, W45}`, objective
`150,194,534,098.60`, WAD `508.6534` mi. Registered across all ten of the pre-existing "ten
registration points" (manifest, `KNOWN_SCHEMAS`, `VALID_MODEL_IDS`, `PACKAGE_SPECS`, `buildPayload`,
openapi enums, `solve.py` dispatcher, precheck dispatcher, router mount, `GET /dataset` branch) plus
nine more this integration discovered were never on that list at all (`objectiveDimension`,
`MODEL_IDS`, `inputEntriesForModel`'s permissive default, `buildEffectiveFacilityCityLookup`, `pMax`
at both Workspace mounts, `registration.test.ts`'s per-model source gates, and
`crossModelStepContract.test.ts`'s `NON_STEP_MODELS`) — see `model-integration-precheck.md` Gate 1,
folded in Task 13.

**Tasks 8–12 (Studio):** the sidebar tab rail for this model is exactly three entries — **Input
Map** (read-only: no add/move/delete/status/demand/Save affordance, Task 9's dedicated `readOnly`
InputMapTab variant), **Delivery Costs** (Task 11's paginated base×override cost grid, the model's
ONLY editable dataset surface — no Warehouses/Customers/Distances tabs at all), and **Optimization
Parameters** (P capped at 33 at both the slider and `SolveDialog`, plus Task 10's **Adjust Cost
Table** control exposing the three rate fields only once the toggle is on). Outputs: Open Warehouses
shows **Demand Served** (not Utilization — this model has no capacity concept, `capacityModes: []`),
Solution Summary/Service Stats gained an opt-in `{ decimals: 2 }` precision path
(`computeCumulativeBandCoverage`) so `81.45%`/`97.19%` render exactly rather than rounding to the
nearest whole percent the way every pre-existing model does.

**Task 13 — e2e journey + documentation closeout:**
- `artifacts/studio/e2e/delivery-teaching.spec.ts` (new): Landing card presence (+ the two retired
  Chapter 5 models' continued absence) → tab-rail shape → read-only Input Map → a real CBC solve
  reproducing Scenario 1 → Adjust Cost Table toggle + re-solve reproducing Scenario 2 → toggle back
  off + a lane-cost override reproducing the invariance proof `test_delivery.py` already owns at the
  pytest layer (override the W60→C3 lane — Scenario 1's first positive-distance assignment — to cost
  `0`; open set unchanged, objective drops by EXACTLY that lane's base cost × demand) → CSV/JSON
  exports. Four real solves (not one) — a deliberate, disclosed deviation from "carry at most one
  real-CBC journey": this model solves in ~2–4s (measured), nothing like `max-coverage-us`'s ~170s,
  so the discipline that matters for that model doesn't transfer here, and the four solves are each
  load-bearing to the literal journey the plan describes.
- `e2e_journey.py` gained `journey_delivery()` (create → real solve → Scenario 1 bounds `[400, 450]`
  mi → toggle on → re-solve → Scenario 2 bounds `[490, 530]` mi) and a `"delivery"` entry in the
  `JOURNEYS` dispatch dict — without the dict entry the function exists but
  `python3 e2e_journey.py <url> delivery` still exits 1 with `Unknown section`.
- `bundle4-auth-landing.spec.ts` / `bundle6-ui-tweaks.spec.ts` — the lab-count assertions (already
  corrected from the plan's recorded `"2 labs"` to `"3 labs"` by the Chapter 4 e2e repair merged
  ahead of this branch) moved to **`"4 labs"`**, and `auth-labs-strip` to
  `"Chapter 3Chapter 4Chapter 5Chapter 9"`. One assertion **inverted**, not merely changed:
  `bundle6-ui-tweaks.spec.ts` asserted `getByText(/Chapter 5 ·/)` had count **0** (dating from when
  both Chapter 5 models were hidden) — now a presence check, backed by an actual solved
  `delivery-teaching-us` scenario in that test so the assertion has something real to find. Stale
  prose claiming Chapter 5 is hidden was corrected in both files.
- Documentation: `README.md` "six models" → seven (×2) plus the `solvers/` directory-tree line;
  `CLAUDE.md`'s "Six models live under `solvers/`" line → seven, and its `e2e_journey.py` "fully
  non-runnable" claim (accurate history through Bundle 2.2, stale since A13a's 2026-09-24 repair)
  corrected — independently confirmed runnable three times this task; `model-integration-precheck.md`
  Gate 1 grew from 10 to 19 numbered registration points (11–19 are the ones this integration found);
  the `docs/CHANGELOG-implementation.md` "Chapter 5 — nothing to commit" line (2026-09-26, above) was
  amended in place rather than rewritten — it was only ever true for the two retired models, not for
  this one; `attached_assets/NOTEBOOKS.md`'s Task-1-recorded sha256 hashes were independently
  re-verified against the committed files (`shasum -a 256`) and match exactly.

**Dependency audit re-run (Task 0 Steps 3/4, per Task 13 Step 5):** the `"delivery-teaching-us"`
literal-string probe sweep (48 hits, excluding tests/generated/e2e) maps cleanly onto the plan's R7
registration inventory with no unaccounted hit; a parallel `"max-coverage-us"` sweep differs from it
only where R7 predicts N/A (`referenceDistances.ts`/`autoDistance.ts` — this model supports
reference COSTS, not reference distances, and has no add/move Input-Map entities to estimate
distances for; `services/import.ts` — no importable entities; `services/Steps.ts` and the
`ch4-two-step`/`chen-bands-units-qa` specs — the two-step workflow is `max-coverage-us`-exclusive,
and `delivery-teaching-us` is correctly a `NON_STEP_MODELS` entry instead) plus each model's own
model-specific test/build-script files, which differ by name as expected.

**Full gate, run 2026-09-29:** `git diff --check` clean · `pnpm run typecheck` clean · api-server
**1594/1594** (3 files — `cors`, `jobRunnerDispatcher`, `resultEnvelope` — flaked under concurrent
dev-server/e2e load in the full run and passed 27/27 in isolation immediately after, matching
CLAUDE.md's own documented load-induced-flake list) · studio **2145/2145** (118 files) · `@workspace/units`
**30/30** · `@workspace/dataset-schema` **50/50** · solver pytest **301/301** · `e2e_accuracy.py`
**99/99**, run directly, unmodified · `e2e_journey.py http://localhost:3011 delivery` **42/42** · `pnpm e2e:gate`
**43 passed / 13 failed / 4 skipped**, run twice: once under concurrent dev-server/pytest load
(**41 passed / 14 failed / 1 flaky / 4 skipped**, with 2 of those — `chen-bands-units-qa`'s already-
flaky case and `workspace-fixups-2.spec.ts` — reproducing clean in isolation), then again against
freshly-started, uncontended dev servers, which landed exactly on **43/13/4** with the failed set
matching the 11-test-rot + 2-env-gap list byte for byte. Delta against the merged-tree baseline
(`42 passed / 13 failed / 4 skipped`): **+1 passed** (this task's new spec), **0 change** to the 13
known failures, **0 change** to skipped.

**One commit, per the dispatching agent's explicit instruction for this task:**
`[ch5-del-13] add the delivery e2e journey and complete the documentation closeout`.

**Amended (Chapter 5 delivery-teaching-us, whole-branch review fix pass, 2026-09-29):** two corrections
to the Task 13 entry above, per the branch's whole-branch review (M-7). Append-only per hard rule #9 —
the original text above is left as-is; this note supersedes it on these two points only.

1. **The "ten pre-existing registration points" list was wrong.** The entry above names them as
   "manifest, KNOWN_SCHEMAS, VALID_MODEL_IDS, PACKAGE_SPECS, buildPayload, openapi enums, solve.py
   dispatcher, precheck dispatcher, router mount, GET /dataset branch" — but `model-integration-
   precheck.md` Gate 1 numbers precheck dispatcher as point **13** and router mount as point **14**
   (both among the NINE points this integration discovered, not the original ten), and "GET /dataset
   branch" isn't a numbered Gate 1 point at all. The actual original ten (Gate 1 points 1–10) are
   points 1–8 as listed (manifest, dataset version, Zod schema, route allowlist, package spec, payload
   builder, openapi enum, solve.py dispatcher) plus **point 9 (override entity registration —
   import/export)** and **point 10 (map multi-select allowlist)**, neither of which this model ever
   registered — and neither was ever recorded as intentionally skipped. Recording that now: both are
   **N/A by design** for `delivery-teaching-us`. Point 9 (import/export entity registration) is N/A
   because this model's Delivery Costs tab is deliberately its only editable surface with no
   Upload/Download/Import toolbar at all (decision 11, Task 11 — see `DeliveryCostsTab.tsx`'s own
   header comment); there is no override entity to register into `services/templates.ts`/
   `services/import.ts`. Point 10 (map multi-select allowlist) is N/A because Task 9's Input Map for
   this model is read-only end-to-end (no add/move/delete/status/demand/Save affordance at all), so
   there is no selection/bulk-edit UI for a multi-select allowlist to gate in the first place.
2. **The api-server gate figure was rounded away from what was actually measured.** The entry above
   states "api-server **1594/1594**"; the number actually measured in that gate run was **1591/1594
   passed cleanly, plus 3 documented flakes** (`cors`, `jobRunnerDispatcher`, `resultEnvelope` — the
   same three files the entry already names as flaking under concurrent dev-server/e2e load), which
   were then independently confirmed passing 27/27 in isolation. "1594/1594" implies every test passed
   in that one run; the correct claim is 1591 passed outright with the remaining 3 accounted for by
   documented, reproduced-in-isolation flakes, not a clean 1594/1594.

### CI green for the first time, the 11 rotted e2e specs repaired, Compare made step-aware (2026-09-30)

Merged as `63713ba` (e2e repairs), `e7c06c6` (batch step loader), `7bab4f3` (its consumer fix).
Four tracked items, plus two review findings folded before push.

**CI had been red since at least `4cf3bc1` (2026-09-26) for one missing step.** The workflow
provisions Postgres 16 and sets `DATABASE_URL`, but never applied the schema — this repo has no
migration files — so the service started empty and every DB-touching suite died on
`relation "users" does not exist`. Attribution by failing-file count: **47** distinct failing test
files at `1761260` (pre-two-step), **51** at `0a300f8` (post) — a delta of exactly 4, matching the 4
DB-touching test files that bundle added. The bundle added files to an already-broken run; it never
introduced a failure mode. Fixed with a `pnpm --filter @workspace/db run push-force` step, verified
non-interactive against a fresh empty DB with stdin closed before being claimed safe.

**e2e now has real CI infrastructure** — Chromium, app boot, schema seeding — closing the
infrastructure half of the SKIP decision recorded 2026-09-12. Deliberately `continue-on-error: true`;
see `docs/ops/e2e-stale-specs.md` for what must happen before it can block.

**All 11 catalogued test-rot specs repaired**, 34/26 → **53 passed / 2 failed / 4 skipped**, a number
CI reproduced identically (so the gate is deterministic, not environment-sensitive). Two findings
beyond the catalogue: `import.spec.ts` had a second uncatalogued drift (exported CSV column order
changed; the spec hardcoded index 4 for `demand`, actually 7 — now located by header name), and
`transport-coal`'s negative assertions in `workspace-ux-r1-r9` were **vacuously passing** on testids
that never existed under those names. One is now a real testid, so that check bites for the first time.

`workspace-ux-r1-r9`'s band-draft assertion was testing **retired** behaviour, not a bug: SSC-T1
deliberately made ServiceStats bars live-recompute off unsaved `localInputs`. Verified in product
code before changing, and replaced with a positive assertion plus a zero-solve-network guard.

**Compare-list step-awareness** closed the gap deferred during the two-step bundle. That deferral's
N+1 reasoning did not survive measurement — production holds 83 scenarios, 0 Chapter 4, busiest user
10 — so one batched query replaces the feared per-row lookups. Each scenario carries its own
`stepEpoch`, so the snapshot epoch is selected as a column and compared per scenario in Node; the
whole-branch review traced monotonicity across all four `scenarios.inputs` writers and both
`jobRunner` scenario updates and confirmed the reasoning holds.

**Two review findings folded before push, both corrections to claims made in this work:**

1. The first merge commit's message states that real-CBC waits were "replaced with seeded results."
   **That is false** and is corrected here: no seeding was done in any spec, and the repair moved the
   other way (30s → 90s; `setTimeout(180_000)` with two real solves). No seeding helper exists in the
   repo, so honouring that half needs new infrastructure. Recorded as open in the ops doc.
2. The batch loader initially had **no observable effect**. The consumer chain existed —
   `CostSummaryTab` list rows reach `scenarioObjectiveModeCh4Aware`, which branches on `steps` — but
   the helper picked `step2.solved ? step2 : step1`, which *is* the last-solved step, the same answer
   `result.details` already gave. Worse, with `steps` present and both steps unsolved (the state after
   an epoch bump) both summaries are null and it fell through to `scenarios.result`, deliberately left
   stale, reporting a mode from a **discarded** solve — which can wrongly lock the compare selection.
   `7bab4f3` makes `steps` authoritative: present means authoritative, both-unsolved returns null.

**Process note.** The first attempt to merge this work landed on `ch4-ux-fixes` — another session's
branch — because `git rev-parse main` was read as if it were `HEAD`. Caught at the second merge's
conflicts, aborted rather than resolved, and that branch reset to its exact tip `6c33024`; nothing had
been pushed and no remote carried it. Redone in a dedicated `main` worktree with an explicit
`HEAD == main` guard before each merge, where **both merges applied with zero conflicts** — the
conflict had been entirely an artifact of the wrong target.
## Chapter 4 UX fixes — output lock, editable solve dialog, blocking solve overlay (`CH4UX-1`–`CH4UX-8`, 2026-09-30)

Branch `ch4-ux-fixes`, cut from `9a598db` (the then-tip of both local `main` and `origin/main`).
Implements `docs/superpowers/specs/2026-09-29-ch4-ux-fixes-design.md` and its
`docs/superpowers/plans/2026-09-29-ch4-ux-fixes.md` twin. Frontend only — the diff touches zero
files under `artifacts/api-server/`, `lib/`, or `solvers/`, and no OpenAPI/DB/solver change.

**Merged to `main` via `16021ec` (Chapter 5 integration merge).** Task 8's QA found a real,
branch-introduced regression in CH4UX-1 — a non-deterministic cold-mount step re-target — which was
fixed in `fa70517` before merge (see "Cold-mount regression, found and fixed" below). The gate,
harness-retro rows (`1ab4214`), and the merge itself (`16021ec`) are recorded in the per-task table.

### What each task landed

| Task | Commit(s) | Summary |
|---|---|---|
| CH4UX-1 | `d4bc931` | Chapter 4's sidebar Output rows are locked until Step 1 has solved (`keepOutputsClickable={isMaxCoverage && steps.step1.solved}`); `selectedStep` re-targets on scenario change via a render-phase `prevScenarioIdRef` adjustment. |
| CH4UX-2 | `09b8587` | `OptimizationParametersTab` ids/testids namespaced (`idPrefix`/`testIdPrefix`) so the component can be double-mounted. |
| CH4UX-3 | `d4a928f` | `SolveDialog` gains `paramsSlot` plus a scroll contract. |
| CH4UX-4 | `377b462`, `de4931c` | Chapter 4's Run Optimizer dialog renders the real `OptimizationParametersTab`, keyed on `stepState.targetStep` (what will RUN), not `selectedStep` (what is being VIEWED). `readOnlyParams` deleted. |
| CH4UX-5 | `09faa22` | New `SolveProgressOverlay` — a Radix `AlertDialog` (not `Dialog`, not a bare `fixed inset-0` div) owning `SolvePhase = idle\|saving\|solving\|failed`, with rotating quips (`lib/solveQuips.ts`) and the `useElapsed` clock. No cancel affordance: the API has no cancel endpoint, so offering one would be a lie. |
| CH4UX-6 | `9def8b6`, `69b2d91`, `7030b51` | The lifecycle moved out of `SolveDialog` into the overlay for **every** registered model (enumerated from the manifests, never a hardcoded count); the dialog closes on submit; `solveInFlightRef` is the real single-entry lock (the spec's three-guard list does not hold within one synchronous tick); `onOpenAutoFocus`/`onCloseAutoFocus` pin focus on both edges. |
| CH4UX-7 | `4619871`, `e8c55f1`, `795f8f8` | Seven e2e solve-completion waits re-pointed off the dialog's disappearance onto a durable per-run signal; new `e2e/solve-overlay-contract.spec.ts` (4 tests) makes modality, focus transitions and reduced motion deterministic by controlling the job response rather than racing CBC. |
| CH4UX-8 | `6c33024`, `fa70517`, `1ab4214`, `16021ec` | Gate, parent-baseline e2e comparison, real-browser QA, this entry (`6c33024`); the cold-mount regression fix (`fa70517`); harness-retro metrics/permissions rows (`1ab4214`); the merge of `origin/main`'s Chapter 5 (`ch5-delivery`) work into this branch, hand-resolving the delete-hunk-vs-modify-hunk conflict over `OptimizationParametersTab` (`16021ec`). |

Plan/spec-only commits on the branch: `f4dc9b8`, `6f1099c`, `edb9cfd`, `b2117a2`, `ef723de`,
`06b10f8`, `0c4c58c`, `8f9a657`, `e66121f`, `694a3a9`. `694a3a9` and `ef723de` also lifted the
governing merge-to-main pipeline into `CLAUDE.md`'s Branch-discipline section as standing operating
rules (not history — hard rule #9 respected).

### Verification gate — numbers observed on 2026-09-30, not copied from the plan

Run in a dedicated worktree against a dedicated throwaway Postgres (`nos_ch4ux8_unit`), because
several sibling worktrees' api-servers share `nos_dev` and steal each other's `solve_jobs`.

- `pnpm run typecheck` — **clean**, all four projects (`api-server`, `studio`, `mockup-sandbox`, `scripts`).
- `pnpm --filter api-server test` — **52 files / 1541 tests passed, 0 failed, 0 timeouts**, 55.3s.
  (A first run without `DATABASE_URL` set produced 14 suite-level `DATABASE_URL must be set`
  collection failures plus load-induced timeouts — an environment artifact, not a branch signal.)
- `pnpm --filter studio test` — **116 files / 2134 tests passed, 0 failed**, 83.8s, and
  **zero `Test timed out in 5000ms`**. Run exactly once, serially, with nothing else on the machine,
  per the known flake profile.
- `python3 -m pytest tests/ -x` (solver) — **282 passed**, 178.6s.
- `python3 e2e_accuracy.py`, run directly and unmodified (hard rule #2; it is not pytest-discovered)
  — **99/99 ✓ ALL PASS**. The solver is untouched by this branch; this run exists only to prove no
  accidental coupling, and it proves it.

### e2e — measured against a real parent baseline, not against CI's red-but-non-blocking job (pre-merge snapshot)

**This comparison is a pre-merge baseline, taken before `fa70517` (the cold-mount fix), the
`e2e-test-rot-repair` merge (`63713ba`), and the Chapter 5 merge (`16021ec`).** It is preserved
below for the record of what CH4UX-7/8 actually measured at the time; it does not describe the
branch's current state. In particular, `e2e/two-echelon.spec.ts` — one of the 13 "identical"
hard failures counted here — was repaired on `main` by `c25112c` and merged in via `16021ec`; see
"Known, not fixed by this branch" below for the corrected status.

The CI e2e job carries `continue-on-error: true` over a documented red baseline, so a green required
CI job proves nothing about browser acceptance. Both sides were therefore run as fully isolated
stacks: a `mktemp -d` locked worktree at `9a598db` with its own `pnpm install --frozen-lockfile`,
its own api-server (`:3011`) and vite dev server (`:5211`) and its own `nos_e2e_parent` database,
versus the branch on `:3001`/`:5199` against `nos_e2e_branch`. Both databases were truncated to an
empty schema first and both stacks health-checked (`/api/healthz` → `{"status":"ok","db":"ok"}`)
before Playwright started. Reports archived to `.harness/e2e-report-{parent,branch}` (gitignored)
before the next run could overwrite `e2e/report/`.

| | parent `9a598db` | branch `795f8f8` |
|---|---|---|
| passed | 41 | 45 |
| failed (`unexpected`) | 13 | 13 |
| flaky (passed on retry) | 1 | 1 |
| skipped | 4 | 4 |
| total | 59 | 63 |
| wall clock | 5.8m | 8.0m |

Compared by **stable identity** (project + file + title + terminal outcome) out of each run's
`results.json`, not by aggregate counts. The 13 hard-failure identities are a **byte-identical set**
on both sides — `bundle2-fastfollow` (transport-coal marker fill), `design-system` ×2, `import`,
`input-map-v2` ×2, `posthog-analytics`, `sentry-capture`, `tab-coverage` ×3, `two-echelon`,
`workspace-ux-r1-r9`. (`posthog-analytics`/`sentry-capture` are the two that need
`VITE_POSTHOG_KEY`/`VITE_SENTRY_DSN`, already documented as absent locally and in CI.) The 4
`skipped` on both sides are the JADE specs that cannot execute while `two-echelon-jade-us` is
`locked: true` in the committed manifest. The 4 branch-only tests are
`solve-overlay-contract.spec.ts`, all **passing**.

So the gate comparison says **zero new failures**. That conclusion is true of the gate and
insufficient as an acceptance signal — see below.

### Cold-mount regression — CH4UX-1 re-targeted `selectedStep` on cold load, non-deterministically — found and fixed

**Found by Task 8's QA, not by any suite. Fixed in `fa70517`, before merge.**

`Workspace.tsx`'s new render-phase adjustment read

```
const prevScenarioIdRef = useRef(currentScenario?.id);
if (currentScenario?.id !== prevScenarioIdRef.current) { …; if (stepState.isMaxCoverage) setSelectedStep(stepState.targetStep); }
```

On a **cold mount** `currentScenario` is still `undefined` (the query has not resolved), so the ref
initialises to `undefined`. When the query resolves, `id !== undefined` is true and the
"scenario changed" branch fires on FIRST LOAD, snapping `selectedStep` to `stepState.targetStep` —
which is **2** for a Chapter-4 scenario whose Step 1 is solved and Step 2 is not. Whether it fires
depends on whether the `useMaxCoverageSteps` projection has populated at that same commit, so the
outcome is a coin flip.

Measured A/B, same scenario, same action, 8 reloads each against the two isolated stacks:

- branch: selected step after reload = `[2,2,1,2,2,1,2,1]` — **5/8 landed on the unsolved Step 2**
- parent: `[1,1,1,1,1,1,1,1]` — **0/8**

User-visible effect on the ~60% of loads that land on Step 2: a student who solves Step 1 and
reloads sees `Not solved yet — Solve Step 2` in the open output tab instead of the Step 1 results
they just produced. The non-determinism is a defect independently of which step is the "right"
landing target.

Why nothing caught it: CH4UX-1's unit test
(`Workspace.test.tsx`, "switching to a 0-of-2 scenario with an output tab open re-targets the view
to Step 1") only exercises a **warm** A→B switch, where the ref already holds A's id. The cold-mount
path — ref `undefined` → first resolved id — has no coverage. And in the full 4-worker gate the
slower query ordering happened to land on Step 1, so the gate stayed green: `chen-bands-units-qa`'s
"unit toggle converts every distance surface…" test PASSED in the branch gate run but fails **10 of
16** isolated repeats on the branch against **0 of 7** on the parent, with a captured ARIA snapshot
showing `2. Min Distance [pressed]` and `Not solved yet — Solve Step 2`.

**The fix.** The code quoted above is superseded; the current guard
(`Workspace.tsx`, around the `prevScenarioIdRef` block) seeds the ref from a fixed `undefined`
sentinel rather than from `currentScenario?.id` (an asynchronously-resolved value), skips a `null`
id outright instead of recording it, and only re-points the view when a *previously-recorded* id
transitions to a different one — so first resolution of the initial scenario is never mistaken for
a switch. Mutation-proven both ways (reverting the fix fails the new cold-mount unit test); a
throwaway browser probe recorded `[2,2,2,2,2,1,2,2]` reverted vs `[1,1,1,1,1,1,1,1]` fixed across 8
reloads, and `chen-bands-units-qa.spec.ts` went from 4/4 failing its post-reload read reverted to
8/8 clean fixed. Full detail in `fa70517`'s commit message.

**Durable lesson (new bug class), kept because it generalizes beyond this one fix:** a green e2e
gate can hide a real regression when the regression is a *race* — gate conditions (4 parallel
workers, loaded machine) can systematically favour the passing branch of the race. An
identity-level parent-vs-branch comparison is necessary but not sufficient; any test that newly
becomes order/timing sensitive needs an isolated repeat count, not one gate run. Corollary for this
specific shape: a `useRef(someAsyncValue)` "did it change?" guard fires spuriously on the first
resolution, because the ref was seeded with the pre-resolution `undefined`. Seed such a ref with a
sentinel and skip the first transition explicitly, or key the guard on a value that is stable from
the first render.

### Real-browser QA (Step 4) — 47/51 checks pass

Driven through real Chromium against the live branch stack (not jsdom, not a repo spec — a
standalone driver, so nothing was left behind in `e2e/`). Both a Chapter-4 and a non-Chapter-4
model, with the job responses controlled for the modality/failure checks and a real CBC solve for
the success journey.

Settled, each of which had been verified only by construction or only in jsdom before:

1. **The dialog→overlay handoff in a real browser.** Confirmed: the dialog detaches within Radix's
   exit animation, `body { pointer-events: none }` and `data-scroll-locked` are both applied, the
   workspace carries `aria-hidden="true"`, and a real mouse click on the workspace behind the
   overlay is inert (tab count unchanged, overlay still up). After Close the body returns to
   `pointer-events: auto` with the scroll lock released — no stuck-modal state.
2. **Where focus actually goes.** On overlay open, `document.activeElement` is the overlay container
   itself (`role=alertdialog`, `tabindex=-1`) — not `<body>`, on all three runs. 12 consecutive Tab
   presses never leave it. On failure, focus lands on `solve-progress-adjust`; Adjust reopens the
   dialog with focus inside it; Close returns focus to `button-run-optimizer` with the trigger
   already re-enabled. Both edges hold in a real browser.
3. **Screen-reader announcement from the focused container** — verified at the accessibility-tree
   level, **not** with an actual AT. The focused node *is* the overlay container, the only
   `aria-live="polite"` region (`solve-progress-phase`) is a descendant of it, the clock is
   deliberately *not* live, the quip is `aria-hidden="true"`, and the computed ARIA snapshot is
   `alertdialog "Running the optimizer" › heading › paragraph "Solving…"`. Whether VoiceOver/NVDA
   actually speaks it is recorded as **`unknown`** — no AT was driven.
4. **The overlay on a non-Chapter-4 model.** Run end to end on `p-median-us` (`/chapter-3`),
   including the failure card, Adjust, Close and reduced motion. Identical behaviour to Chapter 4.

Rest of the checklist: Chapter-4 fresh scenario shows all five Output rows `disabled` +
`aria-disabled` + `cursor: not-allowed`, and a `force: true` click opens nothing; the Run Optimizer
dialog renders the editable Step-1 controls (`solve-dialog-slider-p-value`, high-service, max
distance, avg cap, gap, time limit, band chips), not a read-only summary; on success the overlay
clears, Output Map opens and all five Output rows are enabled; viewing Step 1, the dialog shows the
**Step 2** panel (`P (inherited)`, `Coverage floor (demand)`, no avg-cap control, no P slider);
opening the dialog on top of the Optimization Parameters tab renders both with **zero** duplicate
DOM ids and no console warning; Escape and a backdrop click are both inert while running; the quip
rotates and the clock ticks; under `prefers-reduced-motion: reduce` the spinner's computed
`animation-name` is `none` while the quip keeps rotating.

The 1 failing QA check is a harness artifact, not a product finding: the stubbed job route returned
a freshly-computed `startedAt` on every poll, so the clock appeared not to advance in one of three
runs; the other two runs of the same check passed, and the real-solver run's clock advanced
normally.

Two QA observations, neither a defect, both worth knowing:

- Escape on the **failed** card does not dismiss the overlay (only Close/Adjust do). The
  `onEscapeKeyDown` guard is scoped to `running`, but `AlertDialog`'s `open` is derived from
  `phase` with no `onOpenChange`, so Radix's own close is a no-op. Intentional in effect, but the
  code comment implies Escape would work there.
- The overlay sets `role="alertdialog"` but no `aria-modal`. Background inertness is achieved via
  `aria-hidden` on siblings instead, which is what Radix does; noted because the component's own
  header comment cites "exposes no `aria-modal`" as a reason for choosing `AlertDialog`.
- At a 700×300 viewport (≈200% zoom at 600px tall) both footer buttons and the deepest parameter
  (`solve-dialog-input-step2-time-limit`) are reachable and the body scrolls, but a workspace
  result tooltip paints **over** the dialog footer. Cosmetic, present at that viewport only.

### The two prior decisions this branch unwinds

Per the spec's §0, recorded here so the reversal is findable from either end:

- **CH4-18** — only the **pre-Step-1** half is reverted. Chapter 4's Output rows are no longer
  clickable before Step 1 has solved. The **post-Step-1** half is deliberately kept: with Step 1
  solved and Step 2 selected-but-unsolved the rows stay clickable and the existing
  `chapter4OutputGate` empty state does the talking.
- **CH4-17 / R5** — fully reverted. Chapter 4's Solve dialog is no longer confirmation-only, and
  `readOnlyParams` is **deleted** rather than left dormant (`max-coverage-us` was its only caller).
  The hazard R5 named — a Step-2-targeting student silently editing Step 1's `gap`/`timeLimitSec` —
  is removed by correctness instead of by removal: the dialog renders the step that will actually
  run, so a Step-2 run shows Step 2's own limits and Step 1's are unreachable from it.

### Durable lessons

- **A source-grepping test counts comments.** `Workspace.test.tsx`'s MIG-8 test reads
  `Workspace.tsx` as text and matches `/modelId === "max-coverage-us" \? (\d+)/g`. When CH4UX-6
  deleted the dialog's `pMax` arm, an explanatory comment that quoted the deleted line verbatim
  became the second match and kept the test green **for the wrong reason** — the assertion still
  saw two caps while the code had one. Describe a deleted arm; never quote it. The same regex also
  requires the ternary unbroken on ONE line, so reformatting silently drops a match. A source grep
  is not behavioural evidence; the real two-surface guard is the pair of DOM `aria-valuemax`
  assertions.
- **Radix modal focus must be pinned on BOTH edges.** The open side stranded focus on `<body>`:
  `SolveDialog` closes in the same commit the overlay opens, Radix restores focus to its trigger
  (`button-run-optimizer`) which `solvePhase !== "idle"` has just disabled, so `.focus()` no-ops and
  focus falls to `<body>` — outside a modal that has set `pointer-events: none` with Escape
  prevented. Fixed with `onOpenAutoFocus` (the documented Radix hook, fired after the content and
  its `FocusScope` exist; a `useEffect` keyed on `open` is a silent no-op because `Presence` has not
  mounted the content yet). The close side then reproduced it exactly: Radix restores to whatever
  was focused when the `FocusScope` MOUNTED — `solve-dialog-solve`, already detached by the same
  handoff — and restoring to a detached node is a no-op. Fixed with `onCloseAutoFocus`. Whenever one
  modal hands off to another in a single commit, assume both edges are broken until measured.

### Known, not fixed by this branch

- ~~`e2e/two-echelon.spec.ts` is dead against its own route~~ — **repaired.** It was one of the 13
  identical pre-merge failures measured above (Studio-only ids against a `workspace: true` route),
  but `main`'s `e2e-test-rot-repair` (`c25112c`) rewrote it onto the Workspace UI and it was pulled
  into this branch by the `16021ec` merge. `rg -n 'status-badge|button-solve'
  artifacts/studio/e2e/two-echelon.spec.ts` now returns nothing.
- **`readSolvedAt` is copy-pasted into 7 spec files** (`bundle2-fastfollow`,
  `jade-ch9-workspace-bundle`, `jade-two-echelon`, `posthog-analytics`, `workspace-fixups`,
  `workspace-fixups-2`, `workspace-ux-r1-r9`). CH4UX-7 had to edit the same helper seven times.
  `e2e/helpers/` exists and holds exactly one module (`modelLock.ts`); this belongs beside it.
- **Nothing typechecks `e2e/`.** `artifacts/studio/tsconfig.json` is `"include": ["src/**/*"]` and
  there is no linter over the directory, so every spec is reviewed rather than compiler-checked.

---

## 2026-09-30 — Postgres role investigation: Path A done, Path B closed won't-do

Triggered by the CH4UX harness-retro permission audit, which fired its gate on 13 risky
grants. Seven embedded a **live production Postgres password** for `nos_postgres_user`
in `.claude/settings.local.json`. Verified never committed (`git log --all -S` empty; the
file is gitignored and untracked) but confirmed still valid against production.

**Path A — executed, user-approved.** `ALTER ROLE nos_postgres_user WITH PASSWORD '<new
random 40-char>'`, the new password deliberately not retained. Verified three ways: the
leaked credential now fails auth, the new one succeeds, and `/api/healthz` stayed
`{"status":"ok","db":"ok"}` throughout — no redeploy needed, because `nos-api`
authenticates as `nos_postgres_user2`. The seven credential-bearing grants were then
removed (backup taken first).

**Path B — investigated, closed won't-do. The premise was wrong.** It was filed to migrate
object ownership to `nos_postgres_user2` and retire the old role, on the reading that "old
role owns everything, new role owns nothing" was leftover drift. It is not drift. Render
provisions a **login-shim pair**:

```
pg_db_role_setting:  nos_postgres_user2 | ALL DBS | {role=nos_postgres_user}
observed:            session_user=nos_postgres_user2   current_user=nos_postgres_user
```

`user2` is the credential Render hands out; it assumes the owner role on connect, so
everything it creates is owned by `nos_postgres_user` **by design**. That single fact
explains all three "symptoms": the old role owning all 21 public objects plus the `public`
schema, the tables' `<no explicit ACL>`, and `user2`'s membership in the old role.

Retiring the old role is therefore wrong rather than merely risky. `DROP ROLE` breaks every
`user2` connection (its `role=` default points at the dropped role), and `REASSIGN OWNED`
*creates* the ownership split it appears to fix, because new objects keep landing on the old
role via that same default. The distilled rule is now in `CLAUDE.md`'s Gotchas.

No structural change was made: Path A altered a password and nothing else. A pre-flight
`pg_dump` snapshot was taken before any Path B attempt and no `REASSIGN`/`REVOKE`/`DROP`
ever ran — a rolled-back dry run was prepared and then cancelled once the `role=` finding
landed.

**Process note.** An earlier turn in this investigation reported "Render's External URL
connects as the old role" after reading only `current_user`. `session_user` had been
selected in the same query and dropped from the output. The user corrected it; the two
differ precisely because of the shim. Read both role identities before concluding anything
about which principal a connection is using.

**Left open, deliberately:** the `DEFAULT PRIVILEGES` granting future objects to
`nos_postgres_user` are owned by the `postgres` superuser and changeable by neither role.
Under the shim model that is correct, not a defect. Worth one confirming question to Render
support rather than any action.

**One loose end created:** rotating a Render-managed role's password out-of-band desyncs
anything Render may store for it. Every signal says Render's canonical credential is `user2`
(external URL, `databaseUser`, the `fromDatabase` `connectionString`, and a healthy
`nos-api`), so nothing appears to depend on the old role's password — and a Dashboard reset
recovers it if something does.
## Chapter 5 delivery rework, Rev 2.1 (`ch5-edit-0`–`ch5-edit-9`) — five input tabs, `fixedGeography` map, registry set-equality test (2026-09-29)

The `ch5-del-1`–`ch5-del-13` entry above (and its whole-branch-review amendment) covers the FIRST
`delivery-teaching-us` implementation. A subsequent plan revision (`ch5-delivery-plan-review`,
"Rev 2.1") reopened the model's Input Map from fully read-only to `fixedGeography` (geometry still
fixed — no add/move/delete — but facility status and customer demand/exclusion now editable via two
new Warehouses/Customers tabs, mirroring every other p-median-shaped model) and rebuilt tasks 0–9 on
top of the merged `ch5-del` work as `ch5-edit-0`–`ch5-edit-9` (commits `dbf3418`…`3a2dfa2`, this
entry's task numbering restarts at 0 for the new plan revision, not a duplicate of `ch5-del-0`). This
entry records Task 9, the rework's closeout — the first CHANGELOG entry any `ch5-edit-*` task has
written (Tasks 0–8 landed their own commits/tests but deferred the changelog write to this task).

**Task 9 — three pieces:**

1. **`artifacts/studio/e2e/delivery-teaching.spec.ts` rewritten.** Task 5 (`c642954`) widened the
   sidebar from three input tabs to five and deliberately left this spec red (it hard-coded exactly
   `input-map`/`deliveryCosts`/`optimization-parameters`) for this task to close. Rewritten to assert
   all five tabs (`input-map`, `warehouses`, `customers`, `deliveryCosts`, `optimization-parameters`),
   keep the pre-existing `button-input-map-place-wh` count-0 assertion (geometry still fixed — Task 6
   renamed the map's `readOnly` prop to `fixedGeography` but never lifted the geometry gate, only
   status/demand), and add two new real-CBC journey steps: set DC W1 `inactive` on the Warehouses tab
   → re-solve → W1 leaves the open set, assignment count stays 313 (mirrors
   `test_delivery.py::test_inactive_keeps_a_warehouse_out`); exclude customer C1 on the Customers tab
   → re-solve → assignment count drops 313→312 (mirrors
   `test_delivery.py::test_excluded_customer_is_absent_from_assignments_and_metrics`). Six real CBC
   solves total now (was four) — still cheap (this model solves in 2–4s), so no departure from
   `max-coverage-us`'s "one real solve" discipline is needed here, same rationale the spec's own header
   comment already gave for the original four.
2. **`artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts` completed**, not rebuilt — the
   file already existed and asserted `MODEL_IDS ≡ KNOWN_MODEL_IDS ≡ VALID_MODEL_IDS ≡ PACKAGE_SPECS`,
   all four OpenAPI enum sites, and `chapters.ts`'s `StudioModelType`. Two gaps closed: (a) its first
   `it(...)` title named `KNOWN_SCHEMAS` but the body never touched that symbol (only its already-
   derived shadow, `KNOWN_MODEL_IDS`) — `KNOWN_SCHEMAS` was a module-private `const` in
   `modelRegistry.ts`, so closing this required exporting it (one-line addition, `KNOWN_SCHEMAS` now
   `export const`) and asserting `new Set(Object.keys(KNOWN_SCHEMAS))` directly, with the title
   corrected to name every symbol the body actually checks. (b) `solve.py`'s dispatcher — the one
   registration point on the Python side, and the one whose omission fails silently at runtime rather
   than at typecheck — was entirely unasserted. Added a second `it(...)` that reads `solve.py`, isolates
   the `def solve(inp):` function body, regex-extracts every `model_type == '...'` branch, and compares
   that set against a literal `WIRE_MODEL_TYPE_BY_MODEL_ID` map (`p-median-us` → `p_median`,
   `p-median-brazil` → `capacitated_pmedian`, `transport-coal` → `transport`,
   `two-echelon-gold-au` → `two_echelon`, `two-echelon-jade-us` → `two_echelon_jade`,
   `max-coverage-us` → `max_coverage_us`, `delivery-teaching-us` → `delivery`) mirroring
   `pmedian.ts`'s `buildPayload` translation 1:1 — the wire values are deliberately different strings
   from the public model ids (MIG-21), so a direct string-set comparison against `MODEL_IDS` was never
   possible; `satisfies Record<(typeof MODEL_IDS)[number], string>` makes the TS compiler itself refuse
   to typecheck if a future model id is added to `MODEL_IDS` without a corresponding wire-value entry
   here. **Mutation-tested per the review protocol:** deleting `"delivery-teaching-us": deliveryInputsSchema`
   from `KNOWN_SCHEMAS` turned the first `it` red (`Set{…5} ≠ Set{…6}`, missing `delivery-teaching-us`);
   deleting the `if model_type == 'delivery': return solve_delivery(inp)` branch from `solve.py` turned
   the second `it` red (`Set{…6 wire values} ≠ Set{…7}`, missing `delivery`). Both mutations reverted
   after confirming red; final state re-verified green (4/4 tests, `pnpm run typecheck` clean).
3. **This entry.** `model-integration-precheck.md` was left untouched — no Gate 1 registration
   mechanism changed (this task only added test coverage and exported an already-existing internal
   map; it registered nothing new).

**Full gate, run 2026-09-29 (dev servers started fresh for this task on `:3011`/`:5180` from THIS
worktree — the `:3001`/`:5399` pair the dispatching brief pointed at turned out to belong to an
unrelated concurrent session's `.worktrees/e2e-repair` checkout, confirmed via `lsof`+`cwd`; using it
would have run `e2e_journey.py`/`pnpm e2e:gate` against the wrong branch's server, which the
dataset-fetch 400 on the first attempt against `:3001` actually caught in real time):**

- `git diff --check` clean.
- `pnpm run typecheck` clean across all workspace projects.
- `DATABASE_URL=... pnpm --filter api-server test`: **1601/1607** in the full run (3 files —
  `cors`, `resultEnvelope`, `dispatcherRecovery` — flaked under concurrent load, all three already on
  CLAUDE.md's documented load-flake list); re-run in isolation immediately after: **43/43 clean**
  (`cors` 3/3, `resultEnvelope` 13/13, `dispatcherRecovery` 27/27). Effectively 1607/1607.
- `pnpm --filter studio test`: **2168/2168** (119 files) — byte-identical to the recorded baseline
  (`ee5174c`…`3a2dfa2`), confirming the e2e/registry changes touch nothing under unit-test coverage.
  `ps aux | grep -c "[v]itest"` was 0 before this run, per the documented cross-session contention
  gotcha.
- `(cd .../solver && python3 -m pytest tests/ -q)`: **309/312** in the full run (3 failures, all
  `test_transport.py::TestSingleSource`, under concurrent load — this session's own `e2e_accuracy.py`
  was running in parallel); re-ran `test_transport.py` alone immediately after: **24/24 clean**.
  Effectively 312/312, matching the branch baseline.
- `(cd .../solver/tests && python3 e2e_accuracy.py)`: **99/99**, file unmodified (hard rule #2).
- `(cd .../solver/tests && python3 e2e_journey.py http://localhost:3011 delivery)`: **42/42** — this
  section's first confirmed run under the current plan revision (the dispatching brief noted it had
  no prior baseline); full auth + dataset (33 DCs/313 customers) + Scenario 1 (weightedAvgDistance in
  `[400,450]`) + toggle-on Scenario 2 (`[490,530]`) + cleanup, all real CBC solves.
- `pnpm e2e:gate` (against the two servers started for this task, `E2E_BASE_URL=http://localhost:5180`,
  default 4 workers): **41 passed / 14 failed / 1 flaky / 4 skipped** (60 total). The rewritten
  `delivery-teaching.spec.ts` is the **1 flaky** entry (failed once on `output-map-tab` visibility at
  a 60s timeout while three other specs were mid-solve on the other three workers — `chen-bands-
  units-qa.spec.ts` alone ran 5.2m in this same gate — then passed on retry); re-run in total isolation
  (`--workers=1`, no contention) immediately after: **2/2 passed, 16.1s**, confirming the rewrite
  itself is correct and the flake is concurrent-CBC-load contention, not a spec defect. Of the 14
  hard failures, 13 are the pre-existing, explicitly out-of-scope set this task was told not to touch
  (`bundle2-fastfollow.spec.ts`, `design-system.spec.ts` ×2, `import.spec.ts`, `input-map-v2.spec.ts`
  ×2, `tab-coverage.spec.ts` ×3, `two-echelon.spec.ts`, `workspace-ux-r1-r9.spec.ts`, plus the two
  local-env-gap specs `posthog-analytics.spec.ts`/`sentry-capture.spec.ts` needing
  `VITE_POSTHOG_KEY`/`VITE_SENTRY_DSN`).
  **One failure is new and NOT part of that pre-existing set: `bundle6.1-legend-distances.spec.ts:113`
  ("Input Map: one map-legend box, demand-bucket swatches size-encode and fit their cells") —
  `legend-demand-bucket-*` count is 0.** Re-ran in isolation (`--workers=1`): fails identically both
  attempts, same assertion, same line — deterministic, not a load flake. Root cause (not fixed here,
  out of this task's scope): `ch5-edit-8` (`a339644`, landed immediately before this task, unrelated
  to Task 9's own changes) flipped "Size customers by demand" from checked to unchecked **by default**
  across every model; the Input Map legend's demand-bucket swatches only render while that layer is
  on, so a spec asserting the legend shows bucket cells **without first turning the toggle on** now
  finds none. This is exactly the standing CLAUDE.md gotcha ("a UI-changing bundle silently breaks
  PRIOR bundles' Playwright e2e specs — rewrite the sibling specs before merge") — `ch5-edit-8`'s own
  gate (typecheck + studio unit tests only, per its own report) could not have caught this, since
  Playwright specs aren't in `pnpm --filter studio test`. Flagged here for the orchestrator to triage
  (fix the spec to turn the layer on first, since a default-off toggle with a legend that only shows
  its own layer's content is arguably correct product behavior, not a bug) — left unmodified per this
  task's explicit instruction to touch only `delivery-teaching.spec.ts` among the e2e suite.

**Deviation from the brief's file list:** `artifacts/api-server/src/registry/modelRegistry.ts` gained
one line (`const KNOWN_SCHEMAS` → `export const KNOWN_SCHEMAS`) beyond the brief's three-file list
(`delivery-teaching.spec.ts`, `modelIdSetEquality.test.ts`, the two docs). Required to import the
symbol into the test at all — per CLAUDE.md hard rule #8, the smallest correct fix, recorded here in
the same commit as the work.

Commit: `[ch5-edit-9] rewrite the delivery e2e journey and add the registry set-equality test`.

## Chapter 5 delivery rework — warehouses/customers CSV export/import (`ch5-edit-11`) (2026-09-29)

The whole-branch review that produced `ch5-del-fix` (see the entry above) surfaced a brand-new
broken affordance introduced by Rev 2.1's §14 Warehouses/Customers tabs (`ch5-edit-0`–`ch5-edit-9`):
`WarehousesTab`/`CustomersTab` render CSV Download/Upload buttons whenever passed a `scenarioId`
(`Workspace.tsx`'s call sites for `delivery-teaching-us` do), but `routes/scenarios.ts`'s export/import
allow-lists never included `delivery-teaching-us` — every one of those buttons 422'd
("Export/Import is not supported for this model"). The human was offered a choice between hiding the
buttons and implementing the feature, and chose to implement it. This task builds it — input entities
only (warehouses/customers); output-entity exports (assignments/openWarehouses/costSummary/
serviceStats) already worked and are untouched.

**What shipped:**

1. **`services/templates.ts`** — `applyDeliveryWarehouseOverrides`/`applyDeliveryCustomerOverrides`,
   modeled on `applyMaxCoverageWarehouseOverrides`/`applyMaxCoverageCustomerOverrides` (the closer
   analogue per the brief: also no capacity concept). `capacity` is always `null` on export (this
   model's `capacityModes: []`, and `warehouseOverrideSchema` deliberately has no `capacity` field —
   see `validation/inputs/delivery.ts`'s own header comment). UNLIKE every other model sharing these
   entity names, `deliveryInputsSchema` has no `addedWarehouses`/`addedCustomers` field at all, so
   these two functions take only the override array — no second `added*` parameter, and they never
   append an added-entity row.
2. **`services/import.ts`** — `delivery-teaching-us` wired into the existing baseline-dispatch ternary
   for both `warehouses` and `customers` (reusing `applyDeliveryWarehouseOverrides`/
   `applyDeliveryCustomerOverrides` as the diff baseline, the same generic single-id-row machinery
   every other model already uses — no new/second id-validation path, per the brief's explicit
   instruction to reuse `parseAndValidateImport`'s existing baseline-membership idiom rather than
   inventing one; `precheckDeliveryInputs` in `services/precheck.ts` — added earlier this branch by a
   concurrent fix — validates the same dataset at solve time, and both now source id-membership from
   the same `DELIVERY_WAREHOUSES`/`DELIVERY_CUSTOMERS` dataset module, never a second copy). `canAdd`
   gained an explicit `modelId !== "delivery-teaching-us"` exclusion for the `warehouses` half (the
   `customers` half was already model-gated to a whitelist that never included delivery) — this is the
   first model on the `warehouses` entity with no add-entity schema field at all, so a blank id must
   fall through to the generic "Unknown id" rejection rather than minting a record nothing would ever
   persist (an add-mode write would silently strip at the Zod layer, non-strict per DD-8 — worse than
   never producing it).
3. **`routes/scenarios.ts`** — `delivery-teaching-us` added to the export allow-list, both import
   allow-lists (`POST .../import` and `POST .../import/apply`), and their respective big model
   OR-lists, all scoped to `entityIsDelivery = warehouses/customers only` (this model's
   distance-bearing entity is `laneCostOverrides`, out of scope for this pass — a `distances` or
   `laneCosts` export/import request now 422s explicitly rather than silently falling through to the
   p-median dataset). A new `delivery-teaching-us` export branch mirrors the `max-coverage-us` branch
   immediately above it, minus the `distances` sub-branch, reading only
   `warehouseOverrides`/`customerOverrides` off `scenario.inputs`. The per-entity output-grid guard at
   the top of the export route (`:712` in the brief's line numbers) needed no change — it gates
   `OUTPUT_ENTITIES` (assignments/openWarehouses/etc.), which `warehouses`/`customers` were never part
   of.
4. **A stray `capacity` CSV value is dropped, not rejected — deliberate, tested.** `ENTITY_HAS_VALUE`
   in `import.ts` is keyed by entity name only, not model, so the `warehouses` entity's capacity column
   is still physically present in a delivery CSV (always blank on export) and a value typed into it
   still parses without error. The merge layer (`mergeChangesIntoOverrides`, also model-agnostic)
   still attaches a `capacity` key to the merged override row. `deliveryInputsSchema`'s
   `warehouseOverrideSchema` is non-strict (DD-8) and has no `capacity` field, so
   `applyScenarioInputWrite`'s revalidation silently strips that key before persistence — the exact
   same mechanism `max-coverage-us`/`two-echelon-jade-us`'s own capacity-less warehouses already rely
   on, reused rather than reinvented. Covered by an HTTP-level test asserting the persisted
   `db.update().set()` payload has no `capacity` key.
5. **Zero demand vs. exclusion, proven distinguishable through a real round trip.** `demand: 0` (still
   in the model, still assigned) and `status: "excluded"` (removed) are independent fields end to end:
   `applyDeliveryCustomerOverrides`'s `o?.demand ?? c.demand` fallback only triggers on
   `null`/`undefined` (not `0`, since `??` — not `||` — is used), so an explicit zero demand override
   survives export/import unchanged, and a customer can carry both a demand override AND `excluded`
   status simultaneously without either field being lost.

**Test coverage (grep `ch5-edit-11` for the new blocks):**

- `src/__tests__/import.test.ts` — 9 new unit tests on `parseAndValidateImport` directly: a real
  warehouse (`W8`) UPDATE, a real customer (`C269`) demand-0 UPDATE (a genuine change, not a no-op), a
  status-only exclusion distinct from a demand override, add-mode NOT reachable for either entity
  (blank id → `Unknown id`, not an implicit add), unknown ids for both entities rejected by name, a
  stray capacity value parsing without error (dropped later, not here), and the shared header-check
  machinery still enforced. 134/134 in this file (was 125 pre-task).
- `src/__tests__/importMultiModelRoundTrip.test.ts` — 9 new HTTP-level tests against the real,
  unmocked route/merge/Zod-revalidation pipeline (only the DB persistence layer is mocked): own-dataset
  export resolution (33 warehouses/313 customers, no capacity column), a sibling model's entity and the
  out-of-scope `distances` entity both 422, import preview resolves the own dataset with unknown ids
  rejected end to end (no DB write), a blank-id add attempt rejected end to end, and — the requirement
  called out explicitly by the brief — **two genuine round-trip tests that export from one scenario and
  import/apply into a DIFFERENT, initially-empty scenario** (not re-importing into the same scenario,
  which would pass trivially even if a field were silently dropped, since "no change" and "change
  dropped" are indistinguishable when source and target start identical): warehouse status overrides
  (`inactive`/`forced_open`) round-trip byte-identically, and customer demand-0 + a demand+exclusion
  override round-trip byte-identically while staying distinguishable from each other. Plus the stray-
  capacity persistence test from point 4 above. 50/50 in this file (was 41 pre-task).

**Mutation-tested per the brief's explicit instruction, both reverted after confirming red:**

1. **Dropped `status` silently** — `mergeChangesIntoOverrides` (`routes/scenarios.ts`) edited to write
   `status: "active"` unconditionally instead of `c.after.status`. Result: both new round-trip tests
   went red (plus one pre-existing `max-coverage-us` distanceBands test, confirming the mutation's
   blast radius was real and not narrowly targeted at delivery). Reverted; suite back to green.
2. **Accepted an unknown id silently** — the `else` branch in `import.ts`'s uid-identity-model dispatch
   (a non-blank id matching neither `baselineById` nor `addedById`) edited to fall through as if it were
   a known baseline row instead of erroring. Result: 11 tests went red — the 2 new `import.test.ts` unit
   tests and 1 new HTTP-level test for delivery, plus 8 pre-existing tests for other models (proving the
   check is genuinely shared, not delivery-specific dead code). Reverted; suite back to green.

**Verification (this task's own file set only — `import.test.ts`, `importMultiModelRoundTrip.test.ts`,
`templates.test.ts`, `deliveryContract.test.ts`, `routes/scenarios.ts`, `services/import.ts`,
`services/templates.ts`):**

- `pnpm --filter api-server run typecheck`: clean.
- `DATABASE_URL=... npx vitest run src/__tests__/import.test.ts src/__tests__/importMultiModelRoundTrip.test.ts src/__tests__/templates.test.ts src/__tests__/deliveryContract.test.ts`:
  **367/367**.

**Provisional, not authoritative — run concurrently with two other in-flight dispatches sharing this
worktree** (a review-fix pass touching `validation/inputs/delivery.ts` — adding a duplicate-id guard,
explicitly out of scope for this task per the brief — plus `registry/modelRegistry.ts`, `solve.py`,
`modelIdSetEquality.test.ts`; and a separate `Workspace.tsx`/e2e dispatch): the full
`pnpm --filter api-server test` / `pnpm --filter studio test` / solver pytest gate was deliberately
**not** run standalone by this task, since it would include those two dispatches' in-flight,
not-yet-committed edits and any failure there would be unattributable. The coordinating session runs
the authoritative full gate once all three dispatches have landed.

**No OpenAPI/codegen change** — `scenario.inputs` stayed free-form by design (per the brief), and no
DB schema change was needed (zero-migration guarantee intact). `validation/inputs/delivery.ts` was not
touched, per the brief's explicit instruction (a concurrent dispatch owns it this same branch).

Commit: `[ch5-edit-11] support warehouse and customer CSV export/import for delivery`.

---

## Chapter 5 editable inputs — retro: ten assertions that could not fail (`ch5-editable`, 2026-09-30)

Closeout for the `ch5-edit-0`–`ch5-edit-12` line, merged to `origin/main` as `fda2ee7` and live on
both Render services. Metrics: `tasks.csv` row `ch5-editable` (18 dispatch cycles, 882 wallclock
min, 4 e2e runs); three `failures.csv` rows (`flaky_test`, `spec_gap`, `merge_conflict`), each
pointing at an already-drafted gate. **The permissions row is deliberately absent, not zero** — see
the last section.

This entry exists because the execution ledger (`.superpowers/sdd/progress.md`, 953 lines) is
gitignored scratch and dies with its worktree. The outcomes are already recorded above; what
follows is the part that would otherwise be lost.

### The single recurring defect: assertions that could not fail

**Ten of this branch's findings were tests, checks or claims that no possible implementation could
have made red.** Not a coincidence — a pattern worth naming, because every implementation on this
branch was sound on first or second pass while the things *verifying* them repeatedly were not.

1. **A golden numerically identical to its baseline.** The §14 demand-override golden targeted `C1`.
   Every one of the 33 warehouses sits at distance `0.0` from some customer, and `C1` is co-located
   with `W1` (both Los Angeles) — so scaling `C1`'s demand leaves the objective unchanged to the last
   digit. A test asserting that objective passes with demand overrides **ignored entirely**. Re-pinned
   on `C10` (nearest warehouse 59.2 mi): objective +1,003,105,680.90, weighted average −27.2568 mi.
   `C1` kept as `G1b`, labelled non-discriminating.
2. **A metric claim that was arithmetically impossible.** The spec and plan both said exclusion and
   zero demand "produce genuinely different metrics". Measured, they are **identical to the digit** on
   objective, open set, weighted average and all four band percentages — for a co-located customer and
   a non-co-located one alike, because a zero-demand customer contributes `0` to the numerator *and*
   the denominator exactly as an absent one does. The planned test asserting the averages differ would
   have **failed against a correct solver**. The real distinction is membership: 313 assignments
   versus 312. Corrected in §14.3, §14.6, the plan's Global Constraints, and the solver tests.
3. **A band-sum assertion that cannot hold.** Band rows are cumulative (`if d <= b`) and the overflow
   row is exclusive, so for bands `[100, 200]` they sum to `100 + P≤100`, never 100. The plan asserted
   100.
4. **A parity test comparing only `required`.** `deliveryContract.test.ts` checked the manifest's
   `inputsSchema` against the Zod schema by comparing `required` keys — and both new override arrays
   are optional on both sides, so the manifest shipped without them while the test passed. Now compares
   the full property key set; **mutation-verified** by deleting a key and watching 2 tests go red.
5. **A map handler wired to an empty function.** `PMEDIAN_MAP_READONLY_NOOP` received every status and
   demand edit. The decisive detail: when the noop wiring was restored as a mutation, the
   component-level suite stayed **13/13 green** — it supplies its own `onInputsChange` and never renders
   `Workspace.tsx`, so it is *structurally incapable* of catching this class. Only a Workspace-level
   integration test caught it.
6. **A test title naming a symbol it never imported.** `modelIdSetEquality.test.ts`'s title claimed
   `KNOWN_SCHEMAS`; the body asserted `KNOWN_MODEL_IDS`. Then the "fix" asserted
   `Object.keys(KNOWN_SCHEMAS)` — which `modelRegistry.ts:48` *defines* `KNOWN_MODEL_IDS` as, making
   the new assertion tautological too. Removed; the `solve.py` dispatcher half was kept as genuine
   coverage (mutation-verified both ways).
7. **An e2e spec depending on a default it never asserted** (`bundle6.1-legend-distances`,
   `workspace-ux-r1-r9`) — see the `spec_gap` row.
8. **A `ps` count that always included its own wrapper.** The "require 0 concurrent vitest" rule this
   branch added to CLAUDE.md used a command matching the agent's own `zsh -c` wrapper, reporting 2 when
   the answer was 0 — an unsatisfiable gate, authored by the controller.
9. **A server check that proved only that a port answered.** `curl /api/health → 401` was reported as
   "both servers verified up". They belonged to a *different worktree's* session;
   `/api/dataset?modelId=delivery-teaching-us` returned `400 Unknown modelId`. Found by an implementer
   via `lsof`, not by the controller.
10. **A gate criterion comparing failure NAMES, not reasons** — see the `spec_gap` row.

**Standing remedy, adopted mid-branch and worth keeping:** every task brief from Task 4 onward told
the implementer that the controller mutation-tests the tests, and asked them to break their own work
deliberately and report which tests caught it. Tasks 1 and 2 each needed a fix round; Tasks 3, 4, 5,
7, 8 came back clean on first review. Mutation results also revealed *shared-code blast radius* that
a pass/fail count hides — dropping `status` on CSV import reddened a pre-existing max-coverage test;
accepting an unknown id reddened 8 pre-existing tests across other models.

### Counting a shared symbol is harder than it looks

`sizeByDemand`'s site count was stated **four times before it was right**: 4 (plan), 9 (review), 15
(fold), and finally **14 lines carrying 18 literals** across three files. Two distinct errors
compounded: the four `useState` initializers hardcode `sizeByDemand: true`, so no `?? true` fallback
ever evaluates in a mounted component — the review's proposed fix of flipping only the fallbacks
would have changed **nothing at all**, not the checkbox and not the markers; and the four
`LayerCheckbox` lines carry two literals each, which is the line-vs-literal conflation behind the
9-vs-15 gap. Lesson: for a shared symbol, state exact lines plus a verifying command, never a total
someone must re-derive. Task 0's consumer census (count first, mismatch is a stop-and-report) exists
for this and found three capability-flag sites the plan had missed.

### Controller errors worth keeping

Recorded because they are the reusable part, and all five were caught by implementers or by measuring
rather than by review prose: (1) the non-discriminating server check, item 9 above; (2) the
miscounting `ps` command, item 8; (3) **three agents dispatched into one worktree in parallel** —
disjoint files but a shared index, where `AGENTS.md` prescribes pre-created locked worktrees per task;
no damage only because all three staged by explicit path after a mid-flight warning; (4) a changelog
conflict resolver matching a bare seven-equals prefix, which also matches markdown setext heading
underlines — it **corrupted the file while reporting success**, and the correct redo revealed two
conflict regions rather than one; (5) a consumer census whose own output named a stale fixture the
controller then omitted from the plan.

### Deliberately not done

- **`permissions.csv` has no `ch5-editable` row.** `harness:permissions` resolves
  `.claude/settings.local.json` against the cwd; run from a worktree it reads an empty allow-list and
  writes `0 risky`, which is indistinguishable in the CSV from a clean audit. `ch5-delivery`'s earlier
  row is already annotated INVALID for exactly this. An absent row is honest where a zeroed one is
  not — "never fabricate a metric". Needs one run from the shared checkout, alongside re-running
  `ch5-delivery`'s.
- **`solve_jobs.queuedAt`/`startedAt` are timezone-naive** `timestamp` columns (no `withTimezone`).
  Locally every displayed solve time was wrong by the session offset (7h). Pre-existing, affects all
  models, **unverified against the production Postgres**. Found incidentally during QA.
- **Infeasible reporting is now truthful in the data and on the Output Map** (`ch5-edit-12` gates the
  overlay on `hasIncumbent`), but `SolveDialog` still treats an infeasible solve as a succeeded job and
  auto-navigates. Left as-is: pre-existing, all models.

Commits: `dbf3418`…`fda2ee7`. Merged `fda2ee7`; `nos-api` `dep-dau7efdg1s2s73bosk4g`, `nos-studio`
`dep-dau7ege0tbcc739tpc30`, both live, both manually triggered — **autoDeploy did not fire** despite
`autoDeployTrigger: commit`, 75s after the push.

---

## Amendment to the `ch5-editable` retro — permissions audit closed out (2026-09-30)

Completes the one item the retro entry above recorded as deliberately absent.

**`permissions.csv` now has a real `ch5-editable` row**, run from the shared checkout as required:
`allow_total 882, allow_new 0, denials_in_window 6 (top: AskUserQuestion), broad 101, risky 13`.
Contrast the `ch5-delivery` row, written from a worktree against an empty allow-list, which reads
all zeros and is annotated INVALID.

**The gate fired — 13 risky grants — and was adjudicated by the human rather than by an agent.**
Per `harness-retro`'s rule, no grant was narrowed or removed by this session. The 13, by rule:

| rule | grants |
|---|---|
| `arbitrary_sql` | `psql *`, `PGPASSWORD="" psql *`, `DATABASE_URL="…nos_dev" psql *` |
| `push_remote` | `git push *` |
| `secret_exposure` | `env`, `gh secret *`, and six auth `curl` grants (five `localhost:5099`, **one against production `nos-api-uwf8.onrender.com/api/auth/register`**) |
| `whole_tool_grant` | `WebSearch` |

**Human decision:** `whole_tool_grant` (`WebSearch`) **passed**. The remaining **12 are held** — still
granted, still flagged, not yet ruled on. Two carry more risk than their siblings: the production
`curl` is the only one pointed at the live API rather than localhost, and `psql *`'s unbounded
trailing wildcard is unscoped database access, made more live by the recent Postgres credential
rotation.

**`ch5-delivery`'s row is closed won't-fix, not deferred.** Re-running refuses as a duplicate, and
forcing it would write `allow_new: 0` — because that branch's window (Sep 28–29) closed *before* the
`CH4UX` audit at `2026-09-29T22:37`, which absorbed its grants into its own `allow_new: 64`. The
baseline needed to reconstruct the true number no longer exists. An INVALID annotation is the
accurate record; a forced row would be a fabricated metric, which the harness invariants forbid.

**Method note worth keeping.** The 13 were enumerated by re-applying the audit's own six
classification rules (`scripts/src/harness/lib/permissions.ts`) to `settings.local.json` in a
separate read-only pass, rather than re-running the audit — a second run appends a duplicate row and
rebaselines. The independent count came to exactly 13, matching the audit, which is what makes the
list above trustworthy rather than merely plausible.

Task 10 complete: QA, whole-branch review, three fix waves, merge, push, deploy of both services,
metrics row, three failures rows, retro entry, and a valid permissions row.

---

## ch9-unlock — Chapter 9 (JADE) reopened to students; no chapter is locked any more (2026-09-30)

Branch `unlock-ch9` off `main` (`cd2bb9b`). Reverses the Chapter 9 half of ch4-lock (2026-09-22),
mirroring ch4-unlock (2026-09-26). JADE was the last locked chapter, so **the locked set is now
empty** — and that, not the unlock itself, is what made this more than a two-line change.

**The product change is two lines** — `"locked": true` deleted from
`solvers/two-echelon-jade-us/manifest.json`, and `locked: true` deleted from `chapters.ts`'s Chapter
9 entry. Nothing in the lock machinery moved: `middlewares/lockedModel.ts`, the per-handler guards,
`App.tsx`'s route guard and Landing's card/history rendering are all data-driven off those two
declarations. Both edits were made with `perl` on the single line, so the diffs are one deletion
each and not a whole-file reformat.

**The lock machinery is deliberately RETAINED with nothing locked.** Deleting it was the alternative
and was rejected: ch4-lock's Stage A quiesce (lock → drain jobs → delete rows → cut over) is the
documented pattern for any future dataset migration, and it is the server-side half that actually
holds. Retaining unused enforcement has a cost, though — the tests that covered it would go quiet —
so each one was repointed at a synthetic lock rather than deleted.

**Tests that had encoded "Chapter 9 is locked" as fact**, each rewritten to the new truth:
- `lockedChapterDrift.test.ts` — the tripwire fired exactly as designed. Its "not vacuously empty"
  guard existed so that deleting `locked` from both sides could not pass on two empty sets, which is
  precisely what a legitimate full unlock now does. Rewritten to assert the **scan** works (manifests
  found, parsed, each carrying a `capabilities` object) instead of asserting the **result** is
  non-empty, so an honest unlock passes while a dead scanner still fails. The set assertion now
  expects `[]` on both sides, and is the standing statement of what ships.
- `routes.test.ts` — the 11-assertion server-side lock suite keeps running, now against a
  **synthetic** lock applied through `setLockedModelsForTests`. That is what the seam is for and the
  only remaining way to reach those paths. The previous comment warned against asserting the lock
  through a model the manifests do not lock; that warning is answered, not ignored, by the three
  manifest-truth tests beside it, which clear the override and pin the real set as empty. Added a
  fourth, `isModelLocked("two-echelon-jade-us") === false`, so a half-applied unlock fails **by
  name** rather than only by a list shrinking.
- `Landing.test.tsx` — Chapter 9 moved out of the locked table and into the unlocked case (now Ch3,
  Ch4, Ch9), pinned **positively**: real `href`, no inert wrapper, no badge, no `data-locked`, no
  `opacity-60`. The Recent-solves pair flipped the same way — a JADE history row now carries
  `href="/chapter-9/jade?scenario=7"`.
- **New: `Landing.lockedRendering.test.tsx`** — Landing's locked-card and locked-history-row
  rendering, kept alive against a synthetic locked chapter (`vi.mock` of `@/lib/chapters`). Its own
  file because `vi.mock` is file-wide and mocking `CHAPTERS` inside `Landing.test.tsx` would falsify
  every other case there. The fixture's `modelId` is deliberately **outside** the `StudioModelType`
  union (hence `as unknown as Chapter`): a fixture borrowing a real id would typecheck and would then
  read as a claim that a shipped chapter is locked. Mutation-checked — flipping the fixture's
  `locked` to `false` fails 3 of its 5 tests, so it is not vacuous.
- `lockedChapterDrift.test.ts`'s "every locked chapter is still a registered route" case is now
  **vacuous** (no iterations) and was kept with a comment saying so: it is a standing invariant that
  re-arms by itself at the next lock, and the empty-set assertion above is what guards the unlock
  claim, so its emptiness cannot hide anything.

**Playwright siblings rewritten BEFORE merge**, per the standing `spec_gap` rule (this bundle changes
a visible contract two prior bundles hard-code): `bundle4-auth-landing.spec.ts` (link present, inert
wrapper and Locked badge absent) and `bundle6-ui-tweaks.spec.ts` (Chapter 9 is a visible link). Not
executed — `pnpm e2e:gate` needs local servers and is not part of this gate. Separately, the ch4-lock
entry's list of specs broken *because their subject was locked* is now fully unblocked: the
JADE-focused ones (`jade-two-echelon`, `jade-ch9-workspace-bundle`, `workspace-fixups`,
`workspace-fixups-2`, `nonjade-servicestats-live-coverage`) can run again, and
`e2e/helpers/modelLock.ts` self-adjusts (it reads the live manifest). Whether they still pass against
current HEAD is untested here. That entry calls it "8 specs"; the real count of spec FILES is **7** —
see the review note at the end of this entry, `chens-cosmetics` is not a file that exists.

**Gate:** typecheck clean · api-server **1638/1640** · studio **2218/2221** · solver pytest
**312/312**. The 5 failures are all on the documented load-flake list and all in files this branch
does not touch: api-server `cors` + `jobRunnerDispatcher` (14/14 isolated), studio
`InputMapTabV2.customerStatus` / `Workspace.Transport` / `Workspace` (170/170 isolated). Concurrent
vitest process count verified 0 before both suites. `e2e_accuracy.py` **not run**: no
solver/dataset/`solve.py` change — the only manifest edit is the `locked` capability, which the
solver never reads.

**Environment note worth keeping:** a bare `pnpm --filter api-server test` with no `DATABASE_URL` in
the environment fails **21 files at collection** with `DATABASE_URL must be set` (thrown by
`lib/db/src/index.ts` at import time, via `routes/scenarios.ts`). That is an environment gap, not a
regression, and it looks alarming — pass `DATABASE_URL` inline as CLAUDE.md's local-dev note says.

**Product state after this branch:** every chapter registered in `CHAPTERS` is open. Chapters 5
(transport, brazil) and 10 (gold-refinery) remain `hiddenFromLanding`, which is a different thing
from locked — they are reachable by direct route, just not advertised on the grid.

**Whole-branch review (independent model, adversarial brief): Ready to merge, 0 Critical.** It
re-derived every claim above from the diff rather than accepting it, empirically reproduced the
`Landing.lockedRendering.test.tsx` mutation check (3 of 5 fail on `locked: false`), ran the
`routes.test.ts` lock describe (22/22) and the drift test (4/4), and confirmed by direct search that
no `.py` file under `artifacts/api-server/src/solver/**` or `solvers/**` reads `capabilities.locked`
— which is what makes the `e2e_accuracy.py` skip legitimate rather than merely convenient. Both
Important findings were stale *premises left elsewhere in the repo*, not defects in the change; both
are folded into this same branch (second commit):

- `crossModelStepContract.test.ts` asserted in a comment that JADE "is locked (`capabilities.locked`)"
  and cited `routes.test.ts`'s comment — which this branch had just rewritten to say the opposite.
  Reworded: its `setLockedModelsForTests([])` is now belt-and-braces (nothing is locked), kept
  deliberately so a future quiesce locking one of those six models cannot silently turn real coverage
  into an unread 403.
- **`scripts/measurement/{seed-cohort,prepare-cache,load-driver}.mjs` excluded JADE on the stated
  grounds that it is a locked chapter (403) and therefore "correctly out of the student-facing HTTP
  load cohort." That premise died with this branch** — and the scripts are in no `pnpm` gate, so
  nothing would ever have gone red. The cohort itself was **deliberately NOT changed**: editing it
  silently would change what the capacity model measures, and that is the MP-1 run-setup decision the
  measurement plan already reserves (its "Locked-model measurement" step), not a mechanical follow-on
  from an unlock. The comments now say so explicitly, so the standing tail-under-weighting caveat is
  no longer misread as prod-parity. **Open follow-up for MP-1: re-decide the cohort now that students
  can actually submit jade's ~13s tail.**

Two Minor items also folded: `docs/ops/e2e-stale-specs.md` described the `modelLock.ts` self-healing
skip in the present tense as guarding "the locked JADE chapter" (the helper now resolves *unlocked*
and the specs it guards run); and the "8 specs" accounting inherited from the ch4-lock entry names a
`chens-cosmetics` spec that **does not exist in the tree** — the Chen-focused spec is
`chen-bands-units-qa.spec.ts`. The count of genuinely unblocked spec FILES is therefore 7, not 8; the
figure was carried forward uncorrected from the ch4-lock/ch4-unlock era and is corrected here rather
than in those entries (append-only, hard rule #9). The remaining Minor — the drift test's
now-vacuous "every locked chapter is still a registered route" case — is disclosed in the test's own
comment as intentional and was left as is.

---

## Chapter 4 two-step — rollout/rollback ops doc (`OPS-1`)

New `docs/ops/ch4-two-step-rollout.md`. Closes the Task 10 item the two-step bundle
(`ch4-2s-1`–`ch4-2s-9`, merged `0a300f8`) left open: the bundle shipped and smoke-passed in
production with no operator record of how to take it back out. Docs-only — zero source
files touched, so no gate could have caught the gap.

The doc's load-bearing claim, and the reason it exists as its own document rather than a
paragraph in this entry: **the index drop and the code rollback are independent levers, in
either order.** One-active-job-per-Chapter-4-scenario is enforced twice — the partial unique
index `UQ_solve_jobs_active_per_scenario`, and an in-transaction check in
`enqueueScenarioSolve` (`jobRunner.ts:393-403`) inside the `FOR UPDATE` transaction, gated
on `MAX_COVERAGE_MODEL_ID`, returning a documented `409` with the in-flight `jobId`. The
scenario row lock only serialises two concurrent enqueues; it is that check which makes the
second one refuse. So dropping the index degrades the backstop without un-enforcing the rule.
The doc names the one verification that proves this on a live build (solve twice fast, expect
`409`) and says plainly what it means if it returns `201`/`202` instead.

**Measured while writing, not recalled:**
- `indexdef` read from local `nos_dev` — the `model_id = 'max-coverage-us'` predicate is
  present, so the constraint is genuinely model-scoped and the other six models keep their
  existing enqueue semantics.
- Production `indexdef` is **`unknown`** and recorded as `unknown` (hard rule): `nos-postgres`
  allowlists external IPs and this session's address is not on it. The doc carries the
  `pg_indexes` query for an operator who can reach it.
- `maxCoverageInputsSchema` at `22be7e8` (the pre-bundle commit) has no `.strict()` on its
  top-level object, read at that commit — so a code rollback leaves the already-persisted
  `stepEpoch`/`step2` keys inert rather than triggering `422`s on existing scenarios.
- **The clean code-rollback target has decayed.** `22be7e8` was Chapter-4-only on 2026-09-29;
  Chapter 5, CH4UX, the Chapter 9 unlock and the CI work have landed on top since, so
  redeploying it today reverts all of them. The doc says so and points at `git revert` of the
  nine commits as the smaller change. This is the kind of fact that silently stops being true,
  which is the argument for writing a rollback doc while the deploy is fresh rather than later.

**One correction to a claim made earlier in this session's own notes:** `nos-api` was reported
as frozen at `1057a071` with every deploy failing on `DATABASE_URL`. It is not — `list_deploys`
shows `dep-daujns7lot8c73bdjaj0` **live** at `fa5068e` (2026-09-30 16:43Z). The two
`update_failed` deploys were on 2026-09-29/30 and were fixed by `06a5b9f`
("fix(render): match the live nos-api config — explicit DATABASE_URL, real autoDeploy").

**Whole-branch review on the merged state: `Fix before push`, 1 Critical + 4 Important + 4 Minor,
all nine verified independently and all nine folded before the push.** The review confirmed every
file:line anchor, every SHA, both SQL statements, the `.strict()` claim at `22be7e8`, the `unknown`
discipline (it re-attempted the production query by a route this session had not tried and hit the
same allowlist wall), and the central independence claim — which it verified properly, by exhausting
the insert paths into `solve_jobs` rather than by reading the prose: two production inserts exist,
one inside the guarded transaction and one (`jobRunner.ts:343`) with zero non-test callers.

The Critical was the document asserting `nos-api` has `autoDeployTrigger: off` and "always needs a
deliberate trigger". **False, and false in the direction that gets someone hurt** — it tells an
operator that pushing a revert to `main` cannot ship the API, when `render.yaml:29` is
`autoDeployTrigger: commit` and the live service reports `autoDeploy: yes` / `branch: main`. The
irony is instructive: the correcting commit is `06a5b9f`, cited three paragraphs above in this very
entry. **`CLAUDE.md`'s Branch-discipline section carries the identical stale claim** — almost
certainly where this one was inherited from. Not fixed here (out of scope for a docs task, and
`CLAUDE.md` is not something to amend on a review agent's say-so); surfaced for a decision.

The four Important findings were all of one kind — places the doc stopped one step short of the
operator's actual situation:
1. The `stepEpoch` strip is inert while rolled back but **not** across a roll-forward. Rollback →
   user edits → roll-forward leaves the row with no `stepEpoch`, which `readStepEpoch` reads as
   epoch 1, which re-matches long-superseded epoch-1 jobs that `loadScenarioSteps` then reports
   `stale: false` — because CH4-3's premise ("the only thing that can change Step 1 bumps the
   epoch") is exactly what the strip breaks. Now documented with the audit query.
2. Dropping the index also turns `maxCoverageStepWorkflow.test.ts:282-299` red — a real-Postgres
   test asserting the raw insert is refused. Matters because the lever is `DATABASE_URL`-
   parameterised and invites being run against a dev DB.
3. The `drizzle-kit push` re-create is **checkout-dependent and can do the opposite of the
   intent**: run from a build rolled back to `22be7e8`, the schema file has no index and push
   proposes *dropping* it. The hand-written `CREATE UNIQUE INDEX` now leads, and the plan's
   `--verbose` inspection step — which had not carried into the runbook — is restored.
4. "Applied the way every schema change in this repo is applied" read as an assertion about
   production two lines above `indexdef: unknown`. Scoped to local/CI, with the absence of any
   recorded production apply stated outright.

Minor: the ancestry pre-check now tests `a5335f6` rather than the merge commit `0a300f8` (the merge
test clears branch tips like `070bf48`/`c547e2d` that carry the entire feature); eight of the nine
task commits are **merges**, so `git revert` needs `-m 1` or the content SHAs — both forms are now
given, and task 9 has a real SHA (`070bf48`/`96c1d10`) instead of "(in `0a300f8`)"; `0a300f8`'s
merged branch was `e2e-inherited-repair`, not the plan branch; and `202` is the solve endpoint's
only success code, so the doc's own falsification criterion no longer says `201`/`202`.

One finding was recorded in the doc rather than fixed, because it is a source comment and not this
task's scope: `solve_jobs.ts:118-121` still claims `enqueueScenarioSolve` "inserts WITHOUT checking
for an existing job… This index does" — true when task 1 wrote it, superseded by task 4. An
operator grepping the schema to check the doc's central claim would find a comment contradicting it,
so the doc now carries an explicit warning pointing at `jobRunner.ts:393-403` instead.

---

## Solve clock showed "Solving 25200s" — `timestamp` → `timestamptz` (`HND-B`)

Pre-existing user-visible bug, not introduced by CH4UX — the new `SolveProgressOverlay` only made
it prominent by moving the clock from a dialog that closed on success into a blocking overlay a
student watches for a whole solve. Ten columns converted across `solve_jobs`, `scenarios` and
`result_cache`; `docs/ops/timestamptz-migration.md` carries the SQL, the verification queries, the
rollback and the production-apply status.

**The handover note's diagnosis was directionally right and mechanically wrong, which mattered.** It
said `queued_at`/`started_at` are stored as local wall-clock while `finished_at` is UTC. The real
mechanism, probed through the actual ORM rather than reasoned about:

```
pg session TimeZone = America/Los_Angeles,  node offset = +05:30,  true now = 13:21:37Z
stored via sql`now()`  = 06:21:37    read back = 06:21:37Z   ← 7h early
stored via new Date()  = 13:21:37    read back = 13:21:37Z   ← correct
stored via timestamptz = 06:21:37-07 read back = 13:21:37Z   ← correct
```

Drizzle writes **and reads** a naked `timestamp` as UTC wall-clock, but `defaultNow()`/`sql`now()``
store the DB session's *local* wall-clock. So the `new Date()` writers were already correct and the
DB-side writers were wrong — the opposite assignment to the one in the note. Worth recording because
the obvious cheap fix (point every writer at `new Date()`) follows from the note's version and
**would have broken the stale-lease takeover**: `jobRunner.ts:617` compares
`owner_heartbeat_at < now() - interval '60 seconds'`, which is correct today precisely because both
sides are DB-side. An earlier probe using raw `pg` instead of drizzle gave a *different* skew (45000s,
local-zone serialisation both ways) and would have supported the wrong conclusion — the ORM, not the
driver, is what decides this.

**Measured, not inferred:** of 160 `solve_jobs` rows in `nos_dev` with both timestamps, **131 had
`finished_at - started_at` rounding to `25200` s** and **155 were within a minute of it** (min
961.9 s, max 25420.0 s). No row is *exactly* 25200 — the real solve duration rides on top of the
offset — so "rounds to" is the defensible phrasing and the first version of this entry overstated it
as an equality (and said 14 within a minute, when it is 24 beyond the 131, 155 in total). Queue waits
were a sane 0–2 s because `queued_at` and `started_at` were *both* DB-written and the error
cancelled — which is why the bug presented as a wrong solve duration rather than as obviously broken
timestamps.

**Two consequences found beyond the reported symptom:**
1. `landingSummary.ts:27` computes `max(finished_at)` over rows written by two different clocks
   (`sql`now()`` on the failure paths, `new Date()` in `markFailed`/`markSucceeded`) — a wrong
   value, not a uniformly shifted one. `finished_at` is now single-clock.
2. `scenarios.created_at` was wrong for every row's entire life: the INSERT
   (`routes/scenarios.ts:235`) supplies no timestamps and falls through to `defaultNow()`, while
   every UPDATE writes `new Date()` — so `updated_at` silently self-corrected on a row's first edit
   and `created_at` never did.

**The fix exposed a latent bug that the fix itself then had to close** — the most interesting part of
this task. `isStale()` (`routes/scenarios.ts:116`) is a bare `inputsUpdatedAt > solvedAt` with no
tolerance, and `inputs_updated_at` can originate from the INSERT's `defaultNow()` (the database's
clock) while `solved_at` was written from the application host. Any clock skew between the two hosts
marks a scenario stale the instant it finishes solving. The naked columns had been *masking* this —
**but only because this database's offset is negative**: `inputs_updated_at` read back into the past,
so it could never win the comparison. On a positive-offset database (`Asia/Kolkata`, +05:30) the
identical code reads 19800 s into the *future* and `isStale()` returns `true` for every solved
scenario, permanently — a louder bug than the one that was reported. Benign by luck, not by design.
Converting to `timestamptz` removes the accident, so every writer of `solved_at`,
`inputs_updated_at` and `updated_at` moved to `sql`now()``.

**All five `updated_at` writers moved, not two.** The first version of this entry claimed the column
had been unified while `routes/scenarios.ts:373`, `:412` and `routes/distanceBands.ts:73` were still
writing `new Date()` — so in a combined `{name, inputs}` PATCH both forms fired inside one
transaction and the app clock won. Harmless in itself (nothing compares `updated_at`; it is only
projected to the API) but it contradicted this change's own "one clock per column" claim, so the
three were converted rather than the claim narrowed. Two script writers were missed the same way and
are now fixed: `scripts/src/strip-network-edits.ts` wrote `inputs_updated_at` from the app clock —
one side of the no-tolerance `isStale` comparison — and `scripts/src/migrate-scenario-inputs.ts`
would `ADD COLUMN ... timestamp` (naked) on a legacy or rebuilt database, after which the natural
`drizzle-kit push` follow-up is exactly the `USING`-less ALTER that shifts every row.

**Deliberately NOT backfilled** (user decision, 2026-10-01): the migration uses
`USING col AT TIME ZONE 'UTC'`, which keeps each stored wall-clock unchanged and labels it UTC. New
rows are correct; historical rows display exactly what they displayed before. The reason is not
convenience — **`finished_at` is not attributable per row**, having had two writers, so a given
historical row's zone cannot be recovered from the row. A heuristic (classify by whether
`finished - started ≈ 25200`) was considered and rejected: inference presented as a record, and it
would silently mis-convert any genuinely 7-hour solve.

**`drizzle-kit push` must not be used for this migration.** Its generated `ALTER ... TYPE
timestamptz` has no `USING` clause, so Postgres reinterprets each naked value in the *session's*
zone — shifting every stored row by 7h on a Pacific session, the exact opposite of the chosen
policy. The ops doc leads with the explicit SQL and says so.

**`sessions.expire` excluded because the table is DEAD, not for any compatibility reason.**
`auth.ts:4` already marks it unused; zero writers, zero readers, 0 rows. The first version of this
entry — and `CLAUDE.md`'s new gotcha, and the ops doc, and the commit body — all stated that
`connect-pg-simple` owns and writes it. **That was fabricated.** Neither `connect-pg-simple` nor
`express-session` is a dependency of this repo: 0 occurrences in `pnpm-lock.yaml`, absent from
`node_modules`; auth is a stateless signed cookie (`routes/auth.ts:77`). The decision to exclude was
right and the recorded reason was invented — and it had been written into `CLAUDE.md`, the one file
every future agent treats as ground truth. Caught by the whole-branch review, re-verified
independently before correcting.

**The migration is NOT idempotent, and the first version of the runbook did not say so.** Running the
conversion twice shifts every value by the session offset again, silently: on an already-`timestamptz`
column `v AT TIME ZONE 'UTC'` yields a naked `timestamp` holding the UTC wall-clock, and the implicit
cast back re-interprets it in the session zone. Measured on a temp table: `07:00` → `07:00` →
`14:00`. The rollback has the same hazard inverted (`07:00` → `07:00` → `00:00`). Easy to trigger for
real — a doubled paste, a partially-failed run, a second operator following the same doc — and hard
to notice, because the no-backfill policy already declares historical values untrustworthy. The
runbook now leads with the precondition and offers a self-guarding `DO` block that converts only
columns still reading `timestamp without time zone`.

`users.created_at`/`updated_at` were already `timestamptz` (`auth.ts:22-23`), the precedent this
follows.

**New test, falsified rather than assumed:** `timestampClock.test.ts` asserts the column types **and**
round-trips a real `now()`-written value against the client clock. Both halves are needed — the
round-trip alone passes on a naked column whenever the database runs in UTC, which is the likely CI
configuration, so it would have been green in CI while the bug was live. Proven to bite by reverting
`scenarios.created_at` to naked `timestamp` in the live DB: both assertions failed and named the
column, while the third (`solve_jobs`-only) correctly still passed, confirming they are independent.
Column restored after.

**Gate:** typecheck clean · api-server **1641/1643**, the 2 failures `resultEnvelope.test.ts`
timeouts on the documented CBC/`spawnSync` contention list, **13/13 in isolation** immediately after,
and this diff touches no solver code · studio first run reported 6 failed / 2 errors whose file names
were **not captured before re-running** (an honest gap in the measurement), second run with zero
concurrent vitest **2221/2221, 121 files, exit 0** · solver pytest run as a no-regression check, zero
Python touched. `e2e_accuracy.py` not re-run: no solver change, so its 99/99 is unaffected by
construction.

**Production: NOT applied.** Local `nos_dev` only. `nos-postgres` allow-lists external IPs and this
session could not reach it, so production's current column types are **unverified** — the ops doc
says to run the verification query rather than assume. Production DDL is a separate human-approved
step.

---

## The e2e specs were in no tsc program at all (`HND-D`)

New `artifacts/studio/tsconfig.e2e.json` + an opt-in `typecheck:e2e` script. 28 of 28 `.ts` files
under `e2e/` now compile; before this, **zero** did.

**Premise re-proven rather than inherited:** `tsc -p tsconfig.json --noEmit --listFiles | grep -c
'/e2e/'` returned **0**, against **243** files under `artifacts/studio/src/`. (A first draft of this
entry said "267 src files" — that is `grep -c '/src/'`, which also counts 20
`node_modules/.pnpm/react-resizable-panels/**/declarations/src/*.d.ts` and 4 `lib/units/src` files.
243 is studio's own count and the number this comparison is about.) `artifacts/studio` had exactly one
tsconfig, the workspace has no linter of any kind, and Playwright's loader is esbuild transpile-only —
so an arity or type error in a spec surfaced **nowhere** until that spec ran. Four JADE specs cannot
currently run (the model-lock skip in `e2e/helpers/modelLock.ts`), which left their correctness
resting on human review alone; that is also being addressed independently on the `e2e-jade-specs`
branch, so this premise will read as stale once that lands.

A separate config rather than widening `tsconfig.json`'s `include`, because the two need different
`types`: the app build must not see Playwright's globals and the specs must not see `vite/client`.
Coverage was verified by diffing `--listFiles` against `find`, not assumed — 28/28, nothing orphaned.
Strictness is inherited, so the specs are held to exactly the repo's existing bar
(`strictNullChecks`/`noImplicitAny` on, `strictFunctionTypes` off), not a stricter one that would have
manufactured work.

**Result: 0 errors**, where errors in 13 specs had been expected. A clean result on 28 never-compiled
files is exactly the kind of answer that should not be believed, so it was falsified: planting a
wrong-arity call and a wrong-type assignment into `ch4-two-step.spec.ts` produced
`TS2554 Expected 2 arguments, but got 1` and `TS2322`. Probe removed, re-verified 0.

**Scope correction, from the whole-branch review: the solve helpers are per-file duplicates, not
shared, so the cross-file blast radius originally claimed here does not exist.** Measured topology —
**14 files each declare their own** solve helper (`solveAndWait` ×5, `solveViaUi` ×5, `solveScenario`
×2, `runOptimizerAndWait`, `solveAndObserveClock`), and `e2e/helpers/modelLock.ts`'s
`skipIfJadeLocked` is the **only** cross-file export in the entire directory. So a signature change in
one spec cannot break another. What the typecheck actually catches, both proven by planting: the
**within-file** missed call site after a declaration change — the realistic CH4UX-7 regression, since
that task edited 2–3 call sites per file — and any re-signaturing of `skipIfJadeLocked`, where all
four callers error at once. Real value, narrower than first worded. Worth noting that CH4UX-7 left
those duplicates with *inconsistent* signatures (`id: string` in some files, `id: number` in others),
which is exactly the shape a shared helper would have forced into agreement.

**What this does NOT catch — the asymmetry is the honest explanation for 28 clean files, and matters
more than the 0.** Verified silent, each by planting:
- **A floating `expect`** — `expect(loc).toBeVisible();` with no `await`. The highest-value gap by
  far: a missing `await` makes a web-first assertion completely vacuous, and that is the exact
  failure mode CH4UX-7's own commit message describes ("those waits were silently vacuous and every
  downstream assertion raced the real result"). Catching it needs
  `@typescript-eslint/no-floating-promises`; `tsc` structurally cannot.
- **A nonexistent or renamed testid string** — `getByTestId("made-up-testid")`. Strings are opaque.
  This is this repo's documented recurring `spec_gap` class (CLAUDE.md: "a UI-changing bundle
  silently breaks PRIOR bundles' specs"), and the new typecheck gives it **zero** coverage.
- **Wrong-type matcher arguments** — `toBe(expected: unknown)` in Playwright's types accepts
  anything, so a whole family of assertion-value mistakes passes.
- **Any property chain off an uncast `await resp.json()`** (it is `any`). Specs that declare an
  interface and cast — e.g. `MaxCoverageResult` in `ch4-two-step.spec.ts` — *are* checked.

The specs' two heaviest surfaces, locator/testid strings and `resp.json()` payloads, are largely
outside `tsc`'s reach. This change is worth having and it is **not** a safety net for the failure
class that actually breaks this repo's e2e suite.

For the record, the classes it *does* catch went well beyond the two planted first: misspelled
Playwright methods (`page.cilck` → `TS2551` with a suggestion), wrong matcher names
(`toHaveTxt` → `TS2551`), bogus locator/`goto`/`test.use` option keys (`TS2561`), unawaited Promises
assigned to a concrete type (`TS2322`) **or used as a truthy condition** (`TS2801`), bad relative and
`@/` import paths (`TS2307`), `page.waitForTimeout("500")` (`TS2345`), and missing required object
fields (`TS2741`).

**A generated 56 KB artifact was caught before it landed.** `tsBuildInfoFile` was initially
`.tsbuildinfo.e2e`, which the root `.gitignore`'s `*.tsbuildinfo` pattern does **not** match — that
pattern matches only names *ending* in the string. `git status` showed it untracked and about to be
committed. Renamed to `e2e.tsbuildinfo` and confirmed ignored with `git check-ignore -v`. It needs its
own path regardless of the name: sharing `tsconfig.json`'s would make the two configs invalidate each
other's incremental cache on every alternating run.

**Deliberately opt-in, not folded into studio's `typecheck`.** The root `typecheck` script runs each
package's own `typecheck`, and CI runs the root script — so folding it in would enrol CI
automatically, which this task's brief explicitly reserves for devops agreement. `pnpm run typecheck`
verified unchanged. **Open decision: whether `typecheck:e2e` joins the workspace gate (and therefore
CI).** It is green today, needs no browser or app infrastructure, and is the only thing standing
between a re-signatured helper and an undetected break in a spec that cannot run — but enrolling it
is a CI change, not this task's call.

---

## e2e hygiene — `readSolvedAt` extracted from 7 copies, concurrent-solve hazard recorded (`HND-F`)

New `artifacts/studio/e2e/helpers/solvedAt.ts`. Seven byte-identical declarations deleted (5 lines
each = 35 removed), seven imports added, plus the seven now-orphaned doc comments the first pass
left behind (see below). Diffstat for the spec files is **−35 before the comment cleanup**; an
earlier draft of this entry said "net −21 lines of duplication" without stating its derivation, so
the figure is replaced with the raw counts.

**Measured topology before the change:** exactly 7 declarations — `bundle2-fastfollow`,
`jade-ch9-workspace-bundle`, `jade-two-echelon`, `posthog-analytics`, `workspace-fixups`,
`workspace-fixups-2`, `workspace-ux-r1-r9` — with identical four-line bodies differing only in the
`id` parameter: **`string` in four, `number` in three, for the same route parameter.** That drift is
the thing worth noticing: it is exactly the shape a shared helper forces into agreement, and it is
what `CH4UX-7` left behind when it re-signatured these per-file. The helper takes `string | number`
because both call styles are real and both interpolate identically.

**The handover note said to extract this "next time this area is touched, not worth a dedicated churn
commit." That condition had just been met** — `HND-D` put these files under a typecheck one commit
earlier, which is what makes the refactor verifiable rather than hopeful. Demonstrated: deleting one
of the seven new imports produces `TS2304 Cannot find name 'readSolvedAt'` at both of that file's
call sites. The whole-branch review went further and broke the helper's *signature* (adding a
required third parameter): **all 7 files errored, 16 `TS2554`s**, which is the stronger
demonstration. Before `HND-D`, a missed import in any of these specs would have been invisible until
the spec ran.

**Correction to this entry's first draft:** it added "and four of them are JADE specs that currently
cannot run at all." **That was already false when written.** Chapter 9 was reopened two merges
earlier (`90b2082`, "no chapter is locked any more"), no `solvers/*/manifest.json` carries a `locked`
key, so `skipIfJadeLocked` is a no-op and those specs run — `a10acf5`'s own entry cites a 44.3-minute
gate run with "0 skipped … the unlock's own confirmation". The claim was carried over from
`HND-D`'s `tsconfig.e2e.json` header, which had the same staleness and is corrected in this commit
too. The conclusion is unaffected: a spec that *does* run still only reports a type error at the
moment it runs, and only along the paths that run.

Two things the extraction fixes beyond deduplication:
- The copies read `(await resp.json()).solvedAt` off an implicit `any`, so a rename of that API field
  would have been silent in all seven. The helper casts to `{ solvedAt?: string | null }` — narrow, so
  it claims nothing about the rest of the payload. This is one instance of the uncast-`json()` hole
  `HND-D`'s review catalogued as outside `tsc`'s reach.
- The completion-signal rationale now lives in **one** place: capture before triggering and poll
  until the value *differs* (polling for non-null is wrong — an already-solved scenario starts
  non-null), because the solve overlay is transient and `output-map-tab` is a false positive when
  that tab was already open.

  **The first pass made that claim false, and the review caught it.** The deletion took each
  function body but **not** the doc comment above it, leaving seven orphaned JSDoc blocks — so the
  rationale existed in 8 copies, up from 7. Worse, in two files the orphan then attached itself to
  an unrelated declaration: in `workspace-ux-r1-r9.spec.ts` it documented **`gotoScenario`**, a
  navigation helper, as "the durable per-run solve signal", and in `posthog-analytics.spec.ts` it
  attached to a `test.describe`. All seven removed (33 comment lines, zero code lines — verified by
  filtering the diff for non-comment removals). One nuance worth recording, because it nearly caused
  an over-deletion: in five of the seven the *adjacent* block documents the file's own surviving
  `solveAndWait`/`runOptimizerAndWait`/`solveAndObserveClock` and had to be kept; only the
  `readSolvedAt`-specific block above it was the orphan.

**The hazard, recorded before it can bite rather than after.** `solvedAt` only advances when
`jobRunner`'s publication CAS matches, and that `.where()` requires **both**
`latestSolveJobId = jobId` **and** `solveInputRevision = enqueuedSolveInputRevision`
(`jobRunner.ts:1481-1488`, verified by reading the predicate and the `succeeded-but-superseded` branch
immediately below it). A solve that succeeds but has been superseded — newer solve enqueued, or
inputs edited, while it ran — deliberately does not publish, so `solvedAt` is unchanged and a
`readSolvedAt`-based wait hangs for the full `SOLVE_TIMEOUT` before failing **while looking like a
solver timeout**.

**Why it is unreachable today is NOT what the first draft said**, and the review was right to flag
it, because this text became durable `CLAUDE.md` guidance. The draft said "every spec is sequential
with one in-flight solve." `playwright.config.ts` sets `fullyParallel: false` but never sets
`workers`, so Playwright defaults to ~half the cores and `fullyParallel: false` serialises only the
tests *within* a file — **spec files run in parallel.** The real protection is that the CAS is
per-scenario and every spec registers its own user and creates its own scenarios, so no two specs
touch the same row. That distinction matters: a future spec that shares or seeds a fixed scenario id
would be exposed while still satisfying "sequential". Likewise "CH4UX-6's in-flight lock makes
UI-driven overlap impossible" was an absolute the source declines to make —
`src/pages/Workspace.tsx:3050-3059` records that `enqueueSolve` has a second caller
(`handleSaveAsScenario`) which does not re-run the guard, closing with "Do not read this comment as
'the enqueue helper is single-entry' — it is not." That path creates *separate* scenarios, so the
conclusion survives; the reasoning did not. The first spec that drives two solves against **one**
scenario, or edits inputs mid-solve, hits this.

A second non-publication mode is also recorded in the helper for completeness: `enqueueSolveJob`
(`jobRunner.ts:342`) passes `enqueuedSolveInputRevision: null`, which the CAS turns into
`sql`false``, so a job enqueued through that primitive never publishes at all — no concurrency
needed. Intended and documented at the call site, and reachable only from in-process callers, never
the HTTP path a spec drives. The correct wait there is the specific job
(`GET /api/scenarios/{scenarioId}/solve-jobs/{jobId}` — plural segment, confirmed at
`openapi.yaml:352`, reports a terminal status whether or not its result was published). Recorded in
the helper's own header and distilled into `CLAUDE.md`'s Gotchas per hard rule #9.

**Verification, and its honest limit:** `typecheck:e2e` clean, 0 declarations remaining, 7 importers,
all 7 files' call sites resolving, and every file still genuinely using its `Page` import (checked,
since `noUnusedLocals: false` would not have said). The specs were **not** executed — no local servers
were running and starting them was not worth it, because the `./helpers/*` import pattern is already
proven at runtime in this exact directory: `./helpers/modelLock` is imported by **four of these same
seven specs** and those specs run. So the residual risk is import resolution under Playwright's
esbuild loader for a pattern already in use beside it. Stated rather than papered over.

---

## harness-retro steps 5–7 for CH4UX (`HND-G`)

Steps 1–4 ran during `CH4UX-8`; 5–7 never did. None gates a merge. One `tasks.csv` cell changed,
two standing docs corrected, one skill clarified.

**Step 5 — `escaped_defects: unknown → 0`, derived from the column's own definition.** "Defects
traced back to this task *later*" excludes one found and fixed inside the branch: the cold-mount
race was introduced in `d4bc931` (`CH4UX-1`) and fixed in `fa70517` (`CH4UX-8`), which **is** that
row's `merged_sha`, so it never reached `main`. That real-browser QA caught it rather than a suite
is a *test-coverage* finding — already one of the three CH4UX rows in `failures.csv` — not an
escape. Verified no post-merge CH4UX defect exists; the only adjacent one, `HND-B`'s solve clock,
is recorded as explicitly **not** introduced by CH4UX.

**`reverted_within_7d: unknown → no`, and this reversed my own first answer.** I initially left it
`unknown`, reasoning that the window closes 2026-10-07 so `no` claims unelapsed time. The review
showed that inverts `/harness-retro`'s step 5, which fills this field for tasks finished in the
**prior** 7 days — i.e. precisely while the window is open — and which offers `unknown` for
`escaped_defects` but deliberately not for this one. Worse, my reading made the column
**permanently unfillable**: every retro run only sees in-window tasks, so the "second pass" I
prescribed had no owner, no step and no trigger, while eleven existing rows were already filled the
other way. Resolved by defining the field honestly as a **point-in-time observation at retro** (no
revert commits since 2026-09-23; `fa70517` still an ancestor of `origin/main`) and amending
`.claude/skills/harness-retro/SKILL.md` so the skill and `metrics/README.md` cannot disagree. The
genuinely unverifiable case is a row with no `merged_sha` — `scnd-measurement` carries a revert
verdict on a commit nobody recorded, which `README.md` now states as a criterion rather than as a
list naming 2 of the 7 affected rows.

**Step 6 — doc-drift warning: 117 findings, none actionable. The first version of this entry's
number was fabricated by my own measurement method.** It said "84 hits", which came from a
two-pattern `grep` over the audit's output rather than the audit's own finding count, and is
reproducible under no configuration (full scan is ~205; the `--since` run is 117). Exactly the
`ps aux | grep -c vitest` mistake this repo already documents — a count with no visible rows
behind it. Corrected in `HARNESS.md` with the command and the four evidence kinds recorded
(`referenced path does not exist` 87, `no matching source` 21, `route not in openapi.yaml` 7,
`pnpm script not found` 2), plus a warning that the total is configuration-dependent and must be
re-measured rather than reused.

The classification was also wrong about where the bulk sits. It is **not** package-relative paths
(~16) but **glob/brace/placeholder tokens the detector cannot expand — 55 of the 87 path hits**
(`…/{routes,services,validation,registry}/**`, `specs/<date>-<feature>-design.md`). Skipping tokens
containing `*`, `{` or `<` would remove most of this baseline outright. Three more classes were
missing entirely: the Arcadia detector over-matching on the bare word *badge* (21), build/test
artifacts and removed directories, and two `pnpm` built-ins read as missing package scripts. One
hit deserves a real look rather than dismissal: **`CLAUDE.md:157` cites `POST /login`, and
`CLAUDE.md` is a live document, not append-only history.**

Also noted: writing those examples into `HARNESS.md` *grew* the baseline by 5 findings (200 → 205),
so the documentation has a measurable cost against the very condition the deferred `doc_drift` gate
waits on — and that condition is what `gates/doc_drift.md` actually says, *"after the first
docs-audit PR merges"*, not the looser "once the baseline is clean" paraphrase.

**Step 7 — printed once, not processed** (that is `/docs-apply`): PR **#21** "Harness weekly
2026-39", opened 2026-09-21, age 10 days; PR **#13** "Harness weekly 2026-38", opened 2026-09-14,
age 17 days. Both carry the `docs-audit` label; no other open PR does.

**Left `unknown` on purpose:** `ch9-unlock`'s `escaped_defects`. It is in-window, but deciding it
requires reading that task's own post-merge defect history, which belongs to its retro rather than
to this one.

---

## 2039 e2e test users purged from `nos_dev`, and the leak closed (`HND-A`)

Destructive, human-approved, `pg_dump` taken first
(`/tmp/nos_dev-pre-purge-20261001-234727.sql`, 16 MB, all three tables verified present). Production
was **not** touched and, per the product owner, does not carry the same accumulation — so the
prod-check half of this task is closed by decision, not by measurement.

**The handed-over numbers had already moved, which is why the predicate was re-derived rather than
reused.** The note said 1596 users / 1595 residue, measured 2026-09-30. Actual count on 2026-10-01
was **2040** — this session's own api-server suites added ~444 while the task sat in the queue. The
note also specified "six prefixes, not two". Re-deriving from data showed something simpler and
safer: group by email shape and by domain, and the population is `@test.com` ×2020,
`@example.test` ×12 (all `journey_test_`, from `e2e_journey.py`), `@example.com` ×7 (all
`repro-`/`smoke+`/`diag`), and `@local` ×1 — **`seed@local`, the only real account**, holding 5
scenarios. No prefix list needed for the one-time purge: keep `seed@local`, delete the rest.

FK safety verified before executing, not assumed: exactly two FKs reference `users`
(`scenarios.user_id`, `solve_jobs.user_id`), **both `NO ACTION`**, so a wrong delete order fails
loudly rather than cascading. Zero cross-owner `solve_jobs` (a job whose scenario belongs to a
different user), and all five of `seed`'s scenarios carry `result_run_id`/`latest_solve_job_id` =
`null`, so no `ON DELETE SET NULL` side effect could reach its rows.

Executed in one transaction, child-before-parent: **160 solve_jobs → 289 scenarios → 2039 users.**
Verified from a fresh connection afterwards: 1 user (`seed@local`), 5 scenarios, 0 solve_jobs, 0
orphaned scenarios, 0 orphaned jobs. `result_cache` deliberately untouched (402 rows) — it is keyed
by inputs hash with no user column, so none of it was residue.

**The leak is now closed, which was the half that mattered.** Specs register a fresh account per
test for isolation and clean up their scenarios in a `finally`/`afterAll` but never their user,
because Playwright has no database access and there is no self-delete endpoint. Two new pieces:

- `scripts/src/purge-test-users.ts`, beside the other destructive-cleanup scripts and following
  `migrate-delete-chens-scenarios.ts`'s shape (exported testable functions, a fresh re-count inside
  the call so a stale confirmation cannot authorise a delete, FK-ordered transaction, dry-run by
  default with `--execute` to apply).
- `artifacts/studio/e2e/global.teardown.ts`, wired as the `chromium` project's `teardown`, so it
  runs once after the suite **including when specs fail**.

**The automated predicate is deliberately NOT the one-time predicate.** "Keep `seed@local`, delete
everything else" is right for a known-dirty database with a human watching and wrong for a hook that
fires unattended — it would delete a developer's own account. The script instead requires **both** a
known test local-part prefix **and** a known test domain, minus a protected list. Falsified with
planted decoys: `e2e-fake-…@test.com`, `journey_test_…@example.test` and `diag…@example.com` were
deleted, while **`alice@test.com`** (test domain, human prefix), **`diagnostics@realcompany.com`**
(test-ish prefix, real domain) and `seed@local` all survived — so both halves of the conjunction are
load-bearing, not decoration. A second guard re-reads the protected ids and throws if any appears in
the match set, so a later bad edit to the predicate fails instead of deleting.

Also carries a hosted-database guard: the script refuses outright if `DATABASE_URL` matches
`render.com|amazonaws.com|neon.tech|supabase.co`, because an unattended teardown should never be
pointed at a hosted database however safe its predicate is.

**Two deliberate non-obvious choices.** The teardown *shells out* rather than importing the logic,
because `artifacts/studio` depends on neither `pg` nor `@workspace/db` and adding a database driver
to the frontend package to tidy up after tests is the wrong trade. And it is **non-fatal**: a
teardown that reds the suite because cleanup failed converts a hygiene problem into a broken gate
and teaches everyone to ignore it, so it warns and returns — the accounts are untidy, not harmful,
and the next run collects them. It also skips silently with no `DATABASE_URL`, the normal case when
specs run against a deployed target.

**One real bug, caught by running it rather than by typecheck.** The first version used
`email LIKE ANY (<js array>)`; drizzle renders a JS array as a parenthesised parameter list — a ROW
constructor `($1, $2, …)` — which Postgres rejects for `LIKE ANY`, since that wants a genuine array.
The types are identical either way, so `tsc` was silent. Rewritten with `or(...)`/`like(...)`
composition. Verified against drizzle-orm@0.45.2.

End-to-end proof of the whole chain, not just the parts: planted `e2e-teardown-proof-1@test.com`,
ran `playwright test --project=cleanup`, got `[teardown] Purged 1 test user(s)` with `seed@local` the
sole survivor; and re-ran with `DATABASE_URL` unset to confirm the skip path logs and passes.

### `HND-A` whole-branch review — one Critical, folded before push

**CRITICAL: the hosted-database guard did not match this repo's own production connection string.**
It was a denylist, `/render\.com|amazonaws\.com|neon\.tech|supabase\.co/i`. `render.yaml:41-42`
records that `nos-api`'s `DATABASE_URL` was set in the Dashboard to Render's **INTERNAL** connection
string, whose host is the bare instance id with no domain suffix
(`…@dpg-d9hg4bmpbkes73a0j6l0-a/nos_postgres`). Measured: the regex **refuses** the external URL and
**proceeds** on the internal one production actually uses. It also missed Supabase's
`…pooler.supabase.com` (only `.co` was listed) and Neon's `.build` hosts. Exploitability was low —
the internal host resolves only inside Render's private network, so neither a laptop nor GitHub
Actions can reach it — but the guard's whole job was to refuse rather than trust the predicate, and
against the real string it refused nothing.

Replaced with an **allowlist** (`localhost`/`127.0.0.1`/`::1`, plus an opt-in `PURGE_ALLOW_HOST`
escape hatch), and moved out of the CLI block into `purgeTestUsers()` so an importer cannot bypass
it. A provider denylist loses this race permanently: it has to enumerate every hostname anyone might
ever deploy to.

**Cross-ownership pre-flight added.** The review proved two reachable states, both bad in ways the
delete would not report: a `solve_jobs` row owned by a *surviving* user but attached to a matched
user's scenario aborts the whole transaction on the FK (correct — nothing orphaned — but the
teardown swallows it, so every later run silently deletes nothing); and a surviving user's scenario
pointing at a matched user's job gets its `result_run_id`/`latest_solve_job_id` **silently nulled**
by the `ON DELETE SET NULL` FK while the log reports only deletions. Production cannot produce
either (`enqueueScenarioSolve` locks an ownership-filtered scenario and stamps that same user), but
`enqueueSolveJob` takes the two ids independently and several api-server suites insert jobs with
hand-chosen ids against this same database. Zero instances existed at the one-time purge. Both are
now asserted before the transaction and throw with the offending ids.

**Timeout ordering was inverted, which broke the "non-fatal" promise.** The config's 30s default test
timeout sat *below* the teardown's own 60s child timeout, and `execFileSync` blocks the worker's
event loop — so Playwright's timeout could not fire, the worker would block the full 60s, and
Playwright would report a **timed-out test**: a red suite caused by cleanup failing, which the
`try/catch` cannot absorb because the failure is Playwright's, not the child's. Measured at
~1.0–1.2s against a clean database, so latent rather than live — and a large backlog or a loaded
machine is exactly when it would bite. Now `teardown.setTimeout(120_000)` with a 45s child timeout
and async `execFile`, so the child always gives up first.

**The predicate now has a test** (`scripts/src/__tests__/purgeTestUsers.test.ts`, 10 cases, real
Postgres, `pt-`-prefixed rows removed in `afterEach`). The commit claimed to follow
`migrate-delete-chens-scenarios.ts`'s shape, but that script's shape includes a test file and this
one had none — the decoy falsification was manual and one-off, on code that deletes rows unattended
after every e2e run. The suite pins the internal-Render regression, both halves of the conjunction,
the protected list, and the two edge cases the review found: **uppercase addresses were not matched
at all** (Postgres `LIKE` is case-sensitive, so `E2E-Foo@TEST.COM` would have accumulated forever
while the script reported success) and **`_` in `journey_test_` was an unescaped single-character
wildcard** (it also matched `journeyXtestY-1@test.com`). Both fixed by folding `lower()` on both
sides and escaping `%`/`_`/`\`.

**I reproduced my own documented bug one function away from its own warning.** The new
under-collection reporter was written as `id <> ALL (${ids})` — the exact drizzle row-constructor
mistake the comment immediately above it describes. Rewritten with the query builder. That is the
clearest possible argument for the test file.

Smaller items folded: an empty `PROTECTED_EMAILS` now throws instead of silently disabling both
guards (`notInArray(col, [])` renders `and true`); the script reports accounts sitting on a test
domain that match **no** known prefix, so a suite adopting a new shape is visible instead of
silently uncollected; and the teardown invokes the package script rather than the file path, so the
two cannot drift.

**Open, and it bears on a decision already taken: `scripts/src/deploy/smoke.ts:141-142` records that
a production smoke run left `smoke+dercom-90367@example.com` on PRODUCTION on 2026-09-21,
unnoticed.** That is `smoke+` × `example.com` — both halves of this predicate. Production was
declared clear of this accumulation by the product owner and that decision stands as recorded, but
the repo's own code documents at least one leaked account there, and the smoke runner has no
deletion endpoint to tidy up with. Surfaced rather than acted on; any production cleanup remains a
separate, explicitly-approved operation.

---

## Chapter 9 (JADE) transportation costs became editable inputs (`ch9-tc-1`…`ch9-tc-10`)

Spec `docs/superpowers/specs/2026-10-02-ch9-transport-costs-design.md` (`27cc1ad`, review round 1
folded in `07e9cac`), plan `docs/superpowers/plans/2026-10-02-ch9-transport-costs.md` (`254ab0e`,
implementation review + author self-review folded in `892a52a`). Executed as 10 agent-team tasks per
`AGENTS.md`: solver-engineer, backend-engineer ×3, frontend-engineer ×5, qa-sdet ×1, the first nine
reviewed by the lead directly and the qa task by an independent `fable` reviewer.

Chapter 9's four freight parameters — `ic_trans_cost` 0.07 / `ic_min_trans` 10 / `ob_trans_cost` 0.12
/ `ob_min_trans` 10 — were hardcoded constants with no UI surface at all. A student could edit
distances, demands, capability and `p`, but not the rates that turn those distances into the dollars
the objective minimises. They are now an optional, all-or-nothing `inputs.transportCosts` object, and
**absence still means the textbook values**, so every pre-existing scenario is byte-identical.

Commits: `2b6bcc0` solver + metrics echo · `9e73f6b` result contract + codegen · `1e2f2bc` validation
+ precheck · `8190081`+`76f1026` payload/write-path · `8bd59a3` hook seam · `61a56c4` rate lib + tab ·
`d4f509f` Workspace registration · `d9ea26e` derived columns · `5a8b3f6` cost summary + Compare ·
`05e6781`+`0b1772b` e2e.

**The rates enter as coefficients, not a code path** (hard rule 6): `solve_jade` reads them into the
existing `ic_cost`/`ob_cost` closures with the module constants as named defaults. `transportRates` is
echoed on *every executed* JADE outcome — including the infeasible early return, which required
`{**_EMPTY_METRICS, …}` rather than assignment, because `_EMPTY_METRICS` is a module constant shared
by every model's error path. A test pins that it is never mutated.

**The maxima are product limits, and the review proved they are not a safety proof.** The spec claimed
rate ≤ 10 / minimum ≤ 10,000 kept coefficients "inside CBC's reliable range", with arithmetic built on
"~22,000 tons per customer-product". Measured against the real dataset, that figure was an *average*
(86,877.5 / 4); the true maximum cell is **32,007.5**, and all three rows of the spec's table
understated: the `9999`-sentinel coefficient is **3,200,429,925** (claimed 2.2e9) and the worst
minimum-charge coefficient **320,075,000** (claimed 2.2e8). The CBC-reliability claim was removed
rather than restated — nobody has run that conditioning study.

**What actually makes the solve safe is a cross-field guard, and the hole it closes predates this
feature.** `distanceOverrides[].distance` and the demand fields were `z.number().nonnegative()` with
**no `.finite()`**, so literal `Infinity` parsed, and `0.12 × 1e308` already overflowed with no
`transportCosts` present at all. Now: `.finite()` at the shape layer; a `coefficient_range` precheck
(`precheckJadeInputs`) that mirrors the objective exactly — inbound per-ton, outbound cost×demand —
and 422s before a `solve_jobs` row exists; and a `math.isfinite` backstop in `solve.py` for callers
that bypass the API, proven by a test that fails if CBC is invoked at all. No magnitude ceiling
anywhere: a large-but-finite coefficient is legal.

**A rate is per unit distance, so it converts as the reciprocal of a distance.** `UnitApi.toDisplay`
multiplies; using it on a rate would render 0.07 $/ton-mi as 0.1127 $/ton-km — freight getting more
expensive because someone flipped a display switch. The correct value is 0.0435. Rather than a
parallel `useRateDraft`, `useDistanceDraft` gained one optional `convert?: DraftConversion` defaulting
to the distance pair, so all **six files / ten call sites** stayed byte-identical (the spec said five
callers; measured, `WarehouseTable`/`CustomerTable` only mention the hook in comments). Minimum
charges pass an identity pair. The semantic no-op guard lives in the tab's `onCommit`, compares in
display space at `roundForFile`'s 4 dp, and is what stops a cross-unit round trip (`0.070006…`) from
staling a scenario.

### Review findings worth keeping

- **A test that hand-authors the row the mocked DB returns proves nothing.** T4's first write-path
  tests set `mockDb.update.mockReturnValue([{…inputs: withRates}])` and then asserted the response
  contained the rates — a writer that stripped the key would have passed. Rewritten to assert the
  argument handed to `.set()`/`.values()`, plus a real-Postgres `jadeTransportCostsPersistence` test.
  The implementer then mutation-tested the fix (commenting out the schema field turns it red).
- **A contract-enum change broke a hardcoded list two tasks downstream.** `9e73f6b` appended
  `coefficient_range` to `PrecheckError.code`; `maxCoverageContract.test.ts` asserts set-equality
  against a hardcoded 8-value array and went red. Root cause was a lead dispatch error — T2's gate was
  scoped to one test file. Standing correction: a contract/schema-wide change runs the full package
  suite, never a single `--` filter.
- **Label-derived testids change when the label does.** `CostSummaryTab` derives each row's testid
  from its label text; unit-aware labels would have produced `cost-summary-value-inbound-rate-ton-mi-`
  — an id that moves with the display toggle. The row tuple gained an explicit testid slot with a
  mandatory label-derived fallback, because **45** existing `cost-summary-value-*` references across
  the unit tests and e2e specs depend on the old derivation.
- **Three pre-existing bugs in `jade-two-echelon.spec.ts`**, dormant because `skipIfJadeLocked()`
  skipped the file while Chapter 9 was locked: `readObjective()` returned NaN once the objective
  rendered with a `$` prefix; `assignment-row-`/`flow-row-` prefixes never matched JADE's own
  `JadeAssignmentsTab`/`JadeFlowsTab`; and `input-filter-to` was filled before its Popover trigger was
  clicked, which consumed the whole test budget and surfaced at an unrelated `finally`. Fixed, plus
  `actionTimeout` and 23 previously-bare clicks bounded.

### Gates (measured this run, zero concurrent vitest confirmed first)

`pnpm run typecheck` clean · api-server **61 files / 1676 tests** · studio **123 files / 2267 tests** ·
`typecheck:e2e` clean · solver pytest **323 passed** · `e2e_accuracy.py` **99/99 unmodified** ·
`e2e_journey.py all` **181/181**. Both vitest suites passed first try with no flakes.

`pnpm e2e:gate`: **62 expected / 3 unexpected / 1 flaky** out of 66, read from
`e2e/report/results.json` rather than the console tail. None attributable to this bundle — all four
JADE specs, including the new `jade-transport-costs.spec.ts`, passed without retry. The three:
`posthog-analytics` and `sentry-capture` need `VITE_POSTHOG_KEY` / `VITE_SENTRY_DSN` on the dev server
(both document the requirement; neither is set locally), and `workspace-fixups-2` fails on
`expect(distanceBands).toContain(2000)` — a contract false since chen-bands-units (bands are a
reporting lens, never persisted by a solve). This branch never touched that file.

### Open, for the merge decision

**`e2e-jade-specs` (tip `a10acf5`) fixes the same four drifts in `jade-two-echelon.spec.ts`
independently, and is not an ancestor of this branch or of `main`.** 160 lines diverge in that one
file, so whichever branch merges second conflicts. `a10acf5` additionally carries the
`workspace-fixups-2` rewrite that would clear the third e2e failure above, and a `ci.yml` change
making e2e blocking — neither exists here. Only `a10acf5`'s stronger `readObjective` shape (assert
`/^\$[\d,]+\.\d{2}$/` before parsing, rather than silently stripping non-numerics) was adopted into
this branch, by hand. The fate of that branch is a human decision and was deliberately not taken here.

Deferred, and the whole-branch review found the gap is wider than first recorded — both halves are
the same shape, so here is the full outline rather than half of it. The `coefficient_range` precheck
can pass where `solve.py`'s backstop then raises, in two ways:

1. **Inactive lanes.** The precheck sweeps only *active* plants/warehouses/customers, while
   `solve.py` builds objective terms for every warehouse (`get_bounds` merely clamps an inactive one
   to `(0,0)`). A ~1e100 distance override on a lane touching an inactive warehouse passes precheck.
2. **The demand aggregate.** `solve.py` also guards `total_demand` for finiteness and the precheck
   has no mirror for it. Reachable with no individual coefficient overflowing at all: set
   `obTransCost = 0` and `obMinTrans = 0` (both legal), then give two customers `1e307` demand each
   — every product term is `0 × 1e307 = 0`, finite, while the *sum* overflows.

Both degrade to a `SOLVE_FAILED` job instead of a 422 with a specific message. Truthful either way,
and both need absurd magnitudes, so they are deferred rather than fixed — but they are one fix
(sweep the full entity set and check the aggregate), not two.

---

## ch9-e2e-findings — what the ch9-unlock e2e follow-up learned (2026-09-30, recorded 2026-10-02)

Branch `ch9-docs-salvage` off `main`. **This is a findings record, not a shipping record.** Its
investigation happened on `e2e-jade-specs` (`a10acf5`), whose CODE deliberately does not land under
this entry — so nothing below claims a change that is not in `main`. Where each piece ended up:

| Piece | Where it actually is |
|---|---|
| `jade-two-echelon.spec.ts` four drift repairs | **In `main`**, reached independently by the ch9-jade-fixes line, which adopted `a10acf5`'s stronger `readObjective` shape |
| `workspace-fixups-2.spec.ts` band-contract rewrite | **In `main`** — landed via `ch9-e2e-salvage` (`c4d448b`), merged as part of `4399625` on 2026-10-02; `main`'s line 621 now asserts `toEqual([200, 400, 800, 1600])` in place of the false `toContain(2000)` |
| `ci.yml` → `continue-on-error: false` | **Deliberately not taken** — see the secrets finding below |
| This record + the flake-list line | here |

Writing the original entry verbatim was rejected on hard rule #9 grounds: an entry is tied to the
commit whose work it describes, and describing an unlanded `ci.yml` flip as done would be a worse
record than none. The findings themselves are true regardless of which branch carried them, which is
why they are kept.

**The four drifts, and why each was invisible.** All four accumulated while Chapter 9 was locked and
`e2e/helpers/modelLock.ts` skipped the spec — a skipped spec rots silently:
- `readObjective` parsed with `Number(text.replace(/,/g, ""))`. chen-bands-units Part D decision 6
  routed objectives through `formatObjective`, and JADE's dimension is `monetary`, so the cell reads
  `$254,060,828.62`. The `$` made the parse `NaN`, and **`expect(NaN).toBeLessThan(1)` fails looking
  exactly like a ground-truth accuracy regression on a sacred value** — it never compared a number at
  all. The fix asserts `/^\$[\d,]+\.\d{2}$/` BEFORE parsing rather than stripping non-numerics,
  because a silent strip keeps passing if the dimension ever regresses to `opaque`.
- `assignment-row-*` → the product-level, PAGINATED `JadeAssignmentsTab` (`row-jadeassignment-*`), so
  `count() === 100` was counting a page.
- `flow-row-plant-4-wh-11-product-1` → the P→W grid is aggregated per (plant, warehouse); that
  product segment no longer exists.
- The From/To filter inputs moved INSIDE the `FilterMenu` popover with their testids deliberately
  preserved — so `input-filter-to` read as a live selector while not being in the DOM.

**The worked example worth keeping (CLAUDE.md's unbounded-action trap, caught in the act).** That
last `.fill()` had no explicit timeout. It sat unactionable, consumed the **entire remaining 240s
test budget**, and surfaced as `apiRequestContext.delete: Test timeout` **on the `finally` block's
cleanup — 200s and ~190 lines away from the real failure**. The first diagnosis was "slow test, raise
the budget", and that was wrong: bounding all 8 unbounded interactions made it fail **at the real
line in 22s**, and the budget was then restored to 240s because the whole spec runs in ~15s. The
lesson is not "add timeouts" but that an unbounded action converts a 10-second bug into a teardown
mystery, and the instinct it provokes (raise the timeout) is the opposite of the fix.

**A spec asserting a contract that is false.** `workspace-fixups-2.spec.ts` required a 5th distance
band added in the Solve dialog to be PERSISTED by solving. `Workspace.tsx`'s `handleSolve` documents
the opposite: bands are a reporting LENS, and "a lens-only-dirty Run does NOT reach this branch at
all (`ordinaryDirty` is false) … deliberately leaving the lens dirty". The correct assertion is
two-directional — solving must not persist a lens edit, and the bands-only Save
(`handleSaveBandsOnly`'s field-scoped PATCH) must.

**OPEN PRODUCT BUG, found while writing that and not fixed.** On the **Input Map** tab a bands-only
edit has **no reachable Save at all**: that tab's Layers-row Save is wired `isDirty={isDirty}` (i.e.
`ordinaryDirty`) with `onSave={handleSaveInputs}`, which early-returns unless `ordinaryDirty`
(`Workspace.tsx:3487`), while `Workspace.tsx:4552` suppresses the SHARED toolbar Save on exactly that
tab — so `saveEnabled` (`ordinaryDirty || lensDirty`, label "Save bands") never reaches it. The edit
is not lost (any other input tab shows a working Save), but on that one tab the affordance is dead.
**Not JADE-specific** — the same wiring covers every model whose Save moved into the Layers row
(`saveInLayersRow`, `…Transport`, `…TwoEchelon`, `…Jade`).

**The CI-blocking finding, which is why `ci.yml` is untouched here.** Making the e2e job blocking
requires `posthog-analytics.spec.ts` and `sentry-capture.spec.ts` to stop failing, and they fail
because `VITE_POSTHOG_KEY` / `VITE_SENTRY_DSN` are absent. Verified against `gh secret list`: the repo
has `CLAUDE_CODE_OAUTH_TOKEN`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_KEY`, `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, `SENTRY_PROJECT` — **neither `VITE_` name exists**, and an unset secret expands to
empty, so wiring them changes nothing until they are created. The product owner chose "create the two
secrets" over conditional skips; until that happens the flip stays unmade, because a blocking job
reddens `main` on every push. Two traps for whoever does it: `VITE_*` must be set on the **studio**
step (Vite inlines them at BUILD time — setting them on the Playwright step is a silent no-op), and
they should point at a **test** PostHog project and Sentry DSN, since CI fires on every push and that
traffic is indistinguishable from real users afterwards.

**Gate numbers from the 2026-09-30 run, kept because the flake arithmetic is the point.** Full local
`e2e:gate`: **54 passed / 4 unexpected / 6 flaky / 0 skipped** in 44.3 min. The `0 skipped` is
ch9-unlock confirming itself — those were the JADE skips. Of the 4 unexpected, two were the missing
secrets above; `chen-bands-units-qa` and `delivery-teaching` both passed **9/9 in 58s re-run alone**.
The console printed "4 failed" and silently folded the 6 retried-and-passed away; the honest figure
is 10 of 64 load-sensitive. That arithmetic is now in CLAUDE.md's flake list, where it bears directly
on the standing proposal to make the e2e job blocking.

---

## bands-save — the Input Map's Layers-row Save now honours a lens-only change (2026-10-03)

Branch `input-map-bands-save` off `main` (`e899216`). Fixes the open product bug recorded in the
ch9-e2e-findings entry above.

**The bug.** Distance bands are a reporting LENS, tracked by their own `lensDirty` flag and persisted
by a field-scoped PATCH, separately from `ordinaryDirty` + the whole-input PATCH. The shared toolbar
Save knows both — `saveEnabled = ordinaryDirty || lensDirty`, relabelling itself "Save bands" and
dispatching through `handleSaveClick` when only the lens changed. But seven models moved their Save
off that toolbar into the Input Map's own Layers row, and all four `<InputMapTab>` mounts wired it
`isDirty={isDirty}` (i.e. `ordinaryDirty`) + `onSave={handleSaveInputs}` (which early-returns unless
`ordinaryDirty`) — while `Workspace.tsx` suppresses the shared toolbar Save on exactly that tab to
avoid a duplicate. **Net: on the Input Map, a bands-only edit left the one Save on screen greyed out
and inert.** The edit was never lost — any other input tab still offered a working "Save bands" — but
nothing on that tab said so, so the honest reading was "my band edit will not save".

**The fix is the four mounts adopting the contract that already existed**, not a new mechanism:
`isDirty={saveEnabled}`, `onSave={handleSaveClick}`, `saving={saveIsPending}`, plus a new optional
`saveLabel` prop on `InputMapTab` so the in-row button can render "Save bands" exactly as the toolbar
does. Without that label the two surfaces would disagree about one state, and on this tab plain
"Save" is the more misleading of the two — it implies a whole-input write that is not what happens.

**Why a source-reading test joins the behavioural one.** The bug was present in all four mounts
identically, and "a per-model gate a sibling model silently misses" is this repo's most-documented
recurring class. Four near-duplicate behavioural tests would still not cover a fifth mount added
later, so `inputMapSaveWiring.test.ts` asserts the wiring at the source level — same technique
`lockedModelGuards.test.ts` uses for the route guards — including a vacuity tripwire (the mounts are
found at all) and a check that the toolbar-suppression list and the wired-mount set stay the same
size. Reverting a single mount fails 2 of its 5 cases; verified by mutation, not assumed. The
behavioural proof that the shared contract does the right thing is the new
`Workspace.Integration.test.tsx` case, which asserts there is exactly ONE Save on the tab before
asserting anything about it, so it cannot pass by reading the toolbar control.

**Gate (zero failures, zero flakes — concurrent vitest verified 0 beforehand):** typecheck clean ·
studio **2273/2273** (124 files) · api-server **1676/1676** (61 files) · solver pytest **323/323**.
No solver, dataset or API change, so `e2e_accuracy.py` is not implicated.

**Real-browser verification on a DIFFERENT mount than the unit test covers.** The RTL case exercises
the `two-echelon-jade-us` mount; the browser check used `p-median-us` (the "pmedian" arm, which also
serves brazil / max-coverage / delivery) against a real stack. Removing band 400 on Optimization
Parameters then switching to Input Map showed exactly one Save, inside `input-map-tab`, labelled
"Save bands", enabled, with "Unsaved changes" present — identical to the toolbar's state. Clicking it
persisted `[200,400,800,1600]` → `[200,800,1600]`, returned Save to disabled, cleared "Unsaved
changes", and left `solvedAt` **unchanged**, which is the proof it took the field-scoped bands PATCH
rather than a whole-input write or a re-solve.

---

## 2026-10-03 — Cosmetic UI bundle (`cosmetic-ui`, COSM-1…COSM-5)

Five user-requested cosmetic/UX changes, one commit each. Spec:
`docs/superpowers/specs/2026-10-03-cosmetic-ui-bundle-design.md`. Plan:
`docs/superpowers/plans/2026-10-03-cosmetic-ui-bundle.md`.

| Commit | Change |
|---|---|
| `46af6e7` | COSM-1 — remove the workspace open-tab strip |
| `225b23a` | COSM-2 — Chapter 4's step toggle moves into the always-visible toolbar row |
| `30847fa` | COSM-3 — the green network mark becomes the browser tab icon |
| `4b3e5ca` | COSM-4 — feedback widget on the homepage, stored unattributed |
| *(this commit)* | COSM-5 — animated network background behind the homepage, and this record |

**COSM-1 — the strip is gone and the sidebar is the sole navigator.** `TabBar.tsx` and the 66-line
`lib/workspaceTabs.ts` reducer are both deleted; the active view is one
`useState<WorkspaceView | null>`. The first draft of the plan argued for *retaining* the reducer on
the grounds that replacing it meant reworking "every dispatch call site" — review found exactly
three (`open`, `activate`, `close`), two of which die with the strip, so `useState` was the smaller
change and the plan's own reasoning had been inverted. **A deliberate behaviour change rides along:
stale outputs are now unreachable until a re-solve.** `jade-transport-costs.spec.ts:146-154`
documented the strip as the second half of a two-part stale-output contract — the sidebar disables
stale outputs, and the strip deliberately did not, so an already-open tab stayed clickable and
rendered `StaleOutputBanner`. Removing the strip removes that return path. The user chose to accept
it. `StaleOutputBanner` is retained and untouched: `Workspace.tsx:4071-4085` already blanks output
content behind it "even if the tab was already open+active", so the banner replaces stale content
rather than annotating it, and no redirect effect was needed. The PostHog event
`"scenario tab viewed"` retired with `handleActivateTab` after a live check found no consuming
insight (23 insights and 0 alerts in project 527945 inspected individually).

**COSM-2 — one mount, restyled for a light surface.** The toggle was `--ink-300` on the dark band,
which is 2.01:1 on `--surface-sunken`; it now uses `text-muted-foreground`/`hover:bg-muted`. Chapter
4's Input Map Save moved out of the Layers row into the shared toolbar so the two sit together, via
a `showInlineSave` prop on `InputMapTab`'s `"pmedian"` union variant — `p-median-us` and
`p-median-brazil` share that variant and keep their inline Save. The plan's Step 10 was factually
wrong (the Save `<Button>` had no condition of its own and relied on the row's), which if followed
literally would have rendered Save on every Chapter 4 output view; resolved by extracting the row's
original condition verbatim to a named `showToolbarSave`, verified byte-identical so the other six
models' render set is provably unchanged.

**COSM-4 — the privacy guarantee is the feature, and it is enforced in three places.** The
`feedback` table has exactly `id`, `body`, `created_at` (`timestamptz`) — no account, session or IP
column, which is what makes the UI's "Stored without your account ID — we don't save who sent this"
literally true of what is written. The route authenticates only to use the user id as a transient
in-memory rate-limit key, never persisted. It keys on the **user id, not `req.ip`**: this app sets
no Express `trust proxy` and Render terminates TLS at a load balancer, so an IP key would collapse
into one shared bucket and let a single abuser block everyone. Validation runs before the limiter so
malformed requests cannot consume an honest user's quota, and the body is trimmed before validation
because the contract's bounds are post-trim. Column absence is proven twice — `getTableConfig`
metadata in `schemaColumns.test.ts` and a live `information_schema.columns` query in
`feedback.test.ts`; an ORM-level "the returned object lacks a user property" check cannot prove it,
because a missing value and a missing column look identical through the ORM.

**A new bug class, found by review of COSM-4 and worth generalising: an unwrapped drizzle call can
leak user-authored text into every error sink, and the Sentry scrubber does not stop it.**
drizzle-orm 0.45.2 builds `DrizzleQueryError`'s message as
`` `Failed query: ${query}\nparams: ${params}` `` and retains `this.params`. So an insert that fails
puts the *parameter values* into the thrown error's own message, which `app.ts` then feeds to three
sinks: PostHog's `setupExpressErrorHandler`, `Sentry.setupExpressErrorHandler`, and
`logger.error({ err }, …)`. `artifacts/api-server/src/lib/sentry.ts`'s `scrubEvent` deletes `event.request.data`, `cookies`
and `query_string` — it never touches an exception's message, so a scrubber that looks complete is
not. For a feedback box this is the one content the feature is careful about everywhere else. Fixed
with a `try`/`catch` carrying **no error binding**, so the original error cannot be rethrown, logged,
or passed to `next()`. Verified red first: without the guard the test receives
`{error:"Internal server error"}` from `app.ts`'s handler instead of the route's own 500, which is
the proof the escape path was real rather than theoretical. **This applies to every existing
unwrapped drizzle call that handles user input, not only the one added here** — auditing the
existing routes was deliberately left out of a cosmetic bundle's scope.

**COSM-5 — ported to React, not mounted as a custom element.** Constants were hand-diffed against
the committed source at `docs/superpowers/specs/assets/2026-10-03-network-bg.html` (SHA-256
`df9efa66…`). Sizing uses `ResizeObserver`, not `window.resize`, because Landing's Recent Solves
section arrives asynchronously and changes the container height, which a window listener never
observes; and because resetting `canvas.width` clears the bitmap, the reduced-motion path **must**
redraw on each observed resize or the canvas goes permanently blank. It mounts into the same
`AppShell` wrapper COSM-4 introduced, gated on `hero` — the only route passing it is `/`.

**Gate.** typecheck clean · studio **2277/2277** (124 files) · solver pytest **323/323** ·
`PORT=5174 BASE_PATH=/ pnpm --filter studio build` clean · api-server **1678 passed / 6 failed of
1684**, all six failures inside the single file `src/solver/__tests__/dispatcherRecovery.test.ts`,
which is already on the documented flake list and passed **27/27 in isolation** on a branch that
changes **zero** solver/jobRunner files.

Playwright `e2e:gate` read from `results.json`, not the console tail: **65 expected, 0 flaky, 2
unexpected**. The two were `posthog-analytics.spec.ts` and `sentry-capture.spec.ts`, which capture
zero payloads unless the studio dev server has the analytics env vars — `analytics.ts:14` is a bare
truthiness check on `VITE_POSTHOG_KEY`, and `ci.yml:202-203` supplies both secrets in CI.

**Those two were then actually run rather than excused, and both pass — the real gate is 67/67, 0
flaky.** Filing them as "environmental" would have merged them *unverified*, not merely red, and
`posthog-analytics.spec.ts` asserts that no captured payload contains PII across every event the
SDK sent — precisely the assertion a branch adding a free-text submission route should face. Both
specs stub the ingest host before any request leaves the page (`posthog-analytics.spec.ts:63-65`,
`sentry-capture.spec.ts:80-83`), so dummy values make them execute for real:

```
PORT=5174 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 \
  VITE_POSTHOG_KEY=phc_local_dummy_key \
  VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 \
  pnpm --filter studio run dev
```

`CLAUDE.md`'s local e2e recipe omits both vars while those two specs point *at* that recipe, which
is why the first run had no way to go green — a doc defect handed to the user as a separate task,
not patched inside a cosmetic bundle.

**Real-browser verification against the full local stack.** Favicon resolves to
`/global-network.png` (200 `image/png`). The background canvas is `aria-hidden` with
`pointer-events: none`, and an `elementFromPoint` at a chapter card returns a `<P>` *inside* that
card — the canvas intercepts nothing. The feedback launcher is the topmost element at its own
centre, and its bottom (703px) clears the credit footer's top (719px). A real submit persisted
exactly one row — `id`, `body`, `created_at` as `timestamp with time zone`, no identity column — and
the panel auto-closed. **Known residual:** at 768px and 900px the launcher geometrically overlaps
one chapter card (measured: 0 cards at 375px, 1 at both 768px and 900px), so it intercepts clicks on
that small corner. No spec runs at those widths today; cosmetic and bounded.

## 2026-10-03/04 — Sidebar hamburger rail (`sidebar-hamburger-rail`, SBR-1…SBR-5)

Cosmetic/UX only: no API, DB, solver or generated-code surface. The model-page sidebar
(`SidebarTree`, one component serving all 7 chapters) becomes a hamburger-toggled icon rail —
collapsed by default with the choice persisted under `nos:sidebar-collapsed`, a unique lucide icon
per Inputs/Outputs entry, a CSS-only hover label pill, and a Scenarios rail icon whose flyout holds
the real scenario list. Spec: `docs/superpowers/specs/2026-10-03-sidebar-hamburger-rail-design.md`.
Plan: `docs/superpowers/plans/2026-10-03-sidebar-hamburger-rail.md`.

| Task | Commit | What |
|---|---|---|
| SBR-1 | `4e599c0` | `entityIcons.ts` — entity→icon map, unique across the whole set, `Circle` fallback |
| SBR-2 | `f27370f` | collapse state + persistence + hamburger + the Inputs/Outputs rail |
| SBR-3 | `eb89ddb` | `InvalidateOnResize` mounted in **all five** `<MapContainer>`s |
| SBR-3b | `0721c92` | coalesce `invalidateSize` to one call per settled resize |
| SBR-5 | *this commit* | the three collapsed-flyout e2e hovers + this entry |

**The design decision worth recording.** Collapsed-by-default was re-decided by the user *after*
`cosmetic-ui` removed both the tab strip and the header scenario dropdown, which together make the
sidebar the only navigator **and** the only scenario switcher. Both agent sessions recommended
expanded-by-default for discoverability; the user chose collapsed with those facts stated. QA then
produced the evidence that supports the call: at a 375px viewport the Optimization Parameters tab
has **0 clipped elements with the rail collapsed (331px of content) versus 1 clipped and only 151px
expanded**. The rail buys back 180px exactly where the content column was starved.

**Why the Leaflet fix touches five files, not one.** `grep -rn "<MapContainer" src` returns
`NetworkMap.tsx:634` **and `InputMapTab.tsx:1074, :1577, :2072, :2655`** — `InputMapTab` builds its
own map and has zero references to `NetworkMap`. A `NetworkMap`-only fix would have left the
**auto-opened Input Map** stale on every toggle while every gate reported green. Two existing
react-leaflet mocks stub `useMap` as `{setView, fitBounds}`; they needed `getContainer`/
`invalidateSize` or the new effect throws from inside `useEffect`. That was verified by reverting one
stub and watching `Workspace.TabCoverage` produce four `map.getContainer is not a function`
failures, rather than assumed.

**A misdiagnosis, corrected and kept in the source.** Browser QA repeatedly showed the nav stuck at
the wrong width — `data-collapsed` saying one thing and the measured width the other, in both
directions. It was diagnosed as a main-thread stall from ~60 `invalidateSize` calls per toggle, and
the debounce was written as the fix. The symptom was **not real**: it was an artifact of driving the
page in a background tab, where Chrome freezes CSS transitions (`playState "running"` with
`currentTime` pinned at 0, `document.hidden` true). With the tab actually rendered the width tracks
the class every time. The debounce is kept on its own merits — 60 redundant Leaflet recomputations
per click is worth removing — and `InvalidateOnResize.tsx` says exactly that, so the next reader
does not inherit the wrong story.

**Test-impact numbers, corrected twice.** The first draft claimed 227 sidebar references across 26
e2e files; that count swept `e2e/report/`, which holds Playwright run artifacts. Real: **193 across
23 spec files**, plus 277 occurrences across 15 real RTL files. The pre-existing `SidebarTree.test.tsx`
count was stated as 12 and is **17** (measured by running it). Both were caught by review, not by
the author.

**What made ~439 row references survive untouched:** the label pill is a **child of the entry
`<button>`**, visually hidden with `opacity-0 pointer-events-none` and never unmounted, so
`toHaveTextContent` still reads it and every `data-testid` resolves in both states. All **17**
pre-existing `SidebarTree` tests pass **unmodified**. Only 3 interactions needed edits — delete and
confirm-delete in `empty-first-run-workspace.spec.ts`, clone in `two-echelon.spec.ts` — each gaining
a `.hover()` on the rail's Scenarios icon with an explicit timeout.

**Gates.** typecheck clean · studio **2307/2307** across 126 files (0 concurrent vitest verified
first) · api-server **1683/1684**, the one failure being `dispatcherRecovery.test.ts`, a documented
flake, **27/27 isolated**, on a branch touching zero api-server or solver files · solver pytest
**323/323** · Playwright `e2e:gate` **67 expected, 0 unexpected, 0 flaky** — nothing retried into
passing. An earlier gate run showed `design-system.spec.ts:249` failing and did not reproduce on
re-run; it is already on the documented load-flake list.

**QA (real browser, local stack).** Rail renders one icon per entry with the active row highlighted;
hovering one rail icon slides out only that row's label, **over** the map (the `relative z-50` on the
nav is what keeps the pills above `.leaflet-container`'s explicit `z-index: 0`); Input Map and Output
Map both redraw at the new width with no blank strip; the Scenarios flyout opens with the real list;
the collapsed/expanded choice survives a reload. JADE at **1366×768** — the longest rail, 14 entry
rows — ends at 585px against a 768px viewport, fully visible with no overflow, so the spec's §7
viewport risk does not materialise. The 768–900px feedback-launcher overlap QA item is **moot**: the
Cosmetics session re-docked the launcher into the footer on its own branch.

## claude-md-lazy-load — root CLAUDE.md slimmed via lazy-loaded subsystem files (2026-10-05)

`/doctor` flagged the root `CLAUDE.md` at ~69k chars (over Claude Code's large-memory-file warning threshold; est. ~17k tokens resident in every session and subagent). Subsystem-scoped Gotchas moved verbatim (no rewording) into nested `CLAUDE.md` files that auto-load only when a session works under that directory: `artifacts/studio/CLAUDE.md`, `artifacts/studio/e2e/CLAUDE.md`, `artifacts/api-server/CLAUDE.md`, `artifacts/api-server/src/solver/CLAUDE.md`, `lib/db/CLAUDE.md`. Render deploy / resource-creation / production-Postgres / Render-MCP gotchas moved into a new `render-ops` skill. Root keeps Hard rules, Branch discipline, and the cross-cutting Gotchas (agent dispatch, flake lists, concurrent-test contention, the sacred-script note), plus a pointer paragraph that inlines the two never-miss Render rules (role pair is by design — never DROP/REASSIGN; a push deploys neither service). Cut as derivable: the Architecture directory tree and the "Tests live per package" line. Hard rule #9 and the "Where things live" table now name the nested files as the home for subsystem-scoped rules. Also quoted `docs-audit`'s `description:` — its unquoted `Report-mode: …` colon made the YAML frontmatter unparseable, so every field was being silently dropped. Root: 69,561 → ~36.6k chars. Whole-branch review (post-merge) found no content loss; fixed on the branch: the pointer paragraph had flatly said a push deploys neither service, contradicting Branch discipline (both services are armed — it now says treat a push as deploy-adjacent); repointed `(see Gotchas)` webhook refs, `docs/ops/{smoke,v2-write-activation}.md`, and `frontend-engineer.md` at the new homes; added root pointers for the e2e local-run recipe and the locked-model gotcha's cross-directory triggers (`solvers/*/manifest.json`, `chapters.ts`).

## agents-opus-ponytail — review model unpinned to latest Opus; ponytail + karpathy made compulsory for code-writing roles (2026-10-05)

`AGENTS.md` model policy: the four engineering roles' Review column moved from `opus 4.8` to **latest Opus**, deliberately version-agnostic — pass `model: opus` and let the harness resolve the newest Opus, rather than re-editing this table per release. Lead line moved to Opus 5 (the model actually running the session). qa-sdet's review stays `fable` (independent lens, unchanged).

New hard rule **#12** in `CLAUDE.md`: the lead and the four engineering roles (backend/frontend/solver/devops) must invoke `andrej-karpathy-skills:karpathy-guidelines` **and** `ponytail:ponytail` before writing code, and `ponytail:ponytail-review` on the review pass. Rule states explicitly that neither skill licenses cutting validation/error-handling/security/accessibility and neither overrides hard rules #1/#5/#6. **qa-sdet is exempt from both** — explicitness and redundancy are the point in test code, and minimizing lines in a test is how you get a test that cannot fail.

ponytail installed at **user scope** (`claude plugin marketplace add DietrichGebert/ponytail` + `claude plugin install ponytail@ponytail`), v4.11.0: 6 skills, 3 harness-only hooks (`SessionStart`, `SubagentStart`, `UserPromptSubmit`), ~985 always-on tokens, default mode `full` (`DEFAULT_MODE` in `hooks/ponytail-config.js:16`).

The qa-sdet exemption is **enforced, not merely written**. `hooks/ponytail-subagent.js` injects the ruleset into *every* subagent unless `PONYTAIL_SUBAGENT_MATCHER` scopes it by `agent_type`, so `.claude/settings.json` now sets that regex to `^(backend|frontend|solver|devops)-engineer$`. Measured against the real hook before claiming it: engineering roles receive 5,448 bytes of injected ruleset, `qa-sdet` and `Explore` receive 0. The hook fails *open* on an unreadable `agent_type`, so rule #12 also tells qa-sdet to ignore an injected ruleset and say so in its report. The lead is covered by `SessionStart`/`UserPromptSubmit`, which the matcher does not affect.

`permissionSettingsHooks.test.ts`'s "preserves the pre-existing env block" assertion was a strict `toEqual` on the whole `env` object and went red on the new key — loosened to `toMatchObject` (its intent was "T7 did not clobber an existing key", not "env is frozen"), plus a new case asserting the matcher admits the four engineering roles and rejects `qa-sdet`/`Explore`/`general-purpose`, so widening the regex now fails a test instead of silently re-injecting into qa-sdet. Scripts suite 5/5 on that file, 249/251 overall; the two reds are `strip-network-edits.test.ts`, confirmed pre-existing by re-running them on a stashed-clean tree. `docs:lint` unchanged by these edits (its stale-reference findings are the pre-existing glob/placeholder false positives; no new line of mine appears).

**Whole-branch review findings (folded on the branch, re-merged).** Six findings, all accepted. The material one: hard rule #12 was **unsatisfiable by the four roles it binds** — `.claude/agents/{backend,frontend,solver,devops}-engineer.md` pin an explicit `tools:` allowlist (`Read, Edit, Write, Bash, Grep, Glob`) with no `Skill` tool, so every dispatched engineering agent would read the obligation and have no way to invoke either skill; and because the `SubagentStart` hook carries ponytail only, **nothing injects karpathy at all**, so that half could never be met even in principle. Fixed by adding `Skill` to those four allowlists (qa-sdet deliberately left without it, matching its exemption); `claude plugin validate .claude` passes. Rule #12 now also states that the matcher governs *who* receives the ruleset rather than *that* it is on (`ponytail-subagent.js` exits early when the per-project mode flag is `off` or unset, which a bare "normal mode" prompt clears), and that the skill invocation — not the injected text — is the obligation. `AGENTS.md`: the "loads `CLAUDE.md` + relevant skills on spawn" claim was false under those allowlists and now says skills do **not** auto-load; the latest-Opus paragraph contradicted itself (permitted inline review on the lead's model *and* forbade a sonnet review) and now reads "inline only when the lead IS an Opus, else dispatch `model: opus`"; the lead's "Opus 5" is marked as an observation, not a version pin, so it cannot drift against the de-pinned column two lines above. `permissionSettingsHooks.test.ts` regained the half the `toMatchObject` loosening dropped — a new case asserts `Object.keys(env).sort()` against an explicit allowlist, because every `env` key is injected into every tool and hook child process, so an unreviewed addition (anything re-enabling GLM against hard rule #10, or repointing the API base URL) would otherwise land with nothing going red; 6/6 green. The flake-list path note was generalised: `dispatcherRecovery`, `maxCoverageStepWorkflow`, `overDeadlineDrain` **and** `solverContractIdentity` are all under `src/solver/__tests__/` (verified by `find`), so the warning no longer names only the first and invite a session to delete a real entry it cannot find under `src/__tests__/`.

Not fixable in-session: rule #12's own `ponytail:ponytail-review` half could not run on this branch, because ponytail was installed mid-session and its skills register at the next `SessionStart`. The review was the Opus lead pass only.

## 2026-10-09 — Chapter 4 model interface overhaul (`ch4-model-upgrade`, CH4O-1…CH4O-13)

The two-step solve workflow is **gone**. Chapter 4 (`max-coverage-us`) now has one editable form: the coverage floor is a plain integer whose value *derives* the objective (floor 0 → Model 1 max-coverage; floor > 0 → Model 2 min-distance), so `objective` stops being a client concept and becomes server-owned. The model also converted **kilometres → miles end to end** — dataset, manifest, field names, schema, solver, goldens and a data migration for existing rows. Three coverage metrics moved onto Solution Summary, the cost-summary CSV gained three columns on its own template version, and the Chapter 4 e2e specs were rewritten for the single-form miles UI. Base `3343277`. Spec: `docs/superpowers/specs/2026-10-09-ch4-model-interface-overhaul-design.md`. Plan: `docs/superpowers/plans/2026-10-09-ch4-model-interface-overhaul.md`.

| Task | Commit(s) | What |
|---|---|---|
| CH4O-1 | `229d308` | shared objective derivation in `lib/units/src/objective.ts` |
| CH4O-2 | `2f0f134` + fix `2b391b9` | delete the frontend two-step machinery (19 files, 1561 deletions) |
| CH4O-3 | `a64020a` + fix `ec4b908` | delete the server two-step machinery, keep the create/clone hook |
| CH4O-4 | `a11ccbb` | remove the per-step result surfaces from `openapi.yaml` + codegen |
| CH4O-5 | `ccb067b` (28 files) + fix `ba64f57` | **atomic**: floor + cap unconditional, objective derived server-side |
| CH4O-6 | `b9f9ce1` + fix `3ec84f8` | `avg_distance_cap_infeasible` bound and its three-place contract |
| CH4O-7 | `966ae98` + fix `1803e97` | rebuild Optimization Parameters as one editable surface |
| CH4O-8 | `be0df1f` (56 files) + fix `0a6e186` | **atomic**: miles conversion — dataset, manifest, rename, goldens |
| CH4O-9 | `7ccbd8d` + fixes `c873aa9`, `000912d` | the km→mi scenario migration + its runbook (3 fix cycles) |
| CH4O-10 | `53f2794` | coverage metrics onto Solution Summary, `lockedObjectiveMode` removed |
| CH4O-11 | `a3d9b21` | cost-summary CSV columns on `COST_SUMMARY_TEMPLATE_VERSION = 4` |
| CH4O-12 | `61d29b2` + fix `e4701d8` | rewrite the four Chapter 4 e2e specs |
| CH4O-13 | *this commit* | this entry + the durable lessons into the `CLAUDE.md` files |

Spec commits: `e744cec`, `7831b94`, `ac17f6c`, `9d9551a`, `6d902bb`, `ab43a59`. Plan commits: `4a8a144`, `08bb3c0`, `1c30246`, `f82988c`, `22df155`, `ce8aa65`, `2614c4e`, `c273275`, `10b1ba7`, `a9b6f3e`, `ab9fb89`, `428143e` — eight of those are **corrections to the plan found by the task that executed it**, which is the honest shape of this branch's record.

### The five Codex review rounds, all before implementation

Every finding from every round was independently verified against this repo's code before being folded in — none was taken on the reviewer's word, and two of the reviewer's framings were adopted *verbatim over mine* because mine under-stated the problem.

| Round | Scope | Found |
|---|---|---|
| 1 | spec, partial — **killed mid-run by an OpenAI usage limit** | exactly one finding, and it cascaded into four spec gaps: the precheck defines **19** registration points, not ten. Traced from that one claim: `CLAUDE.md`'s stale count, the fallthrough `inputEntriesForModel` case (point 12), the `computeSha256()` requirement (point 2), and the deletion of point 18. Chasing point 16 also found the precheck's **own entry is stale**, and that following it literally breaks `Workspace.test.tsx:2827`'s source-text grep |
| 2 | spec §4.4–4.5, deliberately shallow | 4 findings, all confirmed. **Critical:** §4.4 claimed Model 1 vs Model 2 was readable on Compare while keeping `lockedObjectiveMode` — the guard blocks *selection*, so the comparison was impossible as specified, and the refusal is implemented **twice** (disabled checkbox *and* a rejection inside `toggleScenario`), so re-enabling only the checkbox leaves it half-removed. **High:** §4.5 wanted a `templateVersion` bump while calling `serviceStats` unchanged — `OUTPUT_TEMPLATE_VERSION` is one constant across eight grids |
| 3 | spec §2 and §3 | 5 findings, all confirmed, **two of them silent-data-corruption bugs** (below). Also: integer rounding could turn a valid persisted row *invalid*; the infeasibility attribution was unreachable in `solve.py`; §3.3's modified list omitted `maxCoverage.test.ts`, which asserts the **inverse** of the new contract |
| 4 | spec §4.3 (the form) | 3 findings + 3 verified-clean. **High, and mine:** the spec told the implementer to delete `SolveDialog.tsx:170`'s `step={1}` — that line is `<Slider step={1}>`, the P slider's **increment**; deleting it makes the slider continuous so a student could pick 3.7 warehouses. I had grepped for `step`, seen the match, and taken it for the referent without reading the surrounding JSX |
| 5 | the 16-task **plan**, breadth-then-deep | 10 findings. Several structural: I had split tasks by **layer** at points where the contract between layers changes, which guarantees a broken intermediate commit — three instances. Produced the ordering rule this branch ran on, merged old T2+T5 and T10+T11 into single atomic tasks, and removed both declared-red commits. Also caught that the previous draft's verification commands were chained with `&&`, which is why it had claimed a suite passed that never ran |

Round 3 also **verified a claim rather than only faulting it**: §2.4's cap lower bound is genuinely valid, traced through `solve.py:1484-1492`, and `solve.py:1533` does still emit `details.uncoveredPct`.

### The branch's worst bug — caught in plan review, before any code

The migration's per-row `UPDATE` originally set only `{inputs, result, solvedAt}` and **skipped the write authority's epoch bump** (plan snippet `ab9fb89`, mine). `jobRunner` publishes a result only if `latestSolveJobId = jobId` **and** `solveInputRevision = enqueuedSolveInputRevision`. With both columns untouched, an **in-flight kilometre-era solve still matched that CAS after the row had been rewritten to miles**, so `markSucceeded` would write a km-era result plus a fresh `solvedAt`. The failure is invisible: `isStale()` is `inputsUpdatedAt > solvedAt`, and because `inputsUpdatedAt` was not bumped either, the fresh `solvedAt` wins and the row reads as **freshly and correctly solved** while holding a result computed in the wrong unit — the `result: null` meant to force a re-solve silently undone. The window is live *precisely* when the runbook says to run the migration, since the old km-era server is still serving users. Fixed by bumping `solveInputRevision` (the in-flight CAS now fails, the job returns `superseded` and never publishes — the designed behaviour for "inputs changed under a running job", which is exactly what a migration is) plus `inputsUpdatedAt` and `resultRunId: null`, all written DB-side via `now()` rather than `new Date()`, because both sides of `isStale()` must come from one clock.

### `objective` was stripped from the CREATE path only — every save would have 422'd

My brief removed the derived `objective` from the create default and stopped there. But `buildWholeInputPayload()` spreads `localInputs`, which is seeded from the **persisted row** — and the persisted row now always carries the server-derived `objective`. Since the write guard uses `"objective" in rawInputs` (presence, not truthiness), **every save of every Chapter 4 scenario would have been refused**, including with the correct value. Fixed with `withoutServerOwnedInputs` at **three** write sites; the third (`handleSaveAsScenario`) had no test at all until the fix cycle added one. The general rule is now in `artifacts/api-server/CLAUDE.md`: a server-derived field needs its derivation on every write path, and the persisted row is itself an input to the next save.

### The km→mi conversion is lossless — established by evidence, not assumed

The Chapter 4 distance matrix is generated from `p-median-us`'s integer miles × 1.609344, so the inverse is exact. Verified independently rather than asserted: **all 5200 pairs integral, max exactly 3219, and the multiset identical to `p-median-us`'s.** (The asymmetry is worth keeping in mind — `160.9344 / 1.609344 === 100` exactly in IEEE-754, so mi→km→mi is lossless while km→mi in general is not. That asymmetry is what exposed FU-2 below.)

### The pytest goldens were RE-RUN, not divided — and the proof is the unit-free ones

Both **unit-free** goldens moved: `coveredDemand` **53385024 → 54946145** and `coveragePct` **68.4192 → 70.42**. Pure division would leave both untouched; they moved because the new `highServiceDistMi: 450` predicate admits a *different covered set* than the old 435 mi equivalent of 700 km. The three distance-dimension goldens *do* equal km / 1.609344 — coherent, since the open set `{DAL, LA, PIT}` is unchanged — and that coherence is exactly why it could not have been the evidence.

Current goldens and the command that produced them, documented inline at `tests/test_max_coverage.py:70-107`:

```
cd artifacts/api-server/src/solver && echo '{"modelType":"max_coverage_us",
"p":3,"highServiceDistMi":450,"maxDistMi":3400,"avgServiceDistCapMi":650,
"coverageFloorDemand":0,"gap":0.0,"timeLimitSec":60,"warehouseOverrides":[],
"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],
"distanceOverrides":[]}' | python3 solve.py | python3 -m json.tool
```

- **Coverage (floor 0):** `coveredDemand` 54946145 · `coveragePct` 70.42 · open `{DAL, LA, PIT}` · `weightedAvgDistance` 394.65 mi · longest served edge 1197 mi.
- **Min-distance:** the same command with `"coverageFloorDemand":54946145` (the coverage run's own achieved demand) → `objective` 30269639699.0 · `weightedAvgDistance` 387.94 mi · open `{DAL, LA, PIT}`.
- Sanity, not a golden: 387.94 ≤ 394.65 ≤ the 650 mi cap, so **the cap does not bind** at the defaults — which is what makes the cap tests' loose case a real no-op check rather than a vacuous one.

The 1000-case benchmark corpus was judged **rename-only, correctly**: all 1000 cases have all three thresholds non-binding before *and* after, so the LP structure and feasible region are identical and only objective coefficients scale. No archived timings exist in-tree to invalidate.

### Deviations

- **The migration's host package.** The km→mi migration lives in `artifacts/api-server/src/migrations/`, not in `lib/db/`. `drizzle-kit push` has no migration history and `lib/db` owns schema shape, not data rewrites over a jsonb blob; the migration is a TypeScript program that validates each row against the new Zod schema, so it belongs with the code that owns that schema's runtime use.
- `lib/units/src/index.ts` was left unmodified (CH4O-1): it is `export * from "./objective.js"`, a wildcard, so the new export is already surfaced at the package root. The plan was wrong, not the implementer.
- CH4O-3 escalated correctly that `jobRunner`'s enqueue had **two** max-coverage blocks, not one. Only the Step 1→Step 2 synthesis belongs to two-step; the survivor is the "refuse a second active solve job" guard forced by the `UQ_solve_jobs_active_per_scenario` partial index. My plan's "no per-model branch" read as delete-both and was wrong (`ce8aa65`).
- CH4O-9's migration report says `alreadyMigrated` for rows with no km-era keys; idempotency was proven on the local DB — dry-run 5/0, then 5 migrated, then 0/5 already-migrated.
- A documented **behavioural** change kept deliberately: a no-op import now produces an empty diff and therefore does **not** bump the solve-input revision, where previously it always did. Arguably more correct; applies to all models, not just Chapter 4.
- "The brief's file list is a floor, not a ceiling" held in **6 of 8** implementation tasks — CH4O-8 alone needed 8 extra files, every one of them a false claim about Chapter 4's unit.

### Follow-ups this branch creates and does NOT close

- **FU-1 — the api-server has no non-mi model, so 13 unit-threading sites are now unobservable.** Chapter 4 was the repo's only kilometre-canonical model; with it converted, 13 production sites reading `manifest.distanceUnit ?? "mi"` are behaviourally indistinguishable from a bare `"mi"` literal: `solver/jobRunner.ts:1404`, `registry/modelRegistry.ts:115`, `routes/referenceDistances.ts:48`, `routes/referenceCosts.ts:33`, `routes/solveHistory.ts:94`, `routes/scenarios.ts:767,943,1022,1107,1216,1328`, `services/import.ts:456`. Worse, `distanceUnit` is `.optional()` in `ManifestSchema` (`lib/dataset-schema/src/index.ts:279`), so **the `?? "mi"` fallback branch itself is unobservable** — a manifest that silently *drops* `distanceUnit` now behaves correctly for all seven models. The two tests' lost teeth do **not** return automatically when a non-mi model is added: the surviving test is pinned to `max-coverage-us` via its own fixture row, so a new km model would need a new fixture and this test would never notice it. The fix is a module-level test seam shaped like `middlewares/lockedModel.ts`'s `setLockedModelsForTests`, which restores all 13 at once (the frontend already solved this with a synthetic `synthetic-km-model` entry). **Size it against 13 sites, not 2 tests.**
- **FU-2 — import does not round unit-converted values; export does. THREE sites.** `roundForFile` wraps all 11 export counterparts in `services/templates.ts`; import has three unrounded `fromDisplay` sites — `services/import.ts:1095` (distances), `:1190` (laneCosts), `:1283` (legDistances). Verified consequence: change detection at `import.ts:1104` is an exact `beforeValue !== parsedDistance`, so a km-sourced import stores `62.13711922373339`, the next same-unit export emits `62.1371`, and re-importing that file reports a **spurious change on a row nobody edited**, firing the DistancesTab changed-row highlight. Pre-existing, model-agnostic, and the fix changes stored values for every model across three entities — correctly not a Chapter 4 units task's business. Needs a product decision: round on import to match export, leave it, or round at the comparison sites.
- **FU-3 — minor hygiene.** The `62.13711922373339` assertion added in CH4O-8 pins a float repr. Fine on V8, but it reads as a chosen precision when it is actually "the unrounded `fromDisplay` output" — worth a one-line comment saying so.
- **FU-4 — `migrate-ch4-to-miles` runs `tsx`, which is not a dependency of `@workspace/api-server`** (`artifacts/api-server/package.json:12`). It resolves today only via the root `package.json` devDependency hoisted into `artifacts/api-server/node_modules/.bin/`. A `--prod` install or a stricter `node-linker` setting leaves the production runbook's only executable step unrunnable. Fix is a one-line devDependency addition plus a lockfile update; deliberately not done inside the review fix wave, because a `pnpm install` mid-wave would have disturbed two concurrently-running fixers' `node_modules`.
- **FU-5 — the toolbar Save swallows a 422 with no user-visible feedback.** `Workspace.tsx:2122-2127` is `saveWholeInputsAsync().catch(() => {})`, self-documented as such and pre-existing for all models. A student types `0` into the avg-service-distance cap (reachable — `"0"` is grammar-complete, so blur commits it), clicks Save, and the UI shows nothing: no toast, no inline error, Save just re-enables. The same invalid draft routed through **Run Optimizer** *does* toast (`:2963`), so the two paths disagree about whether the student is told. Not a Chapter 4 defect, but Chapter 4's seven cross-validated fields are now all on one screen, which is where it will actually be hit. Needs a product decision on how save validation errors surface, not a local patch.
- **FU-6 — the draft no-op guard compares canonical floats, not display space at 4 dp.** `OptimizationParametersTab.tsx:233-244`, and the unconditional avg-cap call site at `:356` has no guard at all. `useDistanceDraft.commit()` fires for any grammar-complete draft, so focusing a field in km mode, retyping the identical displayed text and blurring commits `650 → 650.0000000000001`: the scenario flips dirty, a band retargets to a float, and the drift persists on the next Save. Pre-existing across ten call sites; this branch adds one more. The standing rule it violates is in `artifacts/studio/CLAUDE.md` ("compare in DISPLAY space at `roundForFile`'s 4 dp").
- **FU-7 — a migration-skipped row renders an empty parameter block with no message.** `OptimizationParametersTab.tsx:293` gates the whole Chapter 4 block on `highServiceDistMi != null`, so a row the migration classified as `skipped` loads showing only gap / max-time / bands, and any Save 422s. Ops-mitigated — the runbook's fix-by-hand step is what resolves it — so this is recorded to establish that the step is **required**, not cosmetic, before anyone opens such a scenario. A UI message would be the belt-and-braces fix.
- **FU-8 — two e2e specs carry coincidentally-identical Chapter 4 fixtures.** `max-coverage.spec.ts`'s `coverageInputs()` and `nonjade-servicestats-live-coverage.spec.ts`'s `maxCoverageInputs()` are both 450/3400/650. The third copy, in `chen-bands-units-qa.spec.ts`, is deliberately 700/5500/1000 with its own separately-measured goldens and is **not** duplication. Reviewed and explicitly judged not a blocker, on a distinction worth keeping: the seven drifted `readSolvedAt` copies were byte-identical, bought nothing, and drifted in a *shape* (`id: string` vs `id: number`) that no assertion could see; here a drift in *values* fails loudly, because each spec asserts goldens computed from its own payload. Extract the two that coincide when convenient.
- **FU-9 — `test_max_coverage.py`'s `TestCapBindsInBothModes::test_loose_cap_leaves_min_distance_optimum_unchanged` has no discriminating power.** `BASE` already carries `avgServiceDistCapMi: 650`, so its payload is byte-identical to `test_min_distance_golden`'s and it asserts the same two values; deleting the hoisted cap constraint from `solve.py` leaves it green. The class's other two tests (`test_cap_below_the_true_minimum_is_infeasible_not_reshaped`, `test_cap_below_any_feasible_average_is_infeasible`) both genuinely fail without the constraint, so the class's coverage is real — this is a naming/duplication problem, not a gap. Worth renaming so the class's first test is not read as the proof of the class's title.

### Gates (CH4O-13, measured on a quiet machine)

0 concurrent vitest and 0 vite dev servers verified before starting (`ps aux | grep "[v]itest" | grep -vc "zsh -c"` → 0), and the studio run re-confirmed 0 at its own start.

typecheck **clean** · api-server **1634/1638** · studio **2290/2291** across 124 files · solver pytest **329/329** · `e2e_accuracy.py` **99/99 ALL PASS and unmodified** (`git diff main --stat` on that path is empty; hard rule #2 intact) · `e2e_journey.py … auth` **18/18 ALL PASS**.

**Read the `e2e_accuracy.py` line narrowly: it is NOT Chapter 4 coverage.** That script's sections are `pmedian`/`transport`/`brazil`/`jade`/`cross_model`, and `cross_model`'s three cases are `p_median`/`transport`/`capacitated_pmedian` — `grep -i max_coverage` over the file returns nothing. Both halves of the claim are individually true, but sitting in the gate line of a branch that **re-keyed Chapter 4's entire distance matrix**, "99/99 ALL PASS" invites the inference that the textbook-answer gate validated the km→mi conversion. It did not, and it could not. Chapter 4's accuracy gate is `tests/test_max_coverage.py`, inside the 329/329, plus the hand-run `solve.py` invocations recorded above. Same caveat on the `e2e_journey.py` line: `auth` is the only section that ran, and **no** section of that script exercises `max-coverage-us` — though this branch also changed model-agnostic shared code (`costSummaryRowsToCsv`'s header gained three columns for every model; `routes/scenarios.ts` gained a wrapper-version branch every entity flows through; `lib/units/objective.ts` is shared by all seven models), so `dataset` and `pmedian` would have been worth the minutes and were not run.

One traceability caveat on the Playwright figure below: **62/2/6/0 is not re-derivable from the tree.** `artifacts/studio/e2e/report/` is gitignored, and the `results.json` on disk is a later 10-test isolated re-run. It is session-local evidence with no in-tree artefact.

The two non-green full runs are the documented load-flake class, both confirmed by isolated re-run: api-server's 4 failures spanned 3 files, of which the three captured are `resultEnvelope` ×2 and `src/solver/__tests__/dispatcherRecovery.test.ts` ×1 — **43/43 green** re-run together; studio's single failure was `JadeDistancesTab.test.tsx` — **55/55 green** alone. That api-server run was captured through `tail -60`, so its third failing file and 4th test name were not recorded — deliberately left unreconstructed rather than guessed. `collect` at 180s against a 69s wall clock is the usual contention tell.

**Second, independent api-server run (controller, same commit, full output captured to a file this time) — and it changes what the flake class means.** With `ps aux | grep "[v]itest" | grep -v "zsh -c"` showing **zero** other vitest processes and no dev server up: **7 failed / 1631 passed (1638)** across **4** files — `cors` ×2, `jobRunnerDispatcher` ×1, `resultEnvelope` ×3, `routes` ×1 — then **322/322 green** re-running those same four files together minutes later. Every one is already on the documented list, so the attribution gap above is closed in the only way that matters (nothing unlisted was flaking). Two facts worth more than the numbers:

- **A quiet machine is not evidence against this class.** The list's parenthetical said "under concurrent dev-server/e2e load"; this run had neither, so the suite's own internal parallelism across 60 files is sufficient on its own. The root `CLAUDE.md` entry is corrected accordingly.
- **The flaking SET is non-deterministic between back-to-back runs on the same commit.** This run's four files and the preceding run's (`resultEnvelope` ×2, `dispatcherRecovery` ×1) overlap in exactly one file. So "the same files flake each time" is not a property to lean on — match a failure against the whole list, never against the last run's subset.

One methodology note recorded because it cost a run: the quiet-machine precondition was first written as `ps aux | grep "[v]itest" | grep -vc "zsh -c" && pnpm --filter api-server test`. `grep -c` **exits 1 when the count is 0**, so the `&&` short-circuited and the suite never ran — the guard reported the all-clear and suppressed the very thing it was gating. Capture the count into a variable and test it explicitly.

`pnpm e2e:gate` was **not** re-run for this task: CH4O-12 gated it at **62 expected / 2 unexpected / 6 flaky / 0 skipped**, both unexpected diagnosed and benign, and that diff is e2e-only across both of its commits — zero production source, which is what makes the flake attribution structural rather than inferential. Note the arithmetic, because the error direction is always flattering: Playwright's `flaky` is a **separate** bucket from `expected`, so 62 + 2 + 6 + 0 = 70 and **8 of 70 (11%) did not pass on first attempt**, not 2.

### Whole-branch review (P1) — 3 reviewers, 1 Critical, 4 Important

The single review package was 2.3 MB, so it was split three ways by area — backend/libs/solver, frontend, and cross-layer coherence + e2e + docs + deploy — with two of the 118 files excluded as generated bulk whose verification was supplied separately (`solvers/max-coverage-us/dataset/distances.json`, the 1000-case benchmark `manifest.json`). All three returned **not ready**.

**The Critical is the one the task structure was least able to catch: the costSummary export contract was never updated.** `openapi.yaml`'s `CostSummaryExportEnvelope.templateVersion` was still `enum: [3]` while the route emits `4`, and `CostSummaryExportRow` still declared its original 8 `required` properties with no `highServiceDist`/`coveragePct`/`coveredDemand` — so the generated artefacts carried the stale shape (`api-zod`'s `zod.literal(3)`, `api-client-react`'s `NUMBER_3: 3`, making `4` unassignable to the envelope type it ships) and `nos-api` violated its own published contract. Hard rule #1. The spec prose was also stale, still saying "six-model objective-dimension mapping" against seven cases.

**Why no gate caught it, and the lesson:** `maxCoverageContract.test.ts` validates a **hand-built** `{ templateVersion: 3, entity: "costSummary", unit: "km", rows: [] }` and is the only consumer of that schema in the repo. That is this project's own documented hazard — a test that hand-authors a shape the production writer never produces can pass while the code it covers is broken — firing on the very grid whose version bump exists to *announce* a shape change. The generalisation worth keeping: **a version constant and the contract that publishes it are one change, and an empty `rows: []` fixture cannot witness a row-shape change.** Pin such a test to the constant and give it a populated row.

Two more that the per-task reviews structurally could not have found, both about the *interaction* between a task's output and the system around it:
- **The verification gate itself executed the production migration.** `migrateAllIntegration.test.ts` called the unfiltered `migrateAll(db)`, which selects every `max-coverage-us` row in the connected database, rewrites `inputs`, nulls `result`/`solved_at`/`result_run_id` and deletes the model's whole `result_cache`. Since this repo passes `DATABASE_URL` inline per command, one copy-pasted production string would have destroyed production data from a routine `pnpm --filter api-server test`. A per-task reviewer sees a passing integration test; only a whole-branch view asks what it is pointed at.
- **The solve `onSuccess` stored the stripped request payload as the last-saved snapshot**, so `isDirty` became permanently true for every Chapter 4 scenario after one Run Optimizer — the chapter's primary interaction path — eventually raising a false "unsaved changes" modal that blocked result-history browsing. Chapter-4-only, because `objective` is the only field `withoutServerOwnedInputs` strips, and invisible to the three tests covering that strip because they all assert the request **body** and never drive `onSuccess`.

A deliberate data decision was taken here, not deferred: the migration now also **nulls `solve_jobs.result` for `max-coverage-us`**. Those envelopes hold kilometre distances while the export route reads the unit from the current manifest, so `?runId=<pre-migration job>` emitted a kilometre value labelled `mi` (601.89 against a true 374.0), and `&unit=km` converted it a second time to 968.6. The accepted cost is that Chapter 4 solve history from before the migration is gone; the runbook now says so and shows how to capture it first.

The production runbook was judged **unsafe as written** on two counts, both now fixed: its `pnpm` steps could not connect to production at all (`lib/db` enables TLS only when `NODE_ENV === "production"`, and the commands set only `DATABASE_URL`), and its backup `CREATE TABLE` had no already-exists branch on a procedure whose own notes tell the operator a restart is expected — dropping and recreating would have captured already-migrated **mile** rows under a km name, after which the rollback would restore miles over miles silently and the km values would be gone. That is the same silent-double-application shape as `timestamptz-migration.md`, the runbook this one opens by distinguishing itself from.

Also corrected: the ordering had **three** moving parts, not two — `nos-studio` was never placed in it, and the default outcome of a push (new studio, old API, since `nos-api`'s webhook has not been observed to fire) is a 422 window with a cause the runbook did not list. The order is **migration → `nos-api` → `nos-studio`**, and suspending the API is now the *recommended* path rather than one option, because it is the only measure that collapses every window — both 422 directions, the in-flight solve, and the lost update — to zero.

One thing the reviewers checked and confirmed clean, recorded because it is the part that would have been invisible: the migration's `solve_input_revision + 1` bump genuinely closes the in-flight kilometre-era solve hazard. A job that completes after the migration fails `jobRunner`'s publication CAS and returns `superseded` instead of writing a stale result with a fresh `solvedAt`. Both 422 directions also **fail closed** at the validator, so no ordering produces a silent wrong-unit answer.

### Not yet done, and each needs its own approval

`superpowers:finishing-a-development-branch`, merge, push, deploy, `/harness-retro CH4O`. Measured deploy surface (full range, no pathspec): **`nos-api` and `nos-studio` both require redeploying** — 44 files under `artifacts/api-server/**`, 3 under `solvers/max-coverage-us/**` (including `manifest.json`'s `distanceUnit` km→mi), 45 under `artifacts/studio/src/**`, plus `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`, `lib/db`, `lib/units`, `lib/dataset-schema`. Do not conclude "frontend-only" from a pathspec. **`nos-postgres` needs no `drizzle-kit push`** — the only `lib/db` change is a comment in `schema/solve_jobs.ts` — but it does need the data migration, in the order above.
