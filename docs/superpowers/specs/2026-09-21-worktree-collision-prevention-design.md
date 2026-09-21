# Worktree Collision Prevention — Design

**Date:** 2026-09-21
**Revision:** Rev 2 — §13 review findings folded into the normative body; §14 maps each finding to its resolution
**Status:** Design; awaiting re-review against §13.8's six approval conditions
**Scope:** Agent-team execution hygiene — worktree isolation, git-op guardrails, worktree lifecycle, gate-run hygiene

Sections 1–12 are the normative design. §13 is the Rev-1 review, retained verbatim as the historical record. §14 is the resolution map. Where §13 and §§1–12 appear to disagree, §§1–12 win: they carry the resolved decisions.

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

- `git worktree list` reported **54 worktrees** at the start of this design session; 50 under `.claude/worktrees/`, the rest under `/tmp`. `--porcelain` reported **0 prunable**, so `git worktree prune` is not the remedy. A later count during the same session read 41/37 after two `worktree add`/`remove` operations triggered git's lazy pruning of stale administrative entries — and 13 directories also disappeared without this session removing them, most plausibly the harness auto-cleaning unchanged `isolation: "worktree"` agent worktrees. **The cause is unconfirmed.** The reaper must therefore not assume it is the only actor that removes worktrees (§7.2, proof 3 re-checks existence immediately before acting).
- Worktree-per-agent is already the dominant pattern (Bundles 4, 5, 6, 6.1 and SCN Phase 3.2 all dispatched one isolated worktree per task). Bundle 3 — eight agents in ONE worktree — is the outlier that produced the git-index race.
- The harness already exposes `Agent(isolation: "worktree")` and `EnterWorktree`, so isolation is available by flag today.
- `.harness/` is gitignored scratch (`.gitignore:66`), already used for the permission ledger.

The gap is therefore not knowledge of the rule. Nothing *stops* a shared-worktree dispatch, and nothing stops an unsafe git op once one exists.

## 2. Goals and non-goals

**Goals**

1. Make one-worktree-per-concurrent-writer the path of least resistance, with tooling that creates and registers worktrees.
2. Detect collision-class git operations **issued as direct Claude `Bash`, `Write`, or `Edit` tool calls**, with enough context to name the owner of the affected path, and record them. This goal is deliberately bounded by §4.2's observation boundary: operations reaching git by any other route are out of enforcement reach and are addressed by dispatch design and documentation, not by detection.
3. Start advisory (warn + log, never block), and promote to hard block only on evidence that includes deliberate negative probes (§6.3).
4. Reclaim worktrees automatically once their work has demonstrably landed, under proof, using operations that are safer than the ones the repo's branch-discipline rules currently restrict.
5. Remove the two known resource-contention noise sources (stray dev servers, concurrent pnpm installs).

**Non-goals**

- No daemon, no lock service, no serialization of agent execution. The guard observes; the dispatch tooling prevents.
- No change to how tasks are reviewed, cherry-picked, or gated.
- No `git branch -D`, automated or otherwise, anywhere in this design (§7.2.1).
- No removal of any worktree or ref that fails proof.
- No claim of exhaustive git-operation detection (§4.2, §6.2).

## 3. Decisions

Normative for the implementation plan.

| ID | Decision |
|---|---|
| D1 | Enforcement is delivered as **guardrails in the harness**, not documentation alone. Convention has already failed twice. |
| D2 | The guard ships **advisory first** — warn and log, never block — and is promoted to hard block only against ledger evidence including negative probes. |
| D3 | Both dispatch mechanisms stay legal: the explicit script for multi-task bundles (named branches, registry, cherry-pick ordering) and harness-native `isolation: "worktree"` for single throwaway tasks. |
| D4 | Worktrees are cleaned up after their work lands, by a **controller-run reaper** plus a GC sweep at `/harness-retro`. The agent cannot do this itself — it exits before the controller cherry-picks and re-gates. |
| D5 | Automated removal requires proof (§7.2). Anything failing proof is reported, never removed. |
| D6 | The implementation is a `PreToolUse` `Bash`/`Write`/`Edit` hook backed by a run registry, with a git `pre-commit` backstop. Git-native hooks alone were rejected: git has no `pre-reset` or `pre-checkout` hook, so it is structurally blind to the operation that caused I2. Its enforceable scope is bounded by §4.2. |
| D7 | Scope includes the worktree backlog triage, gate-run process hygiene, pnpm-store serialization, and the `CLAUDE.md` corrections. |
| D8 | **(Rev 2, replaces Rev 1's `-D` rule.)** Integration stays cherry-pick-based. Reap proof is patch-equivalence — zero `+` lines from `git cherry -v <integrationRef> <taskTip> <baseSha>` — and branch deletion uses **compare-and-delete**: `git update-ref -d refs/heads/<branch> <taskTip>`. `git branch -d` is HEAD-relative and refuses every reap while the integration branch is unchecked-out; `git branch -D` discards the safety check entirely. `update-ref -d <ref> <oldvalue>` does neither: it deletes only if the ref still points at the proven tip, closing the time-of-check/time-of-use window in the same operation. |
| D9 | **The registry has exactly one writer: the dispatch/reaper CLI, run by the controller.** Hooks never mutate it. Everything a hook observes — `adhoc` worktree sightings, session binding, rule firings — is appended to the JSONL ledger instead. This removes the concurrent read-modify-write class by construction rather than mitigating it with locks. |
| D10 | Ownership identity is **the worktree path**, assigned at dispatch. Session and process identifiers are recorded as observations and may inform warnings, but never establish or transfer ownership. |
| D11 | Reaping requires an **explicit terminal ownership release** recorded in the registry by the controller. Process-liveness and ledger-quiescence checks are supplementary signals, never the gate. |

## 4. Verified platform contracts and the observation boundary

### 4.1 Verified

Checked against this machine's runtime, not assumed:

- **Hook payload.** `.claude/hooks/permission-ledger.mjs` (live in this repo, registered in `.claude/settings.json` on `PermissionRequest` and `PostToolUse`, matcher `Bash`) reads a JSON payload from stdin carrying `tool_name`, `cwd`, `session_id`, `tool_use_id`, `permission_mode`, `hook_event_name`, and `tool_input.command`. The documented input schema for Claude Code 2.1.278 lists only `session_id`, `tool_name`, `tool_input`, and `tool_response`; the additional fields above are observed in the live hook. **`agent_id` / `agent_type` are not verified present on this runtime and this design does not depend on them** — see D10.
- **Hook output.** On `PreToolUse`, 2.1.278 supports `hookSpecificOutput.additionalContext` ("Context injected back to model"), `hookSpecificOutput.permissionDecision` (`allow` | `deny` | `ask`) with `permissionDecisionReason`, and top-level `systemMessage` shown to the user. Advisory mode therefore reaches agent and human without blocking, and promotion to blocking changes one emitted field.
- **Shared git directory.** `git rev-parse --git-common-dir` executed inside a linked worktree returns the primary `/Users/shubhamkr/network-optimization-studio/.git`, while `--git-dir` returns the per-worktree subdirectory. The common dir is therefore the canonical anchor for shared scratch state (§5.1).
- **Compare-and-delete.** Verified in a throwaway repository: `git update-ref -d refs/heads/feat <wrong-sha>` fails with `cannot lock ref 'refs/heads/feat': is at <actual> but expected <wrong>`, while the same command with the correct tip deletes the ref. This is a true atomic compare-and-delete and is the mechanism D8 relies on.
- **`core.hooksPath`** is currently unset and `.githooks/` does not exist in this repository.

### 4.2 Observation boundary (normative)

`PreToolUse` observes a Claude tool call. For `Bash` it sees the outer `tool_input.command` string; it is **not** a recursive interceptor of child processes. Therefore:

- A git command executed *inside* a script, a `pnpm` task, or a Node/TypeScript process invoked by a Bash tool call is **not** separately observable. The guard sees `pnpm harness:worktree reap --task T3`, not the `update-ref` the reaper runs internally. No self-exemption mechanism is required or provided.
- Git reached through an alias, a wrapper script, or a human terminal is outside the hook's reach. The `pre-commit` backstop (§5.5) covers commits from those routes and nothing else, and is itself bypassable with `--no-verify` (§6.1, R7).
- File writes performed through Bash redirection rather than the `Write`/`Edit` tools are not observed as writes; they are observed only if the surrounding command matches a classified pattern.

This boundary is stated in the dispatch preamble and in `CLAUDE.md` so that no operator believes coverage is total.

## 5. Components

Three new files plus one installed git config.

### 5.1 Run registry — single-writer, canonical location

Path: `<git-common-dir>/../.harness/worktrees/registry.json`, resolved by every actor through `git rev-parse --git-common-dir` so that linked worktrees and the primary checkout name the same file. A relative `.harness/...` path is never used for shared state.

```jsonc
{
  "schemaVersion": 1,
  "runId": "bundle7-2026-09-21",
  "primaryCheckout": "/Users/shubhamkr/network-optimization-studio",
  "integrationRef": "refs/heads/main",
  "integrationRefResolvedAt": "2026-09-21T10:00:00Z",
  "active": true,
  "entries": [
    {
      "taskId": "T3",
      "branch": "bundle7-T3-work",
      "worktree": "/Users/shubhamkr/network-optimization-studio/.claude/worktrees/bundle7-T3",
      "agent": "frontend-engineer",
      "baseSha": "7406fb2...",
      "taskTip": null,
      "landedShas": [],
      "solePaths": ["artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx"],
      "locked": true,
      "status": "active"
    }
  ]
}
```

`status` ∈ `active` | `adhoc` | `released` | `landed` | `reaped`. `baseSha` is the immutable dispatch base. `taskTip` and `landedShas` are recorded by the controller at release and integration time respectively.

**Writer discipline (D9).** The CLI is the only writer. Every mutation is a read-modify-write under an advisory lock held by that single process, written through a same-filesystem temporary file plus `rename()`. Concurrent runs are refused: `start` fails if `active` is true for a different `runId`, printing the holder. Hooks open the registry **read-only**.

**Integration ref.** `start --run <id> [--integration <ref>]` resolves and stores `integrationRef` (default `refs/heads/main`) and records `integrationRefResolvedAt`. Waves within a run share it; changing it requires an explicit `start --force` that rewrites the registry and is ledgered.

### 5.2 Guard hook — `.claude/hooks/worktree-guard.mjs`

Registered on `PreToolUse` with matchers `Bash` and `Write|Edit`. Reads payload → resolves the acting worktree from `cwd` (or `tool_input.file_path`) against `git worktree list --porcelain` → reads the registry → classifies (§6) → appends one ledger line → in advisory mode emits `additionalContext` plus `systemMessage` and exits 0.

Invariants, matching the existing ledger hook: dependency-free ESM, 2-second stdin timeout, whole body in `try/catch`, exits 0 on every path in advisory mode, emits nothing for unclassified commands, and **never writes the registry**.

### 5.3 Guard ledger — append-only JSONL

Path: `<git-common-dir>/../.harness/worktrees/guard-ledger.jsonl`. One line per classified operation or observation:

```jsonc
{"at":"...","sessionId":"...","toolUseId":"...","cwd":"...","worktree":"...","taskId":"T3","verb":"reset","rule":"rewrite_op","severity":"high","wouldBlock":true,"override":false,"command":"git reset HEAD~1"}
{"at":"...","event":"adhoc_sighting","worktree":"/private/tmp/x","sessionId":"..."}
```

Single-line appends under `PIPE_BUF` are the same atomicity assumption the existing permission ledger already relies on. This file is the evidence base for promotion (§6.3) and the input to a retro's near-miss count.

### 5.4 Harness CLI — `scripts/src/harness/worktree.ts`

Root alias `pnpm harness:worktree`, matching the existing `harness:record` / `harness:permissions` / `harness:report` pattern. Subcommands: `install`, `start`, `add`, `release`, `land`, `reap`, `gc`, `report`.

### 5.5 Git backstop — `pre-commit`

`pnpm harness:worktree install` sets `core.hooksPath` to a tracked `.githooks/` directory. The step is **idempotent and non-destructive**: if `core.hooksPath` is already set to something else, it refuses and reports rather than replacing; if it is already correct, it verifies the hook file is present and executable. `start` fails if the backstop is expected but inactive.

The hook resolves registry and ledger paths through `git rev-parse --git-common-dir` (never a relative path) and performs the one check git can make at commit time: refuse a commit whose staged set contains a path owned by a different `active` registry entry. It is blind to `reset`, `checkout`, and `stash` by git's design, and is bypassable with `git commit --no-verify` — both limits are documented rather than papered over.

## 6. Detection rules

### 6.1 Rule table

`wouldBlock` marks rules that deny once promoted (§6.3). In advisory mode nothing blocks.

| # | Rule | Fires when | Severity | wouldBlock |
|---|---|---|---|---|
| R1 | `rewrite_op` | `git reset`, `rebase`, `stash*`, `commit --amend`, `checkout <branch>`, `switch`, `checkout --`, `restore`, `clean`, `push --force*`, `branch -D`, `update-ref -d` without an expected-oldvalue argument — in **any** worktree, registry active or not | high | yes |
| R2 | `shared_checkout_write` | cwd is `primaryCheckout` and a run is active, and the command is `git commit` / `add` / `merge` / `cherry-pick`; or a `Write`/`Edit` targets a file under `primaryCheckout` | high | yes |
| R3 | `foreign_path` | the command or edit touches a path in another active entry's `solePaths`, or cwd is another entry's worktree | high | yes |
| R4 | `cohabited_commit` | `git commit` in a worktree where a second entry is also `active` — with or without a pathspec | high | yes |
| R5 | `unregistered_worktree` | cwd is a worktree absent from the registry while a run is active | medium | no |
| R6 | `chained_suites` | one Bash command chains two or more test-suite invocations (`vitest`, `pytest`, `playwright`) with `&&` | low | no |
| R7 | `verify_bypass` | `git commit --no-verify` / `-n`, i.e. an explicit request to skip the §5.5 backstop | high | yes |
| R8 | `unsanctioned_install` | a direct `pnpm install` during an active run that does not hold the §8.3 lock | medium | no |
| R9 | `opaque_git_context` | a git command whose acting worktree cannot be resolved — `git -C <path>`, a set `GIT_WORK_TREE`/`GIT_DIR`, a shell chain or newline-joined command, or an alias the classifier cannot expand | medium | no |

Never classified, never warned: read-only git (`status`, `log`, `diff`, `show`, `cherry`, `worktree list`, `rev-parse`), and any operation inside an agent's own registered worktree touching only its own paths. The guard must be invisible on the happy path, or agents will route around it.

### 6.2 Rule notes

**R1 is armed unconditionally.** History rewriting was never safe in a shared worktree and is a poor recovery tool even in a private one — I2 destroyed a commit while an agent tried to tidy up after itself. The emitted guidance is *escalate, do not self-recover*. No exemption exists for the reaper: per §4.2 its internal ref deletion is not a separate tool call, and per D8 it uses compare-and-delete rather than `branch -D` in any case.

**R4 does not recommend a pathspec.** Per §1, both commit forms leak. The guidance is "another writer is active in this worktree — stop and escalate," never "use `git commit -- <paths>`."

**R5 does not nag.** Harness-native `isolation: "worktree"` (D3) produces worktrees the registry never saw. The hook records an `adhoc_sighting` in the ledger; promotion of that sighting into a registry entry is the CLI's job at the next `start`/`report`, never the hook's (D9).

**R9 replaces a false claim.** Rev 1 implied exhaustive git-op detection. It is not achievable within §4.2's boundary, so an unresolvable context is classified honestly at medium severity and never silently treated as safe.

**Path matching for `solePaths`** is normative: patterns are repository-relative, matched with POSIX glob semantics (`*` does not cross `/`, `**` does), compared after `realpath` resolution so a symlink cannot smuggle a write outside the owner's tree, and applied to non-existent targets by normalizing the intended path rather than failing. For `git commit`, the inspected set is the staged set; for `git commit -a`, the staged set **union** the modified tracked set; for a pathspec commit, the expansion of that pathspec against the working tree.

**Escape hatch, visible by construction.** `WORKTREE_GUARD=off <command>` suppresses the warning and writes an `override: true` ledger record carrying the full command. Escapes stay possible and stay countable; a guard that can be bypassed silently rots. There is no privileged bypass for any tool or script — an environment value a human can type is not proof of caller identity.

### 6.3 Promotion from advisory to blocking

Mode lives in `<git-common-dir>/../.harness/worktrees/config.json` as `{"mode": "advisory" | "block"}`, read by the hook on every invocation.

Promotion requires **all** of:

1. at least two completed bundles of advisory soak;
2. a deliberate negative probe executed and ledgered for **every** `wouldBlock` rule (R1, R2, R3, R4, R7) — a rule that has never fired has not been validated, and a silent soak is a vacuous sample;
3. every high-severity firing in the soak window classified as true positive or explicitly dispositioned;
4. zero unexplained high-severity overrides.

On promotion, high-severity hits emit `permissionDecision: "deny"` with the rule's reason; medium and low severity stay advisory permanently.

## 7. Worktree lifecycle

### 7.1 Dispatch

```
pnpm harness:worktree install                 # idempotent core.hooksPath + backstop verification
pnpm harness:worktree start --run bundle7 [--integration refs/heads/main]
pnpm harness:worktree add --task T3 --agent frontend-engineer --paths <globs>
```

`start` writes the registry, resolves and stores `integrationRef`, and sets `active: true`; it refuses if another run is active. `add` creates branch `<run>-<task>-work` off the integration ref, records `baseSha`, adds the worktree under `.claude/worktrees/<run>-<task>`, applies `git worktree lock` (matching the repo's standing protection rule), writes the entry, and prints the dispatch preamble:

- the agent's worktree path and branch, stated as the only place it may write;
- the base guard already learned during the JADE bundle — `git merge-base --is-ancestor <integration-tip> HEAD` before starting, reporting `BASE_OK` — which exists because two agents there forked off a stale base 61 commits behind merged `main`;
- its `solePaths` list;
- the rewrite ban with *escalate, do not self-recover*;
- the §4.2 boundary, stated plainly: the guard sees direct tool calls only, so the rules are the agent's responsibility, not the hook's guarantee;
- "run your gate one suite per command", and "install dependencies only via `pnpm harness:worktree install-deps`" (§8.3).

### 7.2 Release, land, reap

Three explicit transitions replace Rev 1's implicit one.

1. **`release --task T3 --tip <sha>`** — the controller records that the agent has finished and the branch is frozen at `taskTip`. Status → `released`. This is the ownership-release gate (D11).
2. **`land --task T3 --commits <sha>...`** — after cherry-picking and re-gating, the controller records the commit SHAs that actually landed on the integration ref. Status → `landed`.
3. **`reap --task T3`** — removal, only if all five gating proofs pass. A sixth item is recorded as a supplementary signal and never gates:

   1. the entry's status is `landed` (explicit release and integration both recorded);
   2. `git cherry -v <integrationRef> <taskTip> <baseSha>` emits **zero `+` lines** — every commit the task introduced after its base has a patch-equivalent on the integration ref. This is the cherry-pick-correct proof; `--is-ancestor` is *not* used, because a cherry-pick necessarily produces different SHAs and ancestry never holds;
   3. the branch ref still resolves to exactly the recorded `taskTip`, and the worktree path still exists (§1 notes another actor may already have removed it);
   4. `git -C <worktree> status --porcelain` is empty;
   5. the path resolves (realpath) inside an allowed root and is not `primaryCheckout`;
   *(supplementary, recorded but never gating)* no live process has that path as its cwd, and no other `sessionId` appears in the ledger for that worktree within 10 minutes. Per D11 these inform the printed report; they cannot block or authorize a reap.

   On success, in order: `git worktree unlock <path>` → `git worktree remove <path>` → `git update-ref -d refs/heads/<branch> <taskTip>`. Never `rm -rf`. Any proof failure prints the failing check and removes nothing.

### 7.2.1 Branch deletion — why neither `-d` nor `-D` is used (D8)

Found by dogfooding Rev 1's reaper: `git branch -d` validates merged-ness against **the current worktree's HEAD**, not against the integration branch. With the branch fully contained in `main` and the integration proof passing, `-d` still refused:

```
error: the branch 'worktree-collision-prevention' is not fully merged
```

because the acting checkout's HEAD was an unrelated branch. Since the integration branch is normally not checked out in any worktree here, a `-d`-only rule fails on *every* reap. Rev 1's response — escalate to `-D` — was wrong for a different reason: it discards git's check without replacing it, and it opens a time-of-check/time-of-use window between proving the tip and deleting the ref.

Rev 1's dogfood also could not have caught this, because that integration was a fast-forward `git push . <branch>:main` — the one shape where ancestry holds. The repo's real workflow is cherry-pick, where it never does.

**Resolution.** Deletion is `git update-ref -d refs/heads/<branch> <taskTip>`, verified on this machine to delete only when the ref still points at the expected SHA and to fail loudly otherwise. It is strictly safer than `-D` (which checks nothing) and strictly more applicable than `-d` (which checks the wrong base), and it closes the TOCTOU window in the same operation. `git branch -D` appears nowhere in this design, so `CLAUDE.md`'s existing second-approval rule for it needs no exception.

### 7.3 GC sweep

`pnpm harness:worktree gc` applies the §7.2 proofs to registry entries. **Dry-run by default.** `--apply` is **registry-scoped**: it may remove only entries whose status is `landed` and whose proofs pass. Unregistered worktrees and `adhoc` sightings are *reported only* and never removed automatically, since nothing establishes what work they hold. Wired into `/harness-retro` as the straggler sweep.

### 7.4 Backlog triage of existing worktrees

`pnpm harness:worktree report` classifies every existing worktree and writes `.harness/worktrees/report-<date>.md`:

- **reapable** — registry-scoped, `landed`, all proofs pass;
- **patch-equivalent but unregistered** — `git cherry` shows no `+` lines against the integration ref, but no registry entry exists; listed for human decision, never auto-removed;
- **unmerged with unique commits** — lists the `+` commits;
- **dirty working tree** — lists modified files;
- **broken** — missing branch, missing directory, or unreadable.

The report removes nothing. It lives in `.harness/` rather than `docs/superpowers/metrics/`: the metrics store is a six-CSV append-only ledger with a documented contract, and a one-off triage artifact does not warrant a seventh CSV.

## 8. Gate-run hygiene

### 8.1 Foreign processes

`pnpm harness:gate` preflights by listing `vite`, `vitest`, `playwright`, and `pnpm dev` processes whose cwd resolves under any repo worktree. **A process cwd does not establish session ownership**, so the default is *abort and report*, never kill. Processes started through the harness record `{pid, startTime, worktree, sessionId}` in the ledger; attribution is claimed only for those, and PID reuse is guarded by comparing recorded process start time.

`--force` is a human-approval boundary, not an agent convenience: it terminates the listed processes with `TERM`, waits a bounded interval, and escalates to `KILL` only for processes that recorded attribution. Unattributed processes are never killed.

This targets the flake class already documented in `CLAUDE.md`: `resultEnvelope.test.ts` and `cors` failures under CPU contention, twice root-caused to orphaned dev servers rather than code.

### 8.2 One suite per command

The gate runs each suite as its own invocation rather than chaining them with `&&`, so a failure is attributable to a suite and a flake to a run. R6 flags chained invocations advisorily.

### 8.3 pnpm store serialization

Installs run through `pnpm harness:worktree install-deps`, which acquires a lock at `<git-common-dir>/../.harness/locks/pnpm-install.lock` (a `mkdir`-based lock, portable on macOS, which lacks `flock`) and holds it for the install's full duration. The lock directory contains `{pid, processStartTime, owner, worktree, acquiredAt}`; a lock whose PID is dead **or** whose recorded start time no longer matches that PID is recoverable, and recovery is ledgered.

The gate **acquires the same lock for its own duration** rather than checking once, which is what closes the race in which an install starts immediately after a preflight check. A direct `pnpm install` during an active run bypasses this and is classified as R8 — advisory, because a blanket block on `pnpm install` would be more disruptive than the failure it prevents, and because the gate's own lock already protects the result being trusted.

This targets the Bundle 4 incident where four agents' concurrent installs churned the shared store mid-test and produced transient unresolvable-import failures across 11 test files.

## 9. Documentation changes

Three edits to `CLAUDE.md`, **all landed in P1** (§11) — known-unsafe guidance must not stay authoritative through an advisory soak:

1. **Replace the incorrect lesson at line 292.** The current text instructs agents in a shared worktree to commit with an explicit pathspec. Replacement states that no commit form is safe alongside another writer, and that the rule is one worktree per concurrent writer.
2. **Add to Hard rules:** one worktree per concurrent writer; the controller is a writer too — "sequential dispatch" does not exempt the controller from the rule while an agent is running.
3. **Amend Branch discipline** to record the proof-gated automated path: registry-scoped worktrees may be removed automatically when the §7.2 proofs pass, and task branch refs are deleted with compare-and-delete against the proven tip. `git branch -D` remains forbidden without second approval, unchanged — this design does not use it. Also state the §4.2 observation boundary so no one reads the guard as total coverage.

## 10. Testing

| Layer | What |
|---|---|
| Classifier | Pure-function tests: `(command, registry state, cwd)` → `{rule, severity, wouldBlock}`, covering every rule, the read-only allowlist, `solePaths` glob/realpath/non-existent-target semantics, `commit` vs `commit -a` vs pathspec set selection, and R9's unresolvable contexts (`git -C`, `GIT_WORK_TREE`, chains, aliases). |
| Registry | Single-writer concurrency tests: two CLI invocations racing a mutation lose nothing; an interrupted write leaves the previous file intact (temp + rename); `start` refuses a second active run; hooks opening the registry never mutate it. |
| Hook | Smoke tests piping real payload JSON, asserting exit 0, expected `additionalContext`, and a well-formed ledger line; malformed-payload, missing-registry, and unreadable-registry cases assert exit 0 with no output and no mutation. |
| Reaper | Temp-repo matrix: **a cherry-pick that deliberately produces a different SHA from the task commit must reap successfully**; each of the five gating proofs fails independently and removes nothing; an idle-but-unreleased owner blocks reaping; a branch ref advanced between proof and deletion causes `update-ref -d` to fail and the worktree to survive; an already-removed worktree directory is handled without error. |
| Backstop | `pre-commit` refuses a staged path owned by another active entry and allows the owner's own path; `install` refuses to overwrite a pre-existing different `core.hooksPath`; `start` fails when the backstop is inactive; `--no-verify` is classified as R7. |
| Negative probes | One deliberate reproduction per `wouldBlock` rule, retained as the promotion evidence required by §6.3 — including a bare `git commit` in `primaryCheckout` with a run active. |
| Gate hygiene | Stale-lock recovery (dead PID, and live PID with mismatched start time); gate holding the lock for its duration; unattributed process never killed under `--force`. |

## 11. Phasing

| Phase | Contents |
|---|---|
| P1 | `CLAUDE.md` corrections (§9, all three); registry + single-writer CLI (`install`, `start`, `add`); guard hook in advisory mode; classifier and registry tests. |
| P2 | `release` / `land` / `reap` / `gc` / `report`; backstop install; backlog triage run. |
| P3 | Gate hygiene wrapper, `install-deps` lock, process attribution. |
| P4 | Negative probes executed and ledgered; promotion review against §6.3. |

## 12. Acceptance criteria

1. Dispatching a bundle task through `pnpm harness:worktree add` produces a locked, registered worktree, a named branch, a recorded `baseSha`, and a dispatch preamble — with no manual `git worktree add`.
2. `git reset HEAD~1` issued in any worktree produces a guard warning naming R1 and instructing escalation, plus a ledger record — without blocking, in advisory mode.
3. A bare `git commit` in `primaryCheckout` while a run is active fires **R2**. It fires R4 **additionally** only in the registry state where a second entry is `active` in that same worktree; both cases are asserted separately.
4. `reap` removes a task's worktree and branch after `release` + `land`, where the landed commit SHA **differs** from the task commit SHA (the normal cherry-pick case), and removes nothing when any of the five gating proofs fails, naming the failing check.
5. `report` classifies all existing worktrees into the five buckets without removing anything; `gc --apply` removes only registry-scoped `landed` entries.
6. A gate run reports foreign dev-server processes and aborts by default, and holds the install lock for its full duration.
7. `CLAUDE.md:292`'s pathspec guidance is gone in P1, replaced per §9.
8. The §4.2 observation boundary is stated in the dispatch preamble and `CLAUDE.md`, and no rule or document claims exhaustive git-operation detection.

---

## 13. Written-spec review (Codex, 2026-09-21)

*Retained verbatim as the Rev-1 review record. Resolutions are folded into §§1–12; see §14 for the mapping.*

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

---

## 14. Review resolution (Rev 2, 2026-09-21)

Every §13 finding is accepted on substance. Two are resolved by a mechanism stronger than the one proposed; one sub-recommendation is rejected as unverifiable on this runtime and replaced. Nothing is deferred.

| Finding | Resolution | Where |
|---|---|---|
| 13.1 cherry-pick vs ancestry | Accepted, option 2. Proof is zero `+` from `git cherry -v <integrationRef> <taskTip> <baseSha>`; `baseSha`/`taskTip`/`integrationRef`/`landedShas` are registry fields; deletion is compare-and-delete. Rev 1's dogfood is explained: it integrated by fast-forward, the only shape where ancestry holds. | D8, §5.1, §7.2, §7.2.1, §10 (different-SHA cherry-pick test), §12.4 |
| 13.2 registry concurrency | Accepted, resolved more strongly: the registry has **one writer** (the CLI); hooks are read-only and append observations to the JSONL ledger instead, removing the read-modify-write race by construction. Canonical path via `git rev-parse --git-common-dir` (verified). Temp-file + rename, single active run enforced. | D9, §5.1, §5.3, §10 (registry tests) |
| 13.2 sub-point: use `agent_id`/`agent_type` | **Rejected as unverifiable.** Those fields are not confirmed present on 2.1.278; the documented input schema lists only `session_id`, `tool_name`, `tool_input`, `tool_response`. Ownership is instead keyed on **worktree path**, assigned at dispatch; session identifiers are observations only. | D10, §4.1 |
| 13.3 observation boundary | Accepted. Goal 2 and D6 narrowed to direct `Bash`/`Write`/`Edit` calls; the boundary is written out and repeated in the dispatch preamble and `CLAUDE.md`. `WORKTREE_GUARD=reaper` removed — it was unnecessary, and moot once `branch -D` left the design. | Goal 2, D6, §4.2, §6.2, §7.1, §9.3 |
| 13.4 ownership release | Accepted. Explicit `release` → `land` → `reap` transitions; process and ledger checks demoted to supplementary; worktrees locked at dispatch and unlocked immediately before removal; TOCTOU closed by compare-and-delete. | D11, §7.1, §7.2, §10 (idle-owner and advanced-ref tests) |
| 13.5 guard/backstop | Accepted, all five. Idempotent non-destructive `install`; R7 classifies `--no-verify` with the residual limit stated; canonical paths from `--git-common-dir`; full `solePaths` matching semantics; R9 replaces the exhaustiveness claim. | §5.5, §6.1 (R7, R9), §6.2, §10 |
| 13.6 lifecycle/acceptance | Accepted, all five. Criterion 3 split into R2-only and R2+R4 cases; `baseSha`/`integrationRef` stored; `gc --apply` registry-scoped; `CLAUDE.md` moved to P1; promotion requires negative probes per blocking rule. | §5.1, §6.3, §7.3, §9, §11, §12.3 |
| 13.7 gate hygiene | Accepted. Installs go through a lock the gate also holds for its full duration; stale-lock recovery keyed on PID **and** process start time; direct installs classified R8; process attribution registered at spawn, abort-and-report by default, `--force` a human boundary that never kills unattributed processes. | §8.1, §8.3, §6.1 (R8), §10 |

**§13.8 conditions:** 1 → D8/§7.2/§10; 2 → D9/D10/§5.1; 3 → §4.2; 4 → D11/§7.2; 5 → §5.5/§8.3/§8.1/§12.3/§7.3/§6.3; 6 → §9/§11.
