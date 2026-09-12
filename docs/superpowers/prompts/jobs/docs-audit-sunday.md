# Cron job: Sunday documentation sweep

Scheduled prompt (run once a week, Sunday night, unattended). It runs the full mechanical audit then
the judgment pass, producing/updating a reviewable `docs-audit/*` PR. It **never edits `main`** and
**never merges** — the human reviews the PR and `/docs-apply` processes it later.

## Steps

1. `git checkout main && git pull --ff-only`. If the working tree is dirty or `main` cannot
   fast-forward, write a one-line `docs-audit.csv` row with `pr_state=skipped_dirty_tree` and **stop**
   (do not sweep a stale checkout).

2. `pnpm docs:audit --full` — produces `.harness/docs-audit/candidates.json` and refreshes
   `docs/superpowers/docs-audit/inventory.json`.

3. Invoke the `docs-audit` skill (`/docs-audit`) — it verifies each candidate, drafts fixes, creates
   or stacks onto the open `docs-audit/YYYY-WW` PR (one commit per finding), writes the findings file,
   opens/updates the labelled PR, appends a `docs-audit.csv` row (`pr_state=open`), and stops.

4. Stop. Do not merge, do not approve, do not answer review comments (that is `/docs-apply`, run
   interactively by a human later).

## Guardrails
- Report-mode: no questions, no edits to `main`, read-only credentials for inspection.
- Exactly one open `docs-audit/*` PR at a time — a second sweep stacks onto it (carry-over by finding
  id, no duplicate commits).
- `docs/superpowers/specs/**` and `docs/superpowers/plans/**` are historical and never audited.
