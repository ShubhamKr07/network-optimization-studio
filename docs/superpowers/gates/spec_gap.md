# Gate proposal: spec_gap

**Symptom:** A check that everyone believed was running, or believed could fail, did neither — so a real defect survived multiple tasks and multiple reviews before a human ran the command directly.

**Occurrences:** (3 ungated in `failures.csv`)

- `2026-09-15` `chapter-4-chens` — `precheckChensInputs` / `coverage_floor_infeasible`.
- `2026-09-29` `ch5-delivery` — `pnpm run typecheck` was **red from Task 4 through Task 7**. Task 4's reviewer explicitly reported having run it clean; it had not been. Task 7's implementer then mis-attributed the failure to an unrelated deliberately-red test in the same file. It was found only when the controller ran the gate personally, four tasks later.
- `2026-09-29` `ch5-delivery` — `referenceCosts.test.ts`'s mount guard asserted `expect(res.status).not.toBe(404)`. An unmatched `/api` path falls through to `requireAuth` and returns **401**, so the assertion passed with the router unmounted. The test written to protect a silent-failure registration point could not fail. It survived its own task review (verified by inspection, recorded as an explicit caveat) and was caught only by the whole-branch review.

**Root cause, shared by the last two:** local gates are only as trustworthy as the agent reporting them, and this branch had **no CI at all**. `.github/workflows/ci.yml` triggers on `push: branches: [main]` and `pull_request`. `ch5-delivery` was a feature branch merged by fast-forward with no PR, so CI never ran on any of its 25 commits. The first CI run will happen *after* the merge, on `main`.

## Proposed automated gate — two parts

**Part 1 (primary, catches occurrence 2).** Run CI on feature-branch pushes, not only `main` and PRs. One line:

```yaml
on:
  push:
    branches: [main, 'ch*', 'bundle*', 'scnd-*']   # or simply: branches-ignore: []
  pull_request:
```

A red `pnpm run typecheck` then becomes impossible to carry for four tasks regardless of what any report claims. This repo already has the job; it is only the trigger that excludes the branches where the work actually happens.

**Part 2 (secondary, catches occurrence 3).** Ban non-discriminating status assertions in route tests. A negated status assertion cannot distinguish "route works" from "route is unreachable and something else answered":

```bash
rg -n '\.not\.toBe\(\s*[0-9]{3}\s*\)|not\.toHaveStatus' artifacts/api-server/src/__tests__/ \
  && echo "FAIL: negated status assertion — assert the expected status positively" && exit 1
```

Positive assertions (`.expect(200)`) discriminate; negated ones pass on any other status, including an auth redirect from a completely different router.

**How to enable:**
- Part 1 — edit `.github/workflows/ci.yml`'s `on.push.branches`.
- Part 2 — add the `rg` check as a step in `ci.yml`'s `test` job, or as a `pretest` script in `artifacts/api-server/package.json`.

**Cost:** Part 1 increases CI minutes roughly in proportion to feature-branch pushes. Part 2 is a sub-second grep, but would flag any *legitimate* negated status assertion — the repo should be swept once before enabling so the baseline is clean.

**Status:**

- **Part 1 — APPROVED AND ENABLED** (human decision, 2026-09-29). `.github/workflows/ci.yml` now triggers on `push: branches-ignore: []`, i.e. every branch. Chose the broader of the two options the proposal offered: a pattern list would reopen the same gap silently the first time a branch is named outside it, which is the exact failure mode being closed.
- **Part 2 — still proposed, not enabled.** The negated-status-assertion check needs a one-time sweep of the existing suite first, so the baseline is clean before it can block.

**Known cost of Part 1, not mitigated:** PR branches now run CI twice — once for the `push` event and once for `pull_request` — and every agent push to a feature branch spins up a full Postgres-backed run. The standard mitigation is a `concurrency` block cancelling superseded runs on the same ref. That was deliberately **not** added here, because it was not part of what was approved and it changes which commits get a result. Add it if the CI minutes become a problem.
