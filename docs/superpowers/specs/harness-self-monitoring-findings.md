# Phase 0 Discovery — Harness Self-Monitoring (read-only findings)

Date: 2026-09-11. Read-only sweep. No source touched. This file is the only artifact.
Prompt: "Make the harness self-monitoring" (OBS-0…OBS-10).

Reconciliation note up front: the prompt uses generic paths (`apps/api/src/__tests__/`,
`pnpm e2e:gate`, `docs/telemetry/reports/`, `docs/ops/*/plans/`). None exist. Real repo is a
pnpm monorepo under `artifacts/*` + `lib/*`. Every prompt path is mapped to the real path below;
where the prompt names a script that doesn't exist yet (`e2e:gate`, `docs:audit`, `harness:record`,
`smoke`) the plan creates it.

---

## 1. CLAUDE.md / IMPLEMENTATION_PLAN.md / settings / GLM hook

- `CLAUDE.md` (235 lines, last 2026-09-05): the operating record. Enormous. Hard rules 1–8 in
  "## Hard rules". Verification gate documented. Gotchas section carries the silent-failure list the
  smoke checks target (CORS allowlist R0.2, cookie flags R0.3, `customFetch` credentials R0.4,
  Postgres TLS R0.1, `import.meta.url` bundling, SPA rewrite, ETag/304 poll bug).
- `IMPLEMENTATION_PLAN.md` (360 lines, last 2026-07-20): §0 operating contract. Commit rule (§0.1.3):
  **`[<task-id>] <imperative summary>`, one task = one commit.** Doc commits in repo history use a
  separate `docs:` prefix (e.g. `docs: Bundle 6.1 spec`). Verification gate in §0.4.
- `.claude/settings.json`: **does not exist** in the repo. Only `.claude/settings.local.json`
  (51 KB) exists and contains **only** a `permissions` block — no `hooks`, no other keys.
- **GLM router hook is USER-level**, confirmed: `~/.claude/settings.json` →
  `hooks.PreToolUse[matcher="Task"]` → `node "/Users/shubhamkr/.claude/hooks/glm_subagent_router.mjs"`.
  The repo has no hook of its own. Implication for Phase 8 below.

## 2. Superpowers install + finishing skill

- Skills installed at `~/.claude/plugins/cache/superpowers-marketplace/superpowers/6.1.1/skills/`.
- Finishing skill: `.../skills/finishing-a-development-branch/`. **Do not edit** (plugin-owned;
  standing rule). The Phase 6 retro attaches by adding a *project* skill (`.claude/skills/harness-retro/`)
  and a CLAUDE.md line "A branch is not finished until `/harness-retro` has run", not by editing the plugin.

## 3. `.superpowers/sdd/` ledger

- Contents are **markdown**, not machine-readable: `task-<id>-brief.md`, `task-<id>-report.md`,
  `progress.md`, `audit-task<n>-*.md`, and `review-<sha>..<sha>.diff` files. Newest is 2026-07-24.
- **No structured start/end timestamps, no dispatch-cycle counts, no token counts.** Recoverable
  approximations: file mtime of brief (≈start) and report (≈end); git commit timestamps per `[task-id]`.
- Recent work (all the "Bundle" tasks, Jul→Sep) does **not** use `.superpowers/sdd/` at all — those
  ran via the agent team with per-task commits tagged `[bundleN-Tk]`. So for the recorder,
  `.superpowers/sdd/` covers only the old F/P/R-series tasks; everything after is git-only.

## 4. `~/.claude/jobs/` token usage

- Recent job dirs contain `state.json` (agent fan-out + `startedAt`/`doneAt` epoch-ms per agent),
  `timeline.jsonl`, and a `tmp/` scratch dir. Inspected `52ecdf2c`, `c082e7ac`, `a573380a`.
- **No token/usage/cost field anywhere** in `state.json` or `timeline.jsonl` (grep clean).
  `startedAt`/`doneAt` give per-agent wall-clock but there is no reliable task_id↔job mapping.
  `~/.claude/glm-mcp/usage.jsonl` records **GLM** spend only, irrelevant to Claude tokens.
- **Verdict: `tokens` column = `unknown` for every row.** The recorder records `unknown`, never an estimate.

## 5. Scripts + Playwright + e2e→solver path

- Root `package.json`: scripts are `preinstall` (pnpm-only guard), `build`, `typecheck:libs`,
  `typecheck`. **No `test`, no `e2e`, no `smoke`, no `harness:*`, no `docs:*` at root.**
  `packageManager: pnpm@9.15.9`.
- Per package: `artifacts/studio` has `test` (`vitest run`), `test:e2e` (`playwright test`),
  `test:e2e:ui`. `artifacts/api-server` has `test` (`vitest run`). `scripts/` is itself a TS
  workspace package (`scripts/src/…`, has `vitest.config.ts`) — that is where `scripts/harness/*`
  will live and be typechecked.
- Playwright (`artifacts/studio/playwright.config.ts`): `testDir: ./e2e`, `fullyParallel: false`,
  **`retries: 1`**, `timeout: 30_000`, `reporter: [["list"],["html",…]]` (**no json reporter**),
  `storageState: e2e/.auth/session.json`, projects `setup`→`chromium`, **no `webServer`** (dev servers
  must be started by hand), `BASE_URL` defaults to a **stale Replit URL**
  (`…kirk.replit.dev`) unless `E2E_BASE_URL` is set.
- e2e specs (15): `bundle2-fastfollow`, `bundle4-auth-landing`, `bundle5-homepage-distances`,
  `bundle6-ui-tweaks`, `bundle6.1-legend-distances`, `design-system`, `empty-first-run-workspace`,
  `import`, `input-map-v2`, `labs`, `tab-coverage`, `two-echelon`, `workspace-ux-r1-r9`, plus
  `global.setup.ts`.
- **e2e→solver: currently REAL CBC.** `global.setup.ts` does auth only. Specs that solve drive the UI
  ("Run Optimizer") → real async job → real `python3 solve.py`/CBC inside the running api-server.
  Nothing is seeded. This is the flake surface: any spec that waits on solve completion depends on real
  CBC timing + real DB rows. Prompt's recommendation (seed solver results in e2e, leave real CBC to
  pytest) is a genuine change, not already true. **`labs.spec.ts` is known-dead** (pre-D0 API shape,
  targets the Replit URL) — CLAUDE.md documents this; the flake audit must exclude it.

## 6. Deploy mechanics

- `render.yaml` (Blueprint) defines three resources:
  - `nos-api` — **docker** web service, `dockerfilePath: ./Dockerfile`, `plan: starter`,
    **`healthCheckPath: /api/healthz`**. Runtime env: `NODE_ENV`, `DATABASE_URL` (fromDatabase),
    `SESSION_SECRET` (generateValue), `CORS_ALLOWED_ORIGIN=https://nos-studio.onrender.com`,
    `LOG_LEVEL`, `POSTHOG_API_KEY`, `POSTHOG_HOST`.
  - `nos-studio` — **static** site, `staticPublishPath: artifacts/studio/dist/public`, SPA rewrite
    `/* → /index.html`. **Build-time env (baked into the bundle): `VITE_API_BASE_URL=`**
    `https://nos-api-uwf8.onrender.com`, `BASE_PATH=/`, `PORT`, `NODE_VERSION=24`.
  - `nos-postgres` — managed Postgres 16, `plan: basic-256mb`.
- Live URLs (from CLAUDE.md, to bake as smoke defaults per your answer): api
  `https://nos-api-uwf8.onrender.com`, studio `https://nos-studio.onrender.com`.
- No `scripts/deploy*.sh`; deploy is Render autoDeploy + manual `trigger_deploy` (render MCP).
  Health path is `/api/healthz`. **Smoke's `postgres_tls` check needs the health payload to expose a
  `db: ok` field** — that field does not exist yet, so it is a contract-first addition to the health
  route (surface at checkpoint).
- Build-time vs runtime split: **`VITE_*` are baked at studio build** (so `vite_env_baked` smoke =
  fetch the studio bundle and assert the real api URL is present, not the placeholder). Everything on
  `nos-api` is runtime.
- CI (`.github/workflows/ci.yml`): typecheck → api tests → studio tests → solver pytest → solver
  quality greps → `e2e_accuracy.py`. **No e2e, no docs check.** api-server vitest is the "fast gate"
  where the registration-points test and (later) `docs:lint` attach.

## 7. The four registration points (exact) — and a live drift finding

| # | Point | File:line | Key space | Members |
|---|-------|-----------|-----------|---------|
| 3 | `KNOWN_SCHEMAS` | `artifacts/api-server/src/registry/modelRegistry.ts:17` | model-id | `p-median-us`, `p-median-brazil`, `transport-coal`, `two-echelon-gold-au` (4) |
| 4 | `VALID_MODEL_IDS` | `artifacts/api-server/src/routes/scenarios.ts:58` | model-id | the 4 above **+ `max_coverage`, `p_center`, `set_cover`** (7) |
| 6 | `SolveInput` union + `buildPayload()` | `artifacts/api-server/src/solver/pmedian.ts:6,15` | model-id → wire | 4 model-ids → `modelType` wire strings |
| 8 | `solve(inp)` dispatcher | `artifacts/api-server/src/solver/solve.py:876` | wire (`modelType`) | `transport`, `capacitated_pmedian`, `two_echelon`, else `p_median` (4) |

**Two structural facts the Phase 5 test must respect:**

1. **The key spaces differ.** Points 3/4 use model-id strings; point 8 uses `modelType` *wire*
   strings; point 6 is the *mapping* between them (`p-median-us→p_median`, `p-median-brazil→
   capacitated_pmedian`, `transport-coal→transport`, `two-echelon-gold-au→two_echelon`). A naïve
   "assert the four sets are equal" is wrong — the test must bridge model-id→modelType via
   `buildPayload` and assert solve.py handles the resulting wire value.

2. **`VALID_MODEL_IDS` is already a strict superset (LIVE DRIFT).** `max_coverage`, `p_center`,
   `set_cover` appear **only** in `VALID_MODEL_IDS` — no schema (`KNOWN_SCHEMAS`), no `buildPayload`
   branch (the `SolveInput` union rejects them), no solve.py handler. A `POST /scenarios` with one of
   these passes the id allowlist, then `validateInputsForModel` has no schema for it. **This is exactly
   the drift Phase 5 exists to catch — meaning the gate goes RED on current `main` the moment it's
   written.** Need your decision (checkpoint): are these intentional "coming-soon" placeholders (then
   the test asserts the 4 *implemented* ids agree across all four points and separately warns that
   `VALID_MODEL_IDS` has un-backed ids), or a real bug to fix by removing them from `VALID_MODEL_IDS`?
- Also: **`registration.test.ts` already exists** at
  `artifacts/api-server/src/registry/__tests__/registration.test.ts`. Phase 5 must extend/complement
  it, not duplicate. (Contents not yet read — will read when building OBS-5.)
- `model-integration-precheck.md` calls these "ten registration points" (adds import/export
  `services/templates.ts`, map multi-select, override-entity registration, etc.). The prompt names
  four; OBS-5 gates those four. The other six stay documented-only unless you want them gated too.

## 8. Git history — last 20 merged tasks (recoverable)

Recent work merges to **local `main`** as per-task commits tagged `[<branch>-<task>]`; no PR merges,
no long-lived branches. Branch name is recoverable *only* from the commit-subject tag. dispatch_cycles
and e2e_runs are **not** recoverable from git (→ `unknown`). started/finished ≈ first/last commit
timestamp of a tag group. Representative recent groups (newest first):

- `empty-first-run` — `a0ea8cd`, `6090259`, `9cc42b0` (2026-09-10)
- `bundle6.1` — `b43fe1f`,`f935082`,`f766611`,`10228cd`,`4d962b9` + docs (2026-09-05)
- `bundle6` — `b352396`,`dad9b1a`,`1b3c8ac`,`4523129`,`4110c15`,`3c4a50b`,`eab74f7`,`2468851` (2026-09-04/05)
- `bundle5` — `19785c7`,`4932bd7`,`05ee866`,`8c0e593`,`3562898`,`f5ffe03` (2026-09-04)
- `bundle4` — `26085eb`,… (2026-09-04)
- older: `bundle2*`, `bundle3*`, Chapter-10 `[M*]`, Phase `[F1.1]`/`[P1.1]`/`[R0.*]` (in `.superpowers/sdd/`).

Recorder backfill plan: derive ~15–20 rows from these tag groups; `branch`=tag, `started_at`/
`finished_at`=first/last commit `%cI`, `merged_sha`=last commit, `dispatch_cycles`/`e2e_runs_to_green`/
`first_gate_pass`/`tokens`/`escaped_defects`/`reverted_within_7d`=`unknown` (git can't recover them).

## 9. Documentation inventory (37 tracked `.md`, exempt folders removed)

Full per-file line-count + last-commit table captured (see raw data below). Families / signals:

- **Stale-provider / Arcadia (high-value `stale_reference` targets):**
  - `README.md` (76 ln, 2026-07-24) — describes **Arcadia gamification** as existing:
    "gamified quests ('Arcadia')", `src/pages/arcadia/`, `GamificationContext`, `ArcadiaShell`,
    XP/badges/leaderboard, `user_progress` in Postgres. **All removed in Phase 1 (A3).** These are the
    Arcadia passages the DoD says must appear as `stale_reference` candidates.
  - `replit.md` (45 ln, 2026-06-10) — Replit remnant. **Hard rule #7 forbids touching `replit.md`.**
    → propose adding it to the audit **exclude** list (flag-only would still risk an accidental edit).
- **Superseded / orphan root planning docs** (each has a newer, EXEMPT counterpart under
  `docs/superpowers/plans/`, so the exempt file can't be the "current" side — these root files read as
  orphan/superseded): `chapter-10-two-echelon-gold-refinery-implementation.md` (676 ln) +
  `-integration.md` (253 ln), `application-audit-and-remediation-plan.md` (361 ln),
  `NETWORK_MIGRATION_PLAN.md` (299 ln, reconciled into `docs/superpowers/plans/2026-07-24-render-migration.md`).
- **Active / authoritative:** `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, `PRD-network-optimization-studio-v2.md`,
  `model-integration-precheck.md` (a **named gate** → high authority), `docs/design-system/*`
  (component prompt specs, 2026-09), `docs/dataset-audit.md`.
- **In-repo memory (in audit scope):** `.agents/memory/{MEMORY.md,solver-pulp,solver-utilization,
  studio-dataset,studio-stack}.md` — all last touched **2026-06-20**, tiny, no inbound links → likely
  `orphan` candidates. **Distinct from the harness memory dir below.**
- **Untracked, therefore out of scope** (git ls-files based): `AGENTS.md`, `docs/superpowers/plans/
  2026-09-01-branch-discipline-remediation.md`, `graphify-out/GRAPH_REPORT.md`, PDFs, `supabase/`.

**Harness memory directory** (read-only, `origin=memory`, NOT `.agents/memory`):
`/Users/shubhamkr/.claude/projects/-Users-shubhamkr-network-optimization-studio/memory/`
— 6 files: `MEMORY.md` + `feedback_{posthog_cli,orchestration_next_phase,no_unilateral_decision_changes,
merge_spec_plan_docs_to_main,qa_default_in_plans}.md`.

## 10. PR tooling

- `gh` installed (`/opt/homebrew/bin/gh`), authenticated as **`ShubhamKr07`** (keyring), scopes
  `gist, read:org, repo, workflow` — **can create PRs, labels, comments.**
- Remote `origin` = `https://github.com/ShubhamKr07/network-optimization-studio.git`, default branch
  `main`, **repo is PUBLIC**.
- **No branch protection** on `main` (`gh api …/protection` → 404 "Branch not protected"). So
  `/docs-apply`'s "refuse unless approved" must fall back to the prompt's stated convention: require a
  human PR comment `approve` (there's no required-review to key off). The `docs-audit` PR path is fully
  available; the local-branch fallback is not needed.

---

## Raw doc inventory (path | lines | last_commit)

```
.agents/memory/MEMORY.md|3|2026-06-20
.agents/memory/solver-pulp.md|33|2026-06-20
.agents/memory/solver-utilization.md|16|2026-06-20
.agents/memory/studio-dataset.md|34|2026-06-20
.agents/memory/studio-stack.md|24|2026-06-20
CLAUDE.md|235|2026-09-05
IMPLEMENTATION_PLAN.md|360|2026-07-20
NETWORK_MIGRATION_PLAN.md|299|2026-07-23
PRD-network-optimization-studio-v2.md|274|2026-07-19
README.md|76|2026-07-24
application-audit-and-remediation-plan.md|361|2026-07-24
chapter-10-two-echelon-gold-refinery-implementation.md|676|2026-07-24
chapter-10-two-echelon-gold-refinery-integration.md|253|2026-07-24
docs/dataset-audit.md|46|2026-07-22
docs/design-system/DECISIONS.md|87|2026-09-03
docs/design-system/SKILL.md|15|2026-09-03
docs/design-system/components/core/*.prompt.md (9 files, 5-9 ln each)|~|2026-09-03
docs/design-system/components/studio/*.prompt.md (7 files, 5-9 ln each)|~|2026-09-03/04
docs/design-system/github.md|19|2026-09-03
docs/design-system/readme.md|54|2026-09-03
docs/design-system/ui_kits/studio/README.md|8|2026-09-03
model-integration-precheck.md|322|2026-09-01
replit.md|45|2026-06-10
```

---

## Assumptions to confirm (STOP — awaiting your call)

**A. Commit prefix.** Prompt proposes `[OBS-n]`; repo convention is `[<task-id>] …` for code and
`docs:` for docs. → Proposal: use **`[OBS-n]`** for the 10 phase commits (matches prompt + repo's
tag-per-task rule); keep `docs:` only for the findings/spec/plan discovery docs. Confirm.

**B. Cause taxonomy (Phase 6).** Adopt the prompt's 11, finite & editable:
`flaky_test | spec_gap | registration_point | codegen_drift | merge_conflict | deploy_config |
solver_timeout | migration_order | zod_strip | doc_drift | other`. Confirm or edit.

**C. Docs authority order (Phase 9a).** Adopt as written:
`CLAUDE.md` > named gates (`model-integration-precheck.md`, `docs/superpowers/gates/**`) >
`lib/api-spec/openapi.yaml` + source > `docs/ops/**` + ADRs > package READMEs > root `README.md` >
everything else > memory files. (Note: `docs/ops/**` and ADRs don't exist yet — harmless, forward-looking.)

**D. Audit exclusion list (`docs-audit.config.json`).** Proposed `exclude`:
`node_modules/**`, `docs/superpowers/specs/**`, `docs/superpowers/plans/**`,
`docs/superpowers/docs-audit/**`, `docs/superpowers/metrics/reports/**`, `CHANGELOG.md`,
any file with `<!-- docs-audit: ignore -->` in first 10 lines, **plus `replit.md`** (hard rule #7 —
never touch). The prompt's `docs/telemetry/reports/**` and `docs/ops/*/plans/**` are kept as
forward-looking excludes though those dirs don't exist yet. Confirm the `replit.md` addition.
`memoryDir` = the harness path in §9. `include` = `git ls-files '*.md'`.

**E. Registration-points drift (§7.2) — needs a product call.** `max_coverage`/`p_center`/`set_cover`
are in `VALID_MODEL_IDS` only. Options: (1) **treat as intentional placeholders** — OBS-5 asserts the
4 implemented ids agree across all four points and separately *warns* on un-backed `VALID_MODEL_IDS`
entries (gate green today); or (2) **treat as a bug** — remove the 3 ids from `VALID_MODEL_IDS` in
OBS-5 so all points agree (gate green after a 1-line fix). Which?

**F. GLM hook (Phase 8) — user-level, needs a call.** The hook lives in `~/.claude/settings.json`
(user-level) and Claude Code hooks are **additive** — a project `.claude/settings.json` *cannot
un-register* a user-level hook. Real options: (1) **no user-level change** — add a project
`.claude/settings.json` documenting the override + rely on the standing "Never delegate to GLM" rule
(the hook only injects an advisory line; ignoring it costs nothing) [safest, honors "don't modify
outside repo"]; (2) edit `glm_subagent_router.mjs` to early-return when `cwd` is this repo [touches a
user-level file → needs your explicit OK, checkpoint 4]. Recommend (1). Your call.

**G. Health-route `db: ok` (Phase 4).** `postgres_tls` smoke needs `/api/healthz` to expose DB
reachability. Currently it doesn't. OK to add a `db` field to the health payload (contract-first:
openapi.yaml + codegen + route), as part of OBS-4? It's a small real code change beyond pure tooling.

**H. Execution scope (already answered):** all live proofs, register real cron, bake live URLs,
GLM decided here. Confirming E/F above unblocks the whole build.
```
