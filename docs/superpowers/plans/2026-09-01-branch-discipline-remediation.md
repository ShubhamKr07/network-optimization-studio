# Branch Discipline Remediation — Safe Execution Tasklist

**Date:** 2026-09-01  
**Status:** Ready for agent execution, with explicit approval gates  
**Scope:** Git/worktree hygiene only. Preserve application behavior and do not interrupt the active Workspace UX R1–R9 bundle.

## Objective

Protect the current work remotely, make the primary checkout safe from accidental staging, retire obsolete branch/worktree artifacts only after proving they contain no unique work, and establish a repeatable branch lifecycle for future bundles.

## Safety contract — applies to every task

- Do **not** edit application, API, solver, dataset, generated-code, infrastructure, or test files as part of this remediation.
- Do **not** rebase, reset, amend, squash, force-push, or otherwise rewrite `main` or the active feature branch.
- Do **not** rename, unlock, remove, or switch the active `worktree-scn-v0.3-phase3.1` worktree while its Claude session or implementation work is active.
- Do **not** push `main` without explicit human approval; a main push may trigger CI and Render deployment.
- Do **not** delete any worktree, local branch, remote branch, file, or directory without explicit human approval after the read-only proof steps below pass.
- Never use `rm -rf` for worktree cleanup. Use Git's worktree commands with exact, validated paths.
- Treat a dirty worktree, a `+` result from `git cherry`, an unknown branch owner, or an uncertain deploy trigger as a **stop-and-report** condition.
- Preserve all existing untracked files until they are classified. Ignoring a path is allowed after review; deleting its contents is not part of this plan.
- One remediation task = one commit using `[BD<n>] <imperative summary>`. Do not mix remediation changes into R1–R9 implementation commits.

## Current snapshot — revalidate before acting

- `main` was 12 commits ahead of the last-known `origin/main` during review.
- The active feature worktree was based directly on local `main` and contained task-scoped R1–R9 commits.
- Six old `worktree-agent-*` worktrees were clean during review.
- Six `incoming-*` branches and the matching six `worktree-agent-*` branches were patch-equivalent to changes already integrated into `main` (`git cherry main <branch>` returned only `-`).
- The primary checkout had untracked agent configuration, PDFs, tooling caches/output, and `supabase/.temp/` metadata.

This snapshot is evidence, not authorization. Repeat Task BD0 because ongoing agent work can change it at any time.

---

## Task BD0 — Read-only inventory and ownership proof

**Impact:** none. **Writes:** none.

- [ ] Record `git status --short --branch`, `git branch -vv`, `git branch -r`, and `git worktree list --porcelain` from the repository root.
- [ ] For every listed worktree, run `git -C <exact-path> status --short --branch` and record whether it is clean, dirty, locked, or active.
- [ ] For every local branch, record `git rev-list --left-right --count main...<branch>` and whether it has an upstream.
- [ ] For each cleanup-candidate branch, run `git cherry main <branch>`:
  - only `-` entries = patch-equivalent work is already on `main`;
  - any `+` entry = unique work exists; stop and preserve that branch.
- [ ] Confirm which worktree/session owns the active R1–R9 implementation. Treat its branch, path, and lock as protected.
- [ ] Inspect `.github/workflows/**` and `render.yaml` read-only to determine which pushes can trigger CI or deployment. Do not infer that a feature-branch push is deployment-safe without checking.
- [ ] Produce a short inventory report listing: protected active work, cleanup candidates, unique/unresolved branches, untracked-path classes, and network/destructive actions requiring approval.

**Stop conditions:** any dirty old worktree, any unique patch on a proposed cleanup branch, an active agent on a proposed cleanup worktree, or uncertainty about CI/Render triggers.

## Task BD1 — Protect active work remotely without deploying

**Impact:** no application behavior change. May trigger branch CI. **External write:** yes; approval required.

- [ ] Confirm the active feature branch contains the expected task commits and is not behind local `main` unexpectedly.
- [ ] Confirm its tracked working tree is clean at a task checkpoint. Untracked local runtime state may remain, but must not be staged.
- [ ] Choose a descriptive remote branch name for the current bundle, for example `workspace-ux-r1-r9`; do not rename the live local branch/worktree mid-session.
- [ ] Show the exact proposed `git push -u origin <local-branch>:<remote-branch>` command and request human approval.
- [ ] After approval, push only the feature branch. Do **not** push `main` in this task.
- [ ] Confirm the remote branch points to the expected commit and report whether branch CI started.
- [ ] If push approval is withheld, make no substitute Git mutation; report that the work remains local-only.

**Definition of done:** current implementation has a remote recovery point without merging or deploying it.

## Task BD2 — Make untracked-path handling safe

**Impact:** no runtime behavior change. **Allowed tracked edits:** `.gitignore` only.

- [ ] Classify every untracked root path with `git ls-files --others --exclude-standard` and `git check-ignore -v`.
- [ ] Add narrowly scoped repository ignore rules for reproducible local/runtime output, subject to confirming the paths are not intended source:
  - `/.pnpm-store/`
  - `/graphify-out/`
  - `/supabase/.temp/` — ignore only `.temp`, never the whole `supabase/` tree;
  - `/.superpowers/`
  - `/.claude/worktrees/`, checkpoints, mailbox, locks, and other Claude runtime state.
- [ ] Do not blanket-ignore `/.claude/`; `.claude/agents/*.md` may be intentional project configuration handled separately in BD3.
- [ ] Do not decide the PDFs automatically. Ask whether each is project documentation to relocate/version or a local reference to exclude locally.
- [ ] Verify the `.gitignore` diff contains no application rules and no pattern broad enough to hide migrations, datasets, source, tests, or generated contract output.
- [ ] Verify `git status --short` no longer exposes classified runtime output, while intentional source remains visible.
- [ ] Commit only `.gitignore` as `[BD2] ignore local tooling and runtime artifacts` after review.

**Rollback:** revert the single `.gitignore` commit. No files are deleted by this task.

## Task BD3 — Decide and version the agent operating contract

**Impact:** no shipped application change; material impact on future agent behavior. **Human decision required.**

- [ ] Review `AGENTS.md` and every `.claude/agents/*.md` file for repository-specific paths, stale model names, secrets, personal paths, or machine-only assumptions.
- [ ] Ask the human to choose one policy:
  1. **Project configuration:** commit `AGENTS.md` and the reviewed `.claude/agents/*.md` files so every checkout and agent receives the same rules.
  2. **Machine-local configuration:** keep them untracked and add exact entries to `.git/info/exclude`, not the shared `.gitignore`.
- [ ] If project configuration is chosen, commit only the governance files as `[BD3] version the agent team contract`.
- [ ] If machine-local configuration is chosen, make no repository commit and report the local exclude entries applied.
- [ ] Never combine Claude runtime directories or the 4+ GB worktree storage with the agent-definition commit.

## Task BD4 — Finish the current R1–R9 bundle without branch surgery

**Impact:** normal feature-delivery impact; follow the bundle's own plan and gates.

- [ ] Leave the active branch name and worktree path unchanged until all R1–R9 tasks and reviews finish.
- [ ] Keep one logical `[T<n>]` commit per implementation task; do not mix branch-discipline changes into those commits.
- [ ] Before integration, confirm the active branch is remotely backed up, the tracked tree is clean, and every required task/review commit is present.
- [ ] Run the repository's complete verification gate and the bundle's required Playwright/sacred checks.
- [ ] Merge the completed bundle into local `main` **once**, at the approved checkpoint. Do not repeatedly merge partial review iterations.
- [ ] Do not rewrite the 12 existing local-main commits; improve the policy going forward.
- [ ] Show the resulting main diff/log and request explicit approval before pushing `main`.
- [ ] Push `main` only when CI/deployment is intended, then verify CI and deployment health through the normal runbook.

**Stop conditions:** failing gate, unexpected main divergence, dirty active worktree, missing remote backup, or no deployment approval.

## Task BD5 — Retire obsolete worktrees and duplicate branches

**Impact:** no application behavior change. Frees local storage and reduces branch ambiguity. **Destructive local Git action:** explicit approval required.

- [ ] Begin only after BD4 is complete and no agent is using the cleanup candidates.
- [ ] Re-run BD0 for every candidate immediately before cleanup.
- [ ] For each old `worktree-agent-*` worktree, prove all of the following:
  - exact path is under `/Users/shubhamkr/network-optimization-studio/.claude/worktrees/`;
  - worktree is not the active R1–R9 worktree;
  - `git status --porcelain` is empty;
  - branch has no `+` entries from `git cherry main <branch>`;
  - no live agent/session owns it.
- [ ] Present the exact worktree paths and branch names proposed for removal and request human approval.
- [ ] After approval, remove each clean worktree using `git worktree remove <exact-path>`—never filesystem deletion.
- [ ] Re-check patch equivalence, then present the exact obsolete `worktree-agent-*` and duplicate `incoming-*` branch names proposed for deletion.
- [ ] Delete only approved local branches. If normal `git branch -d` refuses because the work was cherry-picked rather than ancestry-merged, do not escalate to `-D` without a second explicit approval that cites the `git cherry` proof.
- [ ] Run `git worktree prune --dry-run --verbose`; request approval before any non-dry-run prune.
- [ ] Keep the active R1–R9 worktree until its branch is merged, remotely recoverable, clean, unlocked, and separately approved for retirement.
- [ ] Report what was removed, approximate disk space reclaimed, and recovery options (main/remote branch and reflog where applicable).

## Task BD6 — Adopt the future branch lifecycle

**Impact:** process improvement only.

- [ ] Start every new bundle from an up-to-date, clean `main` in a new branch named for its scope, such as `feature/workspace-ux-r1-r9` or `bundle/input-map-v3`.
- [ ] Set a remote upstream at the first stable checkpoint; do not let completed task commits exist only on one machine.
- [ ] Keep draft specs, review comments, and implementation commits on the bundle branch until approval. Keep `main` releasable.
- [ ] Use one task-scoped commit per planned task with the repository's `[<task-id>]` format.
- [ ] Never schedule two agents to edit the same file in parallel. Create an explicit integration/hub task for shared files.
- [ ] Run the proportional gate at task checkpoints and the full gate before integration.
- [ ] Merge once per approved bundle. Do not force-push shared branches or rewrite published mainline history.
- [ ] After merge and remote verification, remove the feature worktree and branch promptly using the BD5 proof/approval protocol.
- [ ] Optionally propose remote branch protection/required CI as a separate human-approved infrastructure task; do not change GitHub settings in this remediation.

## Final verification checklist

- [ ] No remediation commit changes application, API, solver, dataset, generated code, infrastructure, or tests.
- [ ] All unique commits are reachable from `main` or an approved remote feature branch.
- [ ] The active bundle was never rebased, reset, renamed, unlocked, or removed mid-development.
- [ ] `main` was pushed only at an intentional CI/deployment checkpoint.
- [ ] Runtime/cache paths no longer pollute normal `git status` and no broad ignore rule hides real source.
- [ ] Governance files have an explicit committed-or-local policy.
- [ ] Every deleted worktree/branch passed clean-status, patch-equivalence, inactive-owner, and human-approval checks.
- [ ] Future work uses one descriptive branch per bundle, early remote backup, non-overlapping task ownership, and one approved integration merge.

## Expected application and development impact

- **Application runtime:** unchanged by BD0–BD3, BD5, and BD6.
- **Current development:** uninterrupted; the active worktree is protected until bundle completion.
- **CI/deployment:** invoked only by separately approved pushes according to the repository's actual trigger configuration.
- **Future development:** safer recovery, cleaner status, smaller worktree footprint, clearer ownership, easier review/bisect/rollback, and fewer accidental commits or same-file agent conflicts.
