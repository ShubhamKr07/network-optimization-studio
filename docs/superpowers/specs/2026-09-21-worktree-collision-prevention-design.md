# Worktree Collision Prevention — Design

**Date:** 2026-09-21
**Status:** Design; written-spec review completed 2026-09-21 — changes requested (see §13)
**Scope:** Agent-team execution hygiene — worktree isolation, git-op guardrails, worktree lifecycle, gate-run hygiene

---

## 1. Problem

Four process incidents during agent-team bundles share one root cause: **more than one actor writing to a single worktree at the same time.**

| Incident | What happened |
|---|---|
| I1 | `git commit -m "..." -- <paths>` committed the *working-tree* content of those paths, bypassing the index — discarding the committer's own staging and sweeping another agent's unstaged edits in the same files. |
| I2 | An agent ran `git reset HEAD~1` to undo its own commit. Another commit had landed on top in the shared worktree, so the reset destroyed the wrong one. |
| I3 | Two agents editing the same shared checkout produced interleaved working-tree state that neither could reason about. |
| I4 | The controller committed docs with a bare `git commit` while an agent was mid-task; the bare commit took the whole shared index, including the agent's staged files. |

The mitigation adopted after the Bundle 3 incident — "agents committing to a shared worktree MUST use `git commit -m "..." -- <explicit paths>`", recorded at `CLAUDE.md:292` — is **wrong and must be replaced**. Both commit forms leak in a shared worktree:

- `git commit -- <paths>` commits working-tree content for those paths and bypasses the index, discarding your own staging and sweeping another writer's unstaged edits.
- `git commit` (bare) commits the entire index, including another writer's staged files.

There is no commit form that is safe while someone else is writing the same worktree. A pathspec is safe only when you are the sole writer of every named path and nobody else holds edits in them — which is the same condition as not sharing at all.

A secondary, noisier failure class is resource contention rather than git state: flaky `cors` / `resultEnvelope` / `registration` failures traced to other worktrees' dev servers competing for CPU, and a Bundle 4 incident where concurrent `pnpm install` across sibling worktrees churned the shared pnpm store mid-test and produced a phantom `Failed to resolve import "@tanstack/react-virtual"` across 11 test files.

### Current state (measured 2026-09-21)

- `git worktree list` reports **54 worktrees**; 50 live under `.claude/worktrees/`, the rest under `/tmp`. `git worktree list --porcelain` reports **0 prunable** — these are real directories holding real branches, so `git worktree prune` is not the remedy.
- Worktree-per-agent is already the dominant pattern (Bundles 4, 5, 6, 6.1 and SCN Phase 3.2 all dispatched one isolated worktree per task). Bundle 3 — eight agents in ONE worktree — is the outlier that produced the git-index race.
- The harness already exposes `Agent(isolation: "worktree")` and `EnterWorktree`, so isolation is available by flag today.
- `.harness/` is gitignored scratch (`.gitignore:66`), already used for the permission ledger.

The gap is therefore not knowledge of the rule. Nothing *stops* a shared-worktree dispatch, and nothing stops an unsafe git op once one exists.

## 2. Goals and non-goals

**Goals**

1. Make one-worktree-per-concurrent-writer the path of least resistance, with tooling that creates and registers worktrees.
2. Detect every collision-class git operation at the moment it is issued, with enough context to name the owner of the affected path.
3. Start advisory (warn + log, never block), and promote to hard block only on evidence.
4. Reclaim worktrees automatically once their work is merged, under proof, without weakening the repo's branch-deletion safety rules.
5. Remove the two known resource-contention noise sources (stray dev servers, concurrent pnpm installs).

**Non-goals**

- No daemon, no lock service, no serialization of agent execution. The guard observes; the dispatch tooling prevents.
- No change to how tasks are reviewed, cherry-picked, or gated.
- No automated branch deletion outside the proven, registry-scoped reaper path defined in §7.2.1 (D8).
- No removal of any worktree that fails proof.

## 3. Decisions

These were settled during the brainstorm and are normative for the implementation plan.

| ID | Decision |
|---|---|
| D1 | Enforcement is delivered as **guardrails in the harness**, not documentation alone. Convention has already failed twice. |
| D2 | The guard ships **advisory first** — warn and log, never block — and is promoted to hard block only against ledger evidence. |
| D3 | Both dispatch mechanisms stay legal: the explicit script for multi-task bundles (named branches, ledger, cherry-pick ordering) and harness-native `isolation: "worktree"` for single throwaway tasks. |
| D4 | Worktrees are cleaned up after their work merges, by a **controller-run reaper** plus a GC sweep at `/harness-retro`. The agent cannot do this itself — it exits before the controller cherry-picks and re-gates. |
| D5 | Automated removal requires proof (§7). Anything failing proof is reported, never removed. |
| D6 | The implementation is a `PreToolUse` Bash/Write/Edit hook backed by a run registry, with a git `pre-commit` backstop. Git-native hooks alone were rejected: git has no `pre-reset` or `pre-checkout` hook, so it is structurally blind to the operation that caused I2. |
| D7 | Scope includes the 54-worktree backlog triage, gate-run process hygiene, pnpm-store serialization, and the `CLAUDE.md` corrections. |
| D8 | Automated branch deletion uses `git branch -D` gated on a passing `git merge-base --is-ancestor <branch> main` proof, because `git branch -d` validates against the current worktree's HEAD and therefore refuses every reap while `main` is unchecked-out. Outside that proven, registry-scoped path, `-D` stays forbidden. See §7.2.1. |

## 4. Verified platform contracts

Checked against this machine's runtime before designing, not assumed:

- **Hook payload.** `.claude/hooks/permission-ledger.mjs` (already live in this repo, registered in `.claude/settings.json` on `PermissionRequest` and `PostToolUse` with matcher `Bash`) reads a JSON payload from stdin carrying `tool_name`, `cwd`, `session_id`, `tool_use_id`, `permission_mode`, and `tool_input.command`.
- **Hook output.** Claude Code 2.1.278 supports, on `PreToolUse`: `hookSpecificOutput.additionalContext` ("Context injected back to model"), `hookSpecificOutput.permissionDecision` (`allow` | `deny` | `ask`) with `permissionDecisionReason`, and a top-level `systemMessage` displayed to the user. Advisory mode therefore reaches both the agent and the human without blocking, and promotion to blocking is a change of one emitted field — not a rewrite.
- **Shared `.git`.** All worktrees of this repo share one `.git` directory, so `core.hooksPath` set once applies to every worktree, including a human's terminal. `core.hooksPath` is currently unset and `.githooks/` does not exist.
- **Existing hook conventions.** Dependency-free ESM, 2-second stdin timeout, whole body wrapped in `try/catch`, `process.exit(0)` on every path including failure. The new hook follows this exactly.

## 5. Components

Three new files plus one config change.

### 5.1 Run registry — `.harness/worktrees/registry.json`

Gitignored scratch, alongside the permission ledger.

```jsonc
{
  "runId": "bundle7-2026-09-21",
  "primaryCheckout": "/Users/shubhamkr/network-optimization-studio",
  "active": true,
  "entries": [
    {
      "taskId": "T3",
      "branch": "bundle7-T3-work",
      "worktree": "/Users/shubhamkr/network-optimization-studio/.claude/worktrees/bundle7-T3",
      "agent": "frontend-engineer",
      "sessionId": "",
      "solePaths": ["artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx"],
      "status": "active"
    }
  ]
}
```

`status` is one of `active`, `adhoc`, `merged`, `reaped`. `sessionId` is bound on the first Bash call observed from that worktree's cwd.

The registry is what makes ownership checkable. Without it, a hook can only say "this looks risky." With it, the hook can say *"`openapi.yaml` is T1's sole-writer path; you are T3."* Sole-writer declaration is already proven practice in this repo — the Phase 3.2 and Bundle 2.2 plans assigned exactly one owner per hot file (`templates.ts`, `import.ts`, `routes/scenarios.ts`, `openapi.yaml`) and recorded zero content conflicts on them. The registry moves that from prose in a plan to data a hook can read.

### 5.2 Guard hook — `.claude/hooks/worktree-guard.mjs`

Registered on `PreToolUse` with two matchers: `Bash` (git commands) and `Write|Edit` (file writes into a foreign path or the primary checkout).

Behaviour: read payload → resolve `cwd` (or `tool_input.file_path`) to a worktree via `git worktree list --porcelain` output cached per invocation → load registry → classify against the rule table (§6) → append a ledger record → in advisory mode emit `additionalContext` plus `systemMessage` and exit 0.

Invariants, matching the existing ledger hook: never throws, never hangs (2s stdin timeout), exits 0 on every path in advisory mode, and emits nothing at all for unclassified commands.

### 5.3 Guard ledger — `.harness/worktrees/guard-ledger.jsonl`

One record per classified operation:

```jsonc
{"at":"...","sessionId":"...","cwd":"...","worktree":"...","taskId":"T3","verb":"reset","rule":"rewrite_op","severity":"high","wouldBlock":true,"override":false,"command":"git reset HEAD~1"}
```

This is the evidence base for promotion (§6.3) and the input to a retro's near-miss count.

### 5.4 Harness command — `scripts/src/harness/worktree.ts`

Run via a root `pnpm harness:worktree` alias, matching the existing `harness:record` / `harness:permissions` / `harness:report` pattern. Subcommands: `start`, `add`, `reap`, `gc`, `report`.

### 5.5 Git backstop — `.githooks/pre-commit` + `core.hooksPath=.githooks`

Catches commits that never pass through the Bash tool (a human terminal, a script). It does the one check git can perform at commit time: refuse a commit whose staged set contains a path owned by a *different* `active` registry entry. It is blind to `reset`, `checkout`, and `stash` by git's design — that blindness is precisely why the Bash hook is the primary layer (D6).

## 6. Detection rules

### 6.1 Rule table

`wouldBlock` marks the rules that will deny once the guard is promoted (§6.3). In advisory mode nothing blocks.

| # | Rule | Fires when | Severity | wouldBlock |
|---|---|---|---|---|
| R1 | `rewrite_op` | `git reset`, `rebase`, `stash*`, `commit --amend`, `checkout <branch>`, `switch`, `checkout --`, `restore`, `clean`, `push --force*`, `branch -D` — in **any** worktree, registry active or not | high | yes |
| R2 | `shared_checkout_write` | cwd is `primaryCheckout` and a run is active, and the command is `git commit` / `add` / `merge` / `cherry-pick`; or a `Write`/`Edit` targets a file under `primaryCheckout` | high | yes |
| R3 | `foreign_path` | the command or edit touches a path in another active entry's `solePaths`, or cwd is another entry's worktree | high | yes |
| R4 | `cohabited_commit` | `git commit` in a worktree where a second entry is also `active` — with or without a pathspec | high | yes |
| R5 | `unregistered_worktree` | cwd is a worktree absent from the registry while a run is active | medium | no |
| R6 | `chained_suites` | one Bash command chains two or more test-suite invocations (`vitest`, `pytest`, `playwright`) with `&&` | low | no |

Never classified, never warned: read-only git (`status`, `log`, `diff`, `show`, `cherry`, `worktree list`), and any operation inside an agent's own registered worktree touching only its own paths. The guard must be invisible on the happy path, or agents will route around it.

### 6.2 Rule notes

**R1 is armed unconditionally.** History rewriting was never safe in a shared worktree and is a poor recovery tool even in a private one — I2 destroyed a commit while an agent tried to tidy up after itself. The emitted guidance is *escalate, do not self-recover*: report the bad commit to the controller and stop.

**R4 does not recommend a pathspec.** Per §1, both commit forms leak. The guidance is "another writer is active in this worktree — stop and escalate," never "use `git commit -- <paths>`."

**R5 does not nag.** Harness-native `isolation: "worktree"` (D3) produces worktrees the registry never saw. The hook auto-registers those as `status: "adhoc"` on first sight and records a medium-severity ledger line. R5 exists to notice drift, not to punish a legitimate shortcut.

**Escape hatch, visible by construction.** `WORKTREE_GUARD=off <command>` suppresses the warning and writes an `override: true` ledger record carrying the full command. Escapes stay possible and stay countable; a guard that can be bypassed silently rots.

### 6.3 Promotion from advisory to blocking

Mode lives in `.harness/worktrees/config.json` as `{"mode": "advisory" | "block"}`, read by the hook on every invocation.

Promote to `block` when, across **at least two completed bundles**, the guard ledger shows both:

1. every high-severity firing was a true positive, and
2. zero high-severity overrides were used.

This is the repo's existing second-occurrence gate logic pointed at the guard itself. On promotion, high-severity hits emit `permissionDecision: "deny"` with the rule's reason; medium and low severity stay advisory permanently.

## 7. Worktree lifecycle

### 7.1 Dispatch

```
pnpm harness:worktree start --run bundle7
pnpm harness:worktree add --task T3 --agent frontend-engineer --paths <globs>
```

`start` writes the registry and sets `active: true`. `add` creates branch `<run>-<task>-work` off the integration branch, adds the worktree under `.claude/worktrees/<run>-<task>`, writes the entry, and prints the prompt preamble to paste into the dispatch. The preamble carries:

- the agent's worktree path and branch, stated as the only place it may write;
- the base guard already learned during the JADE bundle — `git merge-base --is-ancestor <target-tip> HEAD` before starting, reporting `BASE_OK` — which exists because two agents there forked off a stale base 61 commits behind merged `main`;
- its `solePaths` list;
- the rewrite ban with *escalate, do not self-recover*;
- "run your gate one suite per command."

### 7.2 Reaper

`pnpm harness:worktree reap --task T3`, run by the controller immediately after its cherry-pick and re-gate. Removal proceeds only if all five proofs pass:

1. `git -C <worktree> status --porcelain` is empty;
2. `git merge-base --is-ancestor <branch> main` exits 0 — the branch tip is contained in `main`. `git cherry -v main <branch>` is also recorded (any `+` line is unmerged work and fails the proof), but the exit-code check is the gate, because it is unambiguous and cheap;
3. the path resolves (realpath) inside an allowed root and is not `primaryCheckout`;
4. no live process has that path as its cwd;
5. no other `sessionId` wrote to that worktree in the guard ledger within the last 10 minutes.

On success: `git worktree remove <path>`, then branch deletion per D8 below. Never `rm -rf`. Any proof failure prints the failing check and removes nothing.

### 7.2.1 Branch deletion — why `-d` alone cannot be the rule (D8)

Found by dogfooding this design's own reaper on the worktree that produced this spec: `git branch -d` validates merged-ness against **the current worktree's HEAD**, not against `main`. With the branch fully contained in `main` and proof 2 passing, `-d` still refused:

```
error: the branch 'worktree-collision-prevention' is not fully merged
```

because the primary checkout's HEAD was an unrelated branch. Since `main` is normally not checked out in any worktree in this repo, a `-d`-only rule would fail on *every* reap — a permanently deadlocked cleanup path that guarantees the 54-worktree backlog recurs.

**D8 — resolution.** The reaper deletes with `git branch -D <branch>`, permitted **only** when proof 2 (`git merge-base --is-ancestor <branch> main`) has passed in the same invocation and the branch is registry-scoped. `--is-ancestor` is a strictly stronger containment check than `-d` performs, so this is not a weakening of the safety rule — it replaces a HEAD-relative heuristic with an explicit `main`-relative proof. Every automated deletion writes a ledger record carrying the branch, its tip SHA, and the passing proof output.

`git branch -D` remains **forbidden** outside this path: any branch that is not registry-scoped, or whose `--is-ancestor` proof fails, is reported and left for a human under the existing second-approval rule. `CLAUDE.md`'s branch-discipline amendment (§9, item 3) states this exception explicitly rather than leaving the two rules in silent conflict.

R1 lists `branch -D` as a high-severity rewrite op, so the reaper's own deletion would self-trip the guard. The reaper therefore sets `WORKTREE_GUARD=reaper` on that one invocation; the hook classifies it as `reaper_delete` — ledgered with the proof, never warned, never blocked. This is a *narrow* exemption keyed to the script, not a general escape: a hand-typed `git branch -D` still fires R1.

### 7.3 GC sweep

`pnpm harness:worktree gc` applies the same five proofs to every registry entry and every path in `git worktree list`. **Dry-run by default**; `--apply` removes only proof-passing entries. Wired into `/harness-retro` as the straggler sweep, so a bundle that forgets a `reap` self-corrects at retro time.

### 7.4 Backlog triage of the existing 54

`pnpm harness:worktree report` classifies every existing worktree into four buckets and writes `.harness/worktrees/report-<date>.md`:

- **reapable** — all five proofs pass;
- **unmerged with unique commits** — lists the commits (`git cherry -v main <branch>`) so a human can decide;
- **dirty working tree** — lists the modified files;
- **broken** — missing branch, missing directory, or unreadable.

The report removes nothing. It lives in `.harness/` rather than `docs/superpowers/metrics/`: the metrics store is a six-CSV append-only ledger with a documented contract, and a one-off triage artifact does not warrant a seventh CSV.

## 8. Gate-run hygiene

### 8.1 Foreign processes

`pnpm harness:gate` preflights by listing `vite`, `vitest`, `playwright`, and `pnpm dev` processes whose cwd resolves under any repo worktree and which do not belong to the current session. Default behaviour is **warn and abort, not kill** — auto-killing would terminate a teammate's live Playwright run and become its own collision class. `--force` kills the listed processes after printing them.

This targets the flake class already documented in `CLAUDE.md`: `resultEnvelope.test.ts` and `cors` failures under CPU contention, twice root-caused to orphaned dev servers rather than code.

### 8.2 One suite per command

The gate runs each suite as its own invocation rather than chaining them with `&&`, so a failure is attributable to a suite and a flake is attributable to a run. R6 flags chained invocations advisorily.

### 8.3 pnpm store serialization

A mutex wrapper serializes `pnpm install` across worktrees using a `mkdir`-based lock at `.harness/locks/pnpm-install.lock` (portable on macOS, which lacks `flock`). The gate preflight refuses to trust a red result while the lock is held. This targets the Bundle 4 incident where four agents' concurrent installs churned the shared store mid-test and produced transient unresolvable-import failures across 11 test files.

## 9. Documentation changes

Three edits to `CLAUDE.md`:

1. **Replace the incorrect lesson at line 292.** The current text instructs agents in a shared worktree to commit with an explicit pathspec. Replacement states that no commit form is safe alongside another writer, and that the rule is one worktree per concurrent writer.
2. **Add to Hard rules:** one worktree per concurrent writer; the controller is a writer too — "sequential dispatch" does not exempt the controller from the rule while an agent is running.
3. **Amend Branch discipline** to permit proof-gated automated removal for registry-scoped worktrees (§7.2), and to state the D8 exception explicitly: `git branch -D` is permitted by the reaper only after a passing `git merge-base --is-ancestor <branch> main` proof on a registry-scoped branch. Every other branch deletion — and every worktree removal that fails proof — remains human-approved under the existing second-approval rule. Without this amendment the two rules sit in silent conflict and the cleanup path deadlocks.

## 10. Testing

| Layer | What |
|---|---|
| Classifier | Pure-function tests in the `scripts` package: command string + registry state → `{rule, severity, wouldBlock}`, covering each rule and the read-only allowlist. |
| Hook | Smoke tests piping real payload JSON to `worktree-guard.mjs`, asserting exit 0, the expected `additionalContext`, and a well-formed ledger line; plus malformed-payload and missing-registry cases asserting exit 0 with no output. |
| Reaper | Temp-repo tests exercising each of the five proofs' failure branches independently, asserting nothing is removed and the failing check is named. |
| Negative | A deliberate reproduction: bare `git commit` in the primary checkout with a run active must fire R2 and R4. |
| Backstop | `pre-commit` test: staged path owned by another active entry is refused; own path is allowed. |

## 11. Phasing

| Phase | Contents |
|---|---|
| P1 | Registry, guard hook in advisory mode, `start` / `add` dispatch script, classifier tests. |
| P2 | `reap`, `gc`, `report`; backlog triage run against the existing 54. |
| P3 | Gate hygiene wrapper and pnpm-store lock. |
| P4 | `CLAUDE.md` corrections; promotion review against the ledger after two bundles. |

## 12. Acceptance criteria

1. Dispatching a bundle task through `pnpm harness:worktree add` produces a registered worktree, a named branch, and a prompt preamble, with no manual `git worktree add`.
2. `git reset HEAD~1` issued in any worktree produces a guard warning naming the rule and instructing escalation, and a ledger record — without blocking, in advisory mode.
3. A bare `git commit` in the primary checkout while a run is active fires R2 and R4 and names the conflicting owner.
4. `reap` removes a merged task's worktree and branch when all five proofs pass — including the D8 branch-deletion path exercised against a branch whose commits are in `main` while `main` is not checked out anywhere — and removes nothing while any proof fails, naming the failing check.
5. `report` classifies all existing worktrees into the four buckets without removing anything.
6. A gate run warns about foreign dev-server processes before executing suites, and refuses to report a red result while the pnpm install lock is held.
7. `CLAUDE.md:292`'s pathspec guidance is gone, replaced per §9.

## 13. Written-spec review (Codex, 2026-09-21)

**Decision: changes requested; not approved for implementation yet.** The root-cause analysis and one-worktree-per-concurrent-writer direction are sound. The advisory-first rollout is also appropriate. The following correctness gaps must be resolved in the design before implementation.

### 13.1 Blocker: the reaper proof is incompatible with the cherry-pick workflow

§7.2 requires `git merge-base --is-ancestor <branch> main` to pass immediately after the controller cherry-picks the task. A normal cherry-pick records the change as a new commit, so the task branch tip is not an ancestor of the integration branch even when every patch landed successfully. In that state, `git cherry -v <integration> <task>` reports `-` (patch-equivalent) while `--is-ancestor` returns 1. D8 therefore solves the `git branch -d`/current-HEAD problem only for ancestry-preserving integration; it does not solve the repository's documented cherry-pick workflow.

**Required resolution:** choose one coherent integration proof:

1. change task integration to an ancestry-preserving merge and retain the ancestor proof; or
2. retain cherry-picks and store at least `baseSha`, `taskTip`, `integrationRef`, and the controller-recorded landed commit SHA(s). Reaping must require zero `+` commits from `git cherry -v <integrationRef> <taskTip> <baseSha>`, verify that the branch still points to the stored `taskTip`, and delete the ref with compare-and-delete semantics such as `git update-ref -d refs/heads/<branch> <taskTip>`.

The temp-repo test matrix must include a cherry-pick that deliberately produces a different commit SHA from the task commit; that case must reap successfully under the chosen proof.

### 13.2 Blocker: the registry is itself concurrency-unsafe

The design has concurrent hooks mutating one JSON object to bind `sessionId` and auto-register `adhoc` entries, but specifies neither a lock nor atomic update semantics. Two first tool calls can read the same registry revision and overwrite one another; a crash during a direct rewrite can leave malformed JSON. Binding an empty entry to whichever session happens to issue the first Bash call can also assign ownership to the wrong actor.

**Required resolution:** define one canonical registry location that every worktree resolves identically, serialize every read-modify-write, write through a same-filesystem temporary file plus atomic rename, and either support multiple active runs explicitly or refuse `start` while another run is active. Use the hook payload's stable `agent_id`/`agent_type` where available rather than first-Bash ownership; define a controller identity separately. Add a parallel-writer test proving no entry or status transition is lost.

### 13.3 Blocker: the stated guard coverage exceeds `PreToolUse`'s observation boundary

`PreToolUse` sees the Claude tool call and, for Bash, the outer `tool_input.command`. It does not become a recursive interceptor for child processes. For example, a Bash tool call of `pnpm harness:worktree reap --task T3` exposes that pnpm command to the hook; a `git branch -D` spawned inside the TypeScript process is not a second Claude tool call. Consequently, §7.2.1's claim that the reaper's internal deletion would self-trip R1 is incorrect, and `WORKTREE_GUARD=reaper` is unnecessary for that execution path. As written, the same boundary also misses Git operations hidden behind scripts or aliases, human-terminal reset/checkout operations, and arbitrary file writes performed through Bash.

**Required resolution:** either narrow Goal 2 and D6 to direct Claude `Bash`/`Write`/`Edit` calls, explicitly documenting the bypass boundary, or introduce a real Git-command wrapper/interposition mechanism and specify how it is enforced. Remove the purported reaper self-exemption. If any privileged bypass remains, an environment value that a person can type is not sufficient proof that the caller is the reaper.

### 13.4 Blocker: the five reaper checks do not prove that ownership ended

The guard ledger contains only classified operations. Normal edits in an owner's registered worktree are deliberately invisible, so "no other `sessionId` wrote in the last 10 minutes" cannot prove quiescence. An idle or suspended agent may have no live process whose cwd is the worktree and may resume after the reaper removes it. There is also a time-of-check/time-of-use window between proving the branch tip and deleting the ref.

**Required resolution:** require an explicit terminal ownership transition (agent completion plus controller acknowledgement) before reaping; treat process and recent-ledger checks as supplementary signals only. Store and re-check the exact task tip immediately before removal, then use atomic compare-and-delete for the branch ref. The dispatch design must also settle whether created worktrees are locked, matching the repository's current standing rule; if they are, the reaper must unlock only after every proof passes and immediately before `git worktree remove`.

Add negative tests in which an owner is idle but not released and in which the branch ref advances between proof and deletion; both must remove nothing.

### 13.5 Required guard/backstop corrections

- `core.hooksPath` is repository-local configuration, not a committed config change. Define an idempotent install/verification step, preserve or refuse an existing hooks path rather than silently replacing it, and fail `start` if the backstop is expected but inactive.
- A Git `pre-commit` hook can be bypassed with `--no-verify`; classify that form explicitly and state the residual human-terminal limitation.
- The registry and ledger paths used by the Git hook must be canonical from every linked worktree. A relative `.harness/...` path in the current worktree does not name shared scratch state.
- Define path-matching semantics for `solePaths`: repository-relative normalization, glob syntax, symlink/realpath containment, nonexistent write targets, and the staged/working-tree sets inspected for `git commit`, including `-a` and pathspec forms.
- Define parsing or conservative handling for `git -C`, `GIT_WORK_TREE`, shell chains/newlines, aliases, and destructive forms currently omitted from R1. Otherwise the rule must not claim exhaustive Git-op detection.

### 13.6 Required lifecycle and acceptance-criteria corrections

- Acceptance criterion 3 is inconsistent with the rule table. A commit from `primaryCheckout` while a run is active necessarily fires R2, but R4 fires only if a second active entry is registered in that same worktree. Either change the expected result to R2 or redefine R4 and provide the registry state that makes both rules fire.
- Store the immutable dispatch base SHA and integration ref in the registry. `start --run` currently does not define how "the integration branch" is selected, validated, or kept stable between waves.
- Make `gc --apply` registry-scoped for destructive actions. Unregistered worktrees may be reported, but must not be removed automatically under D8.
- Move the `CLAUDE.md:292` correction from P4 to P1. Known-unsafe guidance must not remain authoritative during the advisory soak period.
- Promotion cannot be based on a vacuous sample. Two bundles with zero high-severity firings do not validate the high-severity classifiers. Require deliberate negative probes for every blocking rule and a minimum observed sample before switching to block mode.

### 13.7 Required gate-hygiene corrections

The pnpm mutex wrapper does not serialize direct `pnpm install` calls, and a gate preflight check alone races with an install that starts after the check. Define how direct installs are redirected or rejected, how the gate and installer coordinate for the full duration, and how a crashed owner leaves a safely recoverable stale lock (PID/start time, owner, acquisition time, and conservative recovery).

Likewise, "belongs to the current session" is not currently derivable from a process cwd. Define process ownership/registration, PID-reuse protection, termination order (`TERM`, bounded wait, then optional `KILL`), and the approval boundary for `--force`. Until attribution is reliable, abort-and-report is acceptable; killing is not.

### 13.8 Approval conditions

This design is ready for re-review when:

1. the cherry-pick/reaper contradiction is resolved and covered by a different-SHA cherry-pick test;
2. registry updates are canonical, serialized, atomic, and agent-identity aware;
3. the hook's enforceable scope and bypass boundary are stated accurately;
4. reaping requires explicit ownership release and atomic expected-tip deletion;
5. the Git-hook installation, pnpm lock, process attribution, R2/R4 expectation, GC scope, and promotion criteria above are specified; and
6. the unsafe `CLAUDE.md` guidance is corrected in P1.
