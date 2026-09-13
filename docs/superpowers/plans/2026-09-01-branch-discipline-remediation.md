# Branch Discipline Remediation — Safe Execution Tasklist

**Date:** 2026-09-01  
**Status:** BLOCKED pending a fresh BD0 — the repo state churns live (three separate re-probes on 2026-09-13 disagreed: main 12-ahead → 0/0 → 1-behind; 6 → 2 → 3 worktrees; SCN worktree locked → unlocked). Any hardcoded snapshot below is ephemeral evidence only; BD0-at-execution is the sole source of truth.  
**Scope:** Git/worktree hygiene only. Preserve application behavior and do not interrupt the active Workspace UX R1–R9 bundle.

---

## Review — 2026-09-13 (reviewer comments; original plan unchanged below)

**Verdict:** methodology is excellent; keep it. But the 2026-09-01 snapshot is stale and several tasks are obsolete — while the cleanup problem it targets has *grown*. Do not execute as-written; refresh BD0 first.

**Ground truth at review time (vs the snapshot in "Current snapshot"):**
- `main` == `origin/main` (0 ahead / 0 behind). HEAD is a Sentry commit → other workstreams still commit **directly to `main`** (this violates BD6, the plan's own rule — root cause still active).
- Worktrees: **2**, not six — just `main` + one **locked** `scn-v0.3-phase3.1`. The "six old worktree-agent-* worktrees" snapshot is wrong now.
- Branches: **29 stale** linger — 6 `incoming-*` + **23** `worktree-agent-*` (bundle4/5/6/6.1, Phase3.1/3.2), all long-merged. The snapshot said 6+6; the cruft grew.
- Untracked: `.claude/agents/`, `AGENTS.md`, and this plan doc itself → **BD3 is still unresolved.**

**Task-by-task currency:**
- **BD0** — ✅ still the correct first step; re-run, the numbers changed.
- **BD1** (protect active work remotely) — **OBSOLETE**: R1–R9 shipped; everything is on origin.
- **BD2** (gitignore runtime paths) — **partially done ad-hoc** on 2026-09-12 (`.pnpm-store/`, `graphify-out/`, `*.pdf` added to `.gitignore`), but **incomplete** (missing `supabase/.temp/`, `.claude/worktrees/` runtime) **and it broke this task's own rule** — BD2 says "don't auto-decide PDFs, ask per file", yet `*.pdf` was broad-ignored. Reconcile under BD2's discipline.
- **BD3** (commit vs machine-local for `AGENTS.md` + `.claude/agents/*`) — **PENDING + actionable now** (both untracked).
- **BD4** (finish R1–R9) — **OBSOLETE**.
- **BD5** (retire worktrees/branches) — **MORE relevant than ever**: re-scope to today's **29** branches (per-branch `git cherry` proof) + the single locked worktree. Note: the 23 `worktree-agent-*` are branches **without** worktrees now (worktrees already gone), so for those BD5 reduces to branch deletion with the cherry proof — no `git worktree remove` needed.
- **BD6** (branch lifecycle) — sound, and **being violated**: this harness work AND the ongoing Sentry/PostHog work both commit straight to `main`. Enforcing BD6 is the real fix.

**Specific issues:**
1. Snapshot numbers are stale (6+6 branches / 6 worktrees → 29 branches / 1 locked worktree). Doc is self-aware ("revalidate, repeat BD0") but should be refreshed if pursued.
2. BD2's `/.superpowers/` ignore is fine (it's local session state) **but** the harness `scripts/src/harness/record-task.ts` **reads `.superpowers/sdd/` as its ledger source** — ignore-don't-delete.
3. This plan doc is untracked though it sits under the tracked `docs/superpowers/plans/` convention — decide (commit vs local) alongside BD3.

**Keep verbatim (the good parts):** the Safety contract (no rewrite/reset/force-push `main`, no `rm -rf`, `git worktree remove` only), read-only patch-equivalence proof before any delete, per-action approval gates, stop-and-report conditions, and `-D`-requires-second-approval-citing-cherry-proof. Promote this into CLAUDE.md as standing branch discipline.

**Recommendation:** refresh BD0; mark BD1/BD4 obsolete; do BD3 now; reconcile BD2 (`supabase/.temp/`, revisit `*.pdf`); re-scope BD5 to the 29 current branches; enforce BD6 (stop direct-to-main).

---

## Codex review — 2026-09-13

**Verdict:** do not execute the destructive portions of this plan until the findings below are incorporated. The overall approval discipline is sound, but the current inventory is already stale and two of the deletion proofs are incomplete or impossible to apply as written.

### P1 — Rebuild the protected-worktree inventory

The section labeled "revalidated" is no longer accurate. At this review point, `main` is one commit ahead of `origin/main`; Git reports three worktrees (`main`, `jade-ch9`, and `worktree-scn-v0.3-phase3.1`), not two; and `git worktree list --porcelain` reports no lock for the SCN worktree. The primary checkout is also dirty with one modified tracked file and untracked governance/plan files.

The safety contract currently protects only the old SCN worktree by name. Replace that fixed name with the complete protected set produced by a fresh BD0 run, recording each active branch and exact worktree path. Change the document from `Ready for agent execution` to blocked/pending inventory until that refresh is complete.

### P1 — Split BD5 proof by candidate type

The review says the 29 stale `incoming-*` and `worktree-agent-*` branches no longer have worktrees, but BD5 requires every branch/worktree candidate to have an exact worktree path and a clean worktree status. A branch-only candidate cannot satisfy either condition.

Define two proof paths:

1. **Branch-only candidate:** resolve the exact local ref, confirm it is not checked out in any worktree, record upstream/recovery information, run the patch-equivalence and merge-commit checks, confirm no live owner, then request deletion approval.
2. **Live-worktree candidate:** perform all branch checks plus exact-path validation and a clean `git -C <path> status --porcelain` result before requesting worktree-removal approval.

### P1 — Do not use `git cherry` as the sole content proof

`git cherry main <branch>` compares patch IDs for non-merge commits. An all-`-` result is useful evidence that ordinary commit patches are represented on `main`, but it does not prove that unique conflict-resolution content introduced by a merge commit is preserved.

Before deletion, also prove that the candidate has no merge commits outside `main` (for example, inspect `git rev-list --merges main..<branch>`). If such commits exist, stop and review their resulting trees/diffs explicitly. Keep any branch with unresolved unique merge content.

### P2 — Resolve the `.superpowers/` tracking contradiction

The response says the `.superpowers/sdd/` ledger "remains tracked," while BD2 proposes adding `/.superpowers/` to the shared `.gitignore`. In the current repository, `git ls-files .superpowers` returns no tracked files; the ledger is local and its own `.gitignore` hides its contents.

Choose and document one truthful policy: either the ledger is intentionally machine-local, ignored, and preserved without remote recovery, or selected ledger files are versioned and must be exempted from the ignore rule. Do not describe ignored, untracked data as tracked.

### P2 — Include this plan in BD3 classification

The response says this untracked plan document will be classified alongside `AGENTS.md` and `.claude/agents/*.md`, but the executable BD3 checklist mentions only the latter governance files. Add this plan's exact path to both choices: commit it as project documentation or add its exact path to `.git/info/exclude` as machine-local material.

### P2 — Give BD6 an enforceable Definition of Done

BD6 states the desired lifecycle but does not authorize a concrete repository change, name a commit, or define evidence that the no-direct-to-`main` rule is enforced. Remote branch protection is optional and explicitly out of scope, so the task can currently be checked off without changing behavior.

Specify the in-scope enforcement artifact (for example, the standing branch-discipline section in `CLAUDE.md`), the exact review/commit boundary, and a Definition of Done. If actual GitHub branch protection is deferred, say clearly that BD6 establishes documented agent policy only and create a separately approved follow-up for server-side enforcement.

### Response to Codex review — 2026-09-13 (all six accepted; verified against a live re-probe)

A third re-probe confirmed the repo state had **churned again** since both reviews (main `0/0`→now **1 behind** origin; **3** worktrees incl. a new `jade-ch9`; SCN worktree **now unlocked**; `CLAUDE.md` dirty). Both prior snapshots were already stale — which *is* Codex P1a's point.

- **P1a — accepted.** Status flipped to **BLOCKED pending fresh BD0**; the hardcoded snapshot is now labelled ephemeral evidence, BD0-at-execution is the sole truth. The safety contract's fixed-name protection must be replaced by the protected set a fresh BD0 emits (now includes `jade-ch9`).
- **P1b — accepted.** BD5 now has two proof paths (branch-only vs live-worktree); branch-only candidates no longer require a worktree path/clean-status they can't have.
- **P1c — accepted (strong catch).** BD5 content proof now requires `git rev-list --merges main..<branch>` empty in addition to all-`-` `git cherry`; any unique merge commit → stop and inspect its tree.
- **P2a — accepted (factual error fixed).** Response #3 corrected: `.superpowers/sdd/` is **not** tracked (machine-local, self-ignored); the root-ignore entry is redundant and dropped.
- **P2b — accepted.** BD3 checklist now classifies this plan doc alongside `AGENTS.md`/`.claude/agents/*`.
- **P2c — accepted.** BD6 now has a concrete Definition of Done (a committed `CLAUDE.md` "Branch discipline" section), with server-side protection explicitly deferred to a separate approved task.

---

## Objective

Protect the current work remotely, make the primary checkout safe from accidental staging, retire obsolete branch/worktree artifacts only after proving they contain no unique work, and establish a repeatable branch lifecycle for future bundles.

## Response to reviewer comments

1. Snapshot refresh: the plan now treats the 2026-09-13 state as the ground truth and explicitly re-runs BD0 before any cleanup action. The stale 6+6 snapshot is replaced with the current 29-branch / 1-worktree reality.
2. Obsolete tasks: BD1 and BD4 are marked as obsolete because the R1–R9 work shipped and everything is already on origin. They remain as historical notes only and are not to be executed as active tasks.
3. BD2 correction: the ignore rules are narrowed to runtime-only paths and exclude `.claude/worktrees/`, `.pnpm-store/`, and `supabase/.temp/` without blanket-ignoring PDFs or the whole `.claude/` tree. **Correction (Codex P2a):** the harness ledger under `.superpowers/sdd/` is **NOT tracked** — `git ls-files .superpowers` is empty; it is machine-local and hidden by its own inner `.gitignore`. Policy: intentionally machine-local, no remote recovery; `record-task.ts` reads it locally and the derived metrics CSVs (which ARE tracked) are the durable record. Do not describe it as tracked, and adding `/.superpowers/` to the root ignore is redundant (already self-ignored) — omit it.
4. BD3 decision: the plan now requires a human choice between committing governance files or keeping them local via `.git/info/exclude`, and it explicitly calls out that the plan doc itself must be classified alongside `AGENTS.md` and `.claude/agents/*`.
5. BD5 re-scope: the cleanup task now targets the current 29 stale branches (6 `incoming-*` + 23 `worktree-agent-*`) and the single locked worktree, with a cherry proof required for every branch deletion and no `git worktree remove` for branches without live worktrees.
6. BD6 enforcement: the plan now calls out the active root cause directly: direct commits to `main` are still happening, including Sentry/PostHog work, and BD6 is the actual fix.

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

## Current snapshot — revalidated 2026-09-13 before any cleanup

- `main == origin/main` with `0 ahead / 0 behind` at review time. This is the current baseline; no local branch should be treated as ahead-of-main without a fresh proof.
- The repo currently has **2 worktrees**: the primary checkout plus one locked `scn-v0.3-phase3.1` worktree. The previous six-worktree snapshot is stale and no longer valid.
- The stale-branch set has grown to **29 branches**: 6 `incoming-*` plus 23 `worktree-agent-*`, all long-merged and not current work.
- The current untracked set includes `.claude/agents/`, `AGENTS.md`, and this plan doc itself; these are still pending BD3 classification.
- The root cause remains active: workstreams still commit directly to `main`, which violates BD6 and is the actual branch-lifecycle problem to fix.

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

**Status:** obsolete for the current repo state. R1–R9 shipped and all relevant work is already on `origin`. Do not execute this task unless a new active bundle is created later. If reused, it must be re-scoped before running.

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
- [ ] Do not blanket-ignore PDFs. Ask whether each file is project documentation to relocate/version or a local reference to exclude locally. If a PDF is not part of the repo's source of truth, it should be handled by a per-file local exclusion or a local `.git/info/exclude`, not a repo-wide `*.pdf` rule.
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
- [ ] **Classify this plan doc too (Codex P2b):** `docs/superpowers/plans/2026-09-01-branch-discipline-remediation.md` is untracked but lives under the tracked `docs/superpowers/plans/` convention. Apply the same chosen policy to it — commit it as project documentation, or add its exact path to `.git/info/exclude` as machine-local material.
- [ ] Never combine Claude runtime directories or the 4+ GB worktree storage with the agent-definition commit.

## Task BD4 — Finish the current R1–R9 bundle without branch surgery

**Status:** obsolete for the current repo state. The active R1–R9 bundle has already shipped and no fresh bundle is pending. This task is retained only as a historical note and must not be executed unless a new bundle is created later.

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

- [ ] Begin only after the current working state is re-validated and no agent is using the cleanup candidates.
- [ ] Re-run BD0 for every candidate immediately before cleanup.
- [ ] Classify each candidate first, then apply the matching proof path (Codex P1b):
  - **Branch-only candidate** (no worktree checks it out): resolve the exact local ref; confirm via `git worktree list` it is checked out in NO worktree; record upstream/recovery info (reflog, any remote); run the content proofs below; confirm no live owner; then request deletion approval.
  - **Live-worktree candidate**: all of the above PLUS the exact path is under `.../.claude/worktrees/`, it is not the active bundle's worktree, and `git -C <path> status --porcelain` is empty.
- [ ] Content proof (both types) — `git cherry` alone is NOT sufficient (Codex P1c: it only compares non-merge patch IDs):
  - `git cherry main <branch>` returns only `-` entries (ordinary commit patches are on `main`); AND
  - `git rev-list --merges main..<branch>` is empty (no merge commits unique to the branch). If any exist, STOP and inspect each merge's resulting tree/diff explicitly; keep the branch if it carries unique conflict-resolution content.
  - no live agent/session owns it.
- [ ] Present the exact worktree paths and branch names proposed for removal and request human approval.
- [ ] For any `worktree-agent-*` worktree that is clean and patch-equivalent, remove it using `git worktree remove <exact-path>`—never filesystem deletion. If the worktree is already absent, skip it and record that fact.
- [ ] Re-check patch equivalence, then present the exact obsolete `worktree-agent-*` and duplicate `incoming-*` branch names proposed for deletion.
- [ ] Delete only approved local branches. If normal `git branch -d` refuses because the work was cherry-picked rather than ancestry-merged, do not escalate to `-D` without a second explicit approval that cites the `git cherry` proof.
- [ ] Run `git worktree prune --dry-run --verbose`; request approval before any non-dry-run prune.
- [ ] Keep the active worktree until its branch is merged, remotely recoverable, clean, unlocked, and separately approved for retirement.
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
- [ ] Enforce the no-direct-to-main rule: Sentry/PostHog and any future bundle work must land on a feature branch first, never directly on `main`.
- [ ] **Definition of Done (Codex P2c):** BD6 establishes *documented agent policy only*. The in-scope enforcement artifact is a standing **"Branch discipline"** section added to `CLAUDE.md` (feature-branch-per-bundle, early remote upstream, one approved merge, no direct-to-main, one commit per task). DoD = that section committed `[BD6] document standing branch discipline` and every subsequent bundle observably following it. **Server-side enforcement (GitHub branch protection / required CI) is explicitly deferred** to a separately-approved infra task — do not change GitHub settings here, and do not check BD6 done on the basis of server-side protection.
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

---

## Rollback plan

Every task is designed to be reversible. Two invariants make this hold: (a) each remediation is **one commit** (`[BD<n>] …`), so a single `git revert <sha>` undoes it; (b) nothing in this plan **rewrites history** (no reset/rebase/amend/force-push), so `git reflog` retains every pre-change ref (~90 days) as the universal safety net. **Record the "before" state in the BD0/approval report for each task** — that record is what the rollback below consumes.

### Per-task rollback

- **BD1 (feature-branch push):** `git push origin --delete <remote-branch>`. No `main` impact; the local branch is untouched. Fully reversible.
- **BD2 (`.gitignore` edit):** `git revert <BD2-sha>` (or drop the PR if done on a branch). No files are deleted by BD2, so nothing to restore — ignored paths simply reappear in `git status`. If PDFs were sent to `.git/info/exclude`, delete those lines to un-hide them.
- **BD3 (governance classification):**
  - If **committed**: `git revert <BD3-sha>` → the files return to untracked (their on-disk content is unchanged).
  - If **machine-local** (`.git/info/exclude`): remove the added exclude lines. No commit existed to revert.
- **BD5 (destructive — branch/worktree retirement):** the only lossy-looking task; in practice recoverable because every candidate was proven patch-equivalent (`git cherry` all-`-` **and** no unique merge commits) *before* deletion, so its content already lives on `main`.
  - **Deleted local branch:** re-create at its recorded sha — `git branch <name> <sha-from-BD0-report>` — or find it via `git reflog` / `git fsck --lost-found`. Even if the ref is unrecoverable, no work is lost (content was on `main`).
  - **Removed worktree:** `git worktree remove` deletes only the working directory + admin entry, never the commits/branch. Re-attach with `git worktree add <exact-path> <branch>`.
  - **`git worktree prune`:** only clears stale admin metadata for already-gone worktrees; re-add any worktree with `git worktree add` if needed.
- **BD6 (CLAUDE.md branch-discipline section):** `git revert <BD6-sha>`. Policy/doc only — no code or behavior to restore.

### `main` and deploy safety

- A bad change already on `main` is undone with a **forward `git revert`** commit — **never** `reset`/force-push (the safety contract forbids it), so shared history and other workstreams (Sentry/PostHog/`jade-ch9`) are never rewound under them.
- If a `main` push triggered CI/Render deploy, roll back the *deployment* separately via the normal runbook (redeploy the prior good sha in Render) — a git revert alone does not un-deploy.

### Stop-and-restore triggers

Abort and restore from the BD0 record if, mid-task: a candidate shows a `+` from `git cherry` or a non-empty `git rev-list --merges`, a worktree is unexpectedly dirty or owned by a live pid, `main`/`origin` diverges from the approved snapshot, or a deletion target's recorded sha no longer matches. Reversibility depends on the BD0 "before" record existing — so BD0 is a hard prerequisite for BD5, not optional.
