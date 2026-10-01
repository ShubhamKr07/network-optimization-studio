# Chapter 4 two-step workflow — rollout and rollback (`ch4-2s` Task 10)

Operator record for the Chapter 4 two-step solve workflow (Step 1 Max Coverage →
Step 2 Min Distance, Step 2's coverage floor seeded by Step 1's covered demand).
Design decisions (`CH4-n`) are in
[`docs/superpowers/specs/2026-09-27-ch4-two-step-workflow-design.md`](../superpowers/specs/2026-09-27-ch4-two-step-workflow-design.md);
the task list is
[`docs/superpowers/plans/2026-09-28-ch4-two-step-workflow.md`](../superpowers/plans/2026-09-28-ch4-two-step-workflow.md);
what landed is in
[`docs/CHANGELOG-implementation.md`](../CHANGELOG-implementation.md) under
"Chapter 4 — two-step workflow".

Unlike [`ch4-migration-runbook.md`](ch4-migration-runbook.md), this rollout has
**no point of no return**. Nothing was deleted and nothing was renamed. The whole
bundle is reversible, and the two reversible pieces — the code and the one schema
object — come apart cleanly. That separation is the point of this document.

---

## What shipped

Nine tasks, each its own commit, merged `--no-ff` into
`ch4-two-step-workflow-plan`, then merged to `main` as **`0a300f8`**
(2026-09-29 00:54 +0530).

| Task | Commit | What it added |
|---|---|---|
| `ch4-2s-1` | `a5335f6` | `stepEpoch`/`step2` in the Chapter 4 input schema **+ the one schema change**, `UQ_solve_jobs_active_per_scenario` |
| `ch4-2s-2` | `0eb54ca` | `applyScenarioInputWrite` — the single epoch-write authority |
| `ch4-2s-3` | `cdd7a1f` | write routes reject a client-supplied `objective` / coverage floor |
| `ch4-2s-4` | `3763d21` | target-step derivation inside the enqueue lock; refuses a second active job |
| `ch4-2s-5` | `6cda42c` | `Scenario.steps` projection + lazy per-step result envelope |
| `ch4-2s-6` | `63e16d5` | removes the free objective toggle from both mounts |
| `ch4-2s-7` | `9ea5823` | step toggle, Step 2 parameters, confirm-and-clear |
| `ch4-2s-8` | `6e75682` | per-step output gating, the 2-of-2 comparison table |
| `ch4-2s-9` | (in `0a300f8`) | `ch4-two-step.spec.ts`, sibling-spec repair, gate, closeout |

The commit `main` pointed at immediately before the merge — i.e. the code-rollback
target **as of 2026-09-29** — is **`22be7e8`** (`0a300f8^1`).

**Read the caveat in "Lever 1" before using `22be7e8` today.** Several unrelated
bundles have shipped on top of it since, so it is no longer a Chapter-4-only
revert.

---

## The only schema change

One partial unique index on `solve_jobs`. No column added, no column dropped, no
table created, no data migrated. Declared in
`lib/db/src/schema/solve_jobs.ts:134-136`:

```ts
uniqueIndex("UQ_solve_jobs_active_per_scenario")
  .on(table.scenarioId)
  .where(sql`${table.modelId} = 'max-coverage-us' AND ${table.status} IN ('queued', 'running')`),
```

Applied the way every schema change in this repo is applied — `drizzle-kit push`,
no migration file.

**Observed `indexdef`, read from the local `nos_dev` database on 2026-10-01:**

```
CREATE UNIQUE INDEX "UQ_solve_jobs_active_per_scenario" ON public.solve_jobs
  USING btree (scenario_id)
  WHERE ((model_id = 'max-coverage-us'::text)
     AND ((status)::text = ANY ((ARRAY['queued'::character varying,
                                       'running'::character varying])::text[])))
```

The `model_id = 'max-coverage-us'` predicate is the part to check. Without it this
index would impose one-active-job-per-scenario on **all seven models**, which is
a different product decision than the one that was made, and would break
`scenarioSolveAtomicity.test.ts` (it deliberately enqueues a second
`p-median-us` job on a scenario that already has one queued). See CLAUDE.md's
Gotchas entry on model-scoped predicates.

**Production `indexdef`: `unknown`.** `nos-postgres` only accepts external
connections from allowlisted IPs, and this session's address is not on the list,
so it could not be read here. Verify it before relying on it:

```sql
SELECT indexdef FROM pg_indexes
WHERE indexname = 'UQ_solve_jobs_active_per_scenario';
```

Zero rows means the index is not there — which, per the next section, is a
degraded-but-not-broken state, not an outage.

---

## Smoke results that confirmed the rollout live

Run against production after the deploy. Both frozen goldens reproduced exactly —
not approximately:

| Check | Expected | Observed |
|---|---|---|
| Step 1 covered demand | `53385024` | `53385024` |
| Step 1 coverage | `68.4192%` | `68.4192%` |
| Step 1 weighted avg distance | `635.13 km` | `635.13 km` |
| Step 2 weighted avg distance, at the server-derived floor | `624.33 km` | `624.33 km` |
| Floor guard (CH4-25): client supplies its own `coverageFloorDemand` | HTTP `422` | HTTP `422` |

The Step 2 row is the one that proves the feature rather than the arithmetic: the
floor was **not** supplied by the client, it was derived server-side from Step 1's
covered demand, and `624.33 < 635.13` is the min-distance objective doing real
work under that floor.

The `422` row proves the guard is live in production and not merely unit-tested —
the floor is un-typeable by a client.

---

## Rollback — two independent levers

**The index drop and the code rollback are independent. Either can be done
without the other, in either order.**

This is not a convenience, it is a property of how the guard was built. The
one-active-job rule is enforced **twice**, deliberately:

1. The index, in the database.
2. An in-transaction check in `enqueueScenarioSolve`
   (`artifacts/api-server/src/solver/jobRunner.ts:393-403`), inside the same
   transaction that holds `SELECT ... FOR UPDATE` on the scenario row, gated on
   `scenario.modelId === MAX_COVERAGE_MODEL_ID`, returning
   `{ kind: "conflict", jobId }` → a documented HTTP `409` carrying the in-flight
   job id so the client can attach to it instead of retrying blindly.

The scenario row lock serialises two concurrent enqueues; it is the check at
`:393` that makes the second one *refuse*. So **dropping the index does not
un-enforce the rule** — the application keeps refusing a second active Chapter 4
job without it. The index is the backstop for a writer that bypasses
`enqueueScenarioSolve` entirely; nothing in the current code does.

### Lever 1 — code rollback (redeploy a previous build)

Reverts the UI, the validation, the step derivation and the `steps` projection.
Leaves the database exactly as it is.

```bash
# find the last live deploy whose commit is NOT a descendant of 0a300f8
#   mcp__render__list_deploys  srv-d9hglg6pbkes73a1j8b0   (nos-api)
#   mcp__render__list_deploys  srv-d9hg4gvlk1mc73dtp67g   (nos-studio)
git merge-base --is-ancestor 0a300f8 <candidate-sha> \
  && echo "TOO NEW — contains the bundle" \
  || echo "ok — predates the bundle"
```

Both services, or neither. The UI's step toggle talks to API shapes this bundle
added; rolling back only one leaves a frontend asking for `steps` from a server
that no longer projects it, or a server deriving a target step for a frontend
with no way to show it. `nos-api` has `autoDeployTrigger: off`, so it always
needs a deliberate trigger.

**Caveat, and it has grown since the bundle shipped.** `22be7e8` was a clean
Chapter-4-only revert on 2026-09-29. It is not one any more: Chapter 5
(`delivery-teaching-us`), the CH4UX bundle, the Chapter 9 JADE unlock and the CI
work have all landed on top. Rolling back to `22be7e8` today reverts all of them
too. If the goal is specifically to retire the two-step workflow, a forward fix —
or `git revert` of the nine commits — is the smaller change, and both are smaller
than they look because this bundle added no columns.

**What a code rollback does NOT undo:** `stepEpoch` and `step2` keys already
persisted inside `scenarios.inputs` for Chapter 4 rows stay there. That is
harmless. `maxCoverageInputsSchema` at `22be7e8` has no `.strict()` on its
top-level object (verified by reading the file at that commit), so the
rolled-back validator ignores the unknown keys rather than rejecting them — no
`422` storm on existing scenarios. The keys simply stop being read, and are
rewritten away whenever that scenario's inputs are next written.

### Lever 2 — drop the index

```sql
DROP INDEX IF EXISTS "UQ_solve_jobs_active_per_scenario";
```

The quotes are required: the name is mixed-case, so unquoted Postgres folds it to
`uq_solve_jobs_active_per_scenario` and finds nothing. `IF EXISTS` makes it
idempotent.

Safe to run while the code is still deployed, because of the double enforcement
above. The only thing lost is defence against a future writer that inserts a
`solve_jobs` row without going through `enqueueScenarioSolve`.

**It is production DDL, so it needs explicit human consent before execution**
(CLAUDE.md standing rule), even though it is trivially reversible — re-create it
by running `pnpm --filter @workspace/db run push` against the database, or by
hand from the `indexdef` quoted above.

### Reversing the index drop

```bash
DATABASE_URL="<target>" pnpm --filter @workspace/db run push
```

Re-creating the index will **fail** if the table already holds two
`queued`/`running` rows for one Chapter 4 scenario — which can only have happened
while the index was absent. Check first, and resolve the duplicates before
re-creating:

```sql
SELECT scenario_id, count(*) FROM solve_jobs
WHERE model_id = 'max-coverage-us' AND status IN ('queued','running')
GROUP BY scenario_id HAVING count(*) > 1;
```

---

## Post-rollback verification

| Lever used | Check | Expected |
|---|---|---|
| Either | `GET /api/healthz` | `200` |
| Code rollback | Chapter 4 workspace renders, solves, returns a result | no step toggle, no `0/2` counter |
| Code rollback | `GET /api/scenarios/:id` for a Chapter 4 scenario | no `steps` key |
| Index drop only | solve a Chapter 4 scenario twice in quick succession | second returns `409` with the in-flight `jobId` — **this is the check that proves the in-transaction guard is still doing the work** |
| Index drop only | the `pg_indexes` query above | zero rows |
| Index re-created | the duplicates query above | zero rows |

The `409` row is the only non-obvious one, and it is the one worth running. If it
returns `201`/`202` instead, the in-transaction guard is **not** working and the
index was load-bearing after all — which would mean this document's central claim
is wrong for the build in front of you. Stop and re-read
`jobRunner.ts:393-403` on that build before proceeding.
