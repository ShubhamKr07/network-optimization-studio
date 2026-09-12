# Cron job: weekly e2e-spec repair (Mondays 13:00 UTC)

Scheduled prompt (weekly, unattended). Repairs stale Playwright specs — tests whose feature still
ships but whose selectors/text/flows drifted (later bundles changed testids/DOM). It works on a
branch and opens a PR for human review; it **never merges to `main`** and **never edits source under
`artifacts/*/src`** (only `artifacts/studio/e2e/**`). Catalog of known-stale specs:
`docs/ops/e2e-stale-specs.md`.

## Steps

1. `git checkout main && git pull --ff-only`. If the tree is dirty or `main` can't fast-forward,
   note it and stop.

2. **Find the broken specs.** Start the local dev servers (see `scripts/harness/flake-audit.sh`
   header: api-server on 3001 with `DATABASE_URL`, studio on 5174 with `API_PROXY_TARGET`,
   `E2E_BASE_URL=http://localhost:5174`). Run `pnpm e2e:gate`. If the servers cannot start in this
   environment, write a one-line note and stop (do not force). Collect the failing specs (expect the
   ones in `docs/ops/e2e-stale-specs.md` plus any newly-rotted).

3. **Repair each failing spec** (branch `e2e-repair/YYYY-WW`, one commit per spec):
   - **Retarget drifted selectors/text to the current DOM** — read the live component for the real
     testid (e.g. `auth-band`→`auth-cover`; `input-map-draft-panel`→`CreateEntityDialog`/
     `MapDetailsCard`; Studio header→Workspace). Never change app source to match a test.
   - **Seed solver results instead of driving real CBC** where a spec only needs a result to exist
     (this is why they time out here) — use the async job API / a fixture, leaving real-CBC accuracy
     to pytest.
   - **Clean up dead-feature assertions** — the Compare page (removed Phase 3.2) and the header
     scenario dropdown (removed Bundle 6) no longer exist; drop those specific assertions or retarget
     to the current equivalent (Workspace Solution-Summary compare / sidebar switching). Do NOT delete
     a whole spec whose feature still ships.
   - Decouple from seed-specific ids (e.g. `cost-summary-compare-open-facilities-<id>`).
   - If a repair is genuinely ambiguous, DON'T guess — leave the spec as-is and write a one-line
     diagnosis in the PR body for a human to resolve.

4. **Verify** each repaired spec passes (`pnpm --filter studio exec playwright test <spec> --retries=0`)
   before committing it. Re-run `pnpm e2e:gate` at the end; report the new pass count.

5. **Open a PR** (`gh pr create --label e2e-repair --base main`; create the label if missing), body =
   the per-spec repair summary + any left-unrepaired diagnoses. **Stop — do not merge.** A human
   reviews and merges.

6. Once the catalog in `docs/ops/e2e-stale-specs.md` is fully repaired and merged, update that doc to
   reflect it; thereafter this job is a maintenance guard that only acts when a spec newly rots.

## Guardrails
- Branch + PR only; never merge, never push to `main`, never touch `artifacts/*/src` or `solve.py`.
- If e2e infra can't come up, stop cleanly (don't fake a pass).
- Bound scope to `artifacts/studio/e2e/**` + the playwright config.
