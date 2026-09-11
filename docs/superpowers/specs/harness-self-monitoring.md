# Spec — Harness Self-Monitoring

Status: approved decisions locked (see Phase 0 findings). Source prompt: "Make the harness
self-monitoring" (OBS-0…OBS-10). Companion: `harness-self-monitoring-findings.md` (read-only discovery).

## Goal

Make the development process measurable and self-correcting:

1. Every finished task leaves a metrics row behind.
2. Flakiness is quantified on a frozen commit and quarantined deliberately.
3. Deploys are smoke-tested against the documented silent-failure points.
4. Any failure cause that recurs becomes an automated gate, not another paragraph of docs.
5. Every Sunday the repo's `.md` files are swept for stale/redundant/conflicting text; each finding
   is one commit on a reviewable `docs-audit/*` PR the human comments on before anything merges.

## Non-goals

- No change to product behavior. Only tooling, tests, skills, prompts, and one contract-first health
  field (`db`).
- The doc audit never edits `main` on its own. `docs/superpowers/specs/**` and `plans/**` are exempt.
- No metric is ever fabricated. Underivable → `unknown`.

## Confirmed decisions (Phase 0 checkpoints 1–2)

- **Commit prefix:** `[OBS-n]` for the 10 phase commits; `docs:` for the discovery/spec/plan docs.
- **Cause taxonomy (finite, editable):** `flaky_test | spec_gap | registration_point | codegen_drift |
  merge_conflict | deploy_config | solver_timeout | migration_order | zod_strip | doc_drift | other`.
- **Docs authority order:** `CLAUDE.md` > named gates (`model-integration-precheck.md`,
  `docs/superpowers/gates/**`) > `lib/api-spec/openapi.yaml` + source > `docs/ops/**` + ADRs >
  package READMEs > root `README.md` > everything else > memory files. Overridable by code evidence,
  stated in the proposal when overridden.
- **Audit exclusion:** `node_modules/**`, `docs/superpowers/specs/**`, `docs/superpowers/plans/**`,
  `docs/superpowers/docs-audit/**`, `docs/superpowers/metrics/reports/**`, `docs/telemetry/reports/**`,
  `docs/ops/*/plans/**`, `CHANGELOG.md`, `replit.md` (hard rule #7), and any file with
  `<!-- docs-audit: ignore -->` in its first 10 lines. `<!-- docs-audit: ignore-section -->` exempts
  the following heading.
- **Registration drift:** `max_coverage`/`p_center`/`set_cover` are treated as placeholders. OBS-5
  asserts the 4 *implemented* model-ids agree across all four points; it *warns* (does not fail) on
  `VALID_MODEL_IDS` entries with no backing schema/payload/solver. Gate is green on current `main`.
- **GLM hook:** edit `~/.claude/hooks/glm_subagent_router.mjs` to early-return when `cwd` is this repo
  (user-level edit, re-confirmed at checkpoint 4; file backed up first).
- **Health `db` field:** add `db: "ok"|"down"` to `/api/healthz` payload, contract-first.
- **Execution scope:** all live proofs this session; register real cron; bake live Render URLs as
  smoke defaults.

## Path reconciliation (prompt → real repo)

| Prompt | Real |
|--------|------|
| `apps/api/src/__tests__/registration-points.test.ts` | `artifacts/api-server/src/registry/__tests__/` (extend existing `registration.test.ts` — see below) |
| `pnpm e2e:gate` / `e2e:quarantine` | new studio scripts + root passthrough; Playwright `grepInvert /@flaky/` |
| `pnpm smoke`, `harness:record`, `harness:report`, `docs:audit`, `docs:lint` | new root scripts → `scripts/harness/*` (the `scripts` workspace pkg) |
| `docs/telemetry/reports/**`, `docs/ops/*/plans/**` | kept as forward-looking excludes (dirs absent) |
| health check | `/api/healthz` |
| api base / studio base | `https://nos-api-uwf8.onrender.com` / `https://nos-studio.onrender.com` |

## Architecture — five subsystems

### 1. Metrics store (OBS-1)
`docs/superpowers/metrics/` — five append-only CSVs (`tasks`, `failures`, `flake`, `deploys`,
`docs-audit`) with fixed headers + a `README.md` stating column semantics and the two harness rules:
(a) a cause appearing twice in `failures.csv` must produce a proposed gate; (b) no doc reaches `main`
except via a reviewed `docs-audit/*` PR processed by `/docs-apply`.

### 2. Recorders + reporters (OBS-2, OBS-7)
- `scripts/harness/record-task.ts` (`pnpm harness:record`): appends a `tasks.csv` row; derives
  timestamps from ledger/git, `merged_sha` from main, `tokens=unknown` (no job token source);
  refuses duplicate `task_id` without `--force`. Vitest-covered.
- `scripts/harness/report.ts` (`pnpm harness:report`): writes
  `docs/superpowers/metrics/reports/YYYY-WW.md` with task medians/rates, flake top-5, deploy/smoke
  rollup, failure causes with second-occurrence + gate status, and a `## Documentation` section
  summarizing the last Sunday sweep + open PR.

### 3. Flake audit + quarantine lane (OBS-3)
- `scripts/harness/flake-audit.sh`: refuses a dirty tree; runs Playwright JSON reporter N×20 with
  `retries=0` forced; aggregates per-test into `flake.csv`; non-zero exit if any `0<rate<1`.
- Quarantine by `@flaky` tag: `pnpm e2e:gate` = `grepInvert /@flaky/`; `pnpm e2e:quarantine` runs only
  them. CLAUDE.md re-gating instruction updated. **We quarantine nothing unilaterally** — run once,
  present the table, stop at checkpoint 3.

### 4. Deploy smoke (OBS-4)
`scripts/deploy/smoke.ts` (`pnpm smoke --env production|preview`), from outside Render, one named
check per documented silent-failure point: `cors_preflight`, `cookie_attributes`,
`fetch_credentials`, `postgres_tls` (via new `/api/healthz` `db` field), `vite_env_baked`
(studio bundle contains the real api URL, not placeholder), `python_solver_present` (known fixture,
expected objective, 30s), `free_tier_wakeup` (warn >10s). Appends `deploys.csv`; non-zero on failure.
`docs/ops/smoke.md` documents when to run.

### 5. Documentation pipeline (OBS-9, OBS-10) — mechanical script + agent judgment + PR + apply
- **Config:** `docs/superpowers/docs-audit.config.json` (`include`/`exclude`/`memoryDir`/`authority`).
- **Script** `scripts/harness/docs-audit.ts` (`pnpm docs:audit`): `--full` (Sunday) / `--since <ref>`
  (retro) / `--mechanical-only` / `--out`. Content-derived candidate ids
  (`sha1(type+file+normalizedPassage)[:10]`) so a finding is stable across weeks. Six detectors:
  `stale_reference`, `superseded`, `redundant_passage`, `conflicting_instruction`, `orphan`,
  `memory_contradiction`. Maintains `docs/superpowers/docs-audit/inventory.json`. Never writes prose.
  Fixture-tested per detector incl. the exemption test.
- **Judgment skill** `.claude/skills/docs-audit/SKILL.md` (Sunday job or `/docs-audit`): verifies each
  candidate against code+git, drafts a concrete change, one commit per finding on `docs-audit/YYYY-WW`,
  one findings file per PR, opens/updates the labelled PR, appends a `docs-audit.csv` row, stops.
  Stacks onto an open PR (merge main in, carry over by id, no duplicate commits).
- **Apply skill** `.claude/skills/docs-apply/SKILL.md` (`/docs-apply <pr>`, interactive only):
  reads per-finding review comments (`keep|apply|edit:|delete|defer|dismiss:`), prints a resolution
  table, pauses once, rewrites the branch with `git revert` (never rebase — comments exist), applies
  memory changes with backup, merges `--merge --delete-branch`, updates `docs-audit.csv`, and fires
  the `doc_drift` second-occurrence rule when a file re-appears with the same type.

### Gates + retro glue (OBS-5, OBS-6, OBS-8)
- **OBS-5** registration-points test in the fast (api-server vitest) gate; backdate 4 `failures.csv`
  rows.
- **OBS-6** project skill `.claude/skills/harness-retro/SKILL.md` (`/harness-retro <task_id>`): records
  the task, appends a `failures.csv` row per gate failure (one taxonomy cause), drafts
  `docs/superpowers/gates/<cause>.md` and stops on a *second* occurrence, fills `reverted_within_7d`/
  `escaped_defects`, runs `docs:audit --since <merge-base> --mechanical-only` as a *warning only*, and
  reminds about an open docs-audit PR. CLAUDE.md: "A branch is not finished until `/harness-retro` ran."
- **OBS-8** edit the user-level GLM router to no-op in this repo (backed up; checkpoint 4).
- **Weekly + Sunday cron:** author `docs/superpowers/prompts/jobs/harness-weekly.md` and
  `docs/superpowers/prompts/jobs/docs-audit-sunday.md`, **and** register real recurring jobs.

## Data contracts (CSV headers)

```
tasks.csv:      task_id,branch,started_at,finished_at,dispatch_cycles,first_gate_pass,cherrypick_conflict,e2e_runs_to_green,wallclock_min,tokens,merged_sha,reverted_within_7d,escaped_defects
failures.csv:   date,task_id,phase,cause,test_or_check,notes,gate_proposed,gate_accepted
flake.csv:      audited_at,sha,test_file,test_title,runs,failures,flake_rate,quarantined
deploys.csv:    deployed_at,service,sha,smoke_pass,failed_checks,incident,notes
docs-audit.csv: audited_at,run_id,files_scanned,stale,redundant,conflicting,orphan,memory_findings,new,carried_over,pr_url,pr_state,applied,kept,resolved_at
```

## Module boundaries (each independently testable)

- CSV I/O: one shared `scripts/harness/lib/csv.ts` (append + duplicate guard + header assert). Every
  recorder depends on it; nothing else does.
- Git/ledger derivation: `scripts/harness/lib/derive.ts` (timestamps, merged_sha, task groups).
- Detectors: pure functions `scripts/harness/lib/detectors/*.ts` taking inventory records → candidates;
  no filesystem writes; fixture-tested in isolation.
- Smoke checks: one named async check fn each in `scripts/deploy/checks/*.ts`; the runner composes
  them; each returns `{name, pass, detail, ms}`.
- Skills are orchestration only — they call the scripts and `gh`, hold no detection logic.

## Testing strategy

- Vitest for recorder (fixture append + duplicate rejection), detectors (planted fixture per type +
  clean-fixture-zero + exemption), docs-apply comment parsing (one payload per form + unrecognized).
- `flake-audit.sh` self-validates dirty-tree refusal.
- Registration-points test demonstrated red by removing one implemented id, then reverted.
- Live proofs (your scope): 20× flake audit, production smoke, a real docs-audit PR stacked twice +
  `/docs-apply`, `/harness-retro` on this very task, first weekly report.

## Review-driven refinements (plan review 2026-09-11)

- **Three control surfaces stay separate, never conflated in one commit:** repo edits (`[OBS-n]`),
  user-level edits (`~/.claude/**`, out-of-repo, checkpoint #4, backed up, never repo-committed),
  GitHub/PR edits (`docs-audit/*` via `gh`, merged only by `/docs-apply`). OBS-8 is split into a
  repo-documentation commit (Surface A) and a distinct out-of-repo hook edit (Surface B).
- **The CSV store layers on `.superpowers/sdd/`, not replaces it** — sdd stays the base task-record
  system; the recorder derives from it + git.
- **Render URLs are operational defaults, not canonical state** — smoke resolves flags → env
  (`NOS_API_BASE`/`NOS_STUDIO_BASE`) → live fallback; URLs documented in `docs/ops/smoke.md`.
- **Docs-audit terms are fixed** (candidate / finding / warning / dismissed / carried-over /
  resolution states / merge policy) — see the plan's "Docs-audit semantics" block; every skill and
  script uses them verbatim. Merge policy: nothing reaches `main` except a reviewed PR merged by
  `/docs-apply` with `--merge --delete-branch` (no squash).

## Risks

- Playwright flake audit needs local dev servers (api + studio via the `API_PROXY_TARGET` dev proxy)
  and real CBC; the run is long. Excludes `labs.spec.ts` (dead) and seeds solver results where a spec
  only needs a result to exist.
- Editing the user-level GLM router is outside the repo — backed up, re-confirmed at checkpoint 4.
- `gh` account is `ShubhamKr07`; PR commits carry the Claude co-author trailer.
```
