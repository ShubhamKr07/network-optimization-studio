# Weekly Permission-Review Loop — Design

**Status:** design — revised per the 2026-09-18 review (all comments resolved; see "Review Resolution").
**Builds on:** OBS-12 (`scripts/src/harness/lib/permissions.ts`, `permissions.csv`) — PR #15.
**Date:** 2026-09-18

## Goal

Close the loop between the permissions Claude was granted/denied during a week and the standing
allowlist: surface a weekly candidate list in the Monday harness PR, let the human accept/reject each
in PR comments, and have a **deterministic apply step** (triggered by `@claude`, enforced in code)
write the accepted patterns into the **project-scoped, tracked** `.claude/settings.json` — so future
matching Bash commands auto-approve without a prompt. Every promotion is a deliberate, human-decided,
code-enforced act; nothing about capture or apply trusts model discretion for authorization.

## Scope boundary (why the pieces live where they do)

The inputs — the session **transcript** (`~/.claude/projects/<slug>/*.jsonl`), the local **permission
hook ledger** (below), and the current **allow list** (`.claude/settings.local.json`) — are
**machine-local and gitignored**. GitHub Actions cannot read them. Therefore:

- **Capture must run locally** (a Monday cron/launchd job), in a **clean dedicated git worktree** so it
  never operates in an active/dirty checkout.
- **The apply target is the tracked `.claude/settings.json`** (project-scoped — affects only this repo,
  never other projects, never the user-global `~/.claude/settings.json`), because that is the only
  permission file CI can write and version. Claude Code merges tracked `settings.json` ∪ local
  `settings.local.json`, so an entry there takes effect locally like a local grant.
- **The Monday PR renders a *committed, redacted* candidate artifact** fetched from a dedicated capture
  branch. If the local job didn't run, the artifact is stale — apply enforces a freshness limit rather
  than silently granting on stale input.

## Provenance — `executed` ≠ `human-granted` (Review 3)

A command appearing in the transcript is not proof a human approved it: bypass mode, `acceptEdits`,
sandbox auto-approval, and Claude Code's built-in read-only Bash set all execute without a per-command
human decision. Provenance is therefore captured from a **local PreToolUse hook ledger**, not inferred
from the transcript:

- A hook (`.claude/hooks/permission-ledger`) appends one JSONL record per Bash tool attempt to a
  gitignored local ledger (`.harness/permissions/ledger.jsonl`): `{at, commandDigest, redactedPreview,
  provenance, decision}`. Provenance ∈ `explicit_once | session_allow | standing_allow | sandbox_auto
  | builtin_readonly | bypass | unknown`.
- **Only `explicit_once` (a human approved this exact call at a prompt) is promotion-eligible.**
- Transcript-only executions with no matching ledger record are **observations**, surfaced separately,
  never grant candidates.
- *Implementation note:* the exact PreToolUse decision-capture capability is verified in the plan; if a
  hook cannot observe the human's yes/no, capture falls back to marking everything `unknown`
  (observation-only) rather than over-promoting — a hard safety default.

## Data model

Raw command text is **never committed** (Critical 1). The committed artifact is authoritative **JSON**;
markdown is a generated view. A **candidate**:

```
{
  schemaVersion: number,
  id: string,              // sha256(kind + "\0" + proposedRule)[:12] — binds the immutable proposed rule
  kind: "grant" | "deny" | "revoke",
  commandDigest: string,   // sha256 of the full literal command (integrity / tamper check)
  redactedPreview: string, // deterministically redacted, markdown+control-char escaped; or the
                           //   literal "sensitive — review locally" when secret/entropy scan flags it
  proposedRule: string,    // the rule that would be written; exact by default (see Pattern), editable
  level: "destructive" | "risky" | "broad" | "ok",   // classification of the PROPOSED RULE, not the raw command
  provenance: string,      // from the ledger; only explicit_once is promotable
  count: number,
  firstSeen: string,
  lastSeen: string,
  sensitive: boolean       // true → full text withheld from the artifact, kept local only
}
```

The full command for a `sensitive` (or any) candidate lives only in a **gitignored local sidecar**
(`.harness/permissions/<week>.local.json`) the human reads on their machine. Nothing in git history
carries a raw command.

### Redaction + secret scan (Critical 1)

`redactedPreview` runs deterministic replacements (DB/connection URLs, `Bearer`/token strings,
`password=`/`--password`, API keys, emails, inline `KEY=value` env, absolute home paths) → typed
placeholders (`<db-url>`, `<token>`, …), then markdown/control-character escaping. A command that still
trips an entropy/secret heuristic after redaction is marked `sensitive: true` and represented remotely
as `sensitive — review locally` (id + digest + level only).

### Classification levels (extends OBS-12's `risky|broad|ok`)

| level | membership |
|-------|-----------|
| `destructive` | `rm -r*`/`rm -rf`, `sudo`, `chmod`/`chown`, `dd if=`, `mkfs`, `git clean`, `git reset --hard`, `--force`/force-push, SQL `DROP`/`TRUNCATE` |
| `risky` | whole-tool grant, unrestricted wildcard, whole-MCP-server grant, plain `git push`, secret/env exposure, arbitrary `psql *` |
| `broad` | scoped wildcard (`Bash(pnpm run *)`) |
| `ok` | fully-specified command |

Ordered, first-match-wins, `destructive` → `risky` → `broad`. **Classification always evaluates the
proposed rule** (after any human edit/override), never merely the observed command. Rules only surface
candidates; they never auto-decide.

## Pattern suggestion — exact by default (Review 5)

- Default `proposedRule` = the **exact** command as a literal `Bash(<command>)`.
- Generalization to a wildcard happens **only** when the command matches an entry in a small, reviewed
  **template registry** (`scripts/src/harness/lib/permissionTemplates.ts`, e.g. `git log …` →
  `Bash(git log *)`, `pnpm --filter <x> test …` → a vetted narrow form). No free "exec + first
  subcommand" heuristic — that produced dangerous families (`Bash(pnpm exec *)`, `Bash(docker run *)`,
  `Bash(git config *)`).
- `destructive` → **exact literal command only, never generalized**, and (Decision A) shown as fully as
  possible with secrets redacted; if flagged `sensitive`, shown as `sensitive — review locally`.

## Components

### 1. `scripts/src/harness/lib/permissions.ts` (extend, OBS-12)
- Add `destructive` to `GrantLevel`; split destructive rules out of risky.
- `classifyRule(rule)` — classify a proposed `Bash(...)` rule (used post-edit, per Critical 2).
- `matchesProjectAllow(command, allow): boolean` — glob over the two **inspected project allowlists
  only**; used to filter out already-covered commands. **Claims only "not present in the inspected
  project allowlists"** — never "would be auto-approved" (Review 4).
- `redactCommand(command)` + `scanSensitive(command)` (Critical 1).
- `suggestRule(command, templates)` — exact-by-default + template registry (Review 5).
- `buildCandidates(ledger, transcript, projectAllow, managed, window)` — grants (from
  `explicit_once` ledger records not covered by allow), denies, revoke proposals; deduped; classified
  on the proposed rule; sensitive-flagged.

### 2. `scripts/src/harness/permissions-capture.ts` (new CLI) — `pnpm harness:permissions:capture`
- Read last-7-day ledger + transcript + merged project allow + managed sidecar.
- Emit the committed JSON artifact + generated markdown view + the local sidecar. `--weeks-ago N`,
  `--dry-run`. Reads only; never edits any settings file.

### 3. `scripts/harness/permissions-capture-weekly.sh` + launchd installer (new)
- Runs capture **in a clean dedicated worktree**, commits the redacted artifacts to a dedicated
  **`permissions-capture` branch**, pushes it (never main, never a feature branch). Local sidecar stays
  gitignored. `docs/ops/permission-review-cron.md` documents the launchd plist (Mondays ~12:30 UTC) +
  one-command install.

### 4. Committed artifact — `docs/superpowers/metrics/permissions-review/<YYYY-WW>.{json,md}` (tracked)
- `.json` authoritative: `{schemaVersion, sourceCommit, settingsDigest, window, generatedAt,
  candidates[]}`.
- `.md` generated view: `## Grant candidates`, `## Deny candidates`, `## Revoke proposals`,
  `## ⚠ Destructive — review in full` (redacted-full or `sensitive — review locally`), header with
  window/generatedAt + the decision legend. Every field escaped.

### 5. `report.ts` (extend) — `## Permission review` section
Reads the latest committed `.md` (tracked → works on CI) and inlines it, noting `generatedAt` +
freshness. Omitted/placeholder when none exists.

### 6. Apply — deterministic code + a hardened dedicated workflow (Reviews 2 & 6)
**Authorization lives in code, not in `SKILL.md`.**
- `scripts/src/harness/permissions-apply.ts`: the sole mutator. Parses the frozen decision set, for
  each: recomputes the **effective** level from the proposed rule, requires the keyword ≥ that level,
  rejects escalation, verifies the destructive rule equals its captured command byte-for-byte, dedupes
  against existing `settings.json`, writes **only** `.claude/settings.json` (`permissions.allow`/`deny`,
  and `revoke` removals), updates `permissions-managed.json`, and schema-validates the result.
- A dedicated **`.github/workflows/permission-apply.yml`** (not the generic `claude.yml`): triggers on
  the `@claude apply permission review` comment, and gates on required **PR label + base/head +
  authorized actor + review-approved state**; validates artifact `schemaVersion`/`sourceCommit`/
  `settingsDigest`/**freshness**; then runs `permissions-apply.ts` with narrowly-scoped tooling. The
  model triggers; it does not freehand-edit settings.
- **Decision grammar** (per-candidate comments *record* decisions; they do not apply):
  `allow <id>` (ok/broad) · `allow-risky <id>` · `allow-destructive <id>` (kept per Decision B; exact
  byte-for-byte only) · `deny <id>` · `revoke <id>` · `allow <id> as Bash(<rule>)` (override → the new
  rule is re-classified; a bare keyword insufficient for the new level is refused).
- **Two-phase:** a final `@claude apply permission review` freezes the set (every candidate decided or
  deferred), makes **one** settings commit, runs CI, then follows normal approval/merge. No apply on
  the first per-candidate comment.

### 7. Managed-rule provenance + revocation (Review 7)
`docs/superpowers/metrics/permissions-managed.json`: `rule → {owner, rationale, firstSeen, lastSeen,
count, expiry?}`. Capture proposes `revoke` for managed rules unused for N weeks or superseded. Not
additive-only.

## Safety invariants

1. Keyword ≥ effective level of the **proposed rule**, recomputed after any edit/override. Bare `allow`
   never promotes `risky`/`destructive`; `allow-destructive` writes the exact command byte-for-byte.
2. Raw commands never enter git history — redacted preview + digest only; sensitive → review-locally.
3. Only `explicit_once`-provenance grants are promotable; transcript-only runs are observations.
4. Apply target is the **project-scoped** tracked `.claude/settings.json` — never user-global, never
   another project. Writes only that file, schema-validated, atomic, deduped.
5. Authorization is enforced in deterministic code + workflow gates (label/base/head/actor/review/
   freshness), not in a skill.
6. Managed rules carry provenance + optional expiry and can be `revoke`d — authority is not monotonic.
7. Capture is read-only.

## Testing

`permissions.test.ts`, `permissions-capture.test.ts`, `permissions-apply.test.ts` (+ `report.test.ts`)
cover: destructive-vs-risky classification of each subset; `classifyRule` on post-edit rules;
`matchesProjectAllow` glob semantics + the narrow-claim wording; `redactCommand`/`scanSensitive`
(secrets never surface; sensitive → withheld); markdown/control-char **escaping**; exact-by-default +
template-registry generalization; provenance filtering (only `explicit_once` promotable); candidate
**tampering** (digest mismatch rejected); **override escalation** (`as Bash(*)` under bare `allow`
rejected); **stale/settings-digest rejection** + freshness; **actor/branch/label authorization**;
idempotent concurrent comments; **exact-only destructive** handling; **revocation**; the two-phase
freeze (partial decision set rejected).

## Out of scope

- Auto-applying without human review. Every promotion is a deliberate, decided PR comment.
- Non-Bash tools (Read/Edit/WebFetch grants): the loop is Bash-command-centric per the request.
- Editing user-global settings or any other project.

## Review Comments — 2026-09-18

### Critical comments

1. **Never commit raw transcript commands.** The proposed `command: string` field, destructive-command
   blocks, and report inlining put full command text into permanent Git history. Commands can contain
   bearer tokens, database URLs, inline environment values, SQL, heredocs, user data, or sensitive
   paths. Classifying a command as `secret/env exposure` does not make it safe to publish. Unescaped
   pipes, newlines, backticks, and HTML can also corrupt the Markdown or become prompt-injection
   content when `@claude` reads the PR. The committed artifact must contain only a deterministically
   redacted preview, a strong digest, and structured metadata. A command that fails secret/entropy
   scanning stays local and is represented remotely as `sensitive candidate — review locally`.
   Structured, escaped JSON should be authoritative; Markdown should be a generated view.

2. **The editable pattern and `as` override bypass the safety levels.** The candidate id binds only
   `kind + normalizedCommand`, but `suggestedPattern` is editable and `@claude allow <id> as ...`
   accepts another rule. An `ok` candidate can therefore be rebound to `Bash(*)` while still using
   bare `allow`; editing the review file can perform the same substitution without changing the id.
   The deterministic apply code must classify the effective rule after every edit/override, bind the
   candidate digest to the immutable command and proposed rule, reject category escalation unless the
   matching explicit keyword was used, and reject a destructive rule that differs byte-for-byte from
   its captured value.

### Review comments

1. **Define a viable capture-to-weekly-PR handoff.** A scheduled workflow checks out the default
   branch, so a local capture pushed to a feature branch is invisible to it. Pushing the capture
   directly to `main` violates the repository's standing branch discipline and risks operating in an
   active/dirty checkout. Capture should run in a dedicated clean worktree, push a dedicated capture
   branch or validated artifact, and let the weekly workflow fetch that exact source. The workflow
   must validate the source SHA, age, and file set before copying only the permission-review artifacts
   onto its own PR branch.

2. **Do not use a skill as the authorization boundary.** `SKILL.md` instructions guide the model but
   do not enforce permissions. The current generic `@claude` workflow grants whole-tool `Bash` plus
   repository and PR writes. Decision parsing, level enforcement, atomic settings mutation, and
   branch validation must live in deterministic code. The apply path must require the expected PR
   label/base/head, authorized actor and review state; accept one exact command grammar; recompute the
   effective classification; write only `.claude/settings.json`; schema-validate the result; and expose
   only narrowly scoped tools/commands to Claude. See the official Claude Code
   [permission model](https://code.claude.com/docs/en/permissions) and Claude Code Action
   [security guidance](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md).

3. **Preserve permission provenance.** `executed` is not equivalent to `human granted`. Bypass mode,
   `acceptEdits`, sandbox auto-approval, and Claude Code's built-in read-only Bash set can all execute
   commands without a per-command human decision. Record provenance such as `explicit_once`,
   `session_allow`, `standing_allow`, `sandbox_auto`, `builtin_readonly`, `bypass`, and `unknown`.
   Only an explicit human approval is eligible for promotion. If transcripts cannot prove provenance,
   add a local `PermissionRequest` hook ledger and treat transcript-only executions as observations,
   not grant candidates.

4. **Match Claude Code semantics, not a generic glob.** Actual evaluation includes compound-command
   splitting, wrapper and safe-environment-prefix normalization, built-in read-only commands,
   `deny -> ask -> allow` precedence, and rules from managed, CLI, project-local, shared-project, and
   user scopes. A simple `*` matcher over only the two project files can produce both false candidates
   and incorrect claims that a command is auto-approved. Either implement a version-pinned conformance
   suite against Claude Code's documented semantics or describe the result narrowly as `not present in
   the two inspected project allowlists`. See the official
   [permissions](https://code.claude.com/docs/en/permissions) and
   [settings-precedence](https://code.claude.com/docs/en/settings) documentation.

5. **Default to exact rules and do not persist destructive auto-approvals.** Keeping only executable +
   first subcommand can produce `Bash(pnpm exec *)`, `Bash(npm run *)`, `Bash(docker run *)`,
   `Bash(git config *)`, or `Bash(git push *)`; those families can run arbitrary repository-controlled
   code, mutate configuration, launch arbitrary containers, or include force flags. Generalization
   should come only from a small reviewed template registry, and classification must evaluate the
   resulting rule rather than the observed command. `rm`, `sudo`, `git reset --hard`, force-push, and
   destructive SQL should remain permanently `ask`: an exact command is still dangerous when repeated
   later against different repository or database state.

6. **Specify freshness and an explicit apply state machine.** Stale input should not be silently
   accepted for a capability grant. Each artifact needs `schemaVersion`, `sourceCommit`,
   `settingsDigest`, capture window, and generated-at; apply must validate all of them and enforce a
   freshness limit. Per-candidate comments should record decisions only. A final
   `@claude apply permission review` freezes the decision set, requires every candidate to be decided
   or deferred, creates one settings commit, runs CI, and then follows normal approval/merge policy.
   This avoids merging on the first candidate and stranding the rest.

7. **Prevent monotonic privilege creep.** Additive-only writes cause project authority to expand
   forever. Store owner/rationale, first/last observed timestamps, usage count, and optional expiry for
   each managed rule. The weekly loop should also propose removal of unused or superseded rules and
   support a reviewed `revoke` decision. Tests should cover redaction, Markdown/control-character
   escaping, candidate tampering, override escalation, stale/settings-digest rejection, actor/branch
   authorization, idempotent concurrent comments, exact-only destructive handling, and revocation.

## Review Resolution — 2026-09-18

All Critical + Review comments accepted and folded into the body above.

- **Critical 1** → redaction + digest + structured-JSON-authoritative artifact; sensitive →
  review-locally; full text only in a gitignored local sidecar; all fields escaped.
- **Critical 2** → `classifyRule` recomputes the effective level after edit/override; keyword ≥ level;
  digest binds the immutable proposed rule; destructive must match byte-for-byte.
- **Review 1** → capture in a clean worktree → dedicated `permissions-capture` branch → workflow
  fetches + validates SHA/age/file-set.
- **Review 2** → authorization in deterministic `permissions-apply.ts` + a dedicated hardened
  `permission-apply.yml` (label/base/head/actor/review gates, narrow tools); skill is not the boundary.
- **Review 3** → local PreToolUse hook ledger with provenance; only `explicit_once` promotable;
  transcript-only = observations; unknown-provenance fallback is observation-only.
- **Review 4** → matcher claims only "not present in the inspected project allowlists"; documents
  unseen scopes/semantics.
- **Review 5** → exact-by-default + reviewed template registry; classify the resulting rule.
  **Exception (user Decision B):** `allow-destructive` promotion is **kept** (not left permanently
  `ask`) — destructive is promotable only via the explicit keyword, exact byte-for-byte, never
  generalized. Chosen deliberately against this comment's advice.
- **Review 6** → artifact metadata + freshness gate + two-phase freeze via `@claude apply permission
  review`.
- **Review 7** → `permissions-managed.json` provenance + expiry + `revoke` decision; not additive-only.

**Locked-decision overrides (surfaced, user-decided):**
- **Decision A** — destructive shown "in full" reconciled with Critical 1: redacted-full where safe,
  else `sensitive — review locally` (full text local-only). No secret in git history.
- **Decision B** — `allow-destructive` promotion retained (overrides Review 5's "keep destructive
  permanently ask").
