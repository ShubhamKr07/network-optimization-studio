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

Nine tasks, each merged `--no-ff` into `ch4-two-step-workflow-plan`. That branch
was then merged into `e2e-inherited-repair` (which added four test-only commits —
`f4a231a`, `25a3a6a`, `218fee7`, `c547e2d` — from the e2e investigation that gated
the bundle), and **that** is what reached `main` as **`0a300f8`**
(2026-09-29 00:54 +0530). So `0a300f8` is slightly wider than the bundle itself.

Both SHAs are given per task because **eight of the nine task commits are merge
commits** — which changes how you revert them (see Lever 1):

| Task | Merge commit | Content commit | What it added |
|---|---|---|---|
| `ch4-2s-1` | — (single parent) | `a5335f6` | `stepEpoch`/`step2` in the Chapter 4 input schema **+ the one schema change**, `UQ_solve_jobs_active_per_scenario` |
| `ch4-2s-2` | `0eb54ca` | `eb48ba7` | `applyScenarioInputWrite` — the single epoch-write authority |
| `ch4-2s-3` | `cdd7a1f` | `96e369c` | write routes reject a client-supplied `objective` / coverage floor |
| `ch4-2s-4` | `3763d21` | `198c9d7` | target-step derivation inside the enqueue lock; refuses a second active job |
| `ch4-2s-5` | `6cda42c` | `45b0e41` | `Scenario.steps` projection + lazy per-step result envelope |
| `ch4-2s-6` | `63e16d5` | `ab1ba98` | removes the free objective toggle from both mounts |
| `ch4-2s-7` | `9ea5823` | `483a0ca` | step toggle, Step 2 parameters, confirm-and-clear |
| `ch4-2s-8` | `6e75682` | `1cf3a41` | per-step output gating, the 2-of-2 comparison table |
| `ch4-2s-9` | `070bf48` | `96c1d10` | `ch4-two-step.spec.ts`, sibling-spec repair, gate, closeout |

The commit `main` pointed at immediately before the merge — i.e. the code-rollback
target **as of 2026-09-29** — is **`22be7e8`** (`0a300f8^1`). Because of the
`e2e-inherited-repair` detour above, reverting to it also drops those four
test-only commits; none of them touch product code.

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

**Scope of that sentence: local/CI databases.** Whether this index was ever
applied to **production** is *unrecorded*. The plan's own Task 10 had four
production steps (premise check, duplicate preflight, `--verbose` drift
inspection, then the apply); nothing in
[`docs/CHANGELOG-implementation.md`](../CHANGELOG-implementation.md) records any
of them running against `nos-postgres`, and that entry does explicitly list what
the bundle skipped. Do not assume the index is there. Run the `pg_indexes` query
below before relying on it either way.

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
`enqueueScenarioSolve` entirely; nothing in the current code does. (There are only
two production inserts into `solve_jobs`: one inside that guarded transaction, and
`enqueueSolveJob` at `jobRunner.ts:343`, which has no non-test callers.)

⚠️ **A stale comment in the schema contradicts the above — the comment is wrong,
not this document.** `solve_jobs.ts:118-121` still says `enqueueScenarioSolve`
"inserts WITHOUT checking for an existing job… This index does". That was true
when task 1 wrote it and was superseded by task 4 (`3763d21`), which added the
in-transaction check. If you grep the schema to verify this document's central
claim, read `jobRunner.ts:393-403` rather than the comment.

### Lever 1 — code rollback (redeploy a previous build)

Reverts the UI, the validation, the step derivation and the `steps` projection.
Leaves the database exactly as it is.

```bash
# find the last live deploy whose commit does NOT contain the bundle
#   mcp__render__list_deploys  srv-d9hglg6pbkes73a1j8b0   (nos-api)
#   mcp__render__list_deploys  srv-d9hg4gvlk1mc73dtp67g   (nos-studio)
#
# Test against a5335f6 (task 1's content commit), NOT 0a300f8. Testing the merge
# commit clears any candidate that carries all nine tasks without yet having been
# merged to main — e.g. 070bf48 or c547e2d, the bundle and repair branch tips,
# which contain the whole feature but are not descendants of 0a300f8.
git merge-base --is-ancestor a5335f6 <candidate-sha> \
  && echo "TOO NEW — contains the bundle" \
  || echo "ok — predates the bundle"
```

Both services, or neither. The UI's step toggle talks to API shapes this bundle
added; rolling back only one leaves a frontend asking for `steps` from a server
that no longer projects it, or a server deriving a target step for a frontend
with no way to show it.

**Both services auto-deploy from `main` on commit, so a push can ship either
one.** Verified 2026-10-01: `render.yaml:29` is `autoDeployTrigger: commit` and
the live `nos-api` reports `autoDeploy: yes` / `autoDeployTrigger: commit` /
`branch: main`. An earlier revision of this document said `nos-api` was
`autoDeployTrigger: off` and "always needs a deliberate trigger" — **that is
false**, and false in the dangerous direction: it would tell an operator that
pushing a revert to `main` cannot touch the API. `render.yaml`'s own comment
block records the same correction (made in `06a5b9f`). Separately, the
`nos-studio` webhook has historically *not* fired on its own in this repo, so
check `list_deploys` after any push regardless of what the config promises, and
trigger manually if the commit is not building.

**Caveat, and it has grown since the bundle shipped.** `22be7e8` was a clean
Chapter-4-only revert on 2026-09-29. It is not one any more: Chapter 5
(`delivery-teaching-us`), the CH4UX bundle, the Chapter 9 JADE unlock and the CI
work have all landed on top. Rolling back to `22be7e8` today reverts all of them
too. If the goal is specifically to retire the two-step workflow, a forward fix
or a targeted revert is the smaller change — this bundle added no columns, so
both are smaller than they look.

**If you revert rather than redeploy, mind the merge commits.** Eight of the nine
task commits have two parents, so a bare `git revert <sha>` fails with *"is a
merge but no -m option was given."* Either revert the merges first-parent-wise:

```bash
git revert -m 1 070bf48 6e75682 9ea5823 63e16d5 6cda42c 3763d21 cdd7a1f 0eb54ca
git revert a5335f6          # task 1 is the only single-parent commit
```

…or revert the content commits instead, which need no `-m`:

```bash
git revert 96c1d10 1cf3a41 483a0ca ab1ba98 45b0e41 198c9d7 96e369c eb48ba7 a5335f6
```

Newest-first in both cases. Reverting `a5335f6` removes the index from the schema
file, which matters for Lever 2's re-create step — see the warning there.

**What a code rollback does NOT undo:** `stepEpoch` and `step2` keys already
persisted inside `scenarios.inputs` for Chapter 4 rows stay there. No `422`
storm: `maxCoverageInputsSchema` at `22be7e8` has no `.strict()` on its top-level
object (verified by reading the file at that commit), so the rolled-back
validator strips the unknown keys rather than rejecting them, and the bundle
added no *required* field whose absence could fail validation either.

**But the strip is not inert if you later roll forward.** This is the one
sequence to plan around, because rollback → users keep editing → roll forward is
an ordinary incident timeline:

1. A Chapter 4 scenario sits at, say, `stepEpoch: 5`.
2. Rollback. Any inputs write on that scenario now goes through the old writer,
   which does not know the field — so the strip persists and `stepEpoch`
   disappears from the row.
3. Roll forward. `stepEpoch` is `.default(1)` (`maxCoverage.ts:137`) and
   `readStepEpoch` falls back to `1` when absent
   (`maxCoverageSteps.ts:29-32`), so the scenario reads as epoch 1.
4. `loadScenarioSteps` matches succeeded jobs on
   `COALESCE((input_snapshot->'inputs'->>'stepEpoch')::int, 1) = <epoch>`
   (`maxCoverageSteps.ts:211`) and reports Step 1 as `stale: false`
   unconditionally, on the stated grounds that the only thing which can change it
   bumps the epoch (`:228-230`). That premise is what step 2 broke.

Net effect: **long-superseded epoch-1 results can be presented as current and
non-stale, and Step 2's floor derived from them.** If a rollback is going to be
followed by a roll-forward, audit Chapter 4 scenarios for a missing `stepEpoch`
first:

```sql
SELECT id, name FROM scenarios
WHERE model_id = 'max-coverage-us' AND NOT (inputs ? 'stepEpoch');
```

### Lever 2 — drop the index

```sql
DROP INDEX IF EXISTS "UQ_solve_jobs_active_per_scenario";
```

The quotes are required: the name is mixed-case, so unquoted Postgres folds it to
`uq_solve_jobs_active_per_scenario` and finds nothing. `IF EXISTS` makes it
idempotent.

Safe to run while the code is still deployed, because of the double enforcement
above. Two things are lost, not one:

1. Defence against a future writer that inserts a `solve_jobs` row without going
   through `enqueueScenarioSolve`. (Nothing in the current code does —
   `enqueueSolveJob` at `jobRunner.ts:343` has no non-test callers.)
2. **A test goes red.** `maxCoverageStepWorkflow.test.ts:282-299` ("the database
   itself rejects a second active Chapter 4 job") is a real-Postgres test that
   asserts the raw `db.insert` is refused. Drop the index on any database the
   api-server suite runs against and the verification gate fails with a message
   that looks nothing like its cause. Worth knowing before you run this lever on
   a dev or CI database rather than production.

**It is production DDL, so it needs explicit human consent before execution**
(CLAUDE.md standing rule), even though it is reversible.

### Reversing the index drop

**Prefer the hand-written statement.** It is the one form that does exactly this
and nothing else:

```sql
CREATE UNIQUE INDEX "UQ_solve_jobs_active_per_scenario"
  ON public.solve_jobs USING btree (scenario_id)
  WHERE model_id = 'max-coverage-us' AND status IN ('queued', 'running');
```

**Do not reach for `drizzle-kit push` without checking what it will do.**

```bash
# only from a checkout at or after a5335f6, and read the statements first
DATABASE_URL="<target>" pnpm --filter @workspace/db exec drizzle-kit push --verbose
```

`push` reconciles the **entire** schema from whatever checkout it runs in, not
just this index. Two concrete ways that bites here:

- Run it from a build rolled back to `22be7e8` — precisely the state Lever 1
  produces — and the schema file contains no index, so `push` will propose
  **dropping** the thing you are trying to restore.
- It will also apply any *unrelated* drift between that checkout's schema and the
  target database, silently, in the same pass.

The plan's own Task 10 required inspecting the planned statements with
`--verbose` before confirming. Keep that step.

Either way, re-creating the index **fails** if the table already holds two
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

The `409` row is the only non-obvious one, and it is the one worth running. A
second `202` ("Solve job queued", the endpoint's only success code —
`openapi.yaml:322`) instead of the `409` means the in-transaction guard is **not**
working and the index was load-bearing after all — which would mean this
document's central claim is wrong for the build in front of you. Stop and re-read
`jobRunner.ts:393-403` on that build before proceeding.
