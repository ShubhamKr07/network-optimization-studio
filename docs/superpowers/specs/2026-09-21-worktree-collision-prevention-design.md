# Worktree Collision Prevention — Design

**Date:** 2026-09-21
**Revision:** Rev 4 — §17 re-review findings folded into the normative body; §18 maps each finding to its resolution
**Status:** Design; awaiting re-review against §17.8's six conditions
**Scope:** Agent-team execution hygiene — worktree isolation, git-op guardrails, worktree lifecycle, gate-run hygiene

Sections 1–12 are the normative design. §13, §15, and §17 are the successive reviews, retained verbatim as the historical record; §14, §16, and §18 are their resolution maps. Where a review section and §§1–12 appear to disagree, §§1–12 win: they carry the resolved decisions. Among resolution maps the latest wins (§18 > §16 > §14).

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
| D8 | **(Rev 2, replaces Rev 1's `-D` rule.)** Integration stays cherry-pick-based. Reap proof is patch-equivalence — zero `+` lines from `git cherry -v <runIntegrationRef> <taskTip> <baseSha>` (Rev 4 narrowed this from the target ref to the run's own ref, D16) — and branch deletion uses **compare-and-delete**: `git update-ref -d refs/heads/<branch> <taskTip>`. `git branch -d` is HEAD-relative and refuses every reap while the integration branch is unchecked-out; `git branch -D` discards the safety check entirely. `update-ref -d <ref> <oldvalue>` does neither: it deletes only if the ref still points at the proven tip, closing the time-of-check/time-of-use window in the same operation. |
| D9 | **The registry has exactly one writer: the dispatch/reaper CLI, run by the controller.** Hooks never mutate it. Everything a hook observes — `adhoc` worktree sightings, actor observations, rule firings — is written to the per-call event ledger instead (D14, §5.3). This removes the concurrent read-modify-write class by construction rather than mitigating it with locks. |
| D10 | **(Rev 3, replaces Rev 2's path-only rule.)** Each entry carries **both** a worktree path and an actor identity bound at dispatch. The hook compares the payload's `agent_id` (verified present in 2.1.278's hook-payload field list, §4.1) against the entry's bound actor, so "a different actor is acting inside T3's worktree" is decidable. Path partitioning remains the primary mechanism; actor identity is what makes R3's foreign-worktree clause enforceable. If the P1 probe (§11) finds `agent_id` unpopulated for a caller class, R3's cwd clause is **dropped** for that class and the guard is documented as path-partitioning only — never silently assumed. |
| D11 | Reaping requires an **explicit terminal ownership release** recorded in the registry by the controller. Process-liveness and ledger-quiescence checks are supplementary signals, never the gate. |
| D12 | **The controller is a registered writer with its own worktree.** `start` creates and registers a controller-owned **integration worktree** (`role: "integration"`), and all cherry-picking, re-gating, and `land` work happens there. `primaryCheckout` is write-free while a run is active, so R2 stays strict with no controller exception, no pause state, and no temporary ownership transfer. This applies the design's own thesis to the controller instead of carving it out — and structurally prevents I4, which was a controller commit in the shared checkout. |
| D13 | **Reap order is detach → compare-and-delete → remove**, not remove-then-delete. The worktree's `HEAD` is first detached at the proven `taskTip` (a same-SHA detach changes no file), then the ref is deleted with compare-and-delete, then the worktree is removed. A lost race therefore fails with **nothing removed**: the ref survives, the worktree survives, and recovery is a single `git -C <wt> switch <branch>`. Both paths are verified in §7.2.1. |
| D14 | The guard ledger is **one immutable event file per tool call**, folded at report time — not concurrent appends to a shared JSONL. Rev 2's `PIPE_BUF` justification was wrong (it bounds pipe writes, not Node's regular-file append), and ledger records carry unbounded command strings. Final identity is `<tool_use_id>-<hook_event_name>` with the timestamp inside the payload (D19). |
| D15 | **(Rev 4.)** Ownership is a **role- and state-aware predicate**, not a path list comparison. A `task` entry owns its `solePaths` while `active` or `released`. The `integration` entry owns **its own worktree, not repository paths**; it may touch a task's paths only once that task is `released`, and only from inside the integration worktree. R3 and the `pre-commit` backstop evaluate the *same* predicate — one implementation, two callers. Rev 3 gave the integration entry `solePaths: ["**"]`, which made the controller the owner of every task file and would have blocked all task work before integration began. |
| D16 | **(Rev 4.)** The run's integration branch and the real destination are **separate refs with separate lifecycles**: `targetRef` (+ `targetBaseSha`) is where work ultimately lands; `runIntegrationRef` is the run's own branch, created from the target at `start`. `add` bases each new task on the **current `runIntegrationRef` tip**, so later waves include earlier landed work; reap proves patch-equivalence against `runIntegrationRef`, not the target. A `finish` transition (§7.5) advances the target and tears the run down. `finish` **refuses** when the target is checked out in any worktree, because `git update-ref` does not refuse this itself (§7.5). |
| D17 | **(Rev 4.)** Actor identity is bound by an explicit controller transition `bind --task <id> --actor <agent_id>` **after** the spawn, since `add` necessarily runs before the agent exists and hooks are read-only (D9). Until an entry is bound, R3's actor clause is inactive for it (path partitioning still applies) and R10 surfaces activity in an unbound worktree. That the identifier returned by the spawn equals the `agent_id` in hook payloads is **not yet verified**; P0 proves the equality, and D10's fallback applies if it fails. |
| D18 | **(Rev 4.)** `reap` is a **state machine with rollback at every step after unlock**, not a linear happy path. `git worktree remove` can fail *after* the ref is deleted (a file appearing after proof 4 is enough), so each step defines its compensation, every failure path relocks the worktree, and an unrecoverable rollback produces a loud `reap_partial_failure` with exact recovery commands — never a success report. See §7.2.3. |
| D19 | **(Rev 4.)** One event file per tool call carries a **`matches[]` array**, not a singular `rule`: a single call can match several rules (a bare commit in the primary checkout can be both R2 and R4), which Rev 3's schema could not express. Promotion (§6.3) **fails closed** while any malformed or truncated event in the soak window is unresolved. |
| D20 | **(Rev 4.)** The gate **samples the process table periodically across its interval** and retains the observations. The guarantee is stated narrowly: direct Claude calls (R8 events) plus install processes observed in a sample. An install that begins and ends entirely between two samples is **not** observable, and no part of this design claims otherwise. |

## 4. Verified platform contracts and the observation boundary

### 4.1 Verified

Checked against this machine's runtime, not assumed:

- **Hook payload.** `.claude/hooks/permission-ledger.mjs` (live in this repo, registered in `.claude/settings.json` on `PermissionRequest` and `PostToolUse`, matcher `Bash`) reads a JSON payload from stdin carrying `tool_name`, `cwd`, `session_id`, `tool_use_id`, `permission_mode`, `hook_event_name`, and `tool_input.command`. The *documentation* bundled with 2.1.278 lists only `session_id`, `tool_name`, `tool_input`, and `tool_response`, but the binary's own hook-payload common-field list is:

```js
["hook_event_name","session_id","transcript_path","cwd","scratchpad_dir",
 "prompt_id","permission_mode","agent_id","agent_type","served_call",
 "caller_session_id","effort"]
```

**`agent_id` and `agent_type` are therefore part of the hook input on this runtime** — Rev 2 asserted the opposite from the documentation excerpt alone and was wrong. Presence in the field list is *not* proof of population for every caller (a main-session call may legitimately carry no `agent_id`), so P1 includes a probe task (§11) that records the actually-populated fields for a main-session call and a subagent call, with the D10 fallback if a class is unpopulated.
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
  "targetRef": "refs/heads/main",
  "targetBaseSha": "45026bf...",
  "runIntegrationRef": "refs/heads/bundle7-integration",
  "resolvedAt": "2026-09-21T10:00:00Z",
  "active": true,
  "entries": [
    {
      "taskId": "T3",
      "role": "task",
      "branch": "bundle7-T3-work",
      "worktree": "/Users/shubhamkr/network-optimization-studio/.claude/worktrees/bundle7-T3",
      "agent": "frontend-engineer",
      "actorId": null,
      "boundAt": null,
      "baseSha": "7406fb2...",
      "taskTip": null,
      "landedShas": [],
      "solePaths": ["artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx"],
      "locked": true,
      "status": "active"
    },
    {
      "taskId": "__integration__",
      "role": "integration",
      "branch": "bundle7-integration",
      "worktree": "/Users/shubhamkr/network-optimization-studio/.claude/worktrees/bundle7-integration",
      "agent": "controller",
      "actorId": null,
      "boundAt": null,
      "solePaths": [],
      "locked": true,
      "status": "active"
    }
  ]
}
```

`role` ∈ `task` | `integration`. `status` ∈ `active` | `adhoc` | `released` | `landed` | `reaped` | `reap_partial_failure` (§7.2.3). `baseSha` is the dispatch base, taken from the **current `runIntegrationRef` tip** so later waves include earlier landed work (D16). `taskTip` and `landedShas` are recorded at `release` and `land`. `actorId`/`boundAt` are written by `bind` after the spawn (D17), never at `add`.

### 5.1.1 Ownership predicate (D15)

Ownership is evaluated, not string-matched against a path list. For an actor A acting on path P from worktree W:

```
ownsTaskPath(entry, P)      := entry.role == "task"
                               && entry.status in {active, released}
                               && P matches entry.solePaths
ownsWorktree(entry, W)      := realpath(W) == realpath(entry.worktree)
controllerMayTouch(P)       := acting from the integration worktree
                               && the task entry owning P has status in {released, landed}
```

A task edits and commits its own `solePaths` freely while `active`, regardless of the integration entry existing. The integration entry's `solePaths` is **empty**: it owns its worktree, not repository paths. Rev 3 gave it `["**"]`, which made the controller nominal owner of every task file and would have classified all task work as `foreign_path` before integration ever began.

R3 (§6.1) and the `pre-commit` backstop (§5.5) call **the same predicate implementation**. Two copies of this logic would drift, and the drift would be silent.

`primaryCheckout` appears in no entry and is writable by nobody while `active` is true.

**Writer discipline (D9).** The CLI is the only writer. Every mutation is a read-modify-write under an advisory lock held by that single process, written through a same-filesystem temporary file plus `rename()`. Concurrent runs are refused: `start` fails if `active` is true for a different `runId`, printing the holder. Hooks open the registry **read-only**.

**Registry lock, with recovery.** The lock is a `mkdir`-based directory at `<git-common-dir>/../.harness/worktrees/registry.lock` containing `{pid, processStartTime, owner, acquiredAt}` — the same discipline as the install lock (§8.3), because a CLI crash while holding it would otherwise permanently block `release`, `land`, and `reap`. A lock whose PID is dead, **or** whose recorded `processStartTime` no longer matches that PID (guarding PID reuse), is recoverable; recovery is ledgered with the stale owner's metadata. A lock held by a live, matching PID is never broken — the CLI reports the holder and exits non-zero.

**Refs (D16).** `start --run <id> [--target <ref>]` resolves and stores `targetRef` (default `refs/heads/main`) plus the `targetBaseSha` it pointed at, then creates `runIntegrationRef` from it and records `resolvedAt`. All waves in a run share both. Changing the target mid-run requires an explicit `start --force` that rewrites the registry and is ledgered. The target is not touched again until `finish` (§7.2.4).

### 5.2 Guard hook — `.claude/hooks/worktree-guard.mjs`

Registered on `PreToolUse` with matchers `Bash` and `Write|Edit`. Reads payload → resolves the acting worktree from `cwd` (or `tool_input.file_path`) against `git worktree list --porcelain` → reads the registry → classifies (§6) → appends one ledger line → in advisory mode emits `additionalContext` plus `systemMessage` and exits 0.

Invariants, matching the existing ledger hook: dependency-free ESM, 2-second stdin timeout, whole body in `try/catch`, exits 0 on every path in advisory mode, emits nothing for unclassified commands, and **never writes the registry**.

### 5.3 Guard ledger — one immutable event file per tool call (D14)

Directory: `<git-common-dir>/../.harness/worktrees/events/`. Each tool call produces **one** record whose final name is `<tool_use_id>-<hook_event_name>.json` — a stable identity, with the timestamp **inside** the payload (D19). Rev 3 put the timestamp in the filename, which defeated the very deduplication it claimed: a retry of the same `tool_use_id` got a different name, so `wx` never saw a collision. Writes go to a temporary file in the same directory and are promoted by exclusive rename, so a crash mid-write leaves a temp file that folding ignores rather than a truncated record squatting the final name.

```jsonc
{"at":"...","sessionId":"...","agentId":"...","toolUseId":"...","hookEvent":"PreToolUse",
 "cwd":"...","worktree":"...","taskId":"T3","verb":"reset",
 "matches":[{"rule":"rewrite_op","severity":"high","wouldBlock":true},
            {"rule":"cohabited_commit","severity":"high","wouldBlock":true}],
 "override":false,"command":"git reset HEAD~1","commandTruncated":false}
```

`matches[]` is an array because one call can match several rules — a bare commit in the primary checkout is both R2 and R4, which acceptance criterion 3 requires and Rev 3's singular `rule` field could not represent.

Rev 2 justified concurrent appends to a shared JSONL by `PIPE_BUF`. That was wrong: `PIPE_BUF` bounds atomic writes to pipes and FIFOs, and is not a guarantee Node's regular-file append API provides — and these records carry an unbounded `command` string, so no small-write assumption holds anyway. One file per `tool_use_id` needs no lock, cannot interleave, and loses nothing if a hook process dies mid-write (a truncated file is detected and reported at fold time rather than corrupting neighbours).

`command` is recorded up to a stated byte bound (4 KiB) with `commandTruncated: true` when clipped. `report` and the promotion review (§6.3) fold the directory into a single ordered view; folding is read-only.

The existing `permission-ledger.mjs` JSONL remains as-is — it is prior art for hook mechanics, not evidence that concurrent appends are safe.

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
| R3 | `foreign_path` | the ownership predicate (§5.1.1) says the actor does not own the touched path — i.e. `ownsTaskPath` fails for the actor's own entry and `controllerMayTouch` does not apply; **or** the acting `agent_id` differs from the `actorId` bound to the worktree it is acting in (active only for a **bound** entry whose caller class P0 shows carries a populated `agent_id`; dropped otherwise, per D10/D17) | high | yes |
| R4 | `cohabited_commit` | `git commit` in a worktree where a second entry is also `active` — with or without a pathspec | high | yes |
| R5 | `unregistered_worktree` | cwd is a worktree absent from the registry while a run is active | medium | no |
| R6 | `chained_suites` | one Bash command chains two or more test-suite invocations (`vitest`, `pytest`, `playwright`) with `&&` | low | no |
| R7 | `verify_bypass` | `git commit --no-verify` / `-n`, i.e. an explicit request to skip the §5.5 backstop | high | yes |
| R8 | `unsanctioned_install` | a direct `pnpm install` during an active run that does not hold the §8.3 lock. Advisory, but an R8 event whose timestamp falls inside a recorded gate interval **invalidates that gate's result** (§8.3) | medium | no |
| R10 | `unbound_worktree_activity` | a tool call inside a registered `task` worktree whose entry has no `actorId` yet (dispatched but never `bind`-ed, D17) | medium | no |
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
4. zero unexplained high-severity overrides; and
5. **zero unresolved malformed or truncated event records** in the soak window — promotion fails closed, because a soak whose evidence is partially unreadable cannot establish that the classifiers were right (D19).

On promotion, high-severity hits emit `permissionDecision: "deny"` with the rule's reason; medium and low severity stay advisory permanently.

## 7. Worktree lifecycle

### 7.1 Dispatch

```
pnpm harness:worktree install                 # idempotent core.hooksPath + backstop verification
pnpm harness:worktree start --run bundle7 [--target refs/heads/main]
pnpm harness:worktree add  --task T3 --agent frontend-engineer --paths <globs>
pnpm harness:worktree bind --task T3 --actor <agent_id>       # after the spawn
```

`start` writes the registry, resolves and stores `targetRef` + `targetBaseSha`, creates `runIntegrationRef` (`<run>-integration`) from the target, **creates and registers the controller's integration worktree** (D12) on that branch, and sets `active: true`; it refuses if another run is active. From that moment the controller works in its own worktree; `primaryCheckout` is written by nobody until `finish`.

`add` bases the task branch on the **current `runIntegrationRef` tip** (D16), not on the target, so a second wave inherits everything landed by the first. It writes the entry with `actorId: null`.

`bind` is a separate transition because `add` must create the worktree and print the preamble *before* the agent exists, so the generated `agent_id` cannot be known at `add` time, and hooks cannot fill it in (D9 makes them read-only). The controller records the identifier the spawn returned. Until an entry is bound, R3's actor clause is inactive for it and R10 flags activity in that worktree — dispatch without binding is visible, not silently unguarded. `add` creates branch `<run>-<task>-work` off the integration ref, records `baseSha`, adds the worktree under `.claude/worktrees/<run>-<task>`, applies `git worktree lock` (matching the repo's standing protection rule), writes the entry, and prints the dispatch preamble:

- the agent's worktree path and branch, stated as the only place it may write;
- the base guard already learned during the JADE bundle — `git merge-base --is-ancestor <integration-tip> HEAD` before starting, reporting `BASE_OK` — which exists because two agents there forked off a stale base 61 commits behind merged `main`;
- its `solePaths` list;
- the rewrite ban with *escalate, do not self-recover*;
- the §4.2 boundary, stated plainly: the guard sees direct tool calls only, so the rules are the agent's responsibility, not the hook's guarantee;
- "run your gate one suite per command", and "install dependencies only via `pnpm harness:worktree install-deps`" (§8.3).

### 7.2 Release, land, reap

Three explicit transitions replace Rev 1's implicit one.

1. **`release --task T3 --tip <sha>`** — the controller records that the agent has finished and the branch is frozen at `taskTip`. Status → `released`. This is the ownership-release gate (D11).
2. **`land --task T3 --commits <sha>...`** — the controller cherry-picks the released branch **into `runIntegrationRef`, in its own integration worktree** (D12/D16), re-gates there, and records the commit SHAs that actually landed. Status → `landed`. Because this happens in a registered worktree the controller owns, and the task is `released` (so `controllerMayTouch` holds, §5.1.1), it is an ordinary owner operation: R2 never sees it, no override is needed, and the path is identical in advisory and block mode.
3. **`reap --task T3`** — removal, only if all five gating proofs pass. A sixth item is recorded as a supplementary signal and never gates:

   1. the entry's status is `landed` (explicit release and integration both recorded);
   2. `git cherry -v <runIntegrationRef> <taskTip> <baseSha>` emits **zero `+` lines** — every commit the task introduced after its base has a patch-equivalent on the integration ref. This is the cherry-pick-correct proof; `--is-ancestor` is *not* used, because a cherry-pick necessarily produces different SHAs and ancestry never holds;
   3. the branch ref still resolves to exactly the recorded `taskTip`, and the worktree path still exists (§1 notes another actor may already have removed it);
   4. `git -C <worktree> status --porcelain` is empty;
   5. the path resolves (realpath) inside an allowed root and is not `primaryCheckout`;
   *(supplementary, recorded but never gating)* no live process has that path as its cwd, and no other `sessionId` appears in the ledger for that worktree within 10 minutes. Per D11 these inform the printed report; they cannot block or authorize a reap.

   On success, in this order (D13):

   ```
   git worktree unlock <path>
   git -C <path> switch --detach <taskTip>        # same-SHA detach: no file changes
   git update-ref -d refs/heads/<branch> <taskTip> # compare-and-delete
   git worktree remove <path>
   ```

   Never `rm -rf`. Any proof failure prints the failing check and removes nothing. Each of the four mutating steps has a defined compensation — see §7.2.3; §7.2.1 explains the deletion mechanism and §7.2.2 the ordering.

### 7.2.1 Branch deletion — why neither `-d` nor `-D` is used (D8)

Found by dogfooding Rev 1's reaper: `git branch -d` validates merged-ness against **the current worktree's HEAD**, not against the integration branch. With the branch fully contained in `main` and the integration proof passing, `-d` still refused:

```
error: the branch 'worktree-collision-prevention' is not fully merged
```

because the acting checkout's HEAD was an unrelated branch. Since the integration branch is normally not checked out in any worktree here, a `-d`-only rule fails on *every* reap. Rev 1's response — escalate to `-D` — was wrong for a different reason: it discards git's check without replacing it, and it opens a time-of-check/time-of-use window between proving the tip and deleting the ref.

Rev 1's dogfood also could not have caught this, because that integration was a fast-forward `git push . <branch>:main` — the one shape where ancestry holds. The repo's real workflow is cherry-pick, where it never does.

**Resolution.** Deletion is `git update-ref -d refs/heads/<branch> <taskTip>`, verified on this machine to delete only when the ref still points at the expected SHA and to fail loudly otherwise. It is strictly safer than `-D` (which checks nothing) and strictly more applicable than `-d` (which checks the wrong base), and it closes the TOCTOU window in the same operation. `git branch -D` appears nowhere in this design, so `CLAUDE.md`'s existing second-approval rule for it needs no exception.

### 7.2.2 Ordering — why detach comes first (D13)

Rev 2 removed the worktree *before* deleting the ref. If the branch advanced in between, compare-and-delete correctly refused — but the worktree was already gone, contradicting D5's "anything failing proof is reported, never removed."

Two candidate fixes were rejected:

- **Compensate by recreating the worktree** after a failed delete. This is silent data loss: `git worktree remove` deletes the directory including *ignored* files, so `node_modules`, `.env`, and build caches do not come back. A recreated worktree restores tracked files only, while reporting success at restoring "the worktree."
- **Delete the ref first, unchanged.** `git update-ref -d` will happily delete a branch that is still checked out, leaving that worktree's `HEAD` pointing at a missing ref.

**Adopted: detach first.** Detaching the worktree at the already-proven `taskTip` changes no file (same SHA), and afterwards the branch is no longer checked out anywhere, so the ref deletion is safe and the removal happens only after the ref is gone. Verified on this machine — failure path, with the branch advanced between proof and delete:

```
$ git -C <wt> switch --detach <taskTip>
$ git update-ref -d refs/heads/task <taskTip>
error: cannot lock ref 'refs/heads/task': is at 9b547b4 but expected df6fe03
worktree still present: YES    branch still present: 1
$ git -C <wt> switch task          # full recovery, one command
Switched to branch 'task'
```

and the success path:

```
$ git -C <wt> switch --detach <taskTip>
$ git update-ref -d refs/heads/task <taskTip>   → ref deleted
$ git worktree remove <wt>                      → removed; branch count 0
```

The internal `switch --detach` is issued by the CLI, not as a Claude tool call, so per §4.2 it is outside the guard's observation boundary and trips no rule — no exemption is required or provided.

### 7.2.3 Reap state machine and rollback (D18)

Detach-first fixes the *advanced-ref* race but not every failure. `git worktree remove` can fail **after** the ref was successfully deleted — a single file appearing after proof 4 is enough:

```
fatal: '<worktree>' contains modified or untracked files, use --force to delete it
branch present: no      worktree present: yes (detached HEAD, late file intact)
```

The commit stays reachable from the detached worktree, so this is recoverable — but Rev 3 reported it as success, left the worktree unlocked, and left the named branch gone. Rev 3 also left the worktree unlocked on detach and compare-delete failure. Each mutating step therefore defines its compensation:

| Step | On failure | Resulting state |
|---|---|---|
| `worktree unlock` | abort before any mutation | unchanged, entry stays `landed` |
| `switch --detach <taskTip>` | relock; leave branch untouched | unchanged, entry stays `landed` |
| `update-ref -d <ref> <taskTip>` | reattach (`switch <branch>`), relock | branch and worktree intact, entry stays `landed` |
| `worktree remove` | recreate the ref at `taskTip` with an **expected-absent** compare, reattach, relock | branch restored, worktree intact, entry stays `landed` |

The rollback recreate uses git's expected-absent form, verified on this machine:

```
$ git update-ref refs/heads/gone <tip> ""      → created
$ git update-ref refs/heads/gone <tip> ""      → fatal: cannot lock ref 'refs/heads/gone': reference already exists
```

so a rollback cannot silently overwrite a ref that reappeared under a colliding name.

If any compensation itself fails, the entry is set to **`reap_partial_failure`** and the CLI prints the exact recovery commands for the observed state, exits non-zero, and never reports success. `gc` refuses to touch an entry in that state; a human clears it.

### 7.2.4 `finish` — advancing the target and tearing the run down (D16)

`pnpm harness:worktree finish` ends a run. It:

1. requires **every** `task` entry to be terminal (`reaped`, or `landed` and explicitly deferred); a `reap_partial_failure` entry blocks `finish`;
2. verifies `targetRef` still resolves to `targetBaseSha`. If it moved, `finish` stops and reports the divergence — reconciliation is a human decision (fast-forward if the run branch contains the new target tip, otherwise rebase/merge by hand), never an automatic rewrite;
3. **refuses if `targetRef` is checked out in any worktree**, naming the holder;
4. advances the target with compare-and-update `git update-ref <targetRef> <runIntegrationTip> <targetBaseSha>`;
5. sets `active: false`; and
6. reaps the integration worktree through the §7.2.3 state machine and deletes `runIntegrationRef` with compare-and-delete.

Step 3 exists because **git does not protect this itself.** Verified on this machine:

```
$ git update-ref refs/heads/task <newer>     # 'task' checked out in another worktree
update-ref on checked-out branch: SUCCEEDED (no refusal)
```

The ref moves and the holding worktree's index and working tree are silently desynchronized from its own `HEAD`. `git push . <branch>:<ref>` *does* refuse the same operation — which is how this spec's own merges were blocked for three revisions while `main` sat checked out in the `jade-ch9` worktree. `finish` must therefore perform the check that `update-ref` omits, and use the refusal as the model for its own behaviour.

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

The gate **acquires the same lock for its own duration** rather than checking once. That alone does not stop a direct `pnpm install`, which never asks for the lock — Rev 2 claimed otherwise and was wrong. The gate therefore also **records its lock interval** `{gateId, acquiredAt, releasedAt}`, and at completion checks that interval against the event directory and the process table:

- any R8 event timestamped inside the interval, **or**
- any unattributed `pnpm install` process seen in one of the gate's **periodic process-table samples** taken across the interval (D20) — a single completion-time snapshot cannot see an install that started and finished while the gate ran, so sampling replaces it

**invalidates the gate result.** The gate reports `INVALIDATED — concurrent install` with the offending evidence and exits non-zero; it never prints a green result it cannot stand behind. R8 stays advisory rather than blocking, because a blanket block on `pnpm install` is more disruptive than the failure it prevents, and invalidation already removes the only consequence that matters — a red or green run that was never trustworthy.

**Stated limit (D20).** The guarantee covers direct Claude tool calls (R8 events) plus install processes present in at least one sample. An install that begins and ends entirely between two samples is not observable by this mechanism, and nothing in this design claims otherwise. Shortening the sample interval narrows that window; it does not close it.

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
| Registry | Single-writer concurrency tests: two CLI invocations racing a mutation lose nothing; an interrupted write leaves the previous file intact (temp + rename); `start` refuses a second active run; hooks opening the registry never mutate it. Lock recovery: dead-PID lock is recovered and ledgered; a live matching PID is never broken; a reused PID with a mismatched `processStartTime` is treated as stale. |
| Ledger | Parallel-hook stress test: N concurrent hook processes each write their own event file; every event is independently parseable, none lost, none clobbered; a deliberately truncated temp file is ignored at fold time without affecting neighbours; an over-bound command is stored truncated with `commandTruncated: true`. **Retry identity:** the same `tool_use_id`+`hookEvent` retried produces exactly one final record, not two. **Multi-rule:** one bare commit in the primary checkout yields one record whose `matches[]` contains both R2 and R4. **Fail-closed:** an unresolved malformed event in the soak window blocks promotion. |
| Integration path | An ordinary task cherry-pick through the controller's integration worktree completes in **both advisory and block mode with no override**, and fires no rule; a cherry-pick attempted from `primaryCheckout` while a run is active still fires R2. |
| Ownership predicate | An `active` task edits **and commits** its own `solePaths` while the integration entry exists — no R3, no backstop refusal; the controller touching that path **before** release is denied; **after** release it is allowed from the integration worktree and denied from anywhere else. R3 and the backstop are asserted to call the same predicate implementation. |
| Run/target refs | Two dependent waves: wave 2's task branch contains wave 1's landed work, and a wave-2 reap proves patch-equivalence against `runIntegrationRef` while that work is still absent from the target. `finish` refuses a target that moved from `targetBaseSha`, refuses a target checked out in another worktree (naming the holder), and otherwise advances it with compare-and-update. |
| Binding | An unbound entry has R3's actor clause inactive and fires R10 on activity; a mismatched actor in a bound worktree fires R3 and is denied after promotion; a correctly bound actor fires nothing. |
| Actor identity | Probe fixture records which caller classes populate `agent_id`; with it populated, a different actor issuing a tool call from a registered worktree is classified R3 and denied after promotion; with it unpopulated, the cwd clause is inactive and the rule degrades to path partitioning without false positives. |
| Hook | Smoke tests piping real payload JSON, asserting exit 0, expected `additionalContext`, and a well-formed ledger line; malformed-payload, missing-registry, and unreadable-registry cases assert exit 0 with no output and no mutation. |
| Reaper | Temp-repo matrix: **a cherry-pick that deliberately produces a different SHA from the task commit must reap successfully**; each of the five gating proofs fails independently and removes nothing; an idle-but-unreleased owner blocks reaping; **a branch ref advanced after the detach causes `update-ref -d` to fail with the worktree still present and the branch intact, and `git -C <wt> switch <branch>` restores it**; an already-removed worktree directory is handled without error; a detach that itself fails aborts before any deletion. **Injected failure at each mutating step** (§7.2.3): a late untracked file makes `worktree remove` fail after ref deletion and the rollback recreates the ref, reattaches, and relocks; a ref-name collision during rollback is caught by the expected-absent compare and produces `reap_partial_failure` with recovery commands rather than a silent overwrite; every failure path leaves the worktree **locked**. |
| Backstop | `pre-commit` refuses a staged path owned by another active entry and allows the owner's own path; `install` refuses to overwrite a pre-existing different `core.hooksPath`; `start` fails when the backstop is inactive; `--no-verify` is classified as R7. |
| Negative probes | One deliberate reproduction per `wouldBlock` rule, retained as the promotion evidence required by §6.3 — including a bare `git commit` in `primaryCheckout` with a run active. |
| Gate hygiene | Stale-lock recovery (dead PID, and live PID with mismatched start time); gate holding the lock for its duration; unattributed process never killed under `--force`; **a direct `pnpm install` started after the gate acquires the lock causes the gate to report `INVALIDATED` and exit non-zero, never a trusted result**. |

## 11. Phasing

| Phase | Contents |
|---|---|
| P0 | **Hook-payload probe.** A throwaway `PreToolUse` hook records the fully-populated payload for a main-session call and for a subagent call, establishing which caller classes carry `agent_id`/`agent_type`. Its result selects the D10 branch (actor-bound R3, or path-partitioning-only) before any rule is written. |
| P1 | `CLAUDE.md` corrections (§9, all three); **backstop implementation *and* activation** (`install`, `.githooks/pre-commit`, `core.hooksPath`) — landed before the first `start`, so §5.5's invariant is satisfiable from the outset; registry + single-writer CLI (`install`, `start`, `add`) including the integration worktree; guard hook in advisory mode; classifier, registry-lock, and ledger-concurrency tests. |
| P2 | `bind` / `release` / `land` / `reap` (with the §7.2.3 rollback machine) / `finish` / `gc` / `report`; multi-wave and target-ref tests; backlog triage run. |
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
9. The controller lands an ordinary task — cherry-pick, re-gate, `land` — through its own integration worktree in **block mode with no override and no rule firing**, while a cherry-pick attempted from `primaryCheckout` during the same run still fires R2.
10. When the branch advances between the detach and the compare-and-delete, `reap` exits non-zero with the ref error, the worktree still present, and the branch intact; `git -C <wt> switch <branch>` restores the prior state in one command.
11. A direct `pnpm install` started after the gate takes the install lock causes the gate to exit non-zero as `INVALIDATED`, naming the overlapping evidence.
12. N concurrent hook processes produce N independently parseable event files with none lost or clobbered, and a dead-PID registry lock is recovered while a live one is never broken.
13. An `active` task edits and commits its own `solePaths` with the integration entry present and no rule fires; the controller is denied that path before release and allowed after it, only from the integration worktree.
14. Wave 2's task branch contains wave 1's landed work, and a wave-2 `reap` succeeds while that work is still absent from `targetRef`.
15. `finish` refuses a `targetRef` that is checked out in another worktree, naming the holder, and refuses one that moved off `targetBaseSha`; otherwise it advances the target by compare-and-update and tears down the integration worktree and run ref.
16. A late untracked file that makes `worktree remove` fail **after** ref deletion triggers the rollback: the ref is recreated at `taskTip`, the worktree is reattached and **relocked**, the entry stays `landed`, and the command exits non-zero. A failed rollback reports `reap_partial_failure` with recovery commands.
17. A retried tool call produces exactly one event record; a single bare commit in the primary checkout produces one record listing both R2 and R4; an unresolved malformed event blocks promotion.

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
| 13.2 sub-point: use `agent_id`/`agent_type` | ~~Rejected as unverifiable.~~ **SUPERSEDED by §16 (15.3).** Rev 2 inferred absence from the bundled documentation excerpt instead of probing the runtime, and was wrong: both fields are in 2.1.278's hook-payload common-field list. Actor identity is now bound at dispatch and compared per call. | D10, §4.1, §16 |
| 13.3 observation boundary | Accepted. Goal 2 and D6 narrowed to direct `Bash`/`Write`/`Edit` calls; the boundary is written out and repeated in the dispatch preamble and `CLAUDE.md`. `WORKTREE_GUARD=reaper` removed — it was unnecessary, and moot once `branch -D` left the design. | Goal 2, D6, §4.2, §6.2, §7.1, §9.3 |
| 13.4 ownership release | Accepted. Explicit `release` → `land` → `reap` transitions; process and ledger checks demoted to supplementary; worktrees locked at dispatch and unlocked immediately before removal; TOCTOU closed by compare-and-delete. | D11, §7.1, §7.2, §10 (idle-owner and advanced-ref tests) |
| 13.5 guard/backstop | Accepted, all five. Idempotent non-destructive `install`; R7 classifies `--no-verify` with the residual limit stated; canonical paths from `--git-common-dir`; full `solePaths` matching semantics; R9 replaces the exhaustiveness claim. | §5.5, §6.1 (R7, R9), §6.2, §10 |
| 13.6 lifecycle/acceptance | Accepted, all five. Criterion 3 split into R2-only and R2+R4 cases; `baseSha`/`integrationRef` stored; `gc --apply` registry-scoped; `CLAUDE.md` moved to P1; promotion requires negative probes per blocking rule. | §5.1, §6.3, §7.3, §9, §11, §12.3 |
| 13.7 gate hygiene | Accepted. Installs go through a lock the gate also holds for its full duration; stale-lock recovery keyed on PID **and** process start time; direct installs classified R8; process attribution registered at spawn, abort-and-report by default, `--force` a human boundary that never kills unattributed processes. | §8.1, §8.3, §6.1 (R8), §10 |

**§13.8 conditions:** 1 → D8/§7.2/§10; 2 → D9/D10/§5.1; 3 → §4.2; 4 → D11/§7.2; 5 → §5.5/§8.3/§8.1/§12.3/§7.3/§6.3; 6 → §9/§11.

---

## 15. Rev 2 written-spec re-review (Codex, 2026-09-21)

**Decision: changes requested; Rev 2 is not yet approved for implementation.** Rev 2 resolves the original cherry-pick/ancestry contradiction, narrows the hook observation boundary honestly, makes registry mutation single-writer, introduces explicit ownership release, and moves the unsafe `CLAUDE.md` correction into P1. Three approval blockers and four important design inconsistencies remain.

### 15.1 Blocker: R2 prevents the controller's specified integration workflow

R2 classifies `git cherry-pick` from `primaryCheckout` as a high-severity, eventually blocking operation whenever a run is active (§6.1). The lifecycle simultaneously requires the controller to cherry-pick and re-gate before `land` (§7.2), and the run remains active throughout that sequence. No controller identity, registered integration worktree, pause state, or temporary ownership transfer makes the legitimate cherry-pick distinguishable from the collision R2 is intended to stop.

The result is an operational deadlock in block mode. In advisory mode, every normal landing is a high-severity false positive, so §6.3's requirement that high-severity firings be true positives also prevents promotion.

**Required resolution:** define an executable integration path. Acceptable shapes include:

1. `start` creates and registers a dedicated controller-owned integration worktree, and the rules explicitly allow that owner to integrate released task branches there; or
2. the lifecycle includes a controller-claim transition that can occur only after every writer in `primaryCheckout` is released, with R2 keyed to that state.

The implementation tests must exercise an ordinary task cherry-pick through the chosen path in both advisory and block modes without an override.

### 15.2 Blocker: reaper ordering cannot satisfy its advanced-ref test

§7.2 specifies this success order:

```
git worktree unlock <path>
git worktree remove <path>
git update-ref -d refs/heads/<branch> <taskTip>
```

If the branch advances between proof 3 and the final `update-ref`, compare-and-delete correctly fails, but the worktree has already been removed. This contradicts §10's required test that an advanced ref makes deletion fail **and the worktree survive**, as well as D5's "anything failing proof is reported, never removed" intent.

This was reproduced in a throwaway repository: after worktree removal, advancing the branch caused `update-ref -d ... <old-tip>` to fail with the expected ref-mismatch error while the worktree path remained missing and the advanced branch remained present. Reordering the ref deletion first is not a safe fix: `git update-ref -d` can delete a branch that is still checked out, leaving that worktree with `HEAD` pointing at a missing ref.

**Required resolution:** keep worktree removal before ref deletion, but specify a compensating transaction. If compare-and-delete fails, recreate the worktree at the still-present branch, relock it, leave the registry entry `landed`, and report the race; failure to compensate must be a loud partial-failure state with recovery instructions. Add tests for both successful compensation and compensation failure. Alternatively, narrow D5 and the acceptance test explicitly to permit removal of the clean, released worktree while guaranteeing that the advanced branch and commits remain intact.

### 15.3 Blocker: path-only identity cannot enforce R3's foreign-worktree clause

D10 defines ownership identity as the worktree path and says session/process identifiers never establish ownership. Under that model, if another agent accidentally changes cwd into T3's worktree, the classifier resolves the acting identity from that cwd and therefore treats the actor as T3. It cannot determine that the cwd is "another entry's worktree," as R3 claims.

**Required resolution:** either:

1. remove the unenforceable cwd clause from R3 and state plainly that the guard enforces path partitioning, not actor-to-worktree binding; or
2. bind an actor identifier explicitly at dispatch/controller acknowledgement and compare it on each hook call. Before rejecting `agent_id`/`agent_type`, add a runtime probe on the pinned Claude Code version; current Claude Code documentation states that subagent tool-hook inputs carry those fields. A controller-assigned `sessionId` binding is also acceptable if it is explicit rather than first-caller-wins.

Any retained R3 actor/worktree rule needs a negative test where a different actor issues a tool call from a registered worktree and is denied after promotion.

### 15.4 Important: the pnpm mutex does not protect against the bypass it identifies

§8.3 says the gate holds the install mutex for its full duration, but a direct `pnpm install` does not acquire that mutex. Classifying the bypass as permanently advisory R8 does not prevent it from running concurrently with the gate, so the statement that the gate's lock protects the trusted result is false for the exact bypass under discussion.

**Required resolution:** while a gate is active, either make R8 blocking or record the gate interval and invalidate/abort the gate if any overlapping R8 event or unattributed install process is observed. The acceptance test must start a direct install after the gate acquires the lock and prove the gate cannot report a trusted result.

### 15.5 Important: JSONL append atomicity relies on the wrong primitive

§5.3 invokes `PIPE_BUF` to justify concurrent single-line appends, but `PIPE_BUF` is the atomicity bound for pipes/FIFOs, not a guarantee supplied by Node's regular-file append API. Ledger records also contain the full command and therefore have no stated maximum size. The existing permission ledger is precedent, not evidence that the promotion ledger cannot interleave or lose records under concurrent hook processes.

**Required resolution:** serialize guard-ledger appends with a recoverable lock, or write one immutable event file per `toolUseId` and fold them during reporting. Add a parallel-hook stress test that verifies every event remains independently parseable and none are lost.

### 15.6 Important: registry-lock crash recovery is unspecified

§5.1 requires registry mutations to hold an advisory lock, but unlike the pnpm lock it defines no owner metadata or stale-lock recovery. A controller or CLI crash while holding the lock can permanently prevent `release`, `land`, or `reap`.

**Required resolution:** give the registry lock the same `{pid, processStartTime, owner, acquiredAt}` discipline and conservative recovery rules as §8.3, and test dead-PID plus PID-reuse recovery.

### 15.7 Important: the phasing contradicts the backstop invariant

§5.5 says `start` fails when the pre-commit backstop is inactive. P1 includes `install`, `start`, and `add`, while P2 lists "backstop install." If that means the hook or its activation does not exist until P2, P1 cannot exercise its own dispatch flow.

**Required resolution:** implement and activate the backstop in P1 before the first successful `start`, or explicitly run P1 in an advisory bootstrap mode and state when the invariant becomes mandatory. The simpler resolution is to move the backstop implementation and activation entirely into P1.

### 15.8 Rev 2 approval-condition result

| Prior condition | Result | Reason |
|---|---|---|
| §13.8.1 cherry-pick/reaper proof | **Pass** | Patch-equivalence and different-SHA coverage replace the invalid ancestry proof. |
| §13.8.2 canonical, serialized, identity-aware registry | **Partial** | Canonical single-writer mutation is resolved; actor/worktree identity is not. |
| §13.8.3 accurate observation boundary | **Pass** | §4.2 and the dispatch/docs requirements state the boundary accurately. |
| §13.8.4 release + atomic expected-tip deletion | **Partial** | Explicit release and atomic ref deletion exist, but the worktree is removed before a failed compare-delete can be handled. |
| §13.8.5 backstop/gate/process/R2-R4/GC/promotion details | **Partial** | Most are specified; controller integration, direct-install overlap, ledger integrity, and phasing remain unresolved. |
| §13.8.6 unsafe guidance corrected in P1 | **Pass** | §9 and §11 now place all corrections in P1. |

### 15.9 Conditions for the next approval pass

Rev 2 is ready for another approval review when:

1. the controller can land a task through a non-overridden path in block mode;
2. the reaper specifies and tests consistent behavior when the ref advances after worktree removal;
3. R3 matches the identity information the implementation can actually observe;
4. a direct install cannot overlap a trusted gate result;
5. ledger and registry-lock concurrency have crash-safe, tested behavior; and
6. backstop installation and `start` occupy a coherent phase.

---

## 16. Rev 2 re-review resolution (Rev 3, 2026-09-21)

All seven §15 findings are accepted on substance. One Rev-2 decision is reversed against measured evidence; one resolution is replaced with a mechanism verified to be safer than either option offered. Nothing is deferred.

| Finding | Resolution | Where |
|---|---|---|
| 15.1 R2 deadlocks the controller | Accepted, shape 1. `start` creates and registers a **controller-owned integration worktree**; `land` cherry-picks and re-gates there. The controller becomes an ordinary registered writer rather than an exception, `primaryCheckout` is write-free during a run, R2 needs no softening, and the path is identical in advisory and block mode. | D12, §5.1, §7.1, §7.2, §10 (integration-path test), §12.9 |
| 15.2 reaper ordering vs advanced-ref test | Accepted; **both offered resolutions rejected** for a third. Compensation-by-recreate is silent data loss (`git worktree remove` destroys ignored files — `node_modules`, `.env` — which a recreated worktree cannot restore); narrowing D5 trades away the invariant under review. Adopted: **detach at the proven tip → compare-and-delete → remove**. A lost race removes nothing; recovery is one `switch`. Both paths verified on this machine. | D13, §7.2, §7.2.2, §10 (reaper matrix), §12.10 |
| 15.3 path-only identity cannot enforce R3 | Accepted, shape 2 — **and Rev 2's rejection of `agent_id` is reversed.** Probing the 2.1.278 binary shows `agent_id`/`agent_type` in the hook-payload common-field list; Rev 2 inferred absence from the bundled documentation excerpt and was wrong. Actor identity is bound at dispatch and compared per call, with a P0 probe establishing which caller classes populate it and an explicit fallback to path-partitioning-only if one does not. | D10, §4.1, §6.1 (R3), §11 (P0), §10 (actor-identity test) |
| 15.4 pnpm mutex does not stop the bypass | Accepted. The claim that the gate's lock protected the result was false. The gate now records its lock interval and **invalidates its own result** on any overlapping R8 event or unattributed install process, exiting non-zero rather than reporting a run it cannot stand behind. R8 stays advisory. | §6.1 (R8), §8.3, §10, §12.11 |
| 15.5 `PIPE_BUF` is the wrong primitive | Accepted. Justification removed. Ledger becomes **one immutable event file per `tool_use_id`**, created `wx`, folded read-only at report time; `command` bounded at 4 KiB with an explicit truncation flag. Parallel-hook stress test added. The existing permission ledger is prior art for hook mechanics only, not evidence of append safety. | D14, §5.3, §10 (ledger test), §12.12 |
| 15.6 registry-lock crash recovery | Accepted. Registry lock gets the same `{pid, processStartTime, owner, acquiredAt}` discipline and conservative recovery as the install lock, with dead-PID and PID-reuse tests; a live matching holder is never broken. | §5.1, §10 (registry tests), §12.12 |
| 15.7 phasing contradicts the backstop invariant | Accepted. Backstop implementation **and** activation move entirely into P1, ahead of the first `start`. A new P0 carries the payload probe, since D10's branch must be settled before rules are written. | §11 |

**§15.9 conditions:** 1 → D12/§7.2/§12.9; 2 → D13/§7.2.2/§12.10; 3 → D10/§4.1/§11 P0; 4 → §8.3/§12.11; 5 → §5.1/§5.3/§12.12; 6 → §11.

---

## 17. Rev 3 written-spec re-review (Codex, 2026-09-22)

**Decision: changes requested; Rev 3 is not yet approved for implementation.** Rev 3 resolves all seven §15 findings individually: it gives the controller an integration worktree, adopts detach-first reaping, makes actor identity conditional on a measured runtime probe, invalidates gates on observed install overlap, replaces shared JSONL appends with immutable event files, adds registry-lock recovery, and makes the P1 backstop invariant coherent. Their combined behavior exposes four new blockers and two important gaps.

### 17.1 Blocker: the integration entry reserves every task path

The integration entry is active for the run and declares `solePaths: ["**"]` (§5.1). R3 classifies a command or edit that touches another active entry's `solePaths` as `foreign_path` (§6.1). The pre-commit backstop likewise refuses a staged path owned by a different active entry (§5.5).

Taken literally, every task edit and every task commit touches a path owned by the active integration entry. The role intended to make controller integration safe therefore blocks all task work before integration begins.

**Required resolution:** make ownership checks role- and state-aware. The integration entry must not reserve task paths against task owners. A workable rule is:

- `task` entries own their `solePaths` while `active`;
- the `integration` entry owns the integration worktree, not every repository path;
- the controller may touch a task entry's paths only after that task is `released`, and only from the registered integration worktree; and
- the pre-commit backstop uses the same role/state predicate as R3.

Add tests proving an active task may edit and commit its own path while the integration entry exists, the controller is denied before release, and the controller is allowed after release.

### 17.2 Blocker: the run-integration branch and `integrationRef` are different refs but the lifecycle treats them as one

`start` stores the real `integrationRef` (default `refs/heads/main`) and creates `<run>-integration` from it. `land` cherry-picks task work into `<run>-integration`, while the real ref is advanced only at run end. However:

- `add` continues to create every task branch from the original `integrationRef`, so later waves do not include work already landed on `<run>-integration`;
- reap proof 2 runs `git cherry` against the original `integrationRef`, where the newly landed patch is absent until run end; and
- the CLI exposes no `finish` transition even though §7.2 says the run branch is fast-forwarded into the real ref "at run end, when `active` is false."

The current design therefore cannot support dependent waves or reap a newly landed task during an active run. It also does not define how the real destination ref is safely advanced if it moved independently or is checked out in another worktree.

**Required resolution:** store separate fields such as `targetRef`, `targetBaseSha`, and `runIntegrationRef`. `add` must base new-wave tasks on the current `runIntegrationRef` tip, and reap must prove patch-equivalence against `runIntegrationRef`. Add a `finish` transition that:

1. requires all task entries to be terminal;
2. verifies the target still points to `targetBaseSha` or otherwise applies an explicitly designed reconciliation rule;
3. advances the target using compare-and-update semantics without desynchronizing a worktree that has that target checked out;
4. sets `active: false`; and
5. safely removes the integration worktree and its temporary ref.

Tests must cover at least two dependent waves, a concurrently advanced target ref, and a target ref checked out in another worktree.

### 17.3 Blocker: no transition can bind the generated `agent_id`

The registry requires `actorId` to be bound at dispatch, but `add` must create the worktree and print the preamble before the subagent is spawned. The subagent's generated `agent_id` is therefore not available when `add` writes the entry. Hooks cannot fill it because D9 makes them read-only, and the CLI exposes no binding subcommand.

**Required resolution:** add an explicit controller-run transition such as `bind --task T3 --actor <agent_id>` after spawn. A task entry remains non-writable until bound; the controller records the ID returned by the spawn operation, and subsequent hook calls compare against it. Define equivalent binding for the main-session controller (using whichever field P0 proves stable). Add negative tests for an unbound task, a mismatched actor, and a correctly bound actor.

### 17.4 Blocker: detach-first reaping still has an unhandled post-delete partial failure

D13 correctly fixes the advanced-ref race: detach at `taskTip`, compare-delete the ref, then remove the worktree. But `git worktree remove` can fail after the ref was successfully deleted. A new untracked file appearing after proof 4 is sufficient.

This was reproduced in a throwaway repository:

```text
remove after successful ref delete: failed
fatal: '<worktree>' contains modified or untracked files, use --force to delete it
branch present: no
worktree present: yes
worktree state: HEAD (no branch), with the late untracked file intact
```

The commit remains reachable from the detached worktree, so this is recoverable, but it violates the design's proof-gated all-or-nothing lifecycle and leaves the worktree unlocked and the named branch absent. Detach or compare-delete failure similarly leaves the worktree unlocked unless the CLI explicitly relocks it.

**Required resolution:** specify the state machine and rollback for every step after unlock:

- on detach failure: relock and leave the branch untouched;
- on compare-delete failure: reattach to the surviving branch, relock, and leave the entry `landed`;
- on worktree-remove failure after ref deletion: recreate the ref at `taskTip` with an expected-absent compare, reattach, relock, and leave the entry `landed`; and
- if any rollback step fails, record a loud `reap_partial_failure` state with exact recovery commands and never report success.

Add tests that inject failure at each step, including a late untracked file and a ref-name collision during rollback.

### 17.5 Important: event-file naming does not provide the stated retry deduplication

Event filenames are `<ISO-timestamp>-<tool_use_id>.json`. A retry of the same `tool_use_id` at a later time receives a different filename because the timestamp changed, so `wx` does not prevent a duplicate record. Conversely, a crash that leaves a truncated final file can permanently occupy that exact name without a defined retry or fail-closed promotion rule.

The event schema also contains a singular `rule`, while acceptance criterion 3 expects one call to fire both R2 and R4.

**Required resolution:** use a stable final identity derived from `tool_use_id` plus the hook event, keep the timestamp inside the payload, and write through a temporary file into an exclusively-created final record. Define whether one tool call contains a `matches[]` array or one event per matched rule. Promotion must fail closed while any malformed/truncated event in the soak window is unresolved.

### 17.6 Important: the final process-table check cannot observe a completed unattributed install

§8.3 detects direct Claude installs through R8 event files. For unattributed processes it checks the process table at gate completion. A human-terminal or nested-script install that starts and finishes entirely during the gate leaves neither an R8 event nor a live process at completion, so it remains invisible.

**Required resolution:** either monitor the process table throughout the gate interval and retain observations, or narrow the guarantee explicitly to direct observed Claude calls plus install processes still alive when sampled. The design must not claim that a completion-time process snapshot proves no unattributed install ran earlier in the interval.

### 17.7 Rev 3 approval result

| Prior condition | Result | Reason |
|---|---|---|
| §15.9.1 non-overridden controller landing | **Partial** | The dedicated worktree removes R2, but its `**` ownership conflicts with every task and the run has no complete finish lifecycle. |
| §15.9.2 consistent advanced-ref reaping | **Partial** | Detach-first fixes the named race; failure after ref deletion remains unhandled. |
| §15.9.3 enforceable R3 identity | **Partial** | Runtime probing and fallback are sound, but no transition can bind the generated actor ID. |
| §15.9.4 no trusted gate during direct install | **Pass for observed direct calls** | R8 interval invalidation covers direct Claude tool calls; the unattributed-process guarantee remains overstated. |
| §15.9.5 crash-safe ledger and registry lock | **Pass with one event-identity correction required** | Registry recovery is specified and per-event files remove interleaving; retry identity/fail-closed folding needs clarification. |
| §15.9.6 coherent backstop phase | **Pass** | P0/P1 ordering now satisfies the invariant. |

### 17.8 Conditions for the next approval pass

Rev 3 is ready for another approval review when:

1. integration ownership no longer conflicts with active task ownership;
2. the run-integration ref has a complete multi-wave, proof, finish, and cleanup lifecycle distinct from the target ref;
3. actor IDs have an explicit post-spawn binding transition;
4. every detach/delete/remove failure has tested rollback or an explicit recoverable partial-failure state;
5. event identity supports retry/multi-rule semantics and malformed events block promotion; and
6. gate process-history claims match what the implementation can actually observe.

---

## 18. Rev 3 re-review resolution (Rev 4, 2026-09-22)

All six §17 findings accepted. Four were defects introduced by Rev 3's own fixes — two created outright (17.1, 17.4), two by under-specifying what those fixes implied (17.2, 17.3). Nothing rejected, nothing deferred.

| Finding | Resolution | Where |
|---|---|---|
| 17.1 integration entry reserves every task path | Accepted; self-inflicted. `solePaths: ["**"]` made the controller nominal owner of every task file, so the role added to unblock integration would have blocked all task work. Ownership becomes a **role- and state-aware predicate** with an empty integration `solePaths`; R3 and the backstop call one shared implementation. | D15, §5.1, §5.1.1, §6.1 (R3), §10, §12.13 |
| 17.2 run-integration ref conflated with the target | Accepted. Split into `targetRef`/`targetBaseSha`/`runIntegrationRef`; `add` bases waves on the run ref tip; reap proves against the run ref; new `finish` transition. **Verified that `git update-ref` does NOT refuse to advance a ref checked out in another worktree** (it silently desynchronizes that worktree), while `git push .` does — the block that has held this spec's own merges for three revisions. `finish` performs the check git omits. | D16, §5.1, §7.1, §7.2, §7.2.4, §10, §12.14, §12.15 |
| 17.3 nothing binds the generated `agent_id` | Accepted. New `bind --task --actor` controller transition after spawn; entries carry `actorId: null` until bound; R3's actor clause inactive while unbound and new R10 surfaces unbound activity. Recorded honestly: that the spawn-returned id equals the payload `agent_id` is unverified and is P0's job, with D10's fallback if it fails. | D17, §5.1, §6.1 (R3, R10), §7.1, §10, §12 |
| 17.4 partial failure after successful ref deletion | Accepted; your reproduction is exact. Reap becomes a **state machine with per-step compensation**, every failure path **relocks**, and an unrecoverable rollback yields a loud `reap_partial_failure` with recovery commands. Rollback recreate uses git's expected-absent compare, verified on this machine. | D18, §7.2, §7.2.3, §10 (injected-failure matrix), §12.16 |
| 17.5 event identity and multi-rule | Accepted on both halves. Final name is `<tool_use_id>-<hook_event_name>` with the timestamp inside the payload and a temp-file→exclusive-rename write, so a retry cannot duplicate and a crash cannot squat the name. Schema carries `matches[]`, making acceptance criterion 3 (R2 **and** R4 from one call) representable. Promotion fails closed on unresolved malformed events. | D14, D19, §5.3, §6.3, §10, §12.17 |
| 17.6 completion-time snapshot proves nothing about earlier installs | Accepted; taking both halves. The gate samples the process table **across** its interval and retains observations, **and** the guarantee is narrowed in writing: direct Claude calls plus installs seen in a sample. An install entirely between samples is unobservable, and the spec says so rather than implying coverage. | D20, §8.3 |

**§17.8 conditions:** 1 → D15/§5.1.1; 2 → D16/§7.2.4; 3 → D17/§7.1; 4 → D18/§7.2.3; 5 → D19/§5.3/§6.3; 6 → D20/§8.3.
