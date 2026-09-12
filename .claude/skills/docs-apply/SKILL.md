---
name: docs-apply
description: Process a human-reviewed docs-audit PR. Reads per-finding review comments, prints a resolution table, pauses once for confirmation, then rewrites the branch (revert/edit per decision), applies memory changes with backup, merges the PR (no squash), and updates docs-audit.csv. Interactive only — invoked as /docs-apply <pr-number>. Never runs from cron or report-mode.
---

# docs-apply (review protocol processor)

Apply a human's per-finding review decisions to an open `docs-audit/*` PR, then merge it. This is the
ONLY path by which documentation reaches `main` (harness rule 2). Interactive only.

Terminology + resolution states are in `docs/superpowers/plans/harness-self-monitoring.md` →
"Docs-audit semantics".

## Refuse to run when
- Invoked from a cron job or in report-mode.
- The PR is not approved: with branch protection, require an approving review; without it (this repo
  has none), require a human PR comment whose first token is `approve`. If neither, stop and say so.

## Steps

1. **Read the review.** `gh pr view <pr> --json number,headRefName,url,reviewDecision` and
   `gh api repos/{owner}/{repo}/pulls/<pr>/comments` (diff-hunk comments) + `gh api
   .../issues/<pr>/comments` (findings-file / general comments) + review state. Map each comment to a
   finding:
   - a diff-hunk comment → the finding whose commit owns that hunk (match by file+line → the
     `docs-audit <finding-id>` commit).
   - a findings-file comment (or one quoting a finding id) → that finding id (memory findings, and any
     redirect).

2. **Parse each comment** with `parseReviewComments` (`scripts/src/harness/lib/reviewComments.ts`):
   first token, case-insensitive → one of `keep | apply | edit | delete | defer | dismiss | question`
   (unrecognized → `question`). Extract the argument for `edit:`/`dismiss:`.

3. **Print the resolution table** (finding id → decision → target commit/file) and **PAUSE ONCE** for
   the human to confirm (checkpoint #6). Do nothing destructive before confirmation.

4. **Rewrite the branch** (the branch is pushed and may hold several weeks of stacked sweeps with
   review comments — use `git revert`, **never rebase**):
   - `keep` / `defer` / `dismiss:<reason>` → `git revert --no-edit <finding commit>` (drops the
     change; the commit history is preserved). `dismiss` additionally records the id for 8-week
     suppression (in the findings file).
   - `apply` → leave the commit as-is.
   - `edit:<text>` → apply the human's text as a NEW commit `docs-apply edit <finding-id>`.
   - `delete` → escalate: a NEW commit that deletes the file (`docs-apply delete-file <finding-id>`).
   - `question` → post an answer in the thread; take no branch action for that finding.
   - Update the findings file lines to `- applied <sha>` / `- kept` / `- deferred` / `- dismissed:
     <reason>` / `- edited <sha>`.

5. **Memory findings** marked `apply` or `edit:` (never committed to git): copy the memory file to
   `.harness/memory-backup/YYYY-MM-DD/` (git-ignored) FIRST, then apply the line change and print the
   diff. **Never delete a memory file** — a whole-file removal is applied as reducing it to a one-line
   pointer.

6. **Merge** `gh pr merge <pr> --merge --delete-branch` (**no squash** — per-finding commits survive
   on `main` and stay individually revertable). Update the `docs-audit.csv` row: `pr_state=merged`,
   `applied=<count>`, `kept=<count>`, `resolved_at=<ISO now>`.

7. **doc_drift second-occurrence:** if any file in this PR was ALSO flagged with the SAME finding type
   in the previous merged docs-audit PR, append a `failures.csv` row with cause `doc_drift` (this fires
   the OBS-6 second-occurrence rule at the next `/harness-retro`). The expected gate is
   `pnpm docs:lint` — see `docs/superpowers/gates/doc_drift.md` (proposed, not enabled until approved
   and the baseline is clean).

## Notes
- One finding = one commit means a `keep`/`defer`/`dismiss` revert touches exactly that finding.
- Never merge without the confirmation pause (step 3).
