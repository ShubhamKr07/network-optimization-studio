# Harness Self-Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dev process measurable and self-correcting — every task records a metrics row, flakiness is quantified and quarantined deliberately, deploys are smoke-tested against documented silent-failure points, recurring failure causes become gates, and a weekly doc sweep produces reviewable `docs-audit/*` PRs the human approves before anything merges.

**Architecture:** Five subsystems — (1) an append-only CSV metrics store under `docs/superpowers/metrics/`; (2) TS recorders/reporters in the `@workspace/scripts` pkg; (3) a Playwright flake-audit + `@flaky` quarantine lane; (4) a from-outside-Render deploy smoke runner; (5) a docs pipeline = mechanical detector script → agent judgment skill → per-finding-commit PR → `/docs-apply` review protocol. Glue: a registration-points gate, a `/harness-retro` skill enforcing a second-occurrence rule, and weekly/Sunday cron.

**Tech Stack:** pnpm monorepo (pnpm@9.15.9), Node 24, TS 5.9, `tsx` runner, vitest, Playwright, `gh` CLI, bash. Python/PuLP only touched via the smoke solver fixture.

## Global Constraints

- **Commit prefix `[OBS-n]`** — one revertable commit per phase; `docs:` prefix only for the already-committed discovery/spec/plan docs. Commit message trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **pnpm only** (npm/yarn blocked by root preinstall). `packageManager: pnpm@9.15.9`.
- **Never fabricate a metric** — underivable value is the literal string `unknown`, never an estimate.
- **TS harness code lives under `scripts/src/`** (pkg `rootDir: src`, `include: ["src"]`, runner `tsx`) — real paths `scripts/src/harness/*.ts`, `scripts/src/deploy/*.ts`; the one shell script at `scripts/harness/flake-audit.sh`. Root `pnpm` aliases delegate to `pnpm --filter @workspace/scripts …` or `pnpm --filter studio …`.
- **Never edit generated code** (`lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`) — change `lib/api-spec/openapi.yaml` then run Orval.
- **Docs authority order:** `CLAUDE.md` > named gates (`model-integration-precheck.md`, `docs/superpowers/gates/**`) > `openapi.yaml`+source > `docs/ops/**`+ADRs > package READMEs > root `README.md` > everything else > memory files.
- **Cause taxonomy (finite):** `flaky_test | spec_gap | registration_point | codegen_drift | merge_conflict | deploy_config | solver_timeout | migration_order | zod_strip | doc_drift | other`.
- **Audit exclusion:** `node_modules/**`, `docs/superpowers/specs/**`, `docs/superpowers/plans/**`, `docs/superpowers/docs-audit/**`, `docs/superpowers/metrics/reports/**`, `docs/telemetry/reports/**`, `docs/ops/*/plans/**`, `CHANGELOG.md`, `replit.md`, `<!-- docs-audit: ignore -->` (first 10 lines).
- **The two harness rules** (stated in the metrics README): a cause appearing twice in `failures.csv` must yield a proposed gate; no doc reaches `main` except via a reviewed `docs-audit/*` PR processed by `/docs-apply`.
- **Live URLs:** api `https://nos-api-uwf8.onrender.com`, studio `https://nos-studio.onrender.com`; health `/api/healthz`.
- **Human checkpoints (stop and wait):** #3 before quarantining any test; #4 before editing the user-level GLM router; #5 any gate proposal from `/harness-retro` (incl. `doc_drift`); #6 `/docs-apply` resolution-table confirmation.

> Review notes:
> - This plan is directionally strong and matches the repo’s real recurring failure classes (flaky e2e, model-registration drift, deploy smoke gaps, and doc drift).
> - The main risk is scope precision: the GLM-router decision is not repo-local in the way this plan assumes, and the repo already has an existing `.superpowers/sdd` ledger that should be treated as the base system rather than recreated from scratch.
> - The plan should separate repo edits from user-level hook edits and from GitHub/PR steps, because those are different control surfaces. This is the most important correction in the plan and it is now handled correctly by the task wording.
> - The Render URLs are operational defaults, not canonical truths; they should remain overrideable instead of hardcoded as permanent project state. The task should keep them as runtime defaults or CLI/env overrides, not as project state.
> - The docs-audit workflow is a good safety layer, but it needs a tighter definition of what counts as a finding, a warning, a resolution, and a carried-over issue. The plan should resolve those states before the implementation phase begins.
> - OBS-8 should be explicitly framed as a user-level hook change outside the repo, with the repo only documenting the decision. The repo should not be presented as the enforcement boundary for that change.
> - The overall judgment is: approve with minor follow-ups, not reject. The plan is a credible operational harness design once the boundary conditions are explicit.
>
> Assumptions to confirm before implementation:
> - Confirm whether the GLM hook change is intentionally outside the repo and not a repo-controlled enforcement point.
> - Confirm whether `.superpowers/sdd` remains the canonical ledger and whether the CSV metrics layer is additive rather than replacement logic.
> - Confirm whether the docs-audit PR path is strictly repo-local review + external GitHub approval, not a repo-side mutation of the user hook or the global agent configuration.
> - Confirm whether live Render URLs remain runtime defaults and are overridable by env/CLI flags for both local and production smoke runs.
> - Confirm whether a docs-audit finding is one of {finding, warning, carried_over, resolved} with a single merge policy and no ambiguity about which state blocks the branch.

---

## File structure (created/modified)

```
docs/superpowers/metrics/
  README.md                    OBS-1  column semantics + two rules
  tasks.csv failures.csv flake.csv deploys.csv docs-audit.csv   OBS-1 headers only (+ backfill rows OBS-2/OBS-5)
  reports/YYYY-WW.md           OBS-7  weekly report (generated)
docs/superpowers/gates/
  <cause>.md                   OBS-6/OBS-10 (drafted on 2nd occurrence; doc_drift proposed in OBS-10)
docs/superpowers/docs-audit/
  inventory.json               OBS-9b  (generated, tracked)
  YYYY-WW.md                   OBS-9c  findings file per PR (generated)
docs/superpowers/docs-audit.config.json   OBS-9a
docs/superpowers/prompts/jobs/
  harness-weekly.md            OBS-7
  docs-audit-sunday.md         OBS-9c
docs/ops/smoke.md              OBS-4
scripts/src/harness/
  lib/csv.ts derive.ts ids.ts inventory.ts        shared pure helpers
  lib/detectors/{staleReference,superseded,redundantPassage,conflictingInstruction,orphan,memoryContradiction}.ts
  record-task.ts report.ts docs-audit.ts docs-lint.ts
  __tests__/*.test.ts + __fixtures__/docs/*
scripts/harness/flake-audit.sh                    OBS-3 (bash, not TS)
scripts/src/deploy/
  smoke.ts  checks/{corsPreflight,cookieAttributes,fetchCredentials,postgresTls,viteEnvBaked,pythonSolverPresent,freeTierWakeup}.ts
  __tests__/checks.test.ts
artifacts/api-server/src/registry/__tests__/registration.test.ts   OBS-5 (EXTEND existing)
artifacts/api-server/src/routes/health.ts + openapi.yaml + codegen  OBS-4 db:ok
.claude/skills/harness-retro/SKILL.md      OBS-6
.claude/skills/docs-audit/SKILL.md         OBS-9c
.claude/skills/docs-apply/SKILL.md         OBS-10
.claude/settings.json                      OBS-8 (project override doc)
~/.claude/hooks/glm_subagent_router.mjs    OBS-8 (user-level edit, checkpoint 4)
package.json (root)                        pnpm aliases (each phase adds its own)
scripts/package.json                       per-phase script entries
artifacts/studio/playwright.config.ts      OBS-3 json reporter + grepInvert lane
CLAUDE.md                                   OBS-3/OBS-6 re-gating + retro rules
```

---

## Task 1 (OBS-1): Metrics schema

**Files:**
- Create: `docs/superpowers/metrics/{README.md,tasks.csv,failures.csv,flake.csv,deploys.csv,docs-audit.csv}`

**Interfaces — Produces:** the five CSV files with exact headers below; every later recorder appends to them via `scripts/src/harness/lib/csv.ts` (Task 2).

- [ ] **Step 1:** Create the five CSVs, each containing ONLY its header line (verbatim):
```
tasks.csv:      task_id,branch,started_at,finished_at,dispatch_cycles,first_gate_pass,cherrypick_conflict,e2e_runs_to_green,wallclock_min,tokens,merged_sha,reverted_within_7d,escaped_defects
failures.csv:   date,task_id,phase,cause,test_or_check,notes,gate_proposed,gate_accepted
flake.csv:      audited_at,sha,test_file,test_title,runs,failures,flake_rate,quarantined
deploys.csv:    deployed_at,service,sha,smoke_pass,failed_checks,incident,notes
docs-audit.csv: audited_at,run_id,files_scanned,stale,redundant,conflicting,orphan,memory_findings,new,carried_over,pr_url,pr_state,applied,kept,resolved_at
```
- [ ] **Step 2:** Write `README.md` documenting each column's semantics (values, `unknown` convention, allowed enums e.g. `first_gate_pass ∈ {yes,no,unknown}`, `cause` taxonomy, `pr_state ∈ {open,merged,skipped_dirty_tree,no_gh}`) and the two harness rules verbatim.
- [ ] **Step 3: Verify** `wc -l docs/superpowers/metrics/*.csv` → each file `1` line.
- [ ] **Step 4: Commit** `[OBS-1] add harness metrics schema`.

---

## Task 2 (OBS-2): Task recorder

**Files:**
- Create: `scripts/src/harness/lib/csv.ts`, `scripts/src/harness/lib/derive.ts`, `scripts/src/harness/record-task.ts`, `scripts/src/harness/__tests__/record-task.test.ts`
- Modify: `scripts/package.json` (add `"harness:record": "tsx ./src/harness/record-task.ts"`), root `package.json` (add `"harness:record": "pnpm --filter @workspace/scripts harness:record --"`)

**Interfaces — Produces:**
- `appendRow(file: string, header: string[], row: Record<string,string>): void` and `readRows(file, header): Record<string,string>[]` and `hasValue(file, header, col, value): boolean` in `lib/csv.ts`.
- `deriveTaskTimestamps(taskId, opts): {started_at, finished_at, merged_sha}` in `lib/derive.ts` (reads `.superpowers/sdd/task-<id>-{brief,report}.md` mtime, else git commits whose subject contains the task id/branch tag; ISO-8601 or `unknown`).

- [ ] **Step 1: Write failing test** `record-task.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { appendRow, readRows } from "../lib/csv.js";
const HEADER = ["task_id","branch","started_at"];
describe("csv append", () => {
  it("appends a row and rejects a duplicate task_id without force", () => {
    const dir = mkdtempSync(join(tmpdir(),"csv-"));
    const f = join(dir,"tasks.csv"); writeFileSync(f, HEADER.join(",")+"\n");
    appendRow(f, HEADER, {task_id:"OBS-2", branch:"x", started_at:"unknown"});
    expect(readRows(f, HEADER)).toHaveLength(1);
    expect(() => appendRow(f, HEADER, {task_id:"OBS-2", branch:"y", started_at:"unknown"}, {dedupeKey:"task_id"}))
      .toThrow(/duplicate/);
  });
});
```
- [ ] **Step 2: Run** `pnpm --filter @workspace/scripts test -- record-task` → FAIL (module missing).
- [ ] **Step 3: Implement** `lib/csv.ts` — `appendRow` writes CSV-escaped row (quote fields containing `,"\n`), asserts header matches file's first line, and if `opts.dedupeKey` set throws `Error("duplicate <key>")` when the value already present unless `opts.force`. `readRows` parses respecting quotes. `hasValue` is a thin wrapper.
- [ ] **Step 4: Implement** `lib/derive.ts` and `record-task.ts`. CLI (via `tsx` argv): flags `--task --branch --cycles --first-gate --conflict --e2e-runs [--force]`. Builds a full 13-column row: derived `started_at`/`finished_at`/`merged_sha` from `derive.ts`, `tokens="unknown"` (Phase 0: no job token source), `reverted_within_7d="unknown"`, `escaped_defects="unknown"`, and the passed flags (missing → `unknown`). Appends to `docs/superpowers/metrics/tasks.csv` with `dedupeKey:"task_id"`.
- [ ] **Step 5: Run** `pnpm --filter @workspace/scripts test -- record-task` → PASS; then `pnpm run typecheck`.
- [ ] **Step 6: Backfill** the recoverable historical rows (Phase 0 §8 tag-groups) by invoking the recorder once per group, e.g.:
```bash
pnpm harness:record --task empty-first-run --branch empty-first-run --cycles unknown --first-gate unknown --e2e-runs unknown
pnpm harness:record --task bundle6.1 --branch bundle6.1 --cycles unknown --first-gate unknown --e2e-runs unknown
# …~15-20 groups from git log tag prefixes; started/finished/merged_sha derived from git.
```
- [ ] **Step 7: Commit** `[OBS-2] add harness task recorder`.

---

## Task 3 (OBS-3): Flake audit + quarantine lane

**Files:**
- Create: `scripts/harness/flake-audit.sh`
- Modify: `artifacts/studio/playwright.config.ts` (add a `json` reporter + a `quarantine`/`gate` selection via `grepInvert`), `artifacts/studio/package.json` (`"e2e:gate": "playwright test --grep-invert @flaky"`, `"e2e:quarantine": "playwright test --grep @flaky"`), root `package.json` (`e2e:gate`/`e2e:quarantine` passthrough to `--filter studio`), `CLAUDE.md` (re-gating runs `pnpm e2e:gate`)

**Interfaces — Produces:** `flake.csv` rows (`audited_at,sha,test_file,test_title,runs,failures,flake_rate,quarantined`); `@flaky`-tagged tests excluded from the gate lane.

- [ ] **Step 1:** Add a `json` reporter to `playwright.config.ts` writing `e2e/report/results.json` (keep `list`+`html`), and confirm `--grep`/`--grep-invert` work with `@flaky` title tags.
- [ ] **Step 2: Write** `flake-audit.sh`: `set -euo pipefail`; refuse if `git status --porcelain` is non-empty (`echo "dirty tree" >&2; exit 2`); `RUNS=${1:-20}` (accepts `--runs N`); capture `SHA=$(git rev-parse HEAD)`; loop `RUNS` times running `PWTEST_JSON=1 pnpm --filter studio exec playwright test --retries=0 --grep-invert @flaky --reporter=json > run.json`; parse each run's per-test outcome (via a tiny `tsx scripts/src/harness/lib/flakeAggregate.ts` reading the RUNS json files); write per-test `runs`/`failures`/`flake_rate` to `flake.csv` with `quarantined=no`; print two tables — flaky (`0<rate<1`) and broken (`rate=1`); exit non-zero if any flaky.
- [ ] **Step 3: Implement** `scripts/src/harness/lib/flakeAggregate.ts` (pure: reads an array of Playwright json result files, returns `{file,title,runs,failures}[]`), unit-tested against two hand-written fixture json files (one test flaky, one stable).
- [ ] **Step 4:** Update `CLAUDE.md` gotchas/gate note: "Re-gating e2e runs `pnpm e2e:gate` (excludes `@flaky`); the quarantine lane is `pnpm e2e:quarantine`. `labs.spec.ts` stays excluded (pre-D0, dead)." Note in the script header which specs wait on wall-clock / share DB rows / depend on real CBC timing, and that e2e should seed solver results (leave real CBC to pytest).
- [ ] **Step 5: Run once for real** (live proof): start local dev servers (api on 3001 with `DATABASE_URL`, studio with `API_PROXY_TARGET=http://localhost:3001`, `E2E_BASE_URL` at the studio port), then `bash scripts/harness/flake-audit.sh --runs 20`. Present the flaky/broken tables. **STOP — checkpoint #3. Do not quarantine anything until the human picks which `@flaky` tags to add.**
- [ ] **Step 6: Commit** `[OBS-3] add flake audit and e2e quarantine lane` (after the human's quarantine decision; the human's chosen `@flaky` tags land in this commit, `quarantined=yes` for those rows).

---

## Task 4 (OBS-4): Post-deploy smoke + health `db` field

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (health response schema gains `db: {type: string, enum: [ok, down]}`), regenerate codegen (`lib/api-zod`, `lib/api-client-react`), `artifacts/api-server/src/routes/health.ts` (payload gains `db`, set by a real `SELECT 1` against the pool, `ok`/`down`)
- Create: `scripts/src/deploy/smoke.ts`, `scripts/src/deploy/checks/{corsPreflight,cookieAttributes,fetchCredentials,postgresTls,viteEnvBaked,pythonSolverPresent,freeTierWakeup}.ts`, `scripts/src/deploy/__tests__/checks.test.ts`, `docs/ops/smoke.md`
- Modify: `scripts/package.json` (`"smoke": "tsx ./src/deploy/smoke.ts"`), root `package.json` (`smoke` passthrough), `artifacts/api-server/src/__tests__/health.test.ts` (assert new `db` field)

**Interfaces — Produces:** each check is `async (env: {apiBase, studioBase}) => {name, pass, detail, ms, warn?}`; `smoke.ts` composes all seven, appends a `deploys.csv` row per service, non-zero exit on any hard failure.

- [ ] **Step 1 (health, TDD):** Add failing api-server test asserting `GET /api/healthz` returns `{status:"ok", db:"ok"}`. Run → FAIL.
- [ ] **Step 2:** Edit `openapi.yaml` health response, run Orval, edit `health.ts` to run `await pool.query("SELECT 1")` (guarded, → `db:"down"` on throw). Run test → PASS. Commit codegen + spec together.
- [ ] **Step 3 (smoke checks):** Implement the seven checks:
  - `corsPreflight`: `OPTIONS` `apiBase` with `Origin: studioBase` → assert `access-control-allow-origin` echoes the exact origin + `allow-credentials: true`.
  - `cookieAttributes`: `POST /api/auth/register` (disposable email) → assert `Set-Cookie` has `Secure; SameSite=None` in production.
  - `fetchCredentials`: authenticated round-trip (register→`GET /api/auth/user` with the cookie) returns 200.
  - `postgresTls`: `GET /api/healthz` → assert `db==="ok"`.
  - `viteEnvBaked`: fetch `studioBase`, then the referenced JS bundle → assert it contains `nos-api-uwf8.onrender.com`, NOT the placeholder `VITE_API_BASE_URL`.
  - `pythonSolverPresent`: create+solve a known fixture scenario via the async job API, poll ≤30s → assert `status==="optimal"` and objective within tolerance of the fixture's expected value.
  - `freeTierWakeup`: time the first health request; `warn` (not fail) if `>10s`.
- [ ] **Step 4:** `smoke.ts` — parse `--env production|preview`; `production` defaults `apiBase=https://nos-api-uwf8.onrender.com`, `studioBase=https://nos-studio.onrender.com` (overridable by `--api-base`/`--studio-base`/env). Run checks, print a table, append `deploys.csv` (`smoke_pass=yes/no`, `failed_checks=semicolon list`, `incident=""`), exit non-zero on any hard fail. Clean up disposable accounts.
- [ ] **Step 5:** Unit-test the pure bits (arg parsing, result formatting, `failed_checks` join) in `checks.test.ts` (network checks mocked via injected `fetch`).
- [ ] **Step 6:** `docs/ops/smoke.md` — when to run (after every production deploy), how, what each check guards (cross-link CLAUDE.md gotchas).
- [ ] **Step 7: Run live** (proof) `pnpm smoke --env production`. Present results; a `free_tier_wakeup` warn is acceptable.
- [ ] **Step 8: Commit** `[OBS-4] add post-deploy smoke checks` (spec+codegen+route+scripts+doc).

---

## Task 5 (OBS-5): Registration-points gate

**Files:**
- Modify: `artifacts/api-server/src/registry/__tests__/registration.test.ts` (EXTEND — first read it to avoid duplicating existing assertions)
- Append: 4 backdated `failures.csv` rows

**Interfaces — Consumes:** `VALID_MODEL_IDS` (`routes/scenarios.ts:58`), `KNOWN_SCHEMAS` (`registry/modelRegistry.ts:17`), `buildPayload`/`SolveInput` (`solver/pmedian.ts`), `solve.py` dispatcher (`solver/solve.py:876`).

- [ ] **Step 1: Read** the existing `registration.test.ts` fully; note which of the four points it already checks.
- [ ] **Step 2: Write** the added assertions:
  - Import `VALID_MODEL_IDS` and `KNOWN_SCHEMAS`. Define `IMPLEMENTED = Object.keys(KNOWN_SCHEMAS)` (the 4 real ids).
  - Extract `buildPayload` model-id→`modelType` mapping by calling `buildPayload` with a minimal valid `inputs` per id and reading `.modelType` (default id `p-median-us` → `undefined`/`p_median`).
  - Regex-parse solve.py dispatcher keys: `read solve.py`, match `model_type == '(\w+)'` + the default `p_median`.
  - **Assert:** every id in `IMPLEMENTED` is in `VALID_MODEL_IDS`, has a `buildPayload` branch, and its mapped `modelType` is handled by solve.py. Print the symmetric difference with file paths on failure.
  - **Warn (not fail):** any `VALID_MODEL_IDS` entry NOT in `IMPLEMENTED` → `console.warn("un-backed model id in VALID_MODEL_IDS: <id>")` (this is the placeholder decision — `max_coverage`/`p_center`/`set_cover`).
- [ ] **Step 3: Run** `pnpm --filter api-server test -- registration` → PASS (warns about 3 placeholders, does not fail).
- [ ] **Step 4: Demonstrate red** (DoD): temporarily delete `"transport-coal"` from `KNOWN_SCHEMAS`, run → FAIL with the symmetric-difference message, then `git checkout` the file. (Do NOT commit the deletion.)
- [ ] **Step 5: Backfill** 4 `failures.csv` rows: `date=<today>,task_id=historical,phase=integration,cause=registration_point,test_or_check=registration.test.ts,notes="model-integration bug class (Ch10 R1, SCN B-branch)",gate_proposed=registration.test.ts,gate_accepted=yes`.
- [ ] **Step 6: Commit** `[OBS-5] gate model registration points with a test`.

---

## Task 6 (OBS-6): `/harness-retro` skill + second-occurrence rule

**Files:**
- Create: `.claude/skills/harness-retro/SKILL.md`
- Modify: `CLAUDE.md` ("A branch is not finished until `/harness-retro` has run.")

**Interfaces — Consumes:** `pnpm harness:record` (Task 2), `pnpm docs:audit --since <ref> --mechanical-only` (Task 9b). **Produces:** `failures.csv` rows, drafted `docs/superpowers/gates/<cause>.md` on 2nd occurrence.

- [ ] **Step 1: Write** `SKILL.md` frontmatter (`name: harness-retro`, `description: Use at the end of every finishing-a-development-branch run to record task metrics, log failures by cause, and fire the second-occurrence gate rule. Invoked as /harness-retro <task_id>.`) and body with these numbered steps the agent follows:
  1. Run `pnpm harness:record …`, prompting the human only for values it cannot derive (`dispatch_cycles`, `first_gate_pass`, `cherrypick_conflict`, `e2e_runs_to_green`).
  2. Append one `failures.csv` row per gate failure this branch, `cause` from the taxonomy (list all 11 verbatim in the skill).
  3. Read `failures.csv`; if any `cause` now appears **twice with no `gate_proposed`**, draft `docs/superpowers/gates/<cause>.md` (template: symptom, two occurrences w/ dates, proposed automated gate, how to enable) and **STOP for approval (checkpoint #5)**.
  4. Fill `reverted_within_7d` (git: was `merged_sha` reverted?) and `escaped_defects` for tasks finished in the prior 7 days.
  5. Run `pnpm docs:audit --since $(git merge-base main HEAD) --mechanical-only` and print the `stale_reference` warning table (file,line,reference) — **warning only**, writes no findings file, opens no PR, never blocks.
  6. If a `docs-audit/*` PR is open (`gh pr list --label docs-audit --state open`), print its URL + age once.
- [ ] **Step 2:** Update `CLAUDE.md`.
- [ ] **Step 3: Commit** `[OBS-6] add harness-retro skill and second-occurrence rule`.

---

## Task 7 (OBS-7): Weekly report + job

**Files:**
- Create: `scripts/src/harness/report.ts`, `docs/superpowers/prompts/jobs/harness-weekly.md`
- Modify: `scripts/package.json` (`"harness:report": "tsx ./src/harness/report.ts"`), root `package.json` (passthrough)

**Interfaces — Consumes:** all five CSVs via `lib/csv.ts`. **Produces:** `docs/superpowers/metrics/reports/YYYY-WW.md`.

- [ ] **Step 1: Write** `report.ts`: read the CSVs, compute — task count; medians of `dispatch_cycles`/`wallclock_min`/`e2e_runs_to_green` (ignoring `unknown`); `first_gate_pass` rate; conflict rate; reverts + escaped defects; top-5 flaky + quarantine count; deploys + smoke failures by check; failure causes by count with second-occurrence flags + gate status; and a `## Documentation` section (last Sunday sweep: files scanned, findings by type, new vs carried over; open `docs-audit/*` PR age+URL+unreviewed count; applied vs kept from PRs merged this week; any file flagged in two consecutive sweeps after a merged PR = a `doc_drift` second occurrence). End with a one-paragraph "what changed since last week" (diff vs the previous `reports/*.md` if present). Week id = ISO `YYYY-WW`, passed in via `--week` (no `Date.now()` reliance for determinism; default to `git log -1 --format=%cd`-derived week).
- [ ] **Step 2: Unit-test** the median/rate helpers (ignore-`unknown`, empty-input → `unknown`).
- [ ] **Step 3: Write** `harness-weekly.md` cron prompt: run `bash scripts/harness/flake-audit.sh --runs 20` **only if** the last `flake.csv` `audited_at` is >7 days old; run `pnpm harness:report`; commit on a `reports/YYYY-WW` branch; stop. It does NOT run the doc sweep, makes no source edits, opens no PRs, asks no questions.
- [ ] **Step 4: Run live** (proof) `pnpm harness:report` → produce the first `reports/YYYY-WW.md` with a populated `## Documentation` section.
- [ ] **Step 5: Commit** `[OBS-7] add weekly harness report and job prompt`.

---

## Task 8 (OBS-8): Disable GLM router for this project

> Review note: This task should be framed as a user-level hook change outside the repo, with the repo only documenting the decision. The current wording blurs that boundary.

**Two control surfaces, executed and recorded separately** (confirmed): the repo is NOT the enforcement boundary for a user-level hook (Claude Code hooks are additive — a repo file cannot un-register one).

- **Surface A — repo (committed `[OBS-8]`), documentation only.** Create `.claude/settings.json` whose note records "GLM subagent delegation is disabled for this project" (declarative; no hook pretending to control the user-level router).
- **Surface B — user-level (`~/.claude/**`, NOT repo-committed; checkpoint #4), the functional change.** Edit `~/.claude/hooks/glm_subagent_router.mjs`.

- [ ] **Step 1 (B, checkpoint #4):** Re-confirm with the human; back up `cp ~/.claude/hooks/glm_subagent_router.mjs ~/.claude/hooks/glm_subagent_router.mjs.bak`.
- [ ] **Step 2 (B):** Add an early-return at the router's entry — if the invocation's project/`cwd` is under `…/network-optimization-studio`, emit nothing, exit 0; behavior identical for every other repo. Lives only in `~/.claude/`; never staged/committed in the repo.
- [ ] **Step 3 (B): Verify** — dispatch a throwaway `Task` in this repo → no `[GLM router]` line (ideally still present from an unrelated dir).
- [ ] **Step 4 (A):** Create `.claude/settings.json` documenting the decision (declarative note only).
- [ ] **Step 5 (A): Commit** `[OBS-8] document GLM-delegation-disabled decision for this project` — repo file(s) only; commit body notes the separate, backed-up, out-of-repo Surface B edit (intentionally not in the repo).

---

## Task 9 (OBS-9): Sunday documentation sweep (script + skill + PR)

> Review note: This is a good safety mechanism, but it needs explicit semantics for a finding that is warning-only vs. a true finding vs. a carry-over. The plan should define the resolution states and the merge policy more tightly before implementation.

### Docs-audit semantics (confirmed 4-state model + single merge policy)

Used verbatim by `docs-audit.ts`, the `docs-audit` skill, `/docs-apply`, and the report.

- **`candidate`** — raw mechanical detector output (unverified), in `.harness/docs-audit/candidates.json` only; never a commit/PR line. Stable `id = sha1(type+file+normalizedPassage)[:10]`.
- **`finding`** — a candidate the agent verified against code+git; the unit that gets exactly one commit on the `docs-audit/*` branch (repo findings) or one drafted block in the findings file (memory findings, never committed).
- **`warning`** — `stale_reference` candidates from `/harness-retro`'s `--mechanical-only` run. Informational: printed, writes no findings file, opens no PR, **never blocks**. Not a finding until a full Sunday sweep verifies it.
- **`carried_over`** — a finding whose `id` is already on the open PR: unchanged → no new commit (aged under `## Carried over`); passage changed → replacement commit + note; no longer detected → `- resolved upstream`.
- **`resolved`** — set by `/docs-apply` from the human's per-finding comment: `applied <sha>` / `kept` (reverted) / `deferred` (reverted, carries over) / `dismissed: <reason>` (reverted + 8-week id suppression) / `edited <sha>`. A `dismissed` candidate at verification time (agent-judged false positive) is also a `resolved` sub-state, listed under `## Dismissed`.

**Single merge policy:** nothing reaches `main` except a reviewed PR merged by `/docs-apply` with `gh pr merge --merge --delete-branch` (**no squash** — per-finding commits stay individually revertable). The sweep and `docs:audit` never touch `main`; the retro warning never blocks. **No state blocks a branch** — advisory + PR-gated only. Memory files are never git-committed; memory findings are applied by `/docs-apply` to the git-ignored memory dir with a backup first, never deleted (whole-file removal → one-line pointer).

**Files:**
- Create: `docs/superpowers/docs-audit.config.json`, `scripts/src/harness/lib/{ids,inventory}.ts`, `scripts/src/harness/lib/detectors/*.ts` (6), `scripts/src/harness/docs-audit.ts`, `scripts/src/harness/__tests__/detectors.test.ts` + `__fixtures__/docs/*`, `.claude/skills/docs-audit/SKILL.md`, `docs/superpowers/prompts/jobs/docs-audit-sunday.md`
- Modify: `scripts/package.json` (`"docs:audit": "tsx ./src/harness/docs-audit.ts"`), root `package.json` (passthrough)

**Interfaces — Produces:** `.harness/docs-audit/candidates.json` (default `--out`), `docs/superpowers/docs-audit/inventory.json`, and each detector as `(records: InventoryRecord[], cfg) => Candidate[]` where `Candidate = {id,type,origin,file,lines,evidence,related}` and `id = sha1(type + file + normalizedPassage).slice(0,10)`.

### 9a — config
- [ ] **Step 1:** Write `docs-audit.config.json` with `include: ["<git ls-files '*.md'>"]` (resolved at runtime), `exclude` (Global Constraints list), `memoryDir: "/Users/shubhamkr/.claude/projects/-Users-shubhamkr-network-optimization-studio/memory"`, `authority` (the ordered array).

### 9b — script + detectors (TDD, fixtures)
- [ ] **Step 2: Fixtures** — `scripts/src/harness/__fixtures__/docs/` with one planted example per detector + one clean file + one file under an exempt glob containing a planted example (must never be emitted).
- [ ] **Step 3: Write failing** `detectors.test.ts`: each detector finds its planted example with the right `type` + line range; clean fixture → zero; exempt file → zero even with a planted example.
- [ ] **Step 4: Implement** `ids.ts` (`candidateId`), `inventory.ts` (build `InventoryRecord{path,origin,title,headings[],lastChange,lastAudited,inboundLinks[],references{paths,scripts,envVars,symbols,routes,services,files}}`; extract references via the regexes in the spec), and the six detectors:
  - `stale_reference` — referenced path/script/envvar/route/symbol/service resolves to nothing in source (Arcadia passage → evidence "no matching source").
  - `superseded` — version-token-differing or ≥50%-shared-headings pair (older is candidate); or `DEPRECATED`/`superseded by`/`see instead`.
  - `redundant_passage` — 8-word-shingle Jaccard ≥0.6 between ≥40-word paragraphs across files (candidate = lower-authority file).
  - `conflicting_instruction` — imperative sentences (`always|never|must|must not|do not|use|run|prefer`) sharing ≥3 non-stopword tokens with opposing modals/commands (lower-authority side is candidate).
  - `orphan` — zero inbound links, not in a well-known location, unchanged 90+ days.
  - `memory_contradiction` — a memory file's current-state fact contradicted by the repo, or memory duplicating a repo doc at `redundant_passage` threshold.
- [ ] **Step 5: Implement** `docs-audit.ts` CLI: `--full` (default) / `--since <ref>` (changed files ∪ files whose refs intersect changed paths/symbols/scripts/envvars/routes) / `--mechanical-only` (print table + write only candidates JSON) / `--out <path>` (default `.harness/docs-audit/candidates.json`). Update `inventory.json`. Add `.harness/` to `.gitignore`.
- [ ] **Step 6: Run** `pnpm --filter @workspace/scripts test -- detectors` → PASS; `pnpm run typecheck`.
- [ ] **Step 7: DoD check** — `pnpm docs:audit --full` on the real repo lists the README Arcadia passages as `stale_reference` and emits nothing from `docs/superpowers/specs` or `plans`.

### 9c — judgment skill + Sunday prompt
- [ ] **Step 8: Write** `.claude/skills/docs-audit/SKILL.md` (report-mode: no questions, no edits to `main`). Body encodes the 8-step protocol: verify each candidate against code+git (`git log --follow`), drop false positives to `## Dismissed`, choose one action (`remove|replace|merge-into|delete-file|update-memory`) with COMPLETE drafted text, state confidence + the one fact it rests on; find/create `docs-audit/YYYY-WW` (`gh pr list --label docs-audit --state open`; if open → checkout + `git merge main` + carry over by id); one commit per new repo finding (`docs-audit <id> <type> <action> <file>`); memory findings appear in the findings file only (not committed); maintain `docs/superpowers/docs-audit/YYYY-WW.md`; open/update the labelled PR with the review protocol verbatim; append a `docs-audit.csv` row `pr_state=open`; STOP (no merge, no self-approve). Include the exact `gh` commands.
- [ ] **Step 9: Write** `docs-audit-sunday.md` cron prompt: pull `main`; if dirty or not fast-forwardable → write `docs-audit.csv` row `pr_state=skipped_dirty_tree` and stop; else `pnpm docs:audit --full` then invoke `/docs-audit`; stop.
- [ ] **Step 10: Commit** `[OBS-9] add Sunday documentation sweep with PR output`.

---

## Task 10 (OBS-10): Review protocol + `/docs-apply`

**Files:**
- Create: `.claude/skills/docs-apply/SKILL.md`, `scripts/src/harness/__tests__/docsApply.test.ts` + comment-payload fixtures, `docs/superpowers/gates/doc_drift.md` (proposed, not enabled), `scripts/src/harness/docs-lint.ts`
- Modify: `scripts/package.json` (`"docs:lint": "tsx ./src/harness/docs-lint.ts"`), root `package.json` (passthrough)

**Interfaces — Produces:** `parseReviewComments(comments): {findingId, decision, arg?}[]` where `decision ∈ {keep,apply,edit,delete,defer,dismiss,question}` (first-token, case-insensitive; unrecognized → `question`).

- [ ] **Step 1: Write failing** `docsApply.test.ts` against fixture payloads (one of each form + an unrecognized one) on a fixture branch with 3 finding commits from 2 stacked sweeps: asserts the resolution table, the resulting commit list (`git revert` for keep/defer/dismiss; new commit for edit/delete), and that the unrecognized comment yields a reply + no change.
- [ ] **Step 2: Implement** `parseReviewComments` (pure) in `scripts/src/harness/lib/reviewComments.ts`; run test → PASS.
- [ ] **Step 3: Write** `.claude/skills/docs-apply/SKILL.md` (`/docs-apply <pr-number>`, interactive only): refuse from cron/report-mode; refuse unless PR approved OR (no branch protection) a human `approve` comment exists; read comments+state via `gh api`; map comment→finding by hunk/commit or findings-file id; print resolution table + PAUSE once (checkpoint #6); rewrite branch (`git revert` for keep/defer/dismiss, new commit for `edit:`/`delete`); update findings file lines (`applied <sha>`/`kept`/`deferred`/`dismissed: <reason>`); memory `apply`/`edit:` → backup to `.harness/memory-backup/YYYY-MM-DD/` then apply, never delete (whole-file removal → one-line pointer); `gh pr merge --merge --delete-branch`; update `docs-audit.csv` (`pr_state=merged`,`applied`,`kept`,`resolved_at`); if a file re-appears with the same finding type as the previous merged PR → append a `failures.csv` `doc_drift` row (fires OBS-6's 2nd-occurrence rule).
- [ ] **Step 4: Write** `docs/superpowers/gates/doc_drift.md` — proposed gate `pnpm docs:lint` (the `stale_reference` detector in the fast gate, failing on any NEW stale path/script/envvar/route in a non-exempt doc). Note: not enabled until the human approves AND the baseline is clean.
- [ ] **Step 5: Implement** `docs-lint.ts` (reuse `stale_reference` detector; exit non-zero on any finding) — provided but NOT wired into CI/gate yet.
- [ ] **Step 6: Commit** `[OBS-10] add docs-apply review protocol`.

---

## Task 11 (OBS-LIVE): Live proofs + DoD + cron registration

Not a code commit — the live executions the DoD requires (your "all live proofs" + "register real cron" choices). Run after Tasks 1–10 land.

- [ ] **Step 1: Sunday sweep, first run** — `pnpm docs:audit --full` then `/docs-audit`: opens a real `docs-audit/YYYY-WW` PR, one commit per finding + a findings file. Confirm the Arcadia README findings appear.
- [ ] **Step 2: Stack proof** — make a deliberate doc edit on `main`, re-run the sweep: it stacks onto the SAME open PR with a `## Sweep <date>` comment and NO duplicate commits.
- [ ] **Step 3: Human review** — ask the human to leave ≥1 `keep`, ≥1 `apply`, ≥1 `edit:` comment on the PR.
- [ ] **Step 4: `/docs-apply <pr>`** — resolution table + pause (checkpoint #6) → produces exactly the expected commits on `main` + the expected `docs-audit.csv` rows (`pr_state=merged`).
- [ ] **Step 5: `/harness-retro harness-self-monitoring`** — runs end-to-end on THIS task: records the row, prints the doc-drift warning table, produces the first real `failures.csv`/`tasks.csv` rows.
- [ ] **Step 6: First weekly report** — confirm `reports/YYYY-WW.md` exists with a populated `## Documentation` section; human reads it.
- [ ] **Step 7: Register cron** (your choice) — create two recurring jobs (weekly harness report; Sunday doc sweep) pointing at the two prompt files. Confirm they're scheduled.
- [ ] **Step 8: DoD sweep** — verify every command in the spec's DoD runs from a clean checkout; the registration test goes red on id removal (already shown, Task 5 Step 4).

---

## Self-review (plan vs spec)

- **Spec coverage:** OBS-1 store ✓ (T1); recorder ✓ (T2); flake/quarantine ✓ (T3); smoke + health `db` ✓ (T4); registration gate w/ placeholder-warn ✓ (T5); retro + 2nd-occurrence ✓ (T6); report + weekly cron prompt ✓ (T7); GLM disable ✓ (T8); Sunday script+detectors+skill+prompt ✓ (T9); review protocol + docs-apply + doc_drift gate ✓ (T10); all live proofs + real cron ✓ (T11). Six checkpoints all placed (T3 #3, T8 #4, T6 #5, T10/T11 #6).
- **Placeholder scan:** no "TBD/implement later"; every code step names real files, signatures, and commands. Skill/prompt deliverables specify frontmatter + the exact numbered protocol + `gh` commands (their prose IS the deliverable).
- **Type consistency:** `appendRow/readRows/hasValue` (csv.ts) used identically in T2/T4/T7/T10; `Candidate{id,type,origin,file,lines,evidence,related}` + `candidateId` consistent across T9/T10; check signature `{name,pass,detail,ms,warn?}` consistent T4; `parseReviewComments` decision enum consistent T10.
- **Non-obvious reconciliations recorded:** TS under `scripts/src/`, shell at `scripts/harness/`; extend existing `registration.test.ts`; placeholder ids warn-not-fail; `replit.md` excluded (hard rule #7); `db` health field is contract-first.
```
