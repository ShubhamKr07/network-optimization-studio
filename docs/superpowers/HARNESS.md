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

  **`stale_reference` has a large, mostly-false-positive baseline. Triage against the classes
  below — and quote a count only with the command that produced it.**

  Measured 2026-10-01 on `--since <merge-base> --mechanical-only`: **117 `stale_reference`
  findings**, across four *evidence kinds* (`referenced path does not exist` 87, `no matching
  source` 21, `route not in openapi.yaml` 7, `pnpm script not found` 2). Nothing in that set was
  actionable drift, but note that the total is configuration-dependent — a full scan is ~205, and
  it drifts upward whenever a doc *quotes* a path, so **re-measure rather than reuse this figure.**
  (An earlier revision of this section claimed "84 hits". That number came from a two-pattern
  `grep` over the output, not from the audit's own finding count, and it is not reproducible under
  any configuration — the same non-discriminating-check mistake this file warns about for
  `ps aux | grep -c vitest`. Corrected rather than quietly dropped.)

  1. **Glob, brace and placeholder paths the detector cannot expand — the actual bulk (55 of the
     87 path hits).** `artifacts/api-server/src/{routes,services,validation,registry}/**`,
     `docs/superpowers/specs/<date>-<feature>-design.md`, `docs/superpowers/gates/<cause>.md`,
     `docs/superpowers/{specs,plans}/harness-self-monitoring.md`. The referents exist; the literal
     string is not a path. Fixing the detector to skip tokens containing `*`, `{`, `<` would remove
     the majority of this baseline at a stroke.
  2. **Package-relative paths resolved from the repo root (~16).** The changelog writes paths as the
     package sees them (`e2e/labs.spec.ts`, `src/lib/chapters.ts`); the detector resolves from the
     root. All spot-checked exist under `artifacts/studio/` — except `lib/normalizeEmail.ts`, which
     is under `artifacts/api-server/src/`.
  3. **`path:line` citations.** `lib/db/src/schema/solve_jobs.ts:134-136` is reported missing
     because the detector tests the raw backticked token and the `:line-range` suffix fails its
     extension check — the file exists. Worth fixing before the gate is enabled, since `path:line`
     is this repo's house citation style.
  4. **`no matching source` (21) — the Arcadia/gamification detector over-matching.** Its pattern
     includes bare `badges?`/`quests?`, so `CLAUDE.md:175` is flagged purely for containing the
     word *badge* in the staleness-badge gotcha. Not drift.
  5. **Removed routes (7).** `POST /scenarios/:id/reset-to-baseline`, `POST /scenarios/compare` and
     `POST /solve` are genuinely absent from `openapi.yaml` (0 matches each) — removed or replaced
     (`POST /solve` → the async job API in G3.1). Six of the seven are in append-only history or in
     this file's own examples. **The exception worth a real look: `CLAUDE.md:157` cites
     `POST /login`, and `CLAUDE.md` is a live document, not an append-only record.**
  6. **Build/test artifacts and removed directories.** `artifacts/studio/dist/public`, `e2e/.auth`,
     `e2e/report`, `lib/datasets/`, `solvers/chens-cosmetics-cn/`.
  7. **`pnpm script not found` (2).** `.claude/agents/devops-engineer.md:3,16` cite `pnpm audit` and
     `pnpm update` — pnpm built-ins, not package scripts.

  **Documenting examples here grows the baseline**: quoting those paths added 5 findings (full scan
  200 → 205). That is a real cost of this section, and it is also why the `doc_drift` gate's
  deferral condition is what `docs/superpowers/gates/doc_drift.md` actually says — *"enable
  `docs:lint` in CI **after the first docs-audit PR merges** and cleans the real stale
  references"* — not the looser "once the baseline is clean" paraphrase used elsewhere in this file.
  Those PRs (#21, #13) are still open and unprocessed.

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
