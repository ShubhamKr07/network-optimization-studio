# Branch Discipline Remediation — Implementation Plan

> **For agentic workers:** execute task-by-task with review checkpoints. This is **git-ops, not code** — each step is an exact command + expected result + (where noted) a human approval gate. Steps use `- [ ]`.

**Goal:** Reconcile gitignore, version agent governance files, retire 29 stale branches, and codify a standing branch lifecycle — with zero application-behavior change, on a feature branch + PR.

**Source spec:** `docs/superpowers/specs/2026-09-13-branch-discipline-remediation-design.md`. **Source tasklist:** `docs/superpowers/plans/2026-09-01-branch-discipline-remediation.md` (safety contract + rollback live there).

**Tech:** git, `gh` CLI. No app/test toolchain touched (verification = `pnpm run typecheck` stays green because nothing app-side moves).

## Codex review — 2026-09-13

**Verdict:** do not execute this plan as written. Correct the P1 findings below first, then tighten the command-level verification so a dirty shared checkout cannot leak unrelated work into a commit or PR.

### P1 — Task 0 would publish unrelated local-main commits

Task 0 creates the remediation branch at local `main`, which is currently four commits ahead of `origin/main`; the later push and PR would therefore include the unrelated Chapter 9 commit. This directly contradicts the global constraint against pushing another workstream's unpushed commits.

Fetch first, record the remote base SHA, and create the remediation branch from verified `origin/main`. Cherry-pick or recreate only the explicitly approved remediation-document changes. Before push, verify both `git log --oneline origin/main..HEAD` and `git diff --name-only origin/main...HEAD` against an expected allowlist.

### P1 — The dirty/owned-worktree stop rule contradicts setup

The global constraint says any dirty or owned worktree is a stop condition, while Task 0 says the known dirty `CLAUDE.md`/Chapter 9 work is acceptable. Change the stop rule to apply to cleanup candidates. Protected parallel worktrees should be inventoried and preserved, not treated as a reason to abort BD2/BD3.

### P1 — BD3 does not implement the locked spec

The spec requires BD3 to version the 2026-09-01 plan alongside the agent governance files, but this plan omits it because it happens to be committed on the ahead local `main`. Make the source plan an explicit BD3 input or revise the spec and list the preparatory documentation commits that will be intentionally included. Do not obtain it by inheriting all local-main ancestry.

### P2 — Verify the complete staged set before every commit

The BD3 `git status | grep` command only proves that expected files appear; it does not detect unrelated files already staged, and `git commit` includes the entire index. Begin each task with a clean-index assertion and compare `git diff --cached --name-only` to the exact expected paths immediately before BD2, BD3, and BD6 commits.

### P2 — Define the inventory report file used by `gh pr create`

BD0 does not assign a filesystem path or creation command to its report, but BD-PR invokes `gh pr create --body-file <report>`. Choose an ignored, durable local path, create the report there, verify its contents, and pass that exact path to `--body-file`.

### P2 — Correct the BD3 rollback description

`git revert <BD3-sha>` removes files that BD3 added; it does not return them to an untracked state with their content unchanged. State that the files are removed but recoverable from Git history, or define an explicit backup/revert/restore-as-untracked procedure if preserving working-tree copies is required.

### P2 — Match checked-out branches exactly

`git worktree list --porcelain | grep -q <b>` is an unquoted regular-expression substring search across paths and refs. Use an exact fixed-string record match such as `grep -Fqx -- "branch refs/heads/$b"` so a similarly named branch or path cannot produce a false result.

### Response to Codex review — 2026-09-13 (all 3 P1 + 4 P2 accepted; verified + actioned)

Re-probe: local `main` is **5 ahead** of origin (2 ch9 commits + 3 remediation-doc commits) — confirms the base problem, intensified.

- **P1 Task-0 base — done.** Task 0 rewritten: fork from fetched `origin/main`, cherry-pick only the 3 allowlisted doc commits, verify `git log`/`git diff --name-only origin/main..HEAD` exclude ch9 before push (also a final pre-push check in BD-PR Step 1).
- **P1 stop-rule scope — done.** Global Constraints now scope dirty/owned to cleanup candidates; protected worktrees + dirty primary checkout recorded-and-left.
- **P1 BD3 vs ancestry — done.** BD3 header states the 2026-09-01 plan doc arrives via Task 0's explicit cherry-pick of `24dec5e`, not ancestry.
- **P2 staged-set verify — done.** BD2/BD3/BD6 commit steps now `git reset -q` then assert `git diff --cached --name-only` equals the exact allowlist.
- **P2 report path — done.** BD0 writes `.harness/branch-discipline/inventory-<date>.md` (gitignored); BD-PR passes that exact `$REPORT` to `--body-file`.
- **P2 BD3 rollback wording — done.** Corrected: `git revert` removes the added files (recoverable from history), not "back to untracked with content".
- **P2 exact branch match — done.** BD0 uses `grep -Fqx -- "branch refs/heads/$b"`.

---

## Global Constraints

- **Safety contract (verbatim from the spec):** no app/API/solver/dataset/generated/infra/test edits; no reset/rebase/amend/force-push of `main` or shared branches; no `rm -rf` (git ref/worktree commands only); no deletion without explicit human approval after read-only proofs; any `+` from `git cherry`, non-empty `git rev-list --merges`, or uncertain deploy trigger → **stop-and-report**.
- **Stop-condition scope (Codex P1):** a dirty/owned worktree blocks deletion **only for a cleanup candidate**. A *protected* worktree (`jade-ch9`, `scn-v0.3-phase3.1`) or the dirty primary checkout being dirty/owned is expected — **record it and leave it untouched; it does NOT abort** the non-destructive tasks (BD0/BD2/BD3/BD6).
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

## Task 0: Setup — feature branch from a fresh `origin/main` (NOT local main)

**Why (Codex P1):** local `main` is 5 commits ahead of `origin/main` — 2 unrelated Chapter-9 commits (`1740be4`, `938abfe`) interleaved with the 3 remediation-doc commits. Branching from local `main` + pushing would publish the ch9 work. Base on `origin/main` and transfer ONLY the approved remediation commits.

**Interfaces — Produces:** the `chore/branch-discipline` branch, based on `origin/main`, carrying only the approved remediation-doc commits.

**Approved remediation-doc commit allowlist (the ONLY local-main commits to transfer):**
`24dec5e` (2026-09-01 plan doc + reviews + rollback), `79be196` (this spec), `b759e30` (this plan). **Excluded:** `1740be4`, `938abfe` (Chapter-9 — not ours).

- [ ] **Step 1:** `git fetch origin` and record the base: `BASE=$(git rev-parse origin/main); echo "$BASE"`.
- [ ] **Step 2:** Create the branch from the verified remote base: `git checkout -b chore/branch-discipline "$BASE"`.
- [ ] **Step 3:** Cherry-pick ONLY the allowlisted commits, oldest→newest: `git cherry-pick 24dec5e 79be196 b759e30`. (If a later ch9 commit renumbered these shas, re-resolve by commit subject — the three `docs: branch-discipline …` commits — never by picking a range that could include ch9.)
- [ ] **Step 4: Verify no unrelated work rode along:**
  ```bash
  git log --oneline origin/main..HEAD        # exactly the 3 remediation-doc commits, no ch9
  git diff --name-only origin/main...HEAD     # only docs/superpowers/{specs,plans}/…branch-discipline… paths
  ```
  Any ch9 file or commit present → **stop-and-report**; the base/cherry-pick was wrong.
- [ ] **Step 5:** Confirm `git branch --show-current` → `chore/branch-discipline`.

---

## Task BD0: Read-only inventory + proof (prerequisite, no writes)

**Interfaces — Produces:** an inventory report (paste into the PR body) listing protected worktrees, the 29 cleanup-candidate branches with per-branch sha + patch-equivalence + merge-commit results, and untracked-path classes.

- [ ] **Step 1:** `git worktree list --porcelain` — record every worktree path + branch + lock. Mark `jade-ch9` and `scn-v0.3-phase3.1` **protected**.
- [ ] **Step 2:** `git branch -vv | grep -E 'worktree-agent|incoming-'` — record the candidate branches + their shas. Expected ~29.
- [ ] **Step 3:** For each candidate `<b>`, record proofs:
  ```bash
  git cherry main "$b" | grep -c '^+'          # must be 0
  git rev-list --merges --count "main..$b"     # must be 0
  # Exact fixed-string match (Codex P2) — not an unquoted substring grep:
  git worktree list --porcelain | grep -Fqx -- "branch refs/heads/$b" && echo CHECKED_OUT || echo free
  ```
  Any `+` or non-zero merges or CHECKED_OUT → mark that branch **KEEP / stop-and-report**.
- [ ] **Step 4:** `git ls-files --others --exclude-standard` + `git check-ignore -v <path>` for each untracked root path — classify runtime vs governance vs source.
- [ ] **Step 5:** Write the inventory report to a durable, gitignored path (Codex P2) and verify it:
  ```bash
  mkdir -p .harness/branch-discipline
  REPORT=".harness/branch-discipline/inventory-$(date -u +%Y%m%d).md"   # .harness/ is gitignored
  # ...write the report to "$REPORT": protected set; deletable branches with sha + cherry/merge proofs;
  #    keep/uncertain; untracked-path classes...
  test -s "$REPORT" && echo "report written: $REPORT"
  ```
  This is the BD5 rollback record; `BD-PR` passes this exact `$REPORT` to `gh pr create --body-file`.

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
- [ ] **Step 5: Commit** with a full staged-set assertion (Codex P2 — `git commit` includes the whole index, so verify nothing else is staged, e.g. the parallel `CLAUDE.md` WIP):
  ```bash
  git reset -q                                    # clean the index first
  git add .gitignore
  test "$(git diff --cached --name-only)" = ".gitignore" || { echo "unexpected staged files"; git diff --cached --name-only; exit 1; }
  git commit -m "[BD2] ignore local tooling/runtime artifacts; stop broad *.pdf"
  ```

**Rollback:** `git revert <BD2-sha>`; remove the `.git/info/exclude` lines. No files deleted.

---

## Task BD3: Version the agent governance files

**Files:** Add `AGENTS.md`, `.claude/agents/*.md`. (The `2026-09-01` plan doc reaches this branch via Task 0's explicit cherry-pick of `24dec5e` — Codex P1c: it is NOT inherited from local-main ancestry, since the branch is based on `origin/main`. So BD3-the-task only adds the two governance items.)

- [ ] **Step 1: Review each file for anything that must not be committed** — secrets, tokens, absolute personal paths (e.g. `/Users/shubhamkr/...` that should be relative), machine-only assumptions, stale model names:
  ```bash
  grep -rnE 'secret|token|api[_-]?key|/Users/[a-z]+/|password' AGENTS.md .claude/agents/ || echo "clean"
  ```
  If anything sensitive appears → **stop-and-report**; do not commit until resolved.
- [ ] **Step 2:** Stage only the governance files, from a clean index, and assert the exact staged set (Codex P2):
  ```bash
  git reset -q
  git add AGENTS.md .claude/agents
  # every staged path must be AGENTS.md or under .claude/agents/ — nothing else (no CLAUDE.md WIP):
  git diff --cached --name-only | grep -qvE '^(AGENTS\.md|\.claude/agents/)' && { echo "unexpected staged files"; git diff --cached --name-only; exit 1; } || echo "staged set clean"
  ```
- [ ] **Step 3: Commit** `git commit -m "[BD3] version the agent team contract (AGENTS.md + .claude/agents)"`.
- [ ] **Step 4: Verify** `git ls-files AGENTS.md .claude/agents | wc -l` > 0.

**Rollback (Codex P2c):** `git revert <BD3-sha>` **removes** the files BD3 added (it does not restore them as untracked-with-content) — they remain recoverable from git history. If you need the working-tree copies preserved as untracked, back them up (`cp` outside the repo) before the revert, or `git checkout <BD3-sha>^ -- <paths>` then unstage.

---

## Task BD6: Codify standing branch discipline in CLAUDE.md

**Files:** Modify `CLAUDE.md`.

**Note:** `CLAUDE.md` has a parallel uncommitted WIP (`M CLAUDE.md`, not ours). To avoid entangling it, apply BD6 as a targeted append and stage with an explicit pathspec ONLY after confirming the WIP isn't clobbered — if the working `CLAUDE.md` differs from `main`'s in ways we didn't make, **stop-and-report** and let the human land their WIP first.

- [ ] **Step 1:** Check for the parallel WIP: `git diff main -- CLAUDE.md | head`. If there's unexplained WIP, stop and coordinate (the human commits it first) — do not overwrite.
- [ ] **Step 2:** Append a `## Branch discipline` section to `CLAUDE.md`: feature-branch-per-bundle from clean `main`; set remote upstream at first checkpoint; one `[<task-id>]` commit per task; one approved merge per bundle; **no direct commits to `main`** (names the recurring offenders: bundle work, Sentry/PostHog, remediation); server-side branch protection is a separate approved task.
- [ ] **Step 3: Commit** from a clean index with an exact staged-set assert (Codex P2):
  ```bash
  git reset -q && git add CLAUDE.md
  test "$(git diff --cached --name-only)" = "CLAUDE.md" || { echo "unexpected staged files"; git diff --cached --name-only; exit 1; }
  git commit -m "[BD6] document standing branch discipline"
  ```
- [ ] **Step 4: Verify** `pnpm run typecheck` still green (docs-only change; sanity that nothing else got staged).

**Definition of Done:** the section is committed; every subsequent bundle observably follows it. Server-side enforcement deferred.

**Rollback:** `git revert <BD6-sha>`.

---

## Task BD-PR: Open the PR and merge once

- [ ] **Step 1: Final pre-push allowlist check (Codex P1)** — prove only remediation content is on the branch:
  ```bash
  git fetch -q origin
  git log --oneline origin/main..HEAD          # only the 3 doc commits + [BD2]/[BD3]/[BD6]; NO ch9
  git diff --name-only origin/main...HEAD       # only .gitignore, AGENTS.md, .claude/agents/**, CLAUDE.md, docs/superpowers/{specs,plans}/…branch-discipline…
  ```
  Any ch9 file/commit → **stop-and-report**; do not push.
- [ ] **Step 2:** `git push -u origin chore/branch-discipline` (feature branch only — never `main`).
- [ ] **Step 3:** `gh pr create --base main --title "chore: branch-discipline remediation (BD2/BD3/BD6)" --body-file "$REPORT"` — where `$REPORT` is the exact BD0 inventory file (`.harness/branch-discipline/inventory-<date>.md`). Body = inventory + per-task summary + the BD5 deletion proposal (for separate approval).
- [ ] **Step 4:** Human reviews. On approval, `gh pr merge --merge` (no squash — keep the `[BD<n>]` commits individually revertable). Do not merge without approval.

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
