# Cron job: weekly harness report

Scheduled prompt (run once a week, unattended). It quantifies flakiness if stale and writes the
weekly metrics report. It makes **no source edits**, runs **no documentation sweep** (that is the
separate Sunday job, `docs-audit-sunday.md`), opens **no PRs**, and asks **no questions**.

## Steps

1. Pull `main` (`git checkout main && git pull --ff-only`). If the tree is dirty or `main` can't
   fast-forward, stop (do not run on a stale/dirty checkout).

2. **Flake audit if stale.** Read the newest `audited_at` in `docs/superpowers/metrics/flake.csv`.
   If it is older than 7 days (or the file has no data rows), run:
   ```bash
   bash scripts/harness/flake-audit.sh --runs 20
   ```
   This requires the local dev servers to be up (see the script header). If they cannot be started
   in this environment, skip the audit and note it — do not fail the job.

3. **Write the report.**
   ```bash
   pnpm harness:report
   ```
   This writes `docs/superpowers/metrics/reports/YYYY-WW.md` (task medians/rates, top flaky +
   quarantine count, deploys/smoke rollup, failure causes with second-occurrence flags + gate
   status, a `## Documentation` section, and a "what changed since last week" line).

4. **Commit on a report branch and stop.**
   ```bash
   git checkout -b reports/$(<week id, e.g. 2026-37>)
   git add docs/superpowers/metrics/reports/ docs/superpowers/metrics/flake.csv
   git commit -m "chore(metrics): weekly harness report <week>"
   ```
   Do not merge, do not open a PR, do not edit any source. Stop here.

## Guardrails

- No documentation sweep, no `docs:audit`, no doc PRs — the Sunday job owns those.
- No source edits, no gate enabling, no questions.
- If any step's precondition fails (dirty tree, servers down), note it and stop rather than forcing.
