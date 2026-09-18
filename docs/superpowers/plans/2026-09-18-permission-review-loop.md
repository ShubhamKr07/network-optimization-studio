# Weekly Permission-Review Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly loop that captures the Bash permissions Claude was granted/denied (provenance-aware), surfaces them redacted in the Monday harness PR, and lets a human promote accepted patterns into the tracked project `.claude/settings.json` via a deterministic, code-enforced apply.

**Architecture:** Local capture (clean worktree → dedicated `permissions-capture` branch) reads a PreToolUse hook ledger + transcript + current project allowlist, emits a redacted structured artifact. The Monday workflow renders it into the weekly PR. A hardened `permission-apply.yml` runs a deterministic `permissions-apply.ts` — the sole settings mutator — gated on label/base/head/actor/review/freshness and a strict decision grammar.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `tsx`, vitest, Node `node:crypto`, GitHub Actions, Claude Code hooks + settings.

Spec: `docs/superpowers/specs/2026-09-18-permission-review-loop-design.md`. Read its "Review Resolution" + Decisions A/B before starting.

## Global Constraints

- **Raw commands NEVER enter git.** Committed artifacts carry only `redactedPreview` + `commandDigest` (sha256) + structured metadata. `sensitive: true` → remote shows `sensitive — review locally`; full text only in a gitignored local sidecar. Every rendered field is markdown/control-char escaped.
- **Authorization is deterministic code, never `SKILL.md`.** `permissions-apply.ts` is the sole file that writes `.claude/settings.json`. The model may only trigger it.
- **Apply target is the project-scoped tracked `.claude/settings.json`** — never `~/.claude/settings.json`, never another project. Writes are atomic, schema-validated, deduped.
- **Only `explicit_once`-provenance grants are promotable.** Transcript-only executions are observations.
- **Exact-by-default.** Generalization only from the reviewed template registry. Classification always runs on the *proposed rule* (post-edit), never the observed command.
- **Levels + keywords:** `ok`/`broad` → `@claude allow`; `risky` → `@claude allow-risky`; `destructive` → `@claude allow-destructive` (exact byte-for-byte, kept per Decision B); `@claude deny`; `@claude revoke`. Keyword must be ≥ the effective level; escalation refused.
- **Two-phase apply.** Per-candidate comments record decisions only; one final `@claude apply permission review` freezes + makes a single settings commit.
- **One task = one commit**, message `[perm-loop-Tn] <summary>`, verified green before the next.
- **TDD.** Test first, watch it fail, implement, watch it pass, commit.

## File Structure

```
scripts/src/harness/lib/permissions.ts          (extend, OBS-12) classification, redaction, matcher, candidates
scripts/src/harness/lib/permissionTemplates.ts  (new) reviewed generalization registry
scripts/src/harness/lib/permissionLedger.ts     (new) provenance ledger parse + types
scripts/src/harness/lib/permissionApply.ts      (new) pure decision-parse + enforce + settings-mutation core
scripts/src/harness/permissions-capture.ts       (new CLI) build + write artifacts
scripts/src/harness/permissions-apply.ts         (new CLI) apply a frozen decision set (wraps lib)
scripts/src/harness/report.ts                    (extend) `## Permission review` section
scripts/harness/permissions-capture-weekly.sh    (new) worktree + capture branch wrapper
.claude/hooks/permission-ledger.mjs              (new) PreToolUse ledger hook
.github/workflows/permission-apply.yml           (new) hardened apply workflow
.github/workflows/harness-weekly.yml             (extend) render permission-review into the PR
docs/superpowers/metrics/permissions-review/     (new dir) <YYYY-WW>.{json,md} committed artifacts
docs/superpowers/metrics/permissions-managed.json(new) managed-rule provenance + expiry
docs/ops/permission-review-cron.md               (new) launchd install + operation
scripts/src/__tests__/permissions.test.ts        (extend)
scripts/src/__tests__/permissionApply.test.ts    (new)
scripts/src/__tests__/permissionsCapture.test.ts (new)
scripts/src/__tests__/report.test.ts             (extend, if present; else new)
```

---

### Task 1: `destructive` level + `classifyRule`

**Files:** Modify `scripts/src/harness/lib/permissions.ts`; Test `scripts/src/__tests__/permissions.test.ts`.

**Interfaces:**
- Produces: `type GrantLevel = "destructive" | "risky" | "broad" | "ok"`; `classifyRule(rule: string): GrantClass` (classifies a full `Tool(pattern)` rule string — the post-edit path). `classifyGrant` remains for OBS-12 callers and now delegates to `classifyRule`.

- [ ] **Step 1: Failing tests.** Add to `permissions.test.ts`:
```ts
import { classifyRule } from "../harness/lib/permissions.js";
describe("classifyRule — destructive split", () => {
  it("classifies the destructive subset", () => {
    for (const r of ["Bash(rm -rf x)", "Bash(sudo x)", "Bash(chmod +x x)", "Bash(git reset --hard)", "Bash(git push --force)", "Bash(dd if=/dev/zero of=x)"])
      expect(classifyRule(r).level).toBe("destructive");
  });
  it("keeps risky/broad/ok distinct from destructive", () => {
    expect(classifyRule("Bash(git push origin main)").level).toBe("risky");   // plain push, not force
    expect(classifyRule("Bash(pnpm run *)").level).toBe("broad");
    expect(classifyRule("Bash(pnpm -v)").level).toBe("ok");
    expect(classifyRule("Bash(*)").level).toBe("risky");
  });
});
```
- [ ] **Step 2: Run — fail** (`classifyRule` undefined). `npx vitest run src/__tests__/permissions.test.ts`.
- [ ] **Step 3: Implement.** In `permissions.ts`: extend `GrantLevel` with `"destructive"`. Add destructive rules (ordered FIRST): `rm -r`/`rm -rf`, `sudo`, `chmod`/`chown`, `dd if=`, `mkfs`, `git clean`, `git reset --hard`, `--force`/`push -f`/force-push, SQL `\bDROP\b`/`\bTRUNCATE\b`. Move `git reset --hard`, `chmod/chown`, `--force` out of the current risky rules into destructive. Keep plain `git push` (no force) as risky. Add:
```ts
export function classifyRule(rule: string): GrantClass {
  return classifyGrant(rule); // classifyGrant already parses Tool(arg); rules ARE entries
}
```
(If `classifyGrant`’s internals need the level enum widened, do it here.)
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit** `[perm-loop-T1] add destructive level + classifyRule`.

---

### Task 2: Redaction + secret scan

**Files:** Modify `permissions.ts`; Test `permissions.test.ts`.

**Interfaces:** Produces `redactCommand(cmd: string): string`, `scanSensitive(cmd: string): boolean`, `escapeCell(s: string): string` (markdown table + control-char escape).

- [ ] **Step 1: Failing tests.**
```ts
import { redactCommand, scanSensitive, escapeCell } from "../harness/lib/permissions.js";
describe("redaction", () => {
  it("masks db urls, tokens, passwords, emails, inline env", () => {
    const r = redactCommand('psql postgresql://u:p@h:5432/db -c "x"; curl -H "Authorization: Bearer abc123" a@b.com PASSWORD=hunter2');
    expect(r).not.toMatch(/hunter2|abc123|postgresql:\/\/u:p@/);
    expect(r).toMatch(/<db-url>|<token>|<password>|<email>/);
  });
  it("scanSensitive flags high-entropy leftovers, clears clean commands", () => {
    expect(scanSensitive("gh secret set X --body 9f8a7c6b5e4d3f2a1b0c")).toBe(true);
    expect(scanSensitive("pnpm -v")).toBe(false);
  });
  it("escapeCell neutralizes pipes/newlines/backticks/html", () => {
    expect(escapeCell("a|b\n`c`<d>")).toBe("a\\|b `c`<d>".replace(/\n/g," ").replace(/`/g,"\\`").replace(/</g,"&lt;")); // exact form asserted in impl
  });
});
```
(Adjust the `escapeCell` expectation to the implemented deterministic form.)
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement.** Deterministic ordered replacements → typed placeholders; `scanSensitive` = any residual token matching a high-entropy heuristic (≥16 chars mixed-class) or known secret keywords after redaction; `escapeCell` escapes `|`→`\|`, newlines→space, backtick→`` \` ``, `<`→`&lt;`.
- [ ] **Step 4: Run — pass.** **Step 5: Commit** `[perm-loop-T2] command redaction + secret scan + cell escaping`.

---

### Task 3: Project-allow matcher (narrow claim)

**Files:** Modify `permissions.ts`; Test `permissions.test.ts`.

**Interfaces:** Produces `matchesProjectAllow(command: string, allow: string[]): boolean` — true iff a `Bash(pattern)` entry (with `*` glob) matches `command`. Documented to claim ONLY "present in the inspected project allowlists", never "auto-approved".

- [ ] **Step 1: Failing tests.**
```ts
import { matchesProjectAllow } from "../harness/lib/permissions.js";
it("matches glob allow entries; misses uncovered commands", () => {
  const allow = ["Bash(git log *)", "Bash(pnpm -v)"];
  expect(matchesProjectAllow("git log --oneline -5", allow)).toBe(true);
  expect(matchesProjectAllow("pnpm -v", allow)).toBe(true);
  expect(matchesProjectAllow("rm -rf x", allow)).toBe(false);
});
```
- [ ] **Step 2: fail. Step 3: Implement** (extract `Bash(...)` inner, translate `*`→`.*`, anchor, `RegExp` test; non-Bash entries ignored). **Step 4: pass. Step 5: Commit** `[perm-loop-T3] project-allow glob matcher (narrow claim)`.

---

### Task 4: Template registry + `suggestRule`

**Files:** Create `scripts/src/harness/lib/permissionTemplates.ts`; Modify `permissions.ts`; Test `permissions.test.ts`.

**Interfaces:** Produces `TEMPLATES: {match: RegExp, rule: (m) => string}[]` (small, reviewed) and `suggestRule(command: string): string` — a matching template's wildcard rule, else the exact `Bash(<command>)`.

- [ ] **Step 1: Failing tests.**
```ts
import { suggestRule } from "../harness/lib/permissions.js";
it("generalizes only via the reviewed registry, else exact", () => {
  expect(suggestRule("git log --oneline -5")).toBe("Bash(git log *)");
  expect(suggestRule("pnpm --filter api-server test")).toBe("Bash(pnpm --filter * test)"); // if registered
  expect(suggestRule("docker run --rm x")).toBe("Bash(docker run --rm x)"); // NOT generalized — dangerous family
  expect(suggestRule("rm -rf x")).toBe("Bash(rm -rf x)"); // destructive stays exact
});
```
- [ ] **Step 2: fail. Step 3: Implement** the registry with a *short, safe* list (git read subcommands `log|status|diff|show|branch --list`, `pnpm -v`, `pnpm --filter * test|typecheck`, `pnpm run <known>` — NOT `pnpm exec`, NOT `docker run`, NOT `git config`, NOT `git push`). `suggestRule` returns exact for destructive/unmatched. **Step 4: pass. Step 5: Commit** `[perm-loop-T4] reviewed template registry + exact-by-default suggestRule`.

---

### Task 5: Provenance ledger (hook + parse)

**Files:** Create `.claude/hooks/permission-ledger.mjs`, `scripts/src/harness/lib/permissionLedger.ts`; Test `permissions.test.ts`.

**Interfaces:** Produces `type Provenance = "explicit_once"|"session_allow"|"standing_allow"|"sandbox_auto"|"builtin_readonly"|"bypass"|"unknown"`; `LedgerRecord {at, commandDigest, redactedPreview, provenance, decision}`; `parseLedger(jsonl: string, window): LedgerRecord[]`; `promotableCommands(records): Map<digest, {count, firstSeen, lastSeen}>` (only `explicit_once` + `decision==="approve"`).

- [ ] **Step 0: Verify hook capability.** Confirm against Claude Code hook docs what a PreToolUse hook receives and whether it can observe the human's approve/deny. If it cannot prove `explicit_once`, the hook records `provenance:"unknown"` and `promotableCommands` returns empty → capture is observation-only (documented safe fallback). Record the finding in the commit body.
- [ ] **Step 1: Failing test** for `parseLedger`/`promotableCommands` (fixture JSONL with mixed provenance; assert only `explicit_once+approve` are promotable, window-filtered, deduped by digest with counts).
- [ ] **Step 2: fail. Step 3: Implement** `permissionLedger.ts` (pure parse) + the hook `.mjs` (reads hook JSON on stdin, computes digest via `node:crypto`, `redactCommand`, best-effort provenance, appends a line to `.harness/permissions/ledger.jsonl`; never blocks the tool — always exits 0). **Step 4: pass. Step 5: Commit** `[perm-loop-T5] provenance ledger hook + parse (explicit_once only promotable)`.

---

### Task 6: `buildCandidates`

**Files:** Modify `permissions.ts`; Test `permissions.test.ts`.

**Interfaces:** Consumes T1–T5. Produces `Candidate` (spec data model) and `buildCandidates({ledger, transcript, projectAllow, managed, window}): Candidate[]` — grant candidates (promotable ledger digests whose command isn't `matchesProjectAllow`), deny candidates (from `parseDenials`), revoke proposals (managed rules unused ≥ N weeks). Each: `id = sha256(kind+"\0"+proposedRule)[:12]`, classify `proposedRule`, set `sensitive` from `scanSensitive`, `redactedPreview` or `"sensitive — review locally"`.

- [ ] **Step 1: Failing tests** — grant/deny/revoke split; dedupe; classification on proposed rule; sensitive withholding; not-covered filter; id stability across two runs of the same input.
- [ ] **Step 2: fail. Step 3: Implement. Step 4: pass. Step 5: Commit** `[perm-loop-T6] buildCandidates (grants+denies+revoke, redacted, classified)`.

---

### Task 7: Capture CLI + artifact writers

**Files:** Create `scripts/src/harness/permissions-capture.ts`; Test `scripts/src/__tests__/permissionsCapture.test.ts`. Add `harness:permissions:capture` to `scripts/package.json` + root `package.json`.

**Interfaces:** Consumes T6. Produces `writeArtifact(dir, week, meta, candidates)` → `<week>.json` (authoritative: `{schemaVersion, sourceCommit, settingsDigest, window, generatedAt, candidates}`), `<week>.md` (generated view: `## Grant candidates`, `## Deny candidates`, `## Revoke proposals`, `## ⚠ Destructive — review in full`, header + legend), and the gitignored local sidecar `.harness/permissions/<week>.local.json` (full commands). Flags `--weeks-ago N`, `--dry-run`.

- [ ] **Step 1: Failing tests** — all four MD sections render; destructive block shows redacted-full or `sensitive — review locally`; **no raw secret appears anywhere in json/md**; every cell escaped; `--dry-run` writes nothing; `settingsDigest` computed from the merged project allow.
- [ ] **Step 2: fail. Step 3: Implement** (reads via `transcriptDirFor` (OBS-12), ledger path, tracked `settings.json` ∪ local `settings.local.json`, managed sidecar; `sourceCommit` via git). **Step 4: pass. Step 5: Commit** `[perm-loop-T7] capture CLI + redacted artifact writers`.

---

### Task 8: Cron wrapper + worktree + launchd doc

**Files:** Create `scripts/harness/permissions-capture-weekly.sh`, `docs/ops/permission-review-cron.md`; Modify `.gitignore`.

- [ ] **Step 1:** `.gitignore` add `.harness/permissions/` already covered by `.harness/`; add explicit note. Ensure `.claude/hooks/` is NOT ignored (hook is committed) but `ledger.jsonl` + `*.local.json` under `.harness/` are ignored (they are).
- [ ] **Step 2: Implement `permissions-capture-weekly.sh`:** create/refresh a clean worktree at `.harness/permissions-wt` on a fresh `permissions-capture` branch off `origin/main`; run `pnpm harness:permissions:capture`; `git add docs/superpowers/metrics/permissions-review/<week>.json <week>.md`; assert the staged set equals exactly those paths (`test "$(git diff --cached --name-only)" = ...`); commit `[permissions] weekly capture <week>`; force-push the `permissions-capture` branch; remove the worktree. Refuse on a dirty main checkout.
- [ ] **Step 3:** `permission-review-cron.md`: the launchd plist (Mondays ~12:30 UTC), install/uninstall commands, and the manual `pnpm harness:permissions:capture --dry-run` check.
- [ ] **Step 4: Verify** the script with `bash -n` + a `--dry-run` local run. **Step 5: Commit** `[perm-loop-T8] weekly capture wrapper (worktree + capture branch) + cron doc`.

---

### Task 9: `## Permission review` report section

**Files:** Modify `scripts/src/harness/report.ts`; Test `scripts/src/__tests__/report.test.ts`.

**Interfaces:** `buildReport` gains a `## Permission review` section reading the newest `docs/superpowers/metrics/permissions-review/*.md` (tracked → CI-visible); notes its `generatedAt` + freshness; placeholder line when none exists.

- [ ] **Step 1: Failing test** — section present + inlines a fixture artifact; omitted/placeholder when none. **Step 2: fail. Step 3: Implement** (insert before `## What changed since last week`). **Step 4: pass. Step 5: Commit** `[perm-loop-T9] harness report permission-review section`.

---

### Task 10: Managed-rule sidecar + revoke proposals

**Files:** Create `docs/superpowers/metrics/permissions-managed.json` (seed `{}`); Modify `permissions.ts` (managed types + `proposeRevocations`); Test `permissions.test.ts`.

**Interfaces:** Produces `ManagedRule {rule, owner, rationale, firstSeen, lastSeen, count, expiry?}`; `proposeRevocations(managed, activeDigests, now, staleWeeks): Candidate[]` (managed rules unused ≥ staleWeeks or past `expiry`).

- [ ] **Step 1: Failing test** — a rule unused > staleWeeks yields a `revoke` candidate; a recently-used one doesn't; expired one does. **Step 2: fail. Step 3: Implement. Step 4: pass. Step 5: Commit** `[perm-loop-T10] managed-rule provenance + revoke proposals`.

---

### Task 11: `permissionApply.ts` — deterministic enforcement core

**Files:** Create `scripts/src/harness/lib/permissionApply.ts`; Test `scripts/src/__tests__/permissionApply.test.ts`.

**Interfaces:** Consumes T1/T6/T10. Produces:
```ts
type Keyword = "allow" | "allow-risky" | "allow-destructive" | "deny" | "revoke";
interface Decision { id: string; keyword: Keyword; overrideRule?: string; }
interface ApplyInput { artifact: Artifact; decisions: Decision[]; settings: SettingsJson; managed: ManagedRule[]; now: string; }
interface ApplyResult { settings: SettingsJson; managed: ManagedRule[]; applied: string[]; refused: {id:string, reason:string}[]; }
function applyDecisions(input: ApplyInput): ApplyResult;
```
Enforcement (each a test):
- keyword ≥ effective level of the effective rule (`overrideRule ?? candidate.proposedRule`), recomputed via `classifyRule`; escalation → refuse.
- `allow`/`allow-risky` → append rule to `permissions.allow`; `deny` → `permissions.deny`; `revoke` → remove from allow + managed.
- destructive: only via `allow-destructive`; effective rule must equal the candidate's captured exact command byte-for-byte (no override wildcard) → else refuse.
- candidate id must exist in the artifact AND `id === sha256(kind+"\0"+proposedRule)[:12]` (tamper check) → else refuse.
- dedupe against existing allow/deny; never remove/reorder on allow.
- managed sidecar updated with owner/rationale/first-last/count.

- [ ] **Step 1: Failing tests** covering EVERY enforcement bullet + the Critical-2 cases: `allow <id> as Bash(*)` under bare `allow` → refused; destructive override differing byte-for-byte → refused; tampered id → refused; idempotent re-apply (already-present rule) → no dup.
- [ ] **Step 2: fail. Step 3: Implement (pure, no I/O). Step 4: pass. Step 5: Commit** `[perm-loop-T11] deterministic apply core (level enforcement, tamper/escalation guards)`.

---

### Task 12: Decision grammar parser + two-phase freeze

**Files:** Modify `permissionApply.ts` (or a sibling `permissionDecisions.ts`); Test `permissionApply.test.ts`.

**Interfaces:** Produces `parseDecisions(comments: {body:string, at:string}[]): Decision[]` — recognizes `@claude (allow|allow-risky|allow-destructive|deny|revoke) <id> [as Bash(<rule>)]`, last-writer-wins per id; and `isFrozen(comments): boolean` (a `@claude apply permission review` present) + `allDecidedOrDeferred(artifact, decisions)`.

- [ ] **Step 1: Failing tests** — grammar parse (each keyword + `as` override); last-writer-wins; freeze requires every candidate decided/deferred (else the freeze is rejected). **Step 2: fail. Step 3: Implement. Step 4: pass. Step 5: Commit** `[perm-loop-T12] decision grammar + two-phase freeze`.

---

### Task 13: `permissions-apply.ts` CLI + hardened workflow + weekly render

**Files:** Create `scripts/src/harness/permissions-apply.ts`, `.github/workflows/permission-apply.yml`; Modify `.github/workflows/harness-weekly.yml`. Add `harness:permissions:apply` alias.

- [ ] **Step 1: CLI** `permissions-apply.ts`: read the PR's artifact (`--week`), the settings + managed files, the frozen decisions (`--decisions <file>` produced by the workflow from PR comments); validate `schemaVersion`/`sourceCommit`/`settingsDigest`/**freshness** (`--max-age-days`, default 8); call `applyDecisions`; write `.claude/settings.json` + `permissions-managed.json` atomically; schema-validate; print applied/refused. Exit non-zero on any refusal.
- [ ] **Step 2: `permission-apply.yml`** (dedicated, NOT `claude.yml`): trigger `issue_comment` containing `@claude apply permission review`; **gate** `if:` on PR having the `permission-review` label, base `main`, head `harness-weekly/*`, comment author ∈ authorized actors, PR `review_decision == APPROVED`; `permissions: contents: write, pull-requests: write`; steps: checkout PR head, `pnpm install`, extract decisions from PR comments into a file (deterministic parser, not model freehand), run `pnpm harness:permissions:apply`, commit `[permissions] apply review <week>` + push; `claude_args` restricted to `--allowedTools "Read"` only (the mutation is the script, not the model).
- [ ] **Step 3: harness-weekly.yml** — after writing the report, copy the latest committed `permissions-review/<week>.md` in and instruct the PR body to include a `## Permission review` section + the `permission-review` label; the report section (Task 9) already renders it.
- [ ] **Step 4: Verify** — `bash -n` / actionlint if available; unit-test the decisions-extraction parser (Task 12) that the workflow calls. CI run is out-of-band (documented). **Step 5: Commit** `[perm-loop-T13] apply CLI + hardened permission-apply workflow + weekly render`.

---

### Task 14: Docs + gitignore + aliases

**Files:** Modify `CLAUDE.md` (harness section: the loop + commands + the two Decisions), `docs/superpowers/metrics/README.md` (permissions-review artifact + managed sidecar columns), `.gitignore` (ensure `ledger.jsonl`, `*.local.json`, `permissions-wt/` ignored; `.claude/hooks/` tracked).

- [ ] **Step 1:** Edits above. **Step 2: Verify** `git check-ignore` for the local-only paths + `git ls-files` for the hook. **Step 3: Commit** `[perm-loop-T14] docs + gitignore + aliases for the permission-review loop`.

---

### Task 15 (QA): end-to-end pipeline on fixtures

**Files:** Create `scripts/src/__tests__/permissionLoop.e2e.test.ts`.

**Interfaces:** Consumes the whole pipeline. No browser (harness tooling) — the QA gate is a full local fixture run.

- [ ] **Step 1: Failing test** — seed a fixture ledger (mixed provenance incl. one `explicit_once` grant, one denial, one destructive `explicit_once`, one command carrying a fake secret), a fixture project allow, a fixture managed sidecar. Run capture → assert: artifact has the grant/deny/destructive candidates, the secret NEVER appears in json/md, destructive rendered redacted-full, sensitive one withheld. Then run `applyDecisions` with a frozen set: `allow` the ok grant, `allow-destructive` the destructive (exact), a bad `allow <destructive-id>` → refused, an `allow <id> as Bash(*)` → refused. Assert final settings.json has exactly the two intended allow entries, managed sidecar updated, refusals recorded.
- [ ] **Step 2: fail. Step 3: make green** (fixtures + wiring only; no new product code). **Step 4: Full gate** — `scripts` typecheck + full `npx vitest run`. **Step 5: Commit** `[perm-loop-T15] e2e fixture test of capture→artifact→apply`.

---

## Self-Review

- **Spec coverage:** Critical 1 → T2/T6/T7 (redaction, no-raw-in-git, sensitive). Critical 2 → T11 (effective-level reclassify, tamper/escalation, byte-for-byte destructive). Review 1 → T8/T13 (worktree, capture branch, workflow fetch+validate). Review 2 → T11/T13 (code + hardened workflow, not skill). Review 3 → T5 (provenance ledger, explicit_once only). Review 4 → T3 (narrow claim). Review 5 → T4 (exact-by-default + registry) with Decision B kept in T11. Review 6 → T7 (metadata) + T12/T13 (freshness + two-phase freeze). Review 7 → T10 (managed + revoke). Decision A → T2/T7 (destructive redacted-full else review-locally). Decision B → T11 (`allow-destructive` kept).
- **Placeholders:** none — each task has concrete files, signatures, test names.
- **Type consistency:** `GrantLevel`, `Candidate`, `Decision`, `Keyword`, `Provenance`, `ManagedRule`, `Artifact` used consistently T1→T15.
- **Verification gate per task:** `scripts` typecheck + `npx vitest run` green before each commit; full suite at T15.

## Execution Handoff

Two options:
1. **Subagent-driven / agent-team (recommended for this security-sensitive, multi-file feature).**
2. **Inline execution** with per-task checkpoints.
