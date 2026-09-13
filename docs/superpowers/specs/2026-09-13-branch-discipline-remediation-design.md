# Spec — Branch Discipline Remediation (execution design)

Date: 2026-09-13. Source: the reviewed tasklist `docs/superpowers/plans/2026-09-01-branch-discipline-remediation.md` (two review rounds + rollback plan, all findings accepted). This spec turns that tasklist into a scoped, decision-locked design; the implementation plan follows separately.

## Goal

Bring the repo's git/worktree hygiene under control **without touching application behavior**: refresh the inventory, make untracked-path handling correct, version the agent governance files, retire the accumulated stale branches, and codify a standing branch lifecycle so the churn stops recurring.

## Non-goals

- No edits to application/API/solver/dataset/generated/infra/test code.
- No history rewrite of `main` or any shared branch (no reset/rebase/amend/force-push).
- No GitHub server-side settings changes (branch protection is a separate, later, approved task).
- No worktree removal this round (branches only — see BD5).

## Locked decisions (2026-09-13)

1. **Execution mechanism:** all remediation runs on a `chore/branch-discipline` feature branch — one `[BD<n>]` commit per task, one PR, single merge to `main`. This dogfoods BD6 (the plan's own rule) instead of committing straight to `main`.
2. **BD3 policy:** **commit as project config** — version `AGENTS.md`, `.claude/agents/*.md`, and the branch-discipline plan doc, *after* reviewing each for secrets / personal paths / machine-only assumptions. (Not machine-local.)
3. **BD5 scope:** **branches only** — delete the 29 stale local branches (6 `incoming-*` + 23 `worktree-agent-*`) with per-branch proof; **do not** remove any worktree this round. Both non-`main` worktrees (`jade-ch9`, `scn-v0.3-phase3.1`) and their branches are protected.
4. **Obsolete tasks dropped:** BD1 (protect active R1–R9 remotely) and BD4 (finish R1–R9) — that bundle shipped; excluded from execution.

## Reality this is built against (ephemeral — re-probe at execution)

The repo state churns live (three 2026-09-13 probes disagreed). At last probe: `main` 1 ahead of `origin` (an unpushed user docs commit); **3 worktrees** (`main`, `jade-ch9`, `scn-v0.3-phase3.1`); **29 stale branches**; untracked `AGENTS.md` + `.claude/agents/` + the plan doc; a dirty `CLAUDE.md` (a parallel workstream's WIP). **BD0 at execution is the sole source of truth** — this snapshot is evidence only.

## Scope — tasks

| task | what | destructive? | gate |
|------|------|-------------|------|
| **BD0** | Fresh read-only inventory + ownership/patch-equivalence proof. Prerequisite for BD5. | no | — |
| **BD2** | `.gitignore` reconcile: **remove** the over-broad `*.pdf`; keep `.pnpm-store/`, `graphify-out/`; **add** `supabase/.temp/`, `.claude/worktrees/`. The two Redesign PDFs → `.git/info/exclude` (machine-local), not a repo rule. `.superpowers/` is already self-ignored — do not add it. | no (`.gitignore` only) | review diff |
| **BD3** | Review then **commit** `AGENTS.md`, `.claude/agents/*.md`, and `docs/superpowers/plans/2026-09-01-branch-discipline-remediation.md` as project config. | no (adds files) | secret/personal-path review |
| **BD5** | Delete the 29 stale branches. **Content proof per branch:** `git cherry main <b>` all-`-` **AND** `git rev-list --merges main..<b>` empty; branch checked out in no worktree; no live owner. `-d` first; `-D` only with a second approval citing the proof. | **yes (local branch delete)** | per-batch human approval |
| **BD6** | Add a standing **"Branch discipline"** section to `CLAUDE.md` (feature-branch-per-bundle, early remote upstream, one approved merge, no direct-to-`main`, one commit/task). Server-side protection explicitly deferred. | no (doc) | review |

## Safety contract (unchanged, applies to every task)

No app/API/solver/dataset/generated/infra/test edits. No rewrite/reset/rebase/amend/force-push of `main` or shared branches. No `rm -rf` — git branch/worktree commands with exact validated refs only. No branch/worktree/file deletion without explicit human approval after read-only proofs pass. Treat any `+` from `git cherry`, non-empty `git rev-list --merges`, dirty/owned worktree, or uncertain deploy trigger as **stop-and-report**. Preserve untracked files until classified.

## Module boundaries (each independently reviewable/revertable)

- BD2 touches only `.gitignore` (+ local `.git/info/exclude`, uncommitted).
- BD3 adds only governance files (no code).
- BD5 deletes only refs (no working-tree/app impact); recovery = recorded sha / reflog (content already on `main` by proof).
- BD6 touches only `CLAUDE.md`.
None depend on another except **BD5 requires a fresh BD0** (its "before" record is the rollback key).

## Rollback

Per the source doc's Rollback plan: one revertable commit per task; no history rewrite so `git reflog` is the safety net. BD2/BD3/BD6 → `git revert <sha>`. BD5 → recreate a deleted branch from its BD0-recorded sha (or reflog); content is already on `main` (proven), so no work is lost. A bad `main` state is undone with a forward `git revert`, never a reset/force-push.

## Testing / verification

This is git-ops, not code — "tests" are proofs + gate checks:
- BD0: inventory report produced; every cleanup candidate has a recorded sha + patch-equivalence + merge-commit result.
- BD2: `.gitignore` diff contains no app rule + no pattern hiding source/migrations/datasets/generated; `git status` no longer shows the runtime paths; `git check-ignore -v` confirms each new rule.
- BD3: `git ls-files` shows the governance files after commit; a secret/personal-path scan of each passed.
- BD5: each deleted branch's proof recorded; post-delete `git branch` shows them gone and no worktree/tracked-file changed.
- BD6: the CLAUDE.md section present; `pnpm run typecheck` unaffected (docs-only).
- Whole branch: `git status` clean of the classified runtime paths; app gate (typecheck) unchanged since nothing app-side moved.

## Risks

- **Live churn** — worktrees/branches/`main` move mid-run (proven 3× today). Mitigation: BD0 immediately before BD5; abort if the recorded sha no longer matches.
- **Parallel workstreams** (`jade-ch9`, Sentry/PostHog) commit to `main` + hold worktrees. Mitigation: protect their worktrees/branches by name from a fresh BD0; never push their unpushed commits as a side effect.
- **`-D` escalation** — a cherry-picked (not ancestry-merged) branch makes `-d` refuse; requires a second explicit approval citing the merge-commit proof, never a blind `-D`.
