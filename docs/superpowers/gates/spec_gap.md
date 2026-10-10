# Gate proposal: spec_gap

**Symptom:** A check that everyone believed was running, or believed could fail, did neither — so a real defect survived multiple tasks and multiple reviews before a human ran the command directly.

**Occurrences:** (3 ungated in `failures.csv`, plus the eight-finding `WF` cluster below)

- `2026-09-15` `chapter-4-chens` — `precheckChensInputs` / `coverage_floor_infeasible`.
- `2026-09-29` `ch5-delivery` — `pnpm run typecheck` was **red from Task 4 through Task 7**. Task 4's reviewer explicitly reported having run it clean; it had not been. Task 7's implementer then mis-attributed the failure to an unrelated deliberately-red test in the same file. It was found only when the controller ran the gate personally, four tasks later.
- `2026-09-29` `ch5-delivery` — `referenceCosts.test.ts`'s mount guard asserted `expect(res.status).not.toBe(404)`. An unmatched `/api` path falls through to `requireAuth` and returns **401**, so the assertion passed with the router unmounted. The test written to protect a silent-failure registration point could not fail. It survived its own task review (verified by inspection, recorded as an explicit caveat) and was caught only by the whole-branch review.

- `2026-10-10` `WF` — **eight findings in one branch**, every one a test the controller's own brief authored and none caught by any gate. The per-task reviewer caught all eight. Full shape-by-shape list in the `failures.csv` row; the four that matter for gating are: a hand-maintained label map that named two nonexistent fields and omitted a real one; forward and reverse label guards that **did not meet**, so 8 real fields fell through both; a nested-path test that hand-built the fixture and so bypassed the very regex it existed to prove; and a caller-level computation with **zero** coverage, where the only test hit the fails-closed branch — a `!values[k]` mutant would have mislabelled all 376 production scenarios. Shared diagnosis: the brief asserts what the code *should* do without asking what a *broken* version would produce. The counter-example is on the same branch — `WF-8` ran **nine real mutations** and its guard held, which is the only thing in this repo's history observed to catch this class before review.

**Root cause, shared by the middle two:** local gates are only as trustworthy as the agent reporting them, and this branch had **no CI at all**. `.github/workflows/ci.yml` triggers on `push: branches: [main]` and `pull_request`. `ch5-delivery` was a feature branch merged by fast-forward with no PR, so CI never ran on any of its 25 commits. The first CI run will happen *after* the merge, on `main`.

## Proposed automated gate — three parts

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

**Part 3 (new, from the `WF` cluster — two sub-parts).** Two of WF's eight shapes are mechanically gateable; the rest are not, and saying so is the point.

**3a — diff coverage on changed lines.** Catches WF shape (8) outright and shape (6) in most forms: a new computation shipped with its only test on the fails-closed branch has 0% coverage on the lines that matter, while the suite is green at 2308 tests.

```bash
# changed .ts/.tsx lines in src/ must be covered; threshold is the knob, not the mechanism
pnpm --filter studio test -- --coverage --coverage.reporter=json
node scripts/src/harness/diff-coverage.ts --base "$(git merge-base main HEAD)" --min 80
```

The script does not exist yet — that is the work this part proposes. Whole-repo coverage thresholds are deliberately **not** proposed: this repo's absolute coverage is irrelevant, the question is always whether *this branch's* new lines can fail.

**3b — derive schema-keyed maps, never enumerate them.** Catches shapes (1) and (4). A hand-written map keyed on manifest or schema content (`INPUT_FIELD_LABELS` is the instance) drifts the moment a manifest changes, and two one-directional guards do not add up to one bidirectional one — WF's forward guard checked "every required field has a label" and its reverse guard checked "every label names a real field", and a real non-required field with no label satisfied both.

```ts
// one test, both directions, generated from the manifests rather than from a literal list
for (const m of allManifests()) for (const k of Object.keys(m.inputsSchema.properties))
  expect(INPUT_FIELD_LABELS).toHaveProperty(k);
for (const k of Object.keys(INPUT_FIELD_LABELS))
  expect(allManifestPropertyNames()).toContain(k);
```

**Not gateable, recorded as such.** Shapes (2), (3), (5) and (7) — a wrong expected string, a hand-built fixture that bypasses the code path, a precondition already false for existing mocks, and a test demanding drift that was measured absent — have no mechanical signature. The only thing observed to catch them is running real mutations against the new test before accepting it (`WF-8`, nine mutations). That belongs in the implementer contract, not in CI, and it is a process proposal rather than a gate.

**How to enable:**
- Part 1 — edit `.github/workflows/ci.yml`'s `on.push.branches`.
- Part 2 — add the `rg` check as a step in `ci.yml`'s `test` job, or as a `pretest` script in `artifacts/api-server/package.json`.
- Part 3a — write `scripts/src/harness/diff-coverage.ts`, then add it to `ci.yml`'s `test` job. Part 3b — one new test file next to `formatInputIssues.test.ts`; no CI change.

**Cost:** Part 1 increases CI minutes roughly in proportion to feature-branch pushes. Part 2 is a sub-second grep, but would flag any *legitimate* negated status assertion — the repo should be swept once before enabling so the baseline is clean.

**Status:**

- **Part 1 — APPROVED AND ENABLED** (human decision, 2026-09-29). `.github/workflows/ci.yml` now triggers on `push: branches-ignore: []`, i.e. every branch. Chose the broader of the two options the proposal offered: a pattern list would reopen the same gap silently the first time a branch is named outside it, which is the exact failure mode being closed.
- **Part 2 — still proposed, not enabled.** The negated-status-assertion check needs a one-time sweep of the existing suite first, so the baseline is clean before it can block.
- **Part 3 — proposed 2026-10-10, awaiting human approval, not enabled.** 3a needs a script written; 3b is one test file. Neither is started.

**Known cost of Part 1, not mitigated:** PR branches now run CI twice — once for the `push` event and once for `pull_request` — and every agent push to a feature branch spins up a full Postgres-backed run. The standard mitigation is a `concurrency` block cancelling superseded runs on the same ref. That was deliberately **not** added here, because it was not part of what was approved and it changes which commits get a result. Add it if the CI minutes become a problem.
