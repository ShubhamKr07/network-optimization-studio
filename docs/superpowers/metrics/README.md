# Harness metrics store

Append-only CSVs recording how the development process actually runs. Written by the harness
scripts/skills (`pnpm harness:record`, `flake-audit.sh`, `pnpm smoke`, `/harness-retro`, the
`docs-audit`/`docs-apply` skills) and summarized by `pnpm harness:report`.

This store **layers on** the existing `.superpowers/sdd/` ledger — it does not replace it.
`.superpowers/sdd/` stays the canonical task-record system; these CSVs *derive* from it (+ git),
adding a measurable, queryable layer. Recorders read sdd briefs/reports as a source, never rewrite them.

## The two harness rules

1. **A cause that appears twice in `failures.csv` must produce a proposed gate, never only
   documentation.** The second occurrence of any `cause` with no `gate_proposed` obliges
   `/harness-retro` to draft `docs/superpowers/gates/<cause>.md` and stop for human approval.
2. **No documentation reaches `main` except through a reviewed `docs-audit/*` PR processed by
   `/docs-apply`.** The Sunday sweep and `docs:audit` never touch `main`; nothing merges without a
   per-finding human review.

## Never fabricate a metric

Any value that cannot be derived is the literal string `unknown` — never an estimate.

## Files & column semantics

### `tasks.csv` — one row per finished task
| column | meaning |
|--------|---------|
| `task_id` | task/branch tag (e.g. `bundle6.1`, `OBS-2`). Unique; recorder refuses duplicates without `--force`. |
| `branch` | branch name if recoverable, else the task tag, else `unknown`. |
| `started_at` | ISO-8601. Derived from `.superpowers/sdd/task-<id>-brief.md` mtime or first commit of the tag group, else `unknown`. |
| `finished_at` | ISO-8601. From the report mtime or last commit of the tag group, else `unknown`. |
| `dispatch_cycles` | number of agent dispatch/fix cycles. Human-supplied at retro; `unknown` for historical. |
| `first_gate_pass` | `yes` \| `no` \| `unknown` — did the verification gate pass on the first run. |
| `cherrypick_conflict` | `yes` \| `no` \| `unknown` — did cherry-picking onto main conflict. |
| `e2e_runs_to_green` | integer count of e2e runs until green, or `unknown`. |
| `wallclock_min` | finished−started in minutes if both known, else `unknown`. |
| `tokens` | **always `unknown`** — `~/.claude/jobs/*` records no token usage (Phase 0). |
| `merged_sha` | the task's last commit sha on `main`, or `unknown`. |
| `reverted_within_7d` | `yes` \| `no` \| `unknown` — was `merged_sha` reverted within 7 days (filled by retro). |
| `escaped_defects` | integer defects traced back to this task later, or `unknown`. |

### `failures.csv` — one row per gate failure
| column | meaning |
|--------|---------|
| `date` | ISO date of the failure. |
| `task_id` | task the failure occurred in, or `historical`. |
| `phase` | coarse phase (`build`, `integration`, `deploy`, `review`, …). |
| `cause` | one of the finite taxonomy: `flaky_test \| spec_gap \| registration_point \| codegen_drift \| merge_conflict \| deploy_config \| solver_timeout \| migration_order \| zod_strip \| doc_drift \| other`. |
| `test_or_check` | the failing test/check name. |
| `notes` | free text. |
| `gate_proposed` | the gate proposed to prevent recurrence, or empty. |
| `gate_accepted` | `yes` \| `no` \| empty — human decision on the proposed gate. |

### `flake.csv` — one row per test per audit
| column | meaning |
|--------|---------|
| `audited_at` | ISO datetime of the audit. |
| `sha` | frozen commit the audit ran on. |
| `test_file` | spec file. |
| `test_title` | test title. |
| `runs` | total runs (default 20). |
| `failures` | failing runs. |
| `flake_rate` | `failures/runs`. `0<rate<1` = flaky; `rate=1` = broken. |
| `quarantined` | `yes` \| `no` — is it `@flaky`-tagged (excluded from `pnpm e2e:gate`). |

### `deploys.csv` — one row per service per smoke run
| column | meaning |
|--------|---------|
| `deployed_at` | ISO datetime the smoke ran. |
| `service` | `nos-api` \| `nos-studio`. |
| `sha` | deployed commit if known, else `unknown`. |
| `smoke_pass` | `yes` \| `no`. |
| `failed_checks` | semicolon list of failed check names, or empty. |
| `incident` | incident ref if a failure caused one, or empty. |
| `notes` | free text (e.g. `free_tier_wakeup warn 12s`). |

### `docs-audit.csv` — one row per sweep
| column | meaning |
|--------|---------|
| `audited_at` | ISO datetime of the sweep. |
| `run_id` | sweep run id. |
| `files_scanned` | count of in-scope docs scanned. |
| `stale` / `redundant` / `conflicting` / `orphan` | finding counts by type. |
| `memory_findings` | count of `memory_contradiction` findings. |
| `new` | findings new this sweep. |
| `carried_over` | findings carried over from a prior sweep on the open PR. |
| `pr_url` | the `docs-audit/*` PR url, or empty. |
| `pr_state` | `open` \| `merged` \| `skipped_dirty_tree` \| `no_gh`. |
| `applied` / `kept` | counts resolved by `/docs-apply` at merge (`applied`=change kept, `kept`=reverted). |
| `resolved_at` | ISO datetime `/docs-apply` merged the PR, or empty while open. |

## Finding states (docs pipeline)

`candidate` (unverified mechanical output) → `finding` (agent-verified, one commit) → `resolved`
(`applied`/`kept`/`deferred`/`dismissed`/`edited` via `/docs-apply`). `warning` = retro
`--mechanical-only` output, informational, never blocks. `carried_over` = an unchanged finding on
the open PR. See the plan's "Docs-audit semantics" block for the authoritative definitions.
