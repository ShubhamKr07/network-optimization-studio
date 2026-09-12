# Gate proposal: doc_drift

**Status:** DEFERRED (checkpoint #5, 2026-09-12). Human decision: enable `docs:lint` in CI **after the
first docs-audit PR merges** and cleans the real stale references, so the baseline is near-clean first
— else CI would block on ~88 candidates on day one. `pnpm docs:lint` exists and is runnable now; it is
not yet a required gate. Revisit once the docs-audit PR has landed.

**Symptom:** a documentation file references a path / `pnpm` script / env var / HTTP route / symbol
that no longer exists in the code, because a change renamed/removed it and the doc wasn't updated.
This rots silently — docs aren't type-checked and the Sunday sweep only runs weekly.

**Occurrences:** recorded in `docs/superpowers/metrics/failures.csv` with cause `doc_drift`, appended
by `/docs-apply` whenever a file is flagged with the same finding type in two consecutive merged
docs-audit PRs.

**Proposed automated gate:** `pnpm docs:lint` — runs the `stale_reference` detector
(`scripts/src/harness/docs-lint.ts`, reusing `lib/detectors/staleReference.ts`) over the non-exempt
docs and **exits non-zero on any NEW stale path/script/env var/route** in a doc. It is the fast-gate
counterpart to the weekly sweep: catches drift at commit/CI time instead of days later.

**How to enable:**
1. Run `pnpm docs:lint` and clean every current stale reference it reports (the baseline must be
   green first).
2. Add a `Docs lint` step to `.github/workflows/ci.yml` after the studio tests:
   ```yaml
   - name: Docs lint (stale references)
     run: pnpm docs:lint
   ```
3. Optionally wire it into the local verification gate note in `CLAUDE.md`.

Until enabled, `pnpm docs:lint` exists and is runnable on demand; it just isn't a required gate.
