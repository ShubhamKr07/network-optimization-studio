# Branch Discipline Remediation — Implementation Plan

> **For agentic workers:** execute task-by-task with review checkpoints. This is **git-ops, not code** — each step is an exact command + expected result + (where noted) a human approval gate. Steps use `- [ ]`.

**Goal:** Reconcile gitignore, version agent governance files, retire 29 stale branches, and codify a standing branch lifecycle — with zero application-behavior change, on a feature branch + PR.

**Source spec:** `docs/superpowers/specs/2026-09-13-branch-discipline-remediation-design.md`. **Source tasklist:** `docs/superpowers/plans/2026-09-01-branch-discipline-remediation.md` (safety contract + rollback live there).

**Tech:** git, `gh` CLI. No app/test toolchain touched (verification = `pnpm run typecheck` stays green because nothing app-side moves).

## Global Constraints

- **Safety contract (verbatim from the spec):** no app/API/solver/dataset/generated/infra/test edits; no reset/rebase/amend/force-push of `main` or shared branches; no `rm -rf` (git ref/worktree commands only); no deletion without explicit human approval after read-only proofs; any `+` from `git cherry`, non-empty `git rev-list --merges`, dirty/owned worktree, or uncertain deploy trigger → **stop-and-report**.
- **Execution:** all file-changing work on a `chore/branch-discipline` branch, one `[BD<n>]` commit per task, one PR, single merge (dogfoods BD6). BD5 (ref deletion) is separate — it produces no PR diff.
- **Never push another workstream's unpushed commits** as a side effect (local `main` currently carries an unpushed user docs commit + a dirty `CLAUDE.md` WIP — leave both).
- **Protected (never touch):** `main`; the `jade-ch9` and `scn-v0.3-phase3.1` worktrees and their branches; any branch/worktree a fresh BD0 shows as owned/active.
- **BD5 requires a fresh BD0 immediately before it** — the BD0 "before" record (per-branch sha + proofs) is the rollback key.
- Rollback per the source doc: `git revert <sha>` for BD2/BD3/BD6; recreate a deleted branch from its recorded sha / reflog for BD5.

---

## File structure

```
.gitignore                    BD2 (modify: drop *.pdf, add supabase/.temp/ + .claude/worktrees/)
.git/info/exclude             BD2 (modify, machine-local, NOT committed — the two Redesign PDFs)
AGENTS.md                     BD3 (add: commit as project config)
.claude/agents/*.md           BD3 (add: commit as project config)
CLAUDE.md                     BD6 (modify: add "Branch discipline" section)
```
(The `2026-09-01` plan doc + this spec/plan are already tracked on `main` via earlier commits — BD3 need only add `AGENTS.md` + `.claude/agents/`.)

---

## Task 0: Setup — feature branch from a fresh main

**Interfaces — Produces:** the `chore/branch-discipline` branch all `[BD<n>]` commits land on.

- [ ] **Step 1:** Confirm a clean-enough start. `git status --porcelain -uno` may show the parallel `CLAUDE.md`/ch9 WIP — that's fine, do NOT stage it.
- [ ] **Step 2:** `git checkout main && git branch chore/branch-discipline && git checkout chore/branch-discipline`
  Expected: on `chore/branch-discipline` at main's HEAD.
- [ ] **Step 3:** Confirm: `git branch --show-current` → `chore/branch-discipline`.

---

## Task BD0: Read-only inventory + proof (prerequisite, no writes)

**Interfaces — Produces:** an inventory report (paste into the PR body) listing protected worktrees, the 29 cleanup-candidate branches with per-branch sha + patch-equivalence + merge-commit results, and untracked-path classes.

- [ ] **Step 1:** `git worktree list --porcelain` — record every worktree path + branch + lock. Mark `jade-ch9` and `scn-v0.3-phase3.1` **protected**.
- [ ] **Step 2:** `git branch -vv | grep -E 'worktree-agent|incoming-'` — record the candidate branches + their shas. Expected ~29.
- [ ] **Step 3:** For each candidate `<b>`, record proofs:
  ```bash
  git cherry main <b> | grep -c '^+'          # must be 0
  git rev-list --merges --count main..<b>     # must be 0
  git worktree list --porcelain | grep -q <b> && echo CHECKED_OUT || echo free
  ```
  Any `+` or non-zero merges or CHECKED_OUT → mark that branch **KEEP / stop-and-report**.
- [ ] **Step 4:** `git ls-files --others --exclude-standard` + `git check-ignore -v <path>` for each untracked root path — classify runtime vs governance vs source.
- [ ] **Step 5:** Write the inventory report (protected set; deletable branches with shas+proofs; keep/uncertain; untracked classes). This is the BD5 rollback record — keep it in the PR description.

**Stop conditions:** any candidate with `+`/merges/checked-out, an owned protected worktree changed, or uncertainty about a branch's owner.

---

## Task BD2: Reconcile `.gitignore` + local PDF exclude

**Files:** Modify `.gitignore`; Modify `.git/info/exclude` (not committed).

- [ ] **Step 1:** Remove the over-broad rule. Delete the `*.pdf` line from `.gitignore` (added 2026-09-12). Keep `.pnpm-store/` and `graphify-out/`.
- [ ] **Step 2:** Add the missing runtime paths to `.gitignore`:
  ```
  supabase/.temp/
  .claude/worktrees/
  ```
  Do NOT add `/.superpowers/` (already self-ignored by its inner `.gitignore`). Do NOT blanket-ignore `/.claude/` (governance lives there).
- [ ] **Step 3:** Send the two Redesign PDFs to machine-local exclude (per spec — not a repo rule):
  ```bash
  printf '%s\n' "Network Optimization Studio Redesign.pdf" "Replit_Network Optimization Studio Redesign.pdf" >> .git/info/exclude
  ```
- [ ] **Step 4: Verify** the diff is safe:
  ```bash
  git diff .gitignore                                   # only the intended lines
  git check-ignore -v supabase/.temp .claude/worktrees  # both now ignored
  git status --short | grep -E '\.pdf|\.pnpm-store|graphify-out|worktrees' || echo "runtime paths no longer listed"
  ```
  Confirm no pattern hides migrations/datasets/source/tests/generated output.
- [ ] **Step 5: Commit** (only `.gitignore`; `.git/info/exclude` is untracked by design):
  ```bash
  git add .gitignore && git commit -m "[BD2] ignore local tooling/runtime artifacts; stop broad *.pdf"
  ```

**Rollback:** `git revert <BD2-sha>`; remove the `.git/info/exclude` lines. No files deleted.

---

## Task BD3: Version the agent governance files

**Files:** Add `AGENTS.md`, `.claude/agents/*.md`. (The `2026-09-01` plan doc is already tracked on `main`.)

- [ ] **Step 1: Review each file for anything that must not be committed** — secrets, tokens, absolute personal paths (e.g. `/Users/shubhamkr/...` that should be relative), machine-only assumptions, stale model names:
  ```bash
  grep -rnE 'secret|token|api[_-]?key|/Users/[a-z]+/|password' AGENTS.md .claude/agents/ || echo "clean"
  ```
  If anything sensitive appears → **stop-and-report**; do not commit until resolved.
- [ ] **Step 2:** Stage only the governance files:
  ```bash
  git add AGENTS.md .claude/agents
  git status --porcelain | grep -E 'AGENTS.md|.claude/agents'   # confirm ONLY these staged (no CLAUDE.md WIP)
  ```
- [ ] **Step 3: Commit** `git commit -m "[BD3] version the agent team contract (AGENTS.md + .claude/agents)"`.
- [ ] **Step 4: Verify** `git ls-files AGENTS.md .claude/agents | wc -l` > 0.

**Rollback:** `git revert <BD3-sha>` → files return to untracked, content unchanged.

---

## Task BD6: Codify standing branch discipline in CLAUDE.md

**Files:** Modify `CLAUDE.md`.

**Note:** `CLAUDE.md` has a parallel uncommitted WIP (`M CLAUDE.md`, not ours). To avoid entangling it, apply BD6 as a targeted append and stage with an explicit pathspec ONLY after confirming the WIP isn't clobbered — if the working `CLAUDE.md` differs from `main`'s in ways we didn't make, **stop-and-report** and let the human land their WIP first.

- [ ] **Step 1:** Check for the parallel WIP: `git diff main -- CLAUDE.md | head`. If there's unexplained WIP, stop and coordinate (the human commits it first) — do not overwrite.
- [ ] **Step 2:** Append a `## Branch discipline` section to `CLAUDE.md`: feature-branch-per-bundle from clean `main`; set remote upstream at first checkpoint; one `[<task-id>]` commit per task; one approved merge per bundle; **no direct commits to `main`** (names the recurring offenders: bundle work, Sentry/PostHog, remediation); server-side branch protection is a separate approved task.
- [ ] **Step 3: Commit** `git add CLAUDE.md && git commit -m "[BD6] document standing branch discipline"`.
- [ ] **Step 4: Verify** `pnpm run typecheck` still green (docs-only change; sanity that nothing else got staged).

**Definition of Done:** the section is committed; every subsequent bundle observably follows it. Server-side enforcement deferred.

**Rollback:** `git revert <BD6-sha>`.

---

## Task BD-PR: Open the PR and merge once

- [ ] **Step 1:** `git push -u origin chore/branch-discipline` (feature branch only — never `main`).
- [ ] **Step 2:** `gh pr create --base main --title "chore: branch-discipline remediation (BD2/BD3/BD6)" --body-file <report>` — body = the BD0 inventory report + the per-task summary + the BD5 deletion proposal (for separate approval).
- [ ] **Step 3:** Human reviews. On approval, `gh pr merge --merge` (no squash — keep the `[BD<n>]` commits individually revertable). Do not merge without approval.

---

## Task BD5: Retire the 29 stale branches (destructive — separate approval)

**Not part of the PR diff** (ref deletion changes no tracked file). Run after a **fresh BD0** (re-probe — state churns).

- [ ] **Step 1:** Re-run BD0 Steps 1–3. Confirm the candidate set + shas still match the recorded report; anything changed → re-record.
- [ ] **Step 2:** Present the exact list of branches proposed for deletion (name + sha + "cherry 0 / merges 0" proof) and **request human approval**. STOP.
- [ ] **Step 3:** After approval, delete each proven branch:
  ```bash
  git branch -d <b>    # safe delete; refuses if not ancestry-merged
  ```
  For a branch `-d` refuses (cherry-picked, not merged) **and** whose proof is clean: request a **second explicit approval citing the proof**, then `git branch -D <b>`. Never blind `-D`.
- [ ] **Step 4: Verify** `git branch | grep -cE 'worktree-agent|incoming-'` → 0 (or only the human-kept ones).
- [ ] **Step 5:** `git worktree prune --dry-run --verbose` — report only; request approval before any real prune (none expected — no worktrees removed this round).
- [ ] **Step 6:** Report what was deleted + each branch's recovery sha (from the BD0 record) + note content was patch-equivalent to `main`.

**Rollback:** recreate any branch: `git branch <b> <recorded-sha>` (or via `git reflog`). No work lost — content proven on `main`.

---

## Self-review (plan vs spec)

- **Spec coverage:** BD0 ✓ (Task BD0), BD2 ✓, BD3 ✓ (governance commit; plan-doc already tracked), BD5 ✓ (branches-only, proof+approval, separate from PR), BD6 ✓, feature-branch+PR ✓ (Task 0 + BD-PR). BD1/BD4 correctly absent.
- **Decisions honored:** feature-branch+PR (Task 0/BD-PR); BD3 commit-as-config (secret review first); BD5 branches-only (no worktree removal; jade-ch9/SCN protected).
- **Placeholder scan:** every step has an exact command + expected result; no TBDs.
- **Safety:** approval gates on BD5; stop-and-report on `+`/merges/owned-worktree/CLAUDE.md-WIP; no force-push; rollback per task.
- **Ordering:** Task 0 → BD0 → BD2/BD3/BD6 (PR) → BD5 (post fresh BD0 + approval).
