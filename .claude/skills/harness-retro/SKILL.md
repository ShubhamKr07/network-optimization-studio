---
name: harness-retro
description: Use at the END of every finishing-a-development-branch run to record the task's metrics, log each gate failure by cause, fire the second-occurrence gate rule, and print a doc-drift warning. Invoked as /harness-retro <task_id>. A branch is not finished until this has run.
---

# Harness retro

Run this once, at the very end of finishing a development branch, after the work is merged/committed.
It closes the measurement loop: a metrics row per task, a failure row per gate failure, and — on the
**second** occurrence of any failure cause — a drafted gate that stops for human approval.

Argument: `<task_id>` — the task/branch tag (e.g. `bundle7`, `OBS-6`). Announce
"Using harness-retro to record <task_id>" and create a todo per step below.

## Cause taxonomy (finite — use exactly one per failure row)

```
flaky_test | spec_gap | registration_point | codegen_drift | merge_conflict |
deploy_config | solver_timeout | migration_order | zod_strip | doc_drift | other
```

## Steps

1. **Record the task.** Run:
   ```bash
   pnpm harness:record --task <task_id> --branch <branch> \
     --cycles <n|omit> --first-gate <yes|no|omit> --conflict <yes|no|omit> --e2e-runs <n|omit>
   ```
   `started_at`/`finished_at`/`merged_sha` derive from `.superpowers/sdd/` + git automatically;
   `tokens` is always `unknown`. Ask the human only for values that cannot be derived
   (`dispatch_cycles`, `first_gate_pass`, `cherrypick_conflict`, `e2e_runs_to_green`) — omit a flag to
   record `unknown` rather than guessing. Never fabricate a metric.

2. **Log failures.** For each gate failure that occurred on this branch, append one row to
   `docs/superpowers/metrics/failures.csv` (via `appendRow`, or a careful CSV-quoted line) with:
   `date` (today, ISO), `task_id`, `phase`, `cause` (one taxonomy value), `test_or_check`, `notes`,
   `gate_proposed` (blank if none yet), `gate_accepted` (blank). If the branch had zero gate
   failures, add no rows.

3. **Second-occurrence rule (STOP for approval — checkpoint #5).** Read `failures.csv`. For any
   `cause` that now appears **twice or more with an empty `gate_proposed`**, that class has recurred
   without a gate. Draft `docs/superpowers/gates/<cause>.md`:
   ```markdown
   # Gate proposal: <cause>

   **Symptom:** <what breaks, one line>
   **Occurrences:** <date> <task> — <note>; <date> <task> — <note>
   **Proposed automated gate:** <the exact test/check/CI step that would catch it>
   **How to enable:** <command / file to add it to>
   **Status:** proposed — awaiting human approval (not enabled)
   ```
   Then **STOP and ask the human** to approve the gate before enabling it. Do not enable a gate
   yourself. (Existing rows whose `gate_proposed` is already filled do not re-trigger this.)

4. **Fill lagging fields.** For tasks in `tasks.csv` finished in the prior 7 days, fill
   `reverted_within_7d` (git: was `merged_sha` reverted? `git log --oneline` for a `Revert`/reset)
   and `escaped_defects` (count of later defects traced to that task, else `0` if genuinely none, or
   `unknown`).

5. **Doc-drift warning (mechanical only — NOT a PR, never blocks).** Run:
   ```bash
   pnpm docs:audit --since $(git merge-base main HEAD) --mechanical-only
   ```
   Print the resulting `stale_reference` candidates as a warning table (file, line, reference) so the
   author can fix obvious drift before merging. This writes no findings file, opens no PR, and never
   blocks the branch. If it is non-empty and the author leaves it, that is expected — the Sunday
   weekly sweep (the harness-weekly workflow) is the record of truth.

6. **Open-PR reminder.** If a docs-audit PR is open:
   ```bash
   gh pr list --label docs-audit --state open --json url,createdAt
   ```
   Print its URL and age once as a reminder. Do not process it — that is `/docs-apply`.

## Notes

- This skill records and proposes; it does not merge, enable gates, or edit `main` docs.
- The two harness rules (see `docs/superpowers/metrics/README.md`): a cause twice → a proposed gate;
  no doc reaches `main` except via a reviewed `docs-audit/*` PR processed by `/docs-apply`.
