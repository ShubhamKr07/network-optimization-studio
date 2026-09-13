# Spec — Branch Discipline Remediation (execution design)

Date: 2026-09-13. Source: the reviewed tasklist `docs/superpowers/plans/2026-09-01-branch-discipline-remediation.md` (two review rounds + rollback plan, all findings accepted). This spec turns that tasklist into a scoped, decision-locked design; the implementation plan follows separately.

## Codex review — 2026-09-13

**Verdict:** the safety model is substantially improved, but the spec and implementation plan are not ready to execute until the branch base, stop-condition scope, and BD3 contract are reconciled.

### P1 — Base remediation on `origin/main`, not the ahead local `main`

The implementation plan creates `chore/branch-discipline` from local `main` and later pushes it. At review time, local `main` is four commits ahead of `origin/main`, including an unrelated Chapter 9 commit. That topology would publish and merge another workstream's unpushed history as part of the remediation, contrary to the spec's own risk mitigation.

Require a fresh fetch and create the remediation branch from the verified `origin/main` commit. Then transfer only explicitly approved remediation documents/changes onto it. Record the base SHA and verify the proposed PR commit/path list excludes unrelated work before pushing.

### P1 — Scope dirty/owned-worktree stop conditions to deletion candidates

The safety contract currently treats any dirty or owned worktree as stop-and-report, while the design expressly expects protected, owned parallel worktrees and a dirty primary checkout. Taken literally, execution must stop before BD0 can be completed.

Clarify that a dirty or owned **cleanup candidate** blocks deletion. A protected worktree that is dirty or owned must be recorded and left untouched, but does not block unrelated non-destructive remediation work.

### P1 — Reconcile the locked BD3 decision with the plan's ancestry assumption

The locked decision says BD3 versions `AGENTS.md`, `.claude/agents/*.md`, and the 2026-09-01 branch-discipline plan. The implementation plan omits that plan document because it is already committed on local `main`. Once execution is correctly based on `origin/main`, that local-main ancestry is unavailable unless deliberately transferred—and importing the full ancestry would also import unrelated work.

Either retain the locked decision and include the source plan explicitly in BD3, or revise the decision and specify exactly which preparatory documentation commits are approved for the remediation PR. The PR must not acquire those files by inheriting an ahead local `main` implicitly.

### Response to Codex review — 2026-09-13 (all three P1 accepted; verified)

Re-probe confirmed local `main` is **5 ahead** of `origin/main` (worse than the review's "4" — a second ch9 commit landed): 2 Chapter-9 commits (`1740be4`, `938abfe`) + 3 remediation-doc commits (`24dec5e`, `79be196`, `b759e30`). All three findings actioned:

- **P1 base-on-origin — accepted.** Locked decision #1 now mandates basing the branch on fetched `origin/main` and transferring only the 3 approved doc commits by cherry-pick, with a commit+path allowlist verified pre-push. (Plan Task 0 rewritten accordingly.)
- **P1 stop-condition scope — accepted.** Safety contract now scopes dirty/owned stop-and-report to *cleanup candidates*; protected worktrees + the dirty primary checkout are recorded-and-left, not aborts.
- **P1 BD3 vs ancestry — accepted.** The 2026-09-01 plan doc is transferred onto the origin-based branch by explicit cherry-pick of `24dec5e` (BD3 input), never by inheriting ahead-local ancestry (which would drag the ch9 commits).

---

## Goal

Bring the repo's git/worktree hygiene under control **without touching application behavior**: refresh the inventory, make untracked-path handling correct, version the agent governance files, retire the accumulated stale branches, and codify a standing branch lifecycle so the churn stops recurring.

## Non-goals

- No edits to application/API/solver/dataset/generated/infra/test code.
- No history rewrite of `main` or any shared branch (no reset/rebase/amend/force-push).
- No GitHub server-side settings changes (branch protection is a separate, later, approved task).
- No worktree removal this round (branches only — see BD5).

## Locked decisions (2026-09-13)

1. **Execution mechanism:** all remediation runs on a `chore/branch-discipline` feature branch — one `[BD<n>]` commit per task, one PR, single merge to `main`. This dogfoods BD6 instead of committing straight to `main`. **The branch is based on fetched `origin/main`, NOT the ahead local `main`** (Codex P1): local `main` carries 2 unrelated Chapter-9 commits interleaved with the 3 remediation-doc commits, so only the approved doc commits (`24dec5e`/`79be196`/`b759e30`) are transferred by explicit cherry-pick, and a commit+path allowlist is verified before push — the ch9 work is never published by this PR.
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

No app/API/solver/dataset/generated/infra/test edits. No rewrite/reset/rebase/amend/force-push of `main` or shared branches. No `rm -rf` — git branch/worktree commands with exact validated refs only. No branch/worktree/file deletion without explicit human approval after read-only proofs pass. Treat any `+` from `git cherry`, non-empty `git rev-list --merges`, or uncertain deploy trigger as **stop-and-report**. Preserve untracked files until classified. **Stop-condition scope (Codex P1):** a dirty/owned worktree blocks deletion *only for a cleanup candidate*; a protected worktree (`jade-ch9`, `scn-v0.3-phase3.1`) or the dirty primary checkout being dirty/owned is expected — record and leave it, it does not abort the non-destructive tasks.

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
