# Chapter 4 dataset migration runbook (MIG-16)

Operator runbook for retiring `chens-cosmetics-cn` and cutting over to
`max-coverage-us`. See
[`docs/superpowers/plans/2026-09-27-ch4-us-dataset-migration.md`](../superpowers/plans/2026-09-27-ch4-us-dataset-migration.md)
for the full task list and
[`docs/superpowers/specs/2026-09-27-ch4-us-dataset-migration-design.md`](../superpowers/specs/2026-09-27-ch4-us-dataset-migration-design.md)
for the design decisions (`MIG-n`) referenced below.

This is a **two-deployment** migration (see the plan's "Execution order and
deployment phases"). Stages A and D are separate `nos-api` deploys with the
build-and-test work for the new model (Tasks 3–9) happening entirely
*between* them. **Nothing from Tasks 3–9 may be deployed until Stage C has
completed** — that build removes the old manifest and registry entry that
Stage A's lock depends on. As of this writing, Stage A has not been deployed
(see Stage A below) — it must be deployed from the separate, unpushed
`ch4-stage-a` branch, not from `main`, because `main`'s own history no
longer contains the old manifest once `ch4-migration` merges.

This document describes four stages. Each has an explicit rollback point.
Stage C is the point of no return: everything before it is reversible by
redeploying a previous build; nothing after it is.

---

## Stage A — lock the old model (PREPARED, NOT DEPLOYED)

**Status: prepared, not deployed.** An earlier draft of this document
claimed this stage was "already shipped" as deployment `8dc8452`. That was
false, and has been verified false three ways as of 2026-09-28:
- `8dc8452` is **not** an ancestor of `origin/main`
  (`git merge-base --is-ancestor 8dc8452 origin/main` fails).
- `origin/main`'s `solvers/chens-cosmetics-cn/manifest.json` has **no**
  `locked` key.
- `8dc8452` exists on no pushed ref (`git branch -r --contains 8dc8452` is
  empty).

**Chapter 4 is open to students in production right now.** Do not treat any
of the checks below as already satisfied — none of them have been run
against production.

The lock DOES exist, ready to deploy, as its own equivalent commit
`044b2c8` (`[ch4-mig-1] lock Chapter 4 ahead of the dataset migration`,
content-identical diff to `8dc8452`) on the local, unpushed branch
`ch4-stage-a`, which is `origin/main` (`ee75ecf`) plus that one commit.

**This is the only place Stage A can still be deployed from.** This
migration branch (`ch4-migration`) deletes the old manifest
(`solvers/chens-cosmetics-cn/manifest.json`) and its registry entries as
part of Tasks 3–9 — **once `ch4-migration` merges to `main`, there is
nothing left on `main` to set `locked` on, and Stage A can no longer be
performed from `main` at all.** Stage A must be deployed from `ch4-stage-a`
specifically, and it must happen before (or independently of) this branch's
merge — do not let `ch4-stage-a` be discarded as "superseded" before Stage A
actually ships.

What it does: adds `"locked": true` to
`solvers/chens-cosmetics-cn/manifest.json` and the matching entry in
`artifacts/studio/src/lib/chapters.ts`. The `lockedModel` middleware
(`artifacts/api-server/src/middlewares/lockedModel.ts`) 403s every
scenario-scoped route for a locked model, including `POST /scenarios`
(create) — so once this is deployed, no *new* `chens-cosmetics-cn`
scenario can be created, and no existing one can be written to, while
Stage B drains queued jobs and Stage C deletes rows underneath it.

**Verify — MANDATORY GATE before Stage B begins, not an already-satisfied
formality.** Both checks below must be run against **production**, in the
same operating session that is about to proceed to Stage B, with their real
HTTP status codes recorded (in this file's copy kept with the operator's
session notes, or equivalent):
- `POST /api/scenarios` with `modelId: "chens-cosmetics-cn"` → must return
  `403`.
- `PATCH /api/scenarios/:id` on an existing chens-cosmetics-cn scenario →
  must return `403`.
- `GET /api/models` still lists `chens-cosmetics-cn` (Stage A does not
  remove the model, only locks it — removal is Task 9, deployed in Stage D).

If either of the first two checks does not return `403`, **stop** — Stage A
has not actually taken effect in production, and Stage B/C must not proceed.

**Rollback:** redeploy `nos-api` from the build immediately before the
`ch4-stage-a` deploy (i.e. `origin/main` at the commit `ch4-stage-a` branched
from). Nothing is destroyed at this stage — the lock is a pure read-side
gate, so reverting it simply reopens the chapter with all data intact.

---

## Stage B — drain the queue (operator-run, not automated by this runbook)

**Goal:** get every `chens-cosmetics-cn` job to a terminal status
(`succeeded` or `failed`) before Stage C deletes the rows underneath them.

**Do not use a `SIGTERM`/deploy-triggered drain for this.**
`drainForShutdown` (`artifacts/api-server/src/solver/jobRunner.ts:800-808`)
stops the dispatcher's recurring scan and waits for *currently active*
jobs to finish (force-cancelling them if they don't, after a grace period)
— but it **never touches `queued` rows**. A `queued` job simply sits there;
the next process to boot with the dispatcher enabled would pick it up and
run it against a model that Stage C is about to delete. Restarting/
redeploying the API server between Stage A and Stage C would silently
strand queued jobs, not drain them.

**Procedure:**
1. Keep `nos-api`'s worker pool running (do not stop/restart the service
   for this stage — Stage A already blocks new arrivals, so the queue can
   only shrink from here).
2. Poll job status for every `chens-cosmetics-cn` scenario's jobs, scoped
   through the parent scenario (never `solve_jobs.model_id` — see
   `scripts/src/migrate-delete-chens-scenarios.ts`'s `countAffected` and
   the note below):
   ```sql
   SELECT j.id, j.status
   FROM solve_jobs j
   JOIN scenarios s ON s.id = j.scenario_id
   WHERE s.model_id = 'chens-cosmetics-cn'
     AND j.status NOT IN ('succeeded', 'failed');
   ```
3. Repeat the poll on an interval (e.g. every 30s) until it returns zero
   rows, **with an explicit timeout** (e.g. 30 minutes — adjust to the
   realistic worst-case solve time for this model's queue depth at the
   moment Stage A locked it). If the timeout expires with non-terminal
   rows remaining:
   - **Stop. Do not proceed to Stage C.**
   - Report the remaining job ids/statuses to a human.
   - Do **not** force-write a terminal status on any row yourself.
     `cancelJob()` (`jobRunner.ts:918`) has no route caller by design — this
     runbook does not become one, and no ad-hoc `UPDATE solve_jobs SET
     status = ...` is ever issued here.

**Why the parent-scenario join, not `solve_jobs.model_id`:**
`solve_jobs.model_id` is an A1 "Class 1" column
(`lib/db/src/schema/solve_jobs.ts:55`) — added nullable, never backfilled,
so it is `NULL` on every job row that predates that migration. Filtering
the poll (or the eventual deletion in Stage C) on
`solve_jobs.model_id = 'chens-cosmetics-cn'` would silently exclude exactly
the *oldest* chens-cosmetics-cn jobs — the query above (and `countAffected`
in Stage C) instead joins `solve_jobs` to its parent `scenarios` row and
filters on `scenarios.model_id`, which has been `NOT NULL` since D0.2.

**Rollback:** none needed — this stage is read-only (polling). If the
timeout expires, the system is left exactly as it was: old model still
locked (Stage A), no rows touched. Investigate and re-run Stage B; nothing
here is destructive.

---

## Stage C — delete the old data (point of no return)

**Precondition — do not enter this transaction otherwise:** the Stage A
403 proofs (both `POST /api/scenarios` and `PATCH /api/scenarios/:id`
against production, above) were captured in this same operating session,
and Stage B's poll returned zero non-terminal jobs. This transaction is
irreversible (see "Rollback: none" below) — the 403 proofs are the only
evidence that no new or edited `chens-cosmetics-cn` row can appear
underneath the deletion while it runs.

Uses `scripts/src/migrate-delete-chens-scenarios.ts`'s
`countAffected(db)` and `deleteChapter4Data(db, confirmation)`, tested by
`artifacts/api-server/src/__tests__/chensDeletion.test.ts`. **This script is
written and tested in this task; it is NOT executed by this task.**
Running it against production student data is a separate, human-gated
operation performed by an operator following the steps below.

1. **Count.** Run `countAffected(db)` against the production database and
   record `scenarioCount` and `jobCount`.
2. **Confirm.** Present that `scenarioCount` to a human operator for
   explicit confirmation. This is a deliberate manual gate, not a
   `--yes`/`--force` flag — the number must be read and confirmed by a
   person before anything is deleted.
3. **Delete.** Call `deleteChapter4Data(db, { confirmedCount })` with the
   human-confirmed number. It:
   - re-runs `countAffected(db)` internally and **refuses to run** (throws)
     if the confirmed number doesn't match a *fresh* count — this closes
     the window between step 1's count and this step's execution (e.g. a
     new scenario slipping in, though Stage A's lock should make that
     impossible for `chens-cosmetics-cn` specifically);
   - deletes, in one `db.transaction`: `solve_jobs` (joined through
     `scenarios`, the same ordering as
     `artifacts/api-server/src/routes/scenarios.ts`'s existing scenario
     delete route: child before parent), then `scenarios`, then
     `result_cache WHERE model_id = 'chens-cosmetics-cn'`.
   - The `result_cache` purge exists because that table is **not** an FK
     child of `scenarios` (`lib/db/src/schema/result_cache.ts` — primary
     key is `inputs_hash`, plus a plain `model_id` column) — without this
     step, cached China-payload rows would strand there indefinitely,
     unreachable by any scenario query but still occupying a cache slot
     keyed on inputs that can never recur. This purge runs unconditionally
     — even when zero live `chens-cosmetics-cn` scenarios remain (e.g. a
     student already deleted their own scenarios via the ordinary
     scenario-delete route, which never touches `result_cache`) — because
     it is scoped by `model_id` alone, not by `scenarioIds`.
   - **Disclosure:** step 2's confirmation gate matches `scenarioCount`
     only; `jobCount` is not independently re-confirmed or re-verified at
     delete time. This is a deliberate scope choice, not a hole — the
     `solve_jobs` delete is driven entirely by `scenarioIds` (via the
     parent-scenario join), not by a separately-confirmed job count, so
     there is no path by which a stale `jobCount` could cause an
     under- or over-deletion independent of `scenarioCount`.
4. **Verify.** Re-run `countAffected(db)` — it must now report
   `scenarioCount: 0, jobCount: 0`.

**No job status is ever written by this script or this stage.** By the
time Stage C runs, Stage B has already driven every affected job to a
terminal status through normal solve completion, not through a forced
write.

**Rollback: none.** This is the point of no return named above — deletion
is not reversible from within the running system. The only recovery path
is a database backup/restore taken before this stage, which is outside the
scope of this runbook (standard production DB backup policy, not
migration-specific).

---

## Stage D — deploy the rename

Deploy the Tasks 3–9 build (the renamed `max-coverage-us` model, its own
US dataset, and the removal of the old manifest/registry entries — Task 9
is what actually deletes `solvers/chens-cosmetics-cn/**` and its registry
lines, and it ships in **this** deployment, never Stage A's, because Stage
A needs the old manifest to still exist for its lock to mean anything).

**Post-deploy checks:**
- `GET /api/models` lists `max-coverage-us` and does **not** list
  `chens-cosmetics-cn`.
- The Chapter 4 card renders in Studio (no locked-chapter flash, no dead
  reference to the old model id).
- Create a fresh scenario on `max-coverage-us` and solve it — expect
  `details.coveragePct` of `68.4192` (the design spec's regenerated
  golden for the new dataset; see the plan's Task 4/Task 5 goldens).

**Rollback:** redeploy the specific `ch4-stage-a` build that Stage A shipped
(not a `main`-history commit — after this branch's merge, `main` no longer
contains the old manifest at any point in its own history, so "the last
Stage-A-era build" means that separate branch's deploy artifact, not a
`git revert` on `main`). Note this rollback is **partial**: it restores the
ability to read/render a `chens-cosmetics-cn`-shaped chapter, but Stage C
has already deleted the underlying scenario/job/result-cache rows — there
is no data to roll back to for students who had `chens-cosmetics-cn`
scenarios before Stage C. A Stage D rollback undoes the *code* deploy only,
not the Stage C data deletion.
