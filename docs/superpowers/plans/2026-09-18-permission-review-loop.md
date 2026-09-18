# Weekly Permission-Review Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly loop that captures the Bash permissions Claude was prompted-for and granted/denied (provenance-aware), surfaces them redacted in the Monday harness PR, and lets a human promote accepted patterns into the tracked project `.claude/settings.json` via a deterministic, code-enforced apply.

**Architecture:** Local capture (clean worktree → dedicated `permissions-capture` branch) reads a local PreToolUse/Notification hook ledger + transcript + current project allowlist, emits a redacted structured artifact. The Monday workflow deterministically fetches + validates that artifact and renders it into the weekly PR. A hardened `permission-apply.yml` runs the **default-branch** `permissions-apply` implementation over PR comments + artifact **as data** (never PR-head code) — the sole settings mutator — gated on label/base/head/actor/review/freshness + a strict, per-decision-authorized grammar.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `tsx`, vitest, Node `node:crypto`, GitHub Actions, Claude Code hooks + settings.

Spec: `docs/superpowers/specs/2026-09-18-permission-review-loop-design.md`. Read its "Review Resolution" + Decisions A/B, and this plan's "Plan Review Resolution" (2 Critical + 9 Important + 4 Minor) before starting.

**Review status:** Revised per the 2026-09-18 plan review — all Critical/Important/Minor resolved (see appendix). Decisions A/B are intentional user overrides, out of scope for review.

## Global Constraints

- **No SECRETS in git (narrowed from "no raw commands").** The secret scan is authoritative: a candidate that passes → non-sensitive → its exact `proposedRule` + `redactedPreview` may be committed verbatim (required so remote apply can write the rule). A candidate that trips the scan → `sensitive: true`, **carries no `proposedRule`** in the committed artifact, is `reviewLocalOnly`, and is promotable **only via a local apply** reading the gitignored sidecar — never the PR/CI path. Full commands live only in the gitignored local ledger + sidecar. Every rendered field is escaped per the Task 2 canonical contract.
- **Promotable = an observable "prompted_and_executed" signal** (Task 0 confirms the exact events). Already-allowlisted commands never prompt, so they never become candidates. Transcript-only executions with no prompt event are observations, not candidates.
- **Authorization is deterministic code, never `SKILL.md`.** `permissionApply.ts` (run from the **default branch**) is the sole logic that writes `.claude/settings.json`. The model never mutates settings and is never in the apply data path.
- **Apply target is the project-scoped tracked `.claude/settings.json`** — never `~/.claude/settings.json`, never another project. Writes atomic, schema-validated, deduped.
- **Exact-by-default.** Generalization only from the reviewed template registry. Classification always runs on the effective *proposed rule* (post-edit), never the observed command.
- **Levels + keywords:** `ok`/`broad` → `allow`; `risky` → `allow-risky`; `destructive` → `allow-destructive` (exact byte-for-byte, Decision B); `deny`; `revoke`; `defer`. Keyword ≥ effective level; escalation refused. Restrictive decisions (`deny`/`revoke`/`defer`) are outside level-ordering.
- **Every decision is authorized** (comment id + author + association + timestamp), not just the final freeze. **Two-phase:** per-candidate comments record decisions; one final authorized `@claude apply permission review` freezes (all candidates decided/deferred), bound to the PR head SHA, single settings commit.
- **Gate per task:** `pnpm --filter @workspace/scripts typecheck` + `pnpm --filter @workspace/scripts test` green before each commit.
- **One task = one commit**, `[perm-loop-Tn] <summary>`. **TDD.**

## File Structure

```
.claude/hooks/lib/permissionsCore.mjs           (new) dep-free redact + digest, shared by hook AND TS (+ .d.ts)
.claude/hooks/permission-ledger.mjs             (new) PreToolUse/Notification ledger hook
.claude/settings.json                           (extend) register the hook(s)
scripts/src/harness/lib/permissions.ts          (extend, OBS-12) classification, matcher, candidates; re-exports core
scripts/src/harness/lib/permissionTemplates.ts  (new) reviewed generalization registry
scripts/src/harness/lib/permissionManaged.ts    (new) rule-keyed managed map + usage/revocation
scripts/src/harness/lib/permissionLedger.ts     (new) provenance ledger parse (full command, local)
scripts/src/harness/lib/permissionApply.ts      (new) pure decision-parse + per-decision auth + enforce + mutate
scripts/src/harness/permissions-capture.ts       (new CLI)
scripts/src/harness/permissions-apply.ts         (new CLI: remote-data + local modes)
scripts/src/harness/report.ts                    (extend) `## Permission review` section
scripts/harness/permissions-capture-weekly.sh    (new) worktree + capture branch + lease push
.github/workflows/permission-apply.yml           (new) hardened apply (default-branch code, PR data-only)
.github/workflows/harness-weekly.yml             (extend) deterministic fetch+validate+render, isolated from the model
docs/superpowers/metrics/permissions-review/     (new) <YYYY-WW>.{json,md}
docs/superpowers/metrics/permissions-managed.json(new, seed {}) rule-keyed managed map
docs/ops/permission-review-cron.md               (new)
scripts/src/__tests__/{permissions,permissionApply,permissionsCapture,permissionManaged,report}.test.ts
```

Type spine (used consistently T1→T18): `GrantLevel = "destructive"|"risky"|"broad"|"ok"`; `Provenance` (Task 0-confirmed set); `LedgerRecord {at, sessionId, toolUseId, command(full,local-only), commandDigest, provenance, decision}`; `Candidate {schemaVersion, id, kind:"grant"|"deny"|"revoke", commandDigest, redactedPreview, proposedRule?, level, provenance, count, firstSeen, lastSeen, sensitive, reviewLocalOnly}`; `ManagedMap = Record<rule, {owner, rationale, firstSeen, lastSeen, count, expiry?}>`; `Decision {id, keyword, overrideRule?, actor, association, rationale?, commentId, at}`; `Artifact {schemaVersion, sourceCommit, trackedSettingsDigest, window, generatedAt, candidates}`.

---

### Task 0 (BLOCKING SPIKE): provenance observability

**Files:** `docs/superpowers/specs/2026-09-18-permission-provenance-spike.md` (findings, committed). No product code.

- [ ] Against the **installed** Claude Code version, empirically determine which hook events fire and what they carry for: a prompted-then-approved Bash call, a denied one, an already-allowlisted one, `acceptEdits`/bypass, builtin read-only. Candidate events: `PreToolUse`, `PermissionRequest`, `Notification`, `PostToolUse` (+ transcript records). Correlate by `session_id`+`tool_use_id`.
- [ ] Define the **observable promotable signal** (target: `prompted_and_executed` = a permission-prompt event for the tool_use_id followed by a successful `PostToolUse`) and the full `Provenance` enum with evidence per state.
- [ ] **Gate:** if no signal distinguishes a human-prompted approval from auto-approval, STOP and choose with the user: opt-in local approval recorder vs. redesign. Do not proceed to T1+ until this is settled.
- [ ] **Commit** `[perm-loop-T0] provenance observability spike (findings + confirmed signal)`.

---

### Task 1: `destructive` level + `classifyRule`
**Files:** `permissions.ts`; `permissions.test.ts`. Produces `classifyRule(rule)`, widened `GrantLevel`.
- [ ] TDD (tests from the prior revision: destructive subset = `rm -r*`/`rm -rf`, `sudo`, `chmod`/`chown`, `dd if=`, `mkfs`, `git clean`, `git reset --hard`, `--force`/force-push, SQL `DROP`/`TRUNCATE`; plain `git push` stays risky; `Bash(*)` risky). Move reset-hard/chmod/force out of risky into destructive. `classifyRule` classifies a full `Tool(pattern)` rule (post-edit path). Gate. Commit `[perm-loop-T1]`.

---

### Task 2: canonical escaping + redaction + secret scan
**Files:** shared `permissionsCore.mjs` (redact + digest, dep-free) + `.d.ts`; `permissions.ts` re-exports; `permissions.test.ts`. Produces `redactCommand`, `scanSensitive`, `escapeCell`, `sha256Hex`.
- [ ] **Lock the exact escaping contract** (Minor 3): `escapeCell` applies, in order — replace CR/LF/NUL/other control chars → single space; `&`→`&amp;`; `<`→`&lt;`; `>`→`&gt;`; `|`→`\|`; backtick→`` \` ``; strip Unicode bidi controls (U+202A–U+202E, U+2066–U+2069). Test asserts the exact output for a fixture containing all of them.
- [ ] `redactCommand` deterministic ordered replacements → typed placeholders (`<db-url>`,`<token>`,`<password>`,`<email>`,`<env>`,`<home-path>`). `scanSensitive` = residual ≥16-char mixed-class token OR secret keyword after redaction. `sha256Hex` via `node:crypto` (shared so hook + TS produce identical digests).
- [ ] TDD (redaction masks db-url/token/password/email/inline-env; scan flags high-entropy leftovers, clears clean; escaping exact). Gate. Commit `[perm-loop-T2]`.

---

### Task 3: project-allow matcher (metachar-safe, narrow claim)
**Files:** `permissions.ts`; tests. Produces `matchesProjectAllow(command, allow)`.
- [ ] **Escape regex metacharacters in the literal rule text FIRST** (Minor 1: `$ [ ] ( ) \ . + ? ^ { } |`), THEN expand the permission `*`→`.*`, THEN anchor. Non-Bash entries ignored. Documented to claim only "present in the inspected project allowlists", never "auto-approved".
- [ ] TDD incl. a covered/uncovered case per metacharacter. Gate. Commit `[perm-loop-T3]`.

---

### Task 4: template registry + `suggestRule`
**Files:** `permissionTemplates.ts`; `permissions.ts`; tests. Produces `suggestRule(command)`.
- [ ] Exact-by-default; generalize ONLY via a short reviewed registry (git read subcommands, `pnpm -v`, `pnpm --filter * test|typecheck`, `pnpm run <known>` — NOT `pnpm exec`/`docker run`/`git config`/`git push`). Destructive/unmatched → exact. TDD. Gate. Commit `[perm-loop-T4]`.

---

### Task 5: managed-rule map + usage matcher + revocation (MOVED EARLIER — Important 6)
**Files:** `permissionManaged.ts`; seed `permissions-managed.json` = `{}`; tests. Produces `ManagedMap`; `refreshUsage(managed, executedCommands): ManagedMap` (matches via `matchesProjectAllow` per rule, bumps `lastSeen`/`count`); `proposeRevocations(managed, now, staleWeeks): Candidate[]` (unused ≥ staleWeeks or past `expiry`).
- [ ] TDD: usage refresh matches wildcard rules (not digest-vs-key); stale/expired → revoke candidate; recently-used → none. Gate. Commit `[perm-loop-T5]`.

---

### Task 6: provenance ledger (hook writes full command locally; pure parse)
**Files:** `.claude/hooks/permission-ledger.mjs`; `permissionLedger.ts`; extend OBS-12 `parseDenials` (drop the 120-char truncation — Important 7); tests.
- [ ] Hook: reads hook JSON on stdin, records `{at, sessionId, toolUseId, command(FULL), commandDigest(sha256 via core), provenance(per Task 0), decision}` to gitignored `.harness/permissions/ledger.jsonl`; imports `permissionsCore.mjs` for redact/digest (no `.ts` import, no logic duplication — Important 5/7); **never blocks the tool, always exit 0**.
- [ ] `parseLedger(jsonl, window)` + `promotableCommands(records)` (only the Task-0 promotable provenance; keyed by `sessionId+toolUseId`; digest as integrity; full command retained for local use only).
- [ ] TDD. Gate. Commit `[perm-loop-T6]`.

---

### Task 7: register the hook + validate settings (Important 5)
**Files:** `.claude/settings.json` (add the `hooks` registration for the Task-0 event set); a small validator test.
- [ ] Add the exact hook registration; a test asserts `.claude/settings.json` parses, matches the settings schema shape, and references the committed hook path. Gate. Commit `[perm-loop-T7]`.

---

### Task 8: `buildCandidates`
**Files:** `permissions.ts`; tests. Consumes T1–T6. Produces `Candidate` + `buildCandidates({ledger, transcript, projectAllow, managed, window})`.
- [ ] Grant candidates = promotable ledger commands not `matchesProjectAllow`; deny candidates (de-truncated `parseDenials`); revoke via T5. `id = sha256(kind+"\0"+proposedRuleOrDigest)[:12]`; classify the proposed rule; **sensitive → `sensitive:true`, `reviewLocalOnly:true`, NO `proposedRule`, preview `"sensitive — review locally"`** (Critical 1); non-sensitive → exact/registry `proposedRule` verbatim.
- [ ] TDD incl. sensitive-omits-proposedRule, id stability, not-covered filter, kind splits. Gate. Commit `[perm-loop-T8]`.

---

### Task 9: capture CLI + artifact writers (split digests)
**Files:** `permissions-capture.ts`; `permissionsCapture.test.ts`; aliases.
- [ ] `<week>.json` (authoritative: `{schemaVersion, sourceCommit, trackedSettingsDigest, window, generatedAt, candidates}`), `<week>.md` (generated view: Grant/Deny/Revoke/`## ⚠ Destructive — review in full` + header + legend), gitignored `.harness/permissions/<week>.local.json` (full commands + `localAllowDigest`). `trackedSettingsDigest` = canonical hash of tracked `settings.json` `permissions` only (CI-reproducible — Important 1); `localAllowDigest` informational, local sidecar only.
- [ ] TDD: no secret in json/md; sensitive candidate carries no rule; destructive non-sensitive rendered full; `--dry-run` no writes; digests as specified. Gate. Commit `[perm-loop-T9]`.

---

### Task 10: weekly capture wrapper (worktree, lease, trap) — Minor 4 / Important 8
**Files:** `permissions-capture-weekly.sh`; `permission-review-cron.md`; `.gitignore`.
- [ ] Isolated worktree off the fetched `origin/main`; run capture; also `refreshUsage` on `permissions-managed.json` and stage it; assert the staged set == exactly the review artifacts + managed map; commit `[permissions] weekly capture <week>`; `git push --force-with-lease` the `permissions-capture` branch against an explicitly fetched ref; **`trap` cleanup** removes the worktree/partial branch on failure. A dirty primary checkout does NOT block (all work in the worktree). `bash -n` + `--dry-run` verify. Commit `[perm-loop-T10]`.

---

### Task 11: `## Permission review` report section (deterministic — Important 9)
**Files:** `report.ts`; `report.test.ts`.
- [ ] `buildReport` inlines the fetched-and-validated `<week>.md` deterministically; notes `generatedAt` + freshness; placeholder when absent. TDD. Gate. Commit `[perm-loop-T11]`.

---

### Task 12: decision model + per-decision-authorized parser (Important 3)
**Files:** `permissionApply.ts`; tests. Produces `parseDecisions(comments: {commentId, body, author, association, at}[]): Decision[]`, `isFrozen`, `allDecidedOrDeferred`.
- [ ] Grammar `@claude (allow|allow-risky|allow-destructive|deny|revoke|defer) <id> [as Bash(<rule>)]`; **authorize every decision** (drop comments from unauthorized authors before last-writer-wins); legal kind/keyword pairs; `defer` supported; carry `actor`+`rationale`. TDD: unauthorized author's decision ignored; last-writer-wins among authorized; freeze requires all decided/deferred. Gate. Commit `[perm-loop-T12]`.

---

### Task 13: deterministic apply core (Critical 1/2, Important 2)
**Files:** `permissionApply.ts`; `permissionApply.test.ts`. Produces `applyDecisions({artifact, decisions, settings, managed, now, sourceBlobMatches})`.
- [ ] Per decision: recompute effective level via `classifyRule(overrideRule ?? proposedRule)`; keyword ≥ level else refuse; **reject any decision on a `reviewLocalOnly` candidate via this (remote) path** (Critical 1); destructive → `allow-destructive` only + effective rule == captured exact command byte-for-byte; **tamper check binds to the fetched source commit blob**, not just id (Important 2); dedupe vs existing allow/deny; `revoke` removes from allow + managed; update `ManagedMap` (owner/rationale/first-last/count). Writes only `.claude/settings.json` + managed map; schema-validate.
- [ ] TDD every enforcement bullet incl. `as Bash(*)` under bare `allow` refused, sensitive-via-remote refused, tampered blob refused, idempotent re-apply. Gate. Commit `[perm-loop-T13]`.

---

### Task 14: apply CLI (remote-data + local modes)
**Files:** `permissions-apply.ts`; alias.
- [ ] `--mode remote`: inputs = validated artifact JSON + decisions file (produced by the workflow), validate `schemaVersion`/`sourceCommit`/`trackedSettingsDigest`/**freshness** (`--max-age-days` default 8) before `applyDecisions`; write results. `--mode local`: read the gitignored sidecar to promote a `reviewLocalOnly`/sensitive candidate into local settings, interactively, never in CI. TDD the validation gates. Gate. Commit `[perm-loop-T14]`.

---

### Task 15: hardened `permission-apply.yml` (Important 4/3)
**Files:** `.github/workflows/permission-apply.yml`.
- [ ] Trigger on the final freeze comment. **Gate `if:`** required label `permission-review` + base `main` + head `harness-weekly/*` + authorized actor + `review_decision == APPROVED`. **Run the apply implementation from the DEFAULT branch** (checkout `main` for code); fetch PR comments + the PR's artifact as **data only** (GitHub API), no PR-head checkout-execute, **no `pnpm install` of PR head**; run `permissions-apply --mode remote`; write the two result files back to the PR branch via a narrow API step; commit `[permissions] apply review <week>`. Per-PR **concurrency group** + optimistic head-SHA check. No `claude_args`/model in the path. `actionlint` if available. Commit `[perm-loop-T15]`.

---

### Task 16: weekly workflow — deterministic fetch/validate/render (Important 2/9)
**Files:** `.github/workflows/harness-weekly.yml`.
- [ ] Add a deterministic **pre-report** step: fetch the exact remote `permissions-capture` commit, validate source SHA + `<week>` + freshness + allowed file set, copy `<week>.json` + `<week>.md` into the tree; THEN `pnpm harness:report` (renders the section) and commit both artifacts with the report. The permission artifact is handled entirely by deterministic steps — **never passed to the claude-code-action** docs-audit step. Add the `permission-review` label to the PR. `actionlint`. Commit `[perm-loop-T16]`.

---

### Task 17: docs + gitignore + aliases (Minor 2)
**Files:** `CLAUDE.md`, `metrics/README.md`, `.gitignore`.
- [ ] Document the loop + commands (`harness:permissions:capture`, `:apply`) + Decisions A/B; README: artifact + managed-map columns + the narrowed no-secrets invariant. `.gitignore`: ensure `.harness/permissions/` (ledger + `*.local.json`) + `.harness/permissions-wt/` ignored, `.claude/hooks/` tracked. Verify with `git check-ignore` / `git ls-files`. Commit `[perm-loop-T17]`.

---

### Task 18 (QA): e2e fixture pipeline + security cases
**Files:** `scripts/src/__tests__/permissionLoop.e2e.test.ts`.
- [ ] Seed fixtures (ledger with a promotable grant, a denial, a destructive promotable, a secret-bearing command; project allow; managed map). capture → assert candidates correct, **no secret anywhere in json/md**, destructive non-sensitive full, sensitive → no rule + `reviewLocalOnly`. `applyDecisions` (remote) with a frozen set: `allow` ok grant; `allow-destructive` exact; refuse `allow <destructive>`; refuse `allow <id> as Bash(*)`; refuse a `reviewLocalOnly` candidate via remote; refuse a tampered-blob artifact; refuse an unauthorized-author decision. Assert final settings has exactly the intended entries + managed updated.
- [ ] **Full gate:** `pnpm --filter @workspace/scripts typecheck` + `pnpm --filter @workspace/scripts test`. Commit `[perm-loop-T18]`.

---

## Self-Review

- **Every review comment mapped:** Critical 1 → Global Constraints + T8/T9/T13 (no-secrets invariant, sensitive→no rule→local-only). Critical 2 → T0 (blocking spike) + observable provenance. Important 1 → T9 (split digests). Important 2 → T16 (pre-report fetch/validate) + T13 (blob-bound tamper check). Important 3 → T12 (per-decision auth, `defer`, pairs, actor/rationale) + T15 (head-SHA bind, concurrency). Important 4 → T15 (default-branch code, data-only, API write). Important 5 → T2 (shared core) + T6 (hook imports core) + T7 (register). Important 6 → T5 moved before T8; `ManagedMap` map type throughout. Important 7 → T6 (full command in local ledger, `sessionId+toolUseId`) + de-truncated `parseDenials`. Important 8 → T5/T10 (`refreshUsage` on capture branch). Important 9 → T11/T16 (deterministic, isolated from the model). Minor 1 → T3. Minor 2 → gate wording throughout. Minor 3 → T2 locked contract. Minor 4 → T10 lease + trap.
- **Ordering:** T0 gates all; T5 (managed) precedes T8 (buildCandidates); T12/T13 precede the CLIs/workflows. One-green-commit holds.
- **Types:** the type spine is fixed once above and referenced by every task.
- **No placeholders:** each task names files, signatures, and exact test obligations.

## Execution Handoff

1. **Subagent-driven / agent-team (recommended — security-sensitive, ~18 tasks, TDD).** Note: T0 is a blocking human/spike gate before dispatch.
2. **Inline**, per-task checkpoints.

---

## Review Comments — 2026-09-18

Decision A (redacted-full destructive display) and Decision B (retaining exact
`allow-destructive`) were explicitly excluded from this review and remain unchanged.

### Critical comments

1. **The tracked artifact still contains raw commands through `proposedRule`.** The global constraint
   says raw commands never enter Git, but exact-by-default `proposedRule` contains the literal command,
   `buildCandidates` includes it, and Task 7 serializes the full candidate into tracked JSON. A
   sensitive candidate therefore leaks through `proposedRule` even if `redactedPreview` says
   `sensitive — review locally`; the proposed no-secret fixture cannot pass without behavior absent
   from the data model. Choose and encode one complete contract:
   - non-sensitive exact rules may enter Git, and the invariant is narrowed accordingly;
   - sensitive candidates have no `proposedRule`, are marked `reviewLocalOnly`, and cannot use the
     tracked-settings remote apply path; or
   - if no literal command may enter Git, only registry-generated generalized rules may use remote
     apply. An accepted sensitive exact rule cannot be written into tracked `.claude/settings.json`
     without violating the same invariant.

2. **The required provenance signal is not yet proven observable, and the feasibility check occurs
   too late.** `PreToolUse` fires before permission evaluation. `PermissionRequest` fires before the
   prompt, while `PostToolUse` proves successful execution but not which human option was selected;
   the documented events do not directly report `explicit_once` versus `session_allow`. Task 5's safe
   fallback marks everything `unknown`, which yields no promotable grants and therefore fails the
   feature's primary goal after four earlier implementation commits have already landed. Move this to
   a blocking Task 0 live spike against the installed Claude Code version. Require evidence for every
   claimed provenance state and identify the actual event correlation (`PermissionRequest`,
   `PostToolUse`, settings/config changes, transcript records). If exact provenance cannot be proven,
   redesign the product around an observable state such as `prompted_and_executed` or an opt-in local
   approval recorder; observation-only must not count as successful delivery. See the official
   [hooks reference](https://code.claude.com/docs/en/hooks#permissionrequest).

### Important comments

1. **`settingsDigest` cannot be reproduced by CI as specified.** Task 7 hashes the merged tracked +
   local project allowlists, while Task 13 validates that digest in GitHub Actions, where
   `.claude/settings.local.json` does not exist. Split this into a `trackedSettingsDigest` that CI
   recomputes and enforces, plus an informational `localAllowDigest` or
   `effectiveLocalAllowDigest` retained in the local sidecar. Define canonical serialization and
   whether the tracked digest covers the entire settings object or only `permissions`.

2. **The capture artifact is fetched too late, and Task 13 mentions only Markdown.** The existing
   weekly workflow runs `harness:report` before its PR-building phase. Copying the permission-review
   Markdown afterward means the report cannot render it, while the apply workflow also needs the
   authoritative JSON. Add a deterministic pre-report step that fetches the exact remote
   `permissions-capture` commit, validates its source SHA/week/freshness/allowed file set, copies both
   `<week>.json` and `<week>.md`, and only then runs `harness:report`. Commit both artifacts with the
   report. A candidate id hash is not authenticity: artifact validation must bind the PR copy to the
   fetched capture commit so changing both `proposedRule` and `id` cannot pass as an untampered source.

3. **Decision authorization applies only to the final trigger, not to every decision.**
   `parseDecisions` receives only `{body, at}`, so an unauthorized comment can become the
   last-writer-wins decision for an id before an authorized user posts the final freeze comment.
   Include stable comment id, author identity, author permission/association, and timestamp in the
   parser input; authorize every decision, not just the final trigger. Also:
   - add `defer` to `Keyword` and the grammar, since `allDecidedOrDeferred` otherwise cannot succeed;
   - carry actor + rationale into `Decision`, because `ManagedRule` requires owner/rationale;
   - define legal candidate-kind/keyword pairs (`grant -> allow*|defer`, `deny -> deny|defer`,
     `revoke -> revoke|defer`) and define that restrictive decisions do not participate in the
     allow-keyword level ordering; and
   - bind the frozen set to the PR head SHA and add a per-PR workflow concurrency group with an
     optimistic head check so simultaneous final comments cannot race.

4. **The hardened workflow executes mutable PR-head code with a write token.** Task 13 checks out the
   PR head, runs `pnpm install`, and executes the PR's `permissions-apply.ts` while holding
   `contents: write`. That executes mutable package metadata, lifecycle scripts, lockfile-selected
   dependencies, and mutation logic inside the privileged job. Run the trusted apply implementation
   from the default branch and treat PR comments/artifacts only as input data. Write the two permitted
   result files back to the PR branch through a narrow GitHub API step, and do not execute code or
   install lifecycle scripts from that branch. The exact comment already triggers the workflow, so no
   Claude action is required; remove the otherwise contradictory `claude_args --allowedTools Read`.
   See the Claude Code Action
   [security guidance](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md).

5. **The hook file is created but never registered.** Tracking
   `.claude/hooks/permission-ledger.mjs` does not make Claude Code execute it. Once Task 0 determines
   the necessary event set, add an explicit task that updates `.claude/settings.json` with the exact
   hook registrations and validates the resulting settings structure. The implementation must also
   define how the standalone `.mjs` shares the identical digest/redaction contract with the TypeScript
   capture code without importing an uncompiled `.ts` module or duplicating security-sensitive logic
   that can drift.

6. **Task ordering and managed-rule types are inconsistent.** Task 6 consumes managed-rule types and
   emits revoke candidates, and Task 7 reads the managed sidecar, but Task 10 does not introduce that
   model or revocation logic until later. This cannot satisfy the one-green-commit-before-the-next
   rule. Move the managed types, sidecar seed, matching, and revocation primitives before candidate
   construction, or explicitly defer revoke support and extend `buildCandidates` afterward. Choose one
   sidecar representation consistently: the file is seeded as `{}` and described as a rule-keyed map,
   while `ApplyInput` currently declares `ManagedRule[]`.

7. **The candidate data flow does not define recovery of the literal command.** `LedgerRecord` contains
   only a digest and redacted preview, yet `suggestRule`, exact-rule construction, the local sidecar,
   and byte-for-byte destructive validation require the full command. Specify the correlation key and
   source used to recover it (prefer `session_id + tool_use_id`, with digest as an integrity check),
   and keep the literal only in a local-only structure. OBS-12's current `parseDenials` truncates input
   to 120 characters, so it must be extended or replaced before it can provide exact deny candidates
   or full-command digests.

8. **Managed-rule usage is never refreshed.** `lastSeen` and `count` are updated when a decision is
   applied, but weekly capture does not persist usage of already-managed rules. A frequently used rule
   will therefore eventually look stale and be proposed for revocation. Define how executed commands
   are matched against managed exact/wildcard rules, how usage updates are persisted on the capture
   branch, and how those updates merge safely with a concurrent settings-apply commit. Comparing
   command digests directly with rule keys is insufficient for wildcard rules.

9. **Escaped command previews remain prompt-injection input to the weekly Claude action.** Markdown
   and control-character escaping prevents malformed rendering; it does not neutralize a natural-
   language instruction embedded in a command preview. The current weekly action has Bash/write
   access while assembling the PR. Fetch and append the permission artifact only after the
   Claude-driven docs-audit step, using deterministic code, or remove the model from PR assembly. The
   apply workflow must continue to parse only authoritative JSON and comments, never model output.

### Minor comments

1. **Escape regex metacharacters before expanding permission wildcards.** Task 3 cannot translate
   `*` directly to `.*`; it must first escape `$`, `[`, `(`, `\\`, and every other regular-expression
   metacharacter in literal rule text, then expand the permission wildcard and anchor the result. Add
   covered/uncovered tests containing each metacharacter.

2. **Use the repository's pnpm commands.** Replace `npx vitest` with
   `pnpm --filter @workspace/scripts test` or `pnpm --filter @workspace/scripts exec vitest run ...`.
   The root repository is pnpm-only. The final gate should name the exact scripts typecheck + complete
   scripts test commands.

3. **Lock the escaping assertion before implementation.** Task 2's instruction to “adjust the
   expectation” is not a failing TDD contract. Specify the exact escaping order and output, including
   `&`, `<`, `>`, pipes, CR/LF, NUL/control characters, backticks, and Unicode bidi controls, then keep
   the test fixed.

4. **Use lease-protected capture-branch replacement.** Replace unconditional force-push with
   `--force-with-lease` against an explicitly fetched remote ref, and add cleanup/trap behavior so a
   failed cron run does not leave a registered worktree or partially updated branch behind. A dirty
   primary checkout need not block capture when all work occurs in an isolated worktree off the
   validated remote commit.

## Plan Review Resolution — 2026-09-18

All Critical + Important + Minor comments accepted and folded into the tasks above; see "Self-Review"
for the comment→task map. Two resolutions reframe earlier wording (not user-locked decisions):

- **Critical 1** → the "no raw commands" constraint is narrowed to **"no secrets"** (the reviewer's
  offered option a+b): non-sensitive exact rules are committed verbatim so remote apply can write them;
  sensitive candidates carry no `proposedRule`, are `reviewLocalOnly`, and are promotable only via a
  local apply. This keeps Decision B (exact `allow-destructive`) coherent.
- **Critical 2** → promotable provenance changes from the unobservable `explicit_once` to an
  **observable `prompted_and_executed`** signal, confirmed by the blocking **Task 0** spike before any
  implementation.
