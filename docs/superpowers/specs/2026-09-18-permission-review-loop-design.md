# Weekly Permission-Review Loop — Design

**Status:** design (awaiting user review)
**Builds on:** OBS-12 (`scripts/src/harness/lib/permissions.ts`, `permissions.csv`) — PR #15.
**Date:** 2026-09-18

## Goal

Close the loop between the permissions Claude was granted/denied during a week and the standing
allowlist: surface a weekly candidate list in the Monday harness PR, let the human accept/reject each
in PR comments, and have `@claude` write the accepted patterns into the **project-scoped, tracked**
`.claude/settings.json` — so future matching Bash commands auto-approve without a prompt.

## Scope boundary (why the pieces live where they do)

The two inputs — the session **transcript** (`~/.claude/projects/<slug>/*.jsonl`) and the current
**allow list** (`.claude/settings.local.json`) — are **machine-local and gitignored**. GitHub Actions
cannot read them. Therefore:

- **Capture must run locally** (a Monday cron/launchd job on the user's machine).
- **The apply target is the tracked `.claude/settings.json`** (project-scoped — affects only this repo,
  never other projects, never the user-global `~/.claude/settings.json`), because that is the only
  permission file `@claude`/CI can write and version. Claude Code merges tracked `settings.json` ∪
  local `settings.local.json`, so an entry written to the tracked file takes effect locally exactly
  like a local grant.
- **The Monday PR renders a *committed* candidate file** (refreshed by the local cron). If the cron
  did not run that week the list is stale — explicitly accepted.

## Data model

A **candidate** is one deduped Bash command worth a standing decision:

```
{
  id: string,            // sha1(kind + "\0" + normalizedCommand)[:10] — stable across weeks
  kind: "grant" | "deny",
  command: string,       // the literal command as run/denied (full, never truncated)
  suggestedPattern: string, // generalized allow/deny pattern, editable by the human;
                            //   for destructive: EXACTLY the literal command (never wildcarded)
  level: "destructive" | "risky" | "broad" | "ok",
  count: number,         // times seen in the window
  lastSeen: string       // ISO timestamp
}
```

- **grant candidate** = a Bash call that *executed* in the window but is **not matched** by the current
  merged allow list. (These are commands okayed at a prompt or run ad-hoc, not yet allowlisted. A
  command that ran under bypass/acceptEdits mode also lands here — it is still a not-yet-allowlisted
  command worth promoting, so the definition holds.)
- **deny candidate** = a Bash call the human denied in the window (parsed via OBS-12's `parseDenials`).

### Classification levels (extends OBS-12's `risky|broad|ok`)

A new **`destructive`** level is split out of `risky` — the narrow, irreversible subset:

| level | membership |
|-------|-----------|
| `destructive` | `rm -r*`/`rm -rf`, `sudo`, `chmod`/`chown`, `dd if=`, `mkfs`, `git clean`, `git reset --hard`, `--force`/force-push, SQL `DROP`/`TRUNCATE` |
| `risky` | whole-tool grant, unrestricted wildcard, whole-MCP-server grant, plain `git push`, secret/env exposure, arbitrary `psql *` |
| `broad` | scoped wildcard (`Bash(pnpm run *)`) |
| `ok` | fully-specified command |

Rules are ordered, first-match-wins, `destructive` before `risky` before `broad`. Rules only
**surface** candidates for human review; they never auto-decide.

## Pattern suggestion

- `ok`/`broad`/`risky` → a generalized, human-editable pattern. Heuristic: keep the executable + (for
  known multi-verb tools `git`/`pnpm`/`npm`/`brew`/`docker`) its first subcommand, replace the rest
  with `*` (`git log --oneline -5` → `Bash(git log *)`). The human edits it in the PR before applying.
- `destructive` → **the exact literal command, no wildcard**, rendered untruncated. Promoting a
  destructive command is always for that one command, never a class.

## Components

### 1. `scripts/src/harness/lib/permissions.ts` (extend, OBS-12)
- Add `destructive` to `GrantLevel`; split the destructive rules out of the current risky rules.
- `matchesAllow(command: string, allow: string[]): boolean` — interpret `Tool(pattern)` with `*` as a
  glob; used to filter already-allowlisted commands out of grant candidates.
- `extractBashRuns(jsonlText, window): {command, at}[]` — successful (non-denial) Bash `tool_use`s.
- `suggestPattern(command: string, level): string`.
- `buildCandidates(jsonlText, mergedAllow, window): Candidate[]` — grants + denies, deduped, classified.

### 2. `scripts/src/harness/permissions-capture.ts` (new CLI) — `pnpm harness:permissions:capture`
- Read last-7-day transcripts + merged allow (tracked `settings.json` ∪ local `settings.local.json`).
- Build candidates; write the tracked review file (below). `--weeks-ago N` for backfill; `--dry-run`.
- Does **not** commit/push itself — that is the cron wrapper's job (keeps the CLI pure-ish + testable).

### 3. `scripts/harness/permissions-capture-weekly.sh` + launchd/cron installer (new)
- Wrapper: run capture, `git add docs/superpowers/metrics/permissions-review/<week>.md`, commit
  `[permissions] weekly capture <week>`, push. A `docs/ops/permission-review-cron.md` documents the
  launchd plist (Mondays ~12:30 UTC, before the 13:00 workflow) + one-command install.

### 4. Review file — `docs/superpowers/metrics/permissions-review/<YYYY-WW>.md` (tracked)
Markdown the human reads in the PR and `@claude` parses. Sections:
- `## Grant candidates` — table `id · command · suggested pattern · level · count`.
- `## Deny candidates` — table `id · command · level · count`.
- `## ⚠ Destructive — review in full` — every destructive candidate, **full command verbatim**, its
  own block, count, last-seen. No suggested wildcard.
- A header line: window, generated-at, counts, and the decision legend (the `@claude` keywords).

### 5. `report.ts` (extend) — `## Permission review` section
`pnpm harness:report` reads the latest committed review file (works on CI — the file is tracked) and
inlines it as a `## Permission review` section of the weekly report/PR. Stale-safe (renders whatever
was last committed; notes the file's generated-at).

### 6. `.claude/skills/permission-apply/SKILL.md` (new) + `claude.yml`
`@claude`-driven, mirrors the `docs-apply` pattern. On the PR, per candidate id:
- `@claude allow <id>` — accept a grant candidate (level `ok`/`broad` only). Appends the (possibly
  human-edited) pattern to `.claude/settings.json` `permissions.allow`.
- `@claude allow-risky <id>` — required to accept a `risky` grant candidate.
- `@claude allow-destructive <id>` — required to accept a `destructive` grant candidate; writes the
  exact literal command, never a wildcard.
- `@claude deny <id>` — append to `permissions.deny`.
- `@claude allow <id> as Bash(git log *)` — override the suggested pattern with the given one.
A bare `allow` on a `risky`/`destructive` candidate is **refused** with a comment naming the required
keyword. All writes dedupe against existing `settings.json` entries; the skill commits and the PR
merges via the existing flow. `claude.yml` already has `contents`+`pull-requests: write`.

## Safety invariants

1. A `risky` candidate needs `allow-risky`; a `destructive` candidate needs `allow-destructive`. Bare
   `allow` never promotes either.
2. Destructive candidates are shown in full and promoted only as their exact literal command.
3. Apply target is the **project-scoped** tracked `.claude/settings.json` — never the user-global
   `~/.claude/settings.json`, never another project.
4. Writes are additive + deduped; apply never removes or reorders existing entries.
5. Capture reads only; it never edits any settings file.

## Testing

- `permissions.test.ts` (extend): destructive vs risky classification of each subset; `matchesAllow`
  glob semantics (covered/uncovered); `suggestPattern` per level incl. destructive-stays-exact;
  `buildCandidates` grant/deny split, dedupe, count, window filter.
- `permissions-capture.test.ts` (new): review-file rendering (all four sections; destructive verbatim
  + untruncated); dedupe against a mock merged-allow; `--dry-run`.
- `report.test.ts` (extend): the `## Permission review` section renders a committed review file and is
  omitted/placeholder when none exists.
- Apply skill: exercised by a golden-fixture test of the parse-decisions → settings.json-write step
  (pure function under `lib/`), not the live `@claude` run.

## Out of scope

- Auto-applying without human review. Every promotion is a deliberate PR comment.
- Non-Bash tools (Read/Edit/WebFetch grants): the loop is Bash-command-centric per the request.
- Editing the user-global settings or any other project.
