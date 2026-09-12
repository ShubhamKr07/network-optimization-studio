---
name: docs-audit
description: The judgment pass of the Sunday documentation sweep. Verifies mechanical docs-audit candidates against code + git, drafts a concrete fix per real finding, and packages them as one-commit-per-finding on a reviewable docs-audit/* PR. Invoked by the Sunday cron job or on demand as /docs-audit. Report-mode: no questions, never edits main, read-only outside the PR branch.
---

# docs-audit (judgment + PR)

Turn the mechanical candidates from `pnpm docs:audit --full` into verified findings on a reviewable
`docs-audit/*` pull request. **Report-mode rules:** ask no questions, make no edits to `main`, use
only read-only credentials for inspection. Never merge or self-approve — that is `/docs-apply`.

Terminology (`candidate` / `finding` / `warning` / `carried_over` / `resolved`) and the merge policy
are defined in `docs/superpowers/plans/harness-self-monitoring.md` → "Docs-audit semantics". Use them
exactly.

## Precondition
`.harness/docs-audit/candidates.json` exists (the Sunday job runs `pnpm docs:audit --full` first). If
missing, run it yourself: `pnpm docs:audit --full`.

## Protocol

For **every** candidate in the JSON:

1. **Verify against code + git history, not against other docs.** A "missing" path may have moved
   (`git log --follow -- <path>`); a symbol may have been renamed (`git log -S<symbol>`). A false
   positive is dropped and listed under `## Dismissed` with a one-line reason. Read prior findings
   files under `docs/superpowers/docs-audit/*.md` and **suppress any candidate id dismissed within the
   last 8 weeks**.

2. **Quote the exact passage (line range) and choose ONE action:** `remove` (delete the passage) ·
   `replace` (with drafted text) · `merge-into <file>#<heading>` (supply the drafted merged text) ·
   `delete-file` · `update-memory` (drafted replacement line). The draft must be COMPLETE text, not a
   description of text.

3. **State confidence** (`high|medium|low`) and **the single fact the proposal rests on**, so a human
   can verify it in under a minute.

4. **Find or create the PR branch.**
   - `gh pr list --label docs-audit --state open --json number,headRefName,url`.
   - None open → create `docs-audit/YYYY-WW` from `main` (YYYY-WW = current ISO week).
   - One open → check it out and `git merge main` into it (**never rebase** a branch that already has
     review comments). Treat every finding id already in its findings file as **carried_over**:
     unchanged → no new commit (list under `## Carried over` with age in weeks); passage changed →
     a replacement commit + a note; no longer detected → mark `- resolved upstream`.

5. **One commit per NEW repo finding** (any confidence). Subject: `docs-audit <finding-id> <type>
   <action> <file>`. Body: the evidence + the single fact it rests on. **One finding = one commit =
   one hunk** so a review comment maps to exactly one finding and a single commit can be dropped
   without touching the rest. **Memory findings are NOT committed** (they are outside git) — they
   appear only in the findings file with drafted text.

6. **Findings file** `docs/superpowers/docs-audit/YYYY-WW.md` (named for the week the PR opened): as
   the first commit when the PR is new, and as an appended `## Sweep YYYY-MM-DD` section on every later
   sweep. Contents: a summary line; one block per new finding (`id · type · origin · confidence ·
   action · commit sha or "memory"` + where / evidence / passage / proposal / rests-on); `## Carried
   over` (each finding's age in weeks); `## Dismissed`.

7. **Open or update the PR.**
   - New: `gh pr create --base main --head docs-audit/YYYY-WW --label docs-audit --title "docs-audit:
     week YYYY-WW (<n> findings)" --body-file <summary>`. The body is a table `finding id → type →
     confidence → file → commit link` plus the **Review protocol** below verbatim.
   - Existing: push, retitle with the new total, and post ONE PR comment: sweep date, new findings
     with commit links, carried-over count, oldest unreviewed finding's age.
   - If `gh` is unavailable: push the branch if a remote exists, print the compare URL, and note the
     fallback (`pr_state=no_gh`) in `docs-audit.csv`.

8. **Append a `docs-audit.csv` row** (`pr_state=open`) with counts, `pr_url`, and stop. Do NOT merge,
   do NOT self-approve, do NOT resolve comments.

## Review protocol (include verbatim in the PR body)

> Review this PR by leaving **one comment per finding** — on the diff hunk (repo findings) or on the
> finding's block in the findings file (memory findings / redirects). Recognized first-token forms
> (case-insensitive):
> - `keep` — do not change this passage (finding is wrong / text is wanted); the commit is dropped.
> - `apply` — accept as drafted (default for repo commits when the PR is approved with no comment on
>   that hunk; **required explicitly** for memory findings).
> - `edit: <text>` — replace the drafted change with your text.
> - `delete` — escalate a `replace`/`remove` to `delete-file`.
> - `defer` — leave the finding open; the commit is dropped and it carries to the next sweep.
> - `dismiss: <reason>` — drop and suppress for 8 weeks.
> Anything else is treated as a question; `/docs-apply` answers it in the thread and does not act on
> that finding. Approve the PR (or comment `approve`) then run `/docs-apply <pr-number>` to process.

## docs-audit.csv columns
`audited_at,run_id,files_scanned,stale,redundant,conflicting,orphan,memory_findings,new,carried_over,pr_url,pr_state,applied,kept,resolved_at`
(`applied`/`kept`/`resolved_at` stay empty while `pr_state=open`.)
