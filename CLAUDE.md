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

**Re-gating e2e:** run `pnpm e2e:gate` (Playwright, excludes `@flaky`-tagged tests). Quarantined tests run separately via `pnpm e2e:quarantine`. `labs.spec.ts` stays excluded (pre-D0, dead). Flakiness is quantified on a frozen commit with `bash scripts/harness/flake-audit.sh --runs 20` (writes `docs/superpowers/metrics/flake.csv`); e2e should seed solver results and leave real CBC timing to pytest.

**A branch is not finished until `/harness-retro <task_id>` has run** — it records the task's metrics row (`docs/superpowers/metrics/tasks.csv`), logs each gate failure by cause, and fires the second-occurrence gate rule (a failure cause appearing twice with no proposed gate → drafts `docs/superpowers/gates/<cause>.md` and stops for approval). See `.claude/skills/harness-retro/SKILL.md`.

## Harness self-monitoring (OBS-1…OBS-11)

A measurement + self-correction layer that makes the dev process observable. Spec/plan:
`docs/superpowers/{specs,plans}/harness-self-monitoring.md`. It **layers on** the existing
`.superpowers/sdd/` ledger (derives from it + git), never replaces it. Never fabricate a metric —
underivable values are the literal `unknown`.

**Metrics store** (`docs/superpowers/metrics/`, six append-only CSVs + README with the two rules):
`tasks` (one row per finished task), `failures` (per gate failure, taxonomy `cause`), `flake`,
`deploys`, `docs-audit`, `permissions` (per retro permission audit — grants classified
risky/broad/ok + denials attributed to the task window). Weekly report → `reports/YYYY-WW.md`.

**Commands** (TS under `scripts/src/harness/` + `scripts/src/deploy/`, `tsx`-run; shell at
`scripts/harness/`; root `pnpm` aliases delegate):
- `pnpm harness:record --task <id> …` — append a task row (derives timestamps/merged_sha; `tokens`
  always `unknown` — no job token source). Refuses duplicates without `--force`.
- `pnpm harness:permissions --task <id>` — audit `.claude/settings.local.json` grants (classify
  risky/broad/ok) + attribute runtime tool denials from the session transcript to the task window;
  append a `permissions.csv` row. **Exits 3 (STOP-and-ask) on a risky grant or a recurring denial.**
  Baseline for `allow_new` is gitignored scratch (`.harness/permissions/`). Run by `/harness-retro`.
- **Weekly permission-review loop** (grants/denials → reviewed promotion into the tracked project
  allowlist): `pnpm harness:permissions:capture [--dry-run|--write-managed]` builds this week's
  candidate list from the local **PreToolUse/PostToolUse ledger** (`.claude/hooks/permission-ledger.mjs`
  → `.harness/permissions/ledger.jsonl`, provenance `prompted_and_executed`) + transcripts, writing a
  redacted TRACKED artifact `docs/superpowers/metrics/permissions-review/<week>.{json,md}` (+ a
  gitignored `<week>.local.json` with full commands). **No secrets in git**: a command that trips the
  secret scan is committed as `sensitive — review locally` with NO rule and is promotable only via a
  local apply. `scripts/harness/permissions-capture-weekly.sh` (local Mon cron, see
  `docs/ops/permission-review-cron.md`) commits it to the `permissions-capture` branch; the Monday
  harness-weekly workflow renders it into the PR (`## Permission review`). Review by commenting
  `@claude allow|allow-risky|allow-destructive|deny|revoke|defer <id> [as Bash(<rule>)]`, then
  `@claude apply permission review` — the hardened `permission-apply.yml` runs `pnpm
  harness:permissions:apply` (deterministic; default-branch code over PR data only) which writes the
  accepted rules into the **project-scoped tracked `.claude/settings.json`** (never user-global). A
  risky grant needs `allow-risky`; **destructive needs `allow-destructive` (exact byte-for-byte, kept
  by explicit decision — Decision B)** and is shown redacted-in-full for review (Decision A).
- `pnpm harness:report [--week YYYY-WW]` — write the weekly report (medians, flake top-5, deploy
  rollup, failure causes + 2nd-occurrence flags, `## Documentation`).
- `pnpm smoke --env production|preview` — 7 post-deploy checks from outside Render
  (`cors_preflight`, `cookie_attributes`, `fetch_credentials`, `postgres_tls`, `vite_env_baked`,
  `python_solver_present`, `free_tier_wakeup`); targets resolve `--api-base`/`--studio-base` →
  `NOS_API_BASE`/`NOS_STUDIO_BASE` → live fallback. See `docs/ops/smoke.md`.
- `bash scripts/harness/flake-audit.sh --runs 20` — frozen-commit flake quant → `flake.csv`.
- `pnpm docs:audit --full | --since <ref> [--mechanical-only]` — mechanical doc candidates (6
  detectors) → `.harness/docs-audit/candidates.json` + `docs/superpowers/docs-audit/inventory.json`.
- `pnpm docs:lint` — the proposed `doc_drift` gate (stale_reference only, exit non-zero). Runnable,
  **not** wired to CI yet.

**Gates:** the registration-points test (`registration.test.ts`, in the fast api-server gate) is
live. Two proposed gates are **not enabled**: e2e-in-CI (**skipped** — no CI browser/app/seed infra),
`doc_drift`/`docs:lint` (**deferred** until the stale-ref baseline is clean). See
`docs/superpowers/gates/` + `docs/ops/e2e-stale-specs.md`.

**Weekly job + docs pipeline (one combined PR, human-gated):** the GitHub Actions workflow
`.github/workflows/harness-weekly.yml` runs **Mondays 13:00 UTC** (+ `workflow_dispatch`). It writes
the metrics report (`pnpm harness:report`) and the mechanical candidates (`pnpm docs:audit --full`),
then (via `anthropics/claude-code-action` + the `docs-audit` skill) opens **one PR** with two
sections: a **FYI `## Weekly report`** (the committed scorecard, no action) and reviewable
**`## Docs-audit findings`** (one commit per verified finding). Older `harness-weekly/*` PRs are
auto-superseded. **Apply is `@claude`-driven on the PR:** comment `@claude apply|keep|edit|dismiss
<finding-id>` per finding, then `@claude apply the review` — `claude.yml` (now `contents`+`pull-requests:
write`) follows `.claude/skills/docs-apply/SKILL.md` to rewrite the branch (revert/edit) and merge
`--no-squash`. `/docs-apply <pr>` still works locally. **Nothing reaches `main` except via a reviewed
PR.** `docs/superpowers/specs/**` + `plans/**` are historical — never audited. (`.harness/` is
gitignored scratch.)

**GLM delegation is disabled here** (`.claude/glm-delegation-disabled.md`) — the standing rule is
never delegate to GLM for this repo.

## Hard rules

1. **Never edit generated code.** Anything under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` comes from codegen. To change API shapes: edit `lib/api-spec/openapi.yaml`, re-run Orval (config: `lib/api-spec/orval.config.ts`), commit spec + regenerated output together.
2. **`e2e_accuracy.py` is sacred.** `artifacts/api-server/src/solver/tests/e2e_accuracy.py` validates solver output against the textbook's published answers. It must pass unmodified after every change. If your change breaks it, your change is wrong — do not adjust the expected values without explicit human approval.
3. **Schema changes that add NOT NULL columns to populated tables** must use the two-step protocol (add nullable → backfill → enforce NOT NULL), because `drizzle-kit push` has no migration history.
4. **One task = one commit.** Message format: `[<task-id>] <imperative summary>` (e.g. `[A2.1] add user_id ownership to scenarios`). Regenerated codegen output goes in the same commit as its spec change.
5. **Ownership filtering is security-critical.** Every scenario query must filter by the authenticated `user_id`; non-owned resources return **404** (never 403 — avoid ID enumeration). Any new scenario-scoped endpoint inherits this.
6. **Solver changes enter as data, not branches.** Business rules (forced-open, inactive, demand overrides, capacities) become variable bounds or coefficient changes in the PuLP model — never new if/else code paths in `solve.py`.
7. **Don't touch** `attached_assets/` (textbook source material) or Replit deploy files (`.replit`, `replit.md`, `push-to-github.mjs`) unless a plan task explicitly says so.
8. When the plan conflicts with the repo's actual state, trust the repo, make the smallest correct fix, and note the deviation in the commit body. If a genuinely ambiguous product decision arises, stop and ask — don't guess.

## Branch discipline (standing)

- Do not commit directly to `main` for routine bundle work or ad hoc fixes. Every feature or remediation change must land on a descriptive branch first.
- Keep a branch for each bundle or repair, and set an upstream remote at the first stable checkpoint so the work is recoverable outside the local machine.
- Protect the active worktree and branch from cleanup or deletion until its branch has been reviewed, backed up remotely, and explicitly approved for retirement.
- Read-only proof is required before any branch or worktree deletion: `git cherry main <branch>`, clean status, explicit path validation, and confirmation that no agent/session still owns the branch.
- Never use `rm -rf` for branch cleanup; use `git worktree remove <exact-path>` only after human approval.
- Never escalate a branch deletion to `git branch -D` without a second approval that cites the `git cherry` proof and the specific reason the branch is not ancestry-merged.
- Treat direct-to-main commits, stale branch backlogs, and unreviewed worktree churn as stop-and-report conditions rather than normal repo hygiene.
- Keep the operating rules in sync with the branch discipline plan and do not drift from the repo's branch lifecycle without an explicit decision.
- This section is the **in-repo policy** (documented agent discipline). Server-side enforcement — GitHub branch protection / required CI — is a **separate, human-approved infra task**, not covered here. Recurring offenders to correct: routine bundle work, Sentry/PostHog changes, and remediation itself committing straight to `main`.

## Implementation history

The full per-task execution record — every phase, task ID, commit SHA, and post-mortem — lives in
**`docs/project-history.md`** (Background + Phase 0 through Chapter 4, 15 sections). Read it when you
need to know *why* something is the way it is, or whether a given task already shipped. It is
history, not instruction: nothing in it overrides this file, and where it conflicts with the repo,
the repo wins (hard rule #8).

## Models (6)

Each model is a self-contained package under `solvers/<model-id>/` (`manifest.json` + `dataset/*.json`
+ `tests/`). `registry/modelRegistry.ts` scans `solvers/*/manifest.json` at boot — a 7th model needs
no registry code change to be *listed*, but does need every point in
`model-integration-precheck.md` (repo root) Gate 1 — ten registration points to actually work.

| modelId | Chapter | Route | Landing | Unit | Dataset |
|---|---|---|---|---|---|
| `p-median-us` | 3 — Al's Athletics | `/chapter-3` | shown | mi | 26 WH / 200 CS / 5200 pairs |
| `chens-cosmetics-cn` | 4 — Chen's Cosmetics | `/chapter-4` | shown | **km** | 25 WH / 197 CS / 4925 pairs |
| `transport-coal` | 5 — Coal Transport LP | `/chapter-5/transport` | hidden | mi | 4 mines / 15 stations / 60 lanes |
| `p-median-brazil` | 5 — Brazil Capacity | `/chapter-5/brazil` | hidden | mi | 25 WH / 25 states / 625 pairs |
| `two-echelon-jade-us` | 9 — JADE | `/chapter-9/jade` | shown | mi | 4 plants / 25 WH / 100 CS / 4 products |
| `two-echelon-gold-au` | 10 — Gold Refinery | `/chapter-10/gold-refinery` | hidden | mi | 1 mine / 2 refineries / 10 CS |

Route + landing visibility are owned by `artifacts/studio/src/lib/chapters.ts` (`path`, `modelId`,
`hiddenFromLanding`, `workspace: true`). All six route to the tabbed Workspace at their chapter path —
**`/workspace` itself 404s**. Landing filters hidden models out of the cards, Recent Solves, AND the
stats totals.

**`capabilities` in the manifest is the only correct per-model gate** — never a `modelId === "..."`
string comparison (see Recurring bug classes #1). Current flags: `supportsP`, `capacityModes`,
`demandEditable`, `supportsFacilityStatus`, `supportsAddedCustomerExclusion`,
`supportsReferenceDistances`, `supportsPlantProductCapability`, `outputGrids`.

Per-model traits that bite:
- **`p-median-us`** — the pilot; the only model with `capacityModes: ["none","uniform","per_wh"]`. Every
  feature was built here first, then fast-followed.
- **`chens-cosmetics-cn`** — the only **km** model (distance-unit plumbing is generalized app-wide; don't
  re-hardcode `mi`). Two coupled objectives behind one `objective` toggle: `coverage` (maximize % demand
  within `highServiceDistKm`, s.t. an avg-distance cap) and `min_distance` (minimize demand-distance,
  s.t. a coverage floor). Distances are stored as **raw km, direct-id-keyed** (`"wh-15,cs-1"`) with the
  ×1.17 circuity factor applied **in-solver**. `pMax = 25` on both the tab and SolveDialog.
- **`transport-coal`** — no facility-location concept at all (`supportsP: false`,
  `supportsFacilityStatus: false`); **Flows IS its assignment view**, so `outputGrids` has no
  `openWarehouses`/`assignments`.
- **`p-median-brazil`** — has no `GET /dataset` entry, so its *input* override tables can't be built
  (backend/solver-only for Phase B edits). Output tabs are unaffected (they take only
  `{result, scenarioId}`) and it has full output parity. `demandEditable: false`,
  `supportsAddedCustomerExclusion: false` — its solver applies no customer exclusion.
- **`two-echelon-jade-us`** — multi-product. **Plants are a first-class `plants` prop on `NetworkMap`,
  NOT `kind: "plant"`** (`WarehouseCandidateKind` is `mine | facility` only). Any enabled
  plant×product capability cell means capacity `210,000,000` (`merge_inputs.py`); the `10,000,000`
  Big-M is solver-internal and must never leak into a capacity display.
- **`two-echelon-gold-au`** — `Edge.leg` is `mine_to_refinery | refinery_to_customer`. `bomRatio` is
  strictly `> 1` in Zod (`gt(1).max(10)`), so the slider floor is `1.05`, never `1.0`. Its one mine is
  fixed (never in `openWarehouseIds` — it isn't a location choice). Distances were **relabelled km→mi
  with ZERO data change** (the Ch-10 notebook mislabels geographically-miles values as km).

**Goldens — treat as frozen** (hard rule #2 governs `e2e_accuracy.py`):

| Model | Golden |
|---|---|
| `p-median-us`, `p-median-brazil`, `transport-coal` | Watson textbook published answers, asserted by `e2e_accuracy.py` |
| `two-echelon-gold-au` | objective `386576.9929994568`; Cunnamulla opens; refinery→customer avg `687.5738755210947` — exact match to the source notebook's own stored output |
| `chens-cosmetics-cn` coverage | `66.0639%` / covered `131645389` / open `{wh-40, wh-69, wh-102}` — tie-aware; coverage avg-distance is deliberately NOT frozen |
| `chens-cosmetics-cn` min-distance | `123834216789.27` |

`e2e_accuracy.py` last ran **99/99** (was 87/87 before Chapter 4 added its checks; the older
"102/102" in git history was an inflated duplicate-run count — see Gotchas).

`solve_two_echelon` **fixes a real bug in the Chapter 10 source notebook**: the notebook's BOM
constraint is written per (mine, refinery) pair, correct only by coincidence with one mine; ours sums
over mines (`test_flow_balance_generalizes` proves it with a monkeypatched 2nd mine). Don't "restore"
the notebook's version.

## Deployment (live)

Three Render services, all live, created from `render.yaml` (Blueprint) except where noted:

| Resource | Name | URL / ID |
|---|---|---|
| API (Docker web service) | `nos-api` | `https://nos-api-uwf8.onrender.com` (the `-uwf8` suffix is real — plain `nos-api` was taken globally) |
| Frontend (static site) | `nos-studio` | `https://nos-studio.onrender.com` |
| Database | `nos-postgres` | `dpg-d9hg4bmpbkes73a0j6l0-a`, plan `basic-256mb`, Postgres 16 |

- **Render's autoDeploy webhook has never fired reliably for this repo** — after every push, trigger
  both services manually (`mcp__render__trigger_deploy` or the Dashboard) rather than waiting.
- `nos-api` cannot be created by the Render MCP (`create_web_service` excludes Docker-runtime
  services) — that step is Dashboard-only.
- Schema changes reach production via a Render one-off job inside `nos-api`'s own image:
  `render jobs create <nos-api-service-id> --start-command "pnpm --filter @workspace/db push --force"`
  (uses the correct internal `DATABASE_URL`; no IP-allowlist change needed).
- **A deploy is outward-facing** — surface the steps and get explicit confirmation before triggering one.
- **Local dev DB:** no `DATABASE_URL` in the environment by default. A local Postgres 18 runs a
  `nos_dev` database matching the current schema. Pass it inline per command (shell env does not
  persist across tool calls): `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`.
- **Local e2e:** start api-server (`DATABASE_URL=... PORT=3001 pnpm --filter api-server run dev`), then
  studio (`PORT=<any> BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`),
  then `E2E_BASE_URL=http://localhost:<studio-port> npx playwright test` from `artifacts/studio`.

## Process (standing)

- **One task = one commit = one rollback point** (a real SHA, no git tags), its own test written and
  run before moving on, and a `docs/project-history.md` entry recording what landed and what's next.
- **Agent-team dispatch** (parallel role-based: `backend-engineer` / `frontend-engineer` /
  `solver-engineer` / `qa-sdet`) is the standing execution mode, replacing the older sequential
  `subagent-driven-development` loop. Wave tasks by file-disjointness; serialize a single writer per
  shared file (`Workspace.tsx`, `openapi.yaml`, `manifest.json`). Keep each commit green by having leaf
  tasks add new props as optional-with-safe-default, and the shared-file writer wire the real call sites.
- **Every bundle plan includes a real-browser `qa-sdet` QA task** — unit tests + review + an HTTP smoke
  check are not sufficient on their own.
- Spec and plan docs are merged to local `main` on creation and re-merged after each review round.
- Operating under `andrej-karpathy-skills:karpathy-guidelines` (think before coding, simplicity first,
  surgical changes, goal-driven execution with an explicit verify step per item).

## Open debt

Carried forward, none blocking:

1. **Production deploy is deferred** since Bundle 3 — local `main` is ahead of what's live on Render.
   Outward-facing; surface and confirm before triggering.
2. `e2e/two-echelon.spec.ts` has **never been executed** (written against the local dev-proxy setup).
3. `e2e/labs.spec.ts` is stale (pre-D0 API shape, targets a dead Replit host) and stays excluded from
   `pnpm e2e:gate`.
4. `e2e_journey.py` is **non-runnable**, not merely stale — it authenticates via the `POST /login`
   endpoint removed in Phase 1, so it 401s at step one. Needs a rewrite onto `/auth/register` +
   `/auth/login` before it verifies anything. Do not count it as coverage.
5. Chapter 4 Minors: Open Warehouses / Customer Assignments **tabs** render Chen ids without cities
   (`Workspace.tsx`'s `locationById` is wired for jade only) though the export got the city lookup;
   `SolveDialog.pMax` is unwired for jade (dialog allows P≤50, tab caps at active-warehouse count);
   `NetworkMap.tsx`'s popup field is still named `distanceMi` while carrying km (display is correct).
6. `DistancesTab` doesn't clear a committed `drafts[key]` — a stale value only if the override is
   mutated externally. The naive fix reformats the input while typing, hence left open.
7. The Workspace sidebar shows all 5 output entries per model regardless of `outputGrids` (only
   `renderTabContent` reads the capability; unsupported ones render a placeholder).
8. Two proposed gates are **not enabled**: e2e-in-CI (skipped — no CI browser/app/seed infra) and
   `doc_drift` / `docs:lint` (deferred until the stale-reference baseline is clean).
9. **Distance-metrics bundle** (split out of Bundle 6, item 6): replace the textbook distance matrix
   with a real routing provider feeding the solver. Blocked on a provider choice + API key + an
   explicit human override of hard rule #2.

## Recurring bug classes

Each of these has bitten more than once. Check for them by reflex.

1. **A per-model gate extended for one model, forgotten for its sibling.** The most-hit class in this
   repo (5+ occurrences across Chapter 10 Rounds 1/2/4, SCN v0.3's `CustomersTab`/`WarehousesTab`, and
   C6.1). A `modelId === "..."` ternary or allowlist silently falls back to another model's behavior —
   no error, wrong output. **Fix pattern: gate on a capability (`manifest.capabilities.*`) or on prop
   presence (`onAddedXChange != null`), never on a model-id string.** C6.1 closed the output-grid
   instance by construction with `capabilities.outputGrids`.
2. **A new field must clear three independent validation layers.** `lib/dataset-schema`'s Zod schema
   *silently strips* unknown keys; the per-model TS dataset loaders rebuild rows from a fixed field
   list and *drop* anything unnamed; `openapi.yaml` needs it too — and sometimes a separate endpoint's
   own param enum as well (C6.1 found that third location after two tasks had already "finished").
3. **Shared-worktree git-index race.** Concurrent agents in ONE worktree share one index, so a
   `git commit` with no pathspec sweeps teammates' staged files. **Agents must
   `git commit -m "..." -- <explicit paths>`** (pathspec on the commit, not just on `git add`) and
   re-check `git status` immediately before committing.
4. **Agent branch-base drift.** An agent that forked from a stale base produces cherry-picks that
   conflict. Every agent-team dispatch prompt carries a
   `git merge-base --is-ancestor <target-tip> HEAD` guard; the agent reports `BASE_OK` before starting.
5. **Concurrent `pnpm install` across agent worktrees churns the shared store.** The controller's own
   test run then fails to *resolve imports* (e.g. `Failed to resolve import "@tanstack/react-virtual"`)
   — that is not a code regression. Re-run once the installs quiesce before trusting a red result.
6. **Orphaned dev-server / python processes starve subprocess tests.** `resultEnvelope.test.ts` spawns
   real `python3 solve.py` and times out at 5000ms under CPU contention. Before treating it as a
   regression, run the file isolated (`npx vitest run src/__tests__/resultEnvelope.test.ts`) and check
   `ps aux` for leftovers from earlier manual or Playwright runs.

## Gotchas

- **A `<Dialog>` triggered from an early-return branch must also be RENDERED in that same branch.** `Studio.tsx`'s "Create first scenario" button (in the `!scenarios?.length` and Brazil-empty early returns) called `setShowCreateDialog(true)` correctly, but the actual `<Dialog>` JSX lived only in the component's main `return`, which those early returns never reach — so the state changed with zero errors, but there was no Dialog mounted anywhere to display it. Silent, first-run-blocking: any brand-new account (or the empty Brazil-lab state) could never create a scenario at all. Pre-existing bug, unrelated to the same-day auth-routing fix — confirmed via git log that `Studio.tsx` predates it. Never caught because `Studio.test.tsx` always pre-seeded at least one scenario in its mocks; nothing exercised the true zero-scenario first-render path, and no manual test in this project's history ever used a genuinely empty account against a fresh production DB until today's Render deployment. Fixed by extracting the dialog into one `const` referenced from all three return branches (both early returns + main), so it's always in the tree regardless of which branch renders. New test in `Studio.test.tsx` (`"Studio — empty scenarios"`) covers exactly this path. **Lesson: any state-driven UI (dialog, drawer, tooltip) referenced from multiple early-return branches needs its trigger AND its render to be reachable from every branch that can call the trigger — don't assume "it's a hooks thing that always applies," check the JSX tree, not just the state.**

- **`Gate()` in `App.tsx` must be ONE `<Switch>` with a fixed route set — never two swappable trees keyed on auth state.** Real production bug (found post-deploy, unrelated to Render infra): `Gate()` used to render either `AuthedRouter` or `UnauthedRouter` — two entirely separate `<Switch>` trees — based on `useGetCurrentAuthUser()`'s data. wouter's `<Switch>`/`<Route>` subscribe to the current location independently of their parent, so the instant any handler called `navigate(...)` (login/register success, logout), the OLD tree — still mounted at that exact instant, since `Gate()` itself hadn't re-rendered with fresh auth data yet — reacted to the brand-new location on its own via its own subscription, matched it against its OWN route set, found nothing, and its own catch-all fired a REAL navigation (e.g. `UnauthedRouter`'s `<Redirect to="/login">`) before the swap to the correct tree ever happened. By the time `Gate()` did swap, the URL had already been moved to a path the NEW tree has no route for → its own NotFound catch-all. Reproduced and confirmed via `history.pushState`/`replaceState` instrumentation in a real deployed browser (not reproducible by a fully-mocked-router unit test). Fixed by merging into one always-mounted `<Switch>` where every path (`/`, `/login`, `/register`, chapter paths, `/compare`, catch-all) is always a real `Route` regardless of auth state — only the per-route *content* branches on `user` (page vs `<Redirect>`), so a transitional render always resolves to a valid redirect, never a dead end. `writing setQueryData({user: ...})` synchronously in `onSuccess` (instead of `invalidateQueries` + waiting on a refetch) is still correct practice and kept — it narrows the window — but does not by itself close this race; the single-`Switch` structure is what actually closes it. See `App.test.tsx` (uses real wouter via `wouter/memory-location`, not a mocked router) for the regression coverage.
- **Creating a Render resource via MCP instead of a Blueprint apply silently loses Blueprint-only config.** `create_web_service`/`create_static_site` (the `render` MCP server) have narrower parameter schemas than `render.yaml`'s full Blueprint schema — e.g. `create_static_site` has no `routes`/rewrite field at all. `nos-studio` was created this way (forced because `nos-api` needed Docker, which `create_web_service` explicitly can't do, breaking the clean all-Blueprint path) and shipped with zero SPA-fallback rewrite: root `/` worked, every client-side route (`/chapter-3`, `/compare`, ...) 404'd in production until a real user hit it post-deploy. **Before creating any Render resource type for the first time via MCP, read that type's own `render-<type>` skill first** (`render-static-sites`, `render-web-services`, etc.) specifically for Blueprint-only fields the MCP tool's schema won't surface — don't trust the MCP tool's parameter list to be the complete requirements picture. Fixed via a one-time manual Dashboard edit (Settings → Redirects/Rewrites, `/*` → `/index.html`) plus syncing the same rewrite into `render.yaml` so the Blueprint stays accurate for next time. See `docs/superpowers/plans/2026-07-24-render-migration.md`'s R0.9 retrospective for the full incident.
- **A "frontend loads" check that only hits `/` cannot catch a missing SPA-fallback rewrite.** Root always has a matching static file regardless of rewrite config; only a nested client-side route actually exercises it. Any future deploy-verification checklist for a static SPA needs at least one non-root route check.
- **`artifacts/studio/e2e/labs.spec.ts` is stale against local HEAD post-D0/D1.** It targets a remote Replit deployment by default (`E2E_BASE_URL`) and asserts on the pre-D0 API shape (`problemType`/`pValue`/`warehouseStatuses` as top-level scenario fields). Local HEAD now sends `{name, modelId, inputs}`. Left unfixed deliberately: updating the assertions now would only break the suite against the one target it can actually reach (the still-undeployed-with-D0 Replit instance). **The "no local dev proxy" half of this gap is resolved as of D5.2** — `vite.config.ts` has an opt-in dev proxy (`API_PROXY_TARGET` env var). To run e2e locally: start api-server (`DATABASE_URL=... PORT=3001 pnpm --filter api-server run dev`), then studio (`PORT=<any> BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`), then `E2E_BASE_URL=http://localhost:<studio-port> npx playwright test` from `artifacts/studio`. `labs.spec.ts` itself still needs its assertions rewritten for the current API shape before it'll pass locally — `import.spec.ts` (D5.2) is the first spec written against current HEAD and passes.
- **`import.meta.url`-relative paths lie once esbuild bundles them.** `artifacts/api-server`'s build (`build.mjs`, `bundle: true`) merges every source file into one `dist/index.mjs`; at runtime, `import.meta.url` for code that originated from *any* of those files resolves to that single output file's location, not its own true source path. A path computed via `path.dirname(fileURLToPath(import.meta.url))` that assumes the source layout (e.g. `src/data/`) works under vitest (unbundled) but silently breaks in the real built server. `pmedian.ts` already hardcodes around this for `solve.py`'s path; `data/dataset.ts` uses `findRepoRoot()` (walk up to `pnpm-workspace.yaml`) instead, which is correct in both contexts — prefer that pattern for anything new. Always verify against the actual built server (`pnpm --filter api-server run dev`), not just vitest, before trusting a new file-path computation.
- **`spawnSync` is gone (G3.1).** Solve is now async via `solver/jobRunner.ts`'s worker pool (`spawn`, not `spawnSync`) — do not reintroduce blocking sync child-process calls on the request path. One intentional exception: `__tests__/resultEnvelope.test.ts` (from G2.1) still uses `spawnSync` purely as test-invocation convenience to validate solve.py's raw envelope shape directly — it's not part of the request path, so it's out of scope for the "zero spawnSync" DoD that governed the production code.
- **`e2e_accuracy.py`'s historical "102/102 passed" was inflated by a duplicate-run bug, present since the script was written, only surfaced 2026-08-21 by the first real CI run of a pushed branch.** `main()`'s `sections` dict already had `"cross": test_cross_model` (so the `filter_arg == "all"` loop already runs it), but a leftover unconditional `test_cross_model()` call right after the loop ran it a second time — every cross-model check (15 of them: 3 models × 5 checks) printed and counted twice, so the true unique-check count was always 87, not 102. Compounding this: `runTimeSec` (`round(elapsed, 2)` in `solve.py`) can legitimately round to exactly `0.00` for a tiny model (the 4-mine/15-station transport LP) on fast hardware, and the cross-model check asserted strict `0 < t`, so on CI's faster runner (never exercised until a branch was actually pushed and CI ran against it for real) 2 of the 15 duplicated checks genuinely failed both times — `100/102`. Fixed (`974a127`, explicit human approval per hard rule #2): removed the duplicate call, loosened the check to `0 <= t < 300s` (a sub-5ms solve is a real pass, not a missing-timing failure — `-1` is the actual absent-field sentinel). Now correctly `87/87`. **Lesson, twofold:** (1) when a script's dispatch table already includes an entry for "run everything", don't ALSO hardcode a call to that same entry outside the loop — one is redundant by construction, and redundant test execution silently inflates a headline pass count without anyone noticing until the count itself is scrutinized; (2) never assert strict inequality (`> 0`, `< N`) on a timing value that's been rounded to a fixed number of decimals — round toward the boundary and the real answer can legitimately land ON the boundary; use `>=`/`<=` unless the field's absence is representable some other way (here, a `-1` sentinel already existed and was the actual thing worth asserting against). Neither bug was ever caught locally because local dev-machine solve times for this tiny model apparently never happened to round to exactly `0.00`, and the duplicate-run inflation was invisible without a side-by-side unique-check-count audit — a script whose own headline "N/N passed" number has never been independently verified against a hand-count of its own checks is exactly the kind of thing that stays wrong for a long time.
- The solver wrapper never throws — crashes, timeouts, and unparseable stdout all degrade to a well-formed `{status: "error", infeasibilityReason: ...}`. Preserve this contract.
- Distance bands are a **reporting lens**, not model constraints — they're computed in post-processing from per-assignment distances and can be recomputed client-side without re-solving.
- Customer city names are NOT unique (two Arlingtons, two Kansas Citys, two Springfields…). Stable IDs are the only valid join key for imports/exports; city/state are display-only.
- Known dataset label defects (WH23 "San Francisco, MO", WH25 "St. Louis, FL") are under a stop-and-ask protocol (task C2) — do not "fix" them opportunistically; the textbook distance matrix may be the authority.
- Cached `result` JSONB can drift from edited inputs — the staleness guard (X1.1) exposes this as a derived `Scenario.stale` boolean (never stored), surfaced as a badge in Studio and Compare. `result` itself is left untouched when stale (old result stays visible with the badge) — always check `.stale` before trusting `.result`, don't assume a populated `result` reflects current `inputs`.
- `problemType` is hidden from the UI but must NOT be removed from DB/API — solver dispatch and Compare validation depend on it.
- Tests live per package: API in `artifacts/api-server` (vitest/supertest), frontend in `artifacts/studio` (vitest/RTL + Playwright), solver in `artifacts/api-server/src/solver/tests/` (pytest).
- `uniformCapacity` (DB/API/TS field name) and `warehouseCapacity` (the key `solve.py`'s `solve_capacitated_pmedian()` actually reads off stdin) are the same value under two different names at two different layers — the route/`solve()` boundary translates between them. Don't rename one without the other, and don't assume a grep for one name finds every reference.
- `e2e_accuracy.py` and `e2e_journey.py` under `artifacts/api-server/src/solver/tests/` are standalone scripts (`python3 e2e_accuracy.py`), not pytest-discovered (`test_*.py` naming) — `python3 -m pytest tests/ -x` does NOT run them. Run them directly when solver-affecting changes land, despite CLAUDE.md's rule 2 calling `e2e_accuracy.py` sacred — the pytest-only gate command will not catch a regression there. **`e2e_journey.py` is fully non-runnable, not merely stale**: confirmed during Bundle 2.2's QA gate that it authenticates via `POST /login {userId}` — the legacy endpoint removed in Phase 1 (A1.1, `db7b9db`) — so it `401`s at the very first step and never reaches any solver/scenario code. Do NOT treat its presence as coverage; it needs a rewrite onto `/auth/register`+`/auth/login` (argon2) before it verifies anything. `e2e_accuracy.py` (87/87) is unaffected and remains the real solver-accuracy gate.
- The reference-distances endpoint (`GET /models/:id/reference-distances`, Bundle 2.2/B3) is **model-scoped and immutable**, NOT scenario-scoped: base distances are geographic, status-independent, ownerless dataset data (the third field of what `/dataset` already serves model-scoped). It returns the COMPLETE base×base matrix (5200 pairs for p-median-us) unfiltered; the frontend (`DistancesTab`) filters the *view* against live `localInputs` (hiding inactive-warehouse / excluded-customer rows). Do not add server-side status filtering or make it scenario-scoped — status is a pure view concern, and scenario-scoping would forfeit the immutable per-model cache + invite the very server-side filtering that model-scoping avoids. It sets its own explicit `ETag` (global `app.set("etag", false)` disables Express's) + `Cache-Control: public, max-age=0, must-revalidate`, and is gated by `capabilities.supportsReferenceDistances` (p-median-us only so far; the frontend query is `enabled`-guarded so unsupported models fire no request).
- The login rate limiter (`routes/auth.ts`, 10 attempts/min/IP, in-memory `Map`) never resets on its own between test runs within one process. Any test file that logs in more than ~10 times (e.g. `routes.test.ts`'s per-test `loginAs()` helper) must call the test-only `resetLoginRateLimiterForTests()` export in `beforeEach`, or later logins in the same file silently start 429ing.
