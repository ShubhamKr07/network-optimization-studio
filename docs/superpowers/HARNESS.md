# Harness self-monitoring (OBS-1…OBS-11) — operating manual

The measurement + self-correction layer that makes this repo's dev process observable: a metrics
store, recorder/reporter commands, a flake-quantification lane, a deploy smoke runner, a docs
pipeline, and the gates that come out of them.

Moved verbatim out of `CLAUDE.md` on 2026-09-22 per that file's hard rule #9 (long-form records live
in their own doc; `CLAUDE.md` carries only a hyperlink).

Related docs:
- `docs/superpowers/metrics/README.md` — per-CSV column semantics + the two harness rules, in full
- `docs/superpowers/specs/harness-self-monitoring.md` + `docs/superpowers/plans/harness-self-monitoring.md` — the original spec/plan (historical)
- `docs/superpowers/gates/` — proposed and live gates
- `docs/ops/{smoke,e2e-stale-specs,permission-review-cron}.md` — the operational runbooks

---

A measurement + self-correction layer that makes the dev process observable. Spec/plan:
`docs/superpowers/{specs,plans}/harness-self-monitoring.md`. It **layers on** the existing
`.superpowers/sdd/` ledger (derives from it + git), never replaces it. Never fabricate a metric —
underivable values are the literal `unknown`.

**Metrics store** (`docs/superpowers/metrics/`, six append-only CSVs + README with the two rules):
`tasks` (one row per finished task), `failures` (per gate failure, taxonomy `cause`), `flake`,
`deploys`, `docs-audit`, `permissions` (per retro permission audit — grants classified
risky/broad/ok + denials attributed to the task window). Weekly report → `reports/YYYY-WW.md`.

**Commands** (TS under `scripts/src/harness/` + `scripts/src/deploy/`, `tsx`-run; shell at
`scripts/harness/`; root `pnpm` aliases delegate):
- `pnpm harness:record --task <id> …` — append a task row (derives timestamps/merged_sha; `tokens`
  always `unknown` — no job token source). Refuses duplicates without `--force`.
- `pnpm harness:permissions --task <id>` — audit `.claude/settings.local.json` grants (classify
  risky/broad/ok) + attribute runtime tool denials from the session transcript to the task window;
  append a `permissions.csv` row. **Exits 3 (STOP-and-ask) on a risky grant or a recurring denial.**
  Baseline for `allow_new` is gitignored scratch (`.harness/permissions/`). Run by `/harness-retro`.
- **Weekly permission-review loop** (grants/denials → reviewed promotion into the tracked project
  allowlist): `pnpm harness:permissions:capture [--dry-run|--write-managed]` builds this week's
  candidate list from the local **PreToolUse/PostToolUse ledger** (`.claude/hooks/permission-ledger.mjs`
  → `.harness/permissions/ledger.jsonl`, provenance `prompted_and_executed`) + transcripts, writing a
  redacted TRACKED artifact `docs/superpowers/metrics/permissions-review/<week>.{json,md}` (+ a
  gitignored `<week>.local.json` with full commands). **No secrets in git**: a command that trips the
  secret scan is committed as `sensitive — review locally` with NO rule and is promotable only via a
  local apply. `scripts/harness/permissions-capture-weekly.sh` (local Mon cron, see
  `docs/ops/permission-review-cron.md`) commits it to the `permissions-capture` branch; the Monday
  harness-weekly workflow renders it into the PR (`## Permission review`). Review by commenting
  `@claude allow|allow-risky|allow-destructive|deny|revoke|defer <id> [as Bash(<rule>)]`, then
  `@claude apply permission review` — the hardened `permission-apply.yml` runs `pnpm
  harness:permissions:apply` (deterministic; default-branch code over PR data only) which writes the
  accepted rules into the **project-scoped tracked `.claude/settings.json`** (never user-global). A
  risky grant needs `allow-risky`; **destructive needs `allow-destructive` (exact byte-for-byte, kept
  by explicit decision — Decision B)** and is shown redacted-in-full for review (Decision A).
- `pnpm harness:report [--week YYYY-WW]` — write the weekly report (medians, flake top-5, deploy
  rollup, failure causes + 2nd-occurrence flags, `## Documentation`).
- `pnpm smoke --env production|preview` — 7 post-deploy checks from outside Render
  (`cors_preflight`, `cookie_attributes`, `fetch_credentials`, `postgres_tls`, `vite_env_baked`,
  `python_solver_present`, `free_tier_wakeup`); targets resolve `--api-base`/`--studio-base` →
  `NOS_API_BASE`/`NOS_STUDIO_BASE` → live fallback. See `docs/ops/smoke.md`.
- `bash scripts/harness/flake-audit.sh --runs 20` — frozen-commit flake quant → `flake.csv`.
- `pnpm docs:audit --full | --since <ref> [--mechanical-only]` — mechanical doc candidates (6
  detectors) → `.harness/docs-audit/candidates.json` + `docs/superpowers/docs-audit/inventory.json`.
- `pnpm docs:lint` — the proposed `doc_drift` gate (stale_reference only, exit non-zero). Runnable,
  **not** wired to CI yet.

**Gates:** the registration-points test (`registration.test.ts`, in the fast api-server gate) is
live. Two proposed gates are **not enabled**: e2e-in-CI (**skipped** — no CI browser/app/seed infra),
`doc_drift`/`docs:lint` (**deferred** until the stale-ref baseline is clean). See
`docs/superpowers/gates/` + `docs/ops/e2e-stale-specs.md`.

**Weekly job + docs pipeline (one combined PR, human-gated):** the GitHub Actions workflow
`.github/workflows/harness-weekly.yml` runs **Mondays 13:00 UTC** (+ `workflow_dispatch`). It writes
the metrics report (`pnpm harness:report`) and the mechanical candidates (`pnpm docs:audit --full`),
then (via `anthropics/claude-code-action` + the `docs-audit` skill) opens **one PR** with two
sections: a **FYI `## Weekly report`** (the committed scorecard, no action) and reviewable
**`## Docs-audit findings`** (one commit per verified finding). Older `harness-weekly/*` PRs are
auto-superseded. **Apply is `@claude`-driven on the PR:** comment `@claude apply|keep|edit|dismiss
<finding-id>` per finding, then `@claude apply the review` — `claude.yml` (now `contents`+`pull-requests:
write`) follows `.claude/skills/docs-apply/SKILL.md` to rewrite the branch (revert/edit) and merge
`--no-squash`. `/docs-apply <pr>` still works locally. **Nothing reaches `main` except via a reviewed
PR.** `docs/superpowers/specs/**` + `plans/**` are historical — never audited. (`.harness/` is
gitignored scratch.)
