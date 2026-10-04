---
name: harness-retro
description: Use at the END of every finishing-a-development-branch run to record the task's metrics, audit the permissions granted/denied, log each gate failure by cause, fire the second-occurrence gate rule, and print a doc-drift warning. Invoked as /harness-retro <task_id>. A branch is not finished until this has run.
---

# Harness retro

Run this once, at the very end of finishing a development branch, after the work is merged/committed.
It closes the measurement loop: a metrics row per task, a permissions-audit row (grants classified +
denials attributed), a failure row per gate failure, and — on the **second** occurrence of any
failure cause, or on a **risky** grant / recurring denial — a stop for human approval.

Argument: `<task_id>` — the task/branch tag (e.g. `bundle7`, `OBS-6`). Announce
"Using harness-retro to record <task_id>" and create a todo per step below.

## Cause taxonomy (finite — use exactly one per failure row)

```
flaky_test | spec_gap | registration_point | codegen_drift | merge_conflict |
deploy_config | solver_timeout | migration_order | zod_strip | doc_drift |
config_preflight | review_caught | other
```

`config_preflight` — the run failed because the environment was misconfigured, not
because the code was wrong (e.g. a missing `DATABASE_URL` failing every file at
collection). `review_caught` — a real defect that **no automated check found**,
surfaced by a human or whole-branch review; these are expected to have no gate,
and saying so is the point of the row.

**Why these two were split out of `other` (2026-10-05, approved):** the
second-occurrence rule fired on `other` with two rows that shared only the
catch-all label — a missing-`DATABASE_URL` preflight and a review-caught UI bug
have no common mechanism. The rule's contract is "this cause recurred"; a
catch-all makes it fire on a coincidence of labelling instead, which is a false
positive of the rule itself. A rule that cries wolf gets ignored, and that costs
more than two extra labels. **Keep `other` genuinely residual: if you are about
to file a second row under it, that is the signal to add a cause, not to reuse
the bucket.**

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

2. **Audit permissions (track + evaluate grants and denials).** Run:
   ```bash
   pnpm harness:permissions --task <task_id>
   ```
   This appends one row to `docs/superpowers/metrics/permissions.csv` (standing-grant counts,
   `allow_new` since the last audit, denial count in the task window, `broad`/`risky` grant counts),
   classifies every `.claude/settings.local.json` allow entry (`risky` / `broad` / `ok`), and lists
   the runtime tool denials attributed to this task from the session transcript. Both sources are
   machine-local — the baseline (`.harness/permissions/allow-baseline.json`) is gitignored scratch;
   only the committed CSV row is versioned. **Gate:** the command exits non-zero (code 3) and prints
   `PERMISSION GATE — STOP and ask the human` when it finds a **risky** grant, or a denied tool that
   recurs (its tool was the top-denied tool of a prior audit — the 2nd-occurrence rule applied to
   denials). On a gate, STOP and surface the risky-grant list / recurring denial to the human before
   continuing — do not narrow or remove a grant yourself. If it exits 0, note the row and move on.
   (Historical tasks with no transcript still record grant counts; `denials_in_window` is `0`.)

3. **Log failures.** For each gate failure that occurred on this branch, append one row to
   `docs/superpowers/metrics/failures.csv` (via `appendRow`, or a careful CSV-quoted line) with:
   `date` (today, ISO), `task_id`, `phase`, `cause` (one taxonomy value), `test_or_check`, `notes`,
   `gate_proposed` (blank if none yet), `gate_accepted` (blank). If the branch had zero gate
   failures, add no rows.

4. **Second-occurrence rule (STOP for approval).** Read `failures.csv`. For any
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

5. **Fill lagging fields.** For tasks in `tasks.csv` finished in the prior 7 days, fill
   `reverted_within_7d` (git: was `merged_sha` reverted? `git log --oneline` for a `Revert`/reset)
   and `escaped_defects` (count of later defects traced to that task, else `0` if genuinely none, or
   `unknown`).

   Two clarifications, added 2026-10-01 (`HND-G`) after both were got wrong — full rationale in
   `docs/superpowers/metrics/README.md` under "The two lagging fields":
   - `reverted_within_7d` is a **point-in-time observation at retro**, not a closed-window verdict.
     Fill it. Do not leave it `unknown` on the grounds that seven days have not elapsed — every
     retro run only ever sees in-window tasks, so that reading makes the column permanently
     unfillable. `unknown` is offered above for `escaped_defects` and deliberately not for this
     field. The one case where it IS unverifiable is a row with no `merged_sha`.
   - `escaped_defects` counts defects traced to the task **after it merged**. A defect found and
     fixed *inside* the branch is not an escape — nothing reached `main`. If it was caught by
     manual/real-browser QA rather than by a suite, that is a test-coverage finding for
     `failures.csv`, not an escaped defect.

6. **Doc-drift warning (mechanical only — NOT a PR, never blocks).** Run:
   ```bash
   pnpm docs:audit --since $(git merge-base main HEAD) --mechanical-only
   ```
   Print the resulting `stale_reference` candidates as a warning table (file, line, reference) so the
   author can fix obvious drift before merging. This writes no findings file, opens no PR, and never
   blocks the branch. If it is non-empty and the author leaves it, that is expected — the Sunday
   weekly sweep (the harness-weekly workflow) is the record of truth.

7. **Open-PR reminder.** If a docs-audit PR is open:
   ```bash
   gh pr list --label docs-audit --state open --json url,createdAt
   ```
   Print its URL and age once as a reminder. Do not process it — that is `/docs-apply`.

## Notes

- This skill records and proposes; it does not merge, enable gates, or edit `main` docs.
- The two harness rules (see `docs/superpowers/metrics/README.md`): a cause twice → a proposed gate;
  no doc reaches `main` except via a reviewed `docs-audit/*` PR processed by `/docs-apply`.
